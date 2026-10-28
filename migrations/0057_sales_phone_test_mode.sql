-- Reversible Sales phone testing. Backups are private columns, never public metadata.
ALTER TABLE sales_dialer_config ADD COLUMN IF NOT EXISTS phone_test_mode BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS test_original_phone_e164 TEXT;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS test_original_numbers_json JSONB;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sales_prospects'::regclass AND conname='sales_test_backup_pair') THEN
  ALTER TABLE sales_prospects ADD CONSTRAINT sales_test_backup_pair CHECK ((test_original_phone_e164 IS NULL) = (test_original_numbers_json IS NULL));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION sales_enforce_dnc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matched_reason TEXT; number_value JSONB; identity_phone TEXT; identity_numbers JSONB;
BEGIN
 identity_phone:=COALESCE(NEW.test_original_phone_e164,NEW.phone_e164);
 identity_numbers:=COALESCE(NEW.test_original_numbers_json,NEW.numbers_json);
 IF TG_OP='UPDATE' AND OLD.do_not_call THEN NEW.do_not_call:=TRUE; NEW.dnc_reason:=COALESCE(OLD.dnc_reason,NEW.dnc_reason,'asked_not_to_be_called'); END IF;
 SELECT reason INTO matched_reason FROM sales_dnc_registry WHERE
 (identity_type='phone' AND (identity_value=identity_phone OR EXISTS(SELECT 1 FROM jsonb_array_elements(identity_numbers) n WHERE n->>'phoneE164'=identity_value)))
 OR (identity_type='domain' AND identity_value=sales_website_domain(NEW.website_url)) LIMIT 1;
 IF matched_reason IS NOT NULL THEN NEW.do_not_call:=TRUE; NEW.dnc_reason:=matched_reason; END IF;
 IF NEW.do_not_call OR NEW.status='not_interested' THEN
   NEW.do_not_call:=TRUE; NEW.suppressed:=TRUE; NEW.status:=CASE WHEN NEW.status='deleted' THEN 'deleted' ELSE 'do_not_call' END;
   NEW.dnc_reason:=COALESCE(NEW.dnc_reason,matched_reason,'asked_not_to_be_called');
   NEW.do_not_call_at:=COALESCE(NEW.do_not_call_at,NOW());
   NEW.suppressed_at:=COALESCE(NEW.suppressed_at,NOW()); NEW.suppression_reason:=COALESCE(NEW.suppression_reason,NEW.dnc_reason);
   NEW.email_suppressed_at:=COALESCE(NEW.email_suppressed_at,NOW()); NEW.email_suppression_reason:=COALESCE(NEW.email_suppression_reason,'do_not_call');
   INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone',identity_phone,NEW.dnc_reason) ON CONFLICT DO NOTHING;
   IF sales_website_domain(NEW.website_url) IS NOT NULL THEN
     INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('domain',sales_website_domain(NEW.website_url),NEW.dnc_reason) ON CONFLICT DO NOTHING;
   END IF;
   FOR number_value IN SELECT * FROM jsonb_array_elements(identity_numbers) LOOP
     IF NULLIF(number_value->>'phoneE164','') IS NOT NULL THEN
       INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone',number_value->>'phoneE164',NEW.dnc_reason) ON CONFLICT DO NOTHING;
     END IF;
   END LOOP;
 END IF;
 RETURN NEW;
END $$;

-- Mode changes and new destinations serialize on the singleton config row.
CREATE OR REPLACE FUNCTION sales_test_prospect_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enabled BOOLEAN;
BEGIN
 SELECT phone_test_mode INTO enabled FROM sales_dialer_config WHERE id=TRUE FOR SHARE;
 IF current_setting('everycall.sales_test_transition',TRUE)='on' THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
   IF enabled THEN RAISE EXCEPTION 'Restore original Sales phones before deleting prospects.' USING ERRCODE='P5701'; END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
   IF enabled OR NEW.test_original_phone_e164 IS NOT NULL OR NEW.test_original_numbers_json IS NOT NULL THEN
     RAISE EXCEPTION 'Restore original Sales phones before adding or importing prospects.' USING ERRCODE='P5701';
   END IF;
 ELSE
   IF enabled AND NEW.status IN ('removed','deleted') AND NEW.status IS DISTINCT FROM OLD.status THEN
     RAISE EXCEPTION 'Restore original Sales phones before removing prospects.' USING ERRCODE='P5701';
   END IF;
   IF NEW.test_original_phone_e164 IS DISTINCT FROM OLD.test_original_phone_e164 OR NEW.test_original_numbers_json IS DISTINCT FROM OLD.test_original_numbers_json
      OR (enabled AND (NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164 OR NEW.numbers_json IS DISTINCT FROM OLD.numbers_json)) THEN
     RAISE EXCEPTION 'Restore original Sales phones before editing phone numbers.' USING ERRCODE='P5701';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_aaa_test_prospect_guard ON sales_prospects;
CREATE TRIGGER sales_aaa_test_prospect_guard BEFORE INSERT OR DELETE OR UPDATE OF status,phone_e164,numbers_json,test_original_phone_e164,test_original_numbers_json ON sales_prospects FOR EACH ROW EXECUTE FUNCTION sales_test_prospect_guard();

