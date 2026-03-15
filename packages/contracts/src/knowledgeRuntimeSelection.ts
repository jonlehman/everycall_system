import type { CallState, KnowledgeGuardrail, KnowledgeOverride, RuntimeMode } from "./knowledgeReceptionist.js";

type JsonRecord = Record<string, unknown>;

export type RuntimeKnowledgeCardLike = {
  knowledge_card_id: string;
  canonical_name: string;
  aliases?: string[];
  aliases_json?: string[];
  caller_phrases?: string[];
  caller_phrases_json?: string[];
  speakable_summary?: string;
  answer_facts?: Array<Record<string, unknown>>;
  answer_facts_json?: Array<Record<string, unknown>>;
  quality_score?: number;
  search_text?: string;
  domain_id?: string;
  subdomain_id?: string | null;
  content_class?: string;
  scope?: JsonRecord;
  scope_json?: JsonRecord;
  card_type?: string | null;
  object_type?: string | null;
  topic_path?: string | null;
  intent_tags?: string[];
  intent_tags_json?: string[];
  entity_tags?: string[];
  entity_tags_json?: string[];
  embedding_json?: Record<string, number>;
};

export type RankedRuntimeKnowledgeCard<TCard extends RuntimeKnowledgeCardLike = RuntimeKnowledgeCardLike> = TCard & {
  lexicalScore: number;
  vectorScore: number;
  precedenceScore: number;
  continuityScore: number;
  topicalityScore: number;
  relevanceScore: number;
  finalScore: number;
  eligibilityMatched: boolean;
  tokenOverlapCount: number;
  strongTokenOverlapCount: number;
};

export type RuntimeCardRankingResult<TCard extends RuntimeKnowledgeCardLike = RuntimeKnowledgeCardLike> = {
  results: Array<RankedRuntimeKnowledgeCard<TCard>>;
  telemetry: {
    query: string;
    candidate_count: number;
    selected_card_count: number;
    lexical_weight: number;
    vector_weight: number;
    precedence_weight: number;
    top_scores: Array<{
      knowledge_card_id: string;
      lexical_score: number;
      vector_score: number;
      precedence_score: number;
      continuity_score: number;
      final_score: number;
    }>;
  };
  querySignals: RuntimeQuerySignals;
};

type RuntimeCardRankingOptions = {
  callState?: CallState | null;
  maxResults?: number;
};

type RuntimeQuerySignals = {
  afterHours: boolean;
  serviceArea: boolean;
  serviceQuestion: boolean;
  policyQuestion: boolean;
  followUp: boolean;
};

type TriggerEvidence = {
  eligible: boolean;
  score: number;
  tokenOverlapCount: number;
  strongTokenOverlapCount: number;
  phraseMatch: boolean;
};

type RuntimeBundleScopeLike = {
  active_domain_id?: string | null;
  active_subdomain_id?: string | null;
  runtime_mode?: string | null;
};

const QUERY_SYNONYM_GROUPS = [
  ["after_hours", ["after hours", "after-hours", "24/7", "24 7", "weekend", "night", "nights", "emergency", "on call", "on-call"]],
  ["service_area", ["service area", "serve", "serving", "coverage", "cover", "locations", "service-area"]],
  ["callback", ["callback", "call back", "return my call", "ring me back"]],
  ["transfer", ["transfer", "human", "live person", "someone at the office"]],
  ["pricing", ["price", "pricing", "cost", "fee", "estimate", "quote"]],
  ["hours", ["hours", "open", "opening time", "closing time"]],
  ["service", ["repair", "replace", "replacement", "install", "installation", "service", "maintenance", "tankless", "water heater", "drain cleaning", "leak repair"]]
] as const;

const AFTER_HOURS_QUERY_PATTERNS = [
  "after hours",
  "after-hours",
  "after 5",
  "after 6",
  "weekend",
  "on call",
  "on-call",
  "night",
  "nights",
  "24/7",
  "24 7"
];

const SERVICE_AREA_QUERY_PATTERNS = [
  "do you serve",
  "service area",
  "service-area",
  "coverage",
  "cover",
  "locations"
];

const SERVICE_QUERY_PATTERNS = [
  "repair",
  "replace",
  "replacement",
  "install",
  "installation",
  "service",
  "maintenance",
  "fix",
  "tankless",
  "water heater",
  "drain",
  "leak",
  "sewer"
];

