-- Expand-only Sales company contacts. Apply during a reviewed maintenance window.
-- Never use substituted owner test destinations as source contact identities.
DO $$ BEGIN
 PERFORM id FROM sales_dialer_config WHERE id=TRUE FOR UPDATE;
 IF EXISTS(SELECT 1 FROM sales_call_sessions WHERE state NOT IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled')) THEN
  RAISE EXCEPTION 'End all active Sales calls before migrating company contacts.' USING ERRCODE='P5904';
 END IF;
 IF EXISTS(SELECT 1 FROM sales_dialer_config WHERE id=TRUE AND phone_test_mode) AND EXISTS(
  SELECT 1 FROM sales_prospects WHERE test_original_phone_e164 IS NULL OR test_original_numbers_json IS NULL OR jsonb_typeof(test_original_numbers_json)<>'array') THEN
  RAISE EXCEPTION 'Sales phone-test originals are incomplete; reconcile backups before migrating contacts.' USING ERRCODE='P5904';
 END IF;
 IF EXISTS(SELECT 1 FROM sales_prospects p WHERE
  COALESCE(p.test_original_phone_e164,p.phone_e164) !~ '^\+[1-9][0-9]{7,14}$'
  OR jsonb_typeof(COALESCE(p.test_original_numbers_json,p.numbers_json)) IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(p.test_original_numbers_json,p.numbers_json))='array' THEN COALESCE(p.test_original_numbers_json,p.numbers_json) ELSE '[]'::jsonb END) n WHERE jsonb_typeof(n)<>'object' OR COALESCE(n->>'phoneE164','') !~ '^\+[1-9][0-9]{7,14}$')) THEN
  RAISE EXCEPTION 'Sales original phone identities are malformed; reconcile before migrating contacts.' USING ERRCODE='P5904';
 END IF;
 IF EXISTS(SELECT 1 FROM sales_dialer_config WHERE id=TRUE AND phone_test_mode) AND EXISTS(SELECT 1 FROM sales_prospects WHERE phone_e164<>'+14252300121' OR numbers_json IS DISTINCT FROM '[{"phoneE164":"+14252300121","label":"Owner test desk","type":"shop"},{"phoneE164":"+14256154640","label":"Owner test cell","type":"cell"}]'::jsonb) THEN
  RAISE EXCEPTION 'Sales test destinations are inconsistent; reconcile before migrating contacts.' USING ERRCODE='P5904';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM sales_dialer_config WHERE id=TRUE AND phone_test_mode) AND EXISTS(SELECT 1 FROM sales_prospects WHERE test_original_phone_e164 IS NOT NULL OR test_original_numbers_json IS NOT NULL) THEN
  RAISE EXCEPTION 'Sales phone-test backups do not match mode; reconcile before migrating contacts.' USING ERRCODE='P5904';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS sales_prospect_contacts (
 contact_id TEXT PRIMARY KEY,
 prospect_id TEXT NOT NULL REFERENCES sales_prospects(prospect_id) ON DELETE CASCADE,
 first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
 email TEXT, title TEXT, decision_maker BOOLEAN NOT NULL DEFAULT FALSE,
 influencer BOOLEAN NOT NULL DEFAULT FALSE, legacy_name TEXT, legacy_owner_first_name TEXT,
 email_history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 archived_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(prospect_id,contact_id)
);
CREATE TABLE IF NOT EXISTS sales_prospect_contact_numbers (
 number_id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES sales_prospects(prospect_id) ON DELETE CASCADE,
 contact_id TEXT, phone_e164 TEXT NOT NULL CHECK(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 type TEXT NOT NULL DEFAULT 'other' CHECK(type IN ('cell','shop','other')), label TEXT NOT NULL DEFAULT '',
 position INTEGER NOT NULL DEFAULT 0, legacy_json JSONB NOT NULL DEFAULT '{}'::jsonb, archived_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(prospect_id,number_id),
 FOREIGN KEY(prospect_id,contact_id) REFERENCES sales_prospect_contacts(prospect_id,contact_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS sales_contact_numbers_phone_idx ON sales_prospect_contact_numbers(phone_e164) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_contacts_company_idx ON sales_prospect_contacts(prospect_id) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS sales_prospect_identities (
 prospect_id TEXT NOT NULL REFERENCES sales_prospects(prospect_id) ON DELETE CASCADE,
 identity_type TEXT NOT NULL CHECK(identity_type IN ('phone','domain')),
 identity_value TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(prospect_id,identity_type,identity_value)
);
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS default_contact_id TEXT;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS callback_contact_id TEXT;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS callback_number_id TEXT;
ALTER TABLE sales_prospects ADD COLUMN IF NOT EXISTS callback_contact_snapshot JSONB;
ALTER TABLE sales_call_sessions ADD COLUMN IF NOT EXISTS selected_number_original TEXT;
ALTER TABLE sales_setup_bookings ADD COLUMN IF NOT EXISTS attendee_snapshot JSONB;
ALTER TABLE sales_setup_bookings ADD COLUMN IF NOT EXISTS provider_payload JSONB;
ALTER TABLE sales_checkout_sessions ADD COLUMN IF NOT EXISTS contact_snapshot JSONB;
ALTER TABLE sales_incoming_calls ADD COLUMN IF NOT EXISTS contact_snapshot JSONB;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sales_company_default_contact_fk') THEN
  ALTER TABLE sales_prospects ADD CONSTRAINT sales_company_default_contact_fk FOREIGN KEY(prospect_id,default_contact_id) REFERENCES sales_prospect_contacts(prospect_id,contact_id) DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name,last_name,email,title,legacy_name,legacy_owner_first_name)
 SELECT 'contact_legacy_'||prospect_id,prospect_id,
 COALESCE(NULLIF(split_part(trim(contact_name),' ',1),''),owner_first_name,''),
 CASE WHEN position(' ' IN trim(contact_name))>0 THEN substring(trim(contact_name) FROM position(' ' IN trim(contact_name))+1) ELSE '' END,
 contact_email,metadata_json->>'contactRole',contact_name,owner_first_name FROM sales_prospects p
 WHERE NOT EXISTS(SELECT 1 FROM sales_prospect_contacts c WHERE c.contact_id='contact_legacy_'||p.prospect_id)
 ON CONFLICT(contact_id) DO NOTHING;
UPDATE sales_prospects SET default_contact_id='contact_legacy_'||prospect_id WHERE default_contact_id IS NULL;
-- Preserve ambiguous legacy numbers as shared channels; cell is the sole existing
-- explicit person-directed classification. Preserve all labels and source arrays.
INSERT INTO sales_prospect_contact_numbers(number_id,prospect_id,contact_id,phone_e164,type,label,position,legacy_json)
 SELECT 'number_legacy_'||p.prospect_id||'_'||n.ordinality,p.prospect_id,
 CASE WHEN n.value->>'type'='cell' THEN 'contact_legacy_'||p.prospect_id ELSE NULL END,
 n.value->>'phoneE164',CASE WHEN n.value->>'type' IN ('cell','shop','other') THEN n.value->>'type' ELSE 'other' END,
 COALESCE(n.value->>'label',n.value->>'type','Other'),n.ordinality::int,n.value
 FROM sales_prospects p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.test_original_numbers_json,p.numbers_json)) WITH ORDINALITY n(value,ordinality)
 WHERE n.value->>'phoneE164' ~ '^\+[1-9][0-9]{7,14}$'
 AND NOT EXISTS(SELECT 1 FROM sales_prospect_contact_numbers existing WHERE existing.prospect_id=p.prospect_id AND existing.phone_e164=n.value->>'phoneE164')
 ON CONFLICT(number_id) DO NOTHING;
