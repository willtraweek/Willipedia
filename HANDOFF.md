# Personal Wiki MCP Handoff

This document is the integration handoff for `lyon`, the Personal Wiki MCP server and retrieval layer intended to be consumed by ai-orchestration.

## What This Service Is

`lyon` exposes compiled wiki content to agents through an MCP server over stdio.

High-level flow:

1. `wiki sync` scans compiled markdown pages.
2. Pages are chunked, embedded, and indexed into Postgres with `pgvector`.
3. `wiki serve` starts an MCP stdio server.
4. Agents call MCP tools to search pages, fetch full pages, read raw source files, and traverse related links.

Transport:

- MCP over stdio only
- No HTTP server

Primary entrypoint:

- [src/cli.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/cli.ts)

## Runtime Requirements

- Bun `1.3.x`
- PostgreSQL with extensions:
  - `vector`
  - `pg_trgm`
- OpenAI API key
- Optional Anthropic API key

NPM/Bun dependencies are declared in [package.json](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/package.json).

Database schema is declared in [migrations/001_initial.sql](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/migrations/001_initial.sql).

## Environment Contract

Environment loading is defined in [src/core/config.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/core/config.ts).

Required:

- `DATABASE_URL`
- `OPENAI_API_KEY`

Optional:

- `ANTHROPIC_API_KEY`
- `COMPILED_PATH`
- `RAW_PATH`
- `ENABLE_QUERY_EXPANSION`
- `PIPELINE_VERSION`
- `EMBEDDING_MODEL`
- `ANTHROPIC_MODEL`

Current defaults:

- `COMPILED_PATH=../compiled`
- `RAW_PATH=../raw`
- `ENABLE_QUERY_EXPANSION=true`
- `PIPELINE_VERSION=v1-3large-1536-haiku`
- `EMBEDDING_MODEL=text-embedding-3-large`
- `ANTHROPIC_MODEL=claude-3-5-haiku-latest`

Recommended values for this repo as it exists today:

- `COMPILED_PATH=Clippings`
- `RAW_PATH=raw`

Important integration note:

- The current config loader is fail-fast and requires `OPENAI_API_KEY` at process start for all CLI commands, including `migrate`, `status`, and `serve`.
- If ai-orchestration wants to run the service at all, it should always inject a real `OPENAI_API_KEY`.

Reference template:

- [.env.example](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/.env.example)

## Startup Sequence

From repo root:

```bash
bun install
bun run src/cli.ts migrate
bun run src/cli.ts sync
bun run src/cli.ts serve
```

Equivalent package scripts:

```bash
bun run migrate
bun run sync
bun run serve
```

Recommended operational order:

1. Run `migrate` once per environment or deploy.
2. Run `sync` whenever compiled content changes.
3. Keep `serve` running as the MCP endpoint for agents.

Useful additional command:

```bash
bun run src/cli.ts status
```

## CLI Contract

Supported commands:

- `wiki migrate`
- `wiki sync`
- `wiki search <query>`
- `wiki serve`
- `wiki status`

Behavior:

- `migrate` applies SQL migrations from `migrations/`
- `sync` indexes compiled markdown into Postgres and prints a diff summary
- `search` runs hybrid retrieval and prints JSON results
- `serve` starts the MCP stdio server
- `status` prints page count, chunk count, last sync time, missing embeddings, and stale pages

## MCP Server Contract

Server bootstrap is in [src/mcp/server.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/mcp/server.ts).

Server identity:

- Name: `lyon-personal-wiki`
- Version: `0.1.0`

Transport:

- `StdioServerTransport`

## Exposed MCP Tools

Tool definitions live in [src/mcp/tools.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/mcp/tools.ts).

### `search_compiled`

Purpose:

- Hybrid search across compiled wiki pages using keyword search plus vector retrieval

Input:

```json
{
  "query": "string",
  "limit": 8
}
```

Notes:

- `query` is required and must be non-empty
- `limit` is optional, integer, min `1`, max `20`
- Returns ranked page-level results with `slug`, `title`, `snippet`, `score`, `chunkIndex`, `matchedBy`, and `sourceQueries`

### `get_page`

Purpose:

- Fetch a full compiled page by exact slug, with fuzzy fallback via trigram similarity

Input:

```json
{
  "slug": "string"
}
```

Notes:

- Exact slug is attempted first
- Fuzzy fallback threshold is `0.3`
- Returns full page content, frontmatter, tags, outgoing links, freshness/confidence, and timestamps

