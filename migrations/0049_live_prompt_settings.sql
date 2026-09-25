-- Existing tenants have no row and retain their current Live prompt until they
-- explicitly confirm v20.1. New tenants receive a pending row at onboarding.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS live_prompt_mode TEXT NOT NULL DEFAULT 'legacy'
  CHECK (live_prompt_mode IN ('legacy', 'pending_v20', 'v20_1'));

CREATE TABLE IF NOT EXISTS tenant_live_prompt_settings (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'pending_v20' CHECK (mode IN ('legacy', 'pending_v20', 'v20_1')),
  callback_role TEXT,
  callback_role_does TEXT,
  confirmed_role TEXT,
  confirmed_role_does TEXT,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_hash TEXT,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    mode <> 'v20_1' OR (
      NULLIF(BTRIM(callback_role), '') IS NOT NULL
      AND NULLIF(BTRIM(callback_role_does), '') IS NOT NULL
      AND callback_role = confirmed_role
      AND callback_role_does = confirmed_role_does
      AND confirmed_by IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND confirmed_hash IS NOT NULL
    )
  )
);
