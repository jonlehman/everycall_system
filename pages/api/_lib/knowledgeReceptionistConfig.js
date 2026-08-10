import crypto from "node:crypto";
import { extractTextFromDocumentBuffer } from "./knowledgeReceptionistFiles.js";
import { fetchWebsitePage } from "./knowledgeReceptionistBuilds.js";
import { loadBuildDerivedCompanyDescription } from "./promptBlueprints.js";

const DEFAULT_STAGE_IDS = [
  "opening",
  "discover_need",
  "clarify_if_needed",
  "answer_or_route",
  "reassure_briefly",
  "advance_next_step",
  "confirm_and_close"
];

const DEFAULT_STAGE_PLAYBOOK = [
  {
    stage_id: "opening",
    name: "Opening",
    purpose: "Welcome the caller and invite them to explain what they need.",
    when_to_enter: ["call_start"],
    required_inputs: ["business_name", "greeting_style"],
    recommended_actions: ["greet briefly", "ask how to help"],
    disallowed_actions: ["long intro", "menu-like script"],
    exit_conditions: ["caller starts describing their need"],
    success_criteria: ["caller understands they reached the business"],
    mandatory_or_optional: "mandatory",
    max_questions: 1,
    next_possible_stages: ["discover_need"]
  },
  {
    stage_id: "discover_need",
    name: "Discover Need",
    purpose: "Understand the caller goal well enough to answer or route safely.",
    when_to_enter: ["after_opening"],
    required_inputs: ["caller_need"],
    recommended_actions: ["listen for service, policy, location, or urgency"],
    disallowed_actions: ["stacked questions"],
    exit_conditions: ["need is understood well enough to proceed"],
    success_criteria: ["active domain and likely intent are clearer"],
    mandatory_or_optional: "mandatory",
    max_questions: 2,
    next_possible_stages: ["clarify_if_needed", "answer_or_route"]
  },
  {
    stage_id: "clarify_if_needed",
    name: "Clarify If Needed",
    purpose: "Ask one short clarifying question when needed for safe routing or answering.",
    when_to_enter: ["need remains ambiguous"],
    required_inputs: [],
    recommended_actions: ["ask one short question"],
    disallowed_actions: ["speculative answers", "multiple clarifiers at once"],
    exit_conditions: ["caller clarified the missing slot"],
    success_criteria: ["enough context exists to answer or route"],
    mandatory_or_optional: "optional",
    max_questions: 1,
    next_possible_stages: ["answer_or_route", "advance_next_step"]
  },
  {
    stage_id: "answer_or_route",
    name: "Answer Or Route",
    purpose: "Answer directly from supported facts or move to the safer next step.",
    when_to_enter: ["enough truth is available"],
    required_inputs: ["supported_business_truth"],
    recommended_actions: ["answer directly", "keep it brief", "use supported facts only"],
    disallowed_actions: ["invent pricing", "invent policy"],
    exit_conditions: ["caller question is answered or routing path is chosen"],
    success_criteria: ["caller gets a safe direct answer or a clear route"],
    mandatory_or_optional: "mandatory",
    max_questions: 1,
    next_possible_stages: ["reassure_briefly", "advance_next_step", "confirm_and_close"]
  },
  {
    stage_id: "reassure_briefly",
    name: "Reassure Briefly",
    purpose: "Give a short supported reassurance when it helps confidence.",
    when_to_enter: ["after_direct_answer_when_supported"],
    required_inputs: [],
    recommended_actions: ["keep reassurance brief", "stay within supported facts"],
    disallowed_actions: ["overpromising"],
    exit_conditions: ["caller has enough confidence to continue"],
    success_criteria: ["confidence increases without adding unsupported claims"],
    mandatory_or_optional: "optional",
    max_questions: 0,
    next_possible_stages: ["advance_next_step", "confirm_and_close"]
  },
  {
    stage_id: "advance_next_step",
    name: "Advance Next Step",
    purpose: "Move toward scheduling, callback, transfer, or message capture when appropriate.",
    when_to_enter: ["caller is ready to proceed"],
    required_inputs: ["preferred_outcome"],
    recommended_actions: ["offer the next supported step"],
    disallowed_actions: ["hard sell"],
    exit_conditions: ["next step is accepted or declined"],
    success_criteria: ["clear next step is established"],
    mandatory_or_optional: "mandatory",
    max_questions: 1,
    next_possible_stages: ["confirm_and_close"]
  },
  {
    stage_id: "confirm_and_close",
    name: "Confirm And Close",
    purpose: "Confirm the outcome and close the interaction clearly.",
    when_to_enter: ["call is wrapping up"],
    required_inputs: ["final_next_step"],
    recommended_actions: ["confirm key detail once", "close clearly"],
    disallowed_actions: ["reopening resolved topics"],
    exit_conditions: ["caller has heard the next step"],
    success_criteria: ["call ends with a clear close"],
    mandatory_or_optional: "mandatory",
    max_questions: 1,
    next_possible_stages: []
  }
];

export const DEFAULT_RUNTIME_SESSION_CONFIG = {
  model: "grok-voice-think-fast-2.0",
  voice: "ara",
  reasoning: {
    effort: "high"
  },
  turn_detection: {
    type: "server_vad",
    threshold: 0.9,
    silence_duration_ms: 350
  },
  transcription_model: "grok-transcribe",
  input_audio_format: "g711_ulaw",
  output_audio_format: "g711_ulaw"
};

export const DEFAULT_RUNTIME_TOOL_POLICY = {
  require_knowledge_lookup_for_tenant_facts: true,
  max_clarifying_questions: 1,
  allow_finish_session_only_after_spoken_close: true,
  require_single_question_turns: true
};

export const DEFAULT_RUNTIME_WORDING_DEFAULTS = {
  ai_disclosure: "I'm the business's automated assistant.",
  uncertainty_phrase: "I want to make sure I get that right.",
  pricing_fallback: "I can't quote that precisely here, but I can help with the next step.",
  callback_offer: "I can help take your details so the team can follow up.",
  closing_phrase: "I'll make sure the team has that."
};

export const DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS = {
  clarification_style: "one_short_question",
  after_hours_mode: "follow_intent_strategy",
  concise_responses: true,
  callback_offer_required: true
};

const MAX_UPLOADED_DOCUMENT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOADED_DOCUMENT_BODY_CHARS = 250_000;