const POLICY_QUERY_PATTERNS = [
  "pricing",
  "price",
  "cost",
  "estimate",
  "quote",
  "warranty",
  "guarantee",
  "financing",
  "insurance",
  "hours"
];

const FOLLOW_UP_PATTERNS = [
  /^and\b/i,
  /^also\b/i,
  /^what about\b/i,
  /^how about\b/i,
  /^what if\b/i,
  /^and what\b/i
];

const LEXICAL_WEIGHT = 1.6;
const VECTOR_WEIGHT = 0.45;
const PRECEDENCE_WEIGHT = 0.08;
const MAX_CONTINUITY_BOOST = 6;
const ELIGIBILITY_STRONG_TOKEN_LEN = 5;
const ELIGIBILITY_TOKEN_MIN_LEN = 3;
const BUNDLE_RELATIVE_RELEVANCE_FLOOR = 0.55;
const BUNDLE_ABSOLUTE_RELEVANCE_FLOOR = 8;
const NON_AFTER_HOURS_MIXED_CARD_PENALTY = 18;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
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

function tokenizeSearchText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function hashTokenToBucket(token: string, bucketCount = 64) {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash * 31) + token.charCodeAt(index)) % bucketCount;
  }
  return String(hash);
}

export function buildSparseEmbedding(value: string, overrideTokens: string[] | null = null) {
  const tokens = Array.isArray(overrideTokens) && overrideTokens.length ? overrideTokens : tokenizeSearchText(value);
  const counts: Record<string, number> = {};
  for (const token of tokens) {
    const bucket = hashTokenToBucket(token);
    counts[bucket] = Number(counts[bucket] || 0) + 1;
  }
  const magnitude = Math.sqrt(Object.values(counts).reduce((sum, current) => sum + (current ** 2), 0)) || 1;
  for (const key of Object.keys(counts)) {
    const current = counts[key] ?? 0;
    counts[key] = Number((current / magnitude).toFixed(6));
  }
  return counts;
}

function cosineSparseSimilarity(left: Record<string, number>, right: Record<string, number>) {
  let score = 0;
  for (const [key, value] of Object.entries(left || {})) {
    const other = right?.[key];
    if (typeof value !== "number" || typeof other !== "number") continue;
    score += value * other;
  }
  return score;
}

function expandQueryTokens(queryText: string, baseTokens: string[]) {
  const lower = normalizeText(queryText).toLowerCase();
  const expanded = [...baseTokens];
  for (const [, phrases] of QUERY_SYNONYM_GROUPS) {
    if (!phrases.some((phrase) => lower.includes(phrase.toLowerCase()))) continue;
    for (const phrase of phrases) {
      expanded.push(...tokenizeSearchText(phrase));
    }
  }
  return uniqueValues(expanded);
}

function buildQuerySignals(queryText: string, queryTokens: string[]): RuntimeQuerySignals {
  const lower = normalizeText(queryText).toLowerCase();
  return {
    afterHours: AFTER_HOURS_QUERY_PATTERNS.some((pattern) => lower.includes(pattern)),
    serviceArea: SERVICE_AREA_QUERY_PATTERNS.some((pattern) => lower.includes(pattern)),
    serviceQuestion: SERVICE_QUERY_PATTERNS.some((pattern) => lower.includes(pattern)) || /\bdo you (handle|offer|replace|install|repair)\b/.test(lower),
    policyQuestion: POLICY_QUERY_PATTERNS.some((pattern) => lower.includes(pattern)),
    followUp: FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(queryText)) || (queryTokens.length <= 3 && /^(and|also)\b/.test(lower))
  };
}

function normalizeCard<TCard extends RuntimeKnowledgeCardLike>(card: TCard) {
  const aliases = asStringArray(card.aliases_json || card.aliases);
  const callerPhrases = asStringArray(card.caller_phrases_json || card.caller_phrases);
  const intentTags = asStringArray(card.intent_tags_json || card.intent_tags);
  const entityTags = asStringArray(card.entity_tags_json || card.entity_tags);
  const answerFacts = Array.isArray(card.answer_facts_json)
    ? card.answer_facts_json
    : Array.isArray(card.answer_facts)
      ? card.answer_facts
      : [];
  const scope = asObject(card.scope_json || card.scope);
  return {
    ...card,
    canonical_name: normalizeText(card.canonical_name),
    aliases,
    callerPhrases,
    intentTags,
    entityTags,
    answerFacts,
    scope,
    searchText: normalizeText(card.search_text),
    topicPath: normalizeText(card.topic_path),
    cardType: normalizeText(card.card_type),
    objectType: normalizeText(card.object_type),
    contentClass: normalizeText(card.content_class),
    qualityScore: Number(card.quality_score || 0),
    domainId: normalizeText(card.domain_id),
    subdomainId: normalizeText(card.subdomain_id) || null,
    embedding: card.embedding_json && typeof card.embedding_json === "object"
      ? card.embedding_json
      : {}
  };
}

