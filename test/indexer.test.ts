import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { WikiIndexer } from "../src/core/indexer";
import {
  createFixtureWorkspace,
  createTestConfig,
  DeterministicEmbeddingProvider,
  InMemoryWikiStore,
  RecursiveChunkingProvider,
} from "./setup";

describe("WikiIndexer", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspace.rootDir, { recursive: true, force: true });
  });

  test("indexes fixtures, detects metadata-only updates, and prunes deleted pages", async () => {
    const config = createTestConfig(workspace);
    const store = new InMemoryWikiStore();
    const indexer = new WikiIndexer(
      config,
      store,
      new DeterministicEmbeddingProvider(),
      new RecursiveChunkingProvider(),
    );

    const firstRun = await indexer.indexAll();
    expect(firstRun.counts).toEqual({
      added: 3,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      metadataOnly: 0,
    });

    const secondRun = await indexer.indexAll();
    expect(secondRun.counts.unchanged).toBe(3);

    const karpathyPath = path.join(workspace.compiledDir, "Andrej Karpathy.md");
    const original = await fs.readFile(karpathyPath, "utf8");
    await fs.writeFile(
      karpathyPath,
      original.replace("title: Andrej Karpathy", "title: Andrej Karpathy Updated"),
    );

    const metadataRun = await indexer.indexAll();
    expect(metadataRun.counts.metadataOnly).toBe(1);
    expect((await store.getPageBySlug("andrej-karpathy"))?.title).toBe(
      "Andrej Karpathy Updated",
    );

    await fs.rm(path.join(workspace.compiledDir, "Napoleon Notes.md"));
    const pruneRun = await indexer.indexAll();
    expect(pruneRun.counts.deleted).toBe(1);
    expect(await store.getPageBySlug("napoleon-notes")).toBeNull();
  });
});

