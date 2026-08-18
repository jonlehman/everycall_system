ALTER TABLE knowledge_build_facts
  ADD COLUMN IF NOT EXISTS core_fact_spoken_version TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_spoken_model TEXT,
  ADD COLUMN IF NOT EXISTS core_fact_spoken_at TIMESTAMPTZ;

COMMENT ON COLUMN knowledge_build_facts.core_fact_spoken_text IS
  'Conservative one-sentence spoken-register paraphrase for prompt use only; claim_text remains canonical for embeddings and lookup.';

COMMENT ON COLUMN knowledge_build_facts.core_fact_spoken_version IS
  'Version of the pin-only spoken-register rewrite policy applied to core_fact_spoken_text.';

COMMENT ON COLUMN knowledge_build_facts.core_fact_spoken_model IS
  'OpenAI model used for the stored pin-only spoken-register rewrite.';

COMMENT ON COLUMN knowledge_build_facts.core_fact_spoken_at IS
  'Timestamp when the stored pin-only spoken-register rewrite was generated.';
