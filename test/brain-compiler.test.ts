import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { WikiCompiler } from "../src/brain/compiler";
import type { BrainLlmProvider, NormalizedSource } from "../src/brain/types";
import { heuristicCompilePage } from "../src/brain/pipeline";
import { WikiIndexer } from "../src/core/indexer";
import {
  createFixtureWorkspace,
  createTestConfig,
  DeterministicEmbeddingProvider,
  InMemoryWikiStore,
  RecursiveChunkingProvider,
} from "./setup";

describe("WikiCompiler", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspace.rootDir, { recursive: true, force: true });
  });

  test("ingests a source, writes pages, indexes them, and records provenance", async () => {
    const config = createTestConfig(workspace);
    const store = new InMemoryWikiStore();
    const embeddings = new DeterministicEmbeddingProvider();
    const indexer = new WikiIndexer(config, store, embeddings, new RecursiveChunkingProvider());
    await indexer.indexAll();

    const compiler = new WikiCompiler(
      config,
      store,
      embeddings,
      {
        detectFormat: () => "article",
        dispatch: async () =>
          makeSource({
            title: "Knowledge Distillery",
            excerpt: "A pattern for turning sources into evergreen notes.",
            rawText:
              "A compiler should preserve provenance. A compiler should create durable abstractions.",
            markdown:
              "# Knowledge Distillery\n\nA compiler should preserve provenance.\n\nA compiler should create durable abstractions.",
          }),
      } as never,
      new CompilerProvider(),
    );

    const result = await compiler.ingest("https://example.com/distillery");
    await indexer.indexAll();
    expect(result.status).toBe("created");
    expect(result.pageSlugs).toContain("knowledge-distillery");

    const conceptPath = path.join(workspace.compiledDir, "concepts", "knowledge-distillery.md");
    const sourcePath = path.join(
      workspace.compiledDir,
      "sources",
      result.pageSlugs.find((slug) => slug.startsWith("example-com-distillery"))! + ".md",
    );

    expect(await fs.readFile(conceptPath, "utf8")).toContain("Distilled Notes");
    expect(await fs.readFile(sourcePath, "utf8")).toContain("https://example.com/distillery");
    expect((await store.checkSourceExists("https://example.com/distillery"))?.pageSlugs).toContain(
      "knowledge-distillery",
    );
    expect(await store.getPageBySlug("knowledge-distillery")).not.toBeNull();
  });

  test("skips already ingested URLs unless refresh is requested", async () => {
    const config = createTestConfig(workspace);
    const store = new InMemoryWikiStore();
    const embeddings = new DeterministicEmbeddingProvider();
    const indexer = new WikiIndexer(config, store, embeddings, new RecursiveChunkingProvider());
    const dispatcher = {
      detectFormat: () => "article",
      dispatch: async () => makeSource(),
    } as never;

    const compiler = new WikiCompiler(
      config,
      store,
      embeddings,
      dispatcher,
      new CompilerProvider(),
    );

    await compiler.ingest("https://example.com/distillery");
    const skipped = await compiler.ingest("https://example.com/distillery");
    expect(skipped.status).toBe("skipped");
    expect(skipped.reason).toBe("already ingested");
  });
});

class CompilerProvider implements BrainLlmProvider {
  async extractEntities({ source }: { source: NormalizedSource }): Promise<unknown> {
    return {
      entities: [
        {
          name: source.title,
          kind: "concept",
          summary: source.excerpt ?? undefined,
        },
      ],
    };
  }

  async classifyRoute(): Promise<unknown> {
    return {
      category: "concepts",
      rationale: "This is a reusable idea rather than a person.",
      confidence: 0.8,
    };
  }

  async compilePage(input: Parameters<typeof heuristicCompilePage>[0]): Promise<unknown> {
    return heuristicCompilePage(input);
  }
}

function makeSource(overrides: Partial<NormalizedSource> = {}): NormalizedSource {
  return {
    url: "https://example.com/distillery",
    canonicalUrl: "https://example.com/distillery",
    format: "article",
    domain: "example.com",
    title: "Knowledge Distillery",
    byline: "Researcher",
    publishedAt: "2026-04-13",
    excerpt: "A pattern for turning sources into evergreen notes.",
    markdown:
      "# Knowledge Distillery\n\nA compiler should preserve provenance.\n\nA compiler should create durable abstractions.",
    rawText:
      "A compiler should preserve provenance. A compiler should create durable abstractions.",
    contentHash: "distillery-hash",
    ...overrides,
  };
}
