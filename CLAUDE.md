# Personal Wiki MCP Server (lyon)

MCP server + Postgres indexer for the Personal Wiki. Exposes compiled wiki pages to AI agents via hybrid search (keyword + vector + RRF fusion).

## Project structure

```
src/
  cli.ts              # CLI entry point (wiki migrate|sync|search|serve|status)
  core/
    config.ts         # Env var loading and validation (Zod)
    db.ts             # Postgres queries, connection pool, migrations
    indexer.ts        # Scan, chunk, embed, store pipeline
    search.ts         # Hybrid search with RRF fusion + query expansion
    types.ts          # Shared interfaces
  mcp/
    server.ts         # MCP stdio transport setup
    tools.ts          # MCP tool handlers (search_compiled, get_page, get_source, explore_related)
migrations/
  001_initial.sql     # Pages, chunks, tags, links, query_log tables + pgvector/pg_trgm
test/
  fixtures/compiled/  # 3 test wiki pages
  fixtures/raw/       # Raw source fixture
  setup.ts            # In-memory store, deterministic embeddings, test helpers
  *.test.ts           # Unit tests (bun:test)
```

## Development setup

```bash
# Start Postgres with pgvector
docker compose up -d

# Copy and fill in API keys
cp .env.example .env

# Install dependencies
bun install

# Run migrations
bun run migrate

# Index compiled wiki pages
bun run sync

# Start MCP server (stdio transport)
bun run serve
```

Required env vars: `DATABASE_URL`, `OPENAI_API_KEY`. Optional: `ANTHROPIC_API_KEY` (enables LLM chunking), `ENABLE_QUERY_EXPANSION` (default true).

## CLI commands

| Command | Description |
|---------|-------------|
| `wiki migrate` | Run pending SQL migrations |
| `wiki sync` | Index all compiled/ pages into Postgres |
| `wiki search <query>` | Hybrid keyword + vector search |
| `wiki serve` | Start MCP server on stdio |
| `wiki status` | Show index health (page count, chunks, stale pages) |

## Testing

```bash
bun test          # Run all tests (uses in-memory store, no Postgres needed)
bun run typecheck # TypeScript type checking
```

## MCP tools

| Tool | Description |
|------|-------------|
| `search_compiled` | Hybrid keyword + vector search with RRF fusion |
| `get_page` | Fetch full page by slug (exact match, fuzzy fallback) |
| `get_source` | Read raw source file with path traversal protection |
| `explore_related` | BFS traversal of wiki link graph (depth 1-3) |

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
