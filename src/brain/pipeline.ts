import Anthropic from "@anthropic-ai/sdk";

import type { AppConfig, CompilerStore, EmbeddingProvider } from "../core/types";
import { slugify } from "../core/indexer";

import { buildSourcePageDraft } from "./sources";
import type {
  BrainCategoryDefinition,
  BrainLlmProvider,
  ClassifyRouteInput,
  CompilePageInput,
  CompiledPageDraft,
  EntityExtractionResult,
  ExtractEntitiesInput,
  ExtractedEntity,
  MECERoute,
  NormalizedSource,
  PipelineResult,
  ReconciledEntity,
} from "./types";
import {
  compiledPageSchema,
  entityExtractionResultSchema,
  meceRouteSchema,
} from "./types";

export class BrainPipeline {
  constructor(
    private readonly store: CompilerStore,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly llmProvider: BrainLlmProvider,
  ) {}

  async run(
    source: NormalizedSource,
    categories: BrainCategoryDefinition[],
  ): Promise<PipelineResult> {
    const extracted = await this.extractEntities(source);
    const entities = await this.reconcileEntities(extracted.entities, source.title);
    const route = await this.classifyRoute(source, categories, entities);
    if (!route) {
      return buildMinimalResult(source);
    }

    const primaryEntity = pickPrimaryEntity(entities, source.title);
    const compiled = await this.compilePrimaryPage(source, categories, route, primaryEntity, entities);
    if (!compiled) {
      return buildMinimalResult(source);
    }

    const primarySlug =
      primaryEntity?.slug ??
      (slugify(compiled.slug ?? compiled.title ?? source.title) || slugify(source.title));
    const normalizedPrimary: CompiledPageDraft = {
      ...compiled,
      slug: primarySlug,
      category: normalizeCategory(route.category, categories),
      frontmatter: {
        ...compiled.frontmatter,
        title: compiled.title,
        slug: primarySlug,
        category: normalizeCategory(route.category, categories),
      },
      relatedSlugs: uniqueStrings(compiled.relatedSlugs),
    };
    const sourcePage = buildSourcePageDraft(
      source,
      normalizedPrimary.slug ? [normalizedPrimary.slug, ...normalizedPrimary.relatedSlugs] : [],
    );

    return {
      primaryPage: normalizedPrimary,
      sourcePage,
      route,
      entities,
      fallback: false,
    };
  }

  private async extractEntities(source: NormalizedSource): Promise<EntityExtractionResult> {
    const result = entityExtractionResultSchema.safeParse(
      await this.llmProvider.extractEntities({ source }),
    );
    if (!result.success) {
      return {
        entities: [],
      };
    }

    if (result.data.entities.length > 0) {
      return result.data;
    }

    return {
      entities: heuristicExtractEntities({ source }).entities,
    };
  }

  private async reconcileEntities(
    entities: ExtractedEntity[],
    fallbackTitle: string,
  ): Promise<ReconciledEntity[]> {
    const candidates: ExtractedEntity[] =
      entities.length > 0 ? entities : [{ name: fallbackTitle, kind: "unknown" }];
    const reconciled: ReconciledEntity[] = [];

    for (const entity of candidates) {
      const exactSlug = slugify(entity.name);
      const exactMatch = await this.store.getPageBySlug(exactSlug);
      if (exactMatch) {
        reconciled.push({
          ...entity,
          slug: exactMatch.slug,
          title: exactMatch.title,
          existing: true,
          matchType: "exact",
          score: 1,
        });
        continue;
      }

      const titleMatch = await this.store.findBestTitleMatch(entity.name, 0.7);
      if (titleMatch) {
        reconciled.push({
          ...entity,
          slug: titleMatch.slug,
          title: titleMatch.title,
          existing: true,
          matchType: "title",
          score: similarity(entity.name, titleMatch.title),
        });
        continue;
      }

      const [embedding] = await this.embeddingProvider.embed([entity.name]);
      if (embedding) {
        const vectorMatch = (await this.store.searchEntityEmbeddings(embedding, 1))[0];
        if (vectorMatch && vectorMatch.score >= 0.82) {
          reconciled.push({
            ...entity,
            slug: vectorMatch.slug,
            title: vectorMatch.title,
            existing: true,
            matchType: "vector",
            score: vectorMatch.score,
          });
          continue;
        }
      }

      const title = entity.name.trim();
      reconciled.push({
        ...entity,
        slug: slugify(title),
        title,
        existing: false,
        matchType: "new",
        score: null,
      });
    }

    return dedupeEntities(reconciled);
  }

