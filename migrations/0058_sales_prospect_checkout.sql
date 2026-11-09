-- Expand-only: old call-bound checkout clients remain compatible.
ALTER TABLE sales_checkout_sessions ALTER COLUMN sales_call_id DROP NOT NULL;
ALTER TABLE sales_checkout_sessions ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS sales_checkout_prospect_only_idx
 ON sales_checkout_sessions(prospect_id,is_test) WHERE sales_call_id IS NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sales_checkout_sessions'::regclass AND conname='sales_checkout_test_isolation') THEN
  ALTER TABLE sales_checkout_sessions ADD CONSTRAINT sales_checkout_test_isolation
   CHECK (NOT is_test OR (paid_at IS NULL AND activation_status='test_only' AND tenant_key IS NULL));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION sales_checkout_mode_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.is_test IS DISTINCT FROM OLD.is_test THEN
  RAISE EXCEPTION 'sales_checkout_mode_immutable' USING ERRCODE='P5801';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_checkout_mode_immutable_trigger ON sales_checkout_sessions;
CREATE TRIGGER sales_checkout_mode_immutable_trigger BEFORE UPDATE ON sales_checkout_sessions
 FOR EACH ROW EXECUTE FUNCTION sales_checkout_mode_immutable();
