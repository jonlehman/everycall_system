ALTER TABLE knowledge_builds
  ADD COLUMN IF NOT EXISTS execution_lease_token TEXT,
  ADD COLUMN IF NOT EXISTS execution_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS execution_lease_acquired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_lease_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS knowledge_builds_execution_lease_idx
  ON knowledge_builds (status, execution_lease_expires_at, updated_at)
  WHERE status IN ('queued', 'running', 'ready_to_publish');

COMMENT ON COLUMN knowledge_builds.execution_lease_token IS
  'Durable ownership token for a knowledge-build execution. Safe with transaction-pooled database connections.';

COMMENT ON COLUMN knowledge_builds.execution_lease_expires_at IS
  'Lease expiry used to resume work after a terminated or unhealthy serverless invocation.';
