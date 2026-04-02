ALTER TABLE knowledge_builds
  ADD COLUMN IF NOT EXISTS build_kind TEXT NOT NULL DEFAULT 'legacy_combined',
  ADD COLUMN IF NOT EXISTS base_build_id TEXT REFERENCES knowledge_builds(build_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS overlay_build_id TEXT REFERENCES knowledge_builds(build_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS composite_parent_build_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_fingerprint_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS knowledge_builds_build_kind_idx
  ON knowledge_builds (tenant_key, build_kind, created_at DESC);

ALTER TABLE uploaded_documents
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'file_upload',
  ADD COLUMN IF NOT EXISTS source_locator TEXT,
  ADD COLUMN IF NOT EXISTS fetch_status TEXT,
  ADD COLUMN IF NOT EXISTS fetch_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS uploaded_documents_source_kind_idx
  ON uploaded_documents (tenant_key, source_kind, status, updated_at DESC);
