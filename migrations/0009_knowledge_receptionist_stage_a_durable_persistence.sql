ALTER TABLE source_intake_sessions
  ADD COLUMN IF NOT EXISTS crawl_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE source_intake_sessions
  ADD COLUMN IF NOT EXISTS persistence_checkpoint_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS source_intake_items (
  source_intake_item_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  source_intake_session_id TEXT NOT NULL REFERENCES source_intake_sessions(source_intake_session_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_authority TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  title TEXT,
  page_type TEXT,
  content_hash TEXT,
  discovery_status TEXT NOT NULL DEFAULT 'included',
  persistence_status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  source_ref_id TEXT REFERENCES source_refs(source_ref_id) ON DELETE SET NULL,
  headings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  lines_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  text_content TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  persisted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (build_id, source_key)
);

CREATE INDEX IF NOT EXISTS source_intake_items_build_idx
  ON source_intake_items (build_id, discovery_status, persistence_status, source_channel, created_at);

CREATE INDEX IF NOT EXISTS source_intake_items_session_idx
  ON source_intake_items (source_intake_session_id, discovery_status, persistence_status, created_at);

CREATE TABLE IF NOT EXISTS source_intake_persistence_batches (
  source_intake_persistence_batch_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  source_intake_session_id TEXT NOT NULL REFERENCES source_intake_sessions(source_intake_session_id) ON DELETE CASCADE,
  batch_key TEXT NOT NULL,
  batch_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  item_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ref_count INTEGER NOT NULL DEFAULT 0,
  source_segment_count INTEGER NOT NULL DEFAULT 0,
  source_chunk_count INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (build_id, batch_key)
);

CREATE INDEX IF NOT EXISTS source_intake_persistence_batches_build_idx
  ON source_intake_persistence_batches (build_id, status, batch_index, created_at);

ALTER TABLE knowledge_build_analysis_batches
  ADD COLUMN IF NOT EXISTS usage_json JSONB NOT NULL DEFAULT '{}'::jsonb;
