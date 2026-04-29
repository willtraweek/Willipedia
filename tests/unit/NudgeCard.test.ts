import { describe, expect, test } from "vitest";
import { getNudgeCardModel } from "@/lib/ui";

describe("NudgeCard model", () => {
  test("renders broken-wikilink copy", () => {
    const model = getNudgeCardModel("broken-wikilink", "Missing Topic");
    expect(model.prompt).toContain("Missing Topic");
  });

  test("renders typo copy without a prompt", () => {
    const model = getNudgeCardModel("typo");
    expect(model.prompt).toBeNull();
    expect(model.headline).toContain("Nothing turned up");
  });

  test("renders stub copy", () => {
    const model = getNudgeCardModel("stub", "Logic/Stub");
    expect(model.kicker).toBe("THIS PAGE IS A STUB");
  });
});
