CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_hash TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  freshness DATE,
  confidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  fts_content TEXT NOT NULL,
  embedding vector(1536),
  UNIQUE(page_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_fts
  ON chunks
  USING gin (to_tsvector('english', fts_content));

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  UNIQUE(page_id, tag)
);

CREATE TABLE IF NOT EXISTS links (
  id SERIAL PRIMARY KEY,
  source_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  target_slug TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'related'
);

CREATE INDEX IF NOT EXISTS links_target ON links(target_slug);
CREATE INDEX IF NOT EXISTS links_source ON links(source_page_id);

CREATE TABLE IF NOT EXISTS query_log (
  id SERIAL PRIMARY KEY,
  tool_used TEXT NOT NULL,
  question TEXT NOT NULL,
  results_count INTEGER,
  results_json JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS query_log_created ON query_log(created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

