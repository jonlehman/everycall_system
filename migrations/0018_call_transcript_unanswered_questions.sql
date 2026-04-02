CREATE TABLE IF NOT EXISTS call_transcript_analyses (
  call_sid TEXT PRIMARY KEY REFERENCES calls(call_sid) ON DELETE CASCADE,
  tenant_key TEXT NOT NULL,
  transcript_sha256 TEXT,
  analysis_version TEXT NOT NULL DEFAULT 'unanswered_questions_v1',
  model TEXT,
  response_id TEXT,
  total_business_questions INTEGER NOT NULL DEFAULT 0,
  unanswered_question_count INTEGER NOT NULL DEFAULT 0,
  analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_unanswered_questions (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  call_sid TEXT NOT NULL REFERENCES calls(call_sid) ON DELETE CASCADE,
  analysis_version TEXT NOT NULL DEFAULT 'unanswered_questions_v1',
  ordinal INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  assistant_response_text TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_transcript_analyses_tenant_updated_idx
  ON call_transcript_analyses (tenant_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS call_unanswered_questions_tenant_created_idx
  ON call_unanswered_questions (tenant_key, created_at DESC);

CREATE INDEX IF NOT EXISTS call_unanswered_questions_call_created_idx
  ON call_unanswered_questions (call_sid, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS call_unanswered_questions_call_ordinal_idx
  ON call_unanswered_questions (call_sid, analysis_version, ordinal);
