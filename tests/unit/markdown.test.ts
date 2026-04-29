import { describe, expect, test } from "vitest";
import { parseMarkdown, renderMarkdown } from "@/lib/markdown";

describe("markdown handling", () => {
  test("normalizes unsupported obsidian blocks", () => {
    const parsed = parseMarkdown("> [!note]\n> Keep this literal.\n\n```dataview\nTABLE\n```", "Logic/Test");
    expect(parsed.bodyMarkdown).toContain("```text");
    expect(parsed.bodyMarkdown).toContain("Keep this literal.");
  });

  test("renders valid, broken, and external links", async () => {
    const html = await renderMarkdown(
      "See [[Mathematics/Set-Theory|Set Theory]], [[Missing Topic]], and [SEP](https://example.com).",
      {
        resolveWikilink(rawTarget, rawLabel) {
          const exists = rawTarget === "Mathematics/Set-Theory";
          return {
            slug: rawTarget,
            exists,
            displayText: rawLabel || rawTarget,
            brokenPreviewText: "No page yet. Click to propose one for research."
          };
        }
      }
    );

    expect(html).toContain('href="/wiki/page/Mathematics/Set-Theory"');
    expect(html).toContain('class="wikilink broken-link wikilink--smallcaps"');
    expect(html).toContain('class="external-link"');
  });
});
