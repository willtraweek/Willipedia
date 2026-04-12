import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import matter from "gray-matter";
import OpenAI from "openai";

import type {
  AppConfig,
  ChunkingProvider,
  DedupPair,
  EmbeddingProvider,
  IndexedChunk,
  IndexRunCounts,
  IndexRunResult,
  IndexerStore,
  ScannedPage,
  UpsertPageInput,
} from "./types";

export class WikiIndexer {
  constructor(
    private readonly config: AppConfig,
    private readonly store: IndexerStore,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly chunkingProvider: ChunkingProvider,
  ) {}

  async scanCompiledDir(compiledDir = this.config.compiledPath): Promise<ScannedPage[]> {
    const files = await walkMarkdownFiles(compiledDir);
    const pages: ScannedPage[] = [];

    for (const absolutePath of files) {
      pages.push(await scanMarkdownFile(absolutePath, compiledDir));
    }

    return pages.sort((left, right) => left.slug.localeCompare(right.slug));
  }

  async indexAll(): Promise<IndexRunResult> {
    const pages = await this.scanCompiledDir();
    const counts: IndexRunCounts = {
      added: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      metadataOnly: 0,
    };

    for (const page of pages) {
      const result = await this.indexPage(page);
      counts[result] += 1;
    }

    const deletedSlugs = await this.pruneDeleted(pages.map((page) => page.slug));
    counts.deleted += deletedSlugs.length;

    return {
      counts,
      deletedSlugs,
      dedupPairs: await this.reportDedup(),
    };
  }

  async indexPage(page: ScannedPage): Promise<keyof IndexRunCounts> {
    const snapshot = await this.store.getPageSnapshot(page.slug);
    const metadataOnly =
      snapshot !== null &&
      snapshot.pipelineVersion === this.config.pipelineVersion &&
      snapshot.bodyHash === page.bodyHash &&
      snapshot.metadataHash !== page.metadataHash;

    if (
      snapshot !== null &&
      snapshot.pipelineVersion === this.config.pipelineVersion &&
      snapshot.bodyHash === page.bodyHash &&
      snapshot.metadataHash === page.metadataHash
    ) {
      return "unchanged";
    }

    if (metadataOnly) {
      await this.store.withTransaction(async (tx) => {
        const pageId = await tx.upsertPage(toUpsertPageInput(page, this.config.pipelineVersion));
        await tx.replaceTags(pageId, page.tags);
        await tx.refreshChunkSearchContent(pageId, page.title);
      });
      return "metadataOnly";
    }

    const chunkTexts = await this.chunkingProvider.chunk(page);
    const chunks = await this.embedChunks(page.title, chunkTexts);

    await this.store.withTransaction(async (tx) => {
      const pageId = await tx.upsertPage(toUpsertPageInput(page, this.config.pipelineVersion));
      await tx.replaceChunks(pageId, chunks);
      await tx.replaceTags(pageId, page.tags);
      await tx.replaceLinks(pageId, page.links);
    });

    return snapshot === null ? "added" : "updated";
  }

  async pruneDeleted(existingSlugs: string[]): Promise<string[]> {
    return this.store.deletePagesNotInSlugs(existingSlugs);
  }

  async reportDedup(threshold = 0.92): Promise<DedupPair[]> {
    const pages = await this.store.listPageEmbeddings();
    const duplicates: DedupPair[] = [];

    for (let index = 0; index < pages.length; index += 1) {
      const left = pages[index];
      if (!left) {
        continue;
      }

      for (let inner = index + 1; inner < pages.length; inner += 1) {
        const right = pages[inner];
        if (!right) {
          continue;
        }

        const similarity = cosineSimilarity(left.embedding, right.embedding);
        if (similarity >= threshold) {
          duplicates.push({
            leftSlug: left.slug,
            rightSlug: right.slug,
            similarity,
          });
        }
      }
    }

    return duplicates.sort((left, right) => right.similarity - left.similarity);
  }

  reportDiff(result: IndexRunResult): string {
    return [
      `added=${result.counts.added}`,
      `updated=${result.counts.updated}`,
      `metadataOnly=${result.counts.metadataOnly}`,
      `deleted=${result.counts.deleted}`,
      `unchanged=${result.counts.unchanged}`,
    ].join(" ");
  }

