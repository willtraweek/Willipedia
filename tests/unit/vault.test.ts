import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolveAssetPath, resolveSlug } from "@/lib/vault";

const fixtureVault = path.resolve("tests/fixtures/vault");

describe("vault resolution", () => {
  beforeEach(() => {
    process.env.GBRAIN_PATH = fixtureVault;
  });

  afterEach(() => {
    process.env.GBRAIN_PATH = fixtureVault;
  });

  test("resolves a normal slug", async () => {
    const entry = await resolveSlug("Logic/Godel");
    expect(entry?.title).toBe("Godel");
  });

  test("rejects traversal slugs", async () => {
    await expect(resolveSlug("../etc/passwd")).rejects.toThrow("Invalid slug path.");
  });

  test("rejects symlink escapes for assets", async () => {
    const tempVault = await fs.mkdtemp(path.join(os.tmpdir(), "willipedia-vault-"));
    const outsideFile = path.join(os.tmpdir(), "escape.svg");
    const assetDir = path.join(tempVault, "assets");
    await fs.mkdir(assetDir, { recursive: true });
    await fs.writeFile(path.join(tempVault, "Home.md"), "# Home\n");
    await fs.writeFile(outsideFile, "<svg></svg>");
    await fs.symlink(outsideFile, path.join(assetDir, "escape.svg"));

    process.env.GBRAIN_PATH = tempVault;
    await expect(resolveAssetPath("assets/escape.svg")).rejects.toThrow("escapes vault root");
  });
});
