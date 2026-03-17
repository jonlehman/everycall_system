import crypto from "node:crypto";
import { z } from "zod";
import { runtimeModeSchema, type RuntimeMode } from "./knowledgeReceptionist.js";

const stringArraySchema = z.array(z.string().min(1)).default([]);
const jsonRecordSchema = z.record(z.any()).default({});

export const supportStrengthSchema = z.enum(["strong", "partial", "none"]);

export const plannerCoverageItemSchema = z.union([
  z.string().min(1),
  z.object({
    text: z.string().min(1),
    priority: z.enum(["high", "normal", "low"]).optional(),
    reason: z.string().min(1).optional()
  })
]);

export const plannerTurnRequestSchema = z.object({
  caller_question: z.string().min(1),
  recent_context_hint: z.string().default(""),
  business_scope_hint: z.string().default(""),
  current_stage: z.string().min(1)
});

export const plannerTurnResponseSchema = z.object({
  coverage_items: z.array(plannerCoverageItemSchema).max(3).default([]),
  next_step_suggestions: z.array(z.string().min(1)).max(2).default([])
});

export const retrievedCardSupportSchema = z.object({
  coverage_item_text: z.string().min(1),
  knowledge_card_id: z.string().min(1),
  canonical_name: z.string().min(1),
  card_role: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  support_summary: z.string().min(1).optional(),
  similarity: z.number().min(0).max(1),
  topic_name: z.string().min(1).nullable().optional(),
  subtopic_name: z.string().min(1).nullable().optional(),
  source_ref_ids: stringArraySchema,
  source_chunk_ids: stringArraySchema,
  fact_ids: stringArraySchema,
  metadata: jsonRecordSchema
});

export const retrievedFactSupportSchema = z.object({
  coverage_item_text: z.string().min(1),
  knowledge_fact_id: z.string().min(1),
  fact_role: z.string().min(1),
  claim_text: z.string().min(1),
  support_type: z.string().min(1).optional(),
  similarity: z.number().min(0).max(1),
  topic_name: z.string().min(1).nullable().optional(),
  subtopic_name: z.string().min(1).nullable().optional(),
  qualifiers: stringArraySchema,
  boundary_notes: stringArraySchema,
  next_steps: stringArraySchema,
  source_ref_ids: stringArraySchema,
  source_chunk_ids: stringArraySchema,
  card_ids: stringArraySchema,
  metadata: jsonRecordSchema
});

export const packetCoverageItemSchema = z.object({
  requested_coverage_item_text: z.string().min(1),
  support_strength: supportStrengthSchema,
  used_card_ids: stringArraySchema,
  used_fact_ids: stringArraySchema,
  direct_answer_points: stringArraySchema,
  qualifiers: stringArraySchema,
  limits_or_exclusions: stringArraySchema,
  next_step_options: stringArraySchema
});

export const deterministicAnswerPacketSchema = z.object({
  answer_packet_id: z.string().min(1),
  tenant_id: z.string().min(1),
  build_id: z.string().min(1),
  query_text: z.string().min(1),
  runtime_mode: runtimeModeSchema,
  coverage: z.array(packetCoverageItemSchema).max(6).default([]),
  direct_answer_points: stringArraySchema,
  qualifiers: stringArraySchema,
  limits_or_exclusions: stringArraySchema,
  next_step_options: stringArraySchema,
  unsupported_requested_items: stringArraySchema,
  used_card_ids: stringArraySchema,
  used_fact_ids: stringArraySchema,
  token_counts: z.object({
    packet_tokens: z.number().int().nonnegative(),
    soft_budget_tokens: z.number().int().nonnegative(),
    hard_budget_tokens: z.number().int().nonnegative()
  }),
  metadata: jsonRecordSchema
});

export type PlannerTurnRequest = z.infer<typeof plannerTurnRequestSchema>;
export type PlannerTurnResponse = z.infer<typeof plannerTurnResponseSchema>;
export type RetrievedCardSupport = z.infer<typeof retrievedCardSupportSchema>;
export type RetrievedFactSupport = z.infer<typeof retrievedFactSupportSchema>;
export type PacketCoverageItem = z.infer<typeof packetCoverageItemSchema>;
export type DeterministicAnswerPacket = z.infer<typeof deterministicAnswerPacketSchema>;
export type SupportStrength = z.infer<typeof supportStrengthSchema>;

