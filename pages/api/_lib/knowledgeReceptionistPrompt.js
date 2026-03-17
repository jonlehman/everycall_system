import crypto from "node:crypto";
import {
  executePlannerPgvectorRuntime,
  FORCED_RUNTIME_CONFIDENCE_SCORE,
  FORCED_SUPPORT_MODE_ACTIVE,
  getRuntimeBundleConfidenceScore,
  selectMatchedGuardrails as selectSharedMatchedGuardrails,
  selectMatchedOverrides as selectSharedMatchedOverrides
} from "@everycall/contracts";
import { getKnowledgeBuild, loadActiveKnowledgeBuildAssets } from "./knowledgeReceptionistBuilds.js";
import { loadApprovedConfigurationArtifacts } from "./knowledgeReceptionistConfig.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
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

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
        : "Answer direct caller questions from approved business truth and move them toward the right next step.",
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
  return {
    intent_id: intent.setup_interview_intent_id || intent.business_call_intent_id || "intent",
    intent_type: intent.setup_interview_intent_id ? "setup_interview_intent" : "business_call_intent",
    primary_goal: normalizeText(intent.primary_goal),
    summary: normalizeText(intent.primary_goal)
      || (runtimeEntryMode === "setup_interview"
        ? "Guide the owner through a structured setup interview and confirm the approved business truth."
        : "Welcome callers, answer directly from approved business truth, and move them toward the next supported step."),
    stage_ids: stageIds
  };
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
    updated_at: profile.updated_at ? new Date(profile.updated_at).toISOString() : null,
    created_at: profile.created_at ? new Date(profile.created_at).toISOString() : null
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
    applies_to_intents: asStringArray(override.applies_to_intents_json || override.applies_to_intents),
    applies_to_domains: asStringArray(override.applies_to_domains_json || override.applies_to_domains),
    applies_to_subdomains: asStringArray(override.applies_to_subdomains_json || override.applies_to_subdomains),
    effective_from: normalizeText(override.effective_from) || null,
    effective_until: normalizeText(override.effective_until) || null,
    metadata: asObject(override.metadata_json || override.metadata)
  };
}

