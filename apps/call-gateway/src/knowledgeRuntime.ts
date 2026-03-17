import { performance } from "node:perf_hooks";
import {
  executePlannerPgvectorRuntime,
  persistCoverageGapEvents,
  selectMatchedGuardrails as selectSharedMatchedGuardrails,
  selectMatchedOverrides as selectSharedMatchedOverrides,
  type CallState
} from "@everycall/contracts";

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount?: number; rows?: any[] }>;
};

type PoolLike = Queryable | null;

export type GatewayPromptPayload = {
  system_prompt: string;
  tenant_greeting: string;
  field_schema: Record<string, unknown>;
  tool_definitions: Array<Record<string, unknown>>;
  session_config: any;
  knowledge_runtime: {
    active_build_id: string;
    active_domain_id: string | null;
    active_subdomain_id: string | null;
    runtime_entry_mode: string;
    initial_call_state: CallState;
    tenant_persona: string;
    business_call_intent_summary: string;
    approved_configuration: {
      runtime_profile: {
        greeting_text: string;
        session_config: any;
        tool_policy: any;
        wording_defaults: any;
        runtime_defaults: any;
      };
      overrides: Array<Record<string, unknown>>;
      guardrails: Array<Record<string, unknown>>;
      call_outcome_schema?: Record<string, unknown>;
      readiness?: Record<string, unknown>;
    };
    token_counts?: {
      prompt_payload_tokens?: number;
      startup_instruction_tokens?: number;
    };
  };
  metadata?: Record<string, unknown>;
};

export type GatewayRuntimeTurnResponse = {
  answer_packet: Record<string, unknown>;
  runtime_bundle: Record<string, unknown>;
  matched_overrides: Array<Record<string, unknown>>;
  matched_guardrails: Array<Record<string, unknown>>;
  call_state: CallState;
  response_restrictions: string[];
  retrieval_telemetry: Record<string, unknown>;
  token_counts: Record<string, unknown>;
  instruction_sections: {
    current_context: string;
    approved_facts: string;
    response_rules: string;
  };
};

type RuntimeTurnInput = {
  tenantKey: string;
  callId: string;
  query: string;
  buildId?: string;
  callState: CallState;
};

type BuildAssetMeta = {
  build_id: string;
  tenant_key: string;
  primaryDomainId: string | null;
  primarySubdomainId: string | null;
  planner_model: string | null;
  embedding_model: string | null;
  card_count: number;
  fact_count: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const buildAssetCache = new Map<string, { assets: BuildAssetMeta; loadedAt: number }>();

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function estimateTokenCount(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4);
}

function cacheKey(tenantKey: string, buildId: string) {
  return `${tenantKey}:${buildId}`;
}

function setBuildAssetCache(tenantKey: string, buildId: string, assets: BuildAssetMeta) {
  buildAssetCache.set(cacheKey(tenantKey, buildId), { assets, loadedAt: Date.now() });
}

function invalidateBuildAssetCache(tenantKey: string, buildId: string) {
  buildAssetCache.delete(cacheKey(tenantKey, buildId));
}

