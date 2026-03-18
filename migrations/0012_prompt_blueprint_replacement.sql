CREATE TABLE IF NOT EXISTS prompt_blueprints (
  prompt_blueprint_id TEXT PRIMARY KEY,
  blueprint_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  name TEXT NOT NULL,
  sample_phrase_groups_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_definitions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS prompt_blueprints_key_version_idx
  ON prompt_blueprints (blueprint_key, version);

CREATE INDEX IF NOT EXISTS prompt_blueprints_status_idx
  ON prompt_blueprints (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS prompt_blueprint_sections (
  id BIGSERIAL PRIMARY KEY,
  prompt_blueprint_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  section_order INTEGER NOT NULL,
  default_text TEXT NOT NULL,
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_placeholders_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  admin_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prompt_blueprint_id, section_id)
);

CREATE INDEX IF NOT EXISTS prompt_blueprint_sections_order_idx
  ON prompt_blueprint_sections (prompt_blueprint_id, section_order ASC);

CREATE TABLE IF NOT EXISTS tenant_prompt_profiles (
  tenant_key TEXT PRIMARY KEY,
  assistant_name TEXT,
  business_name TEXT,
  company_description TEXT,
  opening_line TEXT,
  ai_disclosure_line TEXT,
  lead_goal TEXT,
  required_contact_fields_json JSONB,
  closing_phrase TEXT,
  basic_no_tool_allowed_statement TEXT,
  updated_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_prompt_section_overrides (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  prompt_blueprint_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  override_text TEXT NOT NULL,
  updated_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_key, prompt_blueprint_id, section_id)
);

CREATE INDEX IF NOT EXISTS tenant_prompt_section_overrides_tenant_idx
  ON tenant_prompt_section_overrides (tenant_key, updated_at DESC);
