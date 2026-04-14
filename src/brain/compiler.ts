import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import type { AppConfig, CompilerStore, EmbeddingProvider } from "../core/types";
import { scanMarkdownFile, slugify, walkMarkdownFiles } from "../core/indexer";

import { UrlDispatcher } from "./dispatcher";
import { AnthropicBrainProvider, BrainPipeline } from "./pipeline";
import { checkDomainQuotaForUrl, toQuotaDate, waitForRateLimitDelay } from "./quotas";
import { getCategoryDirectory, loadBrainSchema } from "./schema";
import { appendSourceUrl } from "./sources";
import type {
  BrainLlmProvider,
  CompiledPageDraft,
  IngestOptions,
  IngestResult,
  PersistedPageDraft,
  PipelineResult,
} from "./types";

export class WikiCompiler {
  private readonly llmProvider: BrainLlmProvider;

  constructor(
    private readonly config: AppConfig,
    private readonly store: CompilerStore,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly dispatcher = new UrlDispatcher(),
    llmProvider?: BrainLlmProvider,
  ) {
    this.llmProvider = llmProvider ?? new AnthropicBrainProvider(config);
  }

  async ingest(url: string, options: IngestOptions = {}): Promise<IngestResult> {
    const normalizedUrl = normalizeUrl(url);
    const format = this.dispatcher.detectFormat(normalizedUrl);

    try {
      return await this.store.withSourceLock(normalizedUrl, async (lockedStore) => {
        const existing = await lockedStore.checkSourceExists(normalizedUrl);
        if (existing && !options.refresh) {
          if (options.queueId) {
            await lockedStore.markIngestComplete(options.queueId, "completed", null);
          }

          return {
            status: "skipped",
            url: normalizedUrl,
            format,
            pageSlugs: existing.pageSlugs,
            reason: "already ingested",
            sourceHash: existing.contentHash,
          };
        }

        const quota = await checkDomainQuotaForUrl(
          lockedStore,
          this.config.projectRoot,
          normalizedUrl,
          format,
          options.now,
        );
        if (!quota.allowed) {
          const pending = await lockedStore.queuePendingIngest(normalizedUrl, format);
          return {
            status: "queued",
            url: normalizedUrl,
            format,
            pageSlugs: existing?.pageSlugs ?? [],
            reason: `rate limit reached for ${quota.domain}`,
            queuedId: pending.id,
            ...(existing?.contentHash ? { sourceHash: existing.contentHash } : {}),
          };
        }

        if (quota.config?.delayMs) {
          await waitForRateLimitDelay(quota.config.delayMs);
        }

        const source = await this.dispatcher.dispatch(normalizedUrl);
        if (quota.config) {
          await lockedStore.incrementDomainQuota(quota.domain, toQuotaDate(options.now ?? new Date()));
        }

        if (existing && options.refresh && existing.contentHash === source.contentHash) {
          if (options.queueId) {
            await lockedStore.markIngestComplete(options.queueId, "completed", null);
          }

          return {
            status: "skipped",
            url: normalizedUrl,
            format: source.format,
            pageSlugs: existing.pageSlugs,
            reason: "content unchanged on refresh",
            sourceHash: source.contentHash,
          };
        }

        const categories = await loadBrainSchema(this.config.compiledPath);
        const pipeline = new BrainPipeline(
          lockedStore,
          this.embeddingProvider,
          this.llmProvider,
        );
        const compiled = await pipeline.run(source, categories);
        const pageSlugs = compiled.primaryPage
          ? [compiled.primaryPage.slug!, compiled.sourcePage.slug!]
          : [compiled.sourcePage.slug!];

        if (options.dryRun) {
          if (options.queueId) {
            await lockedStore.markIngestComplete(options.queueId, "completed", null);
          }

          return {
            status: "dry-run",
            url: normalizedUrl,
            format: source.format,
            pageSlugs,
            sourceHash: source.contentHash,
          };
        }

        const persisted = await this.persistCompiledPages(compiled, source.url, categories, lockedStore);
        await lockedStore.upsertSource({
          url: source.url,
          format: source.format,
          contentHash: source.contentHash,
          pageSlugs: persisted.map((page) => page.slug),
        });
        await this.persistEntityEmbeddings(compiled, lockedStore);

        if (options.queueId) {
          await lockedStore.markIngestComplete(options.queueId, "completed", null);
        }

        return {
          status: compiled.fallback
            ? "fallback"
            : persisted.some((page) => page.operation === "created")
              ? "created"
              : "updated",
          url: normalizedUrl,
          format: source.format,
          pageSlugs: persisted.map((page) => page.slug),
          sourceHash: source.contentHash,
        };
      });
    } catch (error) {
      if (options.queueId) {
        await this.store.markIngestComplete(
          options.queueId,
          "error",
          error instanceof Error ? error.message : String(error),
        );
      }

      throw error;
    }
  }

