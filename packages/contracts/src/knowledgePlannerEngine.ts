import { performance } from "node:perf_hooks";
import {
  analyzeCoverageIntent,
  assembleDeterministicAnswerPacket,
  createDeterministicId,
  normalizePlannerResponse,
  plannerTurnResponseSchema,
  type DeterministicAnswerPacket,
  type PlannerTurnResponse,
  type RetrievedCardSupport,
  type RetrievedFactSupport
} from "./knowledgePlannerRuntime.js";
import {
  buildOpenAiEmbeddingsRequestBody,
  buildOpenAiJsonResponseRequestBody,
  callOpenAiJsonModel,
  embedOpenAiTextsDetailed
} from "./openAiStructured.js";

type QueryResultRow = Record<string, any>;
type QueryResult = { rowCount?: number | null; rows?: QueryResultRow[] | null };

export type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<QueryResult>;
};

export type PlannerRuntimeExecutionInput = {
  tenantKey: string;
  buildId: string;
  queryText: string;
  recentConversationSummary: string;
  tenantPersona: string;
  businessCallIntentSummary: string;
  currentStage: string;
  plannerModel?: string;
  embeddingModel?: string;
  cardLimitPerCoverageItem?: number;
  factLimitPerCoverageItem?: number;
  packetSoftBudgetTokens?: number;
  packetHardBudgetTokens?: number;
};

export type CoverageSupportEvent = {
  knowledgeCoverageEventId: string;
  requestedCoverageItemText: string;
  supportStrength: "strong" | "partial" | "none";
  topCardIds: string[];
  topFactIds: string[];
  topScores: Array<{ kind: "card" | "fact"; id: string; similarity: number }>;
  gapReason: string | null;
};

