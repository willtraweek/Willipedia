import { describe, expect, test } from "bun:test";

import { buildQueryLogInsert, dbInternals } from "../src/core/db";

describe("db helpers", () => {
  test("caps oversized query log payloads", () => {
    const capped = dbInternals.capResultsJson({
      data: "x".repeat(40 * 1024),
    }) as { truncated: boolean; originalSize: number; preview: string };

    expect(capped.truncated).toBe(true);
    expect(capped.originalSize).toBeGreaterThan(32 * 1024);
    expect(capped.preview.length).toBe(32 * 1024);
  });

  test("parses vector strings and builds query log records", () => {
    expect(dbInternals.parseVector("[1, 2, 3]")).toEqual([1, 2, 3]);

    expect(
      buildQueryLogInsert("search_compiled", "karpathy", { ok: true }, 1, 12),
    ).toEqual({
      toolUsed: "search_compiled",
      question: "karpathy",
      resultsJson: { ok: true },
      resultsCount: 1,
      durationMs: 12,
    });
  });
});