const STRONG_CARD_SIMILARITY = 0.62;
const STRONG_FACT_SIMILARITY = 0.65;
const PARTIAL_CARD_SIMILARITY = 0.38;
const PARTIAL_FACT_SIMILARITY = 0.42;

export const FORCED_SUPPORT_MODE_ACTIVE = true;
export const FORCED_SUPPORT_STRENGTH: SupportStrength = "strong";
export const FORCED_RUNTIME_CONFIDENCE_SCORE = 0.99;

const DIRECT_FACT_ROLES = new Set([
  "overview",
  "definition",
  "faq_answer",
  "capability",
  "coverage",
  "process",
  "service_detail",
  "answer"
]);

const QUALIFIER_FACT_ROLES = new Set([
  "applicability",
  "eligibility",
  "scope",
  "condition",
  "ambiguity",
  "clarification"
]);

const LIMIT_FACT_ROLES = new Set([
  "limit",
  "exclusion",
  "boundary",
  "unknown",
  "exception"
]);

const NEXT_STEP_FACT_ROLES = new Set([
  "next_step",
  "contact",
  "process_next_step",
  "handoff"
]);

function normalizeText(value: unknown) {
  return String(value || "").trim();
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

export type CoverageIntentProfile = {
  normalizedText: string;
  queryTokens: string[];
  isWarranty: boolean;
  isFinancing: boolean;
  isServiceArea: boolean;
  isProcess: boolean;
  asksDefinition: boolean;
  asksApplicability: boolean;
  asksLimits: boolean;
  prefersBroadOverview: boolean;
};

export function analyzeCoverageIntent(coverageItemText: string): CoverageIntentProfile {
  const normalizedText = normalizeText(coverageItemText).toLowerCase();
  const queryTokens = tokenizeForOverlap(coverageItemText);
  const isWarranty = /\bwarrant(y|ies)\b|\bguarantee\b/.test(normalizedText);
  const isFinancing = /\bfinanc\w*\b|\bpayment\b|\bgoodleap\b/.test(normalizedText);
  const isServiceArea = /\bserve\b|\bservice area\b|\bcoverage\b|\bavailable in\b/.test(normalizedText);
  const isProcess = /\binvolved\b|\bprocess\b|\bsteps\b|\breplacing\b|\breplacement\b|\bupgrade\b/.test(normalizedText);
  const asksDefinition = /^(what|how)\b/.test(normalizedText);
  const asksApplicability = /\bapply\b|\bqualif\w*\b|\beligible\b|\ball services\b|\bwhich services\b/.test(normalizedText);
  const asksLimits = asksApplicability || /\blimit\b|\bexclude\b|\bexclusion\b|\bterm\b|\btransfer\b|\bnot\b/.test(normalizedText);
  const prefersBroadOverview = asksDefinition || isWarranty || isFinancing || isServiceArea || isProcess;
  return {
    normalizedText,
    queryTokens,
    isWarranty,
    isFinancing,
    isServiceArea,
    isProcess,
    asksDefinition,
    asksApplicability,
    asksLimits,
    prefersBroadOverview
  };
}

function extractLocationTokens(intent: CoverageIntentProfile) {
  const stopWords = new Set([
    "do",
    "you",
    "serve",
    "service",
    "area",
    "coverage",
    "available",
    "what",
    "how",
    "does",
    "your"
  ]);
  return intent.queryTokens.filter((token) => !stopWords.has(token));
}

export function createDeterministicId(prefix: string) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function normalizePlannerResponse(raw: unknown): PlannerTurnResponse {
  const parsed = plannerTurnResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      coverage_items: [],
      next_step_suggestions: []
    };
  }
  const coverageItems = uniqueValues(
    parsed.data.coverage_items.map((item) => (typeof item === "string" ? item : item.text))
  ).slice(0, 3);
  return {
    coverage_items: coverageItems,
    next_step_suggestions: []
  };
}

