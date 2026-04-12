import fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { WikiIndexer } from "../src/core/indexer";
import { SearchEngine, rrfFuse } from "../src/core/search";
import {
  createFixtureWorkspace,
  createTestConfig,
  DeterministicEmbeddingProvider,
  InMemoryWikiStore,
  RecursiveChunkingProvider,
  StaticExpansionProvider,
} from "./setup";

describe("SearchEngine", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;
  let store: InMemoryWikiStore;
  let searchEngine: SearchEngine;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
    const config = createTestConfig(workspace);
    store = new InMemoryWikiStore();

    const embeddings = new DeterministicEmbeddingProvider();
    const indexer = new WikiIndexer(
      config,
      store,
      embeddings,
      new RecursiveChunkingProvider(),
    );
    await indexer.indexAll();

    searchEngine = new SearchEngine(
      config,
      store,
      embeddings,
      new StaticExpansionProvider({
        "compiled brain": ["LLM knowledge bases"],
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(workspace.rootDir, { recursive: true, force: true });
  });

  test("fuses keyword and vector rankings with RRF", () => {
    const results = rrfFuse(
      [
        {
          chunkId: 1,
          pageId: 1,
          slug: "andrej-karpathy",
          title: "Andrej Karpathy",
          content: "A",
          chunkIndex: 0,
          score: 10,
          matchedBy: "keyword",
        },
        {
          chunkId: 2,
          pageId: 2,
          slug: "thread-by-karpathy",
          title: "Thread",
          content: "B",
          chunkIndex: 0,
          score: 9,
          matchedBy: "keyword",
        },
      ],
      [
        {
          chunkId: 2,
          pageId: 2,
          slug: "thread-by-karpathy",
          title: "Thread",
          content: "B",
          chunkIndex: 0,
          score: 10,
          matchedBy: "vector",
        },
      ],
    );

    expect(results[0]?.chunkId).toBe(2);
    expect(results[0]?.matchedModes).toEqual(["keyword", "vector"]);
  });

  test("returns relevant results and uses expansion for close semantic matches", async () => {
    const llmResults = await searchEngine.hybridSearch("LLM knowledge bases");
    expect(llmResults.some((result) => result.slug === "thread-by-karpathy")).toBe(
      true,
    );

    const expandedResults = await searchEngine.hybridSearch("compiled brain");
    expect(expandedResults.some((result) => result.slug === "thread-by-karpathy")).toBe(
      true,
    );
  });

  test("rejects empty queries", async () => {
    await expect(searchEngine.hybridSearch("   ")).rejects.toThrow(
      "Query must not be empty",
    );
  });
});
