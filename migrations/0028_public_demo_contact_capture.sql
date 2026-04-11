ALTER TABLE demo_sessions
  ADD COLUMN IF NOT EXISTS contact_name TEXT;

ALTER TABLE demo_sessions
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

ALTER TABLE demo_sessions
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

ALTER TABLE demo_sessions
  ADD COLUMN IF NOT EXISTS reused_from_demo_session_id TEXT REFERENCES demo_sessions(demo_session_id) ON DELETE SET NULL;

ALTER TABLE demo_sessions
  ADD COLUMN IF NOT EXISTS transcript_items_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS demo_sessions_created_idx
  ON demo_sessions (created_at DESC);

CREATE INDEX IF NOT EXISTS demo_sessions_contact_email_created_idx
  ON demo_sessions (contact_email, created_at DESC);