export function computeSupportStrength(
  coverageItemText: string,
  cards: RetrievedCardSupport[],
  facts: RetrievedFactSupport[]
): SupportStrength {
  if (FORCED_SUPPORT_MODE_ACTIVE) {
    return FORCED_SUPPORT_STRENGTH;
  }
  const intent = analyzeCoverageIntent(coverageItemText);
  const topCard = cards[0]?.similarity ?? 0;
  const topFact = facts[0]?.similarity ?? 0;
  const corroboratingCount = cards.filter((card) => card.similarity >= PARTIAL_CARD_SIMILARITY).length
    + facts.filter((fact) => fact.similarity >= PARTIAL_FACT_SIMILARITY).length;

  if ((topCard >= STRONG_CARD_SIMILARITY || topFact >= STRONG_FACT_SIMILARITY) && corroboratingCount >= 2) {
    return "strong";
  }
  if (
    intent.prefersBroadOverview
    && corroboratingCount >= 3
    && (topCard >= 0.56 || topFact >= 0.54)
  ) {
    return "strong";
  }
  if (topCard >= PARTIAL_CARD_SIMILARITY || topFact >= PARTIAL_FACT_SIMILARITY) {
    return "partial";
  }
  return "none";
}

export function getRuntimeBundleConfidenceScore(
  coverage: Array<Pick<PacketCoverageItem, "support_strength">> = []
) {
  if (FORCED_SUPPORT_MODE_ACTIVE) {
    return FORCED_RUNTIME_CONFIDENCE_SCORE;
  }
  return coverage.some((item) => item.support_strength === "strong") ? 0.82 : 0.45;
}

function bucketFactRole(role: string) {
  const normalized = normalizeText(role).toLowerCase();
  if (DIRECT_FACT_ROLES.has(normalized)) return "direct";
  if (QUALIFIER_FACT_ROLES.has(normalized)) return "qualifier";
  if (LIMIT_FACT_ROLES.has(normalized)) return "limit";
  if (NEXT_STEP_FACT_ROLES.has(normalized)) return "next_step";
  return "direct";
}

function containsAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function cardText(card: RetrievedCardSupport) {
  return [
    normalizeText(card.canonical_name),
    normalizeText(card.support_summary || card.summary),
    normalizeText(card.topic_name),
    normalizeText(card.subtopic_name)
  ].join(" ").toLowerCase();
}

function cardSelectionWeight(intent: CoverageIntentProfile, card: RetrievedCardSupport) {
  const role = normalizeText(card.card_role).toLowerCase();
  const name = normalizeText(card.canonical_name).toLowerCase();
  const summary = normalizeText(card.support_summary || card.summary).toLowerCase();
  const topic = [normalizeText(card.topic_name), normalizeText(card.subtopic_name)].join(" ").toLowerCase();
  let weight = 0;

  if (intent.prefersBroadOverview) {
    if (["overview", "coverage", "definition", "faq_answer", "warranty_overview"].includes(role)) {
      weight += 3.5;
    } else if (role === "answer_unit") {
      weight += 1.5;
    }
  }
  if (intent.isWarranty) {
    if (["overview", "coverage", "definition", "faq_answer", "warranty_overview"].includes(role)) weight += 2;
    if (role === "limit" && !intent.asksLimits) weight -= 2.5;
    if (intent.asksLimits && role === "limit") weight += 1.5;
  }
  if (intent.isFinancing) {
    if (["overview", "coverage", "faq_answer"].includes(role)) weight += 2.5;
    if (role === "capability" && !containsAny(intent.normalizedText, ["furnace", "heat pump", "panel", "sewer"])) {
      weight -= 1.25;
    }
  }
  if (intent.isServiceArea) {
    if (containsAny(`${name} ${summary} ${topic}`, ["service area", "coverage", "serves", "neighborhood"])) {
      weight += 3;
    }
  }
  if (intent.isProcess) {
    if (["process", "faq_answer", "overview", "capability"].includes(role)) weight += 2;
    if (role === "limit") weight -= 1;
  }
  return weight;
}

