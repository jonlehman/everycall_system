-- Prospective, expand-only Sales business history. No source-row backfill.
CREATE TABLE sales_change_history_capture (
 id boolean PRIMARY KEY DEFAULT TRUE CHECK(id),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO sales_change_history_capture(id) VALUES(TRUE);
CREATE TABLE sales_change_history (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 transaction_id text NOT NULL,
 request_id text,
 actor_kind text NOT NULL CHECK(actor_kind IN ('human','system')),
 actor_id text, actor_name text NOT NULL, actor_role text NOT NULL,
 entity_type text NOT NULL, entity_id text NOT NULL,
 prospect_id text, company_name text, contact_id text, sales_call_id text, number_id text,
 field_path text NOT NULL,
 action text NOT NULL CHECK(action IN ('create','update','clear','archive','delete')),
 old_present boolean NOT NULL, new_present boolean NOT NULL,
 old_value jsonb, new_value jsonb
);
CREATE INDEX sales_change_history_time_idx ON sales_change_history(occurred_at DESC,event_id DESC);
CREATE INDEX sales_change_history_company_idx ON sales_change_history(prospect_id,occurred_at DESC,event_id DESC);
CREATE INDEX sales_change_history_actor_idx ON sales_change_history(actor_id,occurred_at DESC,event_id DESC);
REVOKE ALL ON sales_change_history,sales_change_history_capture FROM PUBLIC;
CREATE FUNCTION sales_change_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND TG_TABLE_NAME='sales_change_history' AND pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'sales_change_history_is_append_only' USING ERRCODE='P6601';
END $$;
CREATE TRIGGER sales_change_history_immutable_row BEFORE INSERT OR UPDATE OR DELETE ON sales_change_history FOR EACH ROW EXECUTE FUNCTION sales_change_history_immutable();
CREATE TRIGGER sales_change_history_immutable_truncate BEFORE TRUNCATE ON sales_change_history FOR EACH STATEMENT EXECUTE FUNCTION sales_change_history_immutable();
CREATE TRIGGER sales_change_history_capture_immutable BEFORE INSERT OR UPDATE OR DELETE ON sales_change_history_capture FOR EACH ROW EXECUTE FUNCTION sales_change_history_immutable();
CREATE TRIGGER sales_change_history_capture_truncate BEFORE TRUNCATE ON sales_change_history_capture FOR EACH STATEMENT EXECUTE FUNCTION sales_change_history_immutable();
CREATE FUNCTION sales_capture_field_changes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 before_row jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 after_row jsonb := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
 source_row jsonb := CASE WHEN TG_OP='DELETE' THEN before_row ELSE after_row END;
 actor jsonb := COALESCE(NULLIF(current_setting('everycall.sales_actor',TRUE),''),'{}')::jsonb;
 field text; before_value jsonb; after_value jsonb; company_id text; company_label text; call_id text;
 entity_key text; contact_key text; number_key text; human boolean;
BEGIN
 human := actor->>'kind'='human' AND NULLIF(actor->>'id','') IS NOT NULL AND NULLIF(actor->>'name','') IS NOT NULL AND actor->>'role' IN ('admin','super_admin','sales');
 company_id := source_row->>'prospect_id';
 call_id := CASE WHEN TG_ARGV[0]='call' THEN source_row->>'sales_call_id' ELSE source_row->>'sales_call_id' END;
 IF company_id IS NULL AND call_id IS NOT NULL THEN SELECT prospect_id INTO company_id FROM sales_call_sessions WHERE sales_call_id=call_id; END IF;
 company_label := source_row->>'business_name';
 IF company_id IS NOT NULL AND company_label IS NULL THEN SELECT business_name INTO company_label FROM sales_prospects WHERE prospect_id=company_id; END IF;
 entity_key := source_row->>TG_ARGV[1];
 IF TG_ARGV[0]='do_not_call' THEN entity_key := (source_row->>'identity_type')||':'||entity_key; END IF;
 contact_key := COALESCE(source_row->>'contact_id',source_row#>>'{metadata_json,contact_id}');
 number_key := COALESCE(source_row->>'number_id',source_row#>>'{metadata_json,number_id}');
 FOREACH field IN ARRAY string_to_array(TG_ARGV[2],' ') LOOP
  before_value := before_row #> string_to_array(field,'.');
  after_value := after_row #> string_to_array(field,'.');
  IF before_value IS NOT DISTINCT FROM after_value THEN CONTINUE; END IF;
  INSERT INTO sales_change_history(transaction_id,request_id,actor_kind,actor_id,actor_name,actor_role,
   entity_type,entity_id,prospect_id,company_name,contact_id,sales_call_id,number_id,field_path,action,old_present,new_present,old_value,new_value)
  VALUES(pg_current_xact_id()::text,NULLIF(actor->>'requestId',''),CASE WHEN human THEN 'human' ELSE 'system' END,
   CASE WHEN human THEN actor->>'id' END,CASE WHEN human THEN actor->>'name' ELSE 'System / unattributed' END,
   CASE WHEN human THEN actor->>'role' ELSE 'system' END,TG_ARGV[0],entity_key,company_id,company_label,contact_key,call_id,number_key,field,
   CASE WHEN TG_OP='INSERT' THEN 'create' WHEN TG_OP='DELETE' THEN 'delete'
    WHEN (field='archived_at' AND after_value<>'null'::jsonb) OR (field='status' AND after_value IN ('"removed"'::jsonb,'"deleted"'::jsonb)) THEN 'archive'
    WHEN after_value IS NULL OR after_value IN ('null'::jsonb,'""'::jsonb) THEN 'clear' ELSE 'update' END,
   before_value IS NOT NULL,after_value IS NOT NULL,before_value,after_value);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER sales_history_sales_prospects AFTER INSERT OR UPDATE OR DELETE ON sales_prospects FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('company','prospect_id','source_key external_ref business_name owner_first_name contact_name contact_email email_permission email_suppressed_at email_suppression_reason smartlead_lead_id smartlead_campaign_id smartlead_status last_email_event_at lead_delivery_email phone_e164 numbers_json website_url business_category competitor_name timezone permission_granted permission_recorded_at suppressed suppression_reason suppressed_at do_not_call do_not_call_at status last_outcome last_outcome_at assigned_rep_user_id callback_at inbound_return dnc_reason removed_reason tenant_key default_contact_id callback_contact_id callback_number_id metadata_json.contactRole metadata_json.metro metadata_json.pitchFlags metadata_json.city metadata_json.region metadata_json.afterHoursClass metadata_json.postedHours metadata_json.callOpenerHook metadata_json.researchNotes');
CREATE TRIGGER sales_history_sales_prospect_contacts AFTER INSERT OR UPDATE OR DELETE ON sales_prospect_contacts FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('contact','contact_id','first_name last_name email title decision_maker influencer notes archived_at');
CREATE TRIGGER sales_history_sales_prospect_contact_numbers AFTER INSERT OR UPDATE OR DELETE ON sales_prospect_contact_numbers FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('number','number_id','contact_id phone_e164 type label position archived_at');
CREATE TRIGGER sales_history_sales_prospect_notes AFTER INSERT OR UPDATE OR DELETE ON sales_prospect_notes FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('company_note','sales_prospect_note_id','body sales_call_id');
CREATE TRIGGER sales_history_sales_call_sessions AFTER INSERT OR UPDATE OR DELETE ON sales_call_sessions FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('call','sales_call_id','prospect_id admin_user_id state outcome outcome_notes live_notes callback_at dialed_number started_at connected_at demo_started_at demo_ended_at ended_at link_sent_at booked_at paid_at metadata_json.dispositions');
CREATE TRIGGER sales_history_sales_dnc_registry AFTER INSERT OR UPDATE OR DELETE ON sales_dnc_registry FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('do_not_call','identity_value','identity_type identity_value reason');
CREATE TRIGGER sales_history_sales_dialer_config AFTER INSERT OR UPDATE OR DELETE ON sales_dialer_config FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('settings','id','phone_test_mode custom_signup_amount_enabled scripts_json.opener scripts_json.if_interested scripts_json.if_voicemail scripts_json.talk_discovery scripts_json.handoff scripts_json.objections scripts_json.no_time scripts_json.gatekeeper scripts_json.while_you_listen scripts_json.exit_line scripts_json.close scripts_json.close_decline');
CREATE TRIGGER sales_history_sales_operator_settings AFTER INSERT OR UPDATE OR DELETE ON sales_operator_settings FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('operator','admin_user_id','display_name caller_id_number active');
CREATE TRIGGER sales_history_sales_setup_bookings AFTER INSERT OR UPDATE OR DELETE ON sales_setup_bookings FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('booking','booking_id','sales_call_id rep_user_id calendar_owner starts_at ends_at attendee_email status paid_at_booking');
CREATE TRIGGER sales_history_sales_checkout_sessions AFTER INSERT OR UPDATE OR DELETE ON sales_checkout_sessions FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('checkout','checkout_id','sales_call_id rep_user_id channel recipient amount_cents status paid_at activation_status tenant_key is_test');
CREATE TRIGGER sales_history_sales_incoming_calls AFTER INSERT OR UPDATE OR DELETE ON sales_incoming_calls FOR EACH ROW EXECUTE FUNCTION sales_capture_field_changes('incoming_call','incoming_id','phone_e164 rep_user_id prospect_id sales_call_id state message');
