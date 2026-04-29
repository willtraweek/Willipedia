import fs from "node:fs";
import path from "node:path";
import type { AstroCookies } from "astro";
import type { SetupIssue } from "@/lib/types";

export const AUTH_COOKIE_NAME = "willipedia_bearer";
export const WRAPPER_TIMEOUT_MS = 5_000;
export const INDEX_CACHE_TTL_MS = 60_000;

export function getWrapperUrl(): string {
  return process.env.GBRAIN_WRAPPER_URL?.trim() || "http://127.0.0.1:8787/mcp";
}

export function getVaultPath(): string | null {
  const raw = process.env.GBRAIN_PATH?.trim();
  if (!raw) {
    return null;
  }

  return path.resolve(raw);
}

export function getBearerFromCookies(cookies: AstroCookies): string | null {
  return cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export function getInitialSetupIssues(): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const vaultPath = getVaultPath();

  if (!vaultPath) {
    issues.push({
      code: "GBRAIN_PATH_UNSET",
      paragraph:
        "Willipedia needs a readable Obsidian vault path before it can print the archive. The environment is missing the vault root, so the reader has nothing to typeset.",
      configLines: [
        "GBRAIN_PATH = <unset>",
        "expected   = an absolute path containing *.md files",
        "actual     = missing environment variable",
        "fix        = export GBRAIN_PATH=/absolute/path/to/your/vault"
      ]
    });

    return issues;
  }

  if (!fs.existsSync(vaultPath)) {
    issues.push({
      code: "VAULT_UNREACHABLE",
      paragraph:
        "Willipedia found a vault path, but the directory is not present on disk. The archive cannot read pages from a path that does not exist.",
      configLines: [
        `GBRAIN_PATH = ${vaultPath}`,
        "expected   = a directory containing *.md files",
        "actual     = ENOENT — no such directory",
        "fix        = point GBRAIN_PATH at the mounted Obsidian vault"
      ]
    });
  } else if (!fs.statSync(vaultPath).isDirectory()) {
    issues.push({
      code: "VAULT_UNREACHABLE",
      paragraph:
        "Willipedia can see the configured vault path, but it resolves to a file instead of a directory. The archive expects a directory tree of markdown pages.",
      configLines: [
        `GBRAIN_PATH = ${vaultPath}`,
        "expected   = a directory containing *.md files",
        "actual     = configured path is not a directory",
        "fix        = point GBRAIN_PATH at the vault root directory"
      ]
    });
  }

  return issues;
}

export function getWrapperTimeoutIssue(error: unknown): SetupIssue {
  const message = error instanceof Error ? error.message : String(error);

  return {
    code: "WRAPPER_TIMEOUT",
    paragraph:
      "Willipedia reached for the GBrain wrapper and the endpoint did not answer in time. The reader can still render local pages, but wrapper-backed auth and search are unavailable until the service responds.",
    configLines: [
      `GBRAIN_WRAPPER_URL = ${getWrapperUrl()}`,
      "expected          = reachable MCP HTTP endpoint",
      `actual            = ${message}`,
      "fix               = start the wrapper or point GBRAIN_WRAPPER_URL at the live service"
    ]
  };
}

export function shortBearerFingerprint(bearer: string | null): string {
  if (!bearer) {
    return "· · ·";
  }

  const cleaned = bearer.replace(/\s+/g, "");
  const head = cleaned.slice(0, 2).toUpperCase();
  const tail = cleaned.slice(-4).toUpperCase();

  return `PRIVATE CIRCULATION · ${head}${tail}`;
}