function normalizeText(value) {
  return String(value || "").trim();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const item of value) {
    const text = normalizeText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function isWithinEffectiveWindow(item, at = new Date()) {
  const effectiveFrom = normalizeText(item?.effective_from || item?.effectiveFrom);
  const effectiveUntil = normalizeText(item?.effective_until || item?.effectiveUntil);
  const timestamp = at instanceof Date ? at.getTime() : Date.now();
  if (effectiveFrom) {
    const fromTime = Date.parse(effectiveFrom);
    if (Number.isFinite(fromTime) && timestamp < fromTime) return false;
  }
  if (effectiveUntil) {
    const untilTime = Date.parse(effectiveUntil);
    if (Number.isFinite(untilTime) && timestamp > untilTime) return false;
  }
  return true;
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

async function assertConfigTablesReady(db) {
  const res = await db.query(
    `SELECT to_regclass('business_call_intents') AS business_call_intents,
            to_regclass('call_outcome_schemas') AS call_outcome_schemas,
            to_regclass('knowledge_runtime_profiles') AS knowledge_runtime_profiles`
  );
  if (
    !normalizeText(res.rows[0]?.business_call_intents)
    || !normalizeText(res.rows[0]?.call_outcome_schemas)
    || !normalizeText(res.rows[0]?.knowledge_runtime_profiles)
  ) {
    throw new Error("knowledge_receptionist_migrations_not_applied");
  }
  await db.query(`ALTER TABLE knowledge_runtime_profiles ADD COLUMN IF NOT EXISTS company_description TEXT;`);
  await db.query(`ALTER TABLE knowledge_runtime_profiles ALTER COLUMN greeting_text DROP NOT NULL;`);
  await db.query(
    `ALTER TABLE uploaded_documents
       ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'file_upload',
       ADD COLUMN IF NOT EXISTS source_locator TEXT,
       ADD COLUMN IF NOT EXISTS fetch_status TEXT,
       ADD COLUMN IF NOT EXISTS fetch_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
       ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;`
  );
}

function actorId(actor) {
  if (!actor) return null;
  if (typeof actor === "string") return actor;
  const role = normalizeText(actor.role) || "tenant";
  const id = normalizeText(actor.user_id || actor.userId || actor.id);
  return id ? `${role}:${id}` : role;
}

async function writeAuditLog(db, tenantKey, actor, action, details) {
  await db.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [tenantKey, actorId(actor) || "system", action, JSON.stringify(details || {})]
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

function auditActionName(actor, defaultAction, adminAction) {
  return normalizeText(actor?.role) === "admin" ? adminAction : defaultAction;
}

async function nextIntentVersion(db, tableName, tenantKey, idColumn) {
  const res = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM ${tableName}
     WHERE tenant_key = $1`,
    [tenantKey]
  );
  const count = Number(res.rows[0]?.count || 0) + 1;
  return `v${count}`;
}

function normalizeStagePlaybook(value, fallback = DEFAULT_STAGE_PLAYBOOK) {
  if (!Array.isArray(value) || !value.length) {
    return fallback;
  }
  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    const stageId = normalizeText(item?.stage_id || item?.stageId);
    if (!stageId || seen.has(stageId)) continue;
    seen.add(stageId);
    normalized.push({
      stage_id: stageId,
      name: normalizeText(item?.name) || stageId,
      purpose: normalizeText(item?.purpose) || "Guide the conversation through this stage safely.",
      when_to_enter: asStringArray(item?.when_to_enter || item?.whenToEnter),
      required_inputs: asStringArray(item?.required_inputs || item?.requiredInputs),
      recommended_actions: asStringArray(item?.recommended_actions || item?.recommendedActions),
      disallowed_actions: asStringArray(item?.disallowed_actions || item?.disallowedActions),
      exit_conditions: asStringArray(item?.exit_conditions || item?.exitConditions),
      success_criteria: asStringArray(item?.success_criteria || item?.successCriteria),
      mandatory_or_optional: normalizeText(item?.mandatory_or_optional || item?.mandatoryOrOptional) || "mandatory",
      max_questions: Number.isFinite(Number(item?.max_questions ?? item?.maxQuestions))
        ? Number(item?.max_questions ?? item?.maxQuestions)
        : undefined,
      next_possible_stages: asStringArray(item?.next_possible_stages || item?.nextPossibleStages)
    });
  }
  return normalized.length ? normalized : fallback;
}

function normalizeBusinessCallIntentPayload(payload = {}) {
  return {
    businessCallIntentId: normalizeText(payload.businessCallIntentId || payload.business_call_intent_id),
    version: normalizeText(payload.version),
    status: normalizeText(payload.status),
    primaryGoal: normalizeText(payload.primaryGoal || payload.primary_goal),
    secondaryGoals: asStringArray(payload.secondaryGoals || payload.secondary_goals),
    preferredOutcomes: asStringArray(payload.preferredOutcomes || payload.preferred_outcomes),
    disallowedOutcomes: asStringArray(payload.disallowedOutcomes || payload.disallowed_outcomes),
    toneRules: asStringArray(payload.toneRules || payload.tone_rules),
    salesStyle: asObject(payload.salesStyle || payload.sales_style),
    disclosureStrategy: asObject(payload.disclosureStrategy || payload.disclosure_strategy),
    handoffStrategy: asObject(payload.handoffStrategy || payload.handoff_strategy),
    afterHoursStrategy: asObject(payload.afterHoursStrategy || payload.after_hours_strategy),
    greetingConfig: asObject(payload.greetingConfig || payload.greeting_config),
    terminologyPreferences: asObject(payload.terminologyPreferences || payload.terminology_preferences),
    conversationStagePlaybook: normalizeStagePlaybook(payload.conversationStagePlaybook || payload.conversation_stage_playbook)
  };
}

async function loadBusinessCallIntentById(db, businessCallIntentId) {
  const res = await db.query(
    `SELECT *
     FROM business_call_intents
     WHERE business_call_intent_id = $1
     LIMIT 1`,
    [businessCallIntentId]
  );
  return res.rows[0] || null;
}

export async function loadBusinessCallIntentState(db, tenantKey) {
  await assertConfigTablesReady(db);
  const res = await db.query(
    `SELECT *
     FROM business_call_intents
     WHERE tenant_key = $1
     ORDER BY updated_at DESC`,
    [tenantKey]
  );
  const approvedIntent = (res.rows || []).find((row) => ["approved_live", "active"].includes(normalizeText(row.status))) || null;
  return {
    intents: res.rows || [],
    approvedIntent,
    activeIntent: approvedIntent || res.rows[0] || null
  };
}

export async function saveBusinessCallIntent(db, tenantKey, payload = {}, actor = null) {
  await assertConfigTablesReady(db);
  return withTransaction(db, async (client) => {
    const normalized = normalizeBusinessCallIntentPayload(payload);
    const existing = normalized.businessCallIntentId
      ? await loadBusinessCallIntentById(client, normalized.businessCallIntentId)
      : null;
    if (existing && normalizeText(existing.tenant_key) !== normalizeText(tenantKey)) {
      throw new Error("business_call_intent_tenant_mismatch");
    }

    const intentId = normalized.businessCallIntentId || createId("bci");
    const version = normalized.version || existing?.version || await nextIntentVersion(client, "business_call_intents", tenantKey, "business_call_intent_id");
    const status = normalized.status || "approved_live";

    await client.query(
      `INSERT INTO business_call_intents (
         business_call_intent_id, tenant_key, version, status, primary_goal, secondary_goals_json,
         preferred_outcomes_json, disallowed_outcomes_json, tone_rules_json, sales_style, sales_style_json,
         disclosure_strategy_json, handoff_strategy_json, after_hours_strategy_json, greeting_config_json,
         terminology_preferences_json, conversation_stage_playbook_json, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11::jsonb,
         $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, NOW()
       )
       ON CONFLICT (business_call_intent_id)
       DO UPDATE SET version = EXCLUDED.version,
                     status = EXCLUDED.status,
                     primary_goal = EXCLUDED.primary_goal,
                     secondary_goals_json = EXCLUDED.secondary_goals_json,
                     preferred_outcomes_json = EXCLUDED.preferred_outcomes_json,
                     disallowed_outcomes_json = EXCLUDED.disallowed_outcomes_json,
                     tone_rules_json = EXCLUDED.tone_rules_json,
                     sales_style = EXCLUDED.sales_style,
                     sales_style_json = EXCLUDED.sales_style_json,
                     disclosure_strategy_json = EXCLUDED.disclosure_strategy_json,
                     handoff_strategy_json = EXCLUDED.handoff_strategy_json,
                     after_hours_strategy_json = EXCLUDED.after_hours_strategy_json,
                     greeting_config_json = EXCLUDED.greeting_config_json,
                     terminology_preferences_json = EXCLUDED.terminology_preferences_json,
                     conversation_stage_playbook_json = EXCLUDED.conversation_stage_playbook_json,
                     updated_at = NOW()`,
      [
        intentId,
        tenantKey,
        version,
        status,
        normalized.primaryGoal || "Act as the business receptionist and move callers toward the correct next step.",
        JSON.stringify(normalized.secondaryGoals),
        JSON.stringify(normalized.preferredOutcomes),
        JSON.stringify(normalized.disallowedOutcomes),
        JSON.stringify(normalized.toneRules),
        normalizeText(normalized.salesStyle?.mode) || "soft_sales",
        JSON.stringify(normalized.salesStyle),
        JSON.stringify(normalized.disclosureStrategy),
        JSON.stringify(normalized.handoffStrategy),
        JSON.stringify(normalized.afterHoursStrategy),
        JSON.stringify(normalized.greetingConfig),
        JSON.stringify(normalized.terminologyPreferences),
        JSON.stringify(normalized.conversationStagePlaybook)
      ]
    );

    await writeAuditLog(client, tenantKey, actor, "knowledge_receptionist.business_call_intent.saved", {
      business_call_intent_id: intentId,
      status,
      version
    });

    return loadBusinessCallIntentById(client, intentId);
  });
}

function normalizeOverridePayload(payload = {}) {
  return {
    knowledgeOverrideId: normalizeText(payload.knowledgeOverrideId || payload.knowledge_override_id),
    overrideType: normalizeText(payload.overrideType || payload.override_type) || "soft_guidance",
    priority: Number.isFinite(Number(payload.priority)) ? Number(payload.priority) : 100,
    status: normalizeText(payload.status) || "approved_live",
    title: normalizeText(payload.title),
    body: normalizeText(payload.body),
    scope: asObject(payload.scope),
    appliesToIntents: asStringArray(payload.appliesToIntents || payload.applies_to_intents),
    appliesToDomains: asStringArray(payload.appliesToDomains || payload.applies_to_domains),
    appliesToSubdomains: asStringArray(payload.appliesToSubdomains || payload.applies_to_subdomains),
    effectiveFrom: normalizeText(payload.effectiveFrom || payload.effective_from) || null,
    effectiveUntil: normalizeText(payload.effectiveUntil || payload.effective_until) || null,
    metadata: asObject(payload.metadata)
  };
}

function normalizeGuardrailPayload(payload = {}) {
  return {
    knowledgeGuardrailId: normalizeText(payload.knowledgeGuardrailId || payload.knowledge_guardrail_id),
    guardrailType: normalizeText(payload.guardrailType || payload.guardrail_type) || "dangerous_question",
    triggerPatterns: asStringArray(payload.triggerPatterns || payload.trigger_patterns),
    triggerIntents: asStringArray(payload.triggerIntents || payload.trigger_intents),
    riskLevel: normalizeText(payload.riskLevel || payload.risk_level) || "high",
    mode: normalizeText(payload.mode) || "clarify",
    approvedResponsePattern: normalizeText(payload.approvedResponsePattern || payload.approved_response_pattern),
    requiredNextStep: normalizeText(payload.requiredNextStep || payload.required_next_step) || null,
    optionalCaptureFields: asStringArray(payload.optionalCaptureFields || payload.optional_capture_fields),
    escalationInstruction: normalizeText(payload.escalationInstruction || payload.escalation_instruction) || null,
    appliesToDomains: asStringArray(payload.appliesToDomains || payload.applies_to_domains),
    appliesToSubdomains: asStringArray(payload.appliesToSubdomains || payload.applies_to_subdomains),
    enabled: payload.enabled !== false,
    status: normalizeText(payload.status) || "approved_live",
    metadata: asObject(payload.metadata)
  };
}

export async function listKnowledgeOverrides(db, tenantKey, { activeOnly = false } = {}) {
  await assertConfigTablesReady(db);
  const res = await db.query(
    `SELECT *
     FROM knowledge_overrides
     WHERE tenant_key = $1
     ORDER BY priority ASC, updated_at DESC`,
    [tenantKey]
  );
  const rows = res.rows || [];
  if (!activeOnly) return rows;
  return rows.filter((row) => normalizeText(row.status) === "approved_live" && isWithinEffectiveWindow(row));
}

export async function saveKnowledgeOverride(db, tenantKey, payload = {}, actor = null) {
  await assertConfigTablesReady(db);
  return withTransaction(db, async (client) => {
    const normalized = normalizeOverridePayload(payload);
    const overrideId = normalized.knowledgeOverrideId || createId("ovr");
    await client.query(
      `INSERT INTO knowledge_overrides (
         knowledge_override_id, tenant_key, override_type, scope_json, priority, status, title, body,
         applies_to_intents_json, applies_to_domains_json, applies_to_subdomains_json,
         effective_from, effective_until, metadata_json, created_by_id, updated_by_id, updated_at
       )
       VALUES (
         $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb,
         $12::timestamptz, $13::timestamptz, $14::jsonb, $15, $15, NOW()
       )
       ON CONFLICT (knowledge_override_id)
       DO UPDATE SET override_type = EXCLUDED.override_type,
                     scope_json = EXCLUDED.scope_json,
                     priority = EXCLUDED.priority,
                     status = EXCLUDED.status,
                     title = EXCLUDED.title,
                     body = EXCLUDED.body,
                     applies_to_intents_json = EXCLUDED.applies_to_intents_json,
                     applies_to_domains_json = EXCLUDED.applies_to_domains_json,
                     applies_to_subdomains_json = EXCLUDED.applies_to_subdomains_json,
                     effective_from = EXCLUDED.effective_from,
                     effective_until = EXCLUDED.effective_until,
                     metadata_json = EXCLUDED.metadata_json,
                     updated_by_id = EXCLUDED.updated_by_id,
                     updated_at = NOW()`,
      [
        overrideId,
        tenantKey,
        normalized.overrideType,
        JSON.stringify(normalized.scope),
        normalized.priority,
        normalized.status,
        normalized.title || "Untitled override",
        normalized.body || "",
        JSON.stringify(normalized.appliesToIntents),
        JSON.stringify(normalized.appliesToDomains),
        JSON.stringify(normalized.appliesToSubdomains),
        normalized.effectiveFrom,
        normalized.effectiveUntil,
        JSON.stringify(normalized.metadata),
        actorId(actor)
      ]
    );
    await writeAuditLog(client, tenantKey, actor, "knowledge_receptionist.override.saved", {
      knowledge_override_id: overrideId,
      override_type: normalized.overrideType,
      status: normalized.status
    });
    const res = await client.query(
      `SELECT *
       FROM knowledge_overrides
       WHERE knowledge_override_id = $1
       LIMIT 1`,
      [overrideId]
    );
    return res.rows[0] || null;
  });
}

export async function listKnowledgeGuardrails(db, tenantKey, { activeOnly = false } = {}) {
  await assertConfigTablesReady(db);
  const res = await db.query(
    `SELECT *
     FROM knowledge_guardrails
     WHERE tenant_key = $1
       ${activeOnly ? "AND status = 'approved_live' AND enabled = TRUE" : ""}
     ORDER BY updated_at DESC`,
    [tenantKey]
  );
  return res.rows || [];
}

export async function saveKnowledgeGuardrail(db, tenantKey, payload = {}, actor = null) {
  await assertConfigTablesReady(db);
  return withTransaction(db, async (client) => {
    const normalized = normalizeGuardrailPayload(payload);
    const guardrailId = normalized.knowledgeGuardrailId || createId("gr");
    await client.query(
      `INSERT INTO knowledge_guardrails (
         knowledge_guardrail_id, tenant_key, guardrail_type, trigger_patterns_json, trigger_intents_json, risk_level,
         mode, approved_response_pattern, required_next_step, optional_capture_fields_json, escalation_instruction,
         applies_to_domains_json, applies_to_subdomains_json, enabled, status, metadata_json,
         created_by_id, updated_by_id, updated_at
       )
       VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10::jsonb, $11,
         $12::jsonb, $13::jsonb, $14, $15, $16::jsonb, $17, $17, NOW()
       )
       ON CONFLICT (knowledge_guardrail_id)
       DO UPDATE SET guardrail_type = EXCLUDED.guardrail_type,
                     trigger_patterns_json = EXCLUDED.trigger_patterns_json,
                     trigger_intents_json = EXCLUDED.trigger_intents_json,
                     risk_level = EXCLUDED.risk_level,
                     mode = EXCLUDED.mode,
                     approved_response_pattern = EXCLUDED.approved_response_pattern,
                     required_next_step = EXCLUDED.required_next_step,
                     optional_capture_fields_json = EXCLUDED.optional_capture_fields_json,
                     escalation_instruction = EXCLUDED.escalation_instruction,
                     applies_to_domains_json = EXCLUDED.applies_to_domains_json,
                     applies_to_subdomains_json = EXCLUDED.applies_to_subdomains_json,
                     enabled = EXCLUDED.enabled,
                     status = EXCLUDED.status,
                     metadata_json = EXCLUDED.metadata_json,
                     updated_by_id = EXCLUDED.updated_by_id,
                     updated_at = NOW()`,
      [
        guardrailId,
        tenantKey,
        normalized.guardrailType,
        JSON.stringify(normalized.triggerPatterns),
        JSON.stringify(normalized.triggerIntents),
        normalized.riskLevel,
        normalized.mode,
        normalized.approvedResponsePattern || "Please respond with the approved bounded answer only.",
        normalized.requiredNextStep,
        JSON.stringify(normalized.optionalCaptureFields),
        normalized.escalationInstruction,
        JSON.stringify(normalized.appliesToDomains),
        JSON.stringify(normalized.appliesToSubdomains),
        normalized.enabled,
        normalized.status,
        JSON.stringify(normalized.metadata),
        actorId(actor)
      ]
    );
    await writeAuditLog(client, tenantKey, actor, "knowledge_receptionist.guardrail.saved", {
      knowledge_guardrail_id: guardrailId,
      guardrail_type: normalized.guardrailType,
      status: normalized.status
    });
    const res = await client.query(
      `SELECT *
       FROM knowledge_guardrails
       WHERE knowledge_guardrail_id = $1
       LIMIT 1`,
      [guardrailId]
    );
    return res.rows[0] || null;
  });
}

function normalizeUploadedDocumentPayload(payload = {}) {
  const documentClass = normalizeText(payload.documentClass || payload.document_class) || "unclassified";
  const explicitAuthority = normalizeText(payload.sourceAuthority || payload.source_authority);
  let sourceAuthority = explicitAuthority;
  if (!sourceAuthority) {
    if (documentClass === "operational") sourceAuthority = "uploaded_first_party_operational";
    else if (documentClass === "policy") sourceAuthority = "uploaded_first_party_policy";
    else if (documentClass === "reference") sourceAuthority = "uploaded_first_party_reference";
    else if (documentClass === "marketing") sourceAuthority = "uploaded_first_party_marketing";
    else sourceAuthority = "uploaded_unclassified_pending_review";
  }
  const explicitSourceKind = normalizeText(payload.sourceKind || payload.source_kind).toLowerCase();
  const sourceKind = explicitSourceKind
    || (normalizeText(payload.sourceLocator || payload.source_locator) ? "single_page_url" : (normalizeText(payload.fileBase64 || payload.file_base64 || payload.contentBase64 || payload.content_base64) ? "file_upload" : "inline_text"));
  return {
    uploadedDocumentId: normalizeText(payload.uploadedDocumentId || payload.uploaded_document_id),
    status: normalizeText(payload.status) || "approved",
    title: normalizeText(payload.title),
    filename: normalizeText(payload.filename || payload.fileName || payload.file_name) || null,
    mimeType: normalizeText(payload.mimeType || payload.mime_type) || "text/plain",
    sourceKind: ["file_upload", "single_page_url", "inline_text"].includes(explicitSourceKind || sourceKind)
      ? (explicitSourceKind || sourceKind)
      : "file_upload",
    sourceLocator: normalizeText(payload.sourceLocator || payload.source_locator),
    sourceAuthority,
    documentClass,
    bodyText: normalizeText(payload.bodyText || payload.body_text),
    fileBase64: normalizeText(payload.fileBase64 || payload.file_base64 || payload.contentBase64 || payload.content_base64),
    metadata: asObject(payload.metadata)
  };
}

function estimateBase64DecodedBytes(value) {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  if (!normalized) return 0;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function isSupportedUploadedDocumentFile({ filename = "", mimeType = "" } = {}) {
  const lowerName = normalizeText(filename).toLowerCase();
  const lowerMimeType = normalizeText(mimeType).toLowerCase();
  if (lowerName.endsWith(".txt")) return true;
  if (lowerMimeType === "text/plain") return true;
  return false;
}

export async function listUploadedDocuments(db, tenantKey, options = {}) {
  await assertConfigTablesReady(db);
  const includeArchived = options?.includeArchived === true;
  const res = await db.query(
    `SELECT *
     FROM uploaded_documents
     WHERE tenant_key = $1
       AND ($2::boolean OR status <> 'archived')
     ORDER BY updated_at DESC`,
    [tenantKey, includeArchived]
  );
  return res.rows || [];
}

export async function saveUploadedDocument(db, tenantKey, payload = {}, actor = null) {
  await assertConfigTablesReady(db);
  return withTransaction(db, async (client) => {
    const normalized = normalizeUploadedDocumentPayload(payload);
    if (normalized.sourceKind === "file_upload" && normalized.fileBase64 && !isSupportedUploadedDocumentFile({ filename: normalized.filename, mimeType: normalized.mimeType })) {
      throw new Error("uploaded_document_file_type_not_supported");
    }
    if (normalized.sourceKind === "file_upload" && normalized.fileBase64 && estimateBase64DecodedBytes(normalized.fileBase64) > MAX_UPLOADED_DOCUMENT_FILE_BYTES) {
      throw new Error("uploaded_document_file_too_large");
    }
    let bodyText = normalized.bodyText;
    let mimeType = normalized.mimeType;
    let metadata = { ...normalized.metadata };
    let title = normalized.title || normalized.filename || "Uploaded Document";
    let filename = normalized.filename;
    let sourceLocator = normalized.sourceLocator || null;
    let fetchStatus = null;
    let fetchMetadata = {};

    if (normalized.sourceKind === "single_page_url") {
      if (!sourceLocator) {
        throw new Error("single_page_url_required");
      }
      const fetchedPage = await fetchWebsitePage(sourceLocator);
      if (!fetchedPage.ok) {
        throw new Error("single_page_fetch_failed");
      }
      bodyText = normalizeText(fetchedPage.text);
      if (!bodyText) {
        throw new Error("single_page_empty_text");
      }
      sourceLocator = normalizeText(fetchedPage.url) || sourceLocator;
      title = normalized.title || normalizeText(fetchedPage.title) || sourceLocator;
      mimeType = "text/html";
      fetchStatus = "fetched";
      fetchMetadata = {
        fetched_url: sourceLocator,
        final_url: sourceLocator,
        title: normalizeText(fetchedPage.title) || null,
        headings: Array.isArray(fetchedPage.headings) ? fetchedPage.headings.filter(Boolean).slice(0, 25) : [],
        fetched_at: new Date().toISOString()
      };
      metadata = {
        ...metadata,
        imported_from_single_page: true
      };
      filename = null;
    } else if (!bodyText && normalized.fileBase64) {
      const parsed = extractTextFromDocumentBuffer({
        buffer: Buffer.from(normalized.fileBase64, "base64"),
        mimeType: normalized.mimeType,
        filename: normalized.filename || normalized.title
      });
      bodyText = normalizeText(parsed.bodyText);
      mimeType = parsed.mimeType;
      metadata = {
        ...metadata,
        parse_method: parsed.parseMethod,
        parsed_from_file: true
      };
    }

    if (!title || !bodyText) {
      throw new Error("uploaded_document_title_and_body_required");
    }
    if (bodyText.length > MAX_UPLOADED_DOCUMENT_BODY_CHARS) {
      throw new Error("uploaded_document_body_too_large");
    }
    const uploadedDocumentId = normalized.uploadedDocumentId || createId("udoc");
    const sourceHash = stableHash({
      title,
      bodyText,
      sourceKind: normalized.sourceKind,
      sourceLocator,
      documentClass: normalized.documentClass,
      sourceAuthority: normalized.sourceAuthority
    });
    const contentFingerprint = stableHash({
      bodyText,
      mimeType,
      sourceKind: normalized.sourceKind
    });
    await client.query(
      `INSERT INTO uploaded_documents (
         uploaded_document_id, tenant_key, status, title, filename, mime_type, source_authority, document_class,
         body_text, metadata_json, source_hash, created_by_type, created_by_id, updated_at,
         source_kind, source_locator, fetch_status, fetch_metadata_json, content_fingerprint
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, 'tenant', $12, NOW(), $13, $14, $15, $16::jsonb, $17)
       ON CONFLICT (uploaded_document_id)
       DO UPDATE SET status = EXCLUDED.status,
                     title = EXCLUDED.title,
                     filename = EXCLUDED.filename,
                     mime_type = EXCLUDED.mime_type,
                     source_authority = EXCLUDED.source_authority,
                     document_class = EXCLUDED.document_class,
                     body_text = EXCLUDED.body_text,
                     metadata_json = EXCLUDED.metadata_json,
                     source_hash = EXCLUDED.source_hash,
                     source_kind = EXCLUDED.source_kind,
                     source_locator = EXCLUDED.source_locator,
                     fetch_status = EXCLUDED.fetch_status,
                     fetch_metadata_json = EXCLUDED.fetch_metadata_json,
                     content_fingerprint = EXCLUDED.content_fingerprint,
                     created_by_id = EXCLUDED.created_by_id,
                     updated_at = NOW()`,
      [
        uploadedDocumentId,
        tenantKey,
        normalized.status,
        title,
        filename,
        mimeType,
        normalized.sourceAuthority,
        normalized.documentClass,
        bodyText,
        JSON.stringify(metadata),
        sourceHash,
        actorId(actor),
        normalized.sourceKind,
        sourceLocator,
        fetchStatus,
        JSON.stringify(fetchMetadata),
        contentFingerprint
      ]
    );
    await writeAuditLog(client, tenantKey, actor, "knowledge_receptionist.uploaded_document.saved", {
      uploaded_document_id: uploadedDocumentId,
      document_class: normalized.documentClass,
      source_authority: normalized.sourceAuthority
    });
    const res = await client.query(
      `SELECT *
       FROM uploaded_documents
       WHERE uploaded_document_id = $1
       LIMIT 1`,
      [uploadedDocumentId]
    );
    return res.rows[0] || null;
  });
}

export async function archiveUploadedDocument(db, tenantKey, uploadedDocumentId, actor = null) {
  await assertConfigTablesReady(db);
  return withTransaction(db, async (client) => {
    const id = normalizeText(uploadedDocumentId);
    if (!id) {
      throw new Error("uploaded_document_not_found");
    }

    const existingRes = await client.query(
      `SELECT *
       FROM uploaded_documents
       WHERE tenant_key = $1
         AND uploaded_document_id = $2
       LIMIT 1`,
      [tenantKey, id]
    );
    const existing = existingRes.rows[0] || null;
    if (!existing) {
      throw new Error("uploaded_document_not_found");
    }
    if (normalizeText(existing.status) === "archived") {
      return existing;
    }

    const archivedRes = await client.query(
      `UPDATE uploaded_documents
       SET status = 'archived',
           updated_at = NOW()
       WHERE tenant_key = $1
         AND uploaded_document_id = $2
       RETURNING *`,
      [tenantKey, id]
    );
    const archived = archivedRes.rows[0] || null;
    await writeAuditLog(client, tenantKey, actor, "knowledge_receptionist.uploaded_document.archived", {
      uploaded_document_id: id,
      prior_status: existing.status || null,
      title: existing.title || null
    });
    return archived;
  });
}

function normalizeCallOutcomeSchemaPayload(payload = {}) {
  return {
    callOutcomeSchemaId: normalizeText(payload.callOutcomeSchemaId || payload.call_outcome_schema_id),
    status: normalizeText(payload.status) || "approved_live",
    domainScope: asStringArray(payload.domainScope || payload.domain_scope),
    subdomainScope: asStringArray(payload.subdomainScope || payload.subdomain_scope),
    outcomeTypes: asStringArray(payload.outcomeTypes || payload.outcome_types),
    requiredFieldsByOutcome: asObject(payload.requiredFieldsByOutcome || payload.required_fields_by_outcome),
    optionalFieldsByOutcome: asObject(payload.optionalFieldsByOutcome || payload.optional_fields_by_outcome),
    summaryTemplate: normalizeText(payload.summaryTemplate || payload.summary_template),
    validationRules: asStringArray(payload.validationRules || payload.validation_rules),
    metadata: asObject(payload.metadata)
  };
}

async function loadCallOutcomeSchemaById(db, callOutcomeSchemaId) {
  const res = await db.query(
    `SELECT *
     FROM call_outcome_schemas
     WHERE call_outcome_schema_id = $1
     LIMIT 1`,
    [callOutcomeSchemaId]
  );
  return res.rows[0] || null;
}

export async function loadCallOutcomeSchemaState(db, tenantKey) {
  await assertConfigTablesReady(db);
  const res = await db.query(
    `SELECT *
     FROM call_outcome_schemas
     WHERE tenant_key = $1
     ORDER BY updated_at DESC`,
    [tenantKey]
  );
  const activeSchema = (res.rows || []).find((row) => ["approved_live", "active"].includes(normalizeText(row.status))) || null;
  return {
    schemas: res.rows || [],
    activeSchema: activeSchema || res.rows[0] || null
  };
}

export async function saveCallOutcomeSchema(db, tenantKey, payload = {}, actor = null) {
  await assertConfigTablesReady(db);
  return withTransaction(db, async (client) => {
    const normalized = normalizeCallOutcomeSchemaPayload(payload);
    const existing = normalized.callOutcomeSchemaId
      ? await loadCallOutcomeSchemaById(client, normalized.callOutcomeSchemaId)
      : null;
    if (existing && normalizeText(existing.tenant_key) !== normalizeText(tenantKey)) {
      throw new Error("call_outcome_schema_tenant_mismatch");
    }

    const callOutcomeSchemaId = normalized.callOutcomeSchemaId || createId("outcome");
    const outcomeTypes = normalized.outcomeTypes.length
      ? normalized.outcomeTypes
      : ["callback_request", "message_taken", "transfer"];
    const requiredFieldsByOutcome = Object.keys(normalized.requiredFieldsByOutcome).length
      ? normalized.requiredFieldsByOutcome
      : {
          callback_request: ["caller_name", "caller_phone", "preferred_time"],
          message_taken: ["caller_name", "caller_phone", "issue_summary"]
        };
    const optionalFieldsByOutcome = Object.keys(normalized.optionalFieldsByOutcome).length
      ? normalized.optionalFieldsByOutcome
      : {
          callback_request: ["issue_summary"],
          message_taken: ["service_address", "urgency"]
        };
    const summaryTemplate = normalized.summaryTemplate
      || "Outcome: {outcome_type}\nCaller: {caller_name}\nPhone: {caller_phone}\nIssue: {issue_summary}";

    await client.query(
      `INSERT INTO call_outcome_schemas (
         call_outcome_schema_id, tenant_key, status, domain_scope_json, subdomain_scope_json, outcome_types_json,
         required_fields_by_outcome_json, optional_fields_by_outcome_json, summary_template, validation_rules_json,
         metadata_json, created_by_id, updated_by_id, updated_at
       )
       VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11::jsonb, $12, $12, NOW()
       )
       ON CONFLICT (call_outcome_schema_id)
       DO UPDATE SET status = EXCLUDED.status,
                     domain_scope_json = EXCLUDED.domain_scope_json,
                     subdomain_scope_json = EXCLUDED.subdomain_scope_json,
                     outcome_types_json = EXCLUDED.outcome_types_json,
                     required_fields_by_outcome_json = EXCLUDED.required_fields_by_outcome_json,
                     optional_fields_by_outcome_json = EXCLUDED.optional_fields_by_outcome_json,
                     summary_template = EXCLUDED.summary_template,
                     validation_rules_json = EXCLUDED.validation_rules_json,
                     metadata_json = EXCLUDED.metadata_json,
                     updated_by_id = EXCLUDED.updated_by_id,
                     updated_at = NOW()`,
      [
        callOutcomeSchemaId,
        tenantKey,
        normalized.status,
        JSON.stringify(normalized.domainScope),
        JSON.stringify(normalized.subdomainScope),
        JSON.stringify(outcomeTypes),
        JSON.stringify(requiredFieldsByOutcome),
        JSON.stringify(optionalFieldsByOutcome),
        summaryTemplate,
        JSON.stringify(normalized.validationRules),
        JSON.stringify(normalized.metadata),
        actorId(actor)
      ]
    );

    await writeAuditLog(client, tenantKey, actor, "knowledge_receptionist.call_outcome_schema.saved", {
      call_outcome_schema_id: callOutcomeSchemaId,
      status: normalized.status
    });

    return loadCallOutcomeSchemaById(client, callOutcomeSchemaId);
  });
}

function normalizeSessionConfig(value) {
  const source = asObject(value);
  const turnDetection = asObject(source.turn_detection || source.turnDetection);
  const reasoning = asObject(source.reasoning);
  const reasoningEffort = normalizeText(reasoning.effort || source.reasoning_effort || source.reasoningEffort).toLowerCase();
  const silenceDurationMs = Number.isFinite(Number(turnDetection.silence_duration_ms ?? turnDetection.silenceDurationMs))
    ? Math.max(0, Math.min(10_000, Number(turnDetection.silence_duration_ms ?? turnDetection.silenceDurationMs)))
    : DEFAULT_RUNTIME_SESSION_CONFIG.turn_detection.silence_duration_ms;
  const normalizedTurnDetection = {
    type: "server_vad",
    threshold: Number.isFinite(Number(turnDetection.threshold))
      ? Math.max(0.1, Math.min(0.9, Number(turnDetection.threshold)))
      : DEFAULT_RUNTIME_SESSION_CONFIG.turn_detection.threshold,
    silence_duration_ms: silenceDurationMs
  };
  if (Number.isFinite(Number(turnDetection.prefix_padding_ms ?? turnDetection.prefixPaddingMs))) {
    normalizedTurnDetection.prefix_padding_ms = Math.max(
      0,
      Math.min(10_000, Number(turnDetection.prefix_padding_ms ?? turnDetection.prefixPaddingMs))
    );
  }
  if (turnDetection.idle_timeout_ms === null || turnDetection.idleTimeoutMs === null) {
    normalizedTurnDetection.idle_timeout_ms = null;
  } else if (Number.isFinite(Number(turnDetection.idle_timeout_ms ?? turnDetection.idleTimeoutMs))) {
    normalizedTurnDetection.idle_timeout_ms = Math.max(
      0,
      Math.min(10_000, Number(turnDetection.idle_timeout_ms ?? turnDetection.idleTimeoutMs))
    );
  }
  return {
    model: normalizeText(source.model) || DEFAULT_RUNTIME_SESSION_CONFIG.model,
    voice: normalizeText(source.voice) || DEFAULT_RUNTIME_SESSION_CONFIG.voice,
    reasoning: { effort: reasoningEffort === "none" ? "none" : "high" },
    turn_detection: normalizedTurnDetection,
    transcription_model: normalizeText(source.transcription_model || source.transcriptionModel)
      || DEFAULT_RUNTIME_SESSION_CONFIG.transcription_model,
    input_audio_format: normalizeText(source.input_audio_format || source.inputAudioFormat)
      || DEFAULT_RUNTIME_SESSION_CONFIG.input_audio_format,
    output_audio_format: normalizeText(source.output_audio_format || source.outputAudioFormat)
      || DEFAULT_RUNTIME_SESSION_CONFIG.output_audio_format
  };
}

function normalizeToolPolicy(value) {
  const source = asObject(value);
  const finishSessionOnlyAfterSpokenClose = source.allow_finish_session_only_after_spoken_close;
  const legacyEndCallOnlyAfterSpokenClose = source.allow_end_call_only_after_spoken_close;
  return {
    require_knowledge_lookup_for_tenant_facts: source.require_knowledge_lookup_for_tenant_facts === undefined
      ? DEFAULT_RUNTIME_TOOL_POLICY.require_knowledge_lookup_for_tenant_facts
      : Boolean(source.require_knowledge_lookup_for_tenant_facts),
    max_clarifying_questions: Number.isFinite(Number(source.max_clarifying_questions ?? source.maxClarifyingQuestions))
      ? Number(source.max_clarifying_questions ?? source.maxClarifyingQuestions)
      : DEFAULT_RUNTIME_TOOL_POLICY.max_clarifying_questions,
    allow_finish_session_only_after_spoken_close: finishSessionOnlyAfterSpokenClose === undefined && legacyEndCallOnlyAfterSpokenClose === undefined
      ? DEFAULT_RUNTIME_TOOL_POLICY.allow_finish_session_only_after_spoken_close
      : Boolean(finishSessionOnlyAfterSpokenClose ?? legacyEndCallOnlyAfterSpokenClose),
    require_single_question_turns: source.require_single_question_turns === undefined
      ? DEFAULT_RUNTIME_TOOL_POLICY.require_single_question_turns
      : Boolean(source.require_single_question_turns)
  };
}

function normalizeWordingDefaults(value) {
  const source = asObject(value);
  return {
    ai_disclosure: normalizeText(source.ai_disclosure || source.aiDisclosure) || DEFAULT_RUNTIME_WORDING_DEFAULTS.ai_disclosure,
    uncertainty_phrase: normalizeText(source.uncertainty_phrase || source.uncertaintyPhrase) || DEFAULT_RUNTIME_WORDING_DEFAULTS.uncertainty_phrase,
    pricing_fallback: normalizeText(source.pricing_fallback || source.pricingFallback) || DEFAULT_RUNTIME_WORDING_DEFAULTS.pricing_fallback,
    callback_offer: normalizeText(source.callback_offer || source.callbackOffer) || DEFAULT_RUNTIME_WORDING_DEFAULTS.callback_offer,
    closing_phrase: normalizeText(source.closing_phrase || source.closingPhrase) || DEFAULT_RUNTIME_WORDING_DEFAULTS.closing_phrase
  };
}

function normalizeRuntimeDefaults(value) {
  const source = asObject(value);
  return {
    clarification_style: normalizeText(source.clarification_style || source.clarificationStyle)
      || DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS.clarification_style,
    after_hours_mode: normalizeText(source.after_hours_mode || source.afterHoursMode)
      || DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS.after_hours_mode,
    concise_responses: source.concise_responses === undefined
      ? DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS.concise_responses
      : Boolean(source.concise_responses),
    callback_offer_required: source.callback_offer_required === undefined
      ? DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS.callback_offer_required
      : Boolean(source.callback_offer_required)
  };
}

function defaultGreetingText(tenantKey) {
  const fallbackName = normalizeText(tenantKey).replace(/[_-]+/g, " ").trim() || "the business";
  return `Thanks for calling ${fallbackName}. How can I help?`;
}

async function loadDefaultCompanyDescription(db, tenantKey) {
  const buildDerived = await loadBuildDerivedCompanyDescription(db, tenantKey);
  if (buildDerived) return buildDerived;
  const res = await db.query(
    `SELECT t.name,
            bp.company_description
     FROM tenants t
     LEFT JOIN tenant_bootstrap_profiles bp
       ON bp.tenant_key = t.tenant_key
     WHERE t.tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const row = res.rows?.[0] || {};
  const bootstrapDescription = normalizeText(row.company_description);
  if (bootstrapDescription) return bootstrapDescription;
  const businessName = normalizeText(row.name);
  if (businessName) return businessName;
  return "";
}

function rawRuntimeProfilePayloadFromRow(row) {
  return {
    company_description: row?.company_description,
    greeting_text: row?.greeting_text,
    session_config: row?.session_config_json,
    tool_policy: row?.tool_policy_json,
    wording_defaults: row?.wording_defaults_json,
    runtime_defaults: row?.runtime_defaults_json
  };
}

function normalizeRuntimeProfilePayload(tenantKey, payload = {}, options = {}) {
  const source = asObject(payload);
  const companyDescriptionDefault = normalizeText(options.companyDescriptionDefault || options.company_description_default);
  return {
    companyDescription: normalizeText(source.companyDescription || source.company_description) || companyDescriptionDefault,
    greetingText: normalizeText(source.greetingText || source.greeting_text) || defaultGreetingText(tenantKey),
    sessionConfig: normalizeSessionConfig(source.sessionConfig || source.session_config),
    toolPolicy: normalizeToolPolicy(source.toolPolicy || source.tool_policy),
    wordingDefaults: normalizeWordingDefaults(source.wordingDefaults || source.wording_defaults),
    runtimeDefaults: normalizeRuntimeDefaults(source.runtimeDefaults || source.runtime_defaults)
  };
}

function mapRuntimeProfileRow(tenantKey, row, options = {}) {
  const profile = normalizeRuntimeProfilePayload(tenantKey, {
    company_description: row?.company_description,
    greeting_text: row?.greeting_text,
    session_config: row?.session_config_json,
    tool_policy: row?.tool_policy_json,
    wording_defaults: row?.wording_defaults_json,
    runtime_defaults: row?.runtime_defaults_json
  }, options);
  return {
    tenant_key: tenantKey,
    company_description: profile.companyDescription,
    greeting_text: profile.greetingText,
    session_config: profile.sessionConfig,
    tool_policy: profile.toolPolicy,
    wording_defaults: profile.wordingDefaults,
    runtime_defaults: profile.runtimeDefaults,
    updated_by_id: normalizeText(row?.updated_by_id) || null,
    updated_at: row?.updated_at || null,
    created_at: row?.created_at || null
  };
}

function buildRuntimeProfileFieldState({ defaultValue, effectiveValue, overrideValue, hasOverride }) {
  return {
    default_value: defaultValue,
    override_value: hasOverride ? overrideValue : null,
    effective_value: effectiveValue,
    source: hasOverride ? "tenant_override" : "inherited_default"
  };
}

function comparableRuntimeProfile(profile, tenantKey, options = {}) {
  const normalized = normalizeRuntimeProfilePayload(tenantKey, {
    company_description: profile?.company_description,
    greeting_text: profile?.greeting_text,
    session_config: profile?.session_config,
    tool_policy: profile?.tool_policy,
    wording_defaults: profile?.wording_defaults,
    runtime_defaults: profile?.runtime_defaults
  }, options);
  return {
    tenant_key: tenantKey,
    company_description: normalized.companyDescription,
    greeting_text: normalized.greetingText,
    session_config: normalized.sessionConfig,
    tool_policy: normalized.toolPolicy,
    wording_defaults: normalized.wordingDefaults,
    runtime_defaults: normalized.runtimeDefaults
  };
}

function pruneInheritedValue(value, defaultValue) {
  const valueIsObject = value && typeof value === "object" && !Array.isArray(value);
  const defaultIsObject = defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue);
  if (valueIsObject || defaultIsObject) {
    const source = valueIsObject ? value : {};
    const defaults = defaultIsObject ? defaultValue : {};
    const keys = Array.from(new Set([...Object.keys(source), ...Object.keys(defaults)]));
    const output = {};
    for (const key of keys) {
      const pruned = pruneInheritedValue(source[key], defaults[key]);
      if (pruned !== undefined) {
        output[key] = pruned;
      }
    }
    return Object.keys(output).length ? output : undefined;
  }
  return JSON.stringify(value) === JSON.stringify(defaultValue) ? undefined : value;
}

