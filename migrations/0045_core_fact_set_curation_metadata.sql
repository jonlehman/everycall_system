ALTER TABLE knowledge_core_fact_prompt_sections
  ADD COLUMN IF NOT EXISTS set_selector_version TEXT,
  ADD COLUMN IF NOT EXISTS set_selector_model TEXT,
  ADD COLUMN IF NOT EXISTS set_selector_reason TEXT;

COMMENT ON COLUMN knowledge_core_fact_prompt_sections.set_selector_version IS
  'Version of the AI pass that selected a distinct set of facts for this stored prompt section.';

COMMENT ON COLUMN knowledge_core_fact_prompt_sections.set_selector_model IS
  'Model used for the stored set-level What You Know By Heart curation pass.';

COMMENT ON COLUMN knowledge_core_fact_prompt_sections.set_selector_reason IS
  'Short audit explanation returned by the set-level curation pass.';
