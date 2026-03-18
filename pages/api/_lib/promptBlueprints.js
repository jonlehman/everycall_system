import crypto from "node:crypto";
import {
  buildRuntimeToolDefinitions,
  getDefaultPromptBlueprintSeed,
  getDefaultTenantPromptProfile,
  normalizePromptBlueprintBundle,
  normalizeTenantPromptProfile,
  renderPromptContext,
  validatePromptBlueprintBundle,
  validateTenantPromptProfile
} from "@everycall/contracts";

function normalizeText(value) {
  return String(value || "").trim();
}

function truncateText(value, limit = 320) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function looksLikeWeakCompanyDescription(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return true;
  if (text.split(/\s+/).length < 6) return true;
  return /\b(privacy|terms|policy|warranty|guarantee|financing|payment|insurance|contact us|call us|after hours|faq|service area|locations?)\b/.test(text);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean)
    : [];
}

function uniqueValues(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function actorId(actor) {
  if (!actor) return null;
  if (typeof actor === "string") return actor;
  const role = normalizeText(actor.role) || "system";
  const id = normalizeText(actor.user_id || actor.userId || actor.id);
  return id ? `${role}:${id}` : role;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function withTransaction(db, work) {
  const canBorrowClient = typeof db?.connect === "function" && typeof db?.release !== "function";
  const client = canBorrowClient ? await db.connect() : db;
  const ownsClient = canBorrowClient;
  if (ownsClient) {
    await client.query("BEGIN");
  }
  try {
    const result = await work(client);
    if (ownsClient) {
      await client.query("COMMIT");
    }
    return result;
  } catch (err) {
    if (ownsClient) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    if (ownsClient && typeof client?.release === "function") {
      client.release();
    }
  }
}

async function writeAuditLog(db, tenantKey, actor, action, details) {
  await db.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [tenantKey || null, actorId(actor) || "system", action, JSON.stringify(details || {})]
  );
}

function diffObjectPaths(previous, next, prefix = "") {
  const left = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  const right = next && typeof next === "object" && !Array.isArray(next) ? next : {};
  const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
  const changed = [];
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const before = left[key];
    const after = right[key];
    const bothObjects = before && typeof before === "object" && !Array.isArray(before)
      && after && typeof after === "object" && !Array.isArray(after);
    if (bothObjects) {
      changed.push(...diffObjectPaths(before, after, path));
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed.push(path);
    }
  }
  return changed;
}

