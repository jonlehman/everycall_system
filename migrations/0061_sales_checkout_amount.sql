-- Expand-only. Every preexisting reservation was created for exactly $100 USD.
-- Apply only through the independently reviewed scoped0061 release procedure.
ALTER TABLE sales_checkout_sessions
 ADD COLUMN IF NOT EXISTS amount_cents INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE sales_checkout_sessions
 ADD CONSTRAINT sales_checkout_amount_range CHECK (amount_cents BETWEEN 100 AND 99999999);
CREATE OR REPLACE FUNCTION sales_checkout_amount_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents THEN
  RAISE EXCEPTION 'sales_checkout_amount_immutable' USING ERRCODE='P6101';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sales_checkout_amount_immutable_trigger BEFORE UPDATE ON sales_checkout_sessions
 FOR EACH ROW EXECUTE FUNCTION sales_checkout_amount_immutable();

-- Keep custom reservations disabled until every old checkout invocation retires.
ALTER TABLE sales_dialer_config
 ADD COLUMN IF NOT EXISTS custom_signup_amount_enabled BOOLEAN NOT NULL DEFAULT FALSE;