function buildRuntimeProfileFieldSources(tenantKey, row, options = {}) {
  const raw = rawRuntimeProfilePayloadFromRow(row);
  const defaults = normalizeRuntimeProfilePayload(tenantKey, {}, options);
  const effective = normalizeRuntimeProfilePayload(tenantKey, raw, options);
  const rawToolPolicy = asObject(raw.tool_policy);
  const rawWordingDefaults = asObject(raw.wording_defaults);
  const rawRuntimeDefaults = asObject(raw.runtime_defaults);

  return {
    companyDescription: buildRuntimeProfileFieldState({
      defaultValue: defaults.companyDescription,
      effectiveValue: effective.companyDescription,
      overrideValue: normalizeText(raw.company_description),
      hasOverride: raw.company_description !== undefined && raw.company_description !== null && normalizeText(raw.company_description).length > 0
    }),
    greetingText: buildRuntimeProfileFieldState({
      defaultValue: defaults.greetingText,
      effectiveValue: effective.greetingText,
      overrideValue: normalizeText(raw.greeting_text),
      hasOverride: raw.greeting_text !== undefined && raw.greeting_text !== null && normalizeText(raw.greeting_text).length > 0
    }),
    aiDisclosure: buildRuntimeProfileFieldState({
      defaultValue: defaults.wordingDefaults.ai_disclosure,
      effectiveValue: effective.wordingDefaults.ai_disclosure,
      overrideValue: normalizeText(rawWordingDefaults.ai_disclosure),
      hasOverride: Object.prototype.hasOwnProperty.call(rawWordingDefaults, "ai_disclosure")
    }),
    uncertaintyPhrase: buildRuntimeProfileFieldState({
      defaultValue: defaults.wordingDefaults.uncertainty_phrase,
      effectiveValue: effective.wordingDefaults.uncertainty_phrase,
      overrideValue: normalizeText(rawWordingDefaults.uncertainty_phrase),
      hasOverride: Object.prototype.hasOwnProperty.call(rawWordingDefaults, "uncertainty_phrase")
    }),
    pricingFallback: buildRuntimeProfileFieldState({
      defaultValue: defaults.wordingDefaults.pricing_fallback,
      effectiveValue: effective.wordingDefaults.pricing_fallback,
      overrideValue: normalizeText(rawWordingDefaults.pricing_fallback),
      hasOverride: Object.prototype.hasOwnProperty.call(rawWordingDefaults, "pricing_fallback")
    }),
    closingPhrase: buildRuntimeProfileFieldState({
      defaultValue: defaults.wordingDefaults.closing_phrase,
      effectiveValue: effective.wordingDefaults.closing_phrase,
      overrideValue: normalizeText(rawWordingDefaults.closing_phrase),
      hasOverride: Object.prototype.hasOwnProperty.call(rawWordingDefaults, "closing_phrase")
    }),
    requireKnowledgeLookup: buildRuntimeProfileFieldState({
      defaultValue: defaults.toolPolicy.require_knowledge_lookup_for_tenant_facts,
      effectiveValue: effective.toolPolicy.require_knowledge_lookup_for_tenant_facts,
      overrideValue: rawToolPolicy.require_knowledge_lookup_for_tenant_facts,
      hasOverride: Object.prototype.hasOwnProperty.call(rawToolPolicy, "require_knowledge_lookup_for_tenant_facts")
    }),
    maxClarifyingQuestions: buildRuntimeProfileFieldState({
      defaultValue: defaults.toolPolicy.max_clarifying_questions,
      effectiveValue: effective.toolPolicy.max_clarifying_questions,
      overrideValue: Object.prototype.hasOwnProperty.call(rawToolPolicy, "max_clarifying_questions")
        ? Number(rawToolPolicy.max_clarifying_questions)
        : null,
      hasOverride: Object.prototype.hasOwnProperty.call(rawToolPolicy, "max_clarifying_questions")
    }),
    allowFinishSessionOnlyAfterSpokenClose: buildRuntimeProfileFieldState({
      defaultValue: defaults.toolPolicy.allow_finish_session_only_after_spoken_close,
      effectiveValue: effective.toolPolicy.allow_finish_session_only_after_spoken_close,
      overrideValue: Object.prototype.hasOwnProperty.call(rawToolPolicy, "allow_finish_session_only_after_spoken_close")
        ? rawToolPolicy.allow_finish_session_only_after_spoken_close
        : rawToolPolicy.allow_end_call_only_after_spoken_close,
      hasOverride: Object.prototype.hasOwnProperty.call(rawToolPolicy, "allow_finish_session_only_after_spoken_close")
        || Object.prototype.hasOwnProperty.call(rawToolPolicy, "allow_end_call_only_after_spoken_close")
    }),
    conciseResponses: buildRuntimeProfileFieldState({
      defaultValue: defaults.runtimeDefaults.concise_responses,
      effectiveValue: effective.runtimeDefaults.concise_responses,
      overrideValue: rawRuntimeDefaults.concise_responses,
      hasOverride: Object.prototype.hasOwnProperty.call(rawRuntimeDefaults, "concise_responses")
    })
  };
}

