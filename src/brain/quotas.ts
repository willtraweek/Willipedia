import fs from "node:fs/promises";
import path from "node:path";

import type { CompilerStore, SourceFormat } from "../core/types";

export interface DomainRateLimit {
  maxDaily: number;
  delayMs: number;
}

export interface DomainQuotaDecision {
  domain: string;
  format: SourceFormat;
  config: DomainRateLimit | null;
  currentCount: number;
  allowed: boolean;
}

export async function loadRateLimits(
  projectRoot: string,
): Promise<Record<string, DomainRateLimit>> {
  const filePath = path.join(projectRoot, "rate-limits.json");

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, DomainRateLimit>;
    return Object.fromEntries(
      Object.entries(parsed).map(([domain, config]) => [
        normalizeDomain(domain),
        {
          maxDaily: Number(config.maxDaily ?? 0),
          delayMs: Number(config.delayMs ?? 0),
        },
      ]),
    );
  } catch {
    return {};
  }
}

export async function checkDomainQuotaForUrl(
  store: CompilerStore,
  projectRoot: string,
  url: string,
  format: SourceFormat,
  now = new Date(),
): Promise<DomainQuotaDecision> {
  const limits = await loadRateLimits(projectRoot);
  const domain = normalizeDomain(new URL(url).hostname);
  const config = limits[domain] ?? null;
  if (!config) {
    return {
      domain,
      format,
      config: null,
      currentCount: 0,
      allowed: true,
    };
  }

  const currentCount = await store.checkDomainQuota(domain, toQuotaDate(now));
  return {
    domain,
    format,
    config,
    currentCount,
    allowed: currentCount < config.maxDaily,
  };
}

export async function waitForRateLimitDelay(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

export function toQuotaDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
