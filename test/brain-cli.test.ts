import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runCli, type CliIo, type CliRuntime } from "../src/cli";
import type { AppConfig, IndexRunResult, SearchResult, StatusSnapshot } from "../src/core/types";

describe("brain CLI", () => {
  let tempRoot: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-cli-"));
    originalCwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("renders schema without constructing the runtime", async () => {
    const clippings = path.join(tempRoot, "Clippings", "people");
    await fs.mkdir(clippings, { recursive: true });
    await fs.writeFile(path.join(clippings, "README.md"), "People pages.\n", "utf8");
    process.chdir(tempRoot);

    const output: string[] = [];
    const io: CliIo = {
      info(message) {
        output.push(message);
      },
      error(message) {
        output.push(`ERR:${message}`);
      },
    };

    await runCli(
      ["brain", "schema"],
      () => {
        throw new Error("runtime factory should not run for brain schema");
      },
      io,
    );

    expect(output[0]).toContain("compiled_root=");
    expect(output[0]).toContain("people: People pages.");
  });

  test("renders ingest and drain output", async () => {
    const output: string[] = [];
    const io: CliIo = {
      info(message) {
        output.push(message);
      },
      error(message) {
        output.push(`ERR:${message}`);
      },
    };

    const runtime = createFakeRuntime();
    await runCli(["brain", "ingest", "https://example.com/post", "--dry-run"], () =>
      Promise.resolve(runtime), io);
    expect(output.pop()).toContain("status=dry-run");

    const batchFile = path.join(tempRoot, "urls.txt");
    await fs.writeFile(
      batchFile,
      ["https://example.com/post", "https://example.com/other"].join("\n"),
      "utf8",
    );
    process.chdir(tempRoot);
    await runCli(["brain", "ingest", "--batch", "urls.txt"], () => Promise.resolve(runtime), io);
    expect(output.pop()).toContain("---");

    await runCli(["brain", "drain", "--limit=1"], () => Promise.resolve(runtime), io);
    expect(output.pop()).toContain("status=queued");
  });
});

function createFakeRuntime(): CliRuntime {
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
      close: async () => undefined,
      ensureReady: async () => {},
    } as unknown as CliRuntime["db"],
    indexer: {
      indexAll: async () => result,
      reportDiff: () => "added=1 updated=0 metadataOnly=0 deleted=0 unchanged=0",
    } as unknown as CliRuntime["indexer"],
    searchEngine: {
      hybridSearch: async () => searchResults,
    } as unknown as CliRuntime["searchEngine"],
    compiler: {
      ingest: async () => ({
        status: "dry-run",
        url: "https://example.com/post",
        format: "article",
        pageSlugs: ["knowledge-distillery"],
        sourceHash: "hash",
      }),
      drain: async () => [
        {
          status: "queued",
          url: "https://example.com/post",
          format: "article",
          pageSlugs: [],
          reason: "rate limit reached",
          queuedId: 7,
        },
      ],
    } as unknown as CliRuntime["compiler"],
    startServer: async () => undefined,
  };
}