INSERT INTO sales_prospect_contact_numbers(number_id,prospect_id,phone_e164,type,label,position)
 SELECT 'number_primary_'||p.prospect_id,p.prospect_id,COALESCE(p.test_original_phone_e164,p.phone_e164),'shop','Shop',0
 FROM sales_prospects p WHERE NOT EXISTS(SELECT 1 FROM sales_prospect_contact_numbers n WHERE n.prospect_id=p.prospect_id AND n.phone_e164=COALESCE(p.test_original_phone_e164,p.phone_e164))
 ON CONFLICT(number_id) DO NOTHING;
INSERT INTO sales_prospect_identities(prospect_id,identity_type,identity_value)
 SELECT prospect_id,'phone',phone_e164 FROM sales_prospect_contact_numbers ON CONFLICT DO NOTHING;
INSERT INTO sales_prospect_identities(prospect_id,identity_type,identity_value)
 SELECT prospect_id,'domain',sales_website_domain(website_url) FROM sales_prospects WHERE sales_website_domain(website_url) IS NOT NULL ON CONFLICT DO NOTHING;
-- Recover historical destinations when actually recorded, excluding immutable test calls.
INSERT INTO sales_prospect_identities(prospect_id,identity_type,identity_value)
 SELECT prospect_id,'phone',COALESCE(dialed_number,metadata_json->>'prospect_number') FROM sales_call_sessions
 WHERE NOT COALESCE((metadata_json->>'phone_test_mode')::boolean,FALSE)
 AND COALESCE(dialed_number,metadata_json->>'prospect_number') ~ '^\+[1-9][0-9]{7,14}$' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION sales_company_contact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT; enabled BOOLEAN; phone_change BOOLEAN;
