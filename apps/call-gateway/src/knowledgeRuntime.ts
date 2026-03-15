import { performance } from "node:perf_hooks";
import {
  buildSparseEmbedding,
  deriveRuntimeMode as deriveSharedRuntimeMode,
  gatewayPromptPayloadSchema,
  rankKnowledgeCards,
  selectBundleCards as selectSharedBundleCards,
  selectMatchedGuardrails as selectSharedMatchedGuardrails,
  selectMatchedOverrides as selectSharedMatchedOverrides,
  type CallState,
  type GatewayPromptPayload,
  type GatewayRuntimeTurnResponse,
  type KnowledgeGatewayConfiguration,
  type KnowledgeGuardrail,
  type KnowledgeOverride,
  type RankedRuntimeKnowledgeCard
} from "@everycall/contracts";

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount?: number; rows?: any[] }>;
};

type PoolLike = Queryable | null;

type BuildCard = {
  knowledge_card_id: string;
  canonical_name: string;
  aliases_json: string[];
  caller_phrases_json: string[];
  speakable_summary: string;
  answer_facts_json: Array<Record<string, unknown>>;
  quality_score: number;
  search_text: string;
  domain_id: string;
  subdomain_id: string | null;
  content_class: string;
  scope_json: Record<string, unknown>;
  topic_path: string | null;
  card_type: string | null;
  object_type: string | null;
  intent_tags_json: string[];
  entity_tags_json: string[];
  embedding_json: Record<string, number>;
};

type BuildAssets = {
  build_id: string;
  tenant_key: string;
  primaryDomainId: string;
  primarySubdomainId: string | null;
  cards: BuildCard[];
};

type RuntimeTurnInput = {
  tenantKey: string;
  callId: string;
  query: string;
  buildId?: string;
  topic?: string | null;
  serviceTags?: string[];
  tradeHint?: string | null;
  conversationStage?: string | null;
  callState: CallState;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const buildAssetCache = new Map<string, { assets: BuildAssets; loadedAt: number }>();

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
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

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function estimateTokenCount(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4);
}

function cacheKey(tenantKey: string, buildId: string) {
  return `${tenantKey}:${buildId}`;
}

function setBuildAssetCache(tenantKey: string, buildId: string, assets: BuildAssets) {
  buildAssetCache.set(cacheKey(tenantKey, buildId), { assets, loadedAt: Date.now() });
}

function invalidateBuildAssetCache(tenantKey: string, buildId: string) {
  buildAssetCache.delete(cacheKey(tenantKey, buildId));
}

async function loadBuildAssetsFromDb(db: Queryable, tenantKey: string, buildId: string): Promise<BuildAssets> {
  const [buildRes, cardRes, embeddingRes] = await Promise.all([
    db.query(
      `SELECT build_id, tenant_key, domain_assignments_json
       FROM knowledge_builds
       WHERE tenant_key = $1
         AND build_id = $2
       LIMIT 1`,
      [tenantKey, buildId]
    ),
    db.query(
      `SELECT knowledge_card_id, canonical_name, aliases_json, caller_phrases_json, speakable_summary,
              answer_facts_json, quality_score, search_text, domain_id, subdomain_id, content_class, scope_json,
              topic_path, card_type, object_type, intent_tags_json, entity_tags_json
       FROM knowledge_build_cards
       WHERE tenant_key = $1
         AND build_id = $2
       ORDER BY quality_score DESC, created_at DESC`,
      [tenantKey, buildId]
    ),
    db.query(
      `SELECT knowledge_card_id, embedding_json
       FROM knowledge_build_embeddings
       WHERE build_id = $1`,
      [buildId]
    )
  ]);

  if (!buildRes.rowCount) {
    throw new Error("build_not_found");
  }

  const buildRow = buildRes.rows?.[0] || {};
  const assignments = Array.isArray(buildRow.domain_assignments_json) ? buildRow.domain_assignments_json : [];
  const embeddingByCardId = new Map<string, Record<string, number>>(
    (embeddingRes.rows || []).map((row) => [
      normalizeText(row.knowledge_card_id),
      row.embedding_json && typeof row.embedding_json === "object" ? row.embedding_json as Record<string, number> : {}
    ])
  );

  return {
    build_id: buildRow.build_id,
    tenant_key: buildRow.tenant_key,
    primaryDomainId: normalizeText(assignments[0]?.domain_id || cardRes.rows?.[0]?.domain_id),
    primarySubdomainId: normalizeText(assignments[0]?.subdomain_id || cardRes.rows?.[0]?.subdomain_id) || null,
    cards: (cardRes.rows || []).map((row) => ({
      ...row,
      aliases_json: Array.isArray(row.aliases_json) ? row.aliases_json : [],
      caller_phrases_json: Array.isArray(row.caller_phrases_json) ? row.caller_phrases_json : [],
      answer_facts_json: Array.isArray(row.answer_facts_json) ? row.answer_facts_json : [],
      intent_tags_json: Array.isArray(row.intent_tags_json) ? row.intent_tags_json : [],
      entity_tags_json: Array.isArray(row.entity_tags_json) ? row.entity_tags_json : [],
      scope_json: row.scope_json && typeof row.scope_json === "object" && !Array.isArray(row.scope_json)
        ? row.scope_json
        : {},
      embedding_json: embeddingByCardId.get(normalizeText(row.knowledge_card_id)) || {}
    }))
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
  const assets = await loadBuildAssetsFromDb(db, tenantKey, buildId);
  const fetchMs = Date.now() - started;
  setBuildAssetCache(tenantKey, buildId, assets);
  return { assets, fetchMs, cacheHit: false };
}

function tokenizeSearchText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\\s]+/g, " ")
    .split(/\\s+/)
    .filter((token) => token.length >= 2);
}

