ALTER TABLE call_transcript_analyses
  ADD COLUMN IF NOT EXISTS answered_question_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS call_answered_questions (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  call_sid TEXT NOT NULL REFERENCES calls(call_sid) ON DELETE CASCADE,
  analysis_version TEXT NOT NULL DEFAULT 'question_inventory_v2',
  ordinal INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  assistant_response_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_answered_questions_tenant_created_idx
  ON call_answered_questions (tenant_key, created_at DESC);

CREATE INDEX IF NOT EXISTS call_answered_questions_call_created_idx
  ON call_answered_questions (call_sid, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS call_answered_questions_call_ordinal_idx
  ON call_answered_questions (call_sid, analysis_version, ordinal);
