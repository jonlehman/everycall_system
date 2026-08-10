UPDATE tenant_prompt_profiles
SET company_description = COALESCE(
      NULLIF(BTRIM(company_description), ''),
      NULLIF(BTRIM(basic_no_tool_allowed_statement), '')
    ),
    basic_no_tool_allowed_statement = NULL,
    updated_at = NOW()
WHERE basic_no_tool_allowed_statement IS NOT NULL;

UPDATE tenant_prompt_section_overrides
SET override_text = REPLACE(
      REPLACE(
        override_text,
        '- the general statement that {basic_no_tool_allowed_statement}',
        '- a brief general summary of the company description above'
      ),
      '{basic_no_tool_allowed_statement}',
      'the company description above'
    ),
    updated_at = NOW()
WHERE section_id = 'business_context'
  AND override_text LIKE '%{basic_no_tool_allowed_statement}%';

COMMENT ON COLUMN tenant_prompt_profiles.basic_no_tool_allowed_statement IS
  'Deprecated by canonical receptionist v5; company_description is the single tenant-specific business description.';