BEGIN
 pid:=CASE WHEN TG_OP='DELETE' THEN OLD.prospect_id ELSE NEW.prospect_id END;
 SELECT phone_test_mode INTO enabled FROM sales_dialer_config WHERE id=TRUE FOR SHARE;
 PERFORM 1 FROM sales_prospects WHERE prospect_id=pid FOR UPDATE;
 IF TG_OP='UPDATE' AND NEW.prospect_id IS DISTINCT FROM OLD.prospect_id THEN RAISE EXCEPTION 'Contact ownership cannot change.' USING ERRCODE='P5901'; END IF;
 IF TG_TABLE_NAME='sales_prospect_contact_numbers' THEN
  phone_change:=TG_OP<>'UPDATE';
  IF TG_OP='UPDATE' THEN phone_change:=(NEW.phone_e164,NEW.contact_id,NEW.type,NEW.label,NEW.position,NEW.archived_at) IS DISTINCT FROM (OLD.phone_e164,OLD.contact_id,OLD.type,OLD.label,OLD.position,OLD.archived_at); END IF;
 ELSE
  phone_change:=TG_OP<>'UPDATE';
  IF TG_OP='UPDATE' THEN phone_change:=NEW.archived_at IS DISTINCT FROM OLD.archived_at; END IF;
  IF TG_OP<>'DELETE' THEN
   SELECT COALESCE(jsonb_agg(DISTINCT lower(trim(e))),'[]'::jsonb) INTO NEW.email_history_json
   FROM jsonb_array_elements_text((CASE WHEN TG_OP='UPDATE' THEN OLD.email_history_json||jsonb_build_array(OLD.email) ELSE '[]'::jsonb END)||jsonb_build_array(NEW.email)) e
   WHERE NULLIF(trim(e),'') IS NOT NULL;
  END IF;
 END IF;
 IF enabled AND phone_change THEN RAISE EXCEPTION 'Restore original Sales phones before adding, removing or changing contact phones.' USING ERRCODE='P5701'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive Sales contacts and numbers instead of deleting history.' USING ERRCODE='P5901'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_company_contacts_guard ON sales_prospect_contacts;
CREATE TRIGGER sales_company_contacts_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_prospect_contacts FOR EACH ROW EXECUTE FUNCTION sales_company_contact_guard();
DROP TRIGGER IF EXISTS sales_company_numbers_guard ON sales_prospect_contact_numbers;
CREATE TRIGGER sales_company_numbers_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_prospect_contact_numbers FOR EACH ROW EXECUTE FUNCTION sales_company_contact_guard();