function buildCardSearchTokens<TCard extends RuntimeKnowledgeCardLike>(card: TCard) {
  const normalized = normalizeCard(card);
  const searchParts = uniqueValues([
    normalized.canonical_name,
    normalized.searchText,
    ...normalized.aliases,
    ...normalized.callerPhrases,
    ...normalized.intentTags,
    ...normalized.entityTags,
    normalized.topicPath,
    normalized.cardType,
    normalized.objectType
  ]);
  return new Set(tokenizeSearchText(searchParts.join(" ")));
}

function lexicalScoreCard<TCard extends RuntimeKnowledgeCardLike>(card: TCard, query: string, queryTokens: string[]) {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const normalizedCard = normalizeCard(card);
  const haystack = uniqueValues([
    normalizedCard.searchText,
    normalizedCard.canonical_name,
    ...normalizedCard.aliases,
    ...normalizedCard.callerPhrases
  ]).join(" ").toLowerCase();
  if (!normalizedQuery || !haystack) {
    return {
      score: 0,
      tokenOverlapCount: 0,
      strongTokenOverlapCount: 0,
      aliasExact: false,
      phraseExact: false
    };
  }

  const haystackTokens = buildCardSearchTokens(card);
  let score = haystack.includes(normalizedQuery) ? 22 : 0;
  let tokenOverlapCount = 0;
  let strongTokenOverlapCount = 0;
  for (const token of queryTokens) {
    if (!token) continue;
    if (haystackTokens.has(token) || haystack.includes(token)) {
      tokenOverlapCount += 1;
      if (token.length >= ELIGIBILITY_STRONG_TOKEN_LEN) {
        strongTokenOverlapCount += 1;
      }
      score += token.length >= 6 ? 4 : 2;
    }
  }

  const aliasExact = normalizedCard.aliases.some((alias) => normalizeText(alias).toLowerCase() === normalizedQuery);
  const phraseExact = normalizedCard.callerPhrases.some((phrase) => normalizeText(phrase).toLowerCase().includes(normalizedQuery));
  if (aliasExact) score += 12;
  if (phraseExact) score += 8;

  return {
    score,
    tokenOverlapCount,
    strongTokenOverlapCount,
    aliasExact,
    phraseExact
  };
}

function precedenceScoreCard<TCard extends RuntimeKnowledgeCardLike>(card: TCard) {
  const normalized = normalizeCard(card);
  const sourcePriority = Number(normalized.scope.source_priority || 0);
  const contentPriority = Number(normalized.scope.content_priority || 0);
  const qualityScore = normalized.qualityScore * 10;
  return sourcePriority + contentPriority + qualityScore;
}

function classifyCardSignals<TCard extends RuntimeKnowledgeCardLike>(card: TCard) {
  const normalized = normalizeCard(card);
  const lower = uniqueValues([
    normalized.canonical_name,
    normalized.searchText,
    normalized.topicPath,
    normalized.cardType,
    normalized.objectType,
    normalized.contentClass
  ]).join(" ").toLowerCase();

  const serviceAreaFocused = normalized.topicPath === "service_area"
    || normalized.cardType === "coverage"
    || normalized.objectType === "service_area"
    || /\b(service area|coverage|locations?|serves|serving)\b/.test(lower);

  const serviceFocused = normalized.topicPath === "service_detail"
    || normalized.cardType === "service"
    || normalized.objectType === "offering";

  const afterHoursFocused = /\b(after hours|after-hours|on call|on-call|weekend|24\/7|24 7|urgent leak|urgent leaks)\b/.test(lower);
  const policyFocused = normalized.contentClass === "policy_boundary"
    || /\b(pricing|policy|warranty|financing|hours)\b/.test(lower);

  return {
    serviceAreaFocused,
    serviceFocused,
    afterHoursFocused,
    policyFocused
  };
}

