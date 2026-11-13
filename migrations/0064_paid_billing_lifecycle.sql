-- UPIB-008/010–013. Additive debt, monthly collection, admission and staff support ledgers.
CREATE TABLE billing_invoice_debts (
 stripe_invoice_id TEXT PRIMARY KEY, tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key),
 kind TEXT NOT NULL CHECK(kind IN ('base','overage')), amount_remaining_cents INTEGER NOT NULL CHECK(amount_remaining_cents>=0),
 status TEXT NOT NULL, failed_at TIMESTAMPTZ, hosted_invoice_url TEXT,
 provider_updated_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX billing_invoice_debts_tenant_idx ON billing_invoice_debts(tenant_key);
CREATE TABLE billing_delinquencies (
 tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key), first_failed_at TIMESTAMPTZ,
 grace_ends_at TIMESTAMPTZ, full_suspended_at TIMESTAMPTZ, number_release_at TIMESTAMPTZ,
 restriction TEXT NOT NULL DEFAULT 'normal' CHECK(restriction IN ('normal','grace','included_only','suspended','ended')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE billing_reminder_deliveries (
 tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key), recipient TEXT NOT NULL,
 reminder_kind TEXT NOT NULL, target_day DATE NOT NULL, status TEXT NOT NULL DEFAULT 'sending',
 attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), delivered_at TIMESTAMPTZ,
 PRIMARY KEY(tenant_key,recipient,target_day)
);
ALTER TABLE billing_periods ADD COLUMN invoice_attempted_at TIMESTAMPTZ;
ALTER TABLE billing_periods ADD COLUMN invoice_payload JSONB;
CREATE TABLE billing_call_admissions (
 call_sid TEXT PRIMARY KEY REFERENCES calls(call_sid), tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key),
 billing_period_id BIGINT NOT NULL REFERENCES billing_periods(billing_period_id),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','billable','nonbillable')),
 admitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reconciled_at TIMESTAMPTZ
);
CREATE INDEX billing_call_admissions_period_idx ON billing_call_admissions(billing_period_id,status);
CREATE TABLE staff_support_sessions (
 id TEXT PRIMARY KEY, staff_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 actor_user_id BIGINT NOT NULL REFERENCES admin_users(id), tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL,
 ended_at TIMESTAMPTZ, CHECK(expires_at<=created_at+INTERVAL '1 hour')
);
-- Preserve deletion evidence across reinstatements. A submitted request is never
-- automatically sent again: positive provider absence is required to reconcile.
CREATE TABLE paid_number_releases (
 release_id BIGSERIAL PRIMARY KEY, tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key),
 purchase_id TEXT REFERENCES paid_purchases(purchase_id), reason TEXT NOT NULL,
 phone_number TEXT, phone_number_id TEXT,
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','submitted','uncertain','released')),
 attempted_at TIMESTAMPTZ, reconciled_at TIMESTAMPTZ, provider_job_id TEXT,
 last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX paid_number_release_active_idx ON paid_number_releases(tenant_key) WHERE reconciled_at IS NULL;
CREATE UNIQUE INDEX paid_number_release_restart_idx ON paid_number_releases(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE TABLE paid_setup_bookings (
 booking_id TEXT PRIMARY KEY, tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key),
 purchase_id TEXT NOT NULL REFERENCES paid_purchases(purchase_id), owner_user_id BIGINT NOT NULL REFERENCES tenant_users(id),
 calendar_owner TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 attendee_email TEXT NOT NULL, provider_payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','submitting','uncertain','booked')),
 provider_event_id TEXT, attempted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(tenant_key), CHECK(ends_at=starts_at+INTERVAL '15 minutes')
);

