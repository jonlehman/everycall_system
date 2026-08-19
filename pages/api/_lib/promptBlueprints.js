import crypto from "node:crypto";
import { z } from "zod";
import {
  buildRuntimeToolDefinitions,
  callOpenAiJsonModel,
  getDefaultPromptBlueprintSeed,
  getDefaultTenantPromptProfile,
  normalizePromptBlueprintBundle,
  normalizeTenantPromptProfile,
  renderPromptContext,
  validatePromptBlueprintBundle,
  validateTenantPromptProfile
} from "@everycall/contracts";
import { loadTenantBootstrapProfile } from "./tenantBootstrapProfiles.js";

const COMPANY_DESCRIPTION_MODEL = process.env.OPENAI_COMPANY_DESCRIPTION_MODEL
  || process.env.OPENAI_SUMMARY_MODEL
  || process.env.OPENAI_MODEL
  || "gpt-4.1-mini";
const COMPANY_DESCRIPTION_PAGE_TYPES = ["home", "service_detail", "unknown_mixed", "service_area", "process", "contact"];
const COMPANY_DESCRIPTION_MAX_CHARS = 320;

function normalizeText(value) {
  return String(value || "").trim();
}

function resolvePromptRenderMode(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (["layered", "layered_v1", "true", "1", "on", "yes"].includes(normalized)) return "layered";
  if (["legacy", "current", "false", "0", "off", "no"].includes(normalized)) return "legacy";
  return String(process.env.OPENAI_REALTIME_LAYERED_PROMPT_ENABLED || "true").toLowerCase() === "true"
    ? "layered"
    : "legacy";
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

const DANGLING_DESCRIPTION_END_PATTERN = /(?:[,;:\-–—]\s*)?\b(?:and|or|with|for|to|of|in|on|at|by|from|including|plus|such as|as well as)$/i;

function stripDanglingDescriptionEnding(value) {
  let text = normalizeText(value).replace(/[,;:\-–—]+$/g, "").trim();
  while (DANGLING_DESCRIPTION_END_PATTERN.test(text)) {
    text = text.replace(DANGLING_DESCRIPTION_END_PATTERN, "").replace(/[,;:\-–—]+$/g, "").trim();
  }
  return text;
}

function lastCompleteSentenceWithin(value, limit) {
  const bounded = String(value || "").slice(0, limit);
  const endings = [...bounded.matchAll(/[.!?…](?=\s+(?:[A-Z“”"']|$)|$)/g)];
  const lastEnding = endings.at(-1);
  if (!lastEnding || Number(lastEnding.index) < 79) return "";
  return bounded.slice(0, Number(lastEnding.index) + 1).trim();
}

export function cleanGeneratedCompanyDescription(value) {
  const text = normalizeText(value)
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ");
  if (!text) return "";
  let bounded = text;
  if (bounded.length > COMPANY_DESCRIPTION_MAX_CHARS) {
    bounded = lastCompleteSentenceWithin(bounded, COMPANY_DESCRIPTION_MAX_CHARS)
      || bounded.slice(0, COMPANY_DESCRIPTION_MAX_CHARS - 1).replace(/\s+\S*$/, "").trim();
  }
  bounded = stripDanglingDescriptionEnding(bounded);
  if (!bounded) return "";
  if (!/[.!?…]$/.test(bounded)) {
    if (bounded.length >= COMPANY_DESCRIPTION_MAX_CHARS) {
      bounded = bounded.slice(0, COMPANY_DESCRIPTION_MAX_CHARS - 1).replace(/\s+\S*$/, "").trim();
      bounded = stripDanglingDescriptionEnding(bounded);
    }
    bounded = `${bounded}.`;
  }
  return bounded.slice(0, COMPANY_DESCRIPTION_MAX_CHARS);
}

function isUsableGeneratedCompanyDescription(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.length > COMPANY_DESCRIPTION_MAX_CHARS) return false;
  if (text.split(/\s+/).length < 8) return false;
  if (/\b(privacy policy|terms and conditions|cookie policy|contact us page|faq page)\b/i.test(text)) return false;
  if (!/[.!?…]$/.test(text)) return false;
  if (DANGLING_DESCRIPTION_END_PATTERN.test(text.replace(/[.!?…]+$/, "").trim())) return false;
  if (!/\b(?:we|our|us)\b/i.test(text)) return false;
  if (/\b(?:they|their|the company|the business)\b/i.test(text)) return false;
  return true;
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

export async function loadBuildDerivedCompanyDescription(db, tenantKey) {
  const activeBuildRes = await db.query(
    `SELECT active_build_id
     FROM tenant_active_knowledge_builds
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const activeBuildId = normalizeText(activeBuildRes.rows?.[0]?.active_build_id);
  return loadBuildDerivedCompanyDescriptionForBuild(db, tenantKey, activeBuildId);
}

async function loadCompanyDescriptionSourcePagesForBuild(db, tenantKey, buildId) {
  const normalizedBuildId = normalizeText(buildId);
  if (!normalizedBuildId) return [];

  const summaryRes = await db.query(
    `SELECT kss.summary_text,
            COALESCE(sr.page_type, '') AS page_type,
            COALESCE(sr.title, '') AS title,
            COALESCE(sr.source_locator, '') AS source_locator,
            COALESCE(sii.text_content, '') AS page_text
     FROM knowledge_build_source_summaries kss
     INNER JOIN source_refs sr
       ON sr.tenant_key = kss.tenant_key
      AND sr.build_id = kss.build_id
      AND sr.source_ref_id = kss.source_ref_id
     LEFT JOIN source_intake_items sii
       ON sii.tenant_key = sr.tenant_key
      AND sii.build_id = sr.build_id
      AND sii.source_ref_id = sr.source_ref_id
     WHERE kss.tenant_key = $1
       AND kss.build_id = $2
       AND kss.status = 'completed'
       AND sr.page_type = ANY($3::text[])
     ORDER BY CASE
       WHEN sr.page_type = 'home' THEN 0
       WHEN sr.page_type = 'service_detail' THEN 1
       WHEN sr.page_type = 'unknown_mixed' THEN 2
       WHEN sr.page_type = 'service_area' THEN 3
       WHEN sr.page_type = 'process' THEN 4
       WHEN sr.page_type = 'contact' THEN 5
       ELSE 6
     END,
     sr.title ASC
     LIMIT 10`,
    [tenantKey, normalizedBuildId, COMPANY_DESCRIPTION_PAGE_TYPES]
  );

  return (summaryRes.rows || [])
    .map((row) => ({
      pageType: normalizeText(row.page_type),
      title: normalizeText(row.title),
      sourceLocator: normalizeText(row.source_locator),
      summary: truncateText(row.summary_text, 700),
      pageText: truncateText(row.page_text, 1800)
    }))
    .filter((page) => page.summary || page.pageText);
}

async function loadBuildDerivedCompanyDescriptionTopicFallback(db, tenantKey, buildId) {
  const normalizedBuildId = normalizeText(buildId);
  if (!normalizedBuildId) return "";
  const topicRes = await db.query(
    `SELECT topic_name, description
     FROM knowledge_build_topics
     WHERE tenant_key = $1
       AND build_id = $2
     ORDER BY topic_name ASC
     LIMIT 8`,
    [tenantKey, normalizedBuildId]
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

function firstLocalCompanyDescriptionCandidate(sourcePages = []) {
  for (const page of sourcePages || []) {
    const candidate = truncateText(page.summary || page.pageText, COMPANY_DESCRIPTION_MAX_CHARS);
    if (!looksLikeWeakCompanyDescription(candidate)) {
      return candidate;
    }
  }
  return "";
}

async function generateCompanyDescriptionFromSourcePages({ businessName = "", sourcePages = [] } = {}) {
  if (!sourcePages.length) return "";

  const system = [
    "You write concise company descriptions for a phone receptionist setup screen.",
    `Generate one plain-language description of the company in ${COMPANY_DESCRIPTION_MAX_CHARS} characters or fewer.`,
    "Write in first-person business voice using we, our, or us. Do not refer to the business by name, as they, or as the company.",
    "Synthesize across the supplied website pages. Do not copy one page or preserve marketing fluff.",
    "Focus on what the company does, who it serves, service area if supported, and what callers usually need help with.",
    "Do not mention page titles, website navigation, forms, awards, warranties, policies, prices, or history unless central to the business.",
    "Use only facts supported by the supplied pages. Return JSON only."
  ].join("\n");
  const pagesText = sourcePages.map((page, index) => [
    `Page ${index + 1}`,
    `Type: ${page.pageType || "unknown"}`,
    page.title ? `Title: ${page.title}` : "",
    page.sourceLocator ? `URL: ${page.sourceLocator}` : "",
    page.summary ? `Existing page summary: ${page.summary}` : "",
    page.pageText ? `Page text excerpt: ${page.pageText}` : ""
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");

  const result = await callOpenAiJsonModel({
    model: COMPANY_DESCRIPTION_MODEL,
    system,
    user: [
      businessName ? `Business name: ${businessName}` : "",
      `Source pages:\n${pagesText}`
    ].filter(Boolean).join("\n\n"),
    schema: z.object({
      company_description: z.string().min(1)
    }),
    jsonSchemaName: "company_description_summary",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["company_description"],
      properties: {
        company_description: {
          type: "string",
          description: `One concise company description, ${COMPANY_DESCRIPTION_MAX_CHARS} characters or fewer.`
        }
      }
    },
    temperature: 0.2,
    maxOutputTokens: 180
  });

  const generated = cleanGeneratedCompanyDescription(result.parsed.company_description);
  return isUsableGeneratedCompanyDescription(generated) ? generated : "";
}

export async function loadBuildDerivedCompanyDescriptionForBuild(db, tenantKey, buildId) {
  const normalizedBuildId = normalizeText(buildId);
  if (!normalizedBuildId) return "";

  const sourcePages = await loadCompanyDescriptionSourcePagesForBuild(db, tenantKey, normalizedBuildId);
  if (sourcePages.length) {
    try {
      const tenant = await loadTenantName(db, tenantKey);
      const generated = await generateCompanyDescriptionFromSourcePages({
        businessName: tenant?.name,
        sourcePages
      });
      if (generated) return generated;
    } catch (err) {
      console.error("company_description_ai_generation_failed", {
        tenantKey,
        buildId: normalizedBuildId,
        error: String(err?.message || "unknown")
      });
    }

    const localCandidate = cleanGeneratedCompanyDescription(firstLocalCompanyDescriptionCandidate(sourcePages));
    if (isUsableGeneratedCompanyDescription(localCandidate)) return localCandidate;
  }

  const topicFallback = cleanGeneratedCompanyDescription(
    await loadBuildDerivedCompanyDescriptionTopicFallback(db, tenantKey, normalizedBuildId)
  );
  return isUsableGeneratedCompanyDescription(topicFallback) ? topicFallback : "";
}

export async function ensureTenantPromptProfileCompanyDescriptionSnapshot(db, tenantKey, options = {}) {
  const normalizedTenantKey = normalizeText(tenantKey);
  if (!normalizedTenantKey) return { changed: false, company_description: "" };

  const activeBuildRes = await db.query(
    `SELECT tp.company_description AS prompt_company_description,
            tp.basic_no_tool_allowed_statement AS prompt_no_tool_statement,
            bp.company_description AS bootstrap_company_description
     FROM tenants t
     LEFT JOIN tenant_prompt_profiles tp
       ON tp.tenant_key = t.tenant_key
     LEFT JOIN tenant_bootstrap_profiles bp
       ON bp.tenant_key = t.tenant_key
     WHERE t.tenant_key = $1
     LIMIT 1`,
    [normalizedTenantKey]
  );
  const promptCompanyDescription = normalizeText(activeBuildRes.rows?.[0]?.prompt_company_description);
  const promptNoToolStatement = normalizeText(activeBuildRes.rows?.[0]?.prompt_no_tool_statement);
  const bootstrapCompanyDescription = normalizeText(activeBuildRes.rows?.[0]?.bootstrap_company_description);
  const refreshNoToolStatement = options.refreshNoToolStatement === true;
  if (promptCompanyDescription && promptNoToolStatement && !refreshNoToolStatement) {
    return {
      changed: false,
      company_description: promptCompanyDescription,
      basic_no_tool_allowed_statement: promptNoToolStatement
    };
  }

  const buildDerivedCompanyDescription = refreshNoToolStatement || (!promptCompanyDescription && !bootstrapCompanyDescription)
    ? await loadBuildDerivedCompanyDescriptionForBuild(
        db,
        normalizedTenantKey,
        options.buildId
      ) || await loadBuildDerivedCompanyDescription(db, normalizedTenantKey)
    : "";
  const companyDescriptionSnapshot = normalizeText(
    refreshNoToolStatement
      ? (buildDerivedCompanyDescription || promptCompanyDescription || bootstrapCompanyDescription)
      : (promptCompanyDescription || bootstrapCompanyDescription || buildDerivedCompanyDescription)
  );
  const noToolStatementSnapshot = normalizeText(
    refreshNoToolStatement
      ? (buildDerivedCompanyDescription || companyDescriptionSnapshot)
      : (promptNoToolStatement || buildDerivedCompanyDescription || companyDescriptionSnapshot)
  );
  if (refreshNoToolStatement
    && (!isUsableGeneratedCompanyDescription(companyDescriptionSnapshot)
      || !isUsableGeneratedCompanyDescription(noToolStatementSnapshot))) {
    throw new Error("company_description_snapshot_invalid");
  }
  if (!companyDescriptionSnapshot && !noToolStatementSnapshot) {
    return { changed: false, company_description: "", basic_no_tool_allowed_statement: "" };
  }

  await db.query(
    `INSERT INTO tenant_prompt_profiles (
       tenant_key,
       company_description,
       basic_no_tool_allowed_statement,
       updated_by_id,
       updated_at
     )
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET company_description = CASE
                        WHEN $5::boolean
                          OR tenant_prompt_profiles.company_description IS NULL
                          OR BTRIM(tenant_prompt_profiles.company_description) = ''
                        THEN EXCLUDED.company_description
                        ELSE tenant_prompt_profiles.company_description
                      END,
                   basic_no_tool_allowed_statement = CASE
                        WHEN $5::boolean
                          OR tenant_prompt_profiles.basic_no_tool_allowed_statement IS NULL
                          OR BTRIM(tenant_prompt_profiles.basic_no_tool_allowed_statement) = ''
                        THEN EXCLUDED.basic_no_tool_allowed_statement
                        ELSE tenant_prompt_profiles.basic_no_tool_allowed_statement
                      END,
                   updated_by_id = CASE
                        WHEN tenant_prompt_profiles.company_description IS NULL
                          OR BTRIM(tenant_prompt_profiles.company_description) = ''
                          OR $5::boolean
                          OR tenant_prompt_profiles.basic_no_tool_allowed_statement IS NULL
                          OR BTRIM(tenant_prompt_profiles.basic_no_tool_allowed_statement) = ''
                        THEN EXCLUDED.updated_by_id
                        ELSE tenant_prompt_profiles.updated_by_id
                      END,
                   updated_at = CASE
                        WHEN tenant_prompt_profiles.company_description IS NULL
                          OR BTRIM(tenant_prompt_profiles.company_description) = ''
                          OR $5::boolean
                          OR tenant_prompt_profiles.basic_no_tool_allowed_statement IS NULL
                          OR BTRIM(tenant_prompt_profiles.basic_no_tool_allowed_statement) = ''
                        THEN NOW()
                        ELSE tenant_prompt_profiles.updated_at
                      END`,
    [
      normalizedTenantKey,
      companyDescriptionSnapshot || null,
      noToolStatementSnapshot || null,
      actorId(options.actor || "system:build_snapshot"),
      refreshNoToolStatement
    ]
  );

  await writeAuditLog(db, normalizedTenantKey, options.actor || "system:build_snapshot", "tenant.prompt_profile.knowledge_snapshot", {
    target_tenant: normalizedTenantKey,
    source: "active_build_summary",
    build_id: normalizeText(options.buildId) || null,
    refreshed_company_description: refreshNoToolStatement,
    refreshed_no_tool_statement: refreshNoToolStatement
  });

  return {
    changed: true,
    company_description: companyDescriptionSnapshot,
    basic_no_tool_allowed_statement: noToolStatementSnapshot
  };
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
  const [tenant, bootstrapProfile, storedProfileRes] = await Promise.all([
    loadTenantName(db, tenantKey),
    loadTenantBootstrapProfile(db, tenantKey),
    db.query(
      `SELECT company_description, basic_no_tool_allowed_statement
       FROM tenant_prompt_profiles
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    )
  ]);
  const defaults = getDefaultTenantPromptProfile();
  const bootstrapDescription = normalizeText(bootstrapProfile?.company_description);
  const storedCompanyDescription = normalizeText(storedProfileRes.rows?.[0]?.company_description);
  const companyDescription = storedCompanyDescription || bootstrapDescription;
  const noToolStatement = normalizeText(storedProfileRes.rows?.[0]?.basic_no_tool_allowed_statement)
    || companyDescription;
  return normalizeTenantPromptProfile({
    tenant_key: tenantKey,
    assistant_name: defaults.assistant_name,
    business_name: normalizeText(tenant?.name),
    company_description: companyDescription,
    opening_line: normalizeText(tenant?.name)
      ? `Thanks for calling ${normalizeText(tenant.name)}. This is ${defaults.assistant_name}. How can I help you today?`
      : defaults.opening_line,
    ai_disclosure_line: defaults.ai_disclosure_line,
    lead_goal: defaults.lead_goal,
    required_contact_fields: defaults.required_contact_fields,
    closing_phrase: defaults.closing_phrase,
    basic_no_tool_allowed_statement: noToolStatement
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

let ensureDefaultPromptBlueprintPromise = null;

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
  if (ensureDefaultPromptBlueprintPromise) {
    return ensureDefaultPromptBlueprintPromise;
  }
  ensureDefaultPromptBlueprintPromise = (async () => {
    const seed = getDefaultPromptBlueprintSeed();
    const promptBlueprintId = `pb_${seed.blueprint_key}_v${seed.version}`;
    await db.query(
      `UPDATE prompt_blueprints
       SET status = 'archived',
           updated_at = NOW()
       WHERE blueprint_key = $1
         AND status = 'active'
         AND prompt_blueprint_id <> $2`,
      [seed.blueprint_key, promptBlueprintId]
    );
    await db.query(
      `INSERT INTO prompt_blueprints (
         prompt_blueprint_id, blueprint_key, version, status, name, sample_phrase_groups_json, tool_definitions_json
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       ON CONFLICT (prompt_blueprint_id)
       DO UPDATE SET blueprint_key = EXCLUDED.blueprint_key,
                     version = EXCLUDED.version,
                     status = EXCLUDED.status,
                     name = EXCLUDED.name,
                     sample_phrase_groups_json = EXCLUDED.sample_phrase_groups_json,
                     tool_definitions_json = EXCLUDED.tool_definitions_json,
                     updated_at = NOW()`,
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
    await db.query(
      `DELETE FROM prompt_blueprint_sections
       WHERE prompt_blueprint_id = $1`,
      [promptBlueprintId]
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
  })();
  try {
    await ensureDefaultPromptBlueprintPromise;
  } finally {
    ensureDefaultPromptBlueprintPromise = null;
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
    const normalized = normalizeTenantPromptProfile(input, previous);
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
    sectionOverridesOverride = null,
    coreFactsOverride = [],
    coreFactsBlockOverride = null,
    promptRenderModeOverride = null
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
    sectionOverrides: rawSectionOverrides,
    coreFacts: Array.isArray(coreFactsOverride) ? coreFactsOverride : [],
    promptMode: resolvePromptRenderMode(promptRenderModeOverride),
    ...(typeof coreFactsBlockOverride === "string" ? { coreFactsBlock: coreFactsBlockOverride } : {})
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

export function buildPromptToolDefinitions(blueprint, fieldSchema, options = {}) {
  return buildRuntimeToolDefinitions(blueprint, fieldSchema, options);
}
