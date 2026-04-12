#!/usr/bin/env bun

import { loadConfig } from "./core/config";
import { WikiDatabase } from "./core/db";
import { HaikuChunkingProvider, OpenAIEmbeddingProvider, WikiIndexer } from "./core/indexer";
import { AnthropicQueryExpansionProvider, SearchEngine } from "./core/search";
import type {
  AppConfig,
  IndexRunResult,
  StatusSnapshot,
} from "./core/types";
import { startMcpServer } from "./mcp/server";

export interface CliRuntime {
  config: AppConfig;
  db: WikiDatabase;
  indexer: WikiIndexer;
  searchEngine: SearchEngine;
  startServer: () => Promise<unknown>;
}

export interface CliIo {
  info(message: string): void;
  error(message: string): void;
}

export async function createRuntime(config = loadConfig()): Promise<CliRuntime> {
  const db = new WikiDatabase(config);
  const embeddingProvider = new OpenAIEmbeddingProvider(config);
  const chunkingProvider = new HaikuChunkingProvider(config);
  const queryExpansionProvider = new AnthropicQueryExpansionProvider(config);
  const indexer = new WikiIndexer(config, db, embeddingProvider, chunkingProvider);
  const searchEngine = new SearchEngine(
    config,
    db,
    embeddingProvider,
    queryExpansionProvider,
  );

  return {
    config,
    db,
    indexer,
    searchEngine,
    startServer: () =>
      startMcpServer({
        config,
        store: db,
        searchEngine,
      }),
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  runtimeFactory: () => Promise<CliRuntime> = () => createRuntime(),
  io: CliIo = defaultIo,
): Promise<void> {
  const [command, ...rest] = argv;
  if (!command) {
    io.error(usage());
    throw new Error("Missing command");
  }

  const runtime = await runtimeFactory();
  await runtime.db.ensureReady();
  const closeAfter = command !== "serve";

  try {
    switch (command) {
      case "migrate": {
        const executed = await runtime.db.runMigrations();
        io.info(
          executed.length > 0
            ? `Applied migrations: ${executed.join(", ")}`
            : "No migrations pending.",
        );
        break;
      }
      case "sync": {
        await runtime.db.runMigrations();
        const result = await runtime.indexer.indexAll();
        io.info(renderSyncResult(runtime.indexer.reportDiff(result), result));
        break;
      }
      case "search": {
        const query = rest.join(" ").trim();
        if (!query) {
          throw new Error("search requires a query");
        }

        const results = await runtime.searchEngine.hybridSearch(query);
        io.info(JSON.stringify({ query, results }, null, 2));
        break;
      }
      case "serve": {
        await runtime.db.runMigrations();
        await runtime.startServer();
        const shutdown = async () => {
          await runtime.db.close();
          process.exit(0);
        };
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
        break;
      }
      case "status": {
        const snapshot = await runtime.db.getStatusSnapshot(
          runtime.config.pipelineVersion,
        );
        io.info(renderStatus(snapshot));
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    if (closeAfter) {
      await runtime.db.close();
    }
  }
}

function renderSyncResult(diffLine: string, result: IndexRunResult): string {
  const lines = [`sync ${diffLine}`];

  if (result.deletedSlugs.length > 0) {
    lines.push(`deleted_slugs=${result.deletedSlugs.join(", ")}`);
  }

  if (result.dedupPairs.length > 0) {
    lines.push(
      `dedup_candidates=${result.dedupPairs
        .map(
          (pair) =>
            `${pair.leftSlug}<->${pair.rightSlug} (${pair.similarity.toFixed(3)})`,
        )
        .join(", ")}`,
    );
  }

  return lines.join("\n");
}

function renderStatus(snapshot: StatusSnapshot): string {
  return [
    `pages=${snapshot.pageCount}`,
    `chunks=${snapshot.chunkCount}`,
    `last_sync=${snapshot.lastSyncAt ?? "never"}`,
    `missing_embeddings=${snapshot.missingEmbeddings}`,
    `stale_pages=${snapshot.stalePages}`,
  ].join("\n");
}

function usage(): string {
  return [
    "Usage:",
    "  wiki migrate",
    "  wiki sync",
    "  wiki search <query>",
    "  wiki serve",
    "  wiki status",
  ].join("\n");
}

const defaultIo: CliIo = {
  info(message) {
    console.log(message);
  },
  error(message) {
    console.error(message);
  },
};

if (import.meta.main) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

