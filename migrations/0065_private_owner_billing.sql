-- Owner clarification 2026-11-13: one private operator account, no public plan.
-- Separate ledger/wrapper preserve frozen 0063/0064 and standard purchase rules.
CREATE TABLE private_owner_billing (
 tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) CHECK(tenant_key='creative_dynamic'),
 stripe_customer_id TEXT NOT NULL CHECK(stripe_customer_id='cus_UNTATkOgHvbz4z'),
 stripe_subscription_id TEXT NOT NULL CHECK(stripe_subscription_id='sub_1TOjCdFgMKdd4EaWRmHZ00gE'),
 stripe_price_id TEXT NOT NULL CHECK(stripe_price_id='price_1TOjCWFgMKdd4EaWiiwPcda1'),
 phone_number_id TEXT NOT NULL,
 owner_decision_reference TEXT NOT NULL, evidence_sha256 TEXT NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reviewed_revision TEXT NOT NULL CHECK(reviewed_revision ~ '^[a-f0-9]{40}$'),
 enabled BOOLEAN NOT NULL DEFAULT FALSE, reconciliation_version BIGINT NOT NULL DEFAULT 0,
 current_period_start TIMESTAMPTZ NOT NULL, current_period_end TIMESTAMPTZ NOT NULL,
 paid_through TIMESTAMPTZ NOT NULL, paid_invoice_id TEXT NOT NULL,
 subscription_status TEXT NOT NULL, cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
 first_failed_at TIMESTAMPTZ, grace_ends_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
 amount_owed_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_owed_cents>=0),
 review_required BOOLEAN NOT NULL DEFAULT FALSE,
 verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(current_period_start<current_period_end),
 CHECK((first_failed_at IS NULL AND grace_ends_at IS NULL) OR grace_ends_at=first_failed_at+INTERVAL '5 days')
);
CREATE FUNCTION reserve_private_or_paid_call(p_tenant TEXT,p_call TEXT,p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE(allowed BOOLEAN,reason TEXT,period_id BIGINT) LANGUAGE plpgsql AS $$
DECLARE t RECORD; b RECORD; e RECORD;
BEGIN
 SELECT * INTO t FROM tenants WHERE tenant_key=p_tenant FOR UPDATE;
 SELECT * INTO e FROM private_owner_billing WHERE tenant_key=p_tenant AND enabled;
 IF NOT FOUND THEN RETURN QUERY SELECT * FROM reserve_paid_call(p_tenant,p_call,p_now); RETURN; END IF;
 SELECT * INTO b FROM tenant_billing_accounts WHERE tenant_key=p_tenant;
 IF t.tenant_key IS NULL OR t.status<>'active' OR t.service_access_status<>'enabled'
 OR t.telnyx_release_status IS NOT NULL OR t.telnyx_voice_number_id IS DISTINCT FROM e.phone_number_id
 OR b.paid_purchase_id IS NOT NULL OR b.stripe_customer_id IS DISTINCT FROM e.stripe_customer_id
 OR b.stripe_subscription_id IS DISTINCT FROM e.stripe_subscription_id OR b.stripe_price_id IS DISTINCT FROM e.stripe_price_id
 OR e.review_required OR e.ended_at IS NOT NULL OR e.subscription_status IN('canceled','unpaid','incomplete','incomplete_expired','paused')
 OR (e.cancel_at_period_end AND e.current_period_end<=p_now)
 OR (e.amount_owed_cents>0 AND e.grace_ends_at IS NOT NULL AND e.grace_ends_at<=p_now)
 OR (e.paid_through<=p_now AND NOT COALESCE(e.amount_owed_cents>0 AND e.grace_ends_at>p_now,FALSE)) THEN
   RETURN QUERY SELECT FALSE,'private_owner_billing_restricted'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM calls WHERE call_sid=p_call AND tenant_key=p_tenant AND status<>'completed') THEN
   RETURN QUERY SELECT FALSE,'invalid_call'::TEXT,NULL::BIGINT; RETURN;
 END IF;
 -- Private operator usage remains recorded by the normal call ledger. No public
 -- monthly allowance or automatic overage invoice is created by this exception.
 RETURN QUERY SELECT TRUE,'private_owner_operator_billing'::TEXT,NULL::BIGINT;
END $$;