### `get_source`

Purpose:

- Read a raw source document from under `raw/`

Input:

```json
{
  "path": "string"
}
```

Notes:

- Path traversal is blocked
- Symlink escapes outside `raw/` are blocked
- This tool only works if `RAW_PATH` points at a populated raw-content directory

### `explore_related`

Purpose:

- Traverse related pages using stored wiki links

Input:

```json
{
  "slug": "string",
  "depth": 2,
  "limit": 20
}
```

Notes:

- Exact slug with fuzzy fallback on the starting page
- Breadth-first traversal
- Max depth `3`
- Max limit `50`
- Uses a visited set to avoid cycles

## Retrieval Behavior

Search implementation is in [src/core/search.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/core/search.ts).

Current behavior:

- Chunk-level full-text search
- Vector similarity search over embeddings
- Reciprocal Rank Fusion with `k=60`
- Optional multi-query expansion through Anthropic
- Results collapsed back to page level

If `ANTHROPIC_API_KEY` is absent:

- Search still works
- Query expansion falls back to no expansion
- Chunking falls back to recursive markdown chunking

## Indexing Behavior

Indexer implementation is in [src/core/indexer.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/core/indexer.ts).

Current behavior:

- Tolerant markdown ingestion from `COMPILED_PATH`
- YAML frontmatter is optional
- Missing metadata is derived when possible
- Dual hash strategy:
  - `body_hash` drives re-chunk/re-embed
  - `metadata_hash` allows metadata-only updates
- `pipeline_version` forces re-index when retrieval settings change
- Deleted pages are pruned from the database
- Dedup candidates are reported after sync using average page embeddings

## Data Model

Main public tables:

- `pages`
- `chunks`
- `tags`
- `links`
- `query_log`
- `schema_migrations`

Important operational fields:

- `pages.pipeline_version`
- `pages.body_hash`
- `pages.metadata_hash`
- `chunks.embedding`
- `chunks.fts_content`

## Query Logging

Tool invocations write fire-and-forget rows to `query_log`.

Logged fields:

- tool name
- user question/input
- result count
- result payload preview
- duration

Payloads are capped to roughly 32 KB before insertion.

This table is intended to be useful later for retrieval quality review and curator workflows.

## Current Repo-Specific Content Assumptions

Today, this repo includes compiled content under `Clippings/`.

That means the easiest working configuration is:

```bash
export COMPILED_PATH=Clippings
```

The repo does not currently ship a populated `raw/` directory, so `get_source` will only be useful if ai-orchestration also provisions raw source files and points `RAW_PATH` at them.

## Verification Status

Verified locally:

- `bun run typecheck`
- `bun test`
- `wiki migrate` against a real PostgreSQL 18 instance with `pgvector`
- `wiki status` against that database
- `wiki serve` startup on stdio

Not verified end-to-end in this repo:

- `wiki sync` against a live OpenAI embedding call
- `wiki search` against a live indexed production-sized corpus

Reason:

- no real `OPENAI_API_KEY` was available in the shell during verification

## Recommended ai-orchestration Integration

Minimum integration:

1. Provision PostgreSQL with `pgvector` and `pg_trgm`.
2. Inject `DATABASE_URL` and `OPENAI_API_KEY`.
3. Set `COMPILED_PATH=Clippings` for this repo unless the compiled wiki is moved elsewhere.
4. Optionally inject `ANTHROPIC_API_KEY` for better chunking and query expansion.
5. Run `wiki migrate`.
6. Run `wiki sync`.
7. Launch `wiki serve` as the MCP subprocess.
8. Register the stdio MCP endpoint in ai-orchestration.

If ai-orchestration wants raw-source retrieval too:

1. Provision a real raw document directory.
2. Set `RAW_PATH` explicitly.
3. Ensure requested `get_source` paths stay under that root.

## Files To Read If Something Breaks

- [src/cli.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/cli.ts)
- [src/core/config.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/core/config.ts)
- [src/core/db.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/core/db.ts)
- [src/core/indexer.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/core/indexer.ts)
- [src/core/search.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/core/search.ts)
- [src/mcp/server.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/mcp/server.ts)
- [src/mcp/tools.ts](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/src/mcp/tools.ts)
- [migrations/001_initial.sql](/Users/willtraweek/conductor/workspaces/Personal-Wiki/lyon/migrations/001_initial.sql)
