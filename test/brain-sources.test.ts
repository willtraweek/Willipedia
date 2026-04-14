import { describe, expect, test } from "bun:test";

import { appendSourceUrl, buildSourcePageDraft, buildSourceSlug } from "../src/brain/sources";

describe("brain sources helpers", () => {
  test("appends source URLs without duplication", () => {
    expect(
      appendSourceUrl({ sources: ["https://example.com/a"] }, "https://example.com/a"),
    ).toEqual({
      sources: ["https://example.com/a"],
    });
  });

  test("builds deterministic source page drafts", () => {
    const draft = buildSourcePageDraft(
      {
        url: "https://example.com/articles/distillery",
        canonicalUrl: "https://example.com/articles/distillery",
        format: "article",
        domain: "example.com",
        title: "Distillery Notes",
        byline: null,
        publishedAt: "2026-04-12",
        excerpt: "Source excerpt.",
        markdown: "# Distillery Notes\n\nBody",
        rawText: "Body",
        contentHash: "hash",
      },
      ["knowledge-distillery"],
    );

    expect(draft.category).toBe("sources");
    expect(draft.slug).toBe(buildSourceSlug("https://example.com/articles/distillery"));
    expect(draft.body).toContain("knowledge-distillery");
  });
});
