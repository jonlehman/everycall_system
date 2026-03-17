ALTER TABLE knowledge_builds
  ADD COLUMN IF NOT EXISTS analysis_checkpoint_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS knowledge_build_analysis_batches (
  knowledge_build_analysis_batch_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  prompt_cache_key TEXT,
  item_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  request_token_estimate INTEGER NOT NULL DEFAULT 0,
  response_token_budget INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (build_id, stage, batch_key)
);

CREATE INDEX IF NOT EXISTS knowledge_build_analysis_batches_build_idx
  ON knowledge_build_analysis_batches (build_id, stage, status, created_at);

CREATE TABLE IF NOT EXISTS knowledge_build_source_summaries (
  source_summary_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  source_ref_id TEXT NOT NULL REFERENCES source_refs(source_ref_id) ON DELETE CASCADE,
  knowledge_build_analysis_batch_id TEXT REFERENCES knowledge_build_analysis_batches(knowledge_build_analysis_batch_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  summary_text TEXT NOT NULL,
  candidate_topics_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  answerable_units_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  question_forms_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  notable_boundaries_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_chunk_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (build_id, source_ref_id)
);

CREATE INDEX IF NOT EXISTS knowledge_build_source_summaries_build_idx
  ON knowledge_build_source_summaries (build_id, status, source_ref_id);

CREATE TABLE IF NOT EXISTS knowledge_build_source_artifacts (
  source_artifact_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  source_ref_id TEXT NOT NULL REFERENCES source_refs(source_ref_id) ON DELETE CASCADE,
  knowledge_build_analysis_batch_id TEXT REFERENCES knowledge_build_analysis_batches(knowledge_build_analysis_batch_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  facts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_chunk_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  repair_requested BOOLEAN NOT NULL DEFAULT FALSE,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (build_id, source_ref_id)
);

CREATE INDEX IF NOT EXISTS knowledge_build_source_artifacts_build_idx
  ON knowledge_build_source_artifacts (build_id, status, source_ref_id);