-- The tenant row is the shared lock for entitlement transitions and admissions.
-- Reserve BEFORE answer, counting unresolved calls conservatively until classification.
CREATE FUNCTION reserve_paid_call(p_tenant TEXT,p_call TEXT,p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE(allowed BOOLEAN,reason TEXT,period_id BIGINT) LANGUAGE plpgsql AS $$
DECLARE t RECORD; b RECORD; d RECORD; p RECORD; anchor TIMESTAMPTZ; ws TIMESTAMPTZ; we TIMESTAMPTZ;
 month_index INTEGER; used BIGINT; debt BIGINT; base_debt BIGINT; existing RECORD; call_at TIMESTAMPTZ;
BEGIN
 SELECT * INTO t FROM tenants WHERE tenant_key=p_tenant FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT FALSE,'tenant_missing'::TEXT,NULL::BIGINT; RETURN; END IF;
 SELECT * INTO b FROM tenant_billing_accounts WHERE tenant_key=p_tenant;
 IF b.paid_purchase_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM paid_intake_release WHERE id=TRUE AND enabled=TRUE) THEN
     RETURN QUERY SELECT FALSE,'paid_account_mapping_required'::TEXT,NULL::BIGINT; RETURN;
   END IF;
   RETURN QUERY SELECT COALESCE(t.service_access_status,'enabled')='enabled','legacy'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM paid_purchases WHERE purchase_id=b.paid_purchase_id AND tenant_key=p_tenant AND payment_status='paid' AND livemode=TRUE AND recurring_consent_at IS NOT NULL)
 OR b.usage_anchor_at IS NULL OR b.paid_base_through IS NULL THEN
   RETURN QUERY SELECT FALSE,'payment_required'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 IF t.telnyx_release_status IS NOT NULL OR b.service_ended_at IS NOT NULL
 OR (b.cancel_at_period_end AND b.current_period_end<=p_now) THEN
   RETURN QUERY SELECT FALSE,'service_ended'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 -- A scheduled next-term price is not current entitlement until the canonical
 -- provider subscription is reconciled. Refuse before answering during that
 -- short handoff; do not create/rate a new window with the old plan.
 IF b.pending_plan_code IS NOT NULL AND b.pending_plan_effective_at<=p_now THEN
   RETURN QUERY SELECT FALSE,'plan_transition_reconciliation_required'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 SELECT * INTO d FROM billing_delinquencies WHERE tenant_key=p_tenant;
 SELECT COALESCE(SUM(amount_remaining_cents),0),COALESCE(SUM(amount_remaining_cents) FILTER(WHERE kind='base'),0)
 INTO debt,base_debt FROM billing_invoice_debts WHERE tenant_key=p_tenant AND status IN ('open','uncollectible');
 IF debt>0 AND d.grace_ends_at IS NULL THEN
   RETURN QUERY SELECT FALSE,'delinquency_reconciliation_required'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 IF b.paid_base_through<=p_now AND NOT(debt>0 AND d.grace_ends_at>p_now) THEN
   RETURN QUERY SELECT FALSE,'base_payment_required'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 IF debt>0 AND d.grace_ends_at<=p_now AND NOT(b.billing_interval='year' AND b.paid_base_through>p_now AND base_debt=0) THEN
   RETURN QUERY SELECT FALSE,'billing_suspended'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 anchor:=b.usage_anchor_at;
 -- Call creation fixes its usage window even if initiation is retried at rollover.
 SELECT created_at INTO call_at FROM calls WHERE call_sid=p_call AND tenant_key=p_tenant;
 IF call_at IS NULL THEN RETURN QUERY SELECT FALSE,'invalid_call'::TEXT,NULL::BIGINT; RETURN; END IF;
 IF call_at<anchor THEN RETURN QUERY SELECT FALSE,'usage_before_payment'::TEXT,NULL::BIGINT; RETURN; END IF;
 month_index:=(EXTRACT(YEAR FROM call_at AT TIME ZONE 'UTC')-EXTRACT(YEAR FROM anchor AT TIME ZONE 'UTC'))::INTEGER*12
   +(EXTRACT(MONTH FROM call_at AT TIME ZONE 'UTC')-EXTRACT(MONTH FROM anchor AT TIME ZONE 'UTC'))::INTEGER;
 ws:=((anchor AT TIME ZONE 'UTC')+make_interval(months=>month_index)) AT TIME ZONE 'UTC';
 IF ws>call_at THEN month_index:=month_index-1; END IF;
 ws:=((anchor AT TIME ZONE 'UTC')+make_interval(months=>month_index)) AT TIME ZONE 'UTC';
 we:=((anchor AT TIME ZONE 'UTC')+make_interval(months=>month_index+1)) AT TIME ZONE 'UTC';
 INSERT INTO billing_periods(tenant_key,period_start,period_end,source,plan_code,monthly_amount_cents,included_call_count,call_overage_rate_cents,stripe_subscription_id)
 VALUES(p_tenant,ws,we,'stripe',t.plan_code,COALESCE(b.monthly_amount_cents,0),COALESCE(b.included_call_count,0),COALESCE(b.call_overage_rate_override_cents,b.call_overage_rate_cents,0),b.stripe_subscription_id)
 ON CONFLICT(tenant_key,period_start,period_end) DO NOTHING;
 SELECT * INTO p FROM billing_periods WHERE tenant_key=p_tenant AND period_start=ws AND period_end=we FOR UPDATE;
 IF p.status<>'open' THEN RETURN QUERY SELECT FALSE,'usage_window_closed'::TEXT,p.billing_period_id; RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM calls WHERE call_sid=p_call AND tenant_key=p_tenant AND status<>'completed') THEN
   RETURN QUERY SELECT FALSE,'invalid_call'::TEXT,p.billing_period_id; RETURN;
 END IF;
 SELECT * INTO existing FROM billing_call_admissions WHERE call_sid=p_call;
 IF FOUND THEN
   RETURN QUERY SELECT existing.tenant_key=p_tenant,'already_admitted'::TEXT,existing.billing_period_id; RETURN;
 END IF;
 -- A completed unanswered call cannot consume the included allowance while its
 -- post-call worker is delayed. Honor explicit billable classifications.
 UPDATE billing_call_admissions a SET status='nonbillable',reconciled_at=p_now
 FROM calls c LEFT JOIN billing_call_types ct ON ct.billing_call_type_id=c.billing_call_type_id
 WHERE a.call_sid=c.call_sid AND a.tenant_key=p_tenant AND a.status='reserved'
 AND c.status='completed' AND (ct.counts_toward_usage=FALSE OR (c.answered_at IS NULL AND c.billing_call_type_id IS NULL));
 IF debt>0 AND d.grace_ends_at<=p_now THEN
   SELECT COUNT(*) INTO used FROM calls c LEFT JOIN billing_call_admissions a ON a.call_sid=c.call_sid
   LEFT JOIN billing_call_types ct ON ct.billing_call_type_id=c.billing_call_type_id
   WHERE c.tenant_key=p_tenant AND ((a.billing_period_id=p.billing_period_id) OR (a.call_sid IS NULL AND c.created_at>=ws AND c.created_at<we)) AND c.call_sid<>p_call
   AND (a.status IN ('reserved','billable') OR (a.call_sid IS NULL AND (ct.counts_toward_usage=TRUE OR (c.status<>'completed' AND c.answered_at IS NOT NULL))));
   IF used>=p.included_call_count THEN RETURN QUERY SELECT FALSE,'included_allowance_exhausted'::TEXT,p.billing_period_id; RETURN; END IF;
 END IF;
 INSERT INTO billing_call_admissions(call_sid,tenant_key,billing_period_id) VALUES(p_call,p_tenant,p.billing_period_id);
 RETURN QUERY SELECT TRUE,'admitted'::TEXT,p.billing_period_id;
END $$;