async function loadBuildAssetMetaFromDb(db: Queryable, tenantKey: string, buildId: string): Promise<BuildAssetMeta> {
  const [buildRes, countRes] = await Promise.all([
    db.query(
      `SELECT build_id, tenant_key, domain_assignments_json, planner_model, embedding_model
       FROM knowledge_builds
       WHERE tenant_key = $1
         AND build_id = $2
       LIMIT 1`,
      [tenantKey, buildId]
    ),
    db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM knowledge_build_cards WHERE tenant_key = $1 AND build_id = $2) AS card_count,
         (SELECT COUNT(*)::int FROM knowledge_build_facts WHERE tenant_key = $1 AND build_id = $2) AS fact_count`,
      [tenantKey, buildId]
    )
  ]);

  if (!buildRes.rowCount) {
    throw new Error("build_not_found");
  }

  const buildRow = buildRes.rows?.[0] || {};
  const assignments = Array.isArray(buildRow.domain_assignments_json) ? buildRow.domain_assignments_json : [];
  return {
    build_id: normalizeText(buildRow.build_id),
    tenant_key: normalizeText(buildRow.tenant_key),
    primaryDomainId: normalizeText(assignments[0]?.domain_id) || null,
    primarySubdomainId: normalizeText(assignments[0]?.subdomain_id) || null,
    planner_model: normalizeText(buildRow.planner_model) || null,
    embedding_model: normalizeText(buildRow.embedding_model) || null,
    card_count: Number(countRes.rows?.[0]?.card_count || 0),
    fact_count: Number(countRes.rows?.[0]?.fact_count || 0)
  };
}

async function loadBuildAssets(db: Queryable, tenantKey: string, buildId: string, { useCache = true } = {}) {
  const key = cacheKey(tenantKey, buildId);
  if (useCache) {
    const cached = buildAssetCache.get(key);
    if (cached && (Date.now() - cached.loadedAt) < CACHE_TTL_MS) {
      return { assets: cached.assets, fetchMs: 0, cacheHit: true };
    }
  }

  const started = Date.now();
  const assets = await loadBuildAssetMetaFromDb(db, tenantKey, buildId);
  const fetchMs = Date.now() - started;
  setBuildAssetCache(tenantKey, buildId, assets);
  return { assets, fetchMs, cacheHit: false };
}

function deriveRuntimeMode(answerPacket: Record<string, unknown>, matchedGuardrails: Array<Record<string, unknown>>) {
  const guardrailModes = uniqueValues((matchedGuardrails || []).map((item) => normalizeText(item.mode)));
  if (guardrailModes.includes("emergency_redirect")) return "emergency_redirect";
  if (guardrailModes.includes("handoff")) return "handoff";
  if (guardrailModes.includes("clarify")) return "clarify";
  return normalizeText(answerPacket.runtime_mode) || "clarify";
}

function buildResponseRestrictions(
  runtimeEntryMode: string,
  matchedGuardrails: Array<Record<string, unknown>>,
  matchedOverrides: Array<Record<string, unknown>>,
  configuration: GatewayPromptPayload["knowledge_runtime"]["approved_configuration"]
) {
  const rules = [
    "Answer directly and briefly.",
    "Use only source-backed business information from the answer packet for tenant-specific claims.",
    "Do not invent pricing, availability, guarantees, or policy details.",
    "Ask at most one short clarifying question if needed."
  ];
  if (runtimeEntryMode === "setup_interview") {
    rules.push("Treat confirmed summary blocks as authoritative and raw transcript text as evidence only.");
  }
  if (configuration.runtime_profile.runtime_defaults?.concise_responses !== false) {
    rules.push("Keep each response to one or two short sentences.");
  }
  if (matchedOverrides.some((item) => ["hard_fact", "temporary_notice"].includes(normalizeText(item.override_type)))) {
    rules.push("Approved overrides outrank retrieved build content for this turn.");
  }
  if (matchedGuardrails.length) {
    rules.push("If a dangerous-question guardrail matches, follow the approved bounded response pattern.");
  }
  return uniqueValues(rules);
}

function buildCompatibilityBundle(
  answerPacket: Record<string, any>,
  promptPayload: GatewayPromptPayload,
  cardResultsByCoverageItem: Record<string, any[]>,
  factResultsByCoverageItem: Record<string, any[]>
) {
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
    call_id: "live_call",
    turn_id: answerPacket.answer_packet_id,
    tenant_id: answerPacket.tenant_id,
    build_id: answerPacket.build_id,
    runtime_entry_mode: promptPayload.knowledge_runtime.runtime_entry_mode,
    runtime_mode: answerPacket.runtime_mode,
    active_domain_id: promptPayload.knowledge_runtime.active_domain_id,
    active_subdomain_id: promptPayload.knowledge_runtime.active_subdomain_id,
    detected_turn_intent: answerPacket.query_text,
    selected_cards: selectedCards,
    selected_answer_facts: selectedFacts,
    missing_critical_slots: [],
    state_delta: {},
    response_rules: [],
    confidence_score: answerPacket.coverage?.some((item: any) => item.support_strength === "strong") ? 0.82 : 0.45
  };
}

function renderTurnInstructionSections(
  systemPrompt: string,
  responseRestrictions: string[],
  answerPacket: Record<string, any>,
  callState: CallState
) {
  const coverageLines = Array.isArray(answerPacket.coverage)
    ? answerPacket.coverage.map((item: any) => `- ${normalizeText(item.requested_coverage_item_text)} [${normalizeText(item.support_strength)}]`)
    : [];
  return {
    current_context: [
      `Current stage: ${callState.current_stage}`,
      `Current mode: ${normalizeText(answerPacket.runtime_mode) || "answer"}`,
      `Active assignment: ${normalizeText(callState.active_domain_id)}${normalizeText(callState.active_subdomain_id) ? ` / ${normalizeText(callState.active_subdomain_id)}` : ""}`,
      "Coverage requested:",
      ...(coverageLines.length ? coverageLines : ["- none"])
    ].join("\n"),
    approved_facts: [
      "Direct answer points:",
      ...((Array.isArray(answerPacket.direct_answer_points) && answerPacket.direct_answer_points.length)
        ? answerPacket.direct_answer_points.map((item: any) => `- ${normalizeText(item)}`)
        : ["- none"]),
      "",
      "Qualifiers:",
      ...((Array.isArray(answerPacket.qualifiers) && answerPacket.qualifiers.length)
        ? answerPacket.qualifiers.map((item: any) => `- ${normalizeText(item)}`)
        : ["- none"]),
      "",
      "Limits or exclusions:",
      ...((Array.isArray(answerPacket.limits_or_exclusions) && answerPacket.limits_or_exclusions.length)
        ? answerPacket.limits_or_exclusions.map((item: any) => `- ${normalizeText(item)}`)
        : ["- none"]),
      "",
      "Next steps:",
      ...((Array.isArray(answerPacket.next_step_options) && answerPacket.next_step_options.length)
        ? answerPacket.next_step_options.map((item: any) => `- ${normalizeText(item)}`)
        : ["- none"]),
      "",
      "Unsupported requested items:",
      ...((Array.isArray(answerPacket.unsupported_requested_items) && answerPacket.unsupported_requested_items.length)
        ? answerPacket.unsupported_requested_items.map((item: any) => `- ${normalizeText(item)}`)
        : ["- none"])
    ].join("\n"),
    response_rules: `${systemPrompt}\n\nResponse rules:\n- ${responseRestrictions.join("\n- ")}`
  };
}

export function validateGatewayPromptPayload(input: unknown): GatewayPromptPayload {
  const payload = input as GatewayPromptPayload;
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid_gateway_prompt_payload");
  }
  if (!normalizeText(payload.system_prompt)) {
    throw new Error("invalid_gateway_prompt_payload");
  }
  if (!normalizeText(payload.knowledge_runtime?.active_build_id)) {
    throw new Error("invalid_gateway_prompt_payload");
  }
  return payload;
}

export function isKnowledgeReceptionistPromptPayload(payload: GatewayPromptPayload): payload is GatewayPromptPayload {
  return Boolean(payload?.knowledge_runtime?.active_build_id);
}

export function buildGatewaySessionInstructions(payload: GatewayPromptPayload) {
  const toolPolicy = payload.knowledge_runtime.approved_configuration.runtime_profile.tool_policy || {};
  const policyLines = [
    `- Require knowledge lookup for tenant facts: ${toolPolicy.require_knowledge_lookup_for_tenant_facts ? "yes" : "no"}`,
    `- Max clarifying questions: ${normalizeText(toolPolicy.max_clarifying_questions) || "1"}`,
    `- End call only after spoken close: ${toolPolicy.allow_end_call_only_after_spoken_close === false ? "no" : "yes"}`
  ];
  return [
    payload.system_prompt,
    `Knowledge Tool Policy:\n${policyLines.join("\n")}`,
    payload.tenant_greeting ? `Greeting:\n${payload.tenant_greeting}` : "",
    `Current runtime context:\n- Stage: ${payload.knowledge_runtime.initial_call_state.current_stage}\n- Active assignment: ${normalizeText(payload.knowledge_runtime.active_domain_id)}${normalizeText(payload.knowledge_runtime.active_subdomain_id) ? ` / ${normalizeText(payload.knowledge_runtime.active_subdomain_id)}` : ""}`
  ].filter(Boolean).join("\n\n");
}

export function initializeKnowledgeCallState(payload: GatewayPromptPayload): CallState {
  return payload.knowledge_runtime.initial_call_state;
}

export async function persistKnowledgeCallState(
  pool: PoolLike,
  tenantKey: string,
  callId: string,
  callState: CallState,
  metadata: Record<string, unknown> = {}
) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO call_states (
       call_id, tenant_key, runtime_entry_mode, current_stage, completed_stages_json, skipped_stages_json,
       active_domain_id, active_subdomain_id, active_service, active_location, active_provider,
       pending_clarifier, last_turn_intent, last_bundle_id, captured_fields_json, outcome_in_progress,
       uncertainty_mode, metadata_json, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11,
       $12, $13, $14, $15::jsonb, $16, $17, $18::jsonb, NOW()
     )
     ON CONFLICT (call_id)
     DO UPDATE SET runtime_entry_mode = EXCLUDED.runtime_entry_mode,
                   current_stage = EXCLUDED.current_stage,
                   completed_stages_json = EXCLUDED.completed_stages_json,
                   skipped_stages_json = EXCLUDED.skipped_stages_json,
                   active_domain_id = EXCLUDED.active_domain_id,
                   active_subdomain_id = EXCLUDED.active_subdomain_id,
                   active_service = EXCLUDED.active_service,
                   active_location = EXCLUDED.active_location,
                   active_provider = EXCLUDED.active_provider,
                   pending_clarifier = EXCLUDED.pending_clarifier,
                   last_turn_intent = EXCLUDED.last_turn_intent,
                   last_bundle_id = EXCLUDED.last_bundle_id,
                   captured_fields_json = EXCLUDED.captured_fields_json,
                   outcome_in_progress = EXCLUDED.outcome_in_progress,
                   uncertainty_mode = EXCLUDED.uncertainty_mode,
                   metadata_json = EXCLUDED.metadata_json,
                   updated_at = NOW()`,
    [
      callId,
      tenantKey,
      callState.runtime_entry_mode,
      callState.current_stage,
      JSON.stringify(callState.completed_stages || []),
      JSON.stringify(callState.skipped_stages || []),
      callState.active_domain_id || null,
      callState.active_subdomain_id || null,
      callState.active_service || null,
      callState.active_location || null,
      callState.active_provider || null,
      callState.pending_clarifier || null,
      callState.last_turn_intent || null,
      callState.last_bundle_id || null,
      JSON.stringify(callState.captured_fields || {}),
      callState.outcome_in_progress || null,
      callState.uncertainty_mode || null,
      JSON.stringify(metadata)
    ]
  );
}

