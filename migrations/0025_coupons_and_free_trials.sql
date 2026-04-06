ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS active_coupon_redemption_id BIGINT;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS coupon_trial_ends_at TIMESTAMPTZ;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS coupon_discount_starts_at TIMESTAMPTZ;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS coupon_discount_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS tenant_billing_accounts_active_coupon_idx
  ON tenant_billing_accounts (active_coupon_redemption_id);

CREATE TABLE IF NOT EXISTS billing_coupons (
  billing_coupon_id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  discount_duration_days INTEGER NOT NULL DEFAULT 0,
  free_trial_days INTEGER NOT NULL DEFAULT 0,
  single_use_global BOOLEAN NOT NULL DEFAULT TRUE,
  max_redemptions INTEGER NOT NULL DEFAULT 1,
  redeem_by TIMESTAMPTZ,
  notes TEXT,
  created_by_admin_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_coupons_status_idx
  ON billing_coupons (status, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_coupon_plan_scopes (
  billing_coupon_plan_scope_id BIGSERIAL PRIMARY KEY,
  billing_coupon_id BIGINT NOT NULL REFERENCES billing_coupons(billing_coupon_id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (billing_coupon_id, plan_code)
);

CREATE INDEX IF NOT EXISTS billing_coupon_plan_scopes_coupon_idx
  ON billing_coupon_plan_scopes (billing_coupon_id, plan_code);

CREATE TABLE IF NOT EXISTS billing_coupon_redemptions (
  billing_coupon_redemption_id BIGSERIAL PRIMARY KEY,
  billing_coupon_id BIGINT NOT NULL REFERENCES billing_coupons(billing_coupon_id) ON DELETE RESTRICT,
  tenant_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_starts_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  discount_starts_at TIMESTAMPTZ,
  discount_ends_at TIMESTAMPTZ,
  snapshot_plan_code TEXT,
  snapshot_monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  snapshot_overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  snapshot_discount_duration_days INTEGER NOT NULL DEFAULT 0,
  snapshot_free_trial_days INTEGER NOT NULL DEFAULT 0,
  stripe_discount_id TEXT,
  stripe_coupon_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (billing_coupon_id)
);

CREATE INDEX IF NOT EXISTS billing_coupon_redemptions_tenant_idx
  ON billing_coupon_redemptions (tenant_key, status, redeemed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS billing_coupon_redemptions_active_tenant_idx
  ON billing_coupon_redemptions (tenant_key)
  WHERE status = 'active';

ALTER TABLE billing_periods
  ADD COLUMN IF NOT EXISTS billing_coupon_redemption_id BIGINT REFERENCES billing_coupon_redemptions(billing_coupon_redemption_id);

ALTER TABLE billing_periods
  ADD COLUMN IF NOT EXISTS billing_coupon_id BIGINT REFERENCES billing_coupons(billing_coupon_id);

ALTER TABLE billing_periods
  ADD COLUMN IF NOT EXISTS coupon_code TEXT;

ALTER TABLE billing_periods
  ADD COLUMN IF NOT EXISTS monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE billing_periods
  ADD COLUMN IF NOT EXISTS overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS billing_periods_coupon_idx
  ON billing_periods (billing_coupon_redemption_id, period_start DESC);