export async function loadKnowledgeRuntimeProfile(db, tenantKey) {
  await assertConfigTablesReady(db);
  const [companyDescriptionDefault, res] = await Promise.all([
    loadDefaultCompanyDescription(db, tenantKey),
    db.query(
      `SELECT tenant_key, company_description, greeting_text, session_config_json, tool_policy_json, wording_defaults_json,
            runtime_defaults_json, updated_by_id, updated_at, created_at
       FROM knowledge_runtime_profiles
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    )
  ]);
  return mapRuntimeProfileRow(tenantKey, res.rows[0] || null, { companyDescriptionDefault });
}

export async function loadKnowledgeRuntimeProfileEditorState(db, tenantKey) {
  await assertConfigTablesReady(db);
  const [companyDescriptionDefault, res] = await Promise.all([
    loadDefaultCompanyDescription(db, tenantKey),
    db.query(
      `SELECT tenant_key, company_description, greeting_text, session_config_json, tool_policy_json, wording_defaults_json,
            runtime_defaults_json, updated_by_id, updated_at, created_at
       FROM knowledge_runtime_profiles
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    )
  ]);
  const row = res.rows[0] || null;
  const profile = mapRuntimeProfileRow(tenantKey, row, { companyDescriptionDefault });
  const fieldSources = buildRuntimeProfileFieldSources(tenantKey, row, { companyDescriptionDefault });
  const hasOverrides = Object.values(fieldSources).some((item) => item?.source === "tenant_override");
  return {
    profile,
    field_sources: fieldSources,
    has_overrides: hasOverrides
  };
}

