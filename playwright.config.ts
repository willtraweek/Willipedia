import { defineConfig, devices } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4321/wiki/";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: baseUrl,
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "GBRAIN_WRAPPER_PORT=8788 bun run tests/fixtures/mock-wrapper-server.ts",
      port: 8788,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    },
    {
      command: "GBRAIN_PATH=$(pwd)/tests/fixtures/vault GBRAIN_WRAPPER_URL=http://127.0.0.1:8788/mcp bunx astro dev --host 127.0.0.1 --port 4321",
      port: 4321,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
