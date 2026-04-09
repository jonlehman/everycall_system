ALTER TABLE tenant_bootstrap_profiles
  ADD COLUMN IF NOT EXISTS marketing_attribution_json JSONB NOT NULL DEFAULT '{}'::jsonb;
