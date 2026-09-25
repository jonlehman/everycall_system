-- v20.1 is additive: legacy kb_block and tenant-owned selections remain intact.
CREATE TABLE IF NOT EXISTS live_brief_builds (
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  processing_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  slots_json JSONB NOT NULL CHECK (jsonb_typeof(slots_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_key, build_id)
);

CREATE TABLE IF NOT EXISTS live_brief_blocks (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  slots_json JSONB NOT NULL CHECK (jsonb_typeof(slots_json) = 'object'),
  proposed_slots_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(proposed_slots_json) = 'object'),
  block_text TEXT NOT NULL CHECK (char_length(block_text) <= 1200),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_key, build_id) REFERENCES live_brief_builds(tenant_key, build_id)
);

CREATE TABLE IF NOT EXISTS live_brief_slot_audit (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('hours', 'service_area', 'services', 'estimate_policy', 'emergency_policy', 'approved_prices', 'trade_faq')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('edit', 'accept_proposal')),
  before_json JSONB NOT NULL,
  after_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
