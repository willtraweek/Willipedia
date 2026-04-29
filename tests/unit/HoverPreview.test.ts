import { describe, expect, test } from "vitest";
import { createMissingPreviewPayload, createPreviewPayload, getBrokenPreviewText } from "@/lib/ui";
import type { VaultEntry } from "@/lib/types";

const entry: VaultEntry = {
  slug: "Logic/Godel",
  slugKey: "logic/godel",
  title: "Godel",
  deck: "Arithmetic outruns formal closure.",
  excerpt: "Arithmetic outruns formal closure.",
  category: "LOGIC",
  updatedAt: new Date("2026-04-20T00:00:00.000Z"),
  relativePath: "Logic/Godel.md",
  absolutePath: "/tmp/Logic/Godel.md",
  realPath: "/tmp/Logic/Godel.md",
  markdown: "# Godel",
  bodyMarkdown: "Arithmetic outruns formal closure.",
  plainText: "Arithmetic outruns formal closure.",
  isStub: false
};

describe("HoverPreview helpers", () => {
  test("serializes valid preview payloads", () => {
    const payload = createPreviewPayload(entry);
    expect(payload.title).toBe("Godel");
    expect(payload.updatedLabel).toContain("UPDATED");
    expect(payload.broken).toBe(false);
  });

  test("serializes missing preview payloads", () => {
    const payload = createMissingPreviewPayload("Missing Topic");
    expect(payload.broken).toBe(true);
    expect(payload.title).toBe("Missing Topic");
  });

  test("returns the broken-link hover fragment", () => {
    expect(getBrokenPreviewText()).toContain("No page yet.");
  });
});