function normalizeGuardrailForContract(guardrail, tenantKey) {
  if (!guardrail) return null;
  return {
    knowledge_guardrail_id: normalizeText(guardrail.knowledge_guardrail_id),
    tenant_id: normalizeText(guardrail.tenant_key || guardrail.tenant_id) || tenantKey,
    guardrail_type: normalizeText(guardrail.guardrail_type),
    trigger_patterns: asStringArray(guardrail.trigger_patterns_json || guardrail.trigger_patterns),
    trigger_intents: asStringArray(guardrail.trigger_intents_json || guardrail.trigger_intents),
    risk_level: normalizeText(guardrail.risk_level),
    mode: normalizeText(guardrail.mode) || "clarify",
    approved_response_pattern: normalizeText(guardrail.approved_response_pattern),
    required_next_step: normalizeText(guardrail.required_next_step) || null,
    optional_capture_fields: asStringArray(guardrail.optional_capture_fields_json || guardrail.optional_capture_fields),
    escalation_instruction: normalizeText(guardrail.escalation_instruction) || null,
    applies_to_domains: asStringArray(guardrail.applies_to_domains_json || guardrail.applies_to_domains),
    applies_to_subdomains: asStringArray(guardrail.applies_to_subdomains_json || guardrail.applies_to_subdomains),
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

function createInitialCallState({
  tenantKey,
  callId,
  runtimeEntryMode,
  build,
  intentSummary,
  currentStage
}) {
  const assignments = Array.isArray(build?.domain_assignments_json) ? build.domain_assignments_json : [];
  return {
    call_id: callId,
    tenant_id: tenantKey,
    runtime_entry_mode: runtimeEntryMode,
    current_stage: normalizeText(currentStage) || intentSummary.stage_ids[0] || (runtimeEntryMode === "setup_interview" ? "opening" : "discover_need"),
    completed_stages: [],
    skipped_stages: [],
    active_domain_id: normalizeText(assignments[0]?.domain_id) || null,
    active_subdomain_id: normalizeText(assignments[0]?.subdomain_id) || null,
    active_service: null,
    active_location: null,
    active_provider: null,
    pending_clarifier: null,
    last_turn_intent: null,
    last_bundle_id: null,
    captured_fields: {},
    outcome_in_progress: null,
    uncertainty_mode: null
  };
}

function buildTenantPersona(runtimeProfile, intentSummary) {
  const wordingDefaults = runtimeProfile?.wording_defaults || {};
  const runtimeDefaults = runtimeProfile?.runtime_defaults || {};
  const toneRules = uniqueValues(intentSummary?.tone_rules || []);
  return [
    `Business role: ${intentSummary.summary}`,
    `Greeting style: ${normalizeText(runtimeProfile?.greeting_text) || "Warm, concise, and helpful."}`,
    `Tone: ${toneRules.length ? toneRules.join(" | ") : "Be clear, short, and helpful on every turn."}`,
    `AI disclosure wording: ${normalizeText(wordingDefaults.ai_disclosure) || "I'm the business's automated assistant."}`,
    `Uncertainty wording: ${normalizeText(wordingDefaults.uncertainty_phrase) || "I want to make sure I get that right."}`,
    `Pricing fallback wording: ${normalizeText(wordingDefaults.pricing_fallback) || "I can help with the next step, but final pricing is confirmed by the team."}`,
    `Closing wording: ${normalizeText(wordingDefaults.closing_phrase) || "I'll make sure the team has that."}`,
    `Response style: ${runtimeDefaults.concise_responses === false ? "helpful and complete" : "one or two short sentences"}`
  ].join("\n");
}

function buildResponseRestrictions(runtimeEntryMode, matchedGuardrails = [], matchedOverrides = []) {
  const rules = [
    "Answer directly and briefly.",
    "Use only source-backed business information from the answer packet for tenant-specific claims.",
    "Do not invent pricing, availability, guarantees, or policy details.",
    "Ask at most one short clarifying question if needed.",
    "Do not stop abruptly after a direct answer unless the caller is clearly done or is interrupting.",
    "After answering, make one gentle forward-motion move that fits the moment.",
    "Prefer the lightest useful move: tie back to what the caller said, ask one soft discovery question, or offer one optional helpful detail.",
    "Do not jump straight to scheduling, callback, or a hard sales close unless the caller shows clear intent or the answer is incomplete.",
    "Treat next_step_options as optional support, not mandatory spoken output.",
    "When retrieved material overlaps or contains noise, prefer the most directly relevant and concrete capability or policy statements.",
    "Ignore privacy-policy, contact-form, and admin text unless the caller is explicitly asking about those topics.",
    "If the remaining material still conflicts, avoid making a hard unsupported claim and offer a callback or follow-up."
  ];
  if (runtimeEntryMode === "setup_interview") {
    rules.push("Treat confirmed summary blocks as authoritative and raw transcript text as evidence only.");
  }
  if (matchedOverrides.some((item) => ["hard_fact", "temporary_notice"].includes(normalizeText(item.override_type)))) {
    rules.push("Approved overrides outrank retrieved build content for this turn.");
  }
  if (matchedGuardrails.length) {
    rules.push("If a dangerous-question guardrail matches, follow the approved bounded response pattern.");
  }
  return uniqueValues(rules);
}

function deriveRuntimeMode(answerPacket, matchedGuardrails = []) {
  const guardrailModes = uniqueValues((matchedGuardrails || []).map((item) => normalizeText(item.mode)));
  if (guardrailModes.includes("emergency_redirect")) return "emergency_redirect";
  if (guardrailModes.includes("handoff")) return "handoff";
  if (guardrailModes.includes("clarify")) return "clarify";
  return normalizeText(answerPacket?.runtime_mode) || "clarify";
}

function buildCompatibilityBundle(answerPacket, runtimeEntryMode, build, cardResultsByCoverageItem = {}, factResultsByCoverageItem = {}) {
  const assignments = Array.isArray(build?.domain_assignments_json) ? build.domain_assignments_json : [];
  const packetCardIds = uniqueValues(Array.isArray(answerPacket.used_card_ids) ? answerPacket.used_card_ids : []);
  const preferredCardIds = packetCardIds.length
    ? packetCardIds
    : uniqueValues(
      Object.values(cardResultsByCoverageItem)
        .flatMap((items) => items.slice(0, 2))
        .map((item) => item.knowledge_card_id)
    );
  const selectedCards = preferredCardIds.slice(0, 1).map((cardId) => {
    const match = Object.values(cardResultsByCoverageItem).flatMap((items) => items).find((item) => item.knowledge_card_id === cardId);
    return match ? {
      knowledge_card_id: match.knowledge_card_id,
      canonical_name: match.canonical_name,
      speakable_summary: match.support_summary || match.summary || match.canonical_name
    } : null;
  }).filter(Boolean);
  const packetFactIds = uniqueValues(Array.isArray(answerPacket.used_fact_ids) ? answerPacket.used_fact_ids : []);
  const preferredFactIds = packetFactIds.length
    ? packetFactIds
    : uniqueValues(
      Object.values(factResultsByCoverageItem)
        .flatMap((items) => items.slice(0, 6))
        .map((item) => item.knowledge_fact_id)
    );
  const selectedFacts = preferredFactIds.slice(0, 6).map((factId) => {
    const match = Object.values(factResultsByCoverageItem).flatMap((items) => items).find((item) => item.knowledge_fact_id === factId);
    return match ? {
      fact_id: match.knowledge_fact_id,
      claim: match.claim_text,
      fact_role: match.fact_role
    } : null;
  }).filter(Boolean);
  return {
    runtime_bundle_id: answerPacket.answer_packet_id,
    call_id: "runtime_preview",
    turn_id: createId("turn"),
    tenant_id: answerPacket.tenant_id,
    build_id: answerPacket.build_id,
    runtime_entry_mode: runtimeEntryMode,
    runtime_mode: answerPacket.runtime_mode,
    active_domain_id: normalizeText(assignments[0]?.domain_id) || null,
    active_subdomain_id: normalizeText(assignments[0]?.subdomain_id) || null,
    detected_turn_intent: answerPacket.query_text,
    selected_cards: selectedCards,
    selected_answer_facts: selectedFacts,
    missing_critical_slots: [],
    state_delta: {},
    response_rules: [],
    confidence_score: getRuntimeBundleConfidenceScore(answerPacket.coverage || []),
    forced_support_mode: FORCED_SUPPORT_MODE_ACTIVE,
    forced_confidence_score: FORCED_SUPPORT_MODE_ACTIVE ? FORCED_RUNTIME_CONFIDENCE_SCORE : undefined
  };
}

function renderAnswerPacketInstructions(answerPacket, responseRestrictions) {
  const coverageLines = (answerPacket.coverage || []).map((item) => (
    `- ${item.requested_coverage_item_text} [${item.support_strength}]`
  ));
  const direct = (answerPacket.direct_answer_points || []).map((item) => `- ${item}`).join("\n") || "- none";
  const qualifiers = (answerPacket.qualifiers || []).map((item) => `- ${item}`).join("\n") || "- none";
  const limits = (answerPacket.limits_or_exclusions || []).map((item) => `- ${item}`).join("\n") || "- none";
  const nextSteps = (answerPacket.next_step_options || []).map((item) => `- ${item}`).join("\n") || "- none";
  const unsupported = (answerPacket.unsupported_requested_items || []).map((item) => `- ${item}`).join("\n") || "- none";
  return {
    current_context: `Coverage requested:\n${coverageLines.join("\n") || "- none"}`,
    approved_facts: [
      "Direct answer points:",
      direct,
      "",
      "Qualifiers:",
      qualifiers,
      "",
      "Limits or exclusions:",
      limits,
      "",
      "Next steps:",
      nextSteps,
      "",
      "Unsupported requested items:",
      unsupported
    ].join("\n"),
    response_rules: `Response rules:\n- ${responseRestrictions.join("\n- ")}`
  };
}

function renderGatewaySystemPrompt({ tenantPersona }) {
  return [
    "You are the live phone receptionist and soft-sales assistant for the business.",
    "Answer direct caller questions first, then move to the next supported step.",
    "For tenant-specific facts, call knowledge_lookup and speak only from the returned answer_packet.",
    "If answer_packet.unsupported_requested_items is non-empty, say you do not have confirmed details and offer the next supported step.",
    "After answering, keep the conversation moving with one gentle, natural follow-up unless the caller is clearly done.",
    "For broad or exploratory questions, prefer one soft discovery question over a hard close.",
    "For specific factual questions, answer first and then use the lightest natural follow-up instead of pushing a concrete next step.",
    "Use next_step_options only when they genuinely fit the caller's stage or when the answer is incomplete.",
    "When retrieved material overlaps or contains noise, prefer the most directly relevant and concrete capability or policy statements.",
    "Ignore privacy-policy, contact-form, and admin text unless the caller is explicitly asking about those topics.",
    "If the remaining material still conflicts, avoid making a hard unsupported claim and offer a callback or follow-up.",
    "Keep each response to one or two short sentences unless the caller clearly needs a concise clarification.",
    "",
    "Tenant persona and wording:",
    tenantPersona
  ].join("\n");
}

function buildPromptPreview(answerPacket, responseRestrictions) {
  return [
    "Answer packet:",
    JSON.stringify(answerPacket, null, 2),
    "",
    `Response rules:\n- ${responseRestrictions.join("\n- ")}`
  ].join("\n");
}

async function loadBuildAndConfiguration(db, tenantKey, runtimeEntryMode, input = {}) {
  const buildId = normalizeText(input.buildId || input.build_id);
  const build = buildId
    ? await getKnowledgeBuild(db, tenantKey, buildId)
    : (await loadActiveKnowledgeBuildAssets(db, tenantKey, { useCache: true })).build;
  if (!build) {
    throw new Error(buildId ? "build_not_found" : "no_active_build");
  }
  const [{ businessCallIntent, overrides, guardrails, readiness, callOutcomeSchema, runtimeProfile }, setupInterviewIntent] = await Promise.all([
    loadApprovedConfigurationArtifacts(db, tenantKey),
    runtimeEntryMode === "setup_interview" ? loadSetupInterviewIntent(db, tenantKey) : Promise.resolve(null)
  ]);

  const intentSummary = summarizeIntent(
    runtimeEntryMode === "setup_interview" ? setupInterviewIntent : businessCallIntent,
    runtimeEntryMode
  );

  return {
    build,
    configuration: {
      runtime_profile: normalizeRuntimeProfile(runtimeProfile, tenantKey),
      overrides: (overrides || []).map((item) => normalizeOverrideForContract(item, tenantKey)).filter(Boolean),
      guardrails: (guardrails || []).map((item) => normalizeGuardrailForContract(item, tenantKey)).filter(Boolean),
      call_outcome_schema: normalizeCallOutcomeSchema(callOutcomeSchema) || undefined,
      readiness: normalizeReadinessForContract(readiness, tenantKey) || undefined
    },
    intentSummary
  };
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
    properties[field] = field === "outcome_type"
      ? { type: "string", enum: outcomeTypes }
      : { type: "string" };
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
  const { build, configuration, intentSummary } = await loadBuildAndConfiguration(db, tenantKey, runtimeEntryMode, input);
  const initialCallState = createInitialCallState({
    tenantKey,
    callId,
    runtimeEntryMode,
    build,
    intentSummary,
    currentStage: intentSummary.stage_ids[0]
  });
  const tenantPersona = buildTenantPersona(configuration.runtime_profile, intentSummary);
  const systemPrompt = renderGatewaySystemPrompt({ tenantPersona });

  return {
    build,
    systemPrompt,
    tenantPersona,
    businessCallIntentSummary: intentSummary.summary,
    approvedConfiguration: configuration,
    initialCallState,
    tokenCounts: {
      startup_instruction_tokens: estimateTokenCount(systemPrompt),
      prompt_payload_tokens: estimateTokenCount({
        active_build_id: build.build_id,
        tenant_persona: tenantPersona,
        business_call_intent_summary: intentSummary.summary
      })
    }
  };
}

export async function assembleKnowledgeRuntimeTurn(db, tenantKey, input = {}) {
  const runtimeEntryMode = normalizeText(input.runtimeEntryMode || input.runtime_entry_mode) || "customer_call";
  const query = normalizeText(input.query);
  if (!query) {
    throw new Error("query_required");
  }

  const callId = normalizeText(input.callId || input.call_id || input.callSid || input.call_sid) || createId("call");
  const { build, configuration, intentSummary } = await loadBuildAndConfiguration(db, tenantKey, runtimeEntryMode, input);
  const callState = asObject(input.callState || input.call_state);
  const currentStage = normalizeText(callState.current_stage) || intentSummary.stage_ids[0] || "answer_or_route";
  const tenantPersona = buildTenantPersona(configuration.runtime_profile, intentSummary);

  const runtimeResult = await executePlannerPgvectorRuntime(db, {
    tenantKey,
    buildId: build.build_id,
    queryText: query,
    recentConversationSummary: normalizeText(input.recentConversationSummary || input.recent_conversation_summary || ""),
    tenantPersona,
    businessCallIntentSummary: intentSummary.summary,
    currentStage,
    plannerModel: build.planner_model || undefined,
    embeddingModel: build.embedding_model || undefined
  });

  const compatibilityBundle = buildCompatibilityBundle(
    runtimeResult.answerPacket,
    runtimeEntryMode,
    build,
    runtimeResult.cardResultsByCoverageItem,
    runtimeResult.factResultsByCoverageItem
  );

  const matchedOverrides = selectSharedMatchedOverrides(configuration.overrides || [], query, compatibilityBundle);
  const matchedGuardrails = selectSharedMatchedGuardrails(configuration.guardrails || [], query, compatibilityBundle, callState);
  const runtimeMode = deriveRuntimeMode(runtimeResult.answerPacket, matchedGuardrails);
  const responseRestrictions = buildResponseRestrictions(runtimeEntryMode, matchedGuardrails, matchedOverrides);
  const instructionSections = renderAnswerPacketInstructions(
    { ...runtimeResult.answerPacket, runtime_mode: runtimeMode },
    responseRestrictions
  );

  const nextCallState = {
    ...createInitialCallState({
      tenantKey,
      callId,
      runtimeEntryMode,
      build,
      intentSummary,
      currentStage
    }),
    ...callState,
    current_stage: runtimeMode === "clarify" ? "clarify_if_needed" : (runtimeMode === "handoff" || runtimeMode === "emergency_redirect" ? "advance_next_step" : currentStage),
    last_turn_intent: query,
    last_bundle_id: runtimeResult.answerPacket.answer_packet_id,
    uncertainty_mode: runtimeMode === "clarify" ? "needs_clarification" : null
  };

  const promptPreview = buildPromptPreview(runtimeResult.answerPacket, responseRestrictions);

  return {
    build,
    answerPacket: {
      ...runtimeResult.answerPacket,
      runtime_mode: runtimeMode
    },
    runtimeBundle: {
      ...compatibilityBundle,
      runtime_mode: runtimeMode
    },
    planner: runtimeResult.planner,
    promptPreview,
    promptPayloadTokens: estimateTokenCount(runtimeResult.answerPacket),
    matchedOverrides,
    matchedGuardrails,
    callState: nextCallState,
    responseRestrictions,
    retrievalTelemetry: {
      ...runtimeResult.tokenCounts,
      planner_coverage_items: runtimeResult.planner.coverage_items,
      coverage: runtimeResult.answerPacket.coverage,
      coverage_support_events: runtimeResult.coverageSupportEvents
    },
    instructionSections,
    tokenCounts: {
      runtime_bundle_tokens: estimateTokenCount(compatibilityBundle),
      prompt_payload_tokens: estimateTokenCount(runtimeResult.answerPacket),
      answer_packet_tokens: runtimeResult.answerPacket.token_counts.packet_tokens
    }
  };
}

export async function assembleKnowledgeRuntimePreview(db, tenantKey, input = {}) {
  const turn = await assembleKnowledgeRuntimeTurn(db, tenantKey, input);
  return {
    build: turn.build,
    answerPacket: turn.answerPacket,
    runtimeBundle: turn.runtimeBundle,
    planner: turn.planner,
    promptPreview: turn.promptPreview,
    promptPayloadTokens: turn.promptPayloadTokens,
    matchedOverrides: turn.matchedOverrides,
    matchedGuardrails: turn.matchedGuardrails,
    tokenCounts: turn.tokenCounts,
    retrievalTelemetry: turn.retrievalTelemetry,
    instructionSections: turn.instructionSections
  };
}
