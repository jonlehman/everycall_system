ALTER TABLE knowledge_build_facts
  ADD COLUMN IF NOT EXISTS is_core_fact_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS core_fact_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_title TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_spoken_text TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS core_fact_rank INTEGER,
  ADD COLUMN IF NOT EXISTS core_fact_reason TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_selector_version TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_selected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS knowledge_build_facts_core_pins_idx
  ON knowledge_build_facts (tenant_key, build_id, core_fact_rank)
  WHERE is_core_fact_pinned = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_build_facts_core_pin_rank_unique_idx
  ON knowledge_build_facts (tenant_key, build_id, core_fact_rank)
  WHERE is_core_fact_pinned = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_build_facts_core_pin_fingerprint_unique_idx
  ON knowledge_build_facts (tenant_key, build_id, core_fact_fingerprint)
  WHERE is_core_fact_pinned = TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_build_facts_core_pin_complete_check'
  ) THEN
    ALTER TABLE knowledge_build_facts
      ADD CONSTRAINT knowledge_build_facts_core_pin_complete_check
      CHECK (
        is_core_fact_pinned = FALSE
        OR (
          NULLIF(BTRIM(core_fact_fingerprint), '') IS NOT NULL
          AND NULLIF(BTRIM(core_fact_title), '') IS NOT NULL
          AND NULLIF(BTRIM(core_fact_spoken_text), '') IS NOT NULL
          AND core_fact_rank > 0
        )
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS knowledge_core_fact_pin_changes (
  change_id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT,
  previous_build_id TEXT,
  knowledge_fact_id TEXT,
  fact_fingerprint TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('pinned', 'unpinned', 'rewritten')),
  title TEXT,
  spoken_text TEXT,
  claim_text TEXT NOT NULL,
  score DOUBLE PRECISION,
  reason TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_core_fact_pin_changes_tenant_idx
  ON knowledge_core_fact_pin_changes (tenant_key, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_core_fact_refresh_state (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  active_build_id TEXT NOT NULL,
  calls_at_last_refresh BIGINT NOT NULL DEFAULT 0,
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  selector_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN knowledge_build_facts.is_core_fact_pinned IS
  'System-managed flag for facts rendered into the receptionist What You Know By Heart prompt section.';

COMMENT ON COLUMN knowledge_build_facts.core_fact_spoken_text IS
  'Conservative spoken-register paraphrase of claim_text; the canonical fact remains claim_text and stays vector indexed.';