function factSelectionWeight(intent: CoverageIntentProfile, fact: RetrievedFactSupport) {
  const bucket = bucketFactRole(fact.fact_role);
  const claim = normalizeText(fact.claim_text).toLowerCase();
  let weight = 0;

  if (intent.prefersBroadOverview && bucket === "direct") weight += 1.75;
  if (intent.isWarranty) {
    if (["coverage", "definition", "capability", "process"].includes(normalizeText(fact.fact_role).toLowerCase())) weight += 2;
    if (bucket === "limit" && !intent.asksLimits) weight -= 1.5;
    if (intent.asksLimits && bucket === "limit") weight += 1.5;
  }
  if (intent.isFinancing) {
    if (["overview", "coverage", "capability", "eligibility", "process"].includes(normalizeText(fact.fact_role).toLowerCase())) weight += 1.5;
    if (!containsAny(intent.normalizedText, ["furnace", "heat pump", "panel", "sewer"]) && containsAny(claim, ["furnace", "hydronic", "heat pump"])) {
      weight -= 1;
    }
  }
  if (intent.isServiceArea) {
    if (containsAny(claim, ["serves", "service area", "coverage", "neighborhood", "bellevue"])) weight += 2;
    if (!containsAny(intent.normalizedText, ["ev", "charger"]) && containsAny(claim, ["ev charger", "charger installation"])) {
      weight -= 1.25;
    }
  }
  if (intent.isProcess && ["process", "capability", "applicability"].includes(normalizeText(fact.fact_role).toLowerCase())) {
    weight += 1.5;
  }
  return weight;
}

function selectCoverageCards(intent: CoverageIntentProfile, cards: RetrievedCardSupport[]) {
  const ranked = cards
    .map((card, index) => ({
      card,
      index,
      weight: cardSelectionWeight(intent, card),
      score: card.similarity + (cardSelectionWeight(intent, card) * 0.03)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.weight !== left.weight) return right.weight - left.weight;
      if (right.card.similarity !== left.card.similarity) return right.card.similarity - left.card.similarity;
      return left.index - right.index;
    })
    .map((entry) => entry.card);

  const selected: RetrievedCardSupport[] = [];
  const preferredBroadCards = ranked.filter((card) => {
    const text = cardText(card);
    if (intent.isWarranty && !intent.asksLimits) {
      return /forever warranty|harts forever warranty/.test(text);
    }
    if (intent.isFinancing) {
      return ["overview", "faq_answer"].includes(normalizeText(card.card_role).toLowerCase())
        && /major projects|goodleap|approved credit|sustainable home upgrades/.test(text);
    }
    if (intent.isServiceArea) {
      const locationTokens = extractLocationTokens(intent);
      return /(serves all neighborhoods|service area|coverage|currently provides)/.test(text)
        && (!locationTokens.length || locationTokens.some((token) => text.includes(token)));
    }
    return false;
  });
  for (const card of preferredBroadCards) {
    if (selected.length >= 2) break;
    if (selected.some((item) => item.knowledge_card_id === card.knowledge_card_id)) continue;
    selected.push(card);
  }
  for (const card of ranked) {
    if (selected.length >= 2) break;
    if (!selected.length) {
      selected.push(card);
      continue;
    }
    const firstRole = normalizeText(selected[0]?.card_role).toLowerCase();
    const nextRole = normalizeText(card.card_role).toLowerCase();
    const sameRole = firstRole === nextRole;
    const roleDiversityWanted = intent.prefersBroadOverview || intent.isWarranty || intent.isFinancing || intent.isProcess;
    if (roleDiversityWanted && sameRole && ranked.length > 2) continue;
    selected.push(card);
  }
  if (selected.length < 2) {
    for (const card of ranked) {
      if (selected.length >= 2) break;
      if (selected.some((item) => item.knowledge_card_id === card.knowledge_card_id)) continue;
      selected.push(card);
    }
  }
  return selected.length ? selected : cards.slice(0, 2);
}

