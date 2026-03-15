DROP TABLE IF EXISTS industry_prompts CASCADE;
DROP TABLE IF EXISTS industry_knowledge_entries CASCADE;
DROP TABLE IF EXISTS industry_guardrail_question_templates CASCADE;
DROP TABLE IF EXISTS site_sections CASCADE;
DROP TABLE IF EXISTS site_pages CASCADE;
DROP TABLE IF EXISTS site_crawls CASCADE;
DROP TABLE IF EXISTS site_topics CASCADE;
DROP TABLE IF EXISTS knowledge_coverage_checks CASCADE;
DROP TABLE IF EXISTS knowledge_entries CASCADE;
DROP TABLE IF EXISTS knowledge_card_facts CASCADE;
DROP TABLE IF EXISTS knowledge_feedback_events CASCADE;
DROP TABLE IF EXISTS guardrail_question_tests CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS agent_versions CASCADE;
DROP TABLE IF EXISTS knowledge_overrides CASCADE;
DROP TABLE IF EXISTS knowledge_guardrails CASCADE;

ALTER TABLE IF EXISTS knowledge_overrides_v2 RENAME TO knowledge_overrides;
ALTER TABLE IF EXISTS knowledge_guardrails_v2 RENAME TO knowledge_guardrails;
ALTER TABLE IF EXISTS call_states_v2 RENAME TO call_states;

DROP TABLE IF EXISTS knowledge_runtime_settings CASCADE;

CREATE TABLE IF NOT EXISTS knowledge_runtime_profiles (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  greeting_text TEXT NOT NULL,
  session_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  wording_defaults_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  runtime_defaults_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_overrides_tenant_priority_idx
  ON knowledge_overrides (tenant_key, priority, updated_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_guardrails_tenant_status_idx
  ON knowledge_guardrails (tenant_key, status, enabled, updated_at DESC);

CREATE INDEX IF NOT EXISTS call_states_tenant_updated_idx
  ON call_states (tenant_key, updated_at DESC);

ALTER TABLE tenant_settings DROP COLUMN IF EXISTS assistant_enabled;

ALTER TABLE system_config DROP COLUMN IF EXISTS personality_prompt;
ALTER TABLE system_config DROP COLUMN IF EXISTS datetime_prompt;
ALTER TABLE system_config DROP COLUMN IF EXISTS numbers_symbols_prompt;
ALTER TABLE system_config DROP COLUMN IF EXISTS confirmation_prompt;
ALTER TABLE system_config DROP COLUMN IF EXISTS knowledge_usage_prompt;
ALTER TABLE system_config DROP COLUMN IF EXISTS gateway_field_schema;
ALTER TABLE system_config DROP COLUMN IF EXISTS gateway_tool_definitions;
ALTER TABLE system_config DROP COLUMN IF EXISTS gateway_session_config;
ALTER TABLE system_config DROP COLUMN IF EXISTS faq_usage_prompt;