export type PlannerRuntimeExecutionResult = {
  planner: PlannerTurnResponse;
  answerPacket: DeterministicAnswerPacket;
  coverageSupportEvents: CoverageSupportEvent[];
  cardResultsByCoverageItem: Record<string, RetrievedCardSupport[]>;
  factResultsByCoverageItem: Record<string, RetrievedFactSupport[]>;
  timings: {
    planner_ms: number;
    embedding_ms: number;
    retrieval_ms: number;
    packet_ms: number;
    total_ms: number;
  };
  tokenCounts: {
    planner_input_tokens: number;
    planner_output_tokens: number;
    packet_tokens: number;
  };
  debug: {
    planner_response_payload: unknown;
    embedding_request_payload: unknown;
    embedding_response_payloads: unknown[];
  };
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueValues(values: Iterable<unknown>) {
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

function tokenizeForOverlap(value: unknown) {
  return uniqueValues(
    normalizeText(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 3)
  );
}

function lexicalOverlapScore(coverageItemText: string, candidates: Array<unknown>) {
  const coverageTokens = new Set(tokenizeForOverlap(coverageItemText));
  if (!coverageTokens.size) return 0;
  const candidateTokens = new Set(candidates.flatMap((candidate) => tokenizeForOverlap(candidate)));
  let overlap = 0;
  for (const token of coverageTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  return overlap;
}

const SPECIALIZED_TOPIC_KEYWORDS = [
  "furnace",
  "hydronic",
  "heat",
  "pump",
  "sewer",
  "panel",
  "water",
  "heater",
  "charger",
  "electrical",
  "hvac",
  "plumbing"
];

function unmatchedSpecificityPenalty(queryTokens: string[], candidates: Array<unknown>) {
  if (!queryTokens.length) return 0;
  const querySet = new Set(queryTokens);
  const candidateTokens = new Set(candidates.flatMap((candidate) => tokenizeForOverlap(candidate)));
  let penalty = 0;
  for (const keyword of SPECIALIZED_TOPIC_KEYWORDS) {
    if (!querySet.has(keyword) && candidateTokens.has(keyword)) {
      penalty += 1;
    }
  }
  return penalty;
}

function rerankCardSupport(coverageItemText: string, items: RetrievedCardSupport[]) {
  const intent = analyzeCoverageIntent(coverageItemText);
  const scored = items.map((item, index) => {
    const candidateText = `${normalizeText(item.canonical_name)} ${normalizeText(item.summary)} ${normalizeText(item.support_summary)} ${normalizeText(item.topic_name)} ${normalizeText(item.subtopic_name)}`.toLowerCase();
    const canonicalLexical = lexicalOverlapScore(coverageItemText, [
      item.canonical_name,
      ...(item.metadata?.aliases || [])
    ]);
    const topicLexical = lexicalOverlapScore(coverageItemText, [
      item.card_role,
      item.topic_name,
      item.subtopic_name
    ]);
    const supportLexical = lexicalOverlapScore(coverageItemText, [
      item.summary,
      item.support_summary
    ]);
    const specificityPenalty = intent.prefersBroadOverview
      ? unmatchedSpecificityPenalty(intent.queryTokens, [
        item.canonical_name,
        item.summary,
        item.support_summary,
        item.topic_name,
        item.subtopic_name
      ])
      : 0;
    const role = normalizeText(item.card_role).toLowerCase();
    const topicText = `${normalizeText(item.topic_name)} ${normalizeText(item.subtopic_name)} ${(item.support_summary || item.summary || "")}`.toLowerCase();
    let intentBoost = 0;
    if (intent.isWarranty) {
      if (["overview", "coverage", "definition", "faq_answer", "warranty_overview"].includes(role)) intentBoost += 0.12;
      if (!intent.asksLimits && role === "limit") intentBoost -= 0.09;
      if (intent.asksLimits && role === "limit") intentBoost += 0.04;
      if (/forever warranty|harts forever warranty/.test(candidateText)) intentBoost += 0.22;
      if (!intent.queryTokens.some((token) => ["water", "heater", "furnace", "ac", "electrical"].includes(token))
        && /water heater|furnace|ac repair|electrical/.test(candidateText)) {
        intentBoost -= 0.14;
      }
      if (/indicate company confidence|service offerings/.test(candidateText)) {
        intentBoost -= 0.08;
      }
    }
    if (intent.isFinancing) {
      if (["overview", "coverage", "faq_answer"].includes(role)) intentBoost += 0.14;
      if (!intent.queryTokens.some((token) => ["furnace", "hydronic", "panel", "sewer", "heat", "pump"].includes(token)) && role === "capability") {
        intentBoost -= 0.05;
      }
      if (/major projects|approved credit|goodleap/.test(candidateText)) intentBoost += 0.08;
      if (!intent.queryTokens.some((token) => ["furnace", "hydronic", "heat", "pump", "panel", "sewer"].includes(token))
        && /furnace|hydronic|heat pump/.test(candidateText)) {
        intentBoost -= 0.08;
      }
    }
    if (intent.isServiceArea) {
      if (/(service area|coverage|serves|neighborhood)/.test(topicText) || /(service area|coverage|serves|neighborhood)/.test(normalizeText(item.canonical_name).toLowerCase())) {
        intentBoost += 0.12;
      }
      if (!intent.queryTokens.some((token) => ["sewer", "water", "heater", "charger", "plumbing"].includes(token))
        && /sewer|water heater|charger|promotions|discount/.test(candidateText)) {
        intentBoost -= 0.1;
      }
    }
    if (intent.isProcess && ["process", "faq_answer", "overview", "capability"].includes(role)) {
      intentBoost += 0.08;
    }
    const lexical = canonicalLexical + topicLexical + supportLexical;
    const score = item.similarity
      + (canonicalLexical * 0.03)
      + (topicLexical * 0.085)
      + (supportLexical * 0.015)
      + intentBoost
      - (specificityPenalty * 0.015);
    return { item, index, lexical, topicLexical, intentBoost, score };
  });

  const sorted = scored
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.intentBoost !== left.intentBoost) return right.intentBoost - left.intentBoost;
      if (right.topicLexical !== left.topicLexical) return right.topicLexical - left.topicLexical;
      if (right.lexical !== left.lexical) return right.lexical - left.lexical;
      if (right.item.similarity !== left.item.similarity) return right.item.similarity - left.item.similarity;
      return left.index - right.index;
    })
    .map((entry) => entry.item);

  const deduped: RetrievedCardSupport[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    const key = [normalizeText(item.canonical_name).toLowerCase(), normalizeText(item.support_summary || item.summary).toLowerCase()].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function rerankFactSupport(coverageItemText: string, items: RetrievedFactSupport[]) {
  const intent = analyzeCoverageIntent(coverageItemText);
  return items
    .map((item, index) => {
      const claimText = normalizeText(item.claim_text).toLowerCase();
      const lexical = lexicalOverlapScore(coverageItemText, [
        item.claim_text,
        ...(item.qualifiers || []),
        ...(item.boundary_notes || []),
        ...(item.next_steps || []),
        item.topic_name,
        item.subtopic_name,
        item.fact_role
      ]);
      const specificityPenalty = intent.prefersBroadOverview
        ? unmatchedSpecificityPenalty(intent.queryTokens, [
          item.claim_text,
          ...(item.qualifiers || []),
          ...(item.boundary_notes || []),
          item.topic_name,
          item.subtopic_name
        ])
        : 0;
      const role = normalizeText(item.fact_role).toLowerCase();
      let intentBoost = 0;
      if (intent.isWarranty) {
        if (["coverage", "definition", "capability", "process"].includes(role)) intentBoost += 0.08;
        if (!intent.asksLimits && role === "limit") intentBoost -= 0.05;
        if (intent.asksLimits && role === "limit") intentBoost += 0.03;
        if (/forever warranty|harts forever warranty/.test(claimText)) intentBoost += 0.08;
        if (!intent.queryTokens.some((token) => ["water", "heater", "furnace", "ac", "electrical"].includes(token))
          && /water heater|furnace|ac repair|electrical/.test(claimText)) {
          intentBoost -= 0.08;
        }
        if (/some contractors|a strong warranty should|most manufacturer warranties/.test(claimText)) {
          intentBoost -= 0.14;
        }
      }
      if (intent.isFinancing) {
        if (["overview", "coverage", "capability", "process", "eligibility"].includes(role)) intentBoost += 0.06;
        if (/major repairs|major projects|approved credit|goodleap/.test(claimText)) intentBoost += 0.06;
        if (!intent.queryTokens.some((token) => ["furnace", "hydronic", "heat", "pump", "panel", "sewer"].includes(token))
          && /furnace|hydronic|heat pump/.test(claimText)) {
          intentBoost -= 0.08;
        }
      }
      if (intent.isServiceArea) {
        if (/(serve|service area|coverage|neighborhood|bellevue)/.test(claimText)) intentBoost += 0.08;
        if (!intent.queryTokens.some((token) => ["ev", "charger"].includes(token)) && /ev charger|charger installation/.test(claimText)) {
          intentBoost -= 0.06;
        }
        if (!intent.queryTokens.some((token) => ["sewer", "water", "heater", "plumbing"].includes(token))
          && /sewer|water heater|promotions|discount/.test(claimText)) {
          intentBoost -= 0.16;
        }
        if (role === "eligibility" || role === "process") {
          intentBoost -= 0.14;
        }
      }
      if (intent.isProcess && ["process", "applicability", "capability"].includes(role)) intentBoost += 0.06;
      return {
        item,
        index,
        lexical,
        intentBoost,
        score: item.similarity + (lexical * 0.03) + intentBoost - (specificityPenalty * 0.01)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.intentBoost !== left.intentBoost) return right.intentBoost - left.intentBoost;
      if (right.lexical !== left.lexical) return right.lexical - left.lexical;
      if (right.item.similarity !== left.item.similarity) return right.item.similarity - left.item.similarity;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.map((value) => Number(value || 0)).join(",")}]`;
}

export function buildPlannerSystemPrompt() {
  return [
    "You are a fast retrieval planner for a live voice receptionist.",
    "Return JSON only.",
    "Do not answer the caller.",
    "Do not make company-specific claims.",
    "Do not invent pricing, availability, guarantees, or policy details.",
    "Return only coverage_items.",
    "Extract at most 3 short retrieval phrases.",
    "Use compact noun phrases or short concept phrases only.",
    "Only include facets clearly implied by the caller question or recent context.",
    "Do not speculate or expand into adjacent topics.",
    "If one phrase is enough, return one."
  ].join("\n");
}

function buildPlannerRecentContextHint(summary: string) {
  const recentTurns = normalizeText(summary)
    .split("|")
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(-2)
    .join(" | ");
  return recentTurns.slice(0, 240);
}

function buildPlannerBusinessScopeHint(input: PlannerRuntimeExecutionInput) {
  const intentSummary = normalizeText(input.businessCallIntentSummary);
  if (intentSummary) {
    return intentSummary.slice(0, 120);
  }
  const businessRoleLine = normalizeText(input.tenantPersona)
    .split("\n")
    .map((line) => normalizeText(line))
    .find((line) => line.toLowerCase().startsWith("business role:"));
  return normalizeText(businessRoleLine?.replace(/^business role:\s*/i, "")).slice(0, 120);
}

export function buildPlannerUserPrompt(input: PlannerRuntimeExecutionInput) {
  return JSON.stringify({
    caller_question: input.queryText,
    recent_context_hint: buildPlannerRecentContextHint(input.recentConversationSummary || ""),
    business_scope_hint: buildPlannerBusinessScopeHint(input),
    current_stage: input.currentStage
  });
}

export function buildPlannerOpenAiRequestBody(input: PlannerRuntimeExecutionInput) {
  const model = input.plannerModel || process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";
  return buildOpenAiJsonResponseRequestBody({
    model,
    system: buildPlannerSystemPrompt(),
    user: buildPlannerUserPrompt(input),
    temperature: 0,
    maxOutputTokens: 120
  });
}

export function buildRuntimeEmbeddingsRequestBody(input: {
  queryText: string;
  coverageItems: string[];
  embeddingModel?: string;
}) {
  const coverageItems = uniqueValues([
    input.queryText,
    ...(input.coverageItems || []).map((item) => normalizeText(item)).filter(Boolean)
  ]).slice(0, 4);
  return buildOpenAiEmbeddingsRequestBody({
    model: input.embeddingModel || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    texts: coverageItems
  });
}

async function runPlanner(input: PlannerRuntimeExecutionInput) {
  const plannerModel = input.plannerModel || process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";
  try {
    const plannerResponse = await callOpenAiJsonModel({
      model: plannerModel,
      system: buildPlannerSystemPrompt(),
      user: buildPlannerUserPrompt(input),
      schema: plannerTurnResponseSchema,
      temperature: 0,
      maxOutputTokens: 120
    });
    const normalized = normalizePlannerResponse(plannerResponse);
    if (!normalized.coverage_items.length) {
      normalized.coverage_items = [input.queryText];
    }
    return {
      planner: normalized,
      rawResponse: plannerResponse.rawResponse
    };
  } catch (error) {
    return {
      planner: {
        coverage_items: [input.queryText],
        next_step_suggestions: []
      },
      rawResponse: {
        fallback: true,
        planner_model: plannerModel,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function buildCoverageValueSql(items: Array<{ coverageItemText: string; embedding: number[] }>, startIndex: number) {
  const values: unknown[] = [];
  const tuples = items.map((item) => {
    const textIndex = startIndex + values.length;
    values.push(item.coverageItemText);
    const vectorIndex = startIndex + values.length;
    values.push(vectorLiteral(item.embedding));
    return `($${textIndex}::text, $${vectorIndex}::vector)`;
  });
  return {
    values,
    sql: tuples.join(", ")
  };
}

async function retrieveCardSupportBatch(db: Queryable, input: {
  tenantKey: string;
  buildId: string;
  embeddingModel: string;
  coverageItems: Array<{ coverageItemText: string; embedding: number[] }>;
  limit: number;
}) {
  if (!input.coverageItems.length) return {} as Record<string, RetrievedCardSupport[]>;
  const coverageValues = buildCoverageValueSql(input.coverageItems, 4);
  const limitIndex = 4 + coverageValues.values.length;
  const res = await db.query(
    `WITH coverage(coverage_item_text, embedding) AS (
       VALUES ${coverageValues.sql}
     ),
     ranked AS (
       SELECT
         cov.coverage_item_text,
         c.knowledge_card_id,
         c.canonical_name,
         c.card_role,
         c.speakable_summary,
         c.support_summary,
         c.source_ref_ids_json,
         c.source_span_refs_json,
         c.support_metadata_json,
         COALESCE(t.topic_name, NULL) AS topic_name,
         COALESCE(st.subtopic_name, NULL) AS subtopic_name,
         1 - (cv.embedding <=> cov.embedding) AS similarity,
         row_number() OVER (
           PARTITION BY cov.coverage_item_text
           ORDER BY cv.embedding <=> cov.embedding
         ) AS rn
       FROM coverage cov
       INNER JOIN knowledge_build_card_vectors cv
         ON cv.tenant_key = $1
        AND cv.build_id = $2
        AND cv.embedding_model = $3
       INNER JOIN knowledge_build_cards c
         ON c.knowledge_card_id = cv.knowledge_card_id
       LEFT JOIN knowledge_build_topics t
         ON t.knowledge_topic_id = c.knowledge_topic_id
       LEFT JOIN knowledge_build_subtopics st
         ON st.knowledge_subtopic_id = c.knowledge_subtopic_id
     )
     SELECT *
     FROM ranked
     WHERE rn <= $${limitIndex}
     ORDER BY coverage_item_text, rn`,
    [
      input.tenantKey,
      input.buildId,
      input.embeddingModel,
      ...coverageValues.values,
      input.limit
    ]
  );

  return (res.rows || []).reduce((acc, row) => {
    const coverageItemText = normalizeText(row.coverage_item_text);
    const list = acc[coverageItemText] || [];
    list.push({
      coverage_item_text: coverageItemText,
      knowledge_card_id: normalizeText(row.knowledge_card_id),
      canonical_name: normalizeText(row.canonical_name),
      card_role: normalizeText(row.card_role) || "answer_unit",
      summary: normalizeText(row.speakable_summary),
      support_summary: normalizeText(row.support_summary) || normalizeText(row.speakable_summary),
      similarity: Math.max(0, Math.min(1, Number(row.similarity || 0))),
      topic_name: normalizeText(row.topic_name) || null,
      subtopic_name: normalizeText(row.subtopic_name) || null,
      source_ref_ids: asStringArray(row.source_ref_ids_json),
      source_chunk_ids: asStringArray(Array.isArray(row.source_span_refs_json) ? row.source_span_refs_json.map((item: any) => item?.source_chunk_id) : []),
      fact_ids: asStringArray(asRecord(row.support_metadata_json).fact_ids),
      metadata: asRecord(row.support_metadata_json)
    });
    acc[coverageItemText] = list;
    return acc;
  }, {} as Record<string, RetrievedCardSupport[]>);
}

async function retrieveFactSupportBatch(db: Queryable, input: {
  tenantKey: string;
  buildId: string;
  embeddingModel: string;
  coverageItems: Array<{ coverageItemText: string; embedding: number[] }>;
  limit: number;
}) {
  if (!input.coverageItems.length) return {} as Record<string, RetrievedFactSupport[]>;
  const coverageValues = buildCoverageValueSql(input.coverageItems, 4);
  const limitIndex = 4 + coverageValues.values.length;
  const res = await db.query(
    `WITH coverage(coverage_item_text, embedding) AS (
       VALUES ${coverageValues.sql}
     ),
     ranked AS (
       SELECT
         cov.coverage_item_text,
         f.knowledge_fact_id,
         f.fact_role,
         f.claim_text,
         f.support_type,
         f.qualifier_json,
         f.boundary_json,
         f.support_metadata_json,
         f.source_ref_ids_json,
         f.source_chunk_ids_json,
         COALESCE(t.topic_name, NULL) AS topic_name,
         COALESCE(st.subtopic_name, NULL) AS subtopic_name,
         1 - (fv.embedding <=> cov.embedding) AS similarity,
         row_number() OVER (
           PARTITION BY cov.coverage_item_text
           ORDER BY fv.embedding <=> cov.embedding
         ) AS rn
       FROM coverage cov
       INNER JOIN knowledge_build_fact_vectors fv
         ON fv.tenant_key = $1
        AND fv.build_id = $2
        AND fv.embedding_model = $3
       INNER JOIN knowledge_build_facts f
         ON f.knowledge_fact_id = fv.knowledge_fact_id
       LEFT JOIN knowledge_build_topics t
         ON t.knowledge_topic_id = f.knowledge_topic_id
       LEFT JOIN knowledge_build_subtopics st
         ON st.knowledge_subtopic_id = f.knowledge_subtopic_id
     )
     SELECT *
     FROM ranked
     WHERE rn <= $${limitIndex}
     ORDER BY coverage_item_text, rn`,
    [
      input.tenantKey,
      input.buildId,
      input.embeddingModel,
      ...coverageValues.values,
      input.limit
    ]
  );

  return (res.rows || []).reduce((acc, row) => {
    const qualifierJson = asRecord(row.qualifier_json);
    const boundaryJson = asRecord(row.boundary_json);
    const supportMetadata = asRecord(row.support_metadata_json);
    const coverageItemText = normalizeText(row.coverage_item_text);
    const list = acc[coverageItemText] || [];
    list.push({
      coverage_item_text: coverageItemText,
      knowledge_fact_id: normalizeText(row.knowledge_fact_id),
      fact_role: normalizeText(row.fact_role) || "detail",
      claim_text: normalizeText(row.claim_text),
      support_type: normalizeText(row.support_type) || "source_backed",
      similarity: Math.max(0, Math.min(1, Number(row.similarity || 0))),
      topic_name: normalizeText(row.topic_name) || null,
      subtopic_name: normalizeText(row.subtopic_name) || null,
      qualifiers: uniqueValues([
        ...asStringArray(qualifierJson.statements),
        ...asStringArray(qualifierJson.applicability),
        ...asStringArray(qualifierJson.scope)
      ]),
      boundary_notes: uniqueValues([
        ...asStringArray(boundaryJson.statements),
        ...asStringArray(boundaryJson.exclusions),
        ...asStringArray(boundaryJson.limits)
      ]),
      next_steps: uniqueValues([
        ...asStringArray(supportMetadata.next_steps),
        ...asStringArray(supportMetadata.follow_up_actions)
      ]),
      source_ref_ids: asStringArray(row.source_ref_ids_json),
      source_chunk_ids: asStringArray(row.source_chunk_ids_json),
      card_ids: asStringArray(supportMetadata.card_ids),
      metadata: supportMetadata
    });
    acc[coverageItemText] = list;
    return acc;
  }, {} as Record<string, RetrievedFactSupport[]>);
}

export async function executePlannerPgvectorRuntime(db: Queryable, input: PlannerRuntimeExecutionInput): Promise<PlannerRuntimeExecutionResult> {
  const totalStarted = performance.now();
  const plannerStarted = performance.now();
  const plannerResult = await runPlanner(input);
  const planner = plannerResult.planner;
  const plannerMs = Number((performance.now() - plannerStarted).toFixed(3));
  const coverageItems = uniqueValues([
    input.queryText,
    ...planner.coverage_items.map((item) => normalizeText(item)).filter(Boolean)
  ]).slice(0, 4);
  const embeddingModel = input.embeddingModel || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const embeddingRequestPayload = buildOpenAiEmbeddingsRequestBody({
    model: embeddingModel,
    texts: coverageItems
  });
  const embeddingStarted = performance.now();
  const embeddedResult = await embedOpenAiTextsDetailed({
    model: embeddingModel,
    texts: coverageItems
  });
  const embedded = embeddedResult.items;
  const embeddingMs = Number((performance.now() - embeddingStarted).toFixed(3));

  const coverageItemsWithEmbeddings = coverageItems
    .map((coverageItemText, index) => ({
      coverageItemText,
      embedding: embedded[index]?.embedding || []
    }))
    .filter((item) => item.coverageItemText && item.embedding.length);
  const retrievalStarted = performance.now();
  const [cardResultsByCoverageItem, factResultsByCoverageItem] = await Promise.all([
    retrieveCardSupportBatch(db, {
      tenantKey: input.tenantKey,
      buildId: input.buildId,
      embeddingModel,
      coverageItems: coverageItemsWithEmbeddings,
      limit: input.cardLimitPerCoverageItem || 7
    }),
    retrieveFactSupportBatch(db, {
      tenantKey: input.tenantKey,
      buildId: input.buildId,
      embeddingModel,
      coverageItems: coverageItemsWithEmbeddings,
      limit: input.factLimitPerCoverageItem || 10
    })
  ]);
  for (const coverageItemText of coverageItems) {
    if (!cardResultsByCoverageItem[coverageItemText]) {
      cardResultsByCoverageItem[coverageItemText] = [];
    }
    if (!factResultsByCoverageItem[coverageItemText]) {
      factResultsByCoverageItem[coverageItemText] = [];
    }
    cardResultsByCoverageItem[coverageItemText] = rerankCardSupport(
      coverageItemText,
      cardResultsByCoverageItem[coverageItemText]
    );
    factResultsByCoverageItem[coverageItemText] = rerankFactSupport(
      coverageItemText,
      factResultsByCoverageItem[coverageItemText]
    );
  }
  const retrievalMs = Number((performance.now() - retrievalStarted).toFixed(3));

  const packetStarted = performance.now();
  const answerPacket = assembleDeterministicAnswerPacket({
    tenantId: input.tenantKey,
    buildId: input.buildId,
    queryText: input.queryText,
    coverageItems,
    nextStepSuggestions: planner.next_step_suggestions,
    cardsByCoverageItem: new Map(Object.entries(cardResultsByCoverageItem)),
    factsByCoverageItem: new Map(Object.entries(factResultsByCoverageItem)),
    metadata: {
      planner_model: input.plannerModel || process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini",
      embedding_model: embeddingModel
    },
    ...(input.packetSoftBudgetTokens === undefined ? {} : { softBudgetTokens: input.packetSoftBudgetTokens }),
    ...(input.packetHardBudgetTokens === undefined ? {} : { hardBudgetTokens: input.packetHardBudgetTokens })
  });
  const packetMs = Number((performance.now() - packetStarted).toFixed(3));

  const coverageSupportEvents = answerPacket.coverage.map((item) => {
    const topCards: RetrievedCardSupport[] = (cardResultsByCoverageItem[item.requested_coverage_item_text] || []).slice(0, 3);
    const topFacts: RetrievedFactSupport[] = (factResultsByCoverageItem[item.requested_coverage_item_text] || []).slice(0, 3);
    return {
      knowledgeCoverageEventId: createDeterministicId("cov"),
      requestedCoverageItemText: item.requested_coverage_item_text,
      supportStrength: item.support_strength,
      topCardIds: topCards.map((card) => card.knowledge_card_id),
      topFactIds: topFacts.map((fact) => fact.knowledge_fact_id),
      topScores: [
        ...topCards.map((card) => ({ kind: "card" as const, id: card.knowledge_card_id, similarity: card.similarity })),
        ...topFacts.map((fact) => ({ kind: "fact" as const, id: fact.knowledge_fact_id, similarity: fact.similarity }))
      ],
      gapReason: item.support_strength === "none"
        ? "no_support_above_threshold"
        : (item.support_strength === "partial" ? "partial_support_only" : null)
    };
  });

  return {
    planner,
    answerPacket,
    coverageSupportEvents,
    cardResultsByCoverageItem,
    factResultsByCoverageItem,
    timings: {
      planner_ms: plannerMs,
      embedding_ms: embeddingMs,
      retrieval_ms: retrievalMs,
      packet_ms: packetMs,
      total_ms: Number((performance.now() - totalStarted).toFixed(3))
    },
    tokenCounts: {
      planner_input_tokens: estimateTokenCount(buildPlannerUserPrompt(input)),
      planner_output_tokens: estimateTokenCount(planner),
      packet_tokens: answerPacket.token_counts.packet_tokens
    },
    debug: {
      planner_response_payload: plannerResult.rawResponse,
      embedding_request_payload: embeddingRequestPayload,
      embedding_response_payloads: embeddedResult.rawResponses
    }
  };
}

export async function persistCoverageGapEvents(db: Queryable, input: {
  tenantKey: string;
  buildId: string;
  callId?: string;
  turnId?: string;
  queryText: string;
  events: CoverageSupportEvent[];
  metadata?: Record<string, unknown>;
}) {
  for (const event of input.events) {
    await db.query(
      `INSERT INTO knowledge_coverage_events (
         knowledge_coverage_event_id,
         tenant_key,
         build_id,
         call_id,
         turn_id,
         query_text,
         requested_coverage_item_text,
         support_strength,
         top_card_ids_json,
         top_fact_ids_json,
         top_scores_json,
         gap_reason,
         metadata_json
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13::jsonb
       )`,
      [
        event.knowledgeCoverageEventId,
        input.tenantKey,
        input.buildId,
        input.callId || null,
        input.turnId || null,
        input.queryText,
        event.requestedCoverageItemText,
        event.supportStrength,
        JSON.stringify(event.topCardIds),
        JSON.stringify(event.topFactIds),
        JSON.stringify(event.topScores),
        event.gapReason,
        JSON.stringify(input.metadata || {})
      ]
    );
  }
}
