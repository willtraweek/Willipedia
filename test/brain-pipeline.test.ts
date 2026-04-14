import fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { BrainPipeline, heuristicCompilePage } from "../src/brain/pipeline";
import type { BrainLlmProvider, NormalizedSource } from "../src/brain/types";
import { WikiIndexer } from "../src/core/indexer";
import {
  createFixtureWorkspace,
  createTestConfig,
  DeterministicEmbeddingProvider,
  InMemoryWikiStore,
  RecursiveChunkingProvider,
} from "./setup";

describe("BrainPipeline", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;
  let store: InMemoryWikiStore;
  let embeddings: DeterministicEmbeddingProvider;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
    store = new InMemoryWikiStore();
    embeddings = new DeterministicEmbeddingProvider();

    const config = createTestConfig(workspace);
    const indexer = new WikiIndexer(config, store, embeddings, new RecursiveChunkingProvider());
    await indexer.indexAll();
  });

  afterEach(async () => {
    await fs.rm(workspace.rootDir, { recursive: true, force: true });
  });

  test("reconciles existing people pages and drafts a primary page", async () => {
    const pipeline = new BrainPipeline(store, embeddings, new StubProvider());
    const source = makeSource({
      title: "Andrej Karpathy",
      rawText: "Andrej Karpathy writes about LLM tooling and knowledge bases.",
    });

    const result = await pipeline.run(source, [
      {
        category: "people",
        directoryName: "people",
        readmePath: "people/README.md",
        instructions: "People pages.",
      },
      {
        category: "concepts",
        directoryName: "concepts",
        readmePath: "concepts/README.md",
        instructions: "Concept pages.",
      },
      {
        category: "sources",
        directoryName: "sources",
        readmePath: "sources/README.md",
        instructions: "Source pages.",
      },
    ]);

    expect(result.fallback).toBe(false);
    expect(result.primaryPage?.slug).toBe("andrej-karpathy");
    expect(result.route.category).toBe("people");
    expect(result.sourcePage.category).toBe("sources");
  });

  test("falls back to source-only compilation when llm output fails validation", async () => {
    const pipeline = new BrainPipeline(store, embeddings, {
      extractEntities: async () => ({ wrong: true }),
      classifyRoute: async () => ({ nope: true }),
      compilePage: async () => ({ invalid: true }),
    });

    const result = await pipeline.run(makeSource(), [
      {
        category: "sources",
        directoryName: "sources",
        readmePath: "sources/README.md",
        instructions: "Source pages.",
      },
    ]);

    expect(result.fallback).toBe(true);
    expect(result.primaryPage).toBeNull();
    expect(result.sourcePage.category).toBe("sources");
  });
});

class StubProvider implements BrainLlmProvider {
  async extractEntities({ source }: { source: NormalizedSource }): Promise<unknown> {
    return {
      entities: [
        {
          name: source.title,
          kind: "person",
          summary: "AI researcher and builder.",
        },
      ],
    };
  }

  async classifyRoute(): Promise<unknown> {
    return {
      category: "people",
      rationale: "The title is a person name.",
      confidence: 0.9,
    };
  }

  async compilePage(input: Parameters<typeof heuristicCompilePage>[0]): Promise<unknown> {
    return heuristicCompilePage(input);
  }
}

function makeSource(
  overrides: Partial<NormalizedSource> = {},
): NormalizedSource {
  return {
    url: "https://example.com/post",
    canonicalUrl: "https://example.com/post",
    format: "article",
    domain: "example.com",
    title: "Knowledge Distillery",
    byline: "Author",
    publishedAt: "2026-04-11",
    excerpt: "Distill raw material into durable notes.",
    markdown: "# Knowledge Distillery\n\nDistill raw material into durable notes.",
    rawText: "Distill raw material into durable notes.",
    contentHash: "hash-123",
    ...overrides,
  };
}
