import { createHash } from "node:crypto";

import type { Frontmatter } from "../core/types";
import { slugify } from "../core/indexer";

import type { CompiledPageDraft, NormalizedSource } from "./types";

export function buildSourcePageDraft(
  source: NormalizedSource,
  pageSlugs: string[],
): CompiledPageDraft {
  const relatedLinks = pageSlugs.map((slug) => `[[${slug}]]`);
  const bodyLines = [
    source.excerpt ? source.excerpt.trim() : `Source ingested from ${source.url}.`,
    "",
    `- URL: ${source.url}`,
    `- Format: ${source.format}`,
    ...(source.byline ? [`- Byline: ${source.byline}`] : []),
    ...(source.publishedAt ? [`- Published: ${source.publishedAt}`] : []),
    ...(relatedLinks.length > 0 ? [`- Linked pages: ${relatedLinks.join(", ")}`] : []),
    "",
    "## Extracted Content",
    "",
    source.markdown.trim(),
  ];

  return {
    title: source.title,
    slug: buildSourceSlug(source.url),
    category: "sources",
    summary: source.excerpt ?? undefined,
    body: bodyLines.join("\n").trim(),
    frontmatter: {
      title: source.title,
      slug: buildSourceSlug(source.url),
      category: "sources",
      url: source.url,
      format: source.format,
      sources: [source.url],
      page_slugs: pageSlugs,
      published: source.publishedAt ?? undefined,
    },
    relatedSlugs: pageSlugs,
  };
}

export function buildSourceSlug(url: string): string {
  const parsed = new URL(url);
  const base = slugify(`${parsed.hostname}${parsed.pathname}`);
  const digest = createHash("sha1").update(url).digest("hex").slice(0, 8);
  return [base || "source", digest].filter(Boolean).join("-");
}

export function appendSourceUrl(frontmatter: Frontmatter, url: string): Frontmatter {
  const sources = Array.isArray(frontmatter.sources)
    ? frontmatter.sources.filter((value): value is string => typeof value === "string")
    : typeof frontmatter.sources === "string"
      ? [frontmatter.sources]
      : [];

  return {
    ...frontmatter,
    sources: Array.from(new Set([...sources, url])),
  };
}
