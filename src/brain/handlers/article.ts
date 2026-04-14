import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { sha256 } from "../../core/hash";
import { normalizeDomain } from "../quotas";
import type { NormalizedSource } from "../types";

export type ArticleFetch = typeof fetch;

export class ArticleSourceHandler {
  constructor(private readonly fetchImpl: ArticleFetch = fetch) {}

  async fetch(url: string): Promise<NormalizedSource> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          "user-agent": "willipedia/0.1 (willipedia compiler)",
          accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Article fetch failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    return parseArticleHtml(url, html);
  }
}

export function parseArticleHtml(url: string, html: string): NormalizedSource {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const readable = new Readability(document).parse();

  const title =
    readable?.title?.trim() ||
    document.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() ||
    document.title.trim() ||
    url;
  const canonicalUrl =
    document.querySelector("link[rel='canonical']")?.getAttribute("href")?.trim() || url;
  const contentHtml =
    readable?.content ??
    document.querySelector("article")?.innerHTML ??
    document.querySelector("main")?.innerHTML ??
    document.body?.innerHTML ??
    "";
  const rawText = htmlFragmentToMarkdown(contentHtml)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const excerpt =
    readable?.excerpt?.trim() ||
    document
      .querySelector("meta[name='description']")
      ?.getAttribute("content")
      ?.trim() ||
    firstParagraph(rawText);
  const publishedAt =
    document
      .querySelector("meta[property='article:published_time']")
      ?.getAttribute("content")
      ?.trim() ||
    document.querySelector("time")?.getAttribute("datetime")?.trim() ||
    null;
  const byline =
    readable?.byline?.trim() ||
    document.querySelector("meta[name='author']")?.getAttribute("content")?.trim() ||
    null;
  const markdown = [`# ${title}`, "", rawText].join("\n").trim();

  return {
    url,
    canonicalUrl,
    format: "article",
    domain: normalizeDomain(new URL(url).hostname),
    title,
    byline,
    publishedAt,
    excerpt,
    markdown,
    rawText,
    contentHash: sha256(`${canonicalUrl}\n${title}\n${rawText}`),
  };
}

function htmlFragmentToMarkdown(html: string): string {
  const dom = new JSDOM(`<body>${html}</body>`);
  const blocks = Array.from<Element>(
    dom.window.document.body.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre",
    ),
  );

  if (blocks.length === 0) {
    return dom.window.document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }

  return blocks
    .map((block) => {
      const text = block.textContent?.replace(/\s+/g, " ").trim();
      if (!text) {
        return "";
      }

      if (/^H[1-6]$/.test(block.tagName)) {
        const level = Number(block.tagName.slice(1));
        return `${"#".repeat(level)} ${text}`;
      }

      if (block.tagName === "LI") {
        return `- ${text}`;
      }

      if (block.tagName === "BLOCKQUOTE") {
        return `> ${text}`;
      }

      return text;
    })
    .filter(Boolean)
    .join("\n\n");
}

function firstParagraph(markdown: string): string | null {
  return (
    markdown
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .find(Boolean) ?? null
  );
}

