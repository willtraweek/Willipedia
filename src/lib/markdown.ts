import matter from "gray-matter";
import { toString } from "mdast-util-to-string";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkSmartypants from "remark-smartypants";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Root as HastRoot, Element as HastElement } from "hast";
import type { Content, Parent, Root, Text } from "mdast";
import { encodeSlugPath, withBase } from "@/lib/base";

interface WikilinkResolution {
  slug: string;
  exists: boolean;
  displayText: string;
  brokenPreviewText: string;
}

interface RenderOptions {
  resolveWikilink: (rawTarget: string, rawLabel?: string) => WikilinkResolution;
}

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  title: string;
  bodyMarkdown: string;
  plainText: string;
}

function prettifySlug(slug: string): string {
  const tail = slug.split("/").at(-1) ?? slug;
  return tail
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function firstHeading(markdown: string): string | null {
  const match = markdown.match(/^\s*#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function stripLeadingHeading(markdown: string): string {
  return markdown.replace(/^\s*#\s+.+?(?:\r?\n){1,2}/, "");
}

function normalizeCallouts(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const normalized: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!/^>\s*\[!/.test(line)) {
      normalized.push(line);
      continue;
    }

    const block: string[] = [];
    while (index < lines.length && /^>/.test(lines[index])) {
      block.push(lines[index].replace(/^>\s?/, ""));
      index += 1;
    }

    normalized.push("```text", ...block, "```");
    index -= 1;
  }

  return normalized.join("\n");
}

function normalizeEmbeds(markdown: string): string {
  return markdown.replace(/!\[\[([^[\]]+)\]\]/g, "\n```text\n![[\$1]]\n```\n");
}

export function normalizeUnsupportedSyntax(markdown: string): string {
  return normalizeEmbeds(normalizeCallouts(markdown)).replace(
    /^```(?:dataview|dataviewjs)\s*$/gm,
    "```text"
  );
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^```[\s\S]*?^```$/gm, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMarkdown(markdown: string, slug: string): ParsedMarkdown {
  const parsed = matter(markdown);
  const normalized = normalizeUnsupportedSyntax(parsed.content);
  const title =
    (typeof parsed.data.title === "string" && parsed.data.title.trim()) ||
    firstHeading(normalized) ||
    prettifySlug(slug);
  const bodyMarkdown = stripLeadingHeading(normalized).trim();
  const plainText = stripMarkdown(bodyMarkdown);

  return {
    frontmatter: parsed.data,
    title,
    bodyMarkdown,
    plainText
  };
}

function createLinkNode(resolution: WikilinkResolution): Content {
  const href = withBase(`/page/${encodeSlugPath(resolution.slug)}`);
  const className = ["wikilink"];

  if (resolution.exists) {
    if (/^[A-Z]/.test(resolution.displayText)) {
      className.push("wikilink--smallcaps");
    }
  } else {
    className.push("broken-link", "wikilink--smallcaps");
  }

  return {
    type: "link",
    url: href,
    data: {
      hProperties: {
        className,
        "data-broken": resolution.exists ? "false" : "true",
        "data-preview-url": resolution.exists
          ? withBase(`/api/preview/${encodeSlugPath(resolution.slug)}`)
          : "",
        "data-preview-text": resolution.exists ? "" : resolution.brokenPreviewText,
        "data-slug": resolution.slug
      }
    },
    children: [
      {
        type: "text",
        value: resolution.displayText
      }
    ]
  };
}

function replaceTextNode(node: Text, resolver: RenderOptions["resolveWikilink"]): Content[] {
  const pattern = /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g;
  const parts: Content[] = [];
  let lastIndex = 0;

  for (const match of node.value.matchAll(pattern)) {
    const [raw, target, label] = match;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({
        type: "text",
        value: node.value.slice(lastIndex, index)
      });
    }

    parts.push(createLinkNode(resolver(target.trim(), label?.trim())));
    lastIndex = index + raw.length;
  }

  if (lastIndex < node.value.length) {
    parts.push({
      type: "text",
      value: node.value.slice(lastIndex)
    });
  }

  return parts.length ? parts : [node];
}

function transformWikilinks(tree: Parent, resolver: RenderOptions["resolveWikilink"]): void {
  if (!("children" in tree) || !Array.isArray(tree.children)) {
    return;
  }

  for (let index = 0; index < tree.children.length; index += 1) {
    const child = tree.children[index] as Content;

    if (child.type === "text") {
      const replacement = replaceTextNode(child, resolver);
      tree.children.splice(index, 1, ...replacement);
      index += replacement.length - 1;
      continue;
    }

    if ("children" in child && child.type !== "link") {
      transformWikilinks(child as Parent, resolver);
    }
  }
}

function remarkObsidianWikilinks(options: RenderOptions) {
  return (tree: Root) => {
    transformWikilinks(tree, options.resolveWikilink);
  };
}

function rehypeExternalLinks() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: HastElement) => {
      if (node.tagName !== "a") {
        return;
      }

      const href = String(node.properties?.href ?? "");
      if (!/^https?:\/\//.test(href)) {
        return;
      }

      node.properties = {
        ...node.properties,
        className: ["external-link"],
        target: "_blank",
        rel: "noopener noreferrer"
      };

    });
  };
}

export async function renderMarkdown(markdown: string, options: RenderOptions): Promise<string> {
  const rendered = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkObsidianWikilinks, options)
    .use(remarkSmartypants)
    .use(remarkRehype)
    .use(rehypeExternalLinks)
    .use(rehypeStringify)
    .process(markdown);

  return String(rendered);
}

export function buildExcerpt(markdown: string, maxLength = 160): string {
  const excerpt = stripMarkdown(markdown);
  if (excerpt.length <= maxLength) {
    return excerpt;
  }

  return `${excerpt.slice(0, maxLength - 1).trimEnd()}…`;
}

export function toTextSummary(markdown: string): string {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  return toString(tree).replace(/\s+/g, " ").trim();
}
