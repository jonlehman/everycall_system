-- Additive governance. Existing active builds and tenant-owned by-heart values are untouched.
CREATE TABLE IF NOT EXISTS knowledge_governance_policies (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  review_mode TEXT NOT NULL DEFAULT 'single_admin' CHECK (review_mode IN ('single_admin','reviewed')),
  publication_mode TEXT NOT NULL DEFAULT 'manual_only' CHECK (publication_mode = 'manual_only'),
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS knowledge_change_requests (
  change_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  base_revision BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved_live','rejected')),
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS knowledge_changes_tenant_status_idx ON knowledge_change_requests (tenant_key,status,created_at DESC);
CREATE TABLE IF NOT EXISTS knowledge_readiness_reviews (
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  config_revision BIGINT NOT NULL,
  checklist_json JSONB NOT NULL,
  evidence_note TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_key, build_id)
);
