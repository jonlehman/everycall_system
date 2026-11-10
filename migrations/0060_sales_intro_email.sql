-- Additive, manual Sales introduction only. No provider calls or campaign jobs.
CREATE TABLE IF NOT EXISTS sales_intro_email_deliveries (
  draft_token TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES sales_prospects(prospect_id),
  contact_id TEXT NOT NULL REFERENCES sales_prospect_contacts(contact_id),
  rep_user_id BIGINT NOT NULL REFERENCES admin_users(id),
  sales_call_id TEXT REFERENCES sales_call_sessions(sales_call_id),
  expected_row_version BIGINT NOT NULL,
  recipient_hash TEXT NOT NULL,
  reply_to_hash TEXT NOT NULL,
  requires_email_permission BOOLEAN NOT NULL,
  confirmed_email_permission BOOLEAN NOT NULL DEFAULT FALSE,
  request_hash TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','uncertain','canceled')),
  provider TEXT,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  attempted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  reconciled_by BIGINT REFERENCES admin_users(id),
  reconciled_at TIMESTAMPTZ,
  resolution_evidence_ref TEXT,
  CONSTRAINT sales_intro_email_contact_company_fk FOREIGN KEY(prospect_id,contact_id) REFERENCES sales_prospect_contacts(prospect_id,contact_id),
  CHECK ((status='draft' AND request_hash IS NULL AND idempotency_key IS NULL AND attempted_at IS NULL)
    OR (status<>'draft' AND request_hash IS NOT NULL AND idempotency_key IS NOT NULL AND attempted_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_intro_email_key_idx
  ON sales_intro_email_deliveries(rep_user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_intro_email_unresolved_idx
  ON sales_intro_email_deliveries(prospect_id) WHERE status IN ('sending','uncertain');

CREATE OR REPLACE FUNCTION sales_intro_email_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolving BOOLEAN;
BEGIN
  resolving:=OLD.status IN ('sending','uncertain') AND NEW.status IN ('sent','canceled')
    AND NEW.reconciled_by IS NOT NULL AND NEW.reconciled_at IS NOT NULL
    AND NULLIF(NEW.resolution_evidence_ref,'') IS NOT NULL
    AND current_setting('everycall.sales_intro_reconciliation',TRUE)=NEW.draft_token||':'||NEW.reconciled_by::TEXT
    AND EXISTS(SELECT 1 FROM admin_users WHERE id=NEW.reconciled_by AND role IN ('admin','super_admin'));
  IF (NEW.draft_token,NEW.prospect_id,NEW.contact_id,NEW.rep_user_id,NEW.sales_call_id,
      NEW.expected_row_version,NEW.recipient_hash,NEW.reply_to_hash,NEW.requires_email_permission,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM
     (OLD.draft_token,OLD.prospect_id,OLD.contact_id,OLD.rep_user_id,OLD.sales_call_id,
      OLD.expected_row_version,OLD.recipient_hash,OLD.reply_to_hash,OLD.requires_email_permission,OLD.created_at,OLD.expires_at)
    OR (OLD.status<>'draft' AND (NEW.request_hash,NEW.idempotency_key,NEW.confirmed_email_permission,NEW.attempted_at)
       IS DISTINCT FROM (OLD.request_hash,OLD.idempotency_key,OLD.confirmed_email_permission,OLD.attempted_at))
    OR ((NEW.reconciled_by,NEW.reconciled_at,NEW.resolution_evidence_ref)
       IS DISTINCT FROM (OLD.reconciled_by,OLD.reconciled_at,OLD.resolution_evidence_ref) AND NOT COALESCE(resolving,FALSE))
    OR (NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='sending')
       OR (OLD.status='sending' AND NEW.status IN ('sent','uncertain','canceled')) OR COALESCE(resolving,FALSE))) THEN
    RAISE EXCEPTION 'Introduction delivery identity and attempts are immutable.' USING ERRCODE='P6001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_intro_email_immutable_guard ON sales_intro_email_deliveries;
CREATE TRIGGER sales_intro_email_immutable_guard BEFORE UPDATE ON sales_intro_email_deliveries
 FOR EACH ROW EXECUTE FUNCTION sales_intro_email_immutable();

-- Extend existing edit/mode fences without making older Sales queries depend
-- on this new table. Suppression and permission revocation remain available.
CREATE OR REPLACE FUNCTION sales_intro_email_pending_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT;
BEGIN
  IF TG_TABLE_NAME='sales_dialer_config' THEN
    IF NEW.phone_test_mode IS NOT DISTINCT FROM OLD.phone_test_mode THEN RETURN NEW; END IF;
    IF EXISTS(SELECT 1 FROM sales_intro_email_deliveries WHERE status IN ('sending','uncertain')) THEN
      RAISE EXCEPTION 'Reconcile pending introduction email delivery before changing phone test mode.' USING ERRCODE='P6002';
    END IF;
  ELSE
    pid:=NEW.prospect_id;
    IF TG_TABLE_NAME='sales_prospects' THEN
      IF (NEW.assigned_rep_user_id,NEW.default_contact_id,NEW.contact_email)
        IS NOT DISTINCT FROM (OLD.assigned_rep_user_id,OLD.default_contact_id,OLD.contact_email) THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM sales_intro_email_deliveries WHERE prospect_id=pid AND status IN ('sending','uncertain')) THEN
      RAISE EXCEPTION 'Reconcile pending introduction email delivery before editing this company.' USING ERRCODE='P6002';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_intro_email_mode_guard ON sales_dialer_config;
CREATE TRIGGER sales_intro_email_mode_guard BEFORE UPDATE ON sales_dialer_config
 FOR EACH ROW EXECUTE FUNCTION sales_intro_email_pending_guard();
DROP TRIGGER IF EXISTS sales_intro_email_company_guard ON sales_prospects;
CREATE TRIGGER sales_intro_email_company_guard BEFORE UPDATE ON sales_prospects
 FOR EACH ROW EXECUTE FUNCTION sales_intro_email_pending_guard();
DROP TRIGGER IF EXISTS sales_intro_email_contact_guard ON sales_prospect_contacts;
CREATE TRIGGER sales_intro_email_contact_guard BEFORE INSERT OR UPDATE ON sales_prospect_contacts
 FOR EACH ROW EXECUTE FUNCTION sales_intro_email_pending_guard();
DROP TRIGGER IF EXISTS sales_intro_email_number_guard ON sales_prospect_contact_numbers;
CREATE TRIGGER sales_intro_email_number_guard BEFORE INSERT OR UPDATE ON sales_prospect_contact_numbers
 FOR EACH ROW EXECUTE FUNCTION sales_intro_email_pending_guard();
