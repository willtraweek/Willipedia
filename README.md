# Willipedia

`Willipedia` turns source URLs and existing wiki pages into an agent-searchable knowledge base.

It does three jobs:

- `willipedia brain ...` compiles source URLs into durable markdown pages under `Clippings/`
- `willipedia sync`, `willipedia search`, and `willipedia status` maintain and inspect the Postgres retrieval index
- `willipedia serve` exposes the indexed wiki to agents over MCP stdio

## Quickstart

```bash
docker compose up -d
cp .env.example .env
bun install

bun run migrate
bun run src/cli.ts brain schema
bun run src/cli.ts brain ingest https://example.com/post
bun run serve
```

`DATABASE_URL` and `OPENAI_API_KEY` are required for every command except `willipedia brain schema`.

`ANTHROPIC_API_KEY` is optional. Without it, the compiler falls back to heuristic entity extraction, routing, and page drafting; retrieval still works with recursive chunking and no query expansion.

## CLI Surface

| Command | Purpose |
| --- | --- |
| `willipedia brain schema` | Read category routing instructions from `Clippings/*/README.md` |
| `willipedia brain ingest <url>` | Fetch one source URL, compile wiki pages, and reindex |
| `willipedia brain ingest --batch <file>` | Ingest a newline-delimited URL batch with concurrency 3 |
| `willipedia brain drain [--limit=20]` | Process queued ingests that were deferred by domain quotas |
| `willipedia migrate` | Apply SQL migrations |
| `willipedia sync` | Reindex manual changes under `COMPILED_PATH` |
| `willipedia search <query>` | Run hybrid keyword + vector retrieval |
| `willipedia serve` | Start the MCP stdio server |
| `willipedia status` | Show page count, chunk count, stale pages, and embedding health |

## Repo-Specific Assumptions

- `.env.example` sets `COMPILED_PATH=Clippings` and `RAW_PATH=raw` for this repo
- The compiler does not populate `RAW_PATH` today
- `Clippings/people/README.md`, `Clippings/concepts/README.md`, and `Clippings/sources/README.md` are routing schema, not normal content pages
- Supported source formats today are article HTML and YouTube videos with captions
- `rate-limits.json` controls per-domain compiler throttling and powers `willipedia brain drain`

## Project Layout

```text
src/
  brain/        compiler, routing, source handlers, quotas, provenance helpers
  core/         config, database, indexing, search, shared types
  mcp/          MCP server bootstrap and tool registration
Clippings/
  people/       durable person pages + schema README
  concepts/     durable concept pages + schema README
  sources/      provenance pages + schema README
migrations/
  001_initial.sql
  002_brain.sql
test/
  brain-*.test.ts
  cli.test.ts
  fixtures/
```