CREATE OR REPLACE FUNCTION sales_company_default_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid TEXT; target TEXT;
BEGIN
 pid:=CASE WHEN TG_TABLE_NAME='sales_prospects' THEN NEW.prospect_id ELSE COALESCE(NEW.prospect_id,OLD.prospect_id) END;
 SELECT default_contact_id INTO target FROM sales_prospects WHERE prospect_id=pid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF target IS NULL OR NOT EXISTS(SELECT 1 FROM sales_prospect_contacts WHERE prospect_id=pid AND contact_id=target AND archived_at IS NULL) THEN
  RAISE EXCEPTION 'Choose one active default contact.' USING ERRCODE='P5902';
 END IF;
 IF EXISTS(SELECT 1 FROM sales_prospect_contact_numbers n JOIN sales_prospect_contacts c USING(prospect_id,contact_id) WHERE n.prospect_id=pid AND n.archived_at IS NULL AND c.archived_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Archive a removed contact phone in the same save.' USING ERRCODE='P5902';
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sales_company_default_valid ON sales_prospects;
CREATE CONSTRAINT TRIGGER sales_company_default_valid AFTER INSERT OR UPDATE ON sales_prospects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_company_default_guard();
DROP TRIGGER IF EXISTS sales_contact_default_valid ON sales_prospect_contacts;
CREATE CONSTRAINT TRIGGER sales_contact_default_valid AFTER INSERT OR UPDATE ON sales_prospect_contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_company_default_guard();

-- Legacy writers (including incoming stubs) still get a real default contact.
CREATE OR REPLACE FUNCTION sales_company_seed_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name,last_name,email,title,legacy_name,legacy_owner_first_name)
 VALUES('contact_legacy_'||NEW.prospect_id,NEW.prospect_id,COALESCE(NULLIF(split_part(trim(NEW.contact_name),' ',1),''),NEW.owner_first_name,''),
 CASE WHEN position(' ' IN trim(NEW.contact_name))>0 THEN substring(trim(NEW.contact_name) FROM position(' ' IN trim(NEW.contact_name))+1) ELSE '' END,
 NEW.contact_email,NEW.metadata_json->>'contactRole',NEW.contact_name,NEW.owner_first_name);
 INSERT INTO sales_prospect_contact_numbers(number_id,prospect_id,contact_id,phone_e164,type,label,position,legacy_json)
 SELECT 'number_legacy_'||NEW.prospect_id||'_'||n.ordinality,NEW.prospect_id,CASE WHEN n.value->>'type'='cell' THEN 'contact_legacy_'||NEW.prospect_id ELSE NULL END,
 n.value->>'phoneE164',CASE WHEN n.value->>'type' IN ('cell','shop','other') THEN n.value->>'type' ELSE 'other' END,COALESCE(n.value->>'label',n.value->>'type','Other'),n.ordinality::int,n.value
 FROM jsonb_array_elements(NEW.numbers_json) WITH ORDINALITY n(value,ordinality) WHERE n.value->>'phoneE164' ~ '^\+[1-9][0-9]{7,14}$';
 INSERT INTO sales_prospect_contact_numbers(number_id,prospect_id,phone_e164,type,label)
 SELECT 'number_primary_'||NEW.prospect_id,NEW.prospect_id,NEW.phone_e164,'shop','Shop'
 WHERE NOT EXISTS(SELECT 1 FROM sales_prospect_contact_numbers WHERE prospect_id=NEW.prospect_id AND phone_e164=NEW.phone_e164);
 UPDATE sales_prospects SET default_contact_id='contact_legacy_'||NEW.prospect_id WHERE prospect_id=NEW.prospect_id;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sales_company_seed ON sales_prospects;
CREATE TRIGGER sales_company_seed AFTER INSERT ON sales_prospects FOR EACH ROW EXECUTE FUNCTION sales_company_seed_contact();

CREATE OR REPLACE FUNCTION sales_company_retain_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='sales_prospect_contact_numbers' THEN
  INSERT INTO sales_prospect_identities(prospect_id,identity_type,identity_value) VALUES(NEW.prospect_id,'phone',NEW.phone_e164) ON CONFLICT DO NOTHING;
  UPDATE sales_prospects SET do_not_call=do_not_call WHERE prospect_id=NEW.prospect_id;
 ELSE
  IF sales_website_domain(NEW.website_url) IS NOT NULL THEN INSERT INTO sales_prospect_identities(prospect_id,identity_type,identity_value) VALUES(NEW.prospect_id,'domain',sales_website_domain(NEW.website_url)) ON CONFLICT DO NOTHING; END IF;
  IF TG_OP='UPDATE' AND sales_website_domain(OLD.website_url) IS NOT NULL THEN INSERT INTO sales_prospect_identities(prospect_id,identity_type,identity_value) VALUES(NEW.prospect_id,'domain',sales_website_domain(OLD.website_url)) ON CONFLICT DO NOTHING; END IF;
 END IF;
 INSERT INTO sales_dnc_registry(identity_type,identity_value,reason)
 SELECT i.identity_type,i.identity_value,COALESCE(p.dnc_reason,'asked_not_to_be_called') FROM sales_prospect_identities i JOIN sales_prospects p USING(prospect_id)
 WHERE i.prospect_id=NEW.prospect_id AND p.do_not_call ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sales_company_phone_identity ON sales_prospect_contact_numbers;