function topicalityScoreCard<TCard extends RuntimeKnowledgeCardLike>(
  card: TCard,
  querySignals: RuntimeQuerySignals,
  lexicalMatch: { tokenOverlapCount: number }
) {
  const cardSignals = classifyCardSignals(card);
  let score = 0;

  if (querySignals.afterHours) {
    if (cardSignals.afterHoursFocused) score += 12;
    if (cardSignals.serviceAreaFocused) score -= 2;
    if (cardSignals.serviceFocused) score -= 2;
    return score;
  }

  if (querySignals.serviceArea) {
    if (cardSignals.serviceAreaFocused) score += 14;
    if (cardSignals.afterHoursFocused) score -= NON_AFTER_HOURS_MIXED_CARD_PENALTY;
    return score;
  }

  if (querySignals.serviceQuestion) {
    if (cardSignals.serviceFocused) score += 12;
    if (cardSignals.afterHoursFocused) score -= NON_AFTER_HOURS_MIXED_CARD_PENALTY;
    return score;
  }

  if (querySignals.policyQuestion) {
    if (cardSignals.policyFocused) score += 8;
    if (cardSignals.afterHoursFocused && !querySignals.afterHours) score -= 4;
    return score;
  }

  if (cardSignals.afterHoursFocused && lexicalMatch.tokenOverlapCount < 2) {
    score -= 4;
  }

  return score;
}

function extractThreadTokens(callState: CallState | null | undefined) {
  if (!callState) return [];
  const capturedFields = asObject(callState.captured_fields);
  const priorFacts = asStringArray(capturedFields.last_answer_facts);
  return uniqueValues([
    ...tokenizeSearchText(callState.last_turn_intent).filter((token) => token.length >= ELIGIBILITY_TOKEN_MIN_LEN),
    ...priorFacts.flatMap((fact) => tokenizeSearchText(fact).filter((token) => token.length >= ELIGIBILITY_TOKEN_MIN_LEN + 1))
  ]);
}

function continuityScoreCard<TCard extends RuntimeKnowledgeCardLike>(card: TCard, callState: CallState | null, querySignals: RuntimeQuerySignals) {
  if (!querySignals.followUp || !callState) return 0;
  const threadTokens = extractThreadTokens(callState);
  if (!threadTokens.length) return 0;
  const cardTokens = buildCardSearchTokens(card);
  const overlapCount = threadTokens.filter((token) => cardTokens.has(token)).length;
  const minimumOverlap = querySignals.serviceArea ? 1 : 2;
  if (overlapCount < minimumOverlap) return 0;
  return Math.min(MAX_CONTINUITY_BOOST, overlapCount * 2);
}

function isPreferredBundleCard<TCard extends RuntimeKnowledgeCardLike>(card: RankedRuntimeKnowledgeCard<TCard>, querySignals: RuntimeQuerySignals) {
  const cardSignals = classifyCardSignals(card);
  if (querySignals.afterHours) {
    return cardSignals.afterHoursFocused;
  }
  if (querySignals.serviceArea) {
    return cardSignals.serviceAreaFocused && !cardSignals.afterHoursFocused;
  }
  if (querySignals.serviceQuestion) {
    return cardSignals.serviceFocused && !cardSignals.afterHoursFocused;
  }
  if (querySignals.policyQuestion) {
    return cardSignals.policyFocused && !cardSignals.afterHoursFocused;
  }
  return !cardSignals.afterHoursFocused;
}

function canUseAsBundleFallback<TCard extends RuntimeKnowledgeCardLike>(
  card: RankedRuntimeKnowledgeCard<TCard>,
  querySignals: RuntimeQuerySignals,
  selectedCount: number
) {
  const cardSignals = classifyCardSignals(card);
  if (querySignals.afterHours) {
    return cardSignals.afterHoursFocused;
  }
  if (querySignals.followUp && cardSignals.afterHoursFocused) {
    return false;
  }
  if (querySignals.serviceArea || querySignals.serviceQuestion) {
    if (cardSignals.afterHoursFocused) return false;
  }
  if (querySignals.serviceArea && !cardSignals.serviceAreaFocused && selectedCount >= 1) {
    return false;
  }
  if (querySignals.serviceQuestion && !cardSignals.serviceFocused && selectedCount >= 1) {
    return false;
  }
  return true;
}

