CREATE TABLE IF NOT EXISTS tenant_bootstrap_profiles (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  website_url TEXT,
  company_description TEXT,
  business_category TEXT,
  source_mode TEXT NOT NULL DEFAULT 'website_first',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_domain_assignments
  ALTER COLUMN subdomain_id DROP NOT NULL;
