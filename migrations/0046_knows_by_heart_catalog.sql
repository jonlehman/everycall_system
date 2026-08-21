-- Canonical Receptionist Part 9 (Rev H): durable Knows By Heart catalog,
-- tenant-owned selection snapshots, and materialized Layer 2 prompt block.

CREATE TABLE IF NOT EXISTS kb_catalog_revisions (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  knowledge_build_id TEXT NOT NULL UNIQUE REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  processing_version TEXT NOT NULL,
  source_snapshot_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kb_catalog_revisions_tenant_created_idx
  ON kb_catalog_revisions (tenant_key, created_at DESC);

CREATE TABLE IF NOT EXISTS kb_candidates (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES kb_catalog_revisions(id) ON DELETE CASCADE,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  source_knowledge_fact_id TEXT REFERENCES knowledge_build_facts(knowledge_fact_id) ON DELETE CASCADE,
  lineage_key TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  spoken_text TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN (
    'services', 'service_area', 'hours', 'estimate_policy',
    'repairs_service', 'emergency_availability', 'contact_scheduling',
    'payment_financing', 'warranty_guarantee', 'licensing_insurance',
    'company_background', 'pricing'
  )),
  polarity TEXT NOT NULL DEFAULT 'affirm' CHECK (polarity IN ('affirm', 'deny')),
  quantities_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quantities_json) = 'array'),
  boundaries_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(boundaries_json) = 'array'),
  qualifiers_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(qualifiers_json) = 'array'),
  content_hash TEXT NOT NULL,
  subject_text TEXT NOT NULL,
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_refs_json) = 'array'),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'rewrite_failed', 'validation_failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (revision_id, lineage_key),
  UNIQUE (revision_id, content_hash)
);

CREATE INDEX IF NOT EXISTS kb_candidates_revision_category_idx
  ON kb_candidates (revision_id, category, status);
CREATE INDEX IF NOT EXISTS kb_candidates_tenant_lineage_idx
  ON kb_candidates (tenant_key, lineage_key);
CREATE INDEX IF NOT EXISTS kb_candidates_source_fact_idx
  ON kb_candidates (source_knowledge_fact_id);

CREATE TABLE IF NOT EXISTS kb_candidate_artifacts (
  id BIGSERIAL PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES kb_candidates(id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN (
    'canonical_embedding', 'subject_text_generation', 'subject_embedding',
    'pin_score', 'spoken_rewrite', 'entailment_verdict',
    'behavioral_validation_verdict'
  )),
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  processing_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_id, artifact_kind, processing_version, input_hash)
);

CREATE INDEX IF NOT EXISTS kb_candidate_artifacts_latest_idx
  ON kb_candidate_artifacts (candidate_id, artifact_kind, processing_version, created_at DESC);