function hybridSearchBuildAssets(assets: BuildAssets, query: string, callState: CallState | null) {
  const ranking = rankKnowledgeCards(assets.cards, query, { callState, maxResults: 6 });
  return {
    results: ranking.results,
    telemetry: ranking.telemetry
  };
}

function buildRuntimeBundleFromSearch(
  cards: Array<RankedRuntimeKnowledgeCard<BuildCard>>,
  query: string,
  assets: BuildAssets,
  runtimeEntryMode: CallState["runtime_entry_mode"]
) {
  const selectedCards = selectSharedBundleCards(cards, query).map((card, index) => ({
    knowledge_card_id: card.knowledge_card_id,
    canonical_name: card.canonical_name,
    speakable_summary: card.speakable_summary,
    aliases: card.aliases_json,
    caller_phrases: card.caller_phrases_json,
    selected_facts: card.answer_facts_json
      .map((fact) => {
        const source = asObject(fact);
        return {
          fact_id: normalizeText(source.fact_id || source.factId),
          claim: normalizeText(source.claim),
          content_class: normalizeText(source.content_class || source.contentClass) || undefined,
          risk_level: normalizeText(source.risk_level || source.riskLevel) || undefined
        };
      })
      .filter((fact) => fact.fact_id && fact.claim)
      .slice(0, index === 0 ? 2 : 1)
  }));
  const factSeen = new Set<string>();
  const selectedFacts = selectedCards
    .flatMap((card) => card.selected_facts)
    .filter((fact) => {
      const factId = normalizeText((fact as Record<string, unknown>).fact_id);
      if (!factId || factSeen.has(factId)) return false;
      factSeen.add(factId);
      return true;
    })
    .slice(0, 6);

  return {
    runtime_bundle_id: createId("rb"),
    call_id: "live_call",
    turn_id: createId("turn"),
    tenant_id: assets.tenant_key,
    build_id: assets.build_id,
    runtime_entry_mode: runtimeEntryMode,
    runtime_mode: selectedCards.length ? "answer" : "clarify",
    active_domain_id: assets.primaryDomainId,
    active_subdomain_id: assets.primarySubdomainId,
    detected_turn_intent: query,
    selected_cards: selectedCards,
    selected_answer_facts: selectedFacts,
    missing_critical_slots: [],
    state_delta: {},
    response_rules: [
      "Answer only from the bundle.",
      "Do not invent pricing, availability, or policy.",
      "Ask one clarifying question at most if needed."
    ],
    confidence_score: selectedCards.length ? 0.7 : 0.2
  };
}