function buildTriggerEvidence(query: string, haystackTexts: string[]) {
  const queryText = normalizeText(query).toLowerCase();
  if (!queryText) {
    return {
      eligible: false,
      score: 0,
      tokenOverlapCount: 0,
      strongTokenOverlapCount: 0,
      phraseMatch: false
    };
  }

  const queryTokens = tokenizeSearchText(queryText).filter((token) => token.length >= ELIGIBILITY_TOKEN_MIN_LEN);
  const haystack = uniqueValues(haystackTexts.map((item) => normalizeText(item))).join(" ").toLowerCase();
  const haystackTokens = new Set(tokenizeSearchText(haystack));

  const phraseMatch = haystack.includes(queryText);
  let tokenOverlapCount = 0;
  let strongTokenOverlapCount = 0;
  let score = phraseMatch ? 18 : 0;

  for (const token of queryTokens) {
    if (!token) continue;
    if (haystackTokens.has(token) || haystack.includes(token)) {
      tokenOverlapCount += 1;
      if (token.length >= ELIGIBILITY_STRONG_TOKEN_LEN) {
        strongTokenOverlapCount += 1;
        score += 6;
      } else {
        score += 3;
      }
    }
  }

  return {
    eligible: phraseMatch || strongTokenOverlapCount >= 1 || tokenOverlapCount >= 2,
    score,
    tokenOverlapCount,
    strongTokenOverlapCount,
    phraseMatch
  };
}