CREATE OR REPLACE FUNCTION sales_test_call_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enabled BOOLEAN; selected_phone TEXT;
BEGIN
 SELECT phone_test_mode INTO enabled FROM sales_dialer_config WHERE id=TRUE FOR SHARE;
 IF TG_OP='UPDATE' THEN
   IF NEW.state NOT IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled') AND enabled IS DISTINCT FROM COALESCE((OLD.metadata_json->>'phone_test_mode')::boolean,FALSE) THEN
     RAISE EXCEPTION 'This call belongs to a previous phone mode. Start a new call.' USING ERRCODE='P5702';
   END IF;
   IF NEW.metadata_json->'phone_test_mode' IS DISTINCT FROM OLD.metadata_json->'phone_test_mode'
      OR NEW.metadata_json->'prospect_number' IS DISTINCT FROM OLD.metadata_json->'prospect_number'
      OR NEW.dialed_number IS DISTINCT FROM OLD.dialed_number THEN
     RAISE EXCEPTION 'Call phone destination and test status cannot change.' USING ERRCODE='P5702';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.metadata_json->>'direction'='inbound' THEN
   IF enabled THEN RAISE EXCEPTION 'Sales inbound calls are paused during phone test mode.' USING ERRCODE='P5704'; END IF;
   RETURN NEW;
 END IF;
 selected_phone:=COALESCE(NEW.dialed_number,NEW.metadata_json->>'prospect_number');
 IF selected_phone IS NULL THEN SELECT phone_e164 INTO selected_phone FROM sales_prospects WHERE prospect_id=NEW.prospect_id; END IF;
 IF enabled AND selected_phone NOT IN ('+14252300121','+14256154640') THEN
   RAISE EXCEPTION 'Reload the caller workspace and choose an owner test number.' USING ERRCODE='P5702';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM sales_prospects p WHERE p.prospect_id=NEW.prospect_id AND
    (p.phone_e164=selected_phone OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.numbers_json) n WHERE n->>'phoneE164'=selected_phone))) THEN
   RAISE EXCEPTION 'Call phone destination is no longer on this prospect. Reload the caller workspace.' USING ERRCODE='P5702';
 END IF;
 NEW.dialed_number:=selected_phone;
 NEW.metadata_json:=NEW.metadata_json || jsonb_build_object('prospect_number',selected_phone,'phone_test_mode',enabled);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_aaa_test_call_guard ON sales_call_sessions;
CREATE TRIGGER sales_aaa_test_call_guard BEFORE INSERT OR UPDATE ON sales_call_sessions FOR EACH ROW EXECUTE FUNCTION sales_test_call_guard();

CREATE OR REPLACE FUNCTION sales_test_incoming_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enabled BOOLEAN;
BEGIN
 SELECT phone_test_mode INTO enabled FROM sales_dialer_config WHERE id=TRUE FOR SHARE;
 IF enabled THEN RAISE EXCEPTION 'Sales inbound calls are paused during phone test mode.' USING ERRCODE='P5704'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_test_incoming_guard_trigger ON sales_incoming_calls;
CREATE TRIGGER sales_test_incoming_guard_trigger BEFORE INSERT ON sales_incoming_calls FOR EACH ROW EXECUTE FUNCTION sales_test_incoming_guard();

-- DNC remains bound to the original contact identity, including newly registered opt-outs.
CREATE OR REPLACE FUNCTION sales_v2_call_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id BIGINT;
BEGIN
 IF NEW.state IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled') THEN RETURN NEW; END IF;
 PERFORM id FROM admin_users WHERE id=NEW.admin_user_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM sales_call_sessions c WHERE c.admin_user_id=NEW.admin_user_id AND c.sales_call_id<>NEW.sales_call_id AND c.state NOT IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled')) THEN RAISE EXCEPTION 'rep_call_active' USING ERRCODE='P5601'; END IF;
 SELECT assigned_rep_user_id INTO owner_id FROM sales_prospects WHERE prospect_id=NEW.prospect_id;
 IF owner_id IS NOT NULL AND owner_id IS DISTINCT FROM NEW.admin_user_id AND NEW.metadata_json->>'receptionist_fallback' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'prospect_owned_by_other_rep' USING ERRCODE='P5602'; END IF;
 IF EXISTS(SELECT 1 FROM sales_prospects p JOIN sales_dnc_registry r ON (r.identity_type='phone' AND (r.identity_value=COALESCE(p.test_original_phone_e164,p.phone_e164) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.test_original_numbers_json,p.numbers_json)) n WHERE n->>'phoneE164'=r.identity_value))) OR (r.identity_type='domain' AND r.identity_value=sales_website_domain(p.website_url)) WHERE p.prospect_id=NEW.prospect_id) AND NEW.metadata_json->>'direction' IS DISTINCT FROM 'inbound' THEN RAISE EXCEPTION 'prospect_do_not_call' USING ERRCODE='P5603'; END IF;
 NEW.dialed_number:=COALESCE(NEW.dialed_number,NEW.metadata_json->>'prospect_number');
 RETURN NEW;
END $$;