  private async classifyRoute(
    source: NormalizedSource,
    categories: BrainCategoryDefinition[],
    entities: ReconciledEntity[],
  ): Promise<MECERoute | null> {
    const result = meceRouteSchema.safeParse(
      await this.llmProvider.classifyRoute({
        source,
        categories,
        entities,
      }),
    );

    if (!result.success) {
      return null;
    }

    return {
      ...result.data,
      category: normalizeCategory(result.data.category, categories),
    };
  }

  private async compilePrimaryPage(
    source: NormalizedSource,
    categories: BrainCategoryDefinition[],
    route: MECERoute,
    primaryEntity: ReconciledEntity | null,
    entities: ReconciledEntity[],
  ): Promise<CompiledPageDraft | null> {
    const result = compiledPageSchema.safeParse(
      await this.llmProvider.compilePage({
        source,
        route,
        categories,
        primaryEntity,
        entities,
      }),
    );

    return result.success ? result.data : null;
  }
}

export class AnthropicBrainProvider implements BrainLlmProvider {
  private readonly client: Anthropic | undefined;

  constructor(private readonly config: AppConfig, client?: Anthropic) {
    this.client =
      client ??
      (config.anthropicApiKey
        ? new Anthropic({ apiKey: config.anthropicApiKey })
        : undefined);
  }

  async extractEntities(input: ExtractEntitiesInput): Promise<unknown> {
    if (!this.client) {
      return heuristicExtractEntities(input);
    }

    const fallback = heuristicExtractEntities(input);
    return this.invokeJsonPrompt(
      [
        "Extract named entities from this source.",
        "Return strict JSON with shape: {\"entities\":[{\"name\":\"...\",\"kind\":\"person|concept|organization|work|source|unknown\",\"summary\":\"optional\"}]}",
        `Title: ${input.source.title}`,
        "",
        clip(input.source.rawText),
      ].join("\n"),
      fallback,
    );
  }

  async classifyRoute(input: ClassifyRouteInput): Promise<unknown> {
    const fallback = heuristicClassifyRoute(input);
    if (!this.client) {
      return fallback;
    }

    return this.invokeJsonPrompt(
      [
        "Choose the best MECE category for this source.",
        "Return strict JSON with shape: {\"category\":\"...\",\"rationale\":\"...\",\"confidence\":0.0}",
        "Available categories:",
        ...input.categories.map(
          (category) => `- ${category.category}: ${category.instructions}`,
        ),
        `Title: ${input.source.title}`,
        `Entities: ${input.entities.map((entity) => `${entity.name} (${entity.kind})`).join(", ")}`,
        "",
        clip(input.source.rawText),
      ].join("\n"),
      fallback,
    );
  }

  async compilePage(input: CompilePageInput): Promise<unknown> {
    const fallback = heuristicCompilePage(input);
    if (!this.client) {
      return fallback;
    }

    return this.invokeJsonPrompt(
      [
        "Compile a markdown wiki page draft for this source.",
        "Return strict JSON with shape: {\"title\":\"...\",\"slug\":\"...\",\"category\":\"...\",\"summary\":\"optional\",\"body\":\"markdown\",\"frontmatter\":{},\"relatedSlugs\":[\"...\"]}",
        `Category: ${input.route.category}`,
        `Primary entity: ${input.primaryEntity?.title ?? "none"}`,
        `Related entities: ${input.entities.map((entity) => entity.slug).join(", ")}`,
        `Title: ${input.source.title}`,
        "",
        clip(input.source.rawText),
      ].join("\n"),
      fallback,
    );
  }

  private async invokeJsonPrompt(prompt: string, fallback: unknown): Promise<unknown> {
    try {
      const message = await this.client!.messages.create({
        model: this.config.anthropicModel,
        max_tokens: 2048,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
      });
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return extractJson(text) ?? fallback;
    } catch (error) {
      console.error(
        "LLM call failed, falling back to heuristics:",
        error instanceof Error ? error.message : String(error),
      );
      return fallback;
    }
  }
}