  async drain(limit = 20): Promise<IngestResult[]> {
    const pending = await this.store.getPendingIngests(limit);
    const results: IngestResult[] = [];

    for (const item of pending) {
      try {
        const result = await this.ingest(item.url, {
          queueId: item.id,
        });
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.store.markIngestComplete(item.id, "error", message);
        results.push({
          status: "queued",
          url: item.url,
          format: item.format ?? this.dispatcher.detectFormat(item.url),
          pageSlugs: [],
          reason: `failed during drain: ${message}`,
          queuedId: item.id,
        });
      }
    }

    return results;
  }

  private async persistCompiledPages(
    compiled: PipelineResult,
    sourceUrl: string,
    categories: Awaited<ReturnType<typeof loadBrainSchema>>,
    lockedStore: CompilerStore,
  ): Promise<PersistedPageDraft[]> {
    const output: PersistedPageDraft[] = [];

    if (compiled.primaryPage) {
      output.push(
        await this.writePrimaryPage(compiled.primaryPage, sourceUrl, categories, lockedStore),
      );
    }

    output.push(await this.writeNewPage(compiled.sourcePage, categories));
    return output;
  }

  private async writePrimaryPage(
    draft: CompiledPageDraft,
    sourceUrl: string,
    categories: Awaited<ReturnType<typeof loadBrainSchema>>,
    lockedStore: CompilerStore,
  ): Promise<PersistedPageDraft> {
    const slug = draft.slug ?? slugify(draft.title);
    const existing = await lockedStore.getPageBySlug(slug);
    const filePath =
      (await findMarkdownFileBySlug(this.config.compiledPath, slug)) ??
      buildDraftPath(this.config.compiledPath, draft, categories);

    if (existing) {
      await updateFrontmatterOnly(filePath, draft, sourceUrl);
      return {
        path: filePath,
        slug,
        title: existing.title,
        category: draft.category,
        body: existing.content,
        frontmatter: appendSourceUrl(existing.frontmatter, sourceUrl),
        operation: "updated",
      };
    }

    return this.writeNewPage(draft, categories);
  }

  private async writeNewPage(
    draft: CompiledPageDraft,
    categories: Awaited<ReturnType<typeof loadBrainSchema>>,
  ): Promise<PersistedPageDraft> {
    const slug = draft.slug ?? slugify(draft.title);
    const filePath = buildDraftPath(
      this.config.compiledPath,
      {
        ...draft,
        slug,
      },
      categories,
    );
    const existed = await fileExists(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const nextFrontmatter = {
      ...draft.frontmatter,
      title: draft.title,
      slug,
      category: draft.category,
    };
    await fs.writeFile(filePath, serializePage(nextFrontmatter, draft.body), "utf8");

    return {
      path: filePath,
      slug,
      title: draft.title,
      category: draft.category,
      body: draft.body,
      frontmatter: nextFrontmatter,
      operation: existed ? "updated" : "created",
    };
  }

  private async persistEntityEmbeddings(
    compiled: PipelineResult,
    lockedStore: CompilerStore,
  ): Promise<void> {
    const targetEntities = compiled.entities.filter((entity) => entity.kind !== "source");
    if (targetEntities.length === 0) {
      return;
    }

    const embeddings = await this.embeddingProvider.embed(
      targetEntities.map((entity) => entity.title),
    );

    await Promise.all(
      targetEntities.map(async (entity, index) => {
        const embedding = embeddings[index];
        if (!embedding) {
          return;
        }

        await lockedStore.upsertEntityEmbedding(entity.slug, embedding);
      }),
    );
  }
}

function buildDraftPath(
  compiledPath: string,
  draft: CompiledPageDraft,
  categories: Awaited<ReturnType<typeof loadBrainSchema>>,
): string {
  const categoryDir = getCategoryDirectory(compiledPath, draft.category, categories);
  return path.join(categoryDir, `${draft.slug ?? slugify(draft.title)}.md`);
}

async function updateFrontmatterOnly(
  filePath: string,
  draft: CompiledPageDraft,
  sourceUrl: string,
): Promise<void> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const nextFrontmatter = appendSourceUrl(
    {
      ...data,
      title: data.title ?? draft.title,
      slug: data.slug ?? draft.slug,
      category: data.category ?? draft.category,
    },
    sourceUrl,
  );
  await fs.writeFile(filePath, serializePage(nextFrontmatter, parsed.content.trim()), "utf8");
}

function serializePage(frontmatter: Record<string, unknown>, body: string): string {
  return matter.stringify(`${body.trim()}\n`, frontmatter);
}

async function findMarkdownFileBySlug(
  compiledPath: string,
  slug: string,
): Promise<string | null> {
  const files = await walkMarkdownFiles(compiledPath);
  for (const file of files) {
    const scanned = await scanMarkdownFile(file, compiledPath);
    if (scanned.slug === slug) {
      return file;
    }
  }

  return null;
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
