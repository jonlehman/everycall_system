UPDATE tenant_prompt_profiles tp
SET basic_no_tool_allowed_statement = COALESCE(
      NULLIF(BTRIM(tp.company_description), ''),
      NULLIF(BTRIM(bp.company_description), ''),
      NULLIF(BTRIM(t.name), '')
    ),
    updated_at = NOW(),
    updated_by_id = COALESCE(tp.updated_by_id, 'system:no_tool_statement_backfill')
FROM tenants t
LEFT JOIN tenant_bootstrap_profiles bp
  ON bp.tenant_key = t.tenant_key
WHERE tp.tenant_key = t.tenant_key
  AND (
    tp.basic_no_tool_allowed_statement IS NULL
    OR BTRIM(tp.basic_no_tool_allowed_statement) = ''
  )
  AND COALESCE(
    NULLIF(BTRIM(tp.company_description), ''),
    NULLIF(BTRIM(bp.company_description), ''),
    NULLIF(BTRIM(t.name), '')
  ) IS NOT NULL;

COMMENT ON COLUMN tenant_prompt_profiles.basic_no_tool_allowed_statement IS
  'Persisted no-tool business statement. Refreshed when a website knowledge build is published; never generated during call prompt loading.';
