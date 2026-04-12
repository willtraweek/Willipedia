import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildQueryLogInsert } from "../core/db";
import type {
  AppConfig,
  PageRecord,
  RelatedPage,
  ToolStore,
} from "../core/types";
import type { SearchEngine } from "../core/search";

export interface WikiToolDependencies {
  config: AppConfig;
  store: ToolStore;
  searchEngine: SearchEngine;
}

export function registerWikiTools(server: McpServer, deps: WikiToolDependencies): void {
  server.registerTool(
    "search_compiled",
    {
      description: "Search compiled wiki pages with hybrid keyword and vector retrieval.",
      inputSchema: {
        query: z.string().min(1).describe("Search query"),
        limit: z.number().int().min(1).max(20).optional().describe("Result limit"),
      },
    },
    async ({ query, limit = 8 }) => {
      const startedAt = Date.now();
      const results = await deps.searchEngine.hybridSearch(query, { limit });
      logToolQuery(
        deps.store,
        buildQueryLogInsert(
          "search_compiled",
          query,
          results,
          results.length,
          Date.now() - startedAt,
        ),
      );

      return {
        content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
        structuredContent: { results },
      };
    },
  );

  server.registerTool(
    "get_page",
    {
      description: "Fetch a full compiled wiki page by slug, with fuzzy fallback.",
      inputSchema: {
        slug: z.string().min(1).describe("Page slug or close title match"),
      },
    },
    async ({ slug }) => {
      const startedAt = Date.now();
      const page = await resolvePage(deps.store, slug);
      if (!page) {
        throw new Error(`Page not found: ${slug}`);
      }

      logToolQuery(
        deps.store,
        buildQueryLogInsert(
          "get_page",
          slug,
          { slug: page.slug, title: page.title, tags: page.tags },
          1,
          Date.now() - startedAt,
        ),
      );

      return {
        content: [{ type: "text", text: JSON.stringify(page, null, 2) }],
        structuredContent: { page },
      };
    },
  );

  server.registerTool(
    "get_source",
    {
      description: "Read a source document under raw/ with path traversal protections.",
      inputSchema: {
        path: z.string().min(1).describe("Relative or absolute path under raw/"),
      },
    },
    async ({ path: requestedPath }) => {
      const startedAt = Date.now();
      const result = await getSourceFile(deps.config, requestedPath);

      logToolQuery(
        deps.store,
        buildQueryLogInsert(
          "get_source",
          requestedPath,
          { path: result.path, bytes: result.content.length },
          1,
          Date.now() - startedAt,
        ),
      );

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { file: result },
      };
    },
  );

  server.registerTool(
    "explore_related",
    {
      description: "Traverse outgoing wiki links breadth-first from a starting page.",
      inputSchema: {
        slug: z.string().min(1).describe("Starting page slug or fuzzy title"),
        depth: z.number().int().min(1).max(3).optional().describe("Traversal depth"),
        limit: z.number().int().min(1).max(50).optional().describe("Result cap"),
      },
    },
    async ({ slug, depth = 2, limit = 20 }) => {
      const startedAt = Date.now();
      const related = await exploreRelated(deps.store, slug, depth, limit);

      logToolQuery(
        deps.store,
        buildQueryLogInsert(
          "explore_related",
          slug,
          related,
          related.length,
          Date.now() - startedAt,
        ),
      );

      return {
        content: [{ type: "text", text: JSON.stringify({ related }, null, 2) }],
        structuredContent: { related },
      };
    },
  );
}

export async function exploreRelated(
  store: ToolStore,
  slugOrTitle: string,
  depthLimit: number,
  resultLimit: number,
): Promise<RelatedPage[]> {
  const origin = await resolvePage(store, slugOrTitle);
  if (!origin) {
    throw new Error(`Page not found: ${slugOrTitle}`);
  }

  const queue: Array<{ slug: string; depth: number }> = [{ slug: origin.slug, depth: 0 }];
  const visited = new Set<string>([origin.slug]);
  const related: RelatedPage[] = [];

  while (queue.length > 0 && related.length < resultLimit) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current.depth >= depthLimit) {
      continue;
    }

    const outgoing = await store.getOutgoingLinks(current.slug);
    const pageSummaries = await store.getPagesBySlugs(outgoing);
    const pageBySlug = new Map(pageSummaries.map((page) => [page.slug, page]));

    for (const targetSlug of outgoing) {
      if (visited.has(targetSlug)) {
        continue;
      }

      visited.add(targetSlug);
      const summary = pageBySlug.get(targetSlug);
      related.push({
        slug: targetSlug,
        title: summary?.title ?? humanizeSlug(targetSlug),
        depth: current.depth + 1,
        incoming: false,
        outgoing: true,
      });

      if (related.length >= resultLimit) {
        break;
      }

      queue.push({ slug: targetSlug, depth: current.depth + 1 });
    }
  }

  return related;
}

export async function getSourceFile(
  config: AppConfig,
  requestedPath: string,
): Promise<{ path: string; content: string }> {
  const rawDir = path.resolve(config.rawPath);
  const rawDirReal = await fs.realpath(rawDir).catch(() => rawDir);
  const resolved = path.resolve(config.projectRoot, requestedPath);

  if (!isWithinDirectory(rawDir, resolved)) {
    throw new Error("Path must be within raw/ directory");
  }

  let realPath: string;
  try {
    realPath = await fs.realpath(resolved);
  } catch {
    throw new Error(`Source file not found: ${requestedPath}`);
  }

  if (!isWithinDirectory(rawDirReal, realPath)) {
    throw new Error("Symlink target outside raw/ directory");
  }

  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new Error(`Source path is not a file: ${requestedPath}`);
  }

  return {
    path: path.relative(config.projectRoot, realPath),
    content: await fs.readFile(realPath, "utf8"),
  };
}

async function resolvePage(store: ToolStore, slugOrTitle: string): Promise<PageRecord | null> {
  const normalized = slugOrTitle.trim();
  const exact = await store.getPageBySlug(normalized);
  if (exact) {
    return exact;
  }

  return store.findBestPageMatch(normalized, 0.3);
}

function logToolQuery(store: ToolStore, entry: Parameters<ToolStore["insertQueryLog"]>[0]): void {
  void store.insertQueryLog(entry).catch((error) => {
    console.error("Query log insert failed:", error);
  });
}

function isWithinDirectory(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
