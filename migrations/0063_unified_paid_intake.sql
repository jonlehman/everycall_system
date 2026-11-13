-- UPIB-001–014. Additive only: historical charges and provider receipts remain intact.
CREATE TABLE paid_intakes (
 intake_id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, payload_json JSONB NOT NULL,
 prospect_id TEXT, intended_tenant_key TEXT, verification_hash TEXT UNIQUE,
 verification_expires_at TIMESTAMPTZ, verified_at TIMESTAMPTZ,
 session_hash TEXT UNIQUE, session_expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX paid_intakes_owner_idx ON paid_intakes(lower(owner_email));
CREATE TABLE paid_purchases (
 purchase_id TEXT PRIMARY KEY, intake_id TEXT NOT NULL REFERENCES paid_intakes(intake_id),
 owner_email TEXT NOT NULL, prospect_id TEXT, tenant_key TEXT,
 plan_code TEXT NOT NULL CHECK(plan_code IN ('starter','growth','pro')),
 billing_interval TEXT NOT NULL CHECK(billing_interval IN ('month','year')),
 currency TEXT NOT NULL DEFAULT 'usd' CHECK(currency='usd'), livemode BOOLEAN NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), setup_amount_cents INTEGER NOT NULL DEFAULT 10000,
 kind TEXT NOT NULL DEFAULT 'setup' CHECK(kind IN ('setup','restart')),
 payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','pending','paid','review')),
 provisioning_status TEXT NOT NULL DEFAULT 'unpaid',
 stripe_customer_id TEXT, stripe_session_id TEXT UNIQUE, stripe_subscription_id TEXT UNIQUE,
 stripe_payment_intent_id TEXT UNIQUE, stripe_invoice_id TEXT UNIQUE, stripe_price_id TEXT,
 checkout_url TEXT, checkout_generation INTEGER NOT NULL DEFAULT 0,
 checkout_started_at TIMESTAMPTZ, checkout_params JSONB, checkout_expires_at TIMESTAMPTZ,
 legacy_checkout_id TEXT UNIQUE, legacy_payment_intent_id TEXT UNIQUE, verified_event_id TEXT, paid_at TIMESTAMPTZ,
 consent_terms_json JSONB, consent_accepted_at TIMESTAMPTZ, customer_started_at TIMESTAMPTZ,
 subscription_params JSONB, subscription_started_at TIMESTAMPTZ,
 recurring_consent_at TIMESTAMPTZ, usage_anchor_at TIMESTAMPTZ, initial_period_end TIMESTAMPTZ,
 lease_until TIMESTAMPTZ, lease_token TEXT, build_id TEXT, last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE paid_intake_sales_references (
 reference_hash TEXT PRIMARY KEY, checkout_id TEXT NOT NULL UNIQUE REFERENCES sales_checkout_sessions(checkout_id),
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE billing_money_reviews (
 stripe_event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, stripe_object_id TEXT NOT NULL,
 tenant_key TEXT, payload_json JSONB NOT NULL, review_status TEXT NOT NULL DEFAULT 'pending',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tenant_billing_accounts ADD COLUMN paid_purchase_id TEXT UNIQUE REFERENCES paid_purchases(purchase_id);
ALTER TABLE tenant_billing_accounts ADD COLUMN usage_anchor_at TIMESTAMPTZ;
ALTER TABLE tenant_billing_accounts ADD COLUMN initial_period_end TIMESTAMPTZ;
ALTER TABLE tenant_billing_accounts ADD COLUMN paid_base_through TIMESTAMPTZ;
ALTER TABLE tenant_billing_accounts ADD COLUMN service_ended_at TIMESTAMPTZ;
ALTER TABLE tenant_billing_accounts ADD COLUMN changed_number_ack_required BOOLEAN NOT NULL DEFAULT FALSE;
-- Default-disabled gate prevents mixed-version rollout or an incomplete inventory from opening sales.
CREATE TABLE paid_intake_release (id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id), enabled BOOLEAN NOT NULL DEFAULT FALSE,
 reviewed_revision TEXT, inventory_reference TEXT, enabled_at TIMESTAMPTZ);
INSERT INTO paid_intake_release(id) VALUES(TRUE);

ALTER TABLE tenant_billing_accounts ADD COLUMN stripe_subscription_status TEXT;

CREATE UNIQUE INDEX paid_purchases_setup_intake ON paid_purchases(intake_id) WHERE kind='setup';
CREATE UNIQUE INDEX paid_purchases_setup_tenant ON paid_purchases(tenant_key) WHERE kind='setup';
CREATE UNIQUE INDEX paid_purchases_pending_restart ON paid_purchases(tenant_key) WHERE kind='restart' AND provisioning_status NOT IN ('complete','review');
CREATE TABLE paid_number_orders (
 purchase_id TEXT PRIMARY KEY REFERENCES paid_purchases(purchase_id), tenant_key TEXT NOT NULL,
 phone_number TEXT NOT NULL UNIQUE, connection_id TEXT NOT NULL, candidate_json JSONB NOT NULL,
 status TEXT NOT NULL CHECK(status IN('submitted','assigned')), submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 provider_order_id TEXT, phone_number_id TEXT, assigned_at TIMESTAMPTZ
);
CREATE TABLE paid_billing_changes (
 operation_id TEXT PRIMARY KEY, tenant_key TEXT NOT NULL, subscription_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('plan','cancel')), request_json JSONB NOT NULL,
 provider_params JSONB, schedule_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX paid_billing_changes_pending ON paid_billing_changes(tenant_key) WHERE status='pending';

CREATE UNIQUE INDEX paid_purchases_setup_prospect ON paid_purchases(prospect_id) WHERE kind='setup' AND livemode=TRUE AND prospect_id IS NOT NULL;
