CREATE TABLE IF NOT EXISTS call_outcome_schemas (
  call_outcome_schema_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'approved_live',
  domain_scope_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  subdomain_scope_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome_types_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_fields_by_outcome_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  optional_fields_by_outcome_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_template TEXT NOT NULL,
  validation_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id TEXT,
  updated_by_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_outcome_schemas_tenant_idx
  ON call_outcome_schemas (tenant_key, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_runtime_settings (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  runtime_path TEXT NOT NULL DEFAULT 'legacy',
  rollout_notes TEXT,
  updated_by_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_runtime_settings_runtime_idx
  ON knowledge_runtime_settings (runtime_path, updated_at DESC);
