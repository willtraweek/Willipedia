# Willipedia

This repo compiles source material into wiki pages, indexes the result in Postgres, and serves it to agents over MCP stdio.

## Working Commands

```bash
bun run migrate
bun run sync
bun run search -- "karpathy"
bun run serve
bun run src/cli.ts brain schema
bun run src/cli.ts brain ingest https://example.com/post
bun run src/cli.ts brain drain --limit=10
```

`willipedia brain schema` is the only command that does not construct the runtime.
Everything else goes through `loadConfig()` and requires `DATABASE_URL` plus `OPENAI_API_KEY`.

## Repo Map

```text
src/
  cli.ts         top-level CLI dispatch
  brain/         compiler, source handlers, routing schema, quotas
  core/          config, database, indexing, search, shared types
  mcp/           MCP server bootstrap and tool handlers
Clippings/
  people/README.md
  concepts/README.md
  sources/README.md
migrations/
  001_initial.sql
  002_brain.sql
test/
  brain-*.test.ts
  cli.test.ts
  setup.ts
```

## Repo-Specific Rules

- Treat `Clippings/*/README.md` as compiler routing schema. They are not content pages, and the indexer intentionally skips them.
- The compiler supports `article` and `youtube` sources only.
- `willipedia brain ingest` and `willipedia brain drain` already run migrations and reindex after they finish. `willipedia sync` is mainly for manual edits or external writers touching `COMPILED_PATH`.
- Existing entity pages are not body-overwritten during ingest. The compiler only appends new provenance URLs to `sources:` frontmatter and writes a separate page under `Clippings/sources/`.
- `RAW_PATH` is only used by the MCP `get_source` tool. The compiler does not persist fetched raw payloads there today.
- Domain throttling lives in `rate-limits.json`. When a domain exceeds quota, the compiler records a row in `pending_ingests` for later `willipedia brain drain`.
- `ANTHROPIC_API_KEY` is optional. Missing Anthropic falls back to heuristics for compiler output and to non-expanded/recursive retrieval behavior.

## MCP Surface

- `search_compiled`: hybrid keyword + vector retrieval with reciprocal-rank fusion
- `get_page`: exact slug lookup with fuzzy fallback
- `get_source`: bounded raw-file access under `RAW_PATH`
- `explore_related`: breadth-first traversal of stored wiki links

## Skill Routing

When the user's request matches an available skill, invoke that skill first instead of answering ad hoc.

Key routing rules:

- Product ideas, "is this worth building", brainstorming -> `office-hours`
- Bugs, errors, unexpected behavior -> `investigate`
- Ship, deploy, push, create PR -> `ship`
- QA, test the site, find bugs -> `qa`
- Code review, check my diff -> `review`
- Update docs after shipping -> `document-release`
- Weekly retro -> `retro`
- Design system or brand work -> `design-consultation`
- Visual audit or polish -> `design-review`
- Architecture review -> `plan-eng-review`
