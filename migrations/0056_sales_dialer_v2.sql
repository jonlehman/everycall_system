-- Sales v2 deliberately supersedes the 30-day demo/one-attempt queue lifecycle.
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS assigned_rep_user_id BIGINT REFERENCES admin_users(id);
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS inbound_return BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS dnc_reason TEXT;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS removed_reason TEXT;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS numbers_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS tenant_key TEXT REFERENCES tenants(tenant_key);
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS live_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS dialed_number TEXT;
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ;
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS link_sent_at TIMESTAMPTZ;
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ;
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS transcript_json JSONB;
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS recording_url TEXT;
UPDATE sales_demo_profiles SET expires_at=NULL WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_prospects_rep_queue_idx ON sales_prospects(assigned_rep_user_id, callback_at, queue_position) WHERE status IN ('queued','ready_to_call');
CREATE TABLE IF NOT EXISTS sales_dnc_registry (
  identity_type TEXT NOT NULL CHECK(identity_type IN ('phone','domain')),
  identity_value TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(identity_type,identity_value)
);
CREATE OR REPLACE FUNCTION sales_website_domain(value TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
 SELECT NULLIF(regexp_replace(split_part(split_part(regexp_replace(lower(COALESCE(value,'')), '^https?://',''), '/',1),':',1),'^www\.',''),'')
$$;
CREATE OR REPLACE FUNCTION sales_enforce_dnc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matched_reason TEXT; number_value JSONB;
BEGIN
 IF TG_OP='UPDATE' AND OLD.do_not_call THEN NEW.do_not_call:=TRUE; NEW.dnc_reason:=COALESCE(OLD.dnc_reason,NEW.dnc_reason,'asked_not_to_be_called'); END IF;
 SELECT reason INTO matched_reason FROM sales_dnc_registry WHERE
 (identity_type='phone' AND (identity_value=NEW.phone_e164 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.numbers_json) n WHERE n->>'phoneE164'=identity_value)))
 OR (identity_type='domain' AND identity_value=sales_website_domain(NEW.website_url)) LIMIT 1;
 IF matched_reason IS NOT NULL THEN NEW.do_not_call:=TRUE; NEW.dnc_reason:=matched_reason; END IF;
 IF NEW.do_not_call OR NEW.status='not_interested' THEN
   NEW.do_not_call:=TRUE; NEW.suppressed:=TRUE; NEW.status:=CASE WHEN NEW.status='deleted' THEN 'deleted' ELSE 'do_not_call' END;
   NEW.dnc_reason:=COALESCE(NEW.dnc_reason,matched_reason,'asked_not_to_be_called');
   NEW.do_not_call_at:=COALESCE(NEW.do_not_call_at,NOW());
   NEW.suppressed_at:=COALESCE(NEW.suppressed_at,NOW()); NEW.suppression_reason:=COALESCE(NEW.suppression_reason,NEW.dnc_reason);
   NEW.email_suppressed_at:=COALESCE(NEW.email_suppressed_at,NOW()); NEW.email_suppression_reason:=COALESCE(NEW.email_suppression_reason,'do_not_call');
   INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone',NEW.phone_e164,NEW.dnc_reason) ON CONFLICT DO NOTHING;
   IF sales_website_domain(NEW.website_url) IS NOT NULL THEN
     INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('domain',sales_website_domain(NEW.website_url),NEW.dnc_reason) ON CONFLICT DO NOTHING;
   END IF;
   FOR number_value IN SELECT * FROM jsonb_array_elements(NEW.numbers_json) LOOP
     IF NULLIF(number_value->>'phoneE164','') IS NOT NULL THEN
       INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone',number_value->>'phoneE164',NEW.dnc_reason) ON CONFLICT DO NOTHING;
     END IF;
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_dnc_guard ON sales_prospects;
CREATE TRIGGER sales_dnc_guard BEFORE INSERT OR UPDATE ON sales_prospects FOR EACH ROW EXECUTE FUNCTION sales_enforce_dnc();
UPDATE sales_prospects SET dnc_reason=CASE WHEN status='not_interested' THEN 'not_interested' ELSE COALESCE(dnc_reason,'asked_not_to_be_called') END WHERE do_not_call OR status='not_interested';
CREATE TABLE IF NOT EXISTS sales_dialer_config (id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id), scripts_json JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
INSERT INTO sales_dialer_config(id) VALUES(TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sales_checkout_sessions (
 checkout_id TEXT PRIMARY KEY, sales_call_id TEXT NOT NULL REFERENCES sales_call_sessions(sales_call_id),
 prospect_id TEXT NOT NULL REFERENCES sales_prospects(prospect_id), rep_user_id BIGINT NOT NULL REFERENCES admin_users(id),
 stripe_session_id TEXT UNIQUE, checkout_url TEXT, channel TEXT NOT NULL CHECK(channel IN ('sms','email')), recipient TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'creating', provider_message_id TEXT, paid_at TIMESTAMPTZ, stripe_event_id TEXT UNIQUE,
 activation_status TEXT NOT NULL DEFAULT 'unpaid', activation_error TEXT, tenant_key TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_checkout_call_idx ON sales_checkout_sessions(sales_call_id);
CREATE TABLE IF NOT EXISTS sales_setup_bookings (
 booking_id TEXT PRIMARY KEY, sales_call_id TEXT NOT NULL REFERENCES sales_call_sessions(sales_call_id), rep_user_id BIGINT NOT NULL REFERENCES admin_users(id),
 calendar_owner TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 attendee_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'reserving', provider_event_id TEXT, paid_at_booking BOOLEAN NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(ends_at=starts_at+interval '15 minutes')
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_setup_booking_slot_idx ON sales_setup_bookings(calendar_owner,starts_at) WHERE status IN ('reserving','booked');
CREATE TABLE IF NOT EXISTS sales_incoming_calls (
 incoming_id TEXT PRIMARY KEY, provider_call_control_id TEXT NOT NULL UNIQUE, phone_e164 TEXT NOT NULL,
 rep_user_id BIGINT REFERENCES admin_users(id), prospect_id TEXT REFERENCES sales_prospects(prospect_id),
 sales_call_id TEXT REFERENCES sales_call_sessions(sales_call_id), state TEXT NOT NULL DEFAULT 'ringing',
 ring_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+interval '15 seconds', claimed_at TIMESTAMPTZ,
 message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_incoming_rep_idx ON sales_incoming_calls(rep_user_id,state,created_at);
CREATE OR REPLACE FUNCTION sales_v2_call_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id BIGINT;
BEGIN
 IF NEW.state IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled') THEN RETURN NEW; END IF;
 PERFORM id FROM admin_users WHERE id=NEW.admin_user_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM sales_call_sessions c WHERE c.admin_user_id=NEW.admin_user_id AND c.sales_call_id<>NEW.sales_call_id AND c.state NOT IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled')) THEN RAISE EXCEPTION 'rep_call_active' USING ERRCODE='P5601'; END IF;
 SELECT assigned_rep_user_id INTO owner_id FROM sales_prospects WHERE prospect_id=NEW.prospect_id;
 IF owner_id IS NOT NULL AND owner_id IS DISTINCT FROM NEW.admin_user_id AND NEW.metadata_json->>'receptionist_fallback' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'prospect_owned_by_other_rep' USING ERRCODE='P5602'; END IF;
 IF EXISTS(SELECT 1 FROM sales_prospects p JOIN sales_dnc_registry r ON (r.identity_type='phone' AND (r.identity_value=p.phone_e164 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.numbers_json) n WHERE n->>'phoneE164'=r.identity_value))) OR (r.identity_type='domain' AND r.identity_value=sales_website_domain(p.website_url)) WHERE p.prospect_id=NEW.prospect_id) AND NEW.metadata_json->>'direction' IS DISTINCT FROM 'inbound' THEN RAISE EXCEPTION 'prospect_do_not_call' USING ERRCODE='P5603'; END IF;
 NEW.dialed_number:=COALESCE(NEW.dialed_number,NEW.metadata_json->>'prospect_number');
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_v2_call_guard_trigger ON sales_call_sessions;
CREATE TRIGGER sales_v2_call_guard_trigger BEFORE INSERT ON sales_call_sessions FOR EACH ROW EXECUTE FUNCTION sales_v2_call_guard();
CREATE OR REPLACE FUNCTION sales_tenant_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sales_prospects WHERE tenant_key=NEW.tenant_key) AND NEW.service_access_status='enabled' THEN
  IF NOT EXISTS(SELECT 1 FROM sales_checkout_sessions WHERE tenant_key=NEW.tenant_key AND paid_at IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM tenant_active_knowledge_builds a JOIN knowledge_builds b ON b.build_id=a.active_build_id AND b.tenant_key=a.tenant_key WHERE a.tenant_key=NEW.tenant_key AND b.status='published') THEN
   NEW.service_access_status:='disabled'; NEW.billing_lock_reason:='sales_payment_and_validated_knowledge_required';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_tenant_activation_guard_trigger ON tenants;
CREATE TRIGGER sales_tenant_activation_guard_trigger BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION sales_tenant_activation_guard();
-- Preserve existing rep relationships and requeue ordinary historical outcomes.
UPDATE sales_prospects p SET assigned_rep_user_id=last_call.admin_user_id
FROM (SELECT DISTINCT ON(prospect_id) prospect_id,admin_user_id FROM sales_call_sessions WHERE admin_user_id IS NOT NULL ORDER BY prospect_id,created_at DESC) last_call
WHERE p.prospect_id=last_call.prospect_id AND p.assigned_rep_user_id IS NULL AND p.status NOT IN ('removed','deleted');
UPDATE sales_prospects SET status='ready_to_call'
WHERE status IN ('no_answer','voicemail','callback_requested','connected_no_demo','demo_completed','signup_link_sent') AND NOT suppressed AND NOT do_not_call;
