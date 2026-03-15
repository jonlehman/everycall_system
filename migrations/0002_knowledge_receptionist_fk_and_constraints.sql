DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_intake_sessions_build_id_fkey'
  ) THEN
    ALTER TABLE source_intake_sessions
      ADD CONSTRAINT source_intake_sessions_build_id_fkey
      FOREIGN KEY (build_id)
      REFERENCES knowledge_builds(build_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS source_intake_sessions_build_idx
  ON source_intake_sessions (build_id);
