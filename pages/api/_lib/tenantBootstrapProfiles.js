function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeTenantBootstrapProfile(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const websiteUrl = normalizeText(source.website_url || source.websiteUrl);
  const companyDescription = normalizeText(source.company_description || source.companyDescription);
  const businessCategory = normalizeText(source.business_category || source.businessCategory);
  const sourceMode = normalizeText(source.source_mode || source.sourceMode)
    || (websiteUrl ? "website_first" : "setup_interview");

  return {
    website_url: websiteUrl || null,
    company_description: companyDescription || null,
    business_category: businessCategory || null,
    source_mode: sourceMode,
    created_at: source.created_at || source.createdAt || null,
    updated_at: source.updated_at || source.updatedAt || null
  };
}

export async function loadTenantBootstrapProfile(db, tenantKey) {
  const res = await db.query(
    `SELECT tenant_key, website_url, company_description, business_category, source_mode, created_at, updated_at
     FROM tenant_bootstrap_profiles
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return normalizeTenantBootstrapProfile(res.rows[0] || {});
}

export async function saveTenantBootstrapProfile(db, tenantKey, input = {}) {
  const normalized = normalizeTenantBootstrapProfile(input);
  await db.query(
    `INSERT INTO tenant_bootstrap_profiles (
       tenant_key, website_url, company_description, business_category, source_mode, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET website_url = EXCLUDED.website_url,
                   company_description = EXCLUDED.company_description,
                   business_category = EXCLUDED.business_category,
                   source_mode = EXCLUDED.source_mode,
                   updated_at = NOW()`,
    [
      tenantKey,
      normalized.website_url,
      normalized.company_description,
      normalized.business_category,
      normalized.source_mode
    ]
  );
  return loadTenantBootstrapProfile(db, tenantKey);
}
