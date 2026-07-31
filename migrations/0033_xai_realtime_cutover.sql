BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_call_sessions'
      AND column_name = 'openai_call_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_call_sessions'
      AND column_name = 'xai_call_id'
  ) THEN
    ALTER TABLE sales_call_sessions RENAME COLUMN openai_call_id TO xai_call_id;
  END IF;
END
$$;

UPDATE sales_call_events
SET provider = 'xai'
WHERE provider = 'openai';

COMMIT;