CREATE TRIGGER sales_company_phone_identity AFTER INSERT OR UPDATE ON sales_prospect_contact_numbers FOR EACH ROW EXECUTE FUNCTION sales_company_retain_identity();
DROP TRIGGER IF EXISTS sales_company_domain_identity ON sales_prospects;
CREATE TRIGGER sales_company_domain_identity AFTER INSERT OR UPDATE ON sales_prospects FOR EACH ROW EXECUTE FUNCTION sales_company_retain_identity();

CREATE OR REPLACE FUNCTION sales_company_call_contact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.prospect_id IS DISTINCT FROM OLD.prospect_id AND (OLD.metadata_json->'contact_snapshot' IS NOT NULL OR OLD.metadata_json->'contact_id' IS NOT NULL))
 OR NEW.metadata_json->'contact_snapshot' IS DISTINCT FROM OLD.metadata_json->'contact_snapshot'
 OR NEW.metadata_json->'contact_id' IS DISTINCT FROM OLD.metadata_json->'contact_id'
 OR NEW.metadata_json->'number_id' IS DISTINCT FROM OLD.metadata_json->'number_id'
 OR NEW.selected_number_original IS DISTINCT FROM OLD.selected_number_original THEN
  RAISE EXCEPTION 'Call contact and selected phone cannot change.' USING ERRCODE='P5903';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_company_call_contact_guard ON sales_call_sessions;
CREATE TRIGGER sales_company_call_contact_guard BEFORE UPDATE ON sales_call_sessions FOR EACH ROW EXECUTE FUNCTION sales_company_call_contact_immutable();

CREATE OR REPLACE FUNCTION sales_enforce_dnc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matched_reason TEXT; number_value JSONB; identity_phone TEXT; identity_numbers JSONB;
BEGIN
 identity_phone:=COALESCE(NEW.test_original_phone_e164,NEW.phone_e164);
 identity_numbers:=COALESCE(NEW.test_original_numbers_json,NEW.numbers_json);
 IF TG_OP='UPDATE' AND OLD.do_not_call THEN NEW.do_not_call:=TRUE; NEW.dnc_reason:=COALESCE(OLD.dnc_reason,NEW.dnc_reason,'asked_not_to_be_called'); END IF;
 SELECT reason INTO matched_reason FROM sales_dnc_registry WHERE
 (identity_type='phone' AND (identity_value=identity_phone OR EXISTS(SELECT 1 FROM jsonb_array_elements(identity_numbers) n WHERE n->>'phoneE164'=identity_value)))
 OR (identity_type='domain' AND identity_value=sales_website_domain(NEW.website_url))
 OR EXISTS(SELECT 1 FROM sales_prospect_identities i WHERE i.prospect_id=NEW.prospect_id AND i.identity_type=sales_dnc_registry.identity_type AND i.identity_value=sales_dnc_registry.identity_value) LIMIT 1;
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