export function heuristicExtractEntities(
  input: ExtractEntitiesInput,
): EntityExtractionResult {
  const title = input.source.title.trim();
  const sentences = input.source.rawText
    .split(/[.!?]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const inferredKind = looksLikePerson(title) ? "person" : "concept";

  return {
    entities: [
      {
        name: title,
        kind: inferredKind,
        summary: sentences[0],
      },
    ],
  };
}

export function heuristicClassifyRoute(input: ClassifyRouteInput): MECERoute {
  const categories = new Set(input.categories.map((item) => item.category));
  const primary = pickPrimaryEntity(input.entities, input.source.title);
  const candidate =
    primary?.kind === "person" && categories.has("people")
      ? "people"
      : categories.has("concepts")
        ? "concepts"
        : categories.has("sources")
          ? "sources"
          : input.categories[0]?.category ?? "sources";

  return {
    category: candidate,
    rationale:
      primary?.kind === "person"
        ? "Primary entity appears to be a person."
        : "Source reads like a concept or general note.",
    confidence: 0.7,
  };
}

export function heuristicCompilePage(input: CompilePageInput): CompiledPageDraft {
  const primary = input.primaryEntity;
  const slug = primary?.slug ?? slugify(input.source.title);
  const title = primary?.title ?? input.source.title;
  const summary =
    input.source.excerpt ??
    input.source.rawText.split(/[.!?]\s+/).map((part) => part.trim()).find(Boolean) ??
    `Compiled from ${input.source.url}`;
  const related = input.entities
    .filter((entity) => entity.slug !== slug)
    .map((entity) => entity.slug);
  const relatedLinks = input.entities
    .filter((entity) => entity.slug !== slug)
    .map((entity) => `[[${entity.slug}|${entity.title}]]`);
  const notes = summarizeIntoBullets(input.source.rawText);
  const body = [
    summary,
    "",
    "## Distilled Notes",
    "",
    ...notes.map((note) => `- ${note}`),
    ...(relatedLinks.length > 0
      ? ["", "## Related", "", relatedLinks.join(", ")]
      : []),
    "",
    "## Source",
    "",
    `- ${input.source.url}`,
  ]
    .join("\n")
    .trim();

  return {
    title,
    slug,
    category: input.route.category,
    summary,
    body,
    frontmatter: {
      title,
      slug,
      category: input.route.category,
      tags: [input.route.category, ...(primary?.kind ? [primary.kind] : [])],
      sources: [input.source.url],
      published: input.source.publishedAt ?? undefined,
      confidence: "medium",
    },
    relatedSlugs: uniqueStrings(related),
  };
}

function buildMinimalResult(source: NormalizedSource): PipelineResult {
  return {
    primaryPage: null,
    sourcePage: buildSourcePageDraft(source, []),
    route: {
      category: "sources",
      rationale: "Fallback source-only ingest after validation failure.",
      confidence: 0.2,
    },
    entities: [],
    fallback: true,
  };
}

function pickPrimaryEntity(
  entities: ReconciledEntity[],
  fallbackTitle: string,
): ReconciledEntity | null {
  const preferred =
    entities.find((entity) => entity.kind === "person") ??
    entities.find((entity) => entity.kind !== "source") ??
    entities[0];

  if (preferred) {
    return preferred;
  }

  const fallbackSlug = slugify(fallbackTitle);
  return fallbackSlug
    ? {
        name: fallbackTitle,
        kind: "unknown",
        slug: fallbackSlug,
        title: fallbackTitle,
        existing: false,
        matchType: "new",
        score: null,
      }
    : null;
}

function dedupeEntities(entities: ReconciledEntity[]): ReconciledEntity[] {
  const bySlug = new Map<string, ReconciledEntity>();

  for (const entity of entities) {
    const existing = bySlug.get(entity.slug);
    if (!existing) {
      bySlug.set(entity.slug, entity);
      continue;
    }

    if (entity.existing && !existing.existing) {
      bySlug.set(entity.slug, entity);
    }
  }

  return Array.from(bySlug.values());
}

function summarizeIntoBullets(rawText: string): string[] {
  const sentences = rawText
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return uniqueStrings(sentences).slice(0, 4);
}

function normalizeCategory(
  category: string,
  categories: BrainCategoryDefinition[],
): string {
  const normalized = category.trim().toLowerCase();
  return (
    categories.find((item) => item.category.toLowerCase() === normalized)?.category ??
    categories.find((item) => item.category === "sources")?.category ??
    categories[0]?.category ??
    "sources"
  );
}

function looksLikePerson(title: string): boolean {
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(title.trim());
}

function clip(input: string, maxChars = 8000): string {
  return input.length <= maxChars ? input : input.slice(0, maxChars);
}

function extractJson(input: string): unknown | null {
  const match = input.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(left.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const rightTokens = new Set(right.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  let intersection = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return union.size === 0 ? 0 : intersection / union.size;
}
