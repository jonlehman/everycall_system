ALTER TABLE knowledge_build_facts
  ADD COLUMN IF NOT EXISTS core_fact_rating_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_is_stable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS core_fact_is_safe_to_speak BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS core_fact_rating_version TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_rating_model TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_rated_at TIMESTAMPTZ;

UPDATE knowledge_build_facts
SET core_fact_is_stable = (
      COALESCE(core_fact_score, 0) > 0
      AND NULLIF(BTRIM(core_fact_title), '') IS NOT NULL
      AND NULLIF(BTRIM(core_fact_spoken_text), '') IS NOT NULL
    ),
    core_fact_is_safe_to_speak = (
      COALESCE(core_fact_score, 0) > 0
      AND NULLIF(BTRIM(core_fact_title), '') IS NOT NULL
      AND NULLIF(BTRIM(core_fact_spoken_text), '') IS NOT NULL
    ),
    core_fact_rating_version = COALESCE(NULLIF(BTRIM(core_fact_selector_version), ''), 'legacy_openai_core_fact_rating'),
    core_fact_rated_at = COALESCE(core_fact_selected_at, NOW())
WHERE core_fact_rating_version IS NULL
  AND core_fact_score IS NOT NULL
  AND NULLIF(BTRIM(core_fact_selector_version), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_build_facts_core_rating_reuse_idx
  ON knowledge_build_facts (tenant_key, core_fact_rating_input_hash)
  WHERE core_fact_rating_input_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_core_fact_prompt_sections (
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL,
  facts_block_text TEXT NOT NULL DEFAULT '',
  section_text TEXT NOT NULL DEFAULT '',
  selected_fact_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  section_checksum TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  rating_version TEXT NOT NULL,
  materialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_key, build_id),
  CONSTRAINT knowledge_core_fact_prompt_sections_fact_ids_array_check
    CHECK (jsonb_typeof(selected_fact_ids_json) = 'array')
);

CREATE INDEX IF NOT EXISTS knowledge_core_fact_prompt_sections_tenant_updated_idx
  ON knowledge_core_fact_prompt_sections (tenant_key, updated_at DESC);

COMMENT ON COLUMN knowledge_build_facts.core_fact_rating_input_hash IS
  'Hash of the canonical fact, relevant qualifiers, tenant context, and rating rubric. An exact match reuses the saved OpenAI rating.';

COMMENT ON TABLE knowledge_core_fact_prompt_sections IS
  'Materialized tenant/build What You Know By Heart prompt content. Rebuilt only when knowledge facts change or an administrator explicitly requests it.';
