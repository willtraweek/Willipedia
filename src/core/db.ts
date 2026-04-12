import fs from "node:fs/promises";
import path from "node:path";

import { Pool, type PoolClient } from "pg";
import pgvector from "pgvector/pg";

import type {
  AppConfig,
  IndexedChunk,
  IndexerStore,
  IndexerTransaction,
  PageEmbeddingRecord,
  PageRecord,
  PageSnapshot,
  PageSummary,
  QueryLogEntry,
  SearchCandidate,
  SearchStore,
  StatusSnapshot,
  StatusStore,
  ToolStore,
  UpsertPageInput,
} from "./types";

type Queryable = Pool | PoolClient;

export class WikiDatabase implements IndexerStore, SearchStore, ToolStore, StatusStore {
  readonly pool: Pool;
  readonly config: AppConfig;

  private vectorTypesReady: Promise<void> | null = null;

  constructor(config: AppConfig, pool?: Pool) {
    this.config = config;
    this.pool =
      pool ??
      new Pool({
        connectionString: config.databaseUrl,
      });

    this.vectorTypesReady = this.registerVectorTypes();
  }

  private async registerVectorTypes(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await tryRegisterVectorTypes(client);
    } finally {
      client.release();
    }

    this.pool.on("connect", async (client) => {
      try {
        await tryRegisterVectorTypes(client);
      } catch (error) {
        console.error("Failed to register pgvector types:", error);
      }
    });
  }

  async ensureReady(): Promise<void> {
    if (this.vectorTypesReady) {
      await this.vectorTypesReady;
      this.vectorTypesReady = null;
    }
  }

  async query<T extends Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, values);
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async runMigrations(
    migrationsDir = path.resolve(this.config.projectRoot, "migrations"),
  ): Promise<string[]> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await this.pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(appliedRows.rows.map((row) => row.version));
    const filenames = (await fs.readdir(migrationsDir))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    const executed: string[] = [];

    for (const filename of filenames) {
      if (applied.has(filename)) {
        continue;
      }

      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(await fs.readFile(path.join(migrationsDir, filename), "utf8"));
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
          [filename],
        );
        await client.query("COMMIT");
        executed.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return executed;
  }

  async withTransaction<T>(
    callback: (tx: IndexerTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const tx = new PgIndexerTransaction(client);
      const result = await callback(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPageSnapshot(slug: string): Promise<PageSnapshot | null> {
    const result = await this.pool.query<PageSnapshot>(
      `
        SELECT id, slug, title, body_hash AS "bodyHash",
               metadata_hash AS "metadataHash",
               pipeline_version AS "pipelineVersion"
        FROM pages
        WHERE slug = $1
      `,
      [slug],
    );

    return result.rows[0] ?? null;
  }

  async deletePagesNotInSlugs(slugs: string[]): Promise<string[]> {
    if (slugs.length === 0) {
      return [];
    }

    const result = await this.pool.query<{ slug: string }>(
      `
        DELETE FROM pages
        WHERE NOT (slug = ANY($1::text[]))
        RETURNING slug
      `,
      [slugs],
    );

    return result.rows.map((row) => row.slug);
  }

  async listPageEmbeddings(): Promise<PageEmbeddingRecord[]> {
    const result = await this.pool.query<{ slug: string; embedding: unknown }>(
      `
        SELECT p.slug, avg(c.embedding) AS embedding
        FROM pages p
        JOIN chunks c ON c.page_id = p.id
        WHERE c.embedding IS NOT NULL
        GROUP BY p.slug
      `,
    );

    return result.rows
      .map((row) => ({
        slug: row.slug,
        embedding: parseVector(row.embedding),
      }))
      .filter((row) => row.embedding.length > 0);
  }

  async searchKeyword(query: string, limit: number): Promise<SearchCandidate[]> {
    const result = await this.pool.query<KeywordRow>(
      `
        SELECT
          c.id AS "chunkId",
          c.page_id AS "pageId",
          p.slug,
          p.title,
          c.content,
          c.chunk_index AS "chunkIndex",
          ts_rank_cd(
            to_tsvector('english', c.fts_content),
            websearch_to_tsquery('english', $1)
          ) AS score
        FROM chunks c
        JOIN pages p ON p.id = c.page_id
        WHERE to_tsvector('english', c.fts_content) @@ websearch_to_tsquery('english', $1)
        ORDER BY score DESC, p.updated_at DESC
        LIMIT $2
      `,
      [query, limit],
    );

    return result.rows.map((row) => ({
      ...row,
      score: Number(row.score),
      matchedBy: "keyword",
    }));
  }

  async searchVector(embedding: number[], limit: number): Promise<SearchCandidate[]> {
    const result = await this.pool.query<VectorRow>(
      `
        SELECT
          c.id AS "chunkId",
          c.page_id AS "pageId",
          p.slug,
          p.title,
          c.content,
          c.chunk_index AS "chunkIndex",
          1 - (c.embedding <=> $1) AS score
        FROM chunks c
        JOIN pages p ON p.id = c.page_id
        WHERE c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $1
        LIMIT $2
      `,
      [pgvector.toSql(embedding), limit],
    );

    return result.rows.map((row) => ({
      ...row,
      score: Number(row.score),
      matchedBy: "vector",
    }));
  }

  async getPageBySlug(slug: string): Promise<PageRecord | null> {
    const result = await this.pool.query<PageRecordRow>(
      `
        SELECT
          p.slug,
          p.title,
          p.content,
          p.frontmatter,
          p.freshness,
          p.confidence,
          p.created_at AS "createdAt",
          p.updated_at AS "updatedAt",
          COALESCE(array_agg(DISTINCT t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags,
          COALESCE(
            array_agg(DISTINCT l.target_slug) FILTER (WHERE l.target_slug IS NOT NULL),
            '{}'
          ) AS "outgoingLinks"
        FROM pages p
        LEFT JOIN tags t ON t.page_id = p.id
        LEFT JOIN links l ON l.source_page_id = p.id
        WHERE p.slug = $1
        GROUP BY p.id
      `,
      [slug],
    );

    const row = result.rows[0];
    return row ? pageRecordFromRow(row) : null;
  }

  async findBestPageMatch(
    input: string,
    threshold: number,
  ): Promise<PageRecord | null> {
    const result = await this.pool.query<PageRecordRow>(
      `
        SELECT *
        FROM (
          SELECT
            p.slug,
            p.title,
            p.content,
            p.frontmatter,
            p.freshness,
            p.confidence,
            p.created_at AS "createdAt",
            p.updated_at AS "updatedAt",
            COALESCE(array_agg(DISTINCT t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags,
            COALESCE(
              array_agg(DISTINCT l.target_slug) FILTER (WHERE l.target_slug IS NOT NULL),
              '{}'
            ) AS "outgoingLinks",
            GREATEST(similarity(p.slug, $1), similarity(p.title, $1)) AS match_score
          FROM pages p
          LEFT JOIN tags t ON t.page_id = p.id
          LEFT JOIN links l ON l.source_page_id = p.id
          GROUP BY p.id
        ) ranked
        WHERE ranked.match_score >= $2
        ORDER BY ranked.match_score DESC, ranked.updatedAt DESC
        LIMIT 1
      `,
      [input, threshold],
    );

    const row = result.rows[0];
    return row ? pageRecordFromRow(row) : null;
  }

  async getOutgoingLinks(slug: string): Promise<string[]> {
    const result = await this.pool.query<{ target_slug: string }>(
      `
        SELECT l.target_slug
        FROM links l
        JOIN pages p ON p.id = l.source_page_id
        WHERE p.slug = $1
      `,
      [slug],
    );

    return result.rows.map((row) => row.target_slug);
  }

  async getPagesBySlugs(slugs: string[]): Promise<PageSummary[]> {
    if (slugs.length === 0) {
      return [];
    }

    const result = await this.pool.query<PageSummary>(
      `
        SELECT slug, title
        FROM pages
        WHERE slug = ANY($1::text[])
      `,
      [slugs],
    );

    return result.rows;
  }

  async insertQueryLog(entry: QueryLogEntry): Promise<void> {
    const cappedJson = capResultsJson(entry.resultsJson);

    await this.pool.query(
      `
        INSERT INTO query_log (
          tool_used,
          question,
          results_count,
          results_json,
          duration_ms
        ) VALUES ($1, $2, $3, $4::jsonb, $5)
      `,
      [
        entry.toolUsed,
        entry.question,
        entry.resultsCount,
        JSON.stringify(cappedJson),
        entry.durationMs,
      ],
    );
  }

  async getStatusSnapshot(
    currentPipelineVersion: string,
  ): Promise<StatusSnapshot> {
    const result = await this.pool.query<StatusRow>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM pages) AS "pageCount",
          (SELECT COUNT(*)::int FROM chunks) AS "chunkCount",
          (
            SELECT to_char(MAX(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            FROM pages
          ) AS "lastSyncAt",
          (SELECT COUNT(*)::int FROM chunks WHERE embedding IS NULL) AS "missingEmbeddings",
          (
            SELECT COUNT(*)::int
            FROM pages p
            WHERE p.pipeline_version <> $1
               OR NOT EXISTS (SELECT 1 FROM chunks c WHERE c.page_id = p.id)
               OR EXISTS (
                 SELECT 1
                 FROM chunks c
                 WHERE c.page_id = p.id
                   AND c.embedding IS NULL
               )
          ) AS "stalePages"
      `,
      [currentPipelineVersion],
    );

    const row = result.rows[0];
    if (!row) {
      return {
        pageCount: 0,
        chunkCount: 0,
        lastSyncAt: null,
        missingEmbeddings: 0,
        stalePages: 0,
      };
    }

    return row;
  }
}

class PgIndexerTransaction implements IndexerTransaction {
  constructor(private readonly client: PoolClient) {}

  async upsertPage(page: UpsertPageInput): Promise<number> {
    const result = await this.client.query<{ id: number }>(
      `
        INSERT INTO pages (
          slug,
          title,
          content,
          frontmatter,
          body_hash,
          metadata_hash,
          pipeline_version,
          freshness,
          confidence
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          frontmatter = EXCLUDED.frontmatter,
          body_hash = EXCLUDED.body_hash,
          metadata_hash = EXCLUDED.metadata_hash,
          pipeline_version = EXCLUDED.pipeline_version,
          freshness = EXCLUDED.freshness,
          confidence = EXCLUDED.confidence,
          updated_at = now()
        RETURNING id
      `,
      [
        page.slug,
        page.title,
        page.content,
        JSON.stringify(page.frontmatter),
        page.bodyHash,
        page.metadataHash,
        page.pipelineVersion,
        page.freshness,
        page.confidence,
      ],
    );

    return result.rows[0]!.id;
  }

  async replaceChunks(pageId: number, chunks: IndexedChunk[]): Promise<void> {
    await this.client.query("DELETE FROM chunks WHERE page_id = $1", [pageId]);

    for (const chunk of chunks) {
      await this.client.query(
        `
          INSERT INTO chunks (
            page_id,
            chunk_index,
            content,
            fts_content,
            embedding
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [
          pageId,
          chunk.chunkIndex,
          chunk.content,
          chunk.ftsContent,
          chunk.embedding ? pgvector.toSql(chunk.embedding) : null,
        ],
      );
    }
  }

  async replaceTags(pageId: number, tags: string[]): Promise<void> {
    await this.client.query("DELETE FROM tags WHERE page_id = $1", [pageId]);

    for (const tag of uniqueStrings(tags)) {
      await this.client.query(
        "INSERT INTO tags (page_id, tag) VALUES ($1, $2) ON CONFLICT (page_id, tag) DO NOTHING",
        [pageId, tag],
      );
    }
  }

  async replaceLinks(pageId: number, links: string[]): Promise<void> {
    await this.client.query("DELETE FROM links WHERE source_page_id = $1", [pageId]);

    for (const link of uniqueStrings(links)) {
      await this.client.query(
        `
          INSERT INTO links (source_page_id, target_slug, link_type)
          VALUES ($1, $2, 'related')
        `,
        [pageId, link],
      );
    }
  }

  async refreshChunkSearchContent(pageId: number, title: string): Promise<void> {
    await this.client.query(
      `
        UPDATE chunks
        SET fts_content = CONCAT($2, E'\\n\\n', content)
        WHERE page_id = $1
      `,
      [pageId, title],
    );
  }
}

type KeywordRow = {
  chunkId: number;
  pageId: number;
  slug: string;
  title: string;
  content: string;
  chunkIndex: number;
  score: number | string;
};

type VectorRow = KeywordRow;

type PageRecordRow = {
  slug: string;
  title: string;
  content: string;
  frontmatter: unknown;
  freshness: string | null;
  confidence: string | null;
  tags: string[] | null;
  outgoingLinks: string[] | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type StatusRow = StatusSnapshot;

function pageRecordFromRow(row: PageRecordRow): PageRecord {
  return {
    slug: row.slug,
    title: row.title,
    content: row.content,
    frontmatter: normalizeFrontmatter(row.frontmatter),
    freshness: row.freshness,
    confidence: row.confidence,
    tags: uniqueStrings(row.tags ?? []),
    outgoingLinks: uniqueStrings(row.outgoingLinks ?? []),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function normalizeFrontmatter(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
      return [];
    }

    return trimmed
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => Number(entry));
  }

  return [];
}

function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function capResultsJson(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 32 * 1024) {
    return value;
  }

  return {
    truncated: true,
    originalSize: serialized.length,
    preview: serialized.slice(0, 32 * 1024),
  };
}

export function buildQueryLogInsert(
  toolUsed: string,
  question: string,
  resultsJson: unknown,
  resultsCount: number,
  durationMs: number,
): QueryLogEntry {
  return {
    toolUsed,
    question,
    resultsJson,
    resultsCount,
    durationMs,
  };
}

export async function ensureVectorTypes(client: Queryable): Promise<void> {
  if ("connect" in client) {
    const pool = client as Pool;
    const connection = await pool.connect();
    try {
      await tryRegisterVectorTypes(connection);
    } finally {
      connection.release();
    }
    return;
  }

  await tryRegisterVectorTypes(client as PoolClient);
}

export const dbInternals = {
  capResultsJson,
  parseVector,
};

async function tryRegisterVectorTypes(client: PoolClient): Promise<void> {
  try {
    await pgvector.registerTypes(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("vector type not found")) {
      return;
    }

    throw error;
  }
}