function isWithinEffectiveWindow(item: Record<string, unknown>, at = new Date()) {
  const effectiveFrom = normalizeText(item.effective_from || item.effectiveFrom);
  const effectiveUntil = normalizeText(item.effective_until || item.effectiveUntil);
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

function scopeMatches(item: Record<string, unknown>, callState: CallState | null, runtimeBundle: RuntimeBundleScopeLike) {
  const domains = asStringArray(item.applies_to_domains);
  const subdomains = asStringArray(item.applies_to_subdomains);
  const scope = asObject(item.scope);
  const runtimeMode = normalizeText(runtimeBundle.runtime_mode);
  const stateDomainId = normalizeText(callState?.active_domain_id || runtimeBundle.active_domain_id);
  const stateSubdomainId = normalizeText(callState?.active_subdomain_id || runtimeBundle.active_subdomain_id);
  if (domains.length && !domains.includes(stateDomainId)) return false;
  if (subdomains.length && !subdomains.includes(stateSubdomainId)) return false;
  if (scope.runtime_mode && runtimeMode && normalizeText(scope.runtime_mode) !== runtimeMode) return false;
  return true;
}

function normalizeOverrideLike<TOverride extends KnowledgeOverride | Record<string, unknown>>(override: TOverride) {
  return {
    raw: override,
    overrideType: normalizeText((override as Record<string, unknown>).override_type || (override as Record<string, unknown>).overrideType),
    priority: Number((override as Record<string, unknown>).priority || 100),
    title: normalizeText((override as Record<string, unknown>).title),
    body: normalizeText((override as Record<string, unknown>).body),
    appliesToIntents: asStringArray((override as Record<string, unknown>).applies_to_intents || (override as Record<string, unknown>).applies_to_intents_json || (override as Record<string, unknown>).appliesToIntents)
  };
}

function normalizeGuardrailLike<TGuardrail extends KnowledgeGuardrail | Record<string, unknown>>(guardrail: TGuardrail) {
  return {
    raw: guardrail,
    guardrailType: normalizeText((guardrail as Record<string, unknown>).guardrail_type || (guardrail as Record<string, unknown>).guardrailType),
    mode: normalizeText((guardrail as Record<string, unknown>).mode),
    triggerPatterns: asStringArray((guardrail as Record<string, unknown>).trigger_patterns || (guardrail as Record<string, unknown>).trigger_patterns_json || (guardrail as Record<string, unknown>).triggerPatterns),
    triggerIntents: asStringArray((guardrail as Record<string, unknown>).trigger_intents || (guardrail as Record<string, unknown>).trigger_intents_json || (guardrail as Record<string, unknown>).triggerIntents),
    riskLevel: normalizeText((guardrail as Record<string, unknown>).risk_level || (guardrail as Record<string, unknown>).riskLevel)
  };
}

export function rankKnowledgeCards<TCard extends RuntimeKnowledgeCardLike>(
  cards: TCard[],
  query: string,
  options: RuntimeCardRankingOptions = {}
): RuntimeCardRankingResult<TCard> {
  const queryText = normalizeText(query);
  const queryTokens = expandQueryTokens(queryText, tokenizeSearchText(queryText).filter((item) => item.length >= ELIGIBILITY_TOKEN_MIN_LEN));
  const queryEmbedding = buildSparseEmbedding(queryText, queryTokens);
  const querySignals = buildQuerySignals(queryText, queryTokens);

  const ranked = (Array.isArray(cards) ? cards : [])
    .map((card) => {
      const lexicalMatch = lexicalScoreCard(card, queryText, queryTokens);
      const vectorScore = cosineSparseSimilarity(queryEmbedding, normalizeCard(card).embedding) * 100;
      const topicalityScore = topicalityScoreCard(card, querySignals, lexicalMatch);
      const relevanceScore = Number(((lexicalMatch.score * LEXICAL_WEIGHT) + (vectorScore * VECTOR_WEIGHT) + topicalityScore).toFixed(4));
      const eligibilityMatched = lexicalMatch.aliasExact
        || lexicalMatch.phraseExact
        || lexicalMatch.strongTokenOverlapCount >= 1
        || lexicalMatch.tokenOverlapCount >= 2;
      const precedenceScore = precedenceScoreCard(card);
      const continuityScore = continuityScoreCard(card, options.callState || null, querySignals);
      const finalScore = Number((relevanceScore + (precedenceScore * PRECEDENCE_WEIGHT) + continuityScore).toFixed(4));

      return {
        ...card,
        lexicalScore: Number(lexicalMatch.score.toFixed(4)),
        vectorScore: Number(vectorScore.toFixed(4)),
        precedenceScore: Number(precedenceScore.toFixed(4)),
        continuityScore: Number(continuityScore.toFixed(4)),
        topicalityScore: Number(topicalityScore.toFixed(4)),
        relevanceScore,
        finalScore,
        eligibilityMatched,
        tokenOverlapCount: lexicalMatch.tokenOverlapCount,
        strongTokenOverlapCount: lexicalMatch.strongTokenOverlapCount
      };
    })
    .filter((card) => card.eligibilityMatched && card.relevanceScore > 0)
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, Math.max(1, options.maxResults || 6));

  return {
    results: ranked,
    telemetry: {
      query: queryText,
      candidate_count: Array.isArray(cards) ? cards.length : 0,
      selected_card_count: Math.min(ranked.length, 3),
      lexical_weight: LEXICAL_WEIGHT,
      vector_weight: VECTOR_WEIGHT,
      precedence_weight: PRECEDENCE_WEIGHT,
      top_scores: ranked.slice(0, 4).map((card) => ({
        knowledge_card_id: normalizeText(card.knowledge_card_id),
        lexical_score: Number(card.lexicalScore.toFixed(4)),
        vector_score: Number(card.vectorScore.toFixed(4)),
        precedence_score: Number(card.precedenceScore.toFixed(4)),
        continuity_score: Number(card.continuityScore.toFixed(4)),
        final_score: Number(card.finalScore.toFixed(4))
      }))
    },
    querySignals
  };
}

export function selectBundleCards<TCard extends RuntimeKnowledgeCardLike>(
  cards: Array<RankedRuntimeKnowledgeCard<TCard>>,
  query: string
) {
  const ranked = Array.isArray(cards) ? cards : [];
  const firstRanked = ranked[0];
  if (!firstRanked) return [];
  const querySignals = buildQuerySignals(normalizeText(query), tokenizeSearchText(query));
  const topRelevance = Math.max(BUNDLE_ABSOLUTE_RELEVANCE_FLOOR, firstRanked.relevanceScore || 0);
  const minimumRelevance = Math.max(BUNDLE_ABSOLUTE_RELEVANCE_FLOOR, Number((topRelevance * BUNDLE_RELATIVE_RELEVANCE_FLOOR).toFixed(4)));

  const selected: Array<RankedRuntimeKnowledgeCard<TCard>> = [];
  const seen = new Set<string>();

  for (const candidate of ranked) {
    if (selected.length >= 3) break;
    if (candidate.relevanceScore < minimumRelevance) continue;
    if (!isPreferredBundleCard(candidate, querySignals)) continue;

    const cardId = normalizeText(candidate.knowledge_card_id);
    if (seen.has(cardId)) continue;
    seen.add(cardId);
    selected.push(candidate);
  }

  for (const candidate of ranked) {
    if (selected.length >= 3) break;
    if (candidate.relevanceScore < minimumRelevance) continue;
    if (!canUseAsBundleFallback(candidate, querySignals, selected.length)) continue;

    const cardSignals = classifyCardSignals(candidate);
    if (!querySignals.afterHours && candidate.tokenOverlapCount < 2 && cardSignals.afterHoursFocused && !querySignals.policyQuestion) {
      continue;
    }

    const cardId = normalizeText(candidate.knowledge_card_id);
    if (seen.has(cardId)) continue;
    seen.add(cardId);
    selected.push(candidate);
  }

  if (!selected.length) {
    return ranked.slice(0, 1);
  }

  return selected;
}