CREATE OR REPLACE FUNCTION sales_v2_call_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id BIGINT;
BEGIN
 IF NEW.state IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled') THEN RETURN NEW; END IF;
 PERFORM id FROM admin_users WHERE id=NEW.admin_user_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM sales_call_sessions c WHERE c.admin_user_id=NEW.admin_user_id AND c.sales_call_id<>NEW.sales_call_id AND c.state NOT IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled')) THEN RAISE EXCEPTION 'rep_call_active' USING ERRCODE='P5601'; END IF;
 SELECT assigned_rep_user_id INTO owner_id FROM sales_prospects WHERE prospect_id=NEW.prospect_id;
 IF owner_id IS NOT NULL AND owner_id IS DISTINCT FROM NEW.admin_user_id AND NEW.metadata_json->>'receptionist_fallback' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'prospect_owned_by_other_rep' USING ERRCODE='P5602'; END IF;
 IF NEW.metadata_json->>'direction' IS DISTINCT FROM 'inbound' AND EXISTS(SELECT 1 FROM sales_prospect_identities i JOIN sales_dnc_registry r USING(identity_type,identity_value) WHERE i.prospect_id=NEW.prospect_id) THEN RAISE EXCEPTION 'prospect_do_not_call' USING ERRCODE='P5603'; END IF;
 IF EXISTS(SELECT 1 FROM sales_prospects p JOIN sales_dnc_registry r ON (r.identity_type='phone' AND (r.identity_value=COALESCE(p.test_original_phone_e164,p.phone_e164) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p.test_original_numbers_json,p.numbers_json)) n WHERE n->>'phoneE164'=r.identity_value))) OR (r.identity_type='domain' AND r.identity_value=sales_website_domain(p.website_url)) WHERE p.prospect_id=NEW.prospect_id) AND NEW.metadata_json->>'direction' IS DISTINCT FROM 'inbound' THEN RAISE EXCEPTION 'prospect_do_not_call' USING ERRCODE='P5603'; END IF;
 NEW.dialed_number:=COALESCE(NEW.dialed_number,NEW.metadata_json->>'prospect_number');
 RETURN NEW;
END $$;

-- Every normalized phone write updates the compatibility aggregate in the same
-- transaction. Preserve unknown legacy JSON attributes on unchanged phones.
CREATE OR REPLACE FUNCTION sales_company_refresh_numbers() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p sales_prospects%ROWTYPE; aggregate_numbers JSONB; primary_phone TEXT;
BEGIN
 SELECT * INTO p FROM sales_prospects WHERE prospect_id=NEW.prospect_id FOR UPDATE;
 IF NOT FOUND OR p.test_original_phone_e164 IS NOT NULL THEN RETURN NULL; END IF;
 SELECT COALESCE(jsonb_agg(v.value ORDER BY v.position,v.number_id),'[]'::jsonb) INTO aggregate_numbers FROM (
  SELECT DISTINCT ON (n.phone_e164) n.number_id,n.position,
   n.legacy_json || COALESCE((SELECT item FROM jsonb_array_elements(p.numbers_json) item WHERE item->>'phoneE164'=n.phone_e164 LIMIT 1),'{}'::jsonb)
   ||jsonb_build_object('phoneE164',n.phone_e164,'type',n.type,'label',n.label) AS value
  FROM sales_prospect_contact_numbers n LEFT JOIN sales_prospect_contacts c ON c.prospect_id=n.prospect_id AND c.contact_id=n.contact_id
  WHERE n.prospect_id=p.prospect_id AND n.archived_at IS NULL AND (n.contact_id IS NULL OR c.archived_at IS NULL)
  ORDER BY n.phone_e164,n.position,n.number_id
 ) v;
 IF jsonb_array_length(aggregate_numbers)=0 THEN RETURN NULL; END IF;
 primary_phone:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(aggregate_numbers) n WHERE n->>'phoneE164'=p.phone_e164) THEN p.phone_e164 ELSE aggregate_numbers->0->>'phoneE164' END;
 UPDATE sales_prospects SET numbers_json=aggregate_numbers,phone_e164=primary_phone WHERE prospect_id=p.prospect_id AND (numbers_json IS DISTINCT FROM aggregate_numbers OR phone_e164 IS DISTINCT FROM primary_phone);
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sales_company_number_projection ON sales_prospect_contact_numbers;
CREATE TRIGGER sales_company_number_projection AFTER INSERT OR UPDATE ON sales_prospect_contact_numbers FOR EACH ROW EXECUTE FUNCTION sales_company_refresh_numbers();

-- Existing DNC companies also suppress every newly recovered historical identity.
INSERT INTO sales_dnc_registry(identity_type,identity_value,reason)
 SELECT i.identity_type,i.identity_value,COALESCE(p.dnc_reason,'asked_not_to_be_called')
 FROM sales_prospect_identities i JOIN sales_prospects p USING(prospect_id) WHERE p.do_not_call ON CONFLICT DO NOTHING;
