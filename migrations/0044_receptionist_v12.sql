ALTER TABLE knowledge_build_facts
  ADD COLUMN IF NOT EXISTS core_fact_caller_question_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN knowledge_build_facts.core_fact_caller_question_categories_json IS
  'Model-classified universal caller-question categories used for by-heart scoring and coverage checks.';

CREATE TABLE IF NOT EXISTS tenant_caller_faq_confirmations (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  trigger_build_id TEXT REFERENCES knowledge_builds(build_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'not_required')),
  missing_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  setup_interview_session_id TEXT REFERENCES setup_interview_sessions(setup_interview_session_id) ON DELETE SET NULL,
  followup_build_id TEXT REFERENCES knowledge_builds(build_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tenant_caller_faq_confirmations_status_idx
  ON tenant_caller_faq_confirmations (status, updated_at DESC);

COMMENT ON TABLE tenant_caller_faq_confirmations IS
  'One-time owner confirmation for universal phone-receptionist facts when website ingest cannot confirm broad repair or service coverage.';