function selectCoverageFacts(intent: CoverageIntentProfile, usedCards: RetrievedCardSupport[], facts: RetrievedFactSupport[]) {
  const selectedCardIds = new Set(usedCards.map((card) => card.knowledge_card_id));
  const selectedCardFactIds = new Set(usedCards.flatMap((card) => card.fact_ids || []));
  const ranked = facts
    .map((fact, index) => {
      const linkedToSelectedCard = (fact.card_ids || []).some((cardId) => selectedCardIds.has(cardId));
      const directlyReferencedBySelectedCard = selectedCardFactIds.has(fact.knowledge_fact_id);
      const linkageBoost = linkedToSelectedCard || directlyReferencedBySelectedCard ? 1.5 : 0;
      const weight = factSelectionWeight(intent, fact) + linkageBoost;
      return {
        fact,
        index,
        weight,
        score: fact.similarity + (weight * 0.03)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.weight !== left.weight) return right.weight - left.weight;
      if (right.fact.similarity !== left.fact.similarity) return right.fact.similarity - left.fact.similarity;
      return left.index - right.index;
    })
    .map((entry) => entry.fact);

  let filtered = ranked;
  if (intent.isWarranty && !intent.asksLimits) {
    const warrantyFocused = ranked.filter((fact) => {
      const claim = normalizeText(fact.claim_text).toLowerCase();
      return /forever warranty|warranty/.test(claim)
        && !/some contractors|a strong warranty should|most manufacturer warranties/.test(claim);
    });
    if (warrantyFocused.length) {
      filtered = warrantyFocused;
    }
  }
  if (intent.isServiceArea) {
    const locationTokens = extractLocationTokens(intent);
    const locationFocused = ranked.filter((fact) => {
      const claim = normalizeText(fact.claim_text).toLowerCase();
      return /(serve|service area|coverage|neighborhood)/.test(claim)
        && (!locationTokens.length || locationTokens.some((token) => claim.includes(token)));
    });
    if (locationFocused.length) {
      filtered = locationFocused;
    }
  }

  return filtered.slice(0, intent.isServiceArea ? 4 : 8);
}

function buildCoveragePacket(
  coverageItemText: string,
  cards: RetrievedCardSupport[],
  facts: RetrievedFactSupport[],
  nextStepSuggestions: string[]
): PacketCoverageItem {
  const intent = analyzeCoverageIntent(coverageItemText);
  const usedCards = selectCoverageCards(intent, cards);
  const usedFacts = selectCoverageFacts(intent, usedCards, facts);
  const supportStrength = computeSupportStrength(coverageItemText, cards, facts);

  const directAnswerPoints = uniqueValues([
    ...usedFacts.filter((fact) => bucketFactRole(fact.fact_role) === "direct").map((fact) => fact.claim_text),
    ...(usedCards.map((card) => card.support_summary || card.summary || card.canonical_name))
  ]).slice(0, 4);

  const qualifiers = uniqueValues([
    ...usedFacts.filter((fact) => bucketFactRole(fact.fact_role) === "qualifier").map((fact) => fact.claim_text),
    ...usedFacts.flatMap((fact) => fact.qualifiers || [])
  ]).slice(0, 4);

  const limitsOrExclusions = uniqueValues([
    ...usedFacts.filter((fact) => bucketFactRole(fact.fact_role) === "limit").map((fact) => fact.claim_text),
    ...usedFacts.flatMap((fact) => fact.boundary_notes || [])
  ]).slice(0, 4);

  const nextStepOptions = uniqueValues([
    ...usedFacts.filter((fact) => bucketFactRole(fact.fact_role) === "next_step").map((fact) => fact.claim_text),
    ...usedFacts.flatMap((fact) => fact.next_steps || []),
    ...nextStepSuggestions
  ]).slice(0, 3);

  return {
    requested_coverage_item_text: coverageItemText,
    support_strength: supportStrength,
    used_card_ids: uniqueValues(usedCards.map((card) => card.knowledge_card_id)),
    used_fact_ids: uniqueValues(usedFacts.map((fact) => fact.knowledge_fact_id)),
    direct_answer_points: directAnswerPoints,
    qualifiers,
    limits_or_exclusions: limitsOrExclusions,
    next_step_options: nextStepOptions
  };
}

