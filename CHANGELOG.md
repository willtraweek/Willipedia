# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1.0] - 2026-04-12

### Added
- **MCP server** with 4 tools over stdio transport: `search_compiled` (hybrid keyword + vector search with RRF fusion), `get_page` (exact slug + fuzzy fallback via pg_trgm), `get_source` (raw file access with path traversal protection), `explore_related` (BFS link graph traversal)
- **Postgres indexer** scans compiled/ markdown files, chunks them with Haiku LLM (recursive fallback), embeds with OpenAI text-embedding-3-large, stores in pgvector
- **CLI** with 5 commands: `wiki migrate`, `wiki sync`, `wiki search`, `wiki serve`, `wiki status`
- **Incremental sync** with dual hashing: body changes trigger re-chunk + re-embed, metadata-only changes skip expensive embedding
- **Query expansion** via Anthropic Haiku for multi-query search (configurable, default on)
- **Semantic dedup detection** flags near-duplicate pages after each sync
- **Query logging** records every MCP tool call for future curator agent analysis
- **Pipeline versioning** triggers full re-index when embedding model or chunker changes
- Postgres schema with pgvector + pg_trgm extensions, pages/chunks/tags/links/query_log tables
- Docker Compose config for local Postgres with pgvector
- 9 unit tests covering indexer, search, CLI, tools, and DB helpers
- CLAUDE.md with project structure, dev setup, CLI commands, and skill routing rules
- TODOS.md with deferred work from planning: automated file watcher (P2), curator agent design (P2), retrieval eval framework (P3)