export function applyCapturedFieldsToCallState(callState: CallState, payload: Record<string, unknown>): CallState {
  const nextCapturedFields = {
    ...(callState.captured_fields || {}),
    ...payload
  };
  return {
    ...callState,
    captured_fields: nextCapturedFields,
    outcome_in_progress: normalizeText(payload.outcome_type) || callState.outcome_in_progress || null
  };
}

export function formatKnowledgeRuntimeToolOutput(result: GatewayRuntimeTurnResponse) {
  return {
    mode: result.answer_packet.runtime_mode,
    current_stage: result.call_state.current_stage,
    active_domain: result.runtime_bundle.active_domain_id,
    active_subdomain: result.runtime_bundle.active_subdomain_id,
    response_rules: result.response_restrictions,
    answer_packet: result.answer_packet,
    matched_overrides: result.matched_overrides.map((item) => ({
      type: item.override_type,
      title: item.title,
      body: item.body
    })),
    matched_guardrails: result.matched_guardrails.map((item) => ({
      type: item.guardrail_type,
      mode: item.mode,
      approved_response_pattern: item.approved_response_pattern,
      required_next_step: item.required_next_step,
      risk_level: item.risk_level
    })),
    instruction_sections: result.instruction_sections,
    retrieval_telemetry: result.retrieval_telemetry
  };
}