export async function saveKnowledgeRuntimeProfile(db, tenantKey, payload = {}, actor = null) {
  await assertConfigTablesReady(db);
  return withTransaction(db, async (client) => {
    const companyDescriptionDefault = await loadDefaultCompanyDescription(client, tenantKey);
    const previous = await loadKnowledgeRuntimeProfile(client, tenantKey);
    const normalized = normalizeRuntimeProfilePayload(tenantKey, payload, { companyDescriptionDefault });
    const defaults = normalizeRuntimeProfilePayload(tenantKey, {}, { companyDescriptionDefault });
    const companyDescriptionOverride = normalized.companyDescription === defaults.companyDescription ? null : normalized.companyDescription;
    const greetingOverride = normalized.greetingText === defaults.greetingText ? null : normalized.greetingText;
    const sessionConfigOverrides = pruneInheritedValue(normalized.sessionConfig, defaults.sessionConfig) || null;
    const toolPolicyOverrides = pruneInheritedValue(normalized.toolPolicy, defaults.toolPolicy) || null;
    const wordingDefaultOverrides = pruneInheritedValue(normalized.wordingDefaults, defaults.wordingDefaults) || null;
    const runtimeDefaultOverrides = pruneInheritedValue(normalized.runtimeDefaults, defaults.runtimeDefaults) || null;
    await client.query(
      `INSERT INTO knowledge_runtime_profiles (
         tenant_key, company_description, greeting_text, session_config_json, tool_policy_json, wording_defaults_json,
         runtime_defaults_json, updated_by_id, updated_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, NOW())
       ON CONFLICT (tenant_key)
       DO UPDATE SET company_description = EXCLUDED.company_description,
                     greeting_text = EXCLUDED.greeting_text,
                     session_config_json = EXCLUDED.session_config_json,
                     tool_policy_json = EXCLUDED.tool_policy_json,
                     wording_defaults_json = EXCLUDED.wording_defaults_json,
                     runtime_defaults_json = EXCLUDED.runtime_defaults_json,
                     updated_by_id = EXCLUDED.updated_by_id,
                     updated_at = NOW()`,
      [
        tenantKey,
        companyDescriptionOverride,
        greetingOverride,
        JSON.stringify(sessionConfigOverrides),
        JSON.stringify(toolPolicyOverrides),
        JSON.stringify(wordingDefaultOverrides),
        JSON.stringify(runtimeDefaultOverrides),
        actorId(actor)
      ]
    );
    const changedFields = diffObjectPaths(comparableRuntimeProfile(previous, tenantKey, { companyDescriptionDefault }), {
      tenant_key: tenantKey,
      company_description: normalized.companyDescription,
      greeting_text: normalized.greetingText,
      session_config: normalized.sessionConfig,
      tool_policy: normalized.toolPolicy,
      wording_defaults: normalized.wordingDefaults,
      runtime_defaults: normalized.runtimeDefaults
    });
    await writeAuditLog(client, tenantKey, actor, auditActionName(
      actor,
      "knowledge_receptionist.runtime_profile.saved",
      "admin.tenant_runtime_profile.saved"
    ), {
      target_tenant: tenantKey,
      changed_fields: changedFields,
      company_description: normalized.companyDescription,
      greeting_text: normalized.greetingText
    });
    return loadKnowledgeRuntimeProfile(client, tenantKey);
  });
}

