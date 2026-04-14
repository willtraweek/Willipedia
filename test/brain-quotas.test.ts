import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { checkDomainQuotaForUrl, toQuotaDate } from "../src/brain/quotas";
import { createFixtureWorkspace, InMemoryWikiStore } from "./setup";

describe("brain quotas", () => {
  let workspace: Awaited<ReturnType<typeof createFixtureWorkspace>>;
  let store: InMemoryWikiStore;

  beforeEach(async () => {
    workspace = await createFixtureWorkspace();
    store = new InMemoryWikiStore();
    await fs.writeFile(
      path.join(workspace.rootDir, "rate-limits.json"),
      JSON.stringify(
        {
          "youtube.com": {
            maxDaily: 1,
            delayMs: 0,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  afterEach(async () => {
    await fs.rm(workspace.rootDir, { recursive: true, force: true });
  });

  test("blocks domains that exceed configured daily limits", async () => {
    const now = new Date("2026-04-13T12:00:00Z");
    const first = await checkDomainQuotaForUrl(
      store,
      workspace.rootDir,
      "https://www.youtube.com/watch?v=abc123",
      "youtube",
      now,
    );
    expect(first.allowed).toBe(true);

    await store.incrementDomainQuota("youtube.com", toQuotaDate(now));

    const second = await checkDomainQuotaForUrl(
      store,
      workspace.rootDir,
      "https://youtube.com/watch?v=abc123",
      "youtube",
      now,
    );
    expect(second.allowed).toBe(false);
  });
});
