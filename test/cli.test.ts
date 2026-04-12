import { describe, expect, test } from "bun:test";

import { runCli, type CliIo, type CliRuntime } from "../src/cli";
import type { AppConfig, IndexRunResult, SearchResult, StatusSnapshot } from "../src/core/types";

describe("CLI", () => {
  test("renders migrate, sync, search, and status output", async () => {
    const output: string[] = [];
    const io: CliIo = {
      info(message) {
        output.push(message);
      },
      error(message) {
        output.push(`ERR:${message}`);
      },
    };

    let closed = 0;
    const runtime = createFakeRuntime(() => {
      closed += 1;
    });

    await runCli(["migrate"], () => Promise.resolve(runtime), io);
    expect(output.pop()).toContain("Applied migrations");

    await runCli(["sync"], () => Promise.resolve(runtime), io);
    expect(output.pop()).toContain("sync added=1 updated=0 metadataOnly=0 deleted=0 unchanged=0");

    await runCli(["search", "karpathy"], () => Promise.resolve(runtime), io);
    expect(output.pop()).toContain('"slug": "andrej-karpathy"');

    await runCli(["status"], () => Promise.resolve(runtime), io);
    expect(output.pop()).toContain("pages=1");

    expect(closed).toBe(4);
  });
});

function createFakeRuntime(onClose: () => void): CliRuntime {
  const config: AppConfig = {
    projectRoot: process.cwd(),
    databaseUrl: "postgresql://localhost/wiki",
    openAiApiKey: "test",
    compiledPath: "/tmp/compiled",
    rawPath: "/tmp/raw",
    enableQueryExpansion: true,
    pipelineVersion: "v1",
    embeddingModel: "text-embedding-3-large",
    embeddingDimensions: 1536,
    anthropicModel: "claude-3-5-haiku-latest",
  };

  const result: IndexRunResult = {
    counts: {
      added: 1,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      metadataOnly: 0,
    },
    deletedSlugs: [],
    dedupPairs: [],
  };
  const searchResults: SearchResult[] = [
    {
      slug: "andrej-karpathy",
      title: "Andrej Karpathy",
      snippet: "Andrej Karpathy is an AI researcher.",
      score: 1,
      chunkIndex: 0,
      matchedBy: ["keyword"],
      sourceQueries: ["karpathy"],
    },
  ];
  const status: StatusSnapshot = {
    pageCount: 1,
    chunkCount: 2,
    lastSyncAt: "2026-04-11T00:00:00.000Z",
    missingEmbeddings: 0,
    stalePages: 0,
  };

  return {
    config,
    db: {
      runMigrations: async () => ["001_initial.sql"],
      getStatusSnapshot: async () => status,
      close: async () => onClose(),
      ensureReady: async () => {},
    } as unknown as CliRuntime["db"],
    indexer: {
      indexAll: async () => result,
      reportDiff: () => "added=1 updated=0 metadataOnly=0 deleted=0 unchanged=0",
    } as unknown as CliRuntime["indexer"],
    searchEngine: {
      hybridSearch: async () => searchResults,
    } as unknown as CliRuntime["searchEngine"],
    startServer: async () => undefined,
  };
}