export async function resetKnowledgeRuntimeProfileToDefaults(db, tenantKey, actor = null) {
  await assertConfigTablesReady(db);
  return withTransaction(db, async (client) => {
    const companyDescriptionDefault = await loadDefaultCompanyDescription(client, tenantKey);
    const previous = await loadKnowledgeRuntimeProfile(client, tenantKey);
    await client.query(
      `DELETE FROM knowledge_runtime_profiles
       WHERE tenant_key = $1`,
      [tenantKey]
    );
    const next = await loadKnowledgeRuntimeProfile(client, tenantKey);
    await writeAuditLog(client, tenantKey, actor, auditActionName(
      actor,
      "knowledge_receptionist.runtime_profile.reset_to_defaults",
      "admin.tenant_runtime_profile.reset_to_defaults"
    ), {
      target_tenant: tenantKey,
      changed_fields: diffObjectPaths(
        comparableRuntimeProfile(previous, tenantKey, { companyDescriptionDefault }),
        comparableRuntimeProfile(next, tenantKey, { companyDescriptionDefault })
      )
    });
    return loadKnowledgeRuntimeProfileEditorState(client, tenantKey);
  });
}

export async function loadApprovedConfigurationArtifacts(db, tenantKey) {
  const [businessState, overrides, guardrails, callOutcomeSchema, runtimeProfile] = await Promise.all([
    loadBusinessCallIntentState(db, tenantKey),
    listKnowledgeOverrides(db, tenantKey, { activeOnly: true }),
    listKnowledgeGuardrails(db, tenantKey, { activeOnly: true }),
    loadCallOutcomeSchemaState(db, tenantKey),
    loadKnowledgeRuntimeProfile(db, tenantKey)
  ]);
  return {
    businessCallIntent: businessState.approvedIntent,
    overrides,
    guardrails,
    callOutcomeSchema: callOutcomeSchema.activeSchema,
    runtimeProfile
  };
}

export function defaultBusinessCallStageIds() {
  return [...DEFAULT_STAGE_IDS];
}
