import { describe, expect, test } from "vitest";
import { withBase } from "@/lib/base";

describe("withBase", () => {
  test("prefixes raw app paths", () => {
    expect(withBase("/page/Logic/Godel")).toBe("/wiki/page/Logic/Godel");
  });

  test("does not double-prefix", () => {
    expect(withBase("/wiki/search")).toBe("/wiki/search");
  });
});
