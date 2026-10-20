-- Apply before deploying recovery-aware API and worker code. Legacy claims get
-- a 15-minute recovery grace; the trigger fences their late status writes.
BEGIN;
ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS async_jobs_running_lease_idx
  ON async_jobs (lease_expires_at) WHERE status = 'running';

-- Existing email-only invitations can only be bound to a user that already
-- existed when they were issued. Never bind a deleted user's replacement.
UPDATE auth_tokens token SET user_id = u.id
FROM tenant_users u
WHERE token.token_type = 'invite' AND token.user_id IS NULL
  AND u.tenant_key = token.tenant_key AND u.email = token.email
  AND (u.status = 'invited' OR (u.status = 'active' AND u.password_hash IS NULL))
  AND u.created_at <= token.created_at;
-- Active lead destinations must keep receiving alerts before login setup.
-- Their setup capability cannot reset an already-established password.
UPDATE auth_tokens token SET token_type = 'account_setup'
FROM tenant_users u
WHERE token.token_type = 'invite' AND token.user_id = u.id
  AND token.tenant_key = u.tenant_key AND token.email = u.email
  AND u.status = 'active' AND u.password_hash IS NULL;
DELETE FROM auth_tokens WHERE token_type = 'invite' AND user_id IS NULL;

CREATE OR REPLACE FUNCTION revoke_changed_tenant_user_invitations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM auth_tokens WHERE token_type IN ('invite', 'account_setup') AND user_id = OLD.id;
    RETURN OLD;
  END IF;
  IF OLD.email IS DISTINCT FROM NEW.email
     OR OLD.tenant_key IS DISTINCT FROM NEW.tenant_key
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    DELETE FROM auth_tokens WHERE token_type IN ('invite', 'account_setup') AND user_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tenant_user_invitation_revocation ON tenant_users;
CREATE TRIGGER tenant_user_invitation_revocation
  BEFORE UPDATE OR DELETE ON tenant_users
  FOR EACH ROW EXECUTE FUNCTION revoke_changed_tenant_user_invitations();

-- Different Stripe events can refer to the same invoice. Decrement an override
-- once per invoice as well as once per delivery, within the event transaction.
CREATE TABLE IF NOT EXISTS billing_invoice_effects (
  invoice_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION fence_async_job_legacy_writes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.claim_token IS NOT NULL
     AND (NEW.claim_token IS NULL OR NEW.claim_token = OLD.claim_token) THEN
    RAISE EXCEPTION 'async_job_claim_token_required' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS async_job_legacy_fence ON async_jobs;
CREATE TRIGGER async_job_legacy_fence
  BEFORE UPDATE OF status, attempts, locked_at, locked_by, available_at, completed_at, last_error, claim_token ON async_jobs
  FOR EACH ROW EXECUTE FUNCTION fence_async_job_legacy_writes();
-- Durable deletion intent precedes provider submission and survives payment.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_release_status TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_release_number TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_release_number_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_release_job_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_release_requested_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_release_error TEXT;
UPDATE tenants SET telnyx_release_status = CASE WHEN telnyx_voice_status = 'released' THEN 'released' ELSE 'requested' END,
  telnyx_release_number = telnyx_voice_number, telnyx_release_number_id = telnyx_voice_number_id,
  telnyx_release_requested_at = NOW()
WHERE telnyx_release_status IS NULL AND telnyx_voice_status IN ('release_pending', 'release_failed', 'released');
CREATE OR REPLACE FUNCTION guard_voice_release_activation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.telnyx_release_status IN ('requested', 'submitted', 'failed', 'released')
     AND NEW.service_access_status = 'enabled' THEN
    NEW.service_access_status := 'disabled';
    NEW.billing_lock_reason := CASE WHEN NEW.telnyx_release_status = 'released'
      THEN 'voice_number_replacement_required' ELSE 'voice_number_release_pending' END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tenant_voice_release_activation_guard ON tenants;
CREATE TRIGGER tenant_voice_release_activation_guard BEFORE INSERT OR UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION guard_voice_release_activation();
COMMIT;
