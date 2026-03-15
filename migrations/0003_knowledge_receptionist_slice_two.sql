ALTER TABLE business_call_intents
  ADD COLUMN IF NOT EXISTS sales_style_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE business_call_intents
  ADD COLUMN IF NOT EXISTS greeting_config_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE business_call_intents
  ADD COLUMN IF NOT EXISTS terminology_preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS uploaded_documents (
  uploaded_document_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'approved',
  title TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT NOT NULL DEFAULT 'text/plain',
  source_authority TEXT NOT NULL DEFAULT 'uploaded_unclassified_pending_review',
  document_class TEXT NOT NULL DEFAULT 'unclassified',
  body_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_hash TEXT NOT NULL,
  created_by_type TEXT NOT NULL DEFAULT 'tenant',
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS uploaded_documents_tenant_idx
  ON uploaded_documents (tenant_key, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_overrides_v2 (
  knowledge_override_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  override_type TEXT NOT NULL,
  scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  applies_to_intents_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  applies_to_domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  applies_to_subdomains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  effective_from TIMESTAMPTZ,
  effective_until TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id TEXT,
  updated_by_id TEXT,
  approved_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_overrides_v2_tenant_idx
  ON knowledge_overrides_v2 (tenant_key, status, override_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_guardrails_v2 (
  knowledge_guardrail_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  guardrail_type TEXT NOT NULL,
  trigger_patterns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  trigger_intents_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'high',
  mode TEXT NOT NULL DEFAULT 'clarify',
  approved_response_pattern TEXT NOT NULL,
  required_next_step TEXT,
  optional_capture_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalation_instruction TEXT,
  applies_to_domains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  applies_to_subdomains_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'draft',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id TEXT,
  updated_by_id TEXT,
  approved_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_guardrails_v2_tenant_idx
  ON knowledge_guardrails_v2 (tenant_key, status, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_readiness_states (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started',
  requested_go_live BOOLEAN NOT NULL DEFAULT FALSE,
  review_mode TEXT NOT NULL DEFAULT 'immediate_save',
  checklist_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  blockers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_inputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