function trimPacket(packet: Omit<DeterministicAnswerPacket, "token_counts">, softBudgetTokens: number, hardBudgetTokens: number) {
  const clone = JSON.parse(JSON.stringify(packet)) as Omit<DeterministicAnswerPacket, "token_counts">;
  let tokenCount = estimateTokenCount(clone);
  if (tokenCount <= softBudgetTokens) {
    return { packet: clone, tokenCount };
  }

  for (const item of clone.coverage) {
    item.qualifiers = item.qualifiers.slice(0, 2);
    item.limits_or_exclusions = item.limits_or_exclusions.slice(0, 2);
    item.next_step_options = item.next_step_options.slice(0, 2);
  }
  clone.qualifiers = clone.qualifiers.slice(0, 6);
  clone.limits_or_exclusions = clone.limits_or_exclusions.slice(0, 6);
  clone.next_step_options = clone.next_step_options.slice(0, 4);
  tokenCount = estimateTokenCount(clone);

  if (tokenCount > hardBudgetTokens) {
    for (const item of clone.coverage) {
      item.direct_answer_points = item.direct_answer_points.slice(0, 2);
      item.qualifiers = item.qualifiers.slice(0, 1);
      item.limits_or_exclusions = item.limits_or_exclusions.slice(0, 1);
    }
    clone.direct_answer_points = clone.direct_answer_points.slice(0, 8);
    clone.qualifiers = clone.qualifiers.slice(0, 4);
    clone.limits_or_exclusions = clone.limits_or_exclusions.slice(0, 4);
    clone.next_step_options = clone.next_step_options.slice(0, 3);
    tokenCount = estimateTokenCount(clone);
  }

  return { packet: clone, tokenCount };
}