async function loadBuildDerivedCompanyDescription(db, tenantKey) {
  const activeBuildRes = await db.query(
    `SELECT active_build_id
     FROM tenant_active_knowledge_builds
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const activeBuildId = normalizeText(activeBuildRes.rows?.[0]?.active_build_id);
  if (!activeBuildId) return "";

  const summaryRes = await db.query(
    `SELECT kss.summary_text,
            COALESCE(sr.page_type, '') AS page_type,
            COALESCE(sr.title, '') AS title
     FROM knowledge_build_source_summaries kss
     INNER JOIN source_refs sr
       ON sr.tenant_key = kss.tenant_key
      AND sr.build_id = kss.build_id
      AND sr.source_ref_id = kss.source_ref_id
     WHERE kss.tenant_key = $1
       AND kss.build_id = $2
       AND kss.status = 'completed'
     ORDER BY CASE
       WHEN sr.page_type = 'home' THEN 0
       WHEN sr.page_type = 'service_detail' THEN 1
       WHEN sr.page_type = 'unknown_mixed' THEN 2
       WHEN sr.page_type = 'contact' THEN 3
       ELSE 4
     END,
     sr.title ASC
     LIMIT 8`,
    [tenantKey, activeBuildId]
  );
  for (const row of summaryRes.rows || []) {
    const candidate = truncateText(row.summary_text, 320);
    if (!looksLikeWeakCompanyDescription(candidate)) {
      return candidate;
    }
  }

  const topicRes = await db.query(
    `SELECT topic_name, description
     FROM knowledge_build_topics
     WHERE tenant_key = $1
       AND build_id = $2
     ORDER BY topic_name ASC
     LIMIT 8`,
    [tenantKey, activeBuildId]
  );
  for (const row of topicRes.rows || []) {
    const topicName = normalizeText(row.topic_name).toLowerCase();
    if (/\b(hours|pricing|payment|contact|faq|policy|insurance|financing|warranty|privacy|service area|location)\b/.test(topicName)) {
      continue;
    }
    const candidate = truncateText(row.description, 320);
    if (!looksLikeWeakCompanyDescription(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function loadTenantName(db, tenantKey) {
  const res = await db.query(
    `SELECT tenant_key, name
     FROM tenants
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return res.rows[0] || null;
}

async function buildTenantPromptProfileDefaults(db, tenantKey) {
  const [tenant, buildSummary] = await Promise.all([
    loadTenantName(db, tenantKey),
    loadBuildDerivedCompanyDescription(db, tenantKey)
  ]);
  const defaults = getDefaultTenantPromptProfile();
  return normalizeTenantPromptProfile({
    tenant_key: tenantKey,
    assistant_name: defaults.assistant_name,
    business_name: normalizeText(tenant?.name),
    company_description: buildSummary,
    opening_line: normalizeText(tenant?.name)
      ? `Thanks for calling ${normalizeText(tenant.name)}. This is ${defaults.assistant_name}. How can I help you today?`
      : defaults.opening_line,
    ai_disclosure_line: defaults.ai_disclosure_line,
    lead_goal: defaults.lead_goal,
    required_contact_fields: defaults.required_contact_fields,
    closing_phrase: defaults.closing_phrase,
    basic_no_tool_allowed_statement: buildSummary
  });
}

function buildFieldState({ defaultValue, effectiveValue, overrideValue, hasOverride }) {
  return {
    default_value: defaultValue,
    override_value: hasOverride ? overrideValue : null,
    effective_value: effectiveValue,
    source: hasOverride ? "tenant_override" : "inherited_default"
  };
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeStoredTenantPromptProfile(row, defaults) {
  return normalizeTenantPromptProfile({
    tenant_key: row?.tenant_key || defaults.tenant_key,
    assistant_name: row?.assistant_name,
    business_name: row?.business_name,
    company_description: row?.company_description,
    opening_line: row?.opening_line,
    ai_disclosure_line: row?.ai_disclosure_line,
    lead_goal: row?.lead_goal,
    required_contact_fields: row?.required_contact_fields_json,
    closing_phrase: row?.closing_phrase,
    basic_no_tool_allowed_statement: row?.basic_no_tool_allowed_statement,
    updated_at: row?.updated_at,
    created_at: row?.created_at
  }, defaults);
}

async function ensureDefaultPromptBlueprint(db) {
  const existing = await db.query(
    `SELECT prompt_blueprint_id
     FROM prompt_blueprints
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  if (existing.rowCount) {
    return;
  }
  const seed = getDefaultPromptBlueprintSeed();
  const promptBlueprintId = "pb_canonical_receptionist_v1";
  await db.query(
    `INSERT INTO prompt_blueprints (
       prompt_blueprint_id, blueprint_key, version, status, name, sample_phrase_groups_json, tool_definitions_json
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      promptBlueprintId,
      seed.blueprint_key,
      seed.version,
      seed.status,
      seed.name,
      JSON.stringify(seed.sample_phrase_groups),
      JSON.stringify(seed.tool_definitions)
    ]
  );
  for (const section of seed.sections) {
    await db.query(
      `INSERT INTO prompt_blueprint_sections (
         prompt_blueprint_id, section_id, section_order, default_text, is_template, allowed_placeholders_json, admin_metadata_json
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        promptBlueprintId,
        section.section_id,
        section.section_order,
        section.default_text,
        section.is_template,
        JSON.stringify(section.allowed_placeholders || []),
        JSON.stringify(section.admin_metadata || {})
      ]
    );
  }
}

async function loadBlueprintRow(db, promptBlueprintId = "") {
  await ensureDefaultPromptBlueprint(db);
  const whereClause = normalizeText(promptBlueprintId)
    ? `WHERE prompt_blueprint_id = $1`
    : `WHERE status = 'active'`;
  const values = normalizeText(promptBlueprintId) ? [promptBlueprintId] : [];
  const res = await db.query(
    `SELECT *
     FROM prompt_blueprints
     ${whereClause}
     ORDER BY version DESC, updated_at DESC
     LIMIT 1`,
    values
  );
  return res.rows[0] || null;
}

export async function listPromptBlueprints(db) {
  await ensureDefaultPromptBlueprint(db);
  const res = await db.query(
    `SELECT prompt_blueprint_id, blueprint_key, version, status, name, created_at, updated_at
     FROM prompt_blueprints
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, version DESC, updated_at DESC`
  );
  return res.rows || [];
}

export async function loadPromptBlueprint(db, promptBlueprintId = "") {
  const row = await loadBlueprintRow(db, promptBlueprintId);
  if (!row) {
    throw new Error("prompt_blueprint_not_found");
  }
  const sectionsRes = await db.query(
    `SELECT section_id, section_order, default_text, is_template, allowed_placeholders_json, admin_metadata_json
     FROM prompt_blueprint_sections
     WHERE prompt_blueprint_id = $1
     ORDER BY section_order ASC`,
    [row.prompt_blueprint_id]
  );
  return normalizePromptBlueprintBundle({
    ...row,
    sample_phrase_groups: row.sample_phrase_groups_json,
    tool_definitions: row.tool_definitions_json,
    sections: (sectionsRes.rows || []).map((section) => ({
      section_id: section.section_id,
      section_order: section.section_order,
      default_text: section.default_text,
      is_template: section.is_template,
      allowed_placeholders: section.allowed_placeholders_json,
      admin_metadata: section.admin_metadata_json
    }))
  });
}

export async function savePromptBlueprint(db, input = {}, actor = null) {
  const normalized = normalizePromptBlueprintBundle(input);
  const validation = validatePromptBlueprintBundle(normalized);
  if (!validation.valid) {
    throw new Error(`invalid_prompt_blueprint:${validation.errors.join(",")}`);
  }
  return withTransaction(db, async (client) => {
    const previous = await loadPromptBlueprint(client, normalized.prompt_blueprint_id);
    await client.query(
      `INSERT INTO prompt_blueprints (
         prompt_blueprint_id, blueprint_key, version, status, name, sample_phrase_groups_json, tool_definitions_json, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())
       ON CONFLICT (prompt_blueprint_id)
       DO UPDATE SET blueprint_key = EXCLUDED.blueprint_key,
                     version = EXCLUDED.version,
                     status = EXCLUDED.status,
                     name = EXCLUDED.name,
                     sample_phrase_groups_json = EXCLUDED.sample_phrase_groups_json,
                     tool_definitions_json = EXCLUDED.tool_definitions_json,
                     updated_at = NOW()`,
      [
        normalized.prompt_blueprint_id,
        normalized.blueprint_key,
        normalized.version,
        normalized.status,
        normalized.name,
        JSON.stringify(normalized.sample_phrase_groups),
        JSON.stringify(normalized.tool_definitions)
      ]
    );
    await client.query(
      `DELETE FROM prompt_blueprint_sections
       WHERE prompt_blueprint_id = $1`,
      [normalized.prompt_blueprint_id]
    );
    for (const section of normalized.sections) {
      await client.query(
        `INSERT INTO prompt_blueprint_sections (
           prompt_blueprint_id, section_id, section_order, default_text, is_template, allowed_placeholders_json, admin_metadata_json, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())`,
        [
          normalized.prompt_blueprint_id,
          section.section_id,
          section.section_order,
          section.default_text,
          section.is_template,
          JSON.stringify(section.allowed_placeholders || []),
          JSON.stringify(section.admin_metadata || {})
        ]
      );
    }
    await writeAuditLog(client, null, actor, "admin.prompt_blueprint.saved", {
      prompt_blueprint_id: normalized.prompt_blueprint_id,
      blueprint_key: normalized.blueprint_key,
      version: normalized.version,
      changed_fields: diffObjectPaths(previous, normalized)
    });
    return loadPromptBlueprint(client, normalized.prompt_blueprint_id);
  });
}

export async function loadTenantPromptProfile(db, tenantKey) {
  const defaults = await buildTenantPromptProfileDefaults(db, tenantKey);
  const res = await db.query(
    `SELECT tenant_key, assistant_name, business_name, company_description, opening_line, ai_disclosure_line,
            lead_goal, required_contact_fields_json, closing_phrase, basic_no_tool_allowed_statement,
            updated_by_id, created_at, updated_at
     FROM tenant_prompt_profiles
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const row = res.rows[0] || null;
  return normalizeStoredTenantPromptProfile(row, defaults);
}

export async function loadTenantPromptProfileEditorState(db, tenantKey) {
  const defaults = await buildTenantPromptProfileDefaults(db, tenantKey);
  const res = await db.query(
    `SELECT tenant_key, assistant_name, business_name, company_description, opening_line, ai_disclosure_line,
            lead_goal, required_contact_fields_json, closing_phrase, basic_no_tool_allowed_statement,
            updated_by_id, created_at, updated_at
     FROM tenant_prompt_profiles
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const row = res.rows[0] || null;
  const profile = normalizeStoredTenantPromptProfile(row, defaults);
  const fieldSources = {
    assistant_name: buildFieldState({
      defaultValue: defaults.assistant_name,
      effectiveValue: profile.assistant_name,
      overrideValue: normalizeText(row?.assistant_name),
      hasOverride: row?.assistant_name !== undefined && row?.assistant_name !== null && normalizeText(row?.assistant_name).length > 0
    }),
    business_name: buildFieldState({
      defaultValue: defaults.business_name,
      effectiveValue: profile.business_name,
      overrideValue: normalizeText(row?.business_name),
      hasOverride: row?.business_name !== undefined && row?.business_name !== null && normalizeText(row?.business_name).length > 0
    }),
    company_description: buildFieldState({
      defaultValue: defaults.company_description,
      effectiveValue: profile.company_description,
      overrideValue: normalizeText(row?.company_description),
      hasOverride: row?.company_description !== undefined && row?.company_description !== null && normalizeText(row?.company_description).length > 0
    }),
    opening_line: buildFieldState({
      defaultValue: defaults.opening_line,
      effectiveValue: profile.opening_line,
      overrideValue: normalizeText(row?.opening_line),
      hasOverride: row?.opening_line !== undefined && row?.opening_line !== null && normalizeText(row?.opening_line).length > 0
    }),
    ai_disclosure_line: buildFieldState({
      defaultValue: defaults.ai_disclosure_line,
      effectiveValue: profile.ai_disclosure_line,
      overrideValue: normalizeText(row?.ai_disclosure_line),
      hasOverride: row?.ai_disclosure_line !== undefined && row?.ai_disclosure_line !== null && normalizeText(row?.ai_disclosure_line).length > 0
    }),
    lead_goal: buildFieldState({
      defaultValue: defaults.lead_goal,
      effectiveValue: profile.lead_goal,
      overrideValue: normalizeText(row?.lead_goal),
      hasOverride: row?.lead_goal !== undefined && row?.lead_goal !== null && normalizeText(row?.lead_goal).length > 0
    }),
    required_contact_fields: buildFieldState({
      defaultValue: defaults.required_contact_fields,
      effectiveValue: profile.required_contact_fields,
      overrideValue: Array.isArray(row?.required_contact_fields_json) ? row.required_contact_fields_json : null,
      hasOverride: Array.isArray(row?.required_contact_fields_json) && row.required_contact_fields_json.length > 0
    }),
    closing_phrase: buildFieldState({
      defaultValue: defaults.closing_phrase,
      effectiveValue: profile.closing_phrase,
      overrideValue: normalizeText(row?.closing_phrase),
      hasOverride: row?.closing_phrase !== undefined && row?.closing_phrase !== null && normalizeText(row?.closing_phrase).length > 0
    }),
    basic_no_tool_allowed_statement: buildFieldState({
      defaultValue: defaults.basic_no_tool_allowed_statement,
      effectiveValue: profile.basic_no_tool_allowed_statement,
      overrideValue: normalizeText(row?.basic_no_tool_allowed_statement),
      hasOverride: row?.basic_no_tool_allowed_statement !== undefined && row?.basic_no_tool_allowed_statement !== null && normalizeText(row?.basic_no_tool_allowed_statement).length > 0
    })
  };
  return {
    profile,
    defaults,
    field_sources: fieldSources,
    has_overrides: Object.values(fieldSources).some((field) => field.source === "tenant_override")
  };
}

function buildStoredTenantPromptProfile(profile, defaults, tenantKey) {
  return {
    tenant_key: tenantKey,
    assistant_name: valuesEqual(profile.assistant_name, defaults.assistant_name) ? null : profile.assistant_name,
    business_name: valuesEqual(profile.business_name, defaults.business_name) ? null : profile.business_name,
    company_description: valuesEqual(profile.company_description, defaults.company_description) ? null : profile.company_description,
    opening_line: valuesEqual(profile.opening_line, defaults.opening_line) ? null : profile.opening_line,
    ai_disclosure_line: valuesEqual(profile.ai_disclosure_line, defaults.ai_disclosure_line) ? null : profile.ai_disclosure_line,
    lead_goal: valuesEqual(profile.lead_goal, defaults.lead_goal) ? null : profile.lead_goal,
    required_contact_fields_json: valuesEqual(profile.required_contact_fields, defaults.required_contact_fields) ? null : profile.required_contact_fields,
    closing_phrase: valuesEqual(profile.closing_phrase, defaults.closing_phrase) ? null : profile.closing_phrase,
    basic_no_tool_allowed_statement: valuesEqual(profile.basic_no_tool_allowed_statement, defaults.basic_no_tool_allowed_statement)
      ? null
      : profile.basic_no_tool_allowed_statement
  };
}

export async function saveTenantPromptProfile(db, tenantKey, input = {}, actor = null) {
  return withTransaction(db, async (client) => {
    const previous = await loadTenantPromptProfile(client, tenantKey);
    const defaults = await buildTenantPromptProfileDefaults(client, tenantKey);
    const normalized = normalizeTenantPromptProfile(input, defaults);
    const validation = validateTenantPromptProfile(normalized);
    if (!validation.valid) {
      throw new Error(`invalid_tenant_prompt_profile:${validation.errors.join(",")}`);
    }
    const stored = buildStoredTenantPromptProfile(normalized, defaults, tenantKey);
    await client.query(
      `INSERT INTO tenant_prompt_profiles (
         tenant_key, assistant_name, business_name, company_description, opening_line, ai_disclosure_line,
         lead_goal, required_contact_fields_json, closing_phrase, basic_no_tool_allowed_statement, updated_by_id, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, NOW())
       ON CONFLICT (tenant_key)
       DO UPDATE SET assistant_name = EXCLUDED.assistant_name,
                     business_name = EXCLUDED.business_name,
                     company_description = EXCLUDED.company_description,
                     opening_line = EXCLUDED.opening_line,
                     ai_disclosure_line = EXCLUDED.ai_disclosure_line,
                     lead_goal = EXCLUDED.lead_goal,
                     required_contact_fields_json = EXCLUDED.required_contact_fields_json,
                     closing_phrase = EXCLUDED.closing_phrase,
                     basic_no_tool_allowed_statement = EXCLUDED.basic_no_tool_allowed_statement,
                     updated_by_id = EXCLUDED.updated_by_id,
                     updated_at = NOW()`,
      [
        tenantKey,
        stored.assistant_name,
        stored.business_name,
        stored.company_description,
        stored.opening_line,
        stored.ai_disclosure_line,
        stored.lead_goal,
        JSON.stringify(stored.required_contact_fields_json),
        stored.closing_phrase,
        stored.basic_no_tool_allowed_statement,
        actorId(actor)
      ]
    );
    const next = await loadTenantPromptProfile(client, tenantKey);
    await writeAuditLog(client, tenantKey, actor, "tenant.prompt_profile.saved", {
      target_tenant: tenantKey,
      changed_fields: diffObjectPaths(previous, next)
    });
    return next;
  });
}

export async function resetTenantPromptProfileToDefaults(db, tenantKey, actor = null) {
  return withTransaction(db, async (client) => {
    const previous = await loadTenantPromptProfile(client, tenantKey);
    await client.query(
      `DELETE FROM tenant_prompt_profiles
       WHERE tenant_key = $1`,
      [tenantKey]
    );
    const next = await loadTenantPromptProfile(client, tenantKey);
    await writeAuditLog(client, tenantKey, actor, "tenant.prompt_profile.reset_to_defaults", {
      target_tenant: tenantKey,
      changed_fields: diffObjectPaths(previous, next)
    });
    return loadTenantPromptProfileEditorState(client, tenantKey);
  });
}

export async function loadTenantPromptSectionOverrides(db, tenantKey, promptBlueprintId = "") {
  const blueprint = await loadPromptBlueprint(db, promptBlueprintId);
  const res = await db.query(
    `SELECT section_id, override_text, updated_by_id, created_at, updated_at
     FROM tenant_prompt_section_overrides
     WHERE tenant_key = $1
       AND prompt_blueprint_id = $2
     ORDER BY section_id ASC`,
    [tenantKey, blueprint.prompt_blueprint_id]
  );
  const overrides = {};
  for (const row of res.rows || []) {
    const sectionId = normalizeText(row.section_id);
    if (!sectionId) continue;
    overrides[sectionId] = {
      section_id: sectionId,
      override_text: row.override_text,
      updated_by_id: row.updated_by_id || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null
    };
  }
  return {
    prompt_blueprint_id: blueprint.prompt_blueprint_id,
    overrides
  };
}

export async function saveTenantPromptSectionOverrides(db, tenantKey, promptBlueprintId, overridesInput = {}, actor = null) {
  return withTransaction(db, async (client) => {
    const blueprint = await loadPromptBlueprint(client, promptBlueprintId);
    const previous = await loadTenantPromptSectionOverrides(client, tenantKey, blueprint.prompt_blueprint_id);
    const overrides = asObject(overridesInput);
    await client.query(
      `DELETE FROM tenant_prompt_section_overrides
       WHERE tenant_key = $1
         AND prompt_blueprint_id = $2`,
      [tenantKey, blueprint.prompt_blueprint_id]
    );
    const savedOverrides = {};
    for (const section of blueprint.sections) {
      const overrideText = normalizeText(overrides[section.section_id]);
      if (!overrideText) continue;
      await client.query(
        `INSERT INTO tenant_prompt_section_overrides (
           tenant_key, prompt_blueprint_id, section_id, override_text, updated_by_id, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          tenantKey,
          blueprint.prompt_blueprint_id,
          section.section_id,
          overrideText,
          actorId(actor)
        ]
      );
      savedOverrides[section.section_id] = overrideText;
    }
    const next = await loadTenantPromptSectionOverrides(client, tenantKey, blueprint.prompt_blueprint_id);
    await writeAuditLog(client, tenantKey, actor, "admin.tenant_prompt_section_overrides.saved", {
      target_tenant: tenantKey,
      prompt_blueprint_id: blueprint.prompt_blueprint_id,
      changed_fields: diffObjectPaths(previous.overrides, next.overrides)
    });
    return next;
  });
}

export async function resetTenantPromptSectionOverrides(db, tenantKey, promptBlueprintId, actor = null) {
  return withTransaction(db, async (client) => {
    const blueprint = await loadPromptBlueprint(client, promptBlueprintId);
    const previous = await loadTenantPromptSectionOverrides(client, tenantKey, blueprint.prompt_blueprint_id);
    await client.query(
      `DELETE FROM tenant_prompt_section_overrides
       WHERE tenant_key = $1
         AND prompt_blueprint_id = $2`,
      [tenantKey, blueprint.prompt_blueprint_id]
    );
    await writeAuditLog(client, tenantKey, actor, "admin.tenant_prompt_section_overrides.reset", {
      target_tenant: tenantKey,
      prompt_blueprint_id: blueprint.prompt_blueprint_id,
      changed_fields: Object.keys(previous.overrides || {})
    });
    return loadTenantPromptSectionOverrides(client, tenantKey, blueprint.prompt_blueprint_id);
  });
}

export async function loadTenantPromptConfigEditorState(db, tenantKey, promptBlueprintId = "") {
  const [blueprint, profileState, overrideState, tenant] = await Promise.all([
    loadPromptBlueprint(db, promptBlueprintId),
    loadTenantPromptProfileEditorState(db, tenantKey),
    loadTenantPromptSectionOverrides(db, tenantKey, promptBlueprintId),
    loadTenantName(db, tenantKey)
  ]);
  return {
    tenant,
    blueprint,
    profile: profileState.profile,
    profile_defaults: profileState.defaults,
    field_sources: profileState.field_sources,
    has_profile_overrides: profileState.has_overrides,
    section_overrides: overrideState.overrides
  };
}

export async function loadPromptRuntimeContext(
  db,
  tenantKey,
  {
    promptBlueprintOverride = null,
    tenantPromptProfileOverride = null,
    sectionOverridesOverride = null
  } = {}
) {
  const [liveBlueprint, liveProfileState, liveOverridesState] = await Promise.all([
    loadPromptBlueprint(db),
    loadTenantPromptProfileEditorState(db, tenantKey),
    loadTenantPromptSectionOverrides(db, tenantKey)
  ]);

  const blueprint = promptBlueprintOverride
    ? normalizePromptBlueprintBundle({
        ...liveBlueprint,
        ...promptBlueprintOverride,
        prompt_blueprint_id: liveBlueprint.prompt_blueprint_id,
        blueprint_key: liveBlueprint.blueprint_key,
        version: liveBlueprint.version,
        status: liveBlueprint.status
      })
    : liveBlueprint;

  const tenantProfile = tenantPromptProfileOverride
    ? normalizeTenantPromptProfile(tenantPromptProfileOverride, liveProfileState.profile_defaults)
    : liveProfileState.profile;

  const rawSectionOverrides = sectionOverridesOverride
    ? asObject(sectionOverridesOverride)
    : Object.fromEntries(
        Object.entries(liveOverridesState.overrides || {}).map(([sectionId, value]) => [sectionId, normalizeText(value.override_text)])
      );

  const explicitCompanyDescription = normalizeText(
    tenantPromptProfileOverride?.company_description
    || tenantPromptProfileOverride?.companyDescription
    || liveProfileState.field_sources?.company_description?.override_value
  );
  const companyDescription = normalizeText(tenantProfile.company_description);
  const companyDescriptionSource = explicitCompanyDescription
    ? "tenant_override"
    : (companyDescription ? "active_build_summary" : "blank");

  const rendered = renderPromptContext(blueprint, tenantProfile, {
    companyDescription,
    companyDescriptionSource,
    sectionOverrides: rawSectionOverrides
  });
  return {
    blueprint,
    tenantProfile,
    profileDefaults: liveProfileState.profile_defaults,
    fieldSources: liveProfileState.field_sources,
    sectionOverrides: rawSectionOverrides,
    rendered
  };
}

export function buildPromptToolDefinitions(blueprint, fieldSchema) {
  return buildRuntimeToolDefinitions(blueprint, fieldSchema);
}
