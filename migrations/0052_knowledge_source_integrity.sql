-- Apply before the source-integrity code. Existing captures remain NULL because
-- cleaned historical evidence cannot reconstruct original response bytes.
BEGIN;
ALTER TABLE uploaded_documents ADD COLUMN IF NOT EXISTS original_capture_json JSONB;
ALTER TABLE source_intake_items ADD COLUMN IF NOT EXISTS original_capture_json JSONB;
COMMENT ON COLUMN source_intake_items.original_capture_json IS
  'Original fetch bytes (base64), SHA256, URL/status/type/time; separate from budgeted compiler evidence.';

CREATE TABLE IF NOT EXISTS knowledge_build_allocations (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  allocated_at TIMESTAMPTZ NOT NULL,
  build_id TEXT NOT NULL,
  override_actor_id TEXT
);
-- Preserve the rolling window at rollout for every build kind, including
-- document overlays. Failed starts still count.
INSERT INTO knowledge_build_allocations (tenant_key, allocated_at, build_id)
SELECT DISTINCT ON (tenant_key) tenant_key, created_at, build_id
FROM knowledge_builds
ORDER BY tenant_key, created_at DESC, build_id DESC
ON CONFLICT (tenant_key) DO UPDATE
SET allocated_at=EXCLUDED.allocated_at, build_id=EXCLUDED.build_id
WHERE knowledge_build_allocations.allocated_at < EXCLUDED.allocated_at;
COMMIT;