export function selectMatchedOverrides<TOverride extends KnowledgeOverride | Record<string, unknown>>(
  overrides: TOverride[],
  query: string,
  runtimeBundle: RuntimeBundleScopeLike
) {
  return (Array.isArray(overrides) ? overrides : [])
    .map((item) => {
      const normalized = normalizeOverrideLike(item);
      if (!isWithinEffectiveWindow(item as Record<string, unknown>)) return { item, score: -1 };
      if (!scopeMatches(item as Record<string, unknown>, null, runtimeBundle)) return { item, score: -1 };
      const trigger = buildTriggerEvidence(query, [
        normalized.title,
        normalized.body,
        ...normalized.appliesToIntents
      ]);
      if (!trigger.eligible) return { item, score: -1 };

      let score = trigger.score;
      if (normalized.overrideType === "hard_fact") score += 12;
      if (normalized.overrideType === "temporary_notice") score += 10;
      if (normalized.overrideType === "approved_answer") score += 8;
      score += Math.max(0, 20 - normalized.priority / 10);
      return { item, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((item) => item.item);
}

export function selectMatchedGuardrails<TGuardrail extends KnowledgeGuardrail | Record<string, unknown>>(
  guardrails: TGuardrail[],
  query: string,
  runtimeBundle: RuntimeBundleScopeLike,
  callState: CallState | null
) {
  return (Array.isArray(guardrails) ? guardrails : [])
    .map((item) => {
      const normalized = normalizeGuardrailLike(item);
      if (!scopeMatches(item as Record<string, unknown>, callState, runtimeBundle)) return { item, score: -1 };
      const patternEvidence = normalized.triggerPatterns.map((pattern) => buildTriggerEvidence(query, [pattern]));
      const intentEvidence = normalized.triggerIntents.map((intent) => buildTriggerEvidence(query, [intent]));
      const eligibleEvidence = [...patternEvidence, ...intentEvidence].filter((entry) => entry.eligible);
      if (!eligibleEvidence.length) return { item, score: -1 };

      let score = eligibleEvidence.reduce((sum, current) => sum + current.score, 0);
      if (normalized.riskLevel === "critical") score += 24;
      else if (normalized.riskLevel === "high") score += 18;
      else if (normalized.riskLevel === "medium") score += 12;
      else score += 6;
      return { item, score };
    })
    .filter((entry) => {
      const row = entry.item as Record<string, unknown>;
      return entry.score > 0
        && normalizeText(row.status) === "approved_live"
        && row.enabled !== false;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((item) => item.item);
}

export function deriveRuntimeMode(runtimeBundle: RuntimeBundleScopeLike & { selected_cards?: unknown[] }, matchedGuardrails: Array<KnowledgeGuardrail | Record<string, unknown>>): RuntimeMode {
  const guardrailModes = uniqueValues((matchedGuardrails || []).map((item) => normalizeText((item as Record<string, unknown>).mode)));
  if (guardrailModes.includes("emergency_redirect")) return "emergency_redirect";
  if (guardrailModes.includes("handoff")) return "handoff";
  if (guardrailModes.includes("clarify")) return "clarify";
  if (!Array.isArray(runtimeBundle.selected_cards) || !runtimeBundle.selected_cards.length) {
    return "clarify";
  }
  const runtimeMode = normalizeText(runtimeBundle.runtime_mode);
  if (runtimeMode === "partial_answer") return "partial_answer";
  if (runtimeMode === "clarify") return "clarify";
  if (runtimeMode === "handoff") return "handoff";
  if (runtimeMode === "emergency_redirect") return "emergency_redirect";
  return "answer";
}
