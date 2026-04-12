import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recursiveChunkMarkdown } from "../src/core/indexer";
import type {
  AppConfig,
  EmbeddingProvider,
  IndexedChunk,
  IndexerStore,
  IndexerTransaction,
  PageEmbeddingRecord,
  PageRecord,
  PageSnapshot,
  PageSummary,
  QueryExpansionProvider,
  QueryLogEntry,
  SearchCandidate,
  SearchStore,
  StatusSnapshot,
  StatusStore,
  ToolStore,
  UpsertPageInput,
} from "../src/core/types";

type StoredPage = UpsertPageInput & {
  id: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  links: string[];
  chunks: IndexedChunk[];
};

export async function createFixtureWorkspace(): Promise<{
  rootDir: string;
  compiledDir: string;
  rawDir: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "lyon-wiki-"));
  const compiledDir = path.join(rootDir, "compiled");
  const rawDir = path.join(rootDir, "raw");

  await copyDirectory(
    path.resolve(process.cwd(), "test/fixtures/compiled"),
    compiledDir,
  );
  await copyDirectory(path.resolve(process.cwd(), "test/fixtures/raw"), rawDir);

  return { rootDir, compiledDir, rawDir };
}

export function createTestConfig(paths: {
  rootDir: string;
  compiledDir: string;
  rawDir: string;
}): AppConfig {
  return {
    projectRoot: paths.rootDir,
    databaseUrl: "postgresql://wiki:wiki@localhost:5432/wiki_test",
    openAiApiKey: "test-openai-key",
    anthropicApiKey: "test-anthropic-key",
    compiledPath: paths.compiledDir,
    rawPath: paths.rawDir,
    enableQueryExpansion: true,
    pipelineVersion: "v1-3large-1536-haiku",
    embeddingModel: "text-embedding-3-large",
    embeddingDimensions: 1536,
    anthropicModel: "claude-3-5-haiku-latest",
  };
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 1536) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => embedText(text, this.dimensions));
  }
}

export class RecursiveChunkingProvider {
  async chunk(page: { body: string }): Promise<string[]> {
    return recursiveChunkMarkdown(page.body, 320, 40);
  }
}

export class StaticExpansionProvider implements QueryExpansionProvider {
  constructor(private readonly expansionsByQuery: Record<string, string[]> = {}) {}

  async expand(query: string): Promise<string[]> {
    return this.expansionsByQuery[query] ?? [];
  }
}