  private async embedChunks(title: string, chunkTexts: string[]): Promise<IndexedChunk[]> {
    const embeddings = chunkTexts.length === 0 ? [] : await embedWithRetry(
      this.embeddingProvider,
      chunkTexts,
      this.config.embeddingDimensions,
    );

    return chunkTexts.map((content, index) => ({
      chunkIndex: index,
      content,
      ftsContent: buildFtsContent(title, content),
      embedding: embeddings[index] ?? null,
    }));
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: AppConfig, client?: OpenAI) {
    this.client =
      client ??
      new OpenAI({
        apiKey: config.openAiApiKey,
      });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.client.embeddings.create({
      model: this.config.embeddingModel,
      input: texts,
      dimensions: this.config.embeddingDimensions,
    });

    return response.data.map((item) => item.embedding);
  }
}

export class HaikuChunkingProvider implements ChunkingProvider {
  private readonly client: Anthropic | undefined;

  constructor(private readonly config: AppConfig, client?: Anthropic) {
    this.client =
      client ??
      (config.anthropicApiKey
        ? new Anthropic({ apiKey: config.anthropicApiKey })
        : undefined);
  }

  async chunk(page: Pick<ScannedPage, "title" | "body" | "frontmatter">): Promise<string[]> {
    if (!this.client) {
      return recursiveChunkMarkdown(page.body);
    }

    try {
      const message = await this.client.messages.create({
        model: this.config.anthropicModel,
        max_tokens: 4096,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Split this markdown wiki page into semantically coherent retrieval chunks.",
                  "Return strict JSON: an array of strings and nothing else.",
                  "Each chunk should usually be 500-1600 characters, preserve markdown, and avoid splitting lists or tightly related paragraphs.",
                  `Title: ${page.title}`,
                  "",
                  page.body,
                ].join("\n"),
              },
            ],
          },
        ],
      });

      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      const chunks = parseJsonStringArray(text);
      if (chunks.length > 0) {
        return chunks;
      }

      console.error(`LLM chunker returned no usable chunks for "${page.title}", falling back to recursive`);
      return recursiveChunkMarkdown(page.body);
    } catch (error) {
      console.error(`LLM chunker failed for "${page.title}", falling back to recursive:`, error);
      return recursiveChunkMarkdown(page.body);
    }
  }
}

export async function scanMarkdownFile(
  absolutePath: string,
  compiledRoot: string,
): Promise<ScannedPage> {
  const raw = await fs.readFile(absolutePath, "utf8");
  const relativePath = path.relative(compiledRoot, absolutePath);
  const parsed = parseFrontmatter(raw);
  const body = parsed.content.trim();
  const title = deriveTitle(relativePath, parsed.data, body);
  const slug = deriveSlug(relativePath, parsed.data);
  const tags = extractTags(parsed.data);
  const links = extractLinks(body);
  const freshness = coerceDateString(
    firstDefinedString(
      parsed.data.freshness,
      parsed.data.published,
      parsed.data.updated,
      parsed.data.created,
    ),
  );
  const confidence = firstDefinedString(parsed.data.confidence);

  return {
    absolutePath,
    relativePath,
    slug,
    title,
    body,
    frontmatter: parsed.data,
    bodyHash: sha256(body),
    metadataHash: sha256(
      JSON.stringify({
        relativePath,
        title,
        tags,
        freshness,
        confidence,
        frontmatter: parsed.data,
      }),
    ),
    freshness,
    confidence: confidence ?? null,
    tags,
    links,
  };
}

export function parseFrontmatter(source: string): {
  data: Record<string, unknown>;
  content: string;
} {
  try {
    const parsed = matter(source);
    return {
      data: (parsed.data ?? {}) as Record<string, unknown>,
      content: parsed.content,
    };
  } catch {
    return {
      data: {},
      content: source,
    };
  }
}

