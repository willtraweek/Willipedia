import { WRAPPER_TIMEOUT_MS, getWrapperUrl } from "@/lib/config";
import type { BacklinkItem, SearchResult } from "@/lib/types";

export class WrapperError extends Error {
  kind: "unauthorized" | "unavailable" | "protocol";

  constructor(kind: "unauthorized" | "unavailable" | "protocol", message: string) {
    super(message);
    this.kind = kind;
  }
}

let requestId = 0;

function nextId(): number {
  requestId += 1;
  return requestId;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WRAPPER_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new WrapperError("unavailable", "Wrapper request timed out.");
    }

    throw new WrapperError("unavailable", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

async function postRpc<T>(method: string, params: Record<string, unknown>, bearer: string): Promise<T> {
  const response = await fetchWithTimeout(getWrapperUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId(),
      method,
      params
    })
  });

  if (response.status === 401 || response.status === 403) {
    throw new WrapperError("unauthorized", "Bearer rejected by wrapper.");
  }

  if (!response.ok) {
    throw new WrapperError("unavailable", `Wrapper returned ${response.status}.`);
  }

  const payload = (await response.json()) as {
    error?: { message?: string };
    result?: T;
  };

  if (payload.error) {
    throw new WrapperError("protocol", payload.error.message ?? "Wrapper returned an RPC error.");
  }

  return payload.result as T;
}

function maybeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function unpackToolResult(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return input;
  }

  const record = input as Record<string, unknown>;
  if (record.structuredContent) {
    return record.structuredContent;
  }

  if (Array.isArray(record.content)) {
    const text = record.content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const value = (item as Record<string, unknown>).text;
        return typeof value === "string" ? value : null;
      })
      .filter(Boolean)
      .join("\n");

    return maybeParseJson(text);
  }

  return record;
}

async function listToolsInternal(bearer: string): Promise<string[]> {
  const result = await postRpc<{ tools?: Array<{ name?: string }> }>("tools/list", {}, bearer);
  return (result.tools ?? [])
    .map((tool) => tool.name)
    .filter((name): name is string => Boolean(name));
}

export async function validateBearer(bearer: string): Promise<void> {
  await listToolsInternal(bearer);
}

async function callTool(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown> {
  const result = await postRpc<unknown>("tools/call", {
    name,
    arguments: args
  }, bearer);

  return unpackToolResult(result);
}

function normalizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);
}

function coerceString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeSearchPayload(input: unknown): SearchResult[] {
  const source =
    Array.isArray(input)
      ? input
      : Array.isArray((input as Record<string, unknown>)?.results)
        ? ((input as Record<string, unknown>).results as unknown[])
        : Array.isArray((input as Record<string, unknown>)?.items)
          ? ((input as Record<string, unknown>).items as unknown[])
          : [];

  const normalized: SearchResult[] = [];

  for (const item of source) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const slug = coerceString(record.slug || record.path);
    const title = coerceString(record.title, slug);

    if (!slug || !title) {
      continue;
    }

    normalized.push({
        slug,
        title,
        excerpt: coerceString(record.excerpt || record.snippet || record.summary),
        categories: normalizeCategories(record.categories),
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null
      });
  }

  return normalized;
}

function normalizeBacklinksPayload(input: unknown): BacklinkItem[] {
  const source =
    Array.isArray(input)
      ? input
      : Array.isArray((input as Record<string, unknown>)?.backlinks)
        ? ((input as Record<string, unknown>).backlinks as unknown[])
        : Array.isArray((input as Record<string, unknown>)?.items)
          ? ((input as Record<string, unknown>).items as unknown[])
          : [];

  const normalized: BacklinkItem[] = [];

  for (const item of source) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const slug = coerceString(record.slug || record.path);
    const title = coerceString(record.title, slug);

    if (!slug || !title) {
      continue;
    }

    normalized.push({
        slug,
        title,
        parentFolder: coerceString(
          record.parentFolder || record.parent_folder || record.folder,
          "ARCHIVE"
        )
      });
  }

  return normalized;
}

export async function searchArchive(query: string, bearer: string): Promise<SearchResult[]> {
  const toolNames = await listToolsInternal(bearer);
  const toolName = toolNames.includes("search")
    ? "search"
    : toolNames.includes("search_compiled")
      ? "search_compiled"
      : null;

  if (!toolName) {
    throw new WrapperError("protocol", "Wrapper search tool is unavailable.");
  }

  const payload = await callTool(toolName, { query }, bearer);
  return normalizeSearchPayload(payload);
}

export async function listBacklinks(slug: string, bearer: string): Promise<BacklinkItem[]> {
  const toolNames = await listToolsInternal(bearer);
  if (!toolNames.includes("list_backlinks")) {
    return [];
  }

  const payload = await callTool("list_backlinks", { slug }, bearer);
  return normalizeBacklinksPayload(payload);
}
