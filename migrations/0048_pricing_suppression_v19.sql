ALTER TABLE kb_tenant_facts
  DROP CONSTRAINT IF EXISTS kb_tenant_facts_kind_check;

ALTER TABLE kb_tenant_facts
  ADD CONSTRAINT kb_tenant_facts_kind_check
  CHECK (kind IN ('confirmed', 'corrected', 'authored'));

ALTER TABLE kb_tenant_facts
  ADD COLUMN IF NOT EXISTS price_authorized_by_tenant BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS price_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_authorized_by TEXT,
  ADD CONSTRAINT kb_tenant_facts_price_authorization_check
  CHECK (
    (price_authorized_by_tenant = FALSE
      AND price_authorized_at IS NULL
      AND price_authorized_by IS NULL)
    OR
    (price_authorized_by_tenant = TRUE
      AND price_authorized_at IS NOT NULL
      AND NULLIF(BTRIM(price_authorized_by), '') IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS kb_pricing_safety_artifacts (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('candidate', 'card')),
  target_id TEXT NOT NULL,
  value_json JSONB NOT NULL CHECK (
    jsonb_typeof(value_json) = 'object'
    AND jsonb_typeof(value_json->'suppression_required') = 'boolean'
    AND value_json->>'pricing_kind' IN ('conditional', 'fixed', 'none')
  ),
  classifier_model TEXT NOT NULL,
  classifier_version TEXT NOT NULL,
  classifier_input_hash TEXT NOT NULL,
  source_verifier_model TEXT NOT NULL,
  source_verifier_version TEXT NOT NULL,
  source_verifier_input_hash TEXT NOT NULL,
  restatement_model TEXT,
  restatement_version TEXT,
  restatement_input_hash TEXT,
  restatement_verifier_model TEXT,
  restatement_verifier_version TEXT,
  restatement_verifier_input_hash TEXT,
  processing_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (value_json->>'suppression_required')::boolean = FALSE
    OR (
      (value_json->>'suppression_required')::boolean = TRUE
      AND restatement_model IS NOT NULL
      AND restatement_version IS NOT NULL
      AND restatement_input_hash IS NOT NULL
      AND restatement_verifier_model IS NOT NULL
      AND restatement_verifier_version IS NOT NULL
      AND restatement_verifier_input_hash IS NOT NULL
    )
  ),
  UNIQUE (tenant_key, build_id, target_type, target_id, processing_version)
);

CREATE INDEX IF NOT EXISTS kb_pricing_safety_artifacts_current_idx
  ON kb_pricing_safety_artifacts (
    tenant_key, build_id, processing_version, target_type, target_id, created_at DESC, id DESC
  );

DROP TRIGGER IF EXISTS kb_pricing_safety_artifacts_append_only_guard
  ON kb_pricing_safety_artifacts;
CREATE TRIGGER kb_pricing_safety_artifacts_append_only_guard
  BEFORE UPDATE OR DELETE ON kb_pricing_safety_artifacts
  FOR EACH ROW EXECUTE FUNCTION everycall_guard_kb_immutable_rows();

CREATE TABLE IF NOT EXISTS kb_tenant_notices (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  notice_type TEXT NOT NULL CHECK (notice_type IN ('pricing_detected')),
  source_identity TEXT NOT NULL,
  current_content_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload_json) = 'object'),
  raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_hash TEXT,
  UNIQUE (tenant_key, notice_type, source_identity)
);

CREATE INDEX IF NOT EXISTS kb_tenant_notices_open_idx
  ON kb_tenant_notices (tenant_key, notice_type, raised_at DESC)
  WHERE acknowledged_at IS NULL OR acknowledged_hash IS DISTINCT FROM current_content_hash;

ALTER TABLE kb_correction_proposals
  ALTER COLUMN slot_index DROP NOT NULL;

ALTER TABLE kb_correction_proposals
  ADD COLUMN IF NOT EXISTS proposal_kind TEXT NOT NULL DEFAULT 'correction'
  CHECK (proposal_kind IN ('correction', 'create'));

CREATE OR REPLACE FUNCTION everycall_guard_kb_price_authorization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  authorization_changed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    authorization_changed := NEW.price_authorized_by_tenant = TRUE;
  ELSIF TG_OP = 'UPDATE' THEN
    authorization_changed := NEW.price_authorized_by_tenant IS DISTINCT FROM OLD.price_authorized_by_tenant
      OR NEW.price_authorized_at IS DISTINCT FROM OLD.price_authorized_at
      OR NEW.price_authorized_by IS DISTINCT FROM OLD.price_authorized_by;
  END IF;

  IF authorization_changed
     AND current_setting('app.tenant_edit_context', TRUE) IS DISTINCT FROM 'true'
     AND current_setting('app.purge_context', TRUE) IS DISTINCT FROM 'true'
  THEN
    RAISE EXCEPTION 'protected write to tenant price authorization'
      USING ERRCODE = 'P9K03',
            DETAIL = jsonb_build_object(
              'tenant_key', NEW.tenant_key,
              'tenant_fact_id', NEW.id,
              'operation', TG_OP,
              'application_name', current_setting('application_name', TRUE),
              'request_id', current_setting('app.request_id', TRUE)
            )::TEXT;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kb_tenant_facts_price_authorization_guard ON kb_tenant_facts;
CREATE TRIGGER kb_tenant_facts_price_authorization_guard
  BEFORE INSERT OR UPDATE
  ON kb_tenant_facts
  FOR EACH ROW EXECUTE FUNCTION everycall_guard_kb_price_authorization();

COMMENT ON TABLE kb_pricing_safety_artifacts IS
  'Append-only candidate/card pricing-safety verdicts and validated figure-free restatements. Missing or stale rows are unsafe.';
COMMENT ON TABLE kb_tenant_notices IS
  'Build-independent tenant notices keyed to durable source identity; content changes reopen one durable notice.';
