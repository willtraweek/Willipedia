# Willipedia Integration Handoff

This repo ships a compiler-first knowledge pipeline:

1. `willipedia brain ingest` turns a URL into durable wiki pages under `Clippings/`
2. compiler output is reindexed into Postgres with `pgvector` and `pg_trgm`
3. `willipedia serve` exposes the indexed wiki over MCP stdio

The MCP service identity is:

- name: `willipedia`
- version: `0.1.0`

There is no HTTP server. Integration is stdio-only MCP.

## Runtime Contract

- Bun `1.3.x`
- PostgreSQL with `vector` and `pg_trgm`
- required env:
  - `DATABASE_URL`
  - `OPENAI_API_KEY`
- optional env:
  - `ANTHROPIC_API_KEY`
  - `COMPILED_PATH`
  - `RAW_PATH`
  - `ENABLE_QUERY_EXPANSION`
  - `PIPELINE_VERSION`
  - `EMBEDDING_MODEL`
  - `ANTHROPIC_MODEL`

Repo defaults from `.env.example`:

- `COMPILED_PATH=Clippings`
- `RAW_PATH=raw`
- `ENABLE_QUERY_EXPANSION=true`
- `PIPELINE_VERSION=v1-3large-1536-haiku`
- `EMBEDDING_MODEL=text-embedding-3-large`
- `ANTHROPIC_MODEL=claude-3-5-haiku-latest`

Operational caveat:

- `willipedia brain schema` is the only command that can run without DB/API config
- every other command constructs the runtime and will fail fast without both `DATABASE_URL` and `OPENAI_API_KEY`

## Command Contract

Supported CLI surface:

- `willipedia brain schema`
- `willipedia brain ingest <url> [--refresh] [--dry-run]`
- `willipedia brain ingest --batch <file> [--refresh] [--dry-run]`
- `willipedia brain drain [--limit=20]`
- `willipedia migrate`
- `willipedia sync`
- `willipedia search <query>`
- `willipedia serve`
- `willipedia status`

Behavior notes:

- `brain schema` auto-discovers `Clippings/`, then `compiled/`, then `../compiled/` when `COMPILED_PATH` is unset
- `brain ingest` accepts one URL or a newline-delimited batch file; blank lines and `#` comments are ignored
- batch ingest runs with concurrency `3`
- `brain ingest` and `brain drain` both run migrations first and reindex after completion
- `sync` is still needed for manual edits or any writer that bypasses the compiler
- `status` reports page count, chunk count, last sync, missing embeddings, and stale pages

## Compiler Contract

Implementation lives under `src/brain/`.

Current behavior:

- supported source formats: article HTML and YouTube watch/share URLs
- article extraction uses Readability plus HTML-to-markdown normalization
- YouTube extraction reads the watch page, finds caption tracks, and builds a transcript-backed source body
- routing is driven by `Clippings/*/README.md`; those directory READMEs act as MECE schema instructions
- entity reconciliation tries exact slug match, trigram title match, then vector similarity against `entity_embeddings`
- each ingest is guarded by a Postgres advisory lock keyed on the source URL
- duplicate sources are skipped unless `--refresh` is set
- quota overflow records a `pending_ingests` row instead of failing the ingest outright
- every successful ingest writes a provenance page under `Clippings/sources/`
- if the primary page already exists, the compiler preserves the body and only appends new `sources:` frontmatter
- invalid LLM output degrades to a source-only ingest rather than crashing the pipeline

`ANTHROPIC_API_KEY` is optional. Without it, the compiler falls back to heuristic entity extraction, category routing, and distilled page drafting.

## Retrieval Contract

Implementation lives under `src/core/search.ts`, `src/core/indexer.ts`, and `src/mcp/`.

Current behavior:

- chunk-level full-text search plus vector retrieval
- reciprocal-rank fusion with `k=60`
- optional query expansion through Anthropic
- page-level result collapsing with snippets, score, chunk index, and match provenance
- `README.md` files are skipped during indexing so category schema can live beside content
- dual hashes avoid unnecessary work:
  - `body_hash` triggers re-chunk and re-embed
  - `metadata_hash` allows metadata-only page updates

## MCP Tools

- `search_compiled`
  - input: `query`, optional `limit`
  - output: ranked page hits with `slug`, `title`, `snippet`, `score`, `chunkIndex`, `matchedBy`, and `sourceQueries`
- `get_page`
  - input: `slug`
  - behavior: exact slug first, trigram fallback second
- `get_source`
  - input: `path`
  - behavior: bounded raw-file read under `RAW_PATH`; path traversal and symlink escape are blocked
- `explore_related`
  - input: `slug`, optional `depth`, optional `limit`
  - behavior: breadth-first traversal of stored wiki links with cycle protection

## Data Model

Base retrieval tables from `migrations/001_initial.sql`:

- `pages`
- `chunks`
- `tags`
- `links`
- `query_log`
- `schema_migrations`

Compiler tables from `migrations/002_brain.sql`:

- `entity_embeddings`
- `sources`
- `domain_quotas`
- `pending_ingests`

Important operational details:

- `query_log` stores tool name, query text, result count, payload preview, and duration
- `sources` tracks URL-level dedup plus compiled page slugs
- `domain_quotas` and `pending_ingests` back the throttle-and-drain workflow

## Repo-Specific Assumptions

- this repo already stores compiled content under `Clippings/`
- `rate-limits.json` currently throttles YouTube domains
- the compiler does not write fetched raw payloads to `RAW_PATH`, so `get_source` only becomes useful if another process populates that directory

## Recommended Integration Sequence

1. Provision PostgreSQL with `pgvector` and `pg_trgm`.
2. Inject `DATABASE_URL` and `OPENAI_API_KEY`.
3. Set `COMPILED_PATH=Clippings` unless the wiki content moves.
4. Optionally inject `ANTHROPIC_API_KEY`.
5. Run `willipedia migrate`.
6. Run `willipedia brain schema` once to confirm category routing.
7. Run `willipedia brain ingest <url>` or `willipedia brain drain` to compile material.
8. Run `willipedia sync` only for manual edits or non-compiler writers.
9. Launch `willipedia serve` as the MCP subprocess.

## Breakglass Files

- `src/cli.ts`
- `src/brain/compiler.ts`
- `src/brain/pipeline.ts`
- `src/brain/handlers/article.ts`
- `src/brain/handlers/youtube.ts`
- `src/core/config.ts`
- `src/core/db.ts`
- `src/core/indexer.ts`
- `src/core/search.ts`
- `src/mcp/server.ts`
- `src/mcp/tools.ts`
- `migrations/001_initial.sql`
- `migrations/002_brain.sql`
- `rate-limits.json`