export function assembleDeterministicAnswerPacket(input: {
  tenantId: string;
  buildId: string;
  queryText: string;
  coverageItems: string[];
  nextStepSuggestions?: string[];
  cardsByCoverageItem: Map<string, RetrievedCardSupport[]>;
  factsByCoverageItem: Map<string, RetrievedFactSupport[]>;
  softBudgetTokens?: number;
  hardBudgetTokens?: number;
  metadata?: Record<string, unknown>;
}): DeterministicAnswerPacket {
  const softBudgetTokens = Number.isFinite(input.softBudgetTokens) ? Number(input.softBudgetTokens) : 1400;
  const hardBudgetTokens = Number.isFinite(input.hardBudgetTokens) ? Number(input.hardBudgetTokens) : 2200;
  const nextStepSuggestions = uniqueValues(input.nextStepSuggestions || []).slice(0, 2);

  const coverage = input.coverageItems.slice(0, 6).map((coverageItemText) => {
    const cards = (input.cardsByCoverageItem.get(coverageItemText) || [])
      .slice()
      .sort((left, right) => right.similarity - left.similarity);
    const facts = (input.factsByCoverageItem.get(coverageItemText) || [])
      .slice()
      .sort((left, right) => right.similarity - left.similarity);
    return buildCoveragePacket(coverageItemText, cards, facts, nextStepSuggestions);
  });

  const unsupportedRequestedItems = coverage
    .filter((item) => item.support_strength === "none")
    .map((item) => item.requested_coverage_item_text);
  const supportedCoverage = coverage.filter((item) => item.support_strength !== "none");
  const strongCoverage = supportedCoverage.filter((item) => item.support_strength === "strong");
  const cardFrequency = new Map<string, number>();
  const primaryCardWeights = new Map<string, number>();
  for (const item of (strongCoverage.length ? strongCoverage : supportedCoverage)) {
    const weight = item.support_strength === "strong" ? 3 : 1;
    const primaryCardId = item.used_card_ids?.[0] || "";
    if (primaryCardId) {
      primaryCardWeights.set(primaryCardId, Number(primaryCardWeights.get(primaryCardId) || 0) + weight);
    }
    for (const cardId of item.used_card_ids || []) {
      cardFrequency.set(cardId, Number(cardFrequency.get(cardId) || 0) + 1);
    }
  }
  const firstCoveragePrimaryCardId = supportedCoverage[0]?.used_card_ids?.[0] || "";
  const dominantPrimaryCardId = strongCoverage.length
    ? (
      Array.from(primaryCardWeights.entries())
        .sort((left, right) => {
          if (right[1] !== left[1]) return right[1] - left[1];
          return Number(cardFrequency.get(right[0]) || 0) - Number(cardFrequency.get(left[0]) || 0);
        })
        .map(([cardId]) => cardId)[0] || ""
    )
    : firstCoveragePrimaryCardId;
  const mergeCoverage = supportedCoverage.filter((item, index) => {
    if (!dominantPrimaryCardId) return index === 0;
    const primaryCardId = item.used_card_ids?.[0] || "";
    return primaryCardId === dominantPrimaryCardId
      || (item.support_strength === "strong" && (item.used_card_ids || []).includes(dominantPrimaryCardId));
  });

  const weightedCardOrder = new Map<string, number>();
  const weightedFactOrder = new Map<string, number>();
  for (const item of mergeCoverage) {
    const baseWeight = item.support_strength === "strong" ? 3 : 1;
    for (const [index, cardId] of (item.used_card_ids || []).entries()) {
      if (!cardId) continue;
      weightedCardOrder.set(cardId, Number(weightedCardOrder.get(cardId) || 0) + baseWeight - (index * 0.2));
    }
    for (const [index, factId] of (item.used_fact_ids || []).entries()) {
      if (!factId) continue;
      weightedFactOrder.set(factId, Number(weightedFactOrder.get(factId) || 0) + baseWeight - (index * 0.1));
    }
  }

  const orderedUsedCardIds = uniqueValues([
    ...(dominantPrimaryCardId ? [dominantPrimaryCardId] : []),
    ...Array.from(weightedCardOrder.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return Number(cardFrequency.get(right[0]) || 0) - Number(cardFrequency.get(left[0]) || 0);
      })
      .map(([cardId]) => cardId)
  ]);
  const orderedUsedFactIds = uniqueValues(
    Array.from(weightedFactOrder.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([factId]) => factId)
  );

  const directAnswerPoints = uniqueValues(mergeCoverage.flatMap((item) => item.direct_answer_points)).slice(0, 12);
  const qualifiers = uniqueValues(mergeCoverage.flatMap((item) => item.qualifiers)).slice(0, 10);
  const limitsOrExclusions = uniqueValues(mergeCoverage.flatMap((item) => item.limits_or_exclusions)).slice(0, 10);
  const nextStepOptions = uniqueValues([
    ...mergeCoverage.flatMap((item) => item.next_step_options),
    ...nextStepSuggestions
  ]).slice(0, 4);

  const supportSet = new Set(coverage.map((item) => item.support_strength));
  const hasDirectSupport = directAnswerPoints.length > 0;
  const runtimeMode: RuntimeMode = supportSet.has("strong")
    ? "answer"
    : (supportSet.has("partial") && hasDirectSupport ? "answer" : "clarify");

  const packetBase: Omit<DeterministicAnswerPacket, "token_counts"> = {
    answer_packet_id: createDeterministicId("pkt"),
    tenant_id: input.tenantId,
    build_id: input.buildId,
    query_text: input.queryText,
    runtime_mode: runtimeMode,
    coverage,
    direct_answer_points: directAnswerPoints,
    qualifiers,
    limits_or_exclusions: limitsOrExclusions,
    next_step_options: nextStepOptions,
    unsupported_requested_items: unsupportedRequestedItems,
    used_card_ids: orderedUsedCardIds,
    used_fact_ids: orderedUsedFactIds,
    metadata: {
      ...(input.metadata || {}),
      forced_support_mode: FORCED_SUPPORT_MODE_ACTIVE,
      forced_support_strength: FORCED_SUPPORT_MODE_ACTIVE ? FORCED_SUPPORT_STRENGTH : undefined,
      forced_confidence_score: FORCED_SUPPORT_MODE_ACTIVE ? FORCED_RUNTIME_CONFIDENCE_SCORE : undefined
    }
  };

  const trimmed = trimPacket(packetBase, softBudgetTokens, hardBudgetTokens);
  return deterministicAnswerPacketSchema.parse({
    ...trimmed.packet,
    token_counts: {
      packet_tokens: trimmed.tokenCount,
      soft_budget_tokens: softBudgetTokens,
      hard_budget_tokens: hardBudgetTokens
    }
  });
}