export async function prewarmKnowledgeBuildAssets(pool: PoolLike, tenantKey: string, buildId: string) {
  if (!pool) return { cacheHit: false, fetchMs: 0 };
  const loaded = await loadBuildAssets(pool, tenantKey, buildId, { useCache: false });
  return { cacheHit: loaded.cacheHit, fetchMs: loaded.fetchMs };
}

async function loadRecentConversationSummary(pool: Queryable, callId: string) {
  const res = await pool.query(
    `SELECT role, text
     FROM call_events
     WHERE call_sid = $1
     ORDER BY created_at DESC
     LIMIT 6`,
    [callId]
  );
  const rows = (res.rows || []).slice().reverse();
  return rows.map((row) => `${normalizeText(row.role || "speaker")}: ${normalizeText(row.text)}`).filter(Boolean).join(" | ");
}

export async function fetchKnowledgeRuntimeTurn(
  pool: PoolLike,
  promptPayload: GatewayPromptPayload,
  body: RuntimeTurnInput
): Promise<GatewayRuntimeTurnResponse> {
  if (!pool) {
    throw new Error("database_unavailable");
  }

  const query = normalizeText(body.query);
  if (!query) {
    throw new Error("query_required");
  }

  const buildId = normalizeText(body.buildId) || promptPayload.knowledge_runtime.active_build_id;
  const loaded = await loadBuildAssets(pool, body.tenantKey, buildId, { useCache: true });
  const recentConversationSummary = await loadRecentConversationSummary(pool, body.callId);

  const started = performance.now();
  const runtimeResult = await executePlannerPgvectorRuntime(pool, {
    tenantKey: body.tenantKey,
    buildId,
    queryText: query,
    recentConversationSummary,
    tenantPersona: promptPayload.knowledge_runtime.tenant_persona,
    businessCallIntentSummary: promptPayload.knowledge_runtime.business_call_intent_summary,
    currentStage: normalizeText(body.callState.current_stage) || "answer_or_route",
    ...(loaded.assets.planner_model ? { plannerModel: loaded.assets.planner_model } : {}),
    ...(loaded.assets.embedding_model ? { embeddingModel: loaded.assets.embedding_model } : {})
  });
  const durationMs = Number((performance.now() - started).toFixed(3));

  const compatibilityBundle = buildCompatibilityBundle(
    runtimeResult.answerPacket,
    promptPayload,
    runtimeResult.cardResultsByCoverageItem,
    runtimeResult.factResultsByCoverageItem
  );
  const configuration = promptPayload.knowledge_runtime.approved_configuration;
  const matchedOverrides = selectSharedMatchedOverrides(configuration.overrides, query, compatibilityBundle);
  const matchedGuardrails = selectSharedMatchedGuardrails(configuration.guardrails, query, compatibilityBundle, body.callState);
  const runtimeMode = deriveRuntimeMode(runtimeResult.answerPacket, matchedGuardrails);
  const nextCallState: CallState = {
    ...body.callState,
    current_stage: runtimeMode === "clarify"
      ? "clarify_if_needed"
      : ((runtimeMode === "handoff" || runtimeMode === "emergency_redirect") ? "advance_next_step" : body.callState.current_stage),
    last_turn_intent: query,
    last_bundle_id: normalizeText(runtimeResult.answerPacket.answer_packet_id),
    active_domain_id: loaded.assets.primaryDomainId,
    active_subdomain_id: loaded.assets.primarySubdomainId,
    uncertainty_mode: runtimeMode === "clarify" ? "needs_clarification" : null
  };
  const responseRestrictions = buildResponseRestrictions(
    body.callState.runtime_entry_mode,
    matchedGuardrails,
    matchedOverrides,
    configuration
  );
  const finalAnswerPacket = {
    ...runtimeResult.answerPacket,
    runtime_mode: runtimeMode
  };
  const instructionSections = renderTurnInstructionSections(
    promptPayload.system_prompt,
    responseRestrictions,
    finalAnswerPacket,
    nextCallState
  );

  await pool.query(
    `INSERT INTO runtime_bundles (
       runtime_bundle_id, call_id, turn_id, tenant_key, build_id, runtime_entry_mode, runtime_mode,
       active_domain_id, active_subdomain_id, detected_turn_intent, bundle_json
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb
     )`,
    [
      normalizeText(finalAnswerPacket.answer_packet_id),
      body.callId,
      normalizeText(finalAnswerPacket.answer_packet_id),
      body.tenantKey,
      buildId,
      body.callState.runtime_entry_mode,
      runtimeMode,
      loaded.assets.primaryDomainId,
      loaded.assets.primarySubdomainId,
      query,
      JSON.stringify(finalAnswerPacket)
    ]
  );

  await persistCoverageGapEvents(pool, {
    tenantKey: body.tenantKey,
    buildId,
    callId: body.callId,
    turnId: normalizeText(finalAnswerPacket.answer_packet_id),
    queryText: query,
    events: runtimeResult.coverageSupportEvents,
    metadata: {
      runtime_mode: runtimeMode
    }
  });

  return {
    answer_packet: finalAnswerPacket,
    runtime_bundle: {
      ...compatibilityBundle,
      runtime_mode: runtimeMode,
      call_id: body.callId
    },
    matched_overrides: matchedOverrides,
    matched_guardrails: matchedGuardrails,
    call_state: nextCallState,
    response_restrictions: responseRestrictions,
    retrieval_telemetry: {
      query,
      duration_ms: durationMs,
      asset_cache_hit: loaded.cacheHit,
      asset_fetch_ms: loaded.fetchMs,
      asset_load_strategy: loaded.cacheHit ? "warm_cache" : "cold_fallback",
      planner_coverage_items: runtimeResult.planner.coverage_items,
      coverage: finalAnswerPacket.coverage
    },
    token_counts: {
      startup_prompt_tokens: promptPayload.knowledge_runtime.token_counts?.prompt_payload_tokens ?? 0,
      startup_instruction_tokens: promptPayload.knowledge_runtime.token_counts?.startup_instruction_tokens ?? 0,
      answer_packet_tokens: Number(finalAnswerPacket.token_counts?.packet_tokens || 0),
      runtime_bundle_tokens: estimateTokenCount(compatibilityBundle)
    },
    instruction_sections: instructionSections
  };
}

