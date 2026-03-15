import crypto from "node:crypto";
import {
  deriveRuntimeMode as deriveSharedRuntimeMode,
  selectMatchedGuardrails as selectSharedMatchedGuardrails,
  selectMatchedOverrides as selectSharedMatchedOverrides
} from "../../../packages/contracts/dist/index.js";
import { getKnowledgeBuild, loadActiveKnowledgeBuildAssets, retrieveBuildRuntimeBundle } from "./knowledgeReceptionistBuilds.js";
import { loadApprovedConfigurationArtifacts } from "./knowledgeReceptionistConfig.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
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

function estimateTokenCount(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4);
}

function flattenPromptFragments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return normalizeText(item);
      if (item && typeof item === "object") {
        return normalizeText(item.text || item.fragment || item.instruction || JSON.stringify(item));
      }
      return "";
    })
    .filter(Boolean);
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function defaultRetrievalTelemetry(query = "") {
  return {
    query: query || "startup",
    duration_ms: 0,
    candidate_count: 0,
    selected_card_count: 0,
    lexical_weight: 1.6,
    vector_weight: 0.45,
    precedence_weight: 0.08,
    top_scores: []
  };
}

async function loadSetupInterviewIntent(db, tenantKey) {
  const res = await db.query(
    `SELECT *
     FROM setup_interview_intents
     WHERE tenant_key = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [tenantKey]
  );
  return res.rows[0] || null;
}

async function loadPackContext(db, domainId, subdomainId) {
  const [domainRes, subdomainRes] = await Promise.all([
    db.query(
      `SELECT *
       FROM domain_packs
       WHERE domain_id = $1
       LIMIT 1`,
      [domainId]
    ),
    subdomainId
      ? db.query(
          `SELECT *
           FROM subdomain_packs
           WHERE subdomain_id = $1
           LIMIT 1`,
          [subdomainId]
        )
      : Promise.resolve({ rows: [] })
  ]);
  const domain = domainRes.rows[0] || null;
  const subdomain = subdomainRes.rows[0] || null;
  return {
    domain_id: domainId,
    subdomain_id: subdomainId || null,
    domain_name: domain?.name || null,
    subdomain_name: subdomain?.name || null,
    pack_version: subdomain?.version || domain?.version || "v1",
    prompt_fragments: uniqueValues([
      ...flattenPromptFragments(domain?.default_prompt_fragments_json),
      ...flattenPromptFragments(subdomain?.prompt_fragment_deltas_json)
    ]).slice(0, 4),
    stage_guidance: uniqueValues([
      ...flattenPromptFragments(domain?.default_stage_guidance_json),
      ...flattenPromptFragments(subdomain?.stage_guidance_deltas_json)
    ]).slice(0, 4)
  };
}

function buildUniversalRoleContract(runtimeEntryMode) {
  if (runtimeEntryMode === "setup_interview") {
    return [
      "You are the EveryCall setup interview assistant for the business owner or operator.",
      "Collect and confirm business facts before go-live.",
      "Treat confirmed summary blocks as the approved truth layer."
    ];
  }
  return [
    "You are the live phone receptionist and soft-sales assistant for the business.",
    "You are not an expert advisor.",
    "Use only the approved business information provided for this turn."
  ];
}

function summarizeIntent(intent, runtimeEntryMode) {
  if (!intent) {
    return {
      intent_id: "missing_intent",
      intent_type: runtimeEntryMode === "setup_interview" ? "setup_interview_intent" : "business_call_intent",
      primary_goal: runtimeEntryMode === "setup_interview"
        ? "Collect and confirm business facts needed for launch readiness."
        : "Welcome callers, answer briefly, and move them toward the correct next step.",
      summary: runtimeEntryMode === "setup_interview"
        ? "Guide the owner through a structured setup interview and confirm important facts."
        : "Answer directly from approved facts, stay brief, and advance the correct next step when supported.",
      disclosure_strategy: {},
      handoff_strategy: {},
      after_hours_strategy: {},
      stage_ids: []
    };
  }
  const stageIds = asStringArray(
    Array.isArray(intent.conversation_stage_playbook_json)
      ? intent.conversation_stage_playbook_json.map((item) => item?.stage_id)
      : Array.isArray(intent.interview_stage_playbook_json)
        ? intent.interview_stage_playbook_json.map((item) => item?.stage_id)
        : []
  );
  const primaryGoal = normalizeText(intent.primary_goal);
  return {
    intent_id: intent.setup_interview_intent_id || intent.business_call_intent_id || "intent",
    intent_type: intent.setup_interview_intent_id ? "setup_interview_intent" : "business_call_intent",
    primary_goal: primaryGoal || (runtimeEntryMode === "setup_interview" ? "collect confirmed business truth" : "serve as the business receptionist"),
    summary: runtimeEntryMode === "setup_interview"
      ? `Guide the owner through a structured interview to confirm facts needed for launch readiness. Primary goal: ${primaryGoal || "collect confirmed business truth"}.`
      : `Welcome callers, determine what they need, answer briefly from approved facts, and move them toward the correct next step. Primary goal: ${primaryGoal || "serve as the business receptionist"}.`,
    disclosure_strategy: asObject(intent.disclosure_strategy_json),
    handoff_strategy: asObject(intent.handoff_strategy_json),
    after_hours_strategy: asObject(intent.after_hours_strategy_json),
    stage_ids: stageIds
  };
}

function normalizeCallOutcomeSchema(schema) {
  if (!schema) return null;
  return {
    call_outcome_schema_id: schema.call_outcome_schema_id,
    tenant_id: schema.tenant_key,
    status: normalizeText(schema.status) || "approved_live",
    domain_scope: asStringArray(schema.domain_scope_json),
    subdomain_scope: asStringArray(schema.subdomain_scope_json),
    outcome_types: asStringArray(schema.outcome_types_json),
    required_fields_by_outcome: asObject(schema.required_fields_by_outcome_json),
    optional_fields_by_outcome: asObject(schema.optional_fields_by_outcome_json),
    summary_template: normalizeText(schema.summary_template),
    validation_rules: asStringArray(schema.validation_rules_json),
    metadata: asObject(schema.metadata_json)
  };
}

function toIsoString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function normalizeRuntimeProfile(profile, tenantKey) {
  if (!profile) return null;
  return {
    tenant_id: normalizeText(profile.tenant_key || profile.tenant_id) || tenantKey,
    greeting_text: normalizeText(profile.greeting_text),
    session_config: asObject(profile.session_config),
    tool_policy: asObject(profile.tool_policy),
    wording_defaults: asObject(profile.wording_defaults),
    runtime_defaults: asObject(profile.runtime_defaults),
    updated_at: toIsoString(profile.updated_at),
    created_at: toIsoString(profile.created_at)
  };
}

function normalizeOverrideForContract(override, tenantKey) {
  if (!override) return null;
  return {
    knowledge_override_id: normalizeText(override.knowledge_override_id),
    tenant_id: normalizeText(override.tenant_key || override.tenant_id) || tenantKey,
    override_type: normalizeText(override.override_type) || "soft_guidance",
    priority: Number.isFinite(Number(override.priority)) ? Number(override.priority) : 100,
    status: normalizeText(override.status) || "approved_live",
    title: normalizeText(override.title),
    body: normalizeText(override.body),
    scope: asObject(override.scope_json || override.scope),
    applies_to_intents: asStringArray(override.applies_to_intents_json || override.applies_to_intents || override.appliesToIntents),
    applies_to_domains: asStringArray(override.applies_to_domains_json || override.applies_to_domains || override.appliesToDomains),
    applies_to_subdomains: asStringArray(override.applies_to_subdomains_json || override.applies_to_subdomains || override.appliesToSubdomains),
    effective_from: normalizeText(override.effective_from || override.effectiveFrom) || null,
    effective_until: normalizeText(override.effective_until || override.effectiveUntil) || null,
    metadata: asObject(override.metadata_json || override.metadata)
  };
}

function normalizeGuardrailForContract(guardrail, tenantKey) {
  if (!guardrail) return null;
  return {
    knowledge_guardrail_id: normalizeText(guardrail.knowledge_guardrail_id),
    tenant_id: normalizeText(guardrail.tenant_key || guardrail.tenant_id) || tenantKey,
    guardrail_type: normalizeText(guardrail.guardrail_type),
    trigger_patterns: asStringArray(guardrail.trigger_patterns_json || guardrail.trigger_patterns || guardrail.triggerPatterns),
    trigger_intents: asStringArray(guardrail.trigger_intents_json || guardrail.trigger_intents || guardrail.triggerIntents),
    risk_level: normalizeText(guardrail.risk_level),
    mode: normalizeText(guardrail.mode) || "clarify",
    approved_response_pattern: normalizeText(guardrail.approved_response_pattern || guardrail.approvedResponsePattern),
    required_next_step: normalizeText(guardrail.required_next_step || guardrail.requiredNextStep) || null,
    optional_capture_fields: asStringArray(guardrail.optional_capture_fields_json || guardrail.optional_capture_fields || guardrail.optionalCaptureFields),
    escalation_instruction: normalizeText(guardrail.escalation_instruction || guardrail.escalationInstruction) || null,
    applies_to_domains: asStringArray(guardrail.applies_to_domains_json || guardrail.applies_to_domains || guardrail.appliesToDomains),
    applies_to_subdomains: asStringArray(guardrail.applies_to_subdomains_json || guardrail.applies_to_subdomains || guardrail.appliesToSubdomains),
    enabled: guardrail.enabled !== false,
    status: normalizeText(guardrail.status) || "approved_live",
    metadata: asObject(guardrail.metadata_json || guardrail.metadata)
  };
}

function normalizeReadinessForContract(readiness, tenantKey) {
  if (!readiness) return null;
  return {
    tenant_id: normalizeText(readiness.tenant_key || readiness.tenant_id) || tenantKey,
    status: normalizeText(readiness.status) || "not_started",
    requested_go_live: Boolean(readiness.requested_go_live),
    review_mode: normalizeText(readiness.review_mode) || "immediate_save",
    checklist: asObject(readiness.checklist),
    blockers: asStringArray(readiness.blockers),
    computed_inputs: asObject(readiness.computed_inputs)
  };
}

function createStartupRuntimeBundle({ tenantKey, callId, buildId, runtimeEntryMode, domainId, subdomainId }) {
  return {
    runtime_bundle_id: createId("rb"),
    call_id: callId,
    turn_id: createId("turn"),
    tenant_id: tenantKey,
    build_id: buildId,
    runtime_entry_mode: runtimeEntryMode,
    runtime_mode: "answer",
    active_domain_id: domainId,
    active_subdomain_id: subdomainId || null,
    detected_turn_intent: "call_opening",
    selected_cards: [],
    selected_answer_facts: [],
    missing_critical_slots: [],
    state_delta: {},
    response_rules: [
      "Answer directly and briefly.",
      "Use the approved bundle for tenant-specific facts.",
      "Ask one short question at most if needed."
    ],
    confidence_score: 0.55
  };
}

function normalizeCallState(input, {
  tenantKey,
  callId,
  runtimeEntryMode,
  runtimeBundle,
  intentSummary,
  stageOverride
}) {
  const source = asObject(input);
  return {
    call_id: normalizeText(source.call_id || source.callId) || callId,
    tenant_id: normalizeText(source.tenant_id || source.tenantId) || tenantKey,
    runtime_entry_mode: runtimeEntryMode,
    current_stage: normalizeText(stageOverride || source.current_stage || source.currentStage)
      || intentSummary.stage_ids[0]
      || (runtimeEntryMode === "setup_interview" ? "opening" : "discover_need"),
    completed_stages: asStringArray(source.completed_stages || source.completedStages),
    skipped_stages: asStringArray(source.skipped_stages || source.skippedStages),
    active_domain_id: normalizeText(source.active_domain_id || source.activeDomainId) || runtimeBundle.active_domain_id,
    active_subdomain_id: normalizeText(source.active_subdomain_id || source.activeSubdomainId) || runtimeBundle.active_subdomain_id || null,
    active_service: normalizeText(source.active_service || source.activeService) || null,
    active_location: normalizeText(source.active_location || source.activeLocation) || null,
    active_provider: normalizeText(source.active_provider || source.activeProvider) || null,
    pending_clarifier: normalizeText(source.pending_clarifier || source.pendingClarifier) || null,
    last_turn_intent: normalizeText(source.last_turn_intent || source.lastTurnIntent) || runtimeBundle.detected_turn_intent || null,
    last_bundle_id: normalizeText(source.last_bundle_id || source.lastBundleId) || runtimeBundle.runtime_bundle_id,
    captured_fields: asObject(source.captured_fields || source.capturedFields),
    outcome_in_progress: normalizeText(source.outcome_in_progress || source.outcomeInProgress) || null,
    uncertainty_mode: normalizeText(source.uncertainty_mode || source.uncertaintyMode) || null
  };
}


function deriveStage(runtimeMode, runtimeEntryMode, priorStage) {
  const normalizedPriorStage = normalizeText(priorStage);
  if (runtimeEntryMode === "setup_interview") {
    if (runtimeMode === "clarify") return "clarify_if_needed";
    if (runtimeMode === "handoff") return "advance_next_step";
    return normalizedPriorStage || "discover_need";
  }
  if (runtimeMode === "clarify") return "clarify_if_needed";
  if (runtimeMode === "handoff" || runtimeMode === "emergency_redirect") return "advance_next_step";
  return normalizedPriorStage || "answer_or_route";
}

function buildResponseRestrictions(runtimeEntryMode, matchedGuardrails = [], matchedOverrides = []) {
  const rules = [
    "Answer directly and briefly.",
    "Do not invent pricing, availability, guarantees, or business-specific policy.",
    "Ask at most one short clarifying question if needed."
  ];
  if (runtimeEntryMode === "setup_interview") {
    rules.push("Treat confirmed summary blocks as authoritative and raw transcript text as evidence only.");
  }
  if (matchedOverrides.some((item) => ["hard_fact", "temporary_notice"].includes(normalizeText(item.override_type)))) {
    rules.push("Hard overrides outrank compiled source knowledge for this turn.");
  }
  if (matchedGuardrails.length) {
    rules.push("If a dangerous-question rule matches, follow the approved bounded response pattern.");
  }
  return uniqueValues(rules);
}

function renderGatewaySystemPrompt(payload) {
  const sections = [
    `Role:\n- ${payload.universal_role_contract.join("\n- ")}`,
    `Business Mission:\n- ${payload.intent_summary.summary}`,
    `Current Context:\n- Stage: ${payload.call_state.current_stage}\n- Mode: ${payload.runtime_mode}\n- Active assignment: ${payload.active_domain.domain_id}${payload.active_domain.subdomain_id ? ` / ${payload.active_domain.subdomain_id}` : ""}`,
    `Response Rules:\n- ${payload.response_restrictions.join("\n- ")}`
  ];
  if (payload.pack_context.prompt_fragments.length) {
    sections.push(`Pack Guidance:\n- ${payload.pack_context.prompt_fragments.join("\n- ")}`);
  }
  return sections.join("\n\n");
}

function renderTurnInstructionSections(payload) {
  const selectedCards = Array.isArray(payload.runtime_bundle.selected_cards) ? payload.runtime_bundle.selected_cards : [];
  const selectedFacts = Array.isArray(payload.runtime_bundle.selected_answer_facts) ? payload.runtime_bundle.selected_answer_facts : [];
  return {
    current_context: [
      `Current stage: ${payload.call_state.current_stage}`,
      `Current mode: ${payload.runtime_mode}`,
      `Active assignment: ${payload.active_domain.domain_id}${payload.active_domain.subdomain_id ? ` / ${payload.active_domain.subdomain_id}` : ""}`,
      `Intent summary: ${payload.intent_summary.summary}`
    ].join("\n"),
    approved_facts: [
      selectedCards.length
        ? `Selected cards:\n${selectedCards.map((card) => `- ${card.canonical_name}: ${card.speakable_summary}`).join("\n")}`
        : "Selected cards:\n- none",
      selectedFacts.length
        ? `Approved facts:\n${selectedFacts.map((fact) => `- ${fact.claim}`).join("\n")}`
        : "Approved facts:\n- none"
    ].join("\n\n"),
    response_rules: `Response rules:\n- ${payload.response_restrictions.join("\n- ")}`
  };
}

async function loadBuildAndBundle(db, tenantKey, input, runtimeEntryMode) {
  const buildId = normalizeText(input.buildId || input.build_id);
  if (buildId) {
    const build = await getKnowledgeBuild(db, tenantKey, buildId);
    if (!build) throw new Error("build_not_found");
    return {
      build,
      retrieval: normalizeText(input.query)
        ? await retrieveBuildRuntimeBundle(db, tenantKey, buildId, input.query, {
            runtimeEntryMode,
            callState: input.callState || input.call_state || null
          })
        : null
    };
  }
  const activeBuild = await loadActiveKnowledgeBuildAssets(db, tenantKey, { useCache: true });
  return {
    build: activeBuild.build,
    retrieval: normalizeText(input.query)
      ? await retrieveBuildRuntimeBundle(db, tenantKey, activeBuild.activeBuildId, input.query, {
          runtimeEntryMode,
          callState: input.callState || input.call_state || null
        })
      : null
  };
}

function buildPromptPayload({
  tenantKey,
  callId,
  runtimeEntryMode,
  runtimeBundle,
  intentSummary,
  packContext,
  callState,
  matchedOverrides,
  matchedGuardrails,
  callOutcomeSchema,
  retrievalTelemetry,
  readiness
}) {
  const runtimeMode = deriveSharedRuntimeMode(runtimeBundle, matchedGuardrails);
  const responseRestrictions = buildResponseRestrictions(runtimeEntryMode, matchedGuardrails, matchedOverrides);
  const payload = {
    runtime_entry_mode: runtimeEntryMode,
    runtime_mode: runtimeMode,
    build_id: runtimeBundle.build_id,
    universal_role_contract: buildUniversalRoleContract(runtimeEntryMode),
    intent_summary: intentSummary,
    active_domain: {
      domain_id: runtimeBundle.active_domain_id,
      subdomain_id: runtimeBundle.active_subdomain_id
    },
    pack_context: packContext,
    tenant_configuration: {
      matched_overrides: matchedOverrides,
      matched_guardrails: matchedGuardrails,
      call_outcome_schema: callOutcomeSchema || undefined,
      readiness: readiness || undefined
    },
    runtime_bundle: {
      ...runtimeBundle,
      runtime_mode: runtimeMode,
      call_id: callId
    },
    call_state: {
      ...callState,
      current_stage: deriveStage(runtimeMode, runtimeEntryMode, callState.current_stage)
    },
    response_restrictions: responseRestrictions,
    retrieval_telemetry: retrievalTelemetry || defaultRetrievalTelemetry(runtimeBundle.detected_turn_intent || "")
  };
  return payload;
}

export function buildFieldSchemaFromOutcomeSchema(callOutcomeSchema, fallbackFieldSchema = {}) {
  if (!callOutcomeSchema) return fallbackFieldSchema;
  const outcomeTypes = asStringArray(callOutcomeSchema.outcome_types);
  const requiredFields = asObject(callOutcomeSchema.required_fields_by_outcome);
  const optionalFields = asObject(callOutcomeSchema.optional_fields_by_outcome);
  const fields = new Set(["outcome_type"]);
  for (const fieldList of Object.values(requiredFields)) {
    for (const field of asStringArray(fieldList)) fields.add(field);
  }
  for (const fieldList of Object.values(optionalFields)) {
    for (const field of asStringArray(fieldList)) fields.add(field);
  }
  const properties = {};
  for (const field of fields) {
    if (field === "outcome_type") {
      properties[field] = { type: "string", enum: outcomeTypes };
      continue;
    }
    properties[field] = { type: "string" };
  }
  return {
    type: "object",
    properties,
    required: ["outcome_type"]
  };
}

export async function assembleKnowledgeGatewayPrompt(db, tenantKey, input = {}) {
  const runtimeEntryMode = normalizeText(input.runtimeEntryMode || input.runtime_entry_mode) || "customer_call";
  const callId = normalizeText(input.callId || input.call_id || input.callSid || input.call_sid) || createId("call");
  const { build } = await loadBuildAndBundle(db, tenantKey, input, runtimeEntryMode);
  const [{ businessCallIntent, overrides, guardrails, readiness, callOutcomeSchema, runtimeProfile }, setupInterviewIntent] = await Promise.all([
    loadApprovedConfigurationArtifacts(db, tenantKey),
    runtimeEntryMode === "setup_interview" ? loadSetupInterviewIntent(db, tenantKey) : Promise.resolve(null)
  ]);
  const normalizedRuntimeProfile = normalizeRuntimeProfile(runtimeProfile, tenantKey);
  const normalizedOverrides = (overrides || []).map((item) => normalizeOverrideForContract(item, tenantKey)).filter(Boolean);
  const normalizedGuardrails = (guardrails || []).map((item) => normalizeGuardrailForContract(item, tenantKey)).filter(Boolean);
  const normalizedReadiness = normalizeReadinessForContract(readiness, tenantKey);
  const normalizedOutcomeSchema = normalizeCallOutcomeSchema(callOutcomeSchema);
  const intentSummary = summarizeIntent(
    runtimeEntryMode === "setup_interview" ? setupInterviewIntent : businessCallIntent,
    runtimeEntryMode
  );
  const buildAssignments = Array.isArray(build?.domain_assignments_json) ? build.domain_assignments_json : [];
  const activeDomainId = normalizeText(buildAssignments[0]?.domain_id) || "service_business";
  const activeSubdomainId = normalizeText(buildAssignments[0]?.subdomain_id) || null;
  const runtimeBundle = createStartupRuntimeBundle({
    tenantKey,
    callId,
    buildId: build.build_id,
    runtimeEntryMode,
    domainId: activeDomainId,
    subdomainId: activeSubdomainId
  });
  const packContext = await loadPackContext(db, runtimeBundle.active_domain_id, runtimeBundle.active_subdomain_id);
  const callState = normalizeCallState(input.callState || input.call_state, {
    tenantKey,
    callId,
    runtimeEntryMode,
    runtimeBundle,
    intentSummary,
    stageOverride: intentSummary.stage_ids[0] || "opening"
  });
  const payload = buildPromptPayload({
    tenantKey,
    callId,
    runtimeEntryMode,
    runtimeBundle,
    intentSummary,
    packContext,
    callState,
    matchedOverrides: [],
    matchedGuardrails: [],
    callOutcomeSchema: normalizedOutcomeSchema,
    retrievalTelemetry: defaultRetrievalTelemetry(),
    readiness: undefined
  });
  const wordingDefaults = normalizedRuntimeProfile?.wording_defaults || {};
  const systemPrompt = [
    renderGatewaySystemPrompt(payload),
    `Default Wording:\n- AI disclosure: ${normalizeText(wordingDefaults.ai_disclosure) || "I'm the business's automated assistant."}\n- Uncertainty: ${normalizeText(wordingDefaults.uncertainty_phrase) || "I want to make sure I get that right."}\n- Pricing fallback: ${normalizeText(wordingDefaults.pricing_fallback) || "I can't quote that precisely here, but I can help with the next step."}\n- Closing: ${normalizeText(wordingDefaults.closing_phrase) || "I'll make sure the team has that."}`
  ].join("\n\n");
  return {
    build,
    promptPayload: payload,
    approvedConfiguration: {
      runtime_profile: normalizedRuntimeProfile,
      overrides: normalizedOverrides,
      guardrails: normalizedGuardrails,
      call_outcome_schema: normalizedOutcomeSchema || undefined,
      readiness: normalizedReadiness || undefined
    },
    systemPrompt,
    initialCallState: payload.call_state,
    tokenCounts: {
      prompt_payload_tokens: estimateTokenCount(payload),
      startup_instruction_tokens: estimateTokenCount(systemPrompt),
      runtime_bundle_tokens: estimateTokenCount(payload.runtime_bundle)
    }
  };
}

export async function assembleKnowledgeRuntimeTurn(db, tenantKey, input = {}) {
  const runtimeEntryMode = normalizeText(input.runtimeEntryMode || input.runtime_entry_mode) || "customer_call";
  const query = normalizeText(input.query);
  if (!query) throw new Error("query_required");

  const callId = normalizeText(input.callId || input.call_id || input.callSid || input.call_sid) || createId("call");
  const { build, retrieval } = await loadBuildAndBundle(db, tenantKey, input, runtimeEntryMode);
  const [{ businessCallIntent, overrides, guardrails, readiness, callOutcomeSchema }, setupInterviewIntent] = await Promise.all([
    loadApprovedConfigurationArtifacts(db, tenantKey),
    runtimeEntryMode === "setup_interview" ? loadSetupInterviewIntent(db, tenantKey) : Promise.resolve(null)
  ]);

  const runtimeBundle = retrieval.runtimeBundle;
  const intentSummary = summarizeIntent(
    runtimeEntryMode === "setup_interview" ? setupInterviewIntent : businessCallIntent,
    runtimeEntryMode
  );
  const initialCallState = normalizeCallState(input.callState || input.call_state, {
    tenantKey,
    callId,
    runtimeEntryMode,
    runtimeBundle,
    intentSummary
  });
  const matchedOverrides = selectSharedMatchedOverrides(overrides, query, runtimeBundle);
  const matchedGuardrails = selectSharedMatchedGuardrails(guardrails, query, runtimeBundle, initialCallState);
  const normalizedMatchedOverrides = matchedOverrides.map((item) => normalizeOverrideForContract(item, tenantKey)).filter(Boolean);
  const normalizedMatchedGuardrails = matchedGuardrails.map((item) => normalizeGuardrailForContract(item, tenantKey)).filter(Boolean);
  const normalizedOutcomeSchema = normalizeCallOutcomeSchema(callOutcomeSchema);
  const packContext = await loadPackContext(db, runtimeBundle.active_domain_id, runtimeBundle.active_subdomain_id);
  const payload = buildPromptPayload({
    tenantKey,
    callId,
    runtimeEntryMode,
    runtimeBundle,
    intentSummary,
    packContext,
    callState: initialCallState,
    matchedOverrides: normalizedMatchedOverrides,
    matchedGuardrails: normalizedMatchedGuardrails,
    callOutcomeSchema: normalizedOutcomeSchema,
    retrievalTelemetry: retrieval.retrievalTelemetry,
    readiness: undefined
  });

  return {
    build,
    runtimeBundle: payload.runtime_bundle,
    promptPayload: payload,
    promptPreview: renderGatewaySystemPrompt(payload),
    promptPayloadTokens: estimateTokenCount(payload),
    matchedOverrides: normalizedMatchedOverrides,
    matchedGuardrails: normalizedMatchedGuardrails,
    callState: payload.call_state,
    responseRestrictions: payload.response_restrictions,
    retrievalTelemetry: payload.retrieval_telemetry,
    instructionSections: renderTurnInstructionSections(payload),
    tokenCounts: {
      runtime_bundle_tokens: estimateTokenCount(payload.runtime_bundle),
      prompt_payload_tokens: estimateTokenCount(payload)
    }
  };
}

export async function assembleKnowledgeRuntimePreview(db, tenantKey, input = {}) {
  const turn = await assembleKnowledgeRuntimeTurn(db, tenantKey, input);
  return {
    build: turn.build,
    promptPayload: turn.promptPayload,
    promptPreview: turn.promptPreview,
    promptPayloadTokens: turn.promptPayloadTokens,
    matchedOverrides: turn.matchedOverrides,
    matchedGuardrails: turn.matchedGuardrails,
    tokenCounts: turn.tokenCounts
  };
}
