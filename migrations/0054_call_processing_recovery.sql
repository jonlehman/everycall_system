-- Drain both gateways before applying. Existing voice claims are intentionally
-- terminal: historical commands cannot safely be inferred/replayed.
BEGIN;
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS processing_token TEXT;
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS resource_id TEXT;
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS checkpoints JSONB NOT NULL DEFAULT '{}';
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS raw_payload TEXT;
ALTER TABLE inbound_webhook_events ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS inbound_webhook_resource_idx ON inbound_webhook_events(provider, resource_id, event_type);
-- Fail migration on pre-existing duplicate active calls; reconcile their provider
-- legs before retrying. Do not silently close calls to make the index succeed.
CREATE UNIQUE INDEX IF NOT EXISTS sales_call_sessions_active_prospect_idx
  ON sales_call_sessions(prospect_id)
  WHERE state NOT IN ('closed', 'ended', 'completed', 'failed', 'no_answer', 'voicemail', 'wrong_number', 'not_interested', 'do_not_call', 'canceled', 'cancelled');
COMMIT;
