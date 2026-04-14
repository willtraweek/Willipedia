#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";

import { WikiCompiler } from "./brain/compiler";
import { loadBrainSchema, renderBrainSchema } from "./brain/schema";
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
  compiler: WikiCompiler;
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
  const compiler = new WikiCompiler(config, db, embeddingProvider);

  return {
    config,
    db,
    indexer,
    searchEngine,
    compiler,
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

  if (command === "brain" && rest[0] === "schema") {
    const compiledPath = await resolveBrainSchemaPath(process.cwd(), process.env.COMPILED_PATH);
    const categories = await loadBrainSchema(compiledPath);
    io.info(renderBrainSchema(compiledPath, categories));
    return;
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
      case "brain": {
        const [subcommand, ...brainArgs] = rest;
        await runtime.db.runMigrations();

        switch (subcommand) {
          case "ingest": {
            const batchFlag = brainArgs.find((arg) => arg.startsWith("--batch="));
            const batchPath = batchFlag
              ? batchFlag.slice("--batch=".length)
              : readFlagValue(brainArgs, "--batch");
            const url = brainArgs.find((arg) => !arg.startsWith("--"))?.trim();
            if (!url && !batchPath) {
              throw new Error("brain ingest requires a URL or --batch <file>");
            }

            const sharedOptions = {
              refresh: brainArgs.includes("--refresh"),
              dryRun: brainArgs.includes("--dry-run"),
            };
            if (batchPath) {
              const urls = await readBatchFile(batchPath);
              const results = await batchWithConcurrency(
                urls,
                (item) => runtime.compiler.ingest(item, sharedOptions),
                3,
              );
              await runtime.indexer.indexAll();
              io.info(results.map(renderBrainResult).join("\n---\n"));
              break;
            }

            const result = await runtime.compiler.ingest(url!, sharedOptions);
            await runtime.indexer.indexAll();
            io.info(renderBrainResult(result));
            break;
          }
          case "drain": {
            const limitFlag = brainArgs.find((arg) => arg.startsWith("--limit="));
            const limit = limitFlag ? Number(limitFlag.slice("--limit=".length)) : 20;
            const results = await runtime.compiler.drain(Number.isFinite(limit) ? limit : 20);
            await runtime.indexer.indexAll();
            io.info(results.map(renderBrainResult).join("\n---\n"));
            break;
          }
          default:
            throw new Error(`Unknown brain command: ${subcommand ?? "(missing)"}`);
        }
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
    "  wiki brain schema",
    "  wiki brain ingest <url> [--refresh] [--dry-run]",
    "  wiki brain ingest --batch <file> [--refresh] [--dry-run]",
    "  wiki brain drain [--limit=20]",
    "  wiki migrate",
    "  wiki sync",
    "  wiki search <query>",
    "  wiki serve",
    "  wiki status",
  ].join("\n");
}

function renderBrainResult(
  result: Awaited<ReturnType<CliRuntime["compiler"]["ingest"]>>,
): string {
  return [
    `status=${result.status}`,
    `url=${result.url}`,
    `format=${result.format}`,
    `page_slugs=${result.pageSlugs.join(",") || "none"}`,
    ...(result.reason ? [`reason=${result.reason}`] : []),
    ...(result.queuedId ? [`queued_id=${result.queuedId}`] : []),
    ...(result.sourceHash ? [`content_hash=${result.sourceHash}`] : []),
  ].join("\n");
}

async function resolveBrainSchemaPath(
  projectRoot: string,
  compiledPathEnv?: string,
): Promise<string> {
  if (compiledPathEnv?.trim()) {
    return path.resolve(projectRoot, compiledPathEnv);
  }

  const candidates = [
    path.resolve(projectRoot, "Clippings"),
    path.resolve(projectRoot, "compiled"),
    path.resolve(projectRoot, "../compiled"),
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return candidates[0]!;
}

function readFlagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return args[index + 1]?.trim() ?? null;
}

async function readBatchFile(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function batchWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map(fn));
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        console.error("batch item failed:", outcome.reason);
      }
    }
  }
  return results;
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
