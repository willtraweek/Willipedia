import fs from "node:fs/promises";
import path from "node:path";
import { INDEX_CACHE_TTL_MS, getVaultPath } from "@/lib/config";
import { buildExcerpt, parseMarkdown } from "@/lib/markdown";
import type { VaultEntry, VaultIndex } from "@/lib/types";

let cache: {
  expiresAt: number;
  root: string;
  index: VaultIndex | null;
} = {
  expiresAt: 0,
  root: "",
  index: null
};

function slugKey(slug: string): string {
  return slug.toLowerCase();
}

function isWithinRoot(rootReal: string, candidateReal: string): boolean {
  return (
    candidateReal === rootReal ||
    candidateReal.startsWith(`${rootReal}${path.sep}`)
  );
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }

      if (entry.isFile() && absolute.toLowerCase().endsWith(".md")) {
        files.push(absolute);
      }
    }
  }

  await walk(root);
  return files;
}

function deriveCategory(relativePath: string): string {
  const segments = relativePath.split("/");
  if (segments.length > 1) {
    return segments[0].replace(/[-_]+/g, " ").toUpperCase();
  }

  return "ARCHIVE";
}

async function buildIndex(root: string): Promise<VaultIndex> {
  const assetRootReal = await fs.realpath(root);
  const files = await walkMarkdownFiles(root);
  const entries = await Promise.all(
    files.map(async (absolutePath) => {
      const realPath = await fs.realpath(absolutePath);
      if (!isWithinRoot(assetRootReal, realPath)) {
        throw new Error(`Path escapes vault root: ${absolutePath}`);
      }

      const relativePath = path.relative(assetRootReal, realPath).replace(/\\/g, "/");
      const slug = relativePath.replace(/\.md$/i, "");
      const updatedAt = (await fs.stat(realPath)).mtime;
      const markdown = await fs.readFile(realPath, "utf8");
      const parsed = parseMarkdown(markdown, slug);
      const excerpt = buildExcerpt(parsed.bodyMarkdown, 220);
      const deck = buildExcerpt(parsed.bodyMarkdown, 160);
      const plainText = parsed.plainText;

      return {
        slug,
        slugKey: slugKey(slug),
        title: parsed.title,
        deck,
        excerpt,
        category: deriveCategory(relativePath),
        updatedAt,
        relativePath,
        absolutePath,
        realPath,
        markdown,
        bodyMarkdown: parsed.bodyMarkdown,
        plainText,
        isStub: plainText.length === 0
      } satisfies VaultEntry;
    })
  );

  entries.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

  return {
    entries,
    slugMap: new Map(entries.map((entry) => [entry.slug, entry])),
    slugKeyMap: new Map(entries.map((entry) => [entry.slugKey, entry])),
    assetRoot: root,
    assetRootReal
  };
}

export async function getVaultIndex(force = false): Promise<VaultIndex> {
  const root = getVaultPath();
  if (!root) {
    throw new Error("GBRAIN_PATH is not configured.");
  }

  const now = Date.now();
  if (
    !force &&
    cache.index &&
    cache.root === root &&
    cache.expiresAt > now
  ) {
    return cache.index;
  }

  const index = await buildIndex(root);
  cache = {
    expiresAt: now + INDEX_CACHE_TTL_MS,
    root,
    index
  };
  return index;
}

export function normalizeSlug(input: string): string {
  const decoded = decodeURIComponent(input).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!decoded || decoded.includes("\0") || decoded.startsWith("..") || decoded.includes("/../")) {
    throw new Error("Invalid slug path.");
  }

  return decoded;
}

export async function resolveSlug(input: string): Promise<VaultEntry | null> {
  const index = await getVaultIndex();
  const normalized = normalizeSlug(input);

  return index.slugMap.get(normalized) ?? index.slugKeyMap.get(slugKey(normalized)) ?? null;
}

export async function resolveAssetPath(assetPath: string): Promise<string> {
  const index = await getVaultIndex();
  const decoded = decodeURIComponent(assetPath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!decoded || decoded.includes("\0") || decoded.includes("/../") || decoded.startsWith("../")) {
    throw new Error("Invalid asset path.");
  }

  if (decoded.endsWith(".md") || decoded.startsWith(".raw/")) {
    throw new Error("Asset path is not allowed.");
  }

  const absolute = path.join(index.assetRootReal, decoded);
  const real = await fs.realpath(absolute);
  if (!isWithinRoot(index.assetRootReal, real)) {
    throw new Error("Asset path escapes vault root.");
  }

  return real;
}

export async function getRecentEntries(limit = 8): Promise<VaultEntry[]> {
  const index = await getVaultIndex();
  return index.entries.slice(0, limit);
}

export async function getArchivePageCount(): Promise<number> {
  const index = await getVaultIndex();
  return index.entries.length;
}

export async function getExcerptForSlug(slug: string): Promise<string> {
  const entry = await resolveSlug(slug);
  return entry?.excerpt ?? "";
}