function deriveStage(runtimeMode: string, runtimeEntryMode: string, priorStage: string) {
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

function buildResponseRestrictions(runtimeEntryMode: string, matchedGuardrails: KnowledgeGuardrail[], matchedOverrides: KnowledgeOverride[], configuration: KnowledgeGatewayConfiguration) {
  const rules = [
    "Answer directly and briefly.",
    "Do not invent pricing, availability, guarantees, or business-specific policy.",
    "Ask at most one short clarifying question if needed."
  ];
  if (runtimeEntryMode === "setup_interview") {
    rules.push("Treat confirmed summary blocks as authoritative and raw transcript text as evidence only.");
  }
  if (configuration.runtime_profile.runtime_defaults.concise_responses) {
    rules.push("Keep each response to one or two short sentences.");
  }
  if (matchedOverrides.some((item) => ["hard_fact", "temporary_notice"].includes(item.override_type))) {
    rules.push("Hard overrides outrank compiled source knowledge for this turn.");
  }
  if (matchedGuardrails.length) {
    rules.push("If a dangerous-question rule matches, follow the approved bounded response pattern.");
  }
  return uniqueValues(rules);
}

function renderTurnInstructionSections(systemPrompt: string, responseRestrictions: string[], runtimeBundle: Record<string, unknown>, callState: CallState) {
  const selectedCards = Array.isArray(runtimeBundle.selected_cards) ? runtimeBundle.selected_cards as Array<Record<string, unknown>> : [];
  const selectedFacts = Array.isArray(runtimeBundle.selected_answer_facts) ? runtimeBundle.selected_answer_facts as Array<Record<string, unknown>> : [];
  return {
    current_context: [
      `Current stage: ${callState.current_stage}`,
      `Current mode: ${normalizeText(runtimeBundle.runtime_mode) || "answer"}`,
      `Active assignment: ${normalizeText(runtimeBundle.active_domain_id)}${normalizeText(runtimeBundle.active_subdomain_id) ? ` / ${normalizeText(runtimeBundle.active_subdomain_id)}` : ""}`
    ].join("\\n"),
    approved_facts: [
      selectedCards.length
        ? `Selected cards:\\n${selectedCards.map((card) => `- ${normalizeText(card.canonical_name)}: ${normalizeText(card.speakable_summary)}`).join("\\n")}`
        : "Selected cards:\\n- none",
      selectedFacts.length
        ? `Approved facts:\\n${selectedFacts.map((fact) => `- ${normalizeText(fact.claim)}`).join("\\n")}`
        : "Approved facts:\\n- none"
    ].join("\\n\\n"),
    response_rules: `${systemPrompt}\\n\\nResponse rules:\\n- ${responseRestrictions.join("\\n- ")}`
  };
}

export function validateGatewayPromptPayload(input: unknown): GatewayPromptPayload {
  return gatewayPromptPayloadSchema.parse(input);
}

export function isKnowledgeReceptionistPromptPayload(payload: GatewayPromptPayload): payload is GatewayPromptPayload {
  return Boolean(payload?.knowledge_runtime?.active_build_id);
}

export function buildGatewaySessionInstructions(payload: GatewayPromptPayload) {
  const toolPolicy = payload.knowledge_runtime.approved_configuration.runtime_profile.tool_policy;
  const policyLines = [
    `- Require knowledge lookup for tenant facts: ${toolPolicy.require_knowledge_lookup_for_tenant_facts ? "yes" : "no"}`,
    `- Max clarifying questions: ${toolPolicy.max_clarifying_questions}`,
    `- End call only after spoken close: ${toolPolicy.allow_end_call_only_after_spoken_close ? "yes" : "no"}`
  ];
  const currentContext = [
    `- Stage: ${payload.knowledge_runtime.prompt_payload.call_state.current_stage}`,
    `- Mode: ${payload.knowledge_runtime.prompt_payload.runtime_mode}`,
    `- Active assignment: ${payload.knowledge_runtime.prompt_payload.active_domain.domain_id}${payload.knowledge_runtime.prompt_payload.active_domain.subdomain_id ? ` / ${payload.knowledge_runtime.prompt_payload.active_domain.subdomain_id}` : ""}`
  ].join("\n");
  return [
    payload.system_prompt,
    `Knowledge Tool Policy:\n${policyLines.join("\n")}`,
    payload.tenant_greeting ? `Greeting:\n${payload.tenant_greeting}` : "",
    `Current runtime context:\n${currentContext}`
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
    mode: result.runtime_bundle.runtime_mode,
    current_stage: result.call_state.current_stage,
    active_domain: result.runtime_bundle.active_domain_id,
    active_subdomain: result.runtime_bundle.active_subdomain_id,
    response_rules: result.response_restrictions,
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
    selected_cards: result.runtime_bundle.selected_cards.map((card) => ({
      canonical_name: card.canonical_name,
      speakable_summary: card.speakable_summary
    })),
    selected_answer_facts: result.runtime_bundle.selected_answer_facts.map((fact) => fact.claim),
    instruction_sections: result.instruction_sections,
    retrieval_telemetry: result.retrieval_telemetry
  };
}

export async function prewarmKnowledgeBuildAssets(pool: PoolLike, tenantKey: string, buildId: string) {
  if (!pool) return { cacheHit: false, fetchMs: 0 };
  const loaded = await loadBuildAssets(pool, tenantKey, buildId, { useCache: false });
  return { cacheHit: loaded.cacheHit, fetchMs: loaded.fetchMs };
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
  const started = performance.now();
  const retrieval = hybridSearchBuildAssets(loaded.assets, query, body.callState);
  const durationMs = Number((performance.now() - started).toFixed(3));
  const runtimeBundle = buildRuntimeBundleFromSearch(
    retrieval.results,
    query,
    loaded.assets,
    body.callState.runtime_entry_mode || promptPayload.knowledge_runtime.runtime_entry_mode
  );

  const configuration = promptPayload.knowledge_runtime.approved_configuration;
  const matchedOverrides = selectSharedMatchedOverrides(configuration.overrides, query, runtimeBundle as unknown as Record<string, unknown>);
  const matchedGuardrails = selectSharedMatchedGuardrails(configuration.guardrails, query, runtimeBundle as unknown as Record<string, unknown>, body.callState);
  const runtimeMode = deriveSharedRuntimeMode(runtimeBundle as unknown as Record<string, unknown>, matchedGuardrails);
  const nextCallState: CallState = {
    ...body.callState,
    current_stage: deriveStage(runtimeMode, body.callState.runtime_entry_mode, body.callState.current_stage),
    last_turn_intent: normalizeText(query) || body.callState.last_turn_intent || null,
    last_bundle_id: runtimeBundle.runtime_bundle_id,
    active_domain_id: runtimeBundle.active_domain_id,
    active_subdomain_id: runtimeBundle.active_subdomain_id || null,
    uncertainty_mode: runtimeMode === "clarify" ? "needs_clarification" : null
  };
  const responseRestrictions = buildResponseRestrictions(
    body.callState.runtime_entry_mode,
    matchedGuardrails,
    matchedOverrides,
    configuration
  );
  const instructionSections = renderTurnInstructionSections(
    promptPayload.system_prompt,
    responseRestrictions,
    { ...runtimeBundle, runtime_mode: runtimeMode },
    nextCallState
  );

  return {
    runtime_bundle: {
      ...runtimeBundle,
      call_id: body.callId,
      runtime_mode: runtimeMode
    },
    matched_overrides: matchedOverrides,
    matched_guardrails: matchedGuardrails,
    call_state: nextCallState,
    response_restrictions: responseRestrictions,
    retrieval_telemetry: {
      ...retrieval.telemetry,
      duration_ms: durationMs,
      asset_cache_hit: loaded.cacheHit,
      asset_fetch_ms: loaded.fetchMs,
      asset_load_strategy: loaded.cacheHit ? "warm_cache" : "cold_fallback"
    },
    token_counts: {
      runtime_bundle_tokens: estimateTokenCount(runtimeBundle),
      prompt_payload_tokens: estimateTokenCount({
        response_restrictions: responseRestrictions,
        instruction_sections: instructionSections
      })
    },
    instruction_sections: instructionSections
  };
}

export function mergeRuntimeTurnState(priorState: CallState, result: GatewayRuntimeTurnResponse): CallState {
  const selectedFacts = uniqueValues(result.runtime_bundle.selected_answer_facts.map((fact) => normalizeText(fact.claim)));
  const capturedFields = { ...(priorState.captured_fields || {}) };
  if (selectedFacts.length) {
    capturedFields.last_answer_facts = selectedFacts;
  }
  return {
    ...priorState,
    ...result.call_state,
    current_stage: deriveStage(result.runtime_bundle.runtime_mode, priorState.runtime_entry_mode, priorState.current_stage),
    last_turn_intent: normalizeText(result.runtime_bundle.detected_turn_intent) || priorState.last_turn_intent || null,
    last_bundle_id: result.runtime_bundle.runtime_bundle_id,
    active_domain_id: result.runtime_bundle.active_domain_id,
    active_subdomain_id: result.runtime_bundle.active_subdomain_id || null,
    captured_fields: capturedFields,
    uncertainty_mode: result.runtime_bundle.runtime_mode === "clarify" ? "needs_clarification" : null
  };
}

export function collectPromptTokenReport(payload: GatewayPromptPayload, toolResult?: GatewayRuntimeTurnResponse) {
  return {
    startup_prompt_tokens: payload.knowledge_runtime.token_counts?.prompt_payload_tokens ?? 0,
    startup_instruction_tokens: payload.knowledge_runtime.token_counts?.startup_instruction_tokens ?? 0,
    runtime_bundle_tokens: toolResult?.token_counts?.runtime_bundle_tokens ?? 0,
    runtime_instruction_tokens: toolResult?.token_counts?.prompt_payload_tokens ?? 0
  };
}

export function clearKnowledgeBuildAssetCache(tenantKey?: string, buildId?: string) {
  if (tenantKey && buildId) {
    invalidateBuildAssetCache(tenantKey, buildId);
    return;
  }
  buildAssetCache.clear();
}
