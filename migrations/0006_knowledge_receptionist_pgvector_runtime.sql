CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS source_chunks (
  source_chunk_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  source_ref_id TEXT NOT NULL REFERENCES source_refs(source_ref_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_kind TEXT NOT NULL DEFAULT 'content_block',
  section_title TEXT,
  heading_path TEXT,
  text_span TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_ref_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS source_chunks_build_idx
  ON source_chunks (build_id, source_ref_id, chunk_index);

CREATE TABLE IF NOT EXISTS knowledge_build_topics (
  knowledge_topic_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  topic_name TEXT NOT NULL,
  description TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_coverage_summary TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (build_id, topic_name)
);

CREATE INDEX IF NOT EXISTS knowledge_build_topics_build_idx
  ON knowledge_build_topics (build_id, topic_name);

CREATE TABLE IF NOT EXISTS knowledge_build_subtopics (
  knowledge_subtopic_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  knowledge_topic_id TEXT NOT NULL REFERENCES knowledge_build_topics(knowledge_topic_id) ON DELETE CASCADE,
  subtopic_name TEXT NOT NULL,
  description TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_coverage_summary TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (knowledge_topic_id, subtopic_name)
);

CREATE INDEX IF NOT EXISTS knowledge_build_subtopics_build_idx
  ON knowledge_build_subtopics (build_id, knowledge_topic_id, subtopic_name);

ALTER TABLE knowledge_build_cards
  ADD COLUMN IF NOT EXISTS knowledge_topic_id TEXT REFERENCES knowledge_build_topics(knowledge_topic_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS knowledge_subtopic_id TEXT REFERENCES knowledge_build_subtopics(knowledge_subtopic_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS card_role TEXT NOT NULL DEFAULT 'answer_unit',
  ADD COLUMN IF NOT EXISTS support_summary TEXT,
  ADD COLUMN IF NOT EXISTS source_span_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS support_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE knowledge_build_facts
  ADD COLUMN IF NOT EXISTS knowledge_topic_id TEXT REFERENCES knowledge_build_topics(knowledge_topic_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS knowledge_subtopic_id TEXT REFERENCES knowledge_build_subtopics(knowledge_subtopic_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fact_role TEXT NOT NULL DEFAULT 'detail',
  ADD COLUMN IF NOT EXISTS support_type TEXT NOT NULL DEFAULT 'source_backed',
  ADD COLUMN IF NOT EXISTS source_span_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_chunk_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS qualifier_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS boundary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS support_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS knowledge_build_cards_topic_idx
  ON knowledge_build_cards (build_id, knowledge_topic_id, knowledge_subtopic_id, card_role);

CREATE INDEX IF NOT EXISTS knowledge_build_facts_topic_idx
  ON knowledge_build_facts (build_id, knowledge_topic_id, knowledge_subtopic_id, fact_role);

CREATE TABLE IF NOT EXISTS knowledge_build_card_vectors (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  knowledge_card_id TEXT NOT NULL REFERENCES knowledge_build_cards(knowledge_card_id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (knowledge_card_id, embedding_model)
);

CREATE INDEX IF NOT EXISTS knowledge_build_card_vectors_build_idx
  ON knowledge_build_card_vectors (build_id, embedding_model, knowledge_card_id);

CREATE INDEX IF NOT EXISTS knowledge_build_card_vectors_embedding_idx
  ON knowledge_build_card_vectors
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS knowledge_build_fact_vectors (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_build_facts(knowledge_fact_id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (knowledge_fact_id, embedding_model)
);

CREATE INDEX IF NOT EXISTS knowledge_build_fact_vectors_build_idx
  ON knowledge_build_fact_vectors (build_id, embedding_model, knowledge_fact_id);

CREATE INDEX IF NOT EXISTS knowledge_build_fact_vectors_embedding_idx
  ON knowledge_build_fact_vectors
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS knowledge_coverage_events (
  knowledge_coverage_event_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT REFERENCES knowledge_builds(build_id) ON DELETE SET NULL,
  call_id TEXT,
  turn_id TEXT,
  query_text TEXT NOT NULL,
  requested_coverage_item_text TEXT NOT NULL,
  support_strength TEXT NOT NULL,
  top_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_fact_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_scores_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  gap_reason TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_coverage_events_tenant_idx
  ON knowledge_coverage_events (tenant_key, created_at DESC);

ALTER TABLE knowledge_builds
  ADD COLUMN IF NOT EXISTS compiler_version TEXT NOT NULL DEFAULT 'planner_pgvector_v1',
  ADD COLUMN IF NOT EXISTS topic_inventory_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS planner_model TEXT;
