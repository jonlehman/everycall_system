ALTER TABLE knowledge_runtime_profiles
  ADD COLUMN IF NOT EXISTS company_description TEXT;

WITH latest_onboarding AS (
  SELECT DISTINCT ON (tenant_key)
    tenant_key,
    NULLIF(BTRIM(services_offered), '') AS services_offered
  FROM onboarding_intake
  ORDER BY tenant_key, created_at DESC
)
UPDATE knowledge_runtime_profiles runtime_profiles
SET company_description = latest_onboarding.services_offered
FROM latest_onboarding
WHERE runtime_profiles.tenant_key = latest_onboarding.tenant_key
  AND NULLIF(BTRIM(runtime_profiles.company_description), '') IS NULL
  AND latest_onboarding.services_offered IS NOT NULL;
