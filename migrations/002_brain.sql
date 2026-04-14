CREATE TABLE IF NOT EXISTS entity_embeddings (
  slug TEXT PRIMARY KEY,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entity_embeddings_vec
  ON entity_embeddings
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  format TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  page_slugs TEXT[] NOT NULL DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sources_content_hash ON sources(content_hash);

CREATE TABLE IF NOT EXISTS domain_quotas (
  domain TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INT NOT NULL DEFAULT 0,
  UNIQUE(domain, date)
);

CREATE TABLE IF NOT EXISTS pending_ingests (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  format TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT
);

CREATE INDEX IF NOT EXISTS pending_ingests_status ON pending_ingests(status);
