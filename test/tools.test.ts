import fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { WikiIndexer } from "../src/core/indexer";
import { SearchEngine } from "../src/core/search";
import { exploreRelated, getSourceFile } from "../src/mcp/tools";
import {
  createFixtureWorkspace,
  createTestConfig,
  DeterministicEmbeddingProvider,
  InMemoryWikiStore,
  RecursiveChunkingProvider,
  StaticExpansionProvider,
} from "./setup";

describe("MCP tools", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;
  let store: InMemoryWikiStore;
  let config: ReturnType<typeof createTestConfig>;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
    config = createTestConfig(workspace);
    store = new InMemoryWikiStore();

    const embeddings = new DeterministicEmbeddingProvider();
    const indexer = new WikiIndexer(
      config,
      store,
      embeddings,
      new RecursiveChunkingProvider(),
    );
    await indexer.indexAll();

    new SearchEngine(config, store, embeddings, new StaticExpansionProvider());
  });

  afterEach(async () => {
    await fs.rm(workspace.rootDir, { recursive: true, force: true });
  });

  test("reads raw files only from within raw/", async () => {
    const file = await getSourceFile(config, "raw/source-article.md");
    expect(file.content).toContain("Source Article");

    await expect(getSourceFile(config, "../package.json")).rejects.toThrow(
      "Path must be within raw/ directory",
    );
  });

  test("explores related pages without looping on cycles", async () => {
    const related = await exploreRelated(store, "Andrej Karpathy", 3, 10);
    expect(related).toEqual([
      expect.objectContaining({
        slug: "thread-by-karpathy",
        depth: 1,
      }),
    ]);
  });
});

