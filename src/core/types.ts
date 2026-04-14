export interface AppConfig {
  projectRoot: string;
  databaseUrl: string;
  openAiApiKey: string;
  anthropicApiKey?: string;
  compiledPath: string;
  rawPath: string;
  enableQueryExpansion: boolean;
  pipelineVersion: string;
  embeddingModel: string;
  embeddingDimensions: number;
  anthropicModel: string;
}

export interface Frontmatter {
  [key: string]: unknown;
}

export interface ScannedPage {
  absolutePath: string;
  relativePath: string;
  slug: string;
  title: string;
  body: string;
  frontmatter: Frontmatter;
  bodyHash: string;
  metadataHash: string;
  freshness: string | null;
  confidence: string | null;
  tags: string[];
  links: string[];
}

export interface IndexedChunk {
  chunkIndex: number;
  content: string;
  ftsContent: string;
  embedding: number[] | null;
}

export interface UpsertPageInput {
  slug: string;
  title: string;
  content: string;
  frontmatter: Frontmatter;
  bodyHash: string;
  metadataHash: string;
  pipelineVersion: string;
  freshness: string | null;
  confidence: string | null;
}

export interface PageSnapshot {
  id: number;
  slug: string;
  title: string;
  bodyHash: string;
  metadataHash: string;
  pipelineVersion: string;
}

export interface PageEmbeddingRecord {
  slug: string;
  embedding: number[];
}

export interface EntityEmbeddingMatch extends PageSummary {
  score: number;
}

export interface DedupPair {
  leftSlug: string;
  rightSlug: string;
  similarity: number;
}

export interface IndexRunCounts {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  metadataOnly: number;
}

export interface IndexRunResult {
  counts: IndexRunCounts;
  deletedSlugs: string[];
  dedupPairs: DedupPair[];
}

export interface SearchCandidate {
  chunkId: number;
  pageId: number;
  slug: string;
  title: string;
  content: string;
  chunkIndex: number;
  score: number;
  matchedBy: "keyword" | "vector";
}

export interface SearchResult {
  slug: string;
  title: string;
  snippet: string;
  score: number;
  chunkIndex: number;
  matchedBy: Array<"keyword" | "vector">;
  sourceQueries: string[];
}

export interface SearchOptions {
  limit?: number;
  enableExpansion?: boolean;
}

export interface PageSummary {
  slug: string;
  title: string;
}

export interface PageRecord extends PageSummary {
  content: string;
  frontmatter: Frontmatter;
  freshness: string | null;
  confidence: string | null;
  tags: string[];
  outgoingLinks: string[];
  createdAt: string;
  updatedAt: string;
}

export interface QueryLogEntry {
  toolUsed: string;
  question: string;
  resultsCount: number;
  resultsJson: unknown;
  durationMs: number;
}

export interface StatusSnapshot {
  pageCount: number;
  chunkCount: number;
  lastSyncAt: string | null;
  missingEmbeddings: number;
  stalePages: number;
}

export type SourceFormat = "article" | "youtube";

export interface SourceRecord {
  url: string;
  format: SourceFormat;
  contentHash: string;
  pageSlugs: string[];
  fetchedAt: string;
  updatedAt: string;
}

export interface SourceRecordInput {
  url: string;
  format: SourceFormat;
  contentHash: string;
  pageSlugs: string[];
}

export interface PendingIngestRecord {
  id: number;
  url: string;
  format: SourceFormat | null;
  queuedAt: string;
  status: string;
  error: string | null;
}

export interface RelatedPage extends PageSummary {
  depth: number;
  incoming: boolean;
  outgoing: boolean;
}

export interface ChunkingProvider {
  chunk(page: Pick<ScannedPage, "title" | "body" | "frontmatter">): Promise<string[]>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface QueryExpansionProvider {
  expand(query: string): Promise<string[]>;
}

export interface IndexerTransaction {
  upsertPage(page: UpsertPageInput): Promise<number>;
  replaceChunks(pageId: number, chunks: IndexedChunk[]): Promise<void>;
  replaceTags(pageId: number, tags: string[]): Promise<void>;
  replaceLinks(pageId: number, links: string[]): Promise<void>;
  refreshChunkSearchContent(pageId: number, title: string): Promise<void>;
}

export interface IndexerStore {
  getPageSnapshot(slug: string): Promise<PageSnapshot | null>;
  withTransaction<T>(callback: (tx: IndexerTransaction) => Promise<T>): Promise<T>;
  deletePagesNotInSlugs(slugs: string[]): Promise<string[]>;
  listPageEmbeddings(): Promise<PageEmbeddingRecord[]>;
}

export interface SearchStore {
  searchKeyword(query: string, limit: number): Promise<SearchCandidate[]>;
  searchVector(embedding: number[], limit: number): Promise<SearchCandidate[]>;
}

export interface ToolStore {
  getPageBySlug(slug: string): Promise<PageRecord | null>;
  findBestPageMatch(input: string, threshold: number): Promise<PageRecord | null>;
  getOutgoingLinks(slug: string): Promise<string[]>;
  getPagesBySlugs(slugs: string[]): Promise<PageSummary[]>;
  insertQueryLog(entry: QueryLogEntry): Promise<void>;
}

export interface CompilerStore {
  getPageBySlug(slug: string): Promise<PageRecord | null>;
  findBestTitleMatch(input: string, threshold: number): Promise<PageRecord | null>;
  searchEntityEmbeddings(
    embedding: number[],
    limit: number,
  ): Promise<EntityEmbeddingMatch[]>;
  upsertSource(source: SourceRecordInput): Promise<SourceRecord>;
  checkSourceExists(url: string): Promise<SourceRecord | null>;
  upsertEntityEmbedding(slug: string, embedding: number[]): Promise<void>;
  checkDomainQuota(domain: string, date: string): Promise<number>;
  incrementDomainQuota(domain: string, date: string): Promise<number>;
  queuePendingIngest(
    url: string,
    format: SourceFormat | null,
  ): Promise<PendingIngestRecord>;
  getPendingIngests(limit?: number): Promise<PendingIngestRecord[]>;
  markIngestComplete(
    id: number,
    status: string,
    error?: string | null,
  ): Promise<void>;
  withSourceLock<T>(
    url: string,
    callback: (store: CompilerStore) => Promise<T>,
  ): Promise<T>;
}

export interface StatusStore {
  getStatusSnapshot(currentPipelineVersion: string): Promise<StatusSnapshot>;
}