CREATE TABLE IF NOT EXISTS kb_tenant_facts (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  subject_identity UUID NOT NULL,
  stable_identity UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('confirmed', 'corrected')),
  spoken_text TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'services', 'service_area', 'hours', 'estimate_policy',
    'repairs_service', 'emergency_availability', 'contact_scheduling',
    'payment_financing', 'warranty_guarantee', 'licensing_insurance',
    'company_background', 'pricing'
  )),
  polarity TEXT NOT NULL DEFAULT 'affirm' CHECK (polarity IN ('affirm', 'deny')),
  quantities_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quantities_json) = 'array'),
  boundaries_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(boundaries_json) = 'array'),
  qualifiers_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(qualifiers_json) = 'array'),
  subject_text TEXT NOT NULL,
  superseded_lineage_key TEXT,
  supersedes_tenant_fact_id TEXT REFERENCES kb_tenant_facts(id) ON DELETE SET NULL,
  effective_score DOUBLE PRECISION NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,
  archived_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_tenant_facts_live_subject_idx
  ON kb_tenant_facts (tenant_key, subject_identity)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS kb_tenant_facts_live_tenant_idx
  ON kb_tenant_facts (tenant_key, created_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS kb_selection_state (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  selection_version BIGINT NOT NULL DEFAULT 0 CHECK (selection_version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_selection (
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL CHECK (slot_index BETWEEN 0 AND 19),
  slot_ownership TEXT NOT NULL CHECK (slot_ownership IN ('auto', 'manual')),
  approved_spoken_text TEXT NOT NULL,
  approved_title TEXT NOT NULL,
  approved_canonical_text TEXT NOT NULL,
  approved_category TEXT NOT NULL CHECK (approved_category IN (
    'services', 'service_area', 'hours', 'estimate_policy',
    'repairs_service', 'emergency_availability', 'contact_scheduling',
    'payment_financing', 'warranty_guarantee', 'licensing_insurance',
    'company_background', 'pricing'
  )),
  approved_source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(approved_source_refs_json) = 'array'),
  approved_origin TEXT NOT NULL CHECK (approved_origin IN (
    'website', 'upload', 'tenant_confirmed', 'tenant_authored'
  )),
  approved_stable_identity UUID,
  approved_lineage_key TEXT,
  candidate_id TEXT REFERENCES kb_candidates(id) ON DELETE SET NULL,
  tenant_fact_id TEXT REFERENCES kb_tenant_facts(id) ON DELETE SET NULL,
  edited_from_candidate_id TEXT,
  edited_from_snapshot JSONB,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by TEXT NOT NULL,
  PRIMARY KEY (tenant_key, slot_index),
  CHECK (NULLIF(BTRIM(approved_spoken_text), '') IS NOT NULL),
  CHECK (NULLIF(BTRIM(approved_title), '') IS NOT NULL),
  CHECK (approved_lineage_key IS NOT NULL OR approved_stable_identity IS NOT NULL),
  CHECK (NOT (candidate_id IS NOT NULL AND tenant_fact_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_selection_candidate_once_idx
  ON kb_selection (tenant_key, candidate_id) WHERE candidate_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kb_selection_tenant_fact_once_idx
  ON kb_selection (tenant_key, tenant_fact_id) WHERE tenant_fact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kb_selection_flags (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  flag_type TEXT NOT NULL CHECK (flag_type IN (
    'updated', 'contradicted', 'orphaned', 'needs_review', 'superseded_candidate'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'NORMAL', 'HIGH')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NOT NULL,
  raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_action TEXT CHECK (resolved_action IS NULL OR resolved_action IN (
    'keep', 'update', 'remove', 'dismiss', 'stop_by_heart', 'retract_correction'
  )),
  acknowledged_payload_hash TEXT,
  notified_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_selection_flags_open_payload_idx
  ON kb_selection_flags (tenant_key, slot_index, flag_type, payload_hash)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS kb_selection_flags_open_severity_idx
  ON kb_selection_flags (tenant_key, severity, raised_at DESC)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS kb_flag_email_deliveries (
  flag_id TEXT PRIMARY KEY REFERENCES kb_selection_flags(id) ON DELETE CASCADE,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kb_block (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  block_text TEXT NOT NULL DEFAULT '',
  facts_block_text TEXT NOT NULL DEFAULT '',
  selection_version BIGINT NOT NULL,
  catalog_revision_id TEXT REFERENCES kb_catalog_revisions(id) ON DELETE SET NULL,
  checksum TEXT NOT NULL,
  materialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_lineage (
  id BIGSERIAL PRIMARY KEY,
  from_revision_id TEXT REFERENCES kb_catalog_revisions(id) ON DELETE CASCADE,
  from_candidate_id TEXT REFERENCES kb_candidates(id) ON DELETE CASCADE,
  to_revision_id TEXT NOT NULL REFERENCES kb_catalog_revisions(id) ON DELETE CASCADE,
  to_candidate_id TEXT REFERENCES kb_candidates(id) ON DELETE CASCADE,
  lineage_key TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('unchanged', 'changed', 'split', 'merged', 'absent')),
  matcher TEXT NOT NULL,
  best_score DOUBLE PRECISION,
  runner_up_score DOUBLE PRECISION,
  margin DOUBLE PRECISION,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_revision_id, from_candidate_id, to_revision_id, to_candidate_id, relation)
);

CREATE INDEX IF NOT EXISTS kb_lineage_forward_idx
  ON kb_lineage (lineage_key, to_revision_id);

CREATE TABLE IF NOT EXISTS kb_suppressions (
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  suppression_target TEXT NOT NULL CHECK (suppression_target IN ('lineage_key', 'tenant_subject_identity')),
  target_value TEXT NOT NULL,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL CHECK (reason IN ('tenant_deselected', 'tenant_dismissed_recommendation')),
  PRIMARY KEY (tenant_key, suppression_target, target_value)
);

CREATE TABLE IF NOT EXISTS kb_selection_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  selection_version BIGINT NOT NULL,
  selection_snapshot JSONB NOT NULL CHECK (jsonb_typeof(selection_snapshot) = 'array'),
  changed_by TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kb_selection_history_tenant_idx
  ON kb_selection_history (tenant_key, selection_version DESC, id DESC);

CREATE TABLE IF NOT EXISTS kb_audio_cache (
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  audio_bytes BYTEA,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  checksum TEXT NOT NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_key, cache_key)
);

CREATE INDEX IF NOT EXISTS kb_audio_cache_expiry_idx ON kb_audio_cache (expires_at);

CREATE TABLE IF NOT EXISTS kb_correction_proposals (
  proposal_token_hash TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL CHECK (slot_index BETWEEN 0 AND 19),
  selection_version BIGINT NOT NULL,
  derived_fact JSONB NOT NULL,
  statement_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kb_mutation_idempotency (
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  route_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_key, route_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS kb_purge_audit (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  purge_kind TEXT NOT NULL CHECK (purge_kind IN ('tenant_account_deletion', 'gdpr_erasure', 'ccpa_erasure', 'court_order')),
  requested_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION everycall_guard_kb_manual_selection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  guard_write BOOLEAN := FALSE;
  changed_columns TEXT[] := ARRAY[]::TEXT[];
  detail_payload JSONB;
  old_hash TEXT := NULL;
  new_hash TEXT := NULL;
  row_tenant_key TEXT;
  row_slot_index INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    guard_write := NEW.slot_ownership = 'manual';
    row_tenant_key := NEW.tenant_key;
    row_slot_index := NEW.slot_index;
    new_hash := md5(row_to_json(NEW)::TEXT);
    changed_columns := ARRAY['insert'];
  ELSIF TG_OP = 'DELETE' THEN
    guard_write := OLD.slot_ownership = 'manual';
    row_tenant_key := OLD.tenant_key;
    row_slot_index := OLD.slot_index;
    old_hash := md5(row_to_json(OLD)::TEXT);
    changed_columns := ARRAY['delete'];
  ELSE
    row_tenant_key := OLD.tenant_key;
    row_slot_index := OLD.slot_index;

    IF NEW.approved_spoken_text IS DISTINCT FROM OLD.approved_spoken_text THEN changed_columns := array_append(changed_columns, 'approved_spoken_text'); END IF;
    IF NEW.approved_title IS DISTINCT FROM OLD.approved_title THEN changed_columns := array_append(changed_columns, 'approved_title'); END IF;
    IF NEW.approved_canonical_text IS DISTINCT FROM OLD.approved_canonical_text THEN changed_columns := array_append(changed_columns, 'approved_canonical_text'); END IF;
    IF NEW.approved_category IS DISTINCT FROM OLD.approved_category THEN changed_columns := array_append(changed_columns, 'approved_category'); END IF;
    IF NEW.approved_source_refs_json IS DISTINCT FROM OLD.approved_source_refs_json THEN changed_columns := array_append(changed_columns, 'approved_source_refs_json'); END IF;
    IF NEW.approved_origin IS DISTINCT FROM OLD.approved_origin THEN changed_columns := array_append(changed_columns, 'approved_origin'); END IF;
    IF NEW.approved_stable_identity IS DISTINCT FROM OLD.approved_stable_identity THEN changed_columns := array_append(changed_columns, 'approved_stable_identity'); END IF;
    IF NEW.approved_lineage_key IS DISTINCT FROM OLD.approved_lineage_key THEN changed_columns := array_append(changed_columns, 'approved_lineage_key'); END IF;
    IF NEW.tenant_fact_id IS DISTINCT FROM OLD.tenant_fact_id THEN changed_columns := array_append(changed_columns, 'tenant_fact_id'); END IF;
    IF NEW.edited_from_candidate_id IS DISTINCT FROM OLD.edited_from_candidate_id THEN changed_columns := array_append(changed_columns, 'edited_from_candidate_id'); END IF;
    IF NEW.edited_from_snapshot IS DISTINCT FROM OLD.edited_from_snapshot THEN changed_columns := array_append(changed_columns, 'edited_from_snapshot'); END IF;
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN changed_columns := array_append(changed_columns, 'approved_at'); END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN changed_columns := array_append(changed_columns, 'approved_by'); END IF;
    IF NEW.slot_ownership IS DISTINCT FROM OLD.slot_ownership THEN changed_columns := array_append(changed_columns, 'slot_ownership'); END IF;

    guard_write := cardinality(changed_columns) > 0
      AND (OLD.slot_ownership = 'manual' OR NEW.slot_ownership = 'manual');
    old_hash := md5(row_to_json(OLD)::TEXT);
    new_hash := md5(row_to_json(NEW)::TEXT);
  END IF;

  IF guard_write
     AND current_setting('app.tenant_edit_context', TRUE) IS DISTINCT FROM 'true'
     AND current_setting('app.purge_context', TRUE) IS DISTINCT FROM 'true'
  THEN
    detail_payload := jsonb_build_object(
      'tenant_key', row_tenant_key,
      'slot_index', row_slot_index,
      'operation', TG_OP,
      'changed_columns', changed_columns,
      'old_hash', old_hash,
      'new_hash', new_hash,
      'application_name', current_setting('application_name', TRUE),
      'request_id', current_setting('app.request_id', TRUE)
    );
    RAISE EXCEPTION 'protected write to manual Knows By Heart slot'
      USING ERRCODE = 'P9K01', DETAIL = detail_payload::TEXT;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kb_selection_manual_write_guard ON kb_selection;
CREATE TRIGGER kb_selection_manual_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON kb_selection
  FOR EACH ROW EXECUTE FUNCTION everycall_guard_kb_manual_selection();

CREATE OR REPLACE FUNCTION everycall_guard_kb_immutable_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.purge_context', TRUE) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'immutable Knows By Heart row cannot be changed'
      USING ERRCODE = 'P9K02',
            DETAIL = jsonb_build_object(
              'table_name', TG_TABLE_NAME,
              'operation', TG_OP,
              'application_name', current_setting('application_name', TRUE),
              'request_id', current_setting('app.request_id', TRUE)
            )::TEXT;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS kb_candidates_immutable_guard ON kb_candidates;
CREATE TRIGGER kb_candidates_immutable_guard
  BEFORE UPDATE ON kb_candidates
  FOR EACH ROW EXECUTE FUNCTION everycall_guard_kb_immutable_rows();

DROP TRIGGER IF EXISTS kb_candidate_artifacts_append_only_guard ON kb_candidate_artifacts;
CREATE TRIGGER kb_candidate_artifacts_append_only_guard
  BEFORE UPDATE ON kb_candidate_artifacts
  FOR EACH ROW EXECUTE FUNCTION everycall_guard_kb_immutable_rows();

COMMENT ON TABLE kb_selection IS
  'Durable per-slot approved Knows By Heart values. Manual values are protected by kb_selection_manual_write_guard.';
COMMENT ON TABLE kb_candidate_artifacts IS
  'Append-only, versioned processing artifacts; candidate factual rows remain immutable across model changes.';
COMMENT ON TABLE kb_block IS
  'Materialized Layer 2 Knows By Heart block read by call startup without ranking, rewriting, or AI calls.';
