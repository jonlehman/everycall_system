ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS default_trial_days INTEGER NOT NULL DEFAULT 30;

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS billing_plans_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS lead_rate_cents INTEGER;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS included_lead_count INTEGER;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS lead_rate_override_cents INTEGER;