export class InMemoryWikiStore
  implements IndexerStore, SearchStore, ToolStore, StatusStore
{
  private pages = new Map<string, StoredPage>();
  private nextId = 1;
  readonly queryLog: QueryLogEntry[] = [];

  async getPageSnapshot(slug: string): Promise<PageSnapshot | null> {
    const page = this.pages.get(slug);
    if (!page) {
      return null;
    }

    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      bodyHash: page.bodyHash,
      metadataHash: page.metadataHash,
      pipelineVersion: page.pipelineVersion,
    };
  }

  async withTransaction<T>(callback: (tx: IndexerTransaction) => Promise<T>): Promise<T> {
    const draft = clonePages(this.pages);
    const tx = new InMemoryTransaction(draft, () => this.nextId++);
    const result = await callback(tx);
    this.pages = draft;
    return result;
  }

  async deletePagesNotInSlugs(slugs: string[]): Promise<string[]> {
    const allowed = new Set(slugs);
    const deleted: string[] = [];

    for (const slug of this.pages.keys()) {
      if (!allowed.has(slug)) {
        this.pages.delete(slug);
        deleted.push(slug);
      }
    }

    return deleted.sort();
  }

  async listPageEmbeddings(): Promise<PageEmbeddingRecord[]> {
    const embeddings: PageEmbeddingRecord[] = [];

    for (const page of this.pages.values()) {
      const vectors = page.chunks
        .map((chunk) => chunk.embedding)
        .filter((embedding): embedding is number[] => Array.isArray(embedding));
      if (vectors.length === 0) {
        continue;
      }

      embeddings.push({
        slug: page.slug,
        embedding: averageVectors(vectors),
      });
    }

    return embeddings;
  }

  async searchKeyword(query: string, limit: number): Promise<SearchCandidate[]> {
    const terms = tokenize(query);
    const hits: SearchCandidate[] = [];

    for (const page of this.pages.values()) {
      for (const chunk of page.chunks) {
        const haystack = chunk.ftsContent.toLowerCase();
        const score = terms.reduce(
          (total, term) => total + countOccurrences(haystack, term),
          0,
        );

        if (score === 0) {
          continue;
        }

        hits.push({
          chunkId: page.id * 1000 + chunk.chunkIndex,
          pageId: page.id,
          slug: page.slug,
          title: page.title,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          score,
          matchedBy: "keyword",
        });
      }
    }

    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  async searchVector(embedding: number[], limit: number): Promise<SearchCandidate[]> {
    const hits: SearchCandidate[] = [];

    for (const page of this.pages.values()) {
      for (const chunk of page.chunks) {
        if (!chunk.embedding) {
          continue;
        }

        hits.push({
          chunkId: page.id * 1000 + chunk.chunkIndex,
          pageId: page.id,
          slug: page.slug,
          title: page.title,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          score: cosineSimilarity(embedding, chunk.embedding),
          matchedBy: "vector",
        });
      }
    }

    return hits.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  async getPageBySlug(slug: string): Promise<PageRecord | null> {
    const page = this.pages.get(slug);
    return page ? toPageRecord(page) : null;
  }

  async findBestPageMatch(input: string, threshold: number): Promise<PageRecord | null> {
    const normalized = input.toLowerCase();
    let best: StoredPage | null = null;
    let bestScore = 0;

    for (const page of this.pages.values()) {
      const score = stringSimilarity(
        normalized,
        `${page.slug} ${page.title}`.toLowerCase(),
      );
      if (score > bestScore) {
        best = page;
        bestScore = score;
      }
    }

    return best && bestScore >= threshold ? toPageRecord(best) : null;
  }

  async getOutgoingLinks(slug: string): Promise<string[]> {
    return [...(this.pages.get(slug)?.links ?? [])];
  }

  async getPagesBySlugs(slugs: string[]): Promise<PageSummary[]> {
    return slugs
      .map((slug) => this.pages.get(slug))
      .filter((page): page is StoredPage => page !== undefined)
      .map((page) => ({ slug: page.slug, title: page.title }));
  }

  async insertQueryLog(entry: QueryLogEntry): Promise<void> {
    this.queryLog.push(entry);
  }

  async getStatusSnapshot(currentPipelineVersion: string): Promise<StatusSnapshot> {
    const pages = Array.from(this.pages.values());
    const chunks = pages.flatMap((page) => page.chunks);

    return {
      pageCount: pages.length,
      chunkCount: chunks.length,
      lastSyncAt:
        pages.length > 0
          ? pages
              .map((page) => page.updatedAt)
              .sort()
              .at(-1) ?? null
          : null,
      missingEmbeddings: chunks.filter((chunk) => chunk.embedding === null).length,
      stalePages: pages.filter((page) => page.pipelineVersion !== currentPipelineVersion)
        .length,
    };
  }
}

class InMemoryTransaction implements IndexerTransaction {
  constructor(
    private readonly pages: Map<string, StoredPage>,
    private readonly nextId: () => number,
  ) {}

  async upsertPage(page: UpsertPageInput): Promise<number> {
    const existing = this.pages.get(page.slug);
    const timestamp = new Date().toISOString();
    const stored: StoredPage = {
      ...page,
      id: existing?.id ?? this.nextId(),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      tags: existing?.tags ?? [],
      links: existing?.links ?? [],
      chunks: existing?.chunks ?? [],
    };
    this.pages.set(page.slug, stored);
    return stored.id;
  }

  async replaceChunks(pageId: number, chunks: IndexedChunk[]): Promise<void> {
    const page = findPageById(this.pages, pageId);
    page.chunks = chunks.map(cloneChunk);
  }

  async replaceTags(pageId: number, tags: string[]): Promise<void> {
    const page = findPageById(this.pages, pageId);
    page.tags = Array.from(new Set(tags));
  }

  async replaceLinks(pageId: number, links: string[]): Promise<void> {
    const page = findPageById(this.pages, pageId);
    page.links = Array.from(new Set(links));
  }

  async refreshChunkSearchContent(pageId: number, title: string): Promise<void> {
    const page = findPageById(this.pages, pageId);
    page.title = title;
    page.chunks = page.chunks.map((chunk) => ({
      ...cloneChunk(chunk),
      ftsContent: `${title}\n\n${chunk.content}`,
    }));
  }
}

function findPageById(pages: Map<string, StoredPage>, pageId: number): StoredPage {
  for (const page of pages.values()) {
    if (page.id === pageId) {
      return page;
    }
  }

  throw new Error(`Page not found for id ${pageId}`);
}

function toPageRecord(page: StoredPage): PageRecord {
  return {
    slug: page.slug,
    title: page.title,
    content: page.content,
    frontmatter: page.frontmatter,
    freshness: page.freshness,
    confidence: page.confidence,
    tags: [...page.tags],
    outgoingLinks: [...page.links],
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

function clonePages(source: Map<string, StoredPage>): Map<string, StoredPage> {
  return new Map(
    Array.from(source.entries()).map(([slug, page]) => [
      slug,
      {
        ...page,
        frontmatter: { ...page.frontmatter },
        tags: [...page.tags],
        links: [...page.links],
        chunks: page.chunks.map(cloneChunk),
      },
    ]),
  );
}

function cloneChunk(chunk: IndexedChunk): IndexedChunk {
  return {
    ...chunk,
    embedding: chunk.embedding ? [...chunk.embedding] : null,
  };
}

function averageVectors(vectors: number[][]): number[] {
  const size = vectors[0]?.length ?? 0;
  const output = new Array<number>(size).fill(0);

  for (const vector of vectors) {
    vector.forEach((value, index) => {
      output[index] = (output[index] ?? 0) + value;
    });
  }

  return output.map((value) => value / vectors.length);
}

function embedText(input: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);

  for (const token of tokenize(input)) {
    const index = hashToken(token) % dimensions;
    vector[index] = (vector[index] ?? 0) + 1;
  }

  return vector;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function countOccurrences(input: string, term: string): number {
  if (!term) {
    return 0;
  }

  return input.split(term).length - 1;
}

function hashToken(token: string): number {
  let hash = 0;
  for (const char of token) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function stringSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  const union = new Set([...leftTokens, ...rightTokens]);
  let intersection = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return union.size === 0 ? 0 : intersection / union.size;
}

async function copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}