export function deriveSlug(
  relativePath: string,
  frontmatter: Record<string, unknown>,
): string {
  const explicit = firstDefinedString(frontmatter.slug);
  if (explicit) {
    return slugify(explicit);
  }

  return slugify(relativePath.replace(/\.md$/i, ""));
}

export function deriveTitle(
  relativePath: string,
  frontmatter: Record<string, unknown>,
  body?: string,
): string {
  const fromFrontmatter = firstDefinedString(frontmatter.title);
  if (fromFrontmatter) {
    return fromFrontmatter;
  }

  if (body) {
    const h1Match = body.match(/^#\s+(.+)$/m);
    if (h1Match?.[1]?.trim()) {
      return h1Match[1].trim();
    }
  }

  return path.basename(relativePath, path.extname(relativePath));
}

export function extractTags(frontmatter: Record<string, unknown>): string[] {
  const rawTags = frontmatter.tags;
  if (Array.isArray(rawTags)) {
    return rawTags
      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
      .filter(Boolean);
  }

  if (typeof rawTags === "string") {
    return rawTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

export function extractLinks(body: string): string[] {
  const links = new Set<string>();

  for (const match of body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1]?.trim();
    if (target) {
      links.add(slugify(target));
    }
  }

  for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]+)?\)/g)) {
    const target = match[1]?.trim();
    if (!target) {
      continue;
    }

    const basename = path.basename(target, ".md");
    if (basename) {
      links.add(slugify(basename));
    }
  }

  return Array.from(links);
}

export function recursiveChunkMarkdown(
  input: string,
  maxChars = 1400,
  overlapChars = 200,
): string[] {
  const normalized = input.trim().replace(/\r\n/g, "\n");
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (!trimmed) {
      current = "";
      return;
    }

    chunks.push(trimmed);
    current = trimmed.slice(Math.max(0, trimmed.length - overlapChars));
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      const microChunks = splitLargeParagraph(paragraph, maxChars);
      for (const microChunk of microChunks) {
        if ((current + "\n\n" + microChunk).trim().length > maxChars && current.trim()) {
          flush();
        }
        current = joinChunk(current, microChunk);
      }
      continue;
    }

    if ((joinChunk(current, paragraph)).length > maxChars && current.trim()) {
      flush();
    }

    current = joinChunk(current, paragraph);
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFtsContent(title: string, content: string): string {
  return `${title}\n\n${content}`;
}

function toUpsertPageInput(
  page: ScannedPage,
  pipelineVersion: string,
): UpsertPageInput {
  return {
    slug: page.slug,
    title: page.title,
    content: page.body,
    frontmatter: page.frontmatter,
    bodyHash: page.bodyHash,
    metadataHash: page.metadataHash,
    pipelineVersion,
    freshness: page.freshness,
    confidence: page.confidence,
  };
}

async function embedWithRetry(
  embeddingProvider: EmbeddingProvider,
  texts: string[],
  expectedDimensions: number,
): Promise<number[][]> {
  const output: number[][] = [];

  for (let index = 0; index < texts.length; index += 100) {
    const batch = texts.slice(index, index + 100);
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const embeddings = await embeddingProvider.embed(batch);
        for (const embedding of embeddings) {
          if (embedding.length !== expectedDimensions) {
            throw new Error(
              `Invalid embedding dimension: expected ${expectedDimensions}, received ${embedding.length}`,
            );
          }
        }
        output.push(...embeddings);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  return output;
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && absolutePath.toLowerCase().endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function splitLargeParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return hardWrap(paragraph, maxChars);
  }

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((joinChunk(current, sentence, " ")).length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = "";
    }

    if (sentence.length > maxChars) {
      chunks.push(...hardWrap(sentence, maxChars));
      current = "";
      continue;
    }

    current = joinChunk(current, sentence, " ");
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function hardWrap(input: string, maxChars: number): string[] {
  const words = input.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if ((joinChunk(current, word, " ")).length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = "";
    }

    current = joinChunk(current, word, " ");
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function joinChunk(current: string, addition: string, separator = "\n\n"): string {
  if (!current.trim()) {
    return addition;
  }

  return `${current}${separator}${addition}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function firstDefinedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function coerceDateString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parseJsonStringArray(input: string): string[] {
  const match = input.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