export function mergeRuntimeTurnState(priorState: CallState, result: GatewayRuntimeTurnResponse): CallState {
  const capturedFields = {
    ...(priorState.captured_fields || {}),
    last_answer_packet_id: normalizeText(result.answer_packet.answer_packet_id) || priorState.last_bundle_id || null,
    last_answer_points: Array.isArray(result.answer_packet.direct_answer_points)
      ? result.answer_packet.direct_answer_points.slice(0, 6)
      : []
  };
  return {
    ...priorState,
    ...result.call_state,
    last_turn_intent: normalizeText(result.answer_packet.query_text) || priorState.last_turn_intent || null,
    last_bundle_id: normalizeText(result.answer_packet.answer_packet_id) || priorState.last_bundle_id || null,
    active_domain_id: normalizeText(result.runtime_bundle.active_domain_id) || priorState.active_domain_id,
    active_subdomain_id: normalizeText(result.runtime_bundle.active_subdomain_id) || priorState.active_subdomain_id,
    captured_fields: capturedFields,
    uncertainty_mode: normalizeText(result.answer_packet.runtime_mode) === "clarify" ? "needs_clarification" : null
  };
}

export function collectPromptTokenReport(payload: GatewayPromptPayload, toolResult?: GatewayRuntimeTurnResponse) {
  return {
    startup_prompt_tokens: payload.knowledge_runtime.token_counts?.prompt_payload_tokens ?? 0,
    startup_instruction_tokens: payload.knowledge_runtime.token_counts?.startup_instruction_tokens ?? 0,
    runtime_bundle_tokens: Number(toolResult?.token_counts?.runtime_bundle_tokens || 0),
    answer_packet_tokens: Number(toolResult?.token_counts?.answer_packet_tokens || 0)
  };
}

export function clearKnowledgeBuildAssetCache(tenantKey?: string, buildId?: string) {
  if (tenantKey && buildId) {
    invalidateBuildAssetCache(tenantKey, buildId);
    return;
  }
  buildAssetCache.clear();
}
