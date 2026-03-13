import { compileTenantKnowledge, loadTenantKnowledgeRuntime } from "./knowledge.js";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "at", "with", "about", "your", "you", "we", "our",
  "is", "are", "do", "does", "did", "can", "could", "would", "should", "what", "when", "where", "how", "why"
]);

const TOPIC_KEYWORDS = {
  warranty: ["warranty", "coverage", "covered", "forever warranty", "lifetime", "guarantee"],
  guarantees: ["guarantee", "guaranteed", "satisfaction guarantee", "make it right"],
  emergency_service: ["emergency", "urgent", "24/7", "after hours", "after-hours", "same day", "same-day"],
  service_area: ["service area", "areas you serve", "areas you cover", "coverage area", "service territory", "serve"],
  availability: ["hours", "availability", "open", "weekend", "after hours", "same day", "schedule"],
  financing: ["financing", "payment plan", "payment plans", "monthly payment", "credit"],
  pricing: ["fee", "fees", "price", "pricing", "estimate", "diagnostic", "cost"],
  services: ["repair", "replace", "install", "service", "services", "fix", "handle"],
  policies: ["policy", "process", "cancel", "reschedule", "insurance", "claim"]
};

const TOPIC_TO_SECTION = {
  warranty: "warranties_and_guarantees",
  guarantees: "warranties_and_guarantees",
  emergency_service: "emergency_service",
  service_area: "service_area",
  availability: "hours_and_availability",
  financing: "financing_and_payment",
  pricing: "pricing_and_fees",
  services: "services_and_capabilities",
  policies: "policies_and_process"
};

const TOPIC_RISK_LEVEL = {
  warranty: "critical",
  guarantees: "critical",
  pricing: "critical",
  financing: "high",
  emergency_service: "high",
  service_area: "high",
  availability: "high",
  policies: "normal",
  services: "normal",
  general: "normal"
};

const SERVICE_TAG_PATTERNS = [
  ["water_heater", /\bwater heater|tankless\b/i],
  ["drain_cleaning", /\bdrain|clog|hydro jet\b/i],
  ["sewer", /\bsewer|septic\b/i],
  ["leak_detection", /\bleak\b/i],
  ["fixture_installation", /\bfixture|faucet|toilet|sink\b/i],
  ["emergency_service", /\bemergency|after[- ]hours|urgent\b/i],
  ["electrical_panel", /\bpanel|breaker|rewire\b/i],
  ["generator", /\bgenerator\b/i],
  ["hvac", /\bfurnace|heat pump|air conditioner|ac repair|mini split|hvac\b/i],
  ["garage_door", /\bgarage door|opener|spring\b/i],
  ["insurance", /\binsurance|claim\b/i],
  ["financing", /\bfinancing|payment plan|credit\b/i],
  ["warranty", /\bwarranty|guarantee|satisfaction\b/i],
  ["service_area", /\bservice area|serve|coverage\b/i]
];

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function tokenizeQuery(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
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

function truncateText(value, limit = 320) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function extractServiceTags(text) {
  const haystack = normalizeText(text);
  if (!haystack) return [];
  return SERVICE_TAG_PATTERNS
    .filter(([, pattern]) => pattern.test(haystack))
    .map(([tag]) => tag);
}

function inferTopics(query, explicitTopic) {
  const topics = new Set();
  if (normalizeText(explicitTopic)) {
    topics.add(normalizeText(explicitTopic));
  }
  const lower = normalizeText(query).toLowerCase();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      topics.add(topic);
    }
  }
  return topics.size ? Array.from(topics) : ["general"];
}

function buildQueryContext({ query, topic, topicHints, serviceTags, tradeHint, conversationStage }) {
  const normalizedQuery = normalizeText(query);
  const tokens = tokenizeQuery(normalizedQuery);
  const inferredTopics = uniqueValues([
    ...(Array.isArray(topicHints) ? topicHints : []),
    ...inferTopics(normalizedQuery, topic)
  ]);
  const inferredServiceTags = uniqueValues([
    ...(Array.isArray(serviceTags) ? serviceTags : []),
    ...extractServiceTags(normalizedQuery)
  ]);

  return {
    query: normalizedQuery,
    tokens,
    topicHints: inferredTopics,
    serviceTags: inferredServiceTags,
    tradeHint: normalizeText(tradeHint) || null,
    conversationStage: normalizeText(conversationStage) || "answering_question"
  };
}

function readServiceTags(item) {
  if (Array.isArray(item?.service_tags)) return item.service_tags;
  if (Array.isArray(item?.serviceTags)) return item.serviceTags;
  return [];
}

function readEvidenceText(item) {
  return normalizeText(item?.evidence_text || item?.evidenceText);
}

function readUsageNotes(item) {
  return normalizeText(item?.usage_notes || item?.usageNotes);
}

function readPreferredAnswer(item) {
  return normalizeText(item?.preferred_answer || item?.preferredAnswer);
}

function readTriggerText(item) {
  return normalizeText(item?.trigger_text || item?.triggerText);
}

function readInstructionText(item) {
  return normalizeText(item?.instruction || item?.instructionText);
}

function readRuleType(item) {
  return normalizeText(item?.rule_type || item?.ruleType);
}

function readSourceUrl(item) {
  return normalizeText(item?.source_url || item?.sourceUrl) || null;
}

function readRiskLevel(item) {
  return normalizeText(item?.risk_level || item?.riskLevel) || "normal";
}

function readAppliesWhen(item) {
  return asObject(item?.applies_when || item?.appliesWhen);
}

function normalizePattern(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeAppliesWhen(item, kind) {
  const raw = readAppliesWhen(item);
  const topic = normalizeText(item?.topic);
  const trade = normalizeText(item?.trade) || normalizeText(raw.trade) || null;
  const serviceTags = uniqueValues([
    ...readServiceTags(item),
    ...(Array.isArray(raw.serviceTags) ? raw.serviceTags : [])
  ]);
  const questionPatterns = uniqueValues([
    ...(Array.isArray(raw.questionPatterns) ? raw.questionPatterns : []),
    normalizeText(raw.questionText),
    kind === "override" ? readTriggerText(item) : ""
  ]);
  const triggerTerms = uniqueValues([
    ...(Array.isArray(raw.triggerTerms) ? raw.triggerTerms : []),
    ...tokenizeQuery(`${questionPatterns.join(" ")} ${kind === "guardrail" ? readInstructionText(item) : readPreferredAnswer(item)}`)
  ]);
  const topics = uniqueValues([
    ...(Array.isArray(raw.topics) ? raw.topics : []),
    topic
  ]).filter((value) => value.toLowerCase() !== "general");
  const conversationStages = uniqueValues(Array.isArray(raw.conversationStages) ? raw.conversationStages : []);
  const hasScopedRules = Boolean(topics.length || trade || serviceTags.length || questionPatterns.length || triggerTerms.length);

  return {
    kind,
    alwaysInclude: Boolean(raw.alwaysInclude) || (kind === "guardrail" && !hasScopedRules),
    topics,
    trade,
    serviceTags,
    questionPatterns,
    triggerTerms,
    conversationStages
  };
}

function countCaseInsensitiveOverlap(leftValues, rightValues) {
  const rightSet = new Set((rightValues || []).map((value) => normalizeText(value).toLowerCase()).filter(Boolean));
  return uniqueValues(leftValues).filter((value) => rightSet.has(normalizeText(value).toLowerCase()));
}

function matchQuestionPatterns(context, questionPatterns) {
  const normalizedQuery = normalizePattern(context.query);
  if (!normalizedQuery) return [];
  return uniqueValues(questionPatterns).filter((pattern) => {
    const normalizedPattern = normalizePattern(pattern);
    return normalizedPattern && (normalizedQuery.includes(normalizedPattern) || normalizedPattern.includes(normalizedQuery));
  });
}

function matchTriggerTerms(context, triggerTerms) {
  const normalizedQuery = normalizePattern(context.query);
  const queryTokens = new Set(context.tokens.map((token) => token.toLowerCase()));
  return uniqueValues(triggerTerms).filter((term) => {
    const normalizedTerm = normalizePattern(term);
    if (!normalizedTerm) return false;
    return normalizedQuery.includes(normalizedTerm) || queryTokens.has(normalizedTerm);
  });
}

function matchApplicability(context, item, kind) {
  const appliesWhen = normalizeAppliesWhen(item, kind);
  const matchedBy = [];

  if (
    appliesWhen.conversationStages.length
    && context.conversationStage
    && !appliesWhen.conversationStages.map((value) => value.toLowerCase()).includes(context.conversationStage.toLowerCase())
  ) {
    return { include: false, score: -1, matchedBy, appliesWhen };
  }

  if (appliesWhen.alwaysInclude) {
    matchedBy.push("always_include");
  }

  if (
    appliesWhen.trade
    && context.tradeHint
    && normalizeText(appliesWhen.trade).toLowerCase() !== normalizeText(context.tradeHint).toLowerCase()
  ) {
    return { include: false, score: -1, matchedBy, appliesWhen };
  }

  const topicMatches = countCaseInsensitiveOverlap(context.topicHints, appliesWhen.topics);
  if (topicMatches.length) {
    matchedBy.push(...topicMatches.map((value) => `topic:${value}`));
  }

  const serviceTagMatches = countCaseInsensitiveOverlap(context.serviceTags, appliesWhen.serviceTags);
  if (serviceTagMatches.length) {
    matchedBy.push(...serviceTagMatches.map((value) => `service_tag:${value}`));
  }

  const questionPatternMatches = matchQuestionPatterns(context, appliesWhen.questionPatterns);
  if (questionPatternMatches.length) {
    matchedBy.push(...questionPatternMatches.map((value) => `question_pattern:${truncateText(value, 60)}`));
  }

  const triggerMatches = matchTriggerTerms(context, appliesWhen.triggerTerms);
  if (triggerMatches.length) {
    matchedBy.push(...triggerMatches.slice(0, 3).map((value) => `trigger:${value}`));
  }

  if (appliesWhen.trade && context.tradeHint) {
    matchedBy.push(`trade:${appliesWhen.trade}`);
  }

  if (appliesWhen.conversationStages.length && context.conversationStage) {
    matchedBy.push(`stage:${context.conversationStage}`);
  }

  const isGeneric = !appliesWhen.topics.length
    && !appliesWhen.trade
    && !appliesWhen.serviceTags.length
    && !appliesWhen.questionPatterns.length
    && !appliesWhen.triggerTerms.length;

  const include = appliesWhen.alwaysInclude
    || Boolean(questionPatternMatches.length || triggerMatches.length || serviceTagMatches.length || topicMatches.length)
    || (kind === "guardrail" && (Boolean(appliesWhen.trade && context.tradeHint) || isGeneric));

  if (!include) {
    return { include: false, score: 0, matchedBy, appliesWhen };
  }

  let score = 0;
  if (appliesWhen.alwaysInclude) score += 100;
  score += questionPatternMatches.length * 18;
  score += Math.min(9, triggerMatches.length * 3);
  score += topicMatches.length * 12;
  score += Math.min(12, serviceTagMatches.length * 6);
  if (appliesWhen.trade && context.tradeHint) score += 4;
  if (appliesWhen.conversationStages.length && context.conversationStage) score += 2;
  if (kind === "guardrail") {
    const riskLevel = readRiskLevel(item);
    if (riskLevel === "critical") score += 6;
    else if (riskLevel === "high") score += 3;
  }

  return { include: true, score, matchedBy: uniqueValues(matchedBy), appliesWhen };
}

function scoreText(context, text) {
  const haystack = normalizeText(text).toLowerCase();
  if (!haystack) return 0;
  let score = 0;
  if (context.query && haystack.includes(context.query.toLowerCase())) score += 12;
  for (const token of context.tokens) {
    if (haystack.includes(token)) score += token.length >= 5 ? 2 : 1;
  }
  return score;
}

function scoreTopicAndTags(context, topic, serviceTags, trade) {
  let score = 0;
  const normalizedTopic = normalizeText(topic).toLowerCase();
  if (normalizedTopic && context.topicHints.map((item) => item.toLowerCase()).includes(normalizedTopic)) {
    score += 8;
  }
  for (const tag of serviceTags || []) {
    if (context.serviceTags.map((item) => item.toLowerCase()).includes(String(tag).toLowerCase())) {
      score += 5;
    }
  }
  if (context.tradeHint && normalizeText(trade).toLowerCase() === normalizeText(context.tradeHint).toLowerCase()) {
    score += 3;
  }
  return score;
}

function scoreCard(context, card) {
  const facts = Array.isArray(card.facts) ? card.facts : [];
  const factScores = facts.map((fact) => {
    const score = scoreText(context, `${fact.claim} ${readEvidenceText(fact)}`)
      + scoreTopicAndTags(context, fact.topic, readServiceTags(fact), fact.trade);
    return { fact, score: score + (fact.required ? 2 : 0) + (Number(fact.confidence) || 0) };
  });

  const cardScore = scoreText(
    context,
    `${card.title} ${card.topic || ""} ${card.trade || ""} ${card.summary || ""} ${readUsageNotes(card)}`
  ) + scoreTopicAndTags(context, card.topic, readServiceTags(card), card.trade);

  const topFacts = factScores
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    score: cardScore + topFacts.reduce((sum, item) => sum + item.score, 0),
    topFacts
  };
}

function scoreFact(context, fact) {
  return scoreText(context, `${fact.claim} ${readEvidenceText(fact)}`)
    + scoreTopicAndTags(context, fact.topic, readServiceTags(fact), fact.trade)
    + (Number(fact.confidence) || 0);
}

export function buildKnowledgeRetrieval(knowledge, request) {
  const context = buildQueryContext(request || {});

  const cards = (knowledge.cards || [])
    .map((card, index) => {
      const scoring = scoreCard(context, card);
      return {
        id: card.id || `card_${index + 1}`,
        cardKey: card.card_key || card.cardKey || null,
        topic: card.topic || null,
        trade: card.trade || null,
        title: card.title,
        summary: card.summary || "",
        usageNotes: readUsageNotes(card) || null,
        serviceTags: readServiceTags(card),
        sourceUrl: scoring.topFacts.map((item) => readSourceUrl(item.fact)).find(Boolean) || null,
        facts: scoring.topFacts.map((item) => ({
          id: item.fact.id || null,
          claim: item.fact.claim,
          evidenceText: readEvidenceText(item.fact) || null,
          sourceUrl: readSourceUrl(item.fact),
          confidence: item.fact.confidence ?? null,
          riskLevel: readRiskLevel(item.fact),
          serviceTags: readServiceTags(item.fact),
          score: Number(item.score.toFixed(2))
        })),
        score: Number(scoring.score.toFixed(2))
      };
    })
    .filter((card) => card.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const cardFactIds = new Set(cards.flatMap((card) => card.facts.map((fact) => fact.id).filter(Boolean)));

  const facts = (knowledge.facts || [])
    .map((fact, index) => ({
      id: fact.id || `fact_${index + 1}`,
      topic: fact.topic || null,
      trade: fact.trade || null,
      claim: fact.claim,
      evidenceText: readEvidenceText(fact) || null,
      sourceUrl: readSourceUrl(fact),
      confidence: fact.confidence ?? null,
      riskLevel: readRiskLevel(fact),
      serviceTags: readServiceTags(fact),
      score: Number(scoreFact(context, fact).toFixed(2))
    }))
    .filter((fact) => fact.score > 0 && !cardFactIds.has(fact.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const overrides = (knowledge.overrides || [])
    .map((item, index) => {
      const applicability = matchApplicability(context, item, "override");
      return {
        id: item.id || `override_${index + 1}`,
        topic: item.topic || null,
        trade: item.trade || null,
        triggerText: readTriggerText(item) || null,
        preferredAnswer: readPreferredAnswer(item),
        serviceTags: readServiceTags(item),
        appliesWhen: applicability.appliesWhen,
        matchedBy: applicability.matchedBy,
        score: Number(applicability.score.toFixed(2))
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const guardrails = (knowledge.guardrails || [])
    .map((item, index) => {
      const applicability = matchApplicability(context, item, "guardrail");
      return {
        id: item.id || `guardrail_${index + 1}`,
        ruleType: readRuleType(item) || "general",
        topic: item.topic || null,
        trade: item.trade || null,
        severity: item.severity || "high",
        instruction: readInstructionText(item),
        serviceTags: readServiceTags(item),
        appliesWhen: applicability.appliesWhen,
        matchedBy: applicability.matchedBy,
        score: Number(applicability.score.toFixed(2))
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const topScore = Math.max(
    cards[0]?.score || 0,
    facts[0]?.score || 0,
    overrides[0]?.score || 0
  );

  return {
    queryContext: context,
    resultStrength: topScore >= 20 ? "strong" : topScore >= 9 ? "medium" : topScore > 0 ? "weak" : "none",
    cards,
    facts,
    overrides,
    guardrails,
    usageInstructions: Array.isArray(knowledge.usage_instructions)
      ? knowledge.usage_instructions
      : (Array.isArray(knowledge.usageInstructions) ? knowledge.usageInstructions : [])
  };
}

function buildDeterministicAnswerPreview(question, retrieval) {
  const topOverride = retrieval.overrides?.[0];
  if (topOverride && topOverride.score >= 10 && normalizeText(topOverride.preferredAnswer)) {
    return {
      text: truncateText(topOverride.preferredAnswer, 360),
      source: "override",
      confidence: retrieval.resultStrength
    };
  }

  const claims = uniqueValues([
    ...(retrieval.cards || []).flatMap((card) => (card.facts || []).map((fact) => fact.claim)),
    ...(retrieval.facts || []).map((fact) => fact.claim)
  ]).slice(0, 2);

  if (!claims.length) {
    return {
      text: "",
      source: "none",
      confidence: "none"
    };
  }

  return {
    text: truncateText(claims.join(" "), 360),
    source: "retrieval_fallback",
    confidence: retrieval.resultStrength
  };
}

async function generateAnswerPreviewWithAi(question, retrieval) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;
  if (!(retrieval.cards?.length || retrieval.facts?.length || retrieval.overrides?.length)) return null;

  const payload = {
    question,
    cards: (retrieval.cards || []).map((card) => ({
      title: card.title,
      topic: card.topic,
      summary: card.summary,
      facts: (card.facts || []).map((fact) => fact.claim)
    })),
    facts: (retrieval.facts || []).map((fact) => fact.claim),
    overrides: (retrieval.overrides || []).map((item) => ({
      triggerText: item.triggerText,
      preferredAnswer: item.preferredAnswer
    })),
    guardrails: (retrieval.guardrails || []).map((item) => item.instruction),
    usageInstructions: retrieval.usageInstructions || []
  };

  const instruction = [
    "You generate a short answer preview for a tenant phone assistant.",
    "Use only the provided retrieval payload.",
    "Prefer an override if one clearly applies.",
    "Keep the answer to one or two short sentences.",
    "Do not add promises, pricing, or policy details not present in the retrieval payload.",
    "Return strict JSON: {\"answer\":\"...\"}"
  ].join("\n");

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ENRICH_MODEL || "gpt-4.1-mini",
        input: [
          { role: "system", content: instruction },
          { role: "user", content: JSON.stringify(payload) }
        ]
      })
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const outputText =
      json.output_text ||
      json.output
        ?.flatMap((item) => item.content || [])
        .find((item) => item.type === "output_text" && typeof item.text === "string")
        ?.text || "";
    const parsed = JSON.parse(outputText.includes("{") ? outputText.slice(outputText.indexOf("{"), outputText.lastIndexOf("}") + 1) : outputText);
    const answer = normalizeText(parsed?.answer);
    if (!answer) return null;
    return {
      text: truncateText(answer, 360),
      source: "model",
      confidence: retrieval.resultStrength
    };
  } catch {
    return null;
  }
}

export async function generateKnowledgeAnswerPreview(question, retrieval) {
  const modelResult = await generateAnswerPreviewWithAi(question, retrieval);
  if (modelResult) return modelResult;
  return buildDeterministicAnswerPreview(question, retrieval);
}

function inferFeedbackRouteHeuristic({ question, editedAnswer, userFeedbackText, retrieval }) {
  const combined = `${question} ${editedAnswer} ${userFeedbackText}`.toLowerCase();
  if (/\b(do not|don't|never|avoid|must not|should not)\b/.test(combined)) {
    return "guardrail";
  }
  if (/\b(wrong|incorrect|outdated|no longer|not true|used to)\b/.test(combined)) {
    return "fact_correction_proposal";
  }
  if ((retrieval.queryContext?.topicHints || []).some((topic) => ["warranty", "guarantees", "pricing", "emergency_service", "availability", "service_area", "financing"].includes(String(topic)))) {
    return "answer_override";
  }
  return "card_update";
}

async function classifyFeedbackWithAi(input, fallbackDecision) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;

  const instruction = [
    "You classify tenant knowledge feedback for a phone assistant knowledge system.",
    "Choose exactly one route_decision from: card_update, answer_override, guardrail, fact_correction_proposal.",
    "Use answer_override when the user is changing preferred phrasing for a specific answer.",
    "Use guardrail when the user is instructing what must not be said or when to be careful.",
    "Use fact_correction_proposal when they say existing knowledge is wrong or outdated.",
    "Use card_update when they are adding business facts that should become general knowledge.",
    "Return strict JSON with keys: routeDecision, routeReason, topic, serviceTags, confidence."
  ].join("\n");

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ENRICH_MODEL || "gpt-4.1-mini",
        input: [
          { role: "system", content: instruction },
          { role: "user", content: JSON.stringify(input) }
        ]
      })
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const outputText =
      json.output_text ||
      json.output
        ?.flatMap((item) => item.content || [])
        .find((item) => item.type === "output_text" && typeof item.text === "string")
        ?.text || "";
    const start = outputText.indexOf("{");
    const end = outputText.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 && end > start ? outputText.slice(start, end + 1) : outputText);
    const routeDecision = normalizeText(parsed?.routeDecision) || fallbackDecision;
    return {
      routeDecision,
      routeReason: normalizeText(parsed?.routeReason) || "AI classified the feedback route.",
      topic: normalizeText(parsed?.topic) || null,
      serviceTags: Array.isArray(parsed?.serviceTags) ? parsed.serviceTags.map((item) => normalizeText(item)).filter(Boolean) : [],
      confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0.75
    };
  } catch {
    return null;
  }
}

export async function classifyKnowledgeFeedback(input) {
  const fallbackDecision = inferFeedbackRouteHeuristic(input);
  const aiResult = await classifyFeedbackWithAi(input, fallbackDecision);
  const topic = aiResult?.topic || input.retrieval?.queryContext?.topicHints?.[0] || "general";
  const serviceTags = uniqueValues([
    ...(aiResult?.serviceTags || []),
    ...(input.retrieval?.queryContext?.serviceTags || [])
  ]);

  return {
    routeDecision: aiResult?.routeDecision || fallbackDecision,
    routeReason: aiResult?.routeReason || "Heuristic route based on the feedback wording and question topic.",
    topic,
    serviceTags,
    confidence: aiResult?.confidence ?? (fallbackDecision === "fact_correction_proposal" ? 0.7 : 0.6)
  };
}

function inferRiskLevel(topic) {
  return TOPIC_RISK_LEVEL[normalizeText(topic)] || "normal";
}

async function insertFeedbackEvent(db, tenantKey, values) {
  const result = await db.query(
    `INSERT INTO knowledge_feedback_events (
       tenant_key,
       source_kind,
       question_text,
       draft_answer,
       user_feedback_text,
       edited_answer,
       route_decision,
       route_confidence,
       route_reason,
       target_artifact_type,
       target_artifact_id,
       status,
       metadata_json,
       created_by_type
     )
     VALUES ($1, 'knowledge_review', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'tenant')
     RETURNING id`,
    [
      tenantKey,
      values.questionText,
      values.draftAnswer,
      values.userFeedbackText,
      values.editedAnswer,
      values.routeDecision,
      values.routeConfidence,
      values.routeReason,
      values.targetArtifactType || null,
      values.targetArtifactId || null,
      values.status,
      JSON.stringify(values.metadata || {})
    ]
  );
  return Number(result.rows[0]?.id);
}

async function updateFeedbackEventTarget(db, tenantKey, eventId, targetArtifactType, targetArtifactId, status) {
  await db.query(
    `UPDATE knowledge_feedback_events
     SET target_artifact_type = $3,
         target_artifact_id = $4,
         status = $5,
         updated_at = NOW()
     WHERE tenant_key = $1
       AND id = $2`,
    [tenantKey, eventId, targetArtifactType || null, targetArtifactId || null, status]
  );
}

async function upsertFeedbackGuardrailQuestion(db, tenantKey, eventId, values) {
  const existing = await db.query(
    `SELECT id
     FROM guardrail_question_tests
     WHERE tenant_key = $1
       AND status = 'active'
       AND lower(regexp_replace(question_text, '\s+', ' ', 'g')) = lower(regexp_replace($2, '\s+', ' ', 'g'))
     LIMIT 1`,
    [tenantKey, values.questionText]
  );

  const artifactsJson = JSON.stringify({
    managedBy: "feedback_event",
    routeDecision: values.routeDecision,
    sourceFeedbackEventId: eventId,
    sourceType: "tenant_feedback",
    sourceUrl: null,
    sourceConfidence: values.routeConfidence,
    serviceTags: values.serviceTags
  });

  if (existing.rowCount) {
    await db.query(
      `UPDATE guardrail_question_tests
       SET topic = $3,
           risk_level = $4,
           service_tags = $5::text[],
           draft_answer = $6,
           approved_answer = $7,
           review_status = 'approved',
           supporting_artifacts_json = $8::jsonb,
           updated_at = NOW()
       WHERE tenant_key = $1
         AND id = $2`,
      [
        tenantKey,
        Number(existing.rows[0].id),
        values.topic,
        values.riskLevel,
        values.serviceTags,
        values.answer,
        values.answer,
        artifactsJson
      ]
    );
    return Number(existing.rows[0].id);
  }

  const inserted = await db.query(
    `INSERT INTO guardrail_question_tests (
       tenant_key,
       topic,
       question_text,
       risk_level,
       service_tags,
       draft_answer,
       approved_answer,
       review_status,
       supporting_artifacts_json
     )
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7, 'approved', $8::jsonb)
     RETURNING id`,
    [
      tenantKey,
      values.topic,
      values.questionText,
      values.riskLevel,
      values.serviceTags,
      values.answer,
      values.answer,
      artifactsJson
    ]
  );
  return Number(inserted.rows[0]?.id);
}

async function insertFeedbackKnowledgeEntry(db, tenantKey, eventId, values) {
  const inserted = await db.query(
    `INSERT INTO knowledge_entries (
       tenant_key,
       entry_type,
       section_type,
       title,
       content_text,
       source_url,
       compilation_status,
       metadata_json,
       created_by_type,
       created_by_id
     )
     VALUES ($1, 'feedback_note', $2, $3, $4, NULL, 'compiled', $5::jsonb, 'tenant', $6)
     RETURNING id`,
    [
      tenantKey,
      values.sectionType,
      values.title,
      values.contentText,
      JSON.stringify({
        sourceType: "tenant_feedback",
        sourceConfidence: values.routeConfidence,
        sourceFeedbackEventId: eventId
      }),
      String(eventId)
    ]
  );
  return Number(inserted.rows[0]?.id);
}

async function loadFeedbackEventForReview(db, tenantKey, eventId) {
  const result = await db.query(
    `SELECT id,
            question_text,
            draft_answer,
            user_feedback_text,
            edited_answer,
            route_decision,
            route_confidence,
            route_reason,
            target_artifact_type,
            target_artifact_id,
            status,
            metadata_json
     FROM knowledge_feedback_events
     WHERE tenant_key = $1
       AND id = $2
     LIMIT 1`,
    [tenantKey, eventId]
  );
  return result.rows[0] || null;
}

function deriveReviewContextFromEvent(row) {
  const metadata = asObject(row?.metadata_json);
  const retrieval = asObject(metadata.retrieval);
  const queryContext = asObject(retrieval.queryContext);
  return {
    topic: normalizeText((Array.isArray(queryContext.topicHints) ? queryContext.topicHints[0] : null)) || "general",
    serviceTags: uniqueValues(
      Array.isArray(queryContext.serviceTags)
        ? queryContext.serviceTags.map((item) => normalizeText(item)).filter(Boolean)
        : []
    )
  };
}

export async function reviewKnowledgeFeedbackEvent(db, tenantKey, payload) {
  const eventId = Number(payload?.eventId || 0);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    throw new Error("invalid_feedback_event_id");
  }

  const action = normalizeText(payload?.action).toLowerCase();
  if (!["approve", "reject"].includes(action)) {
    throw new Error("invalid_review_action");
  }

  const row = await loadFeedbackEventForReview(db, tenantKey, eventId);
  if (!row) {
    throw new Error("feedback_event_not_found");
  }
  if (normalizeText(row.route_decision) !== "fact_correction_proposal") {
    throw new Error("feedback_event_not_reviewable");
  }
  if (normalizeText(row.status) !== "pending_review") {
    throw new Error("feedback_event_already_reviewed");
  }

  const resolutionText = normalizeText(payload?.resolutionText);

  if (action === "reject") {
    await db.query(
      `UPDATE knowledge_feedback_events
       SET status = 'rejected',
           updated_at = NOW(),
           metadata_json = jsonb_set(
             COALESCE(metadata_json, '{}'::jsonb),
             '{reviewResolution}',
             $3::jsonb,
             true
           )
       WHERE tenant_key = $1
         AND id = $2`,
      [
        tenantKey,
        eventId,
        JSON.stringify({
          action: "reject",
          resolutionText: resolutionText || null,
          reviewedAt: new Date().toISOString()
        })
      ]
    );

    return {
      eventId,
      action: "reject",
      status: "rejected"
    };
  }

  const reviewContext = deriveReviewContextFromEvent(row);
  const finalText = resolutionText || normalizeText(row.edited_answer);

  if (!finalText) {
    throw new Error("missing_review_resolution_text");
  }

  const sectionType = TOPIC_TO_SECTION[reviewContext.topic] || "policies_and_process";
  const knowledgeEntryId = await insertFeedbackKnowledgeEntry(db, tenantKey, eventId, {
    sectionType,
    title: `Correction approved: ${truncateText(row.question_text, 80) || "Knowledge correction"}`,
    contentText: finalText,
    routeConfidence: Number(row.route_confidence) || 1
  });

  let guardrailQuestionId = null;
  if (normalizeText(row.question_text) && (resolutionText || normalizeText(row.edited_answer))) {
    guardrailQuestionId = await upsertFeedbackGuardrailQuestion(db, tenantKey, eventId, {
      questionText: row.question_text,
      topic: reviewContext.topic,
      riskLevel: inferRiskLevel(reviewContext.topic),
      serviceTags: uniqueValues([...reviewContext.serviceTags, ...extractServiceTags(`${row.question_text} ${finalText}`)]),
      answer: finalText,
      routeDecision: null,
      routeConfidence: Number(row.route_confidence) || 1
    });
  }

  await compileTenantKnowledge(db, tenantKey);

  await db.query(
    `UPDATE knowledge_feedback_events
     SET status = 'approved',
         edited_answer = $3,
         target_artifact_type = $4,
         target_artifact_id = $5,
         updated_at = NOW(),
         metadata_json = jsonb_set(
           COALESCE(metadata_json, '{}'::jsonb),
           '{reviewResolution}',
           $6::jsonb,
           true
         )
     WHERE tenant_key = $1
       AND id = $2`,
    [
      tenantKey,
      eventId,
      finalText,
      guardrailQuestionId ? "guardrail_question_test" : "knowledge_entry",
      guardrailQuestionId || knowledgeEntryId,
      JSON.stringify({
        action: "approve",
        resolutionText: finalText,
        knowledgeEntryId,
        guardrailQuestionId,
        reviewedAt: new Date().toISOString()
      })
    ]
  );

  return {
    eventId,
    action: "approve",
    status: "approved",
    knowledgeEntryId,
    guardrailQuestionId
  };
}

export async function applyKnowledgeFeedback(db, tenantKey, payload) {
  const runtime = await loadTenantKnowledgeRuntime(db, tenantKey);
  const retrieval = buildKnowledgeRetrieval(runtime, {
    query: payload.questionText,
    topicHints: payload.topicHints,
    serviceTags: payload.serviceTags
  });

  const decision = await classifyKnowledgeFeedback({
    question: payload.questionText,
    draftAnswer: payload.draftAnswer,
    editedAnswer: payload.editedAnswer,
    userFeedbackText: payload.userFeedbackText,
    retrieval
  });

  const eventId = await insertFeedbackEvent(db, tenantKey, {
    questionText: payload.questionText,
    draftAnswer: payload.draftAnswer,
    userFeedbackText: payload.userFeedbackText,
    editedAnswer: payload.editedAnswer,
    routeDecision: decision.routeDecision,
    routeConfidence: decision.confidence,
    routeReason: decision.routeReason,
    status: decision.routeDecision === "fact_correction_proposal" ? "pending_review" : "applied",
    metadata: { retrieval }
  });

  let targetArtifactType = null;
  let targetArtifactId = null;

  if (decision.routeDecision === "card_update") {
    targetArtifactType = "knowledge_entry";
    targetArtifactId = await insertFeedbackKnowledgeEntry(db, tenantKey, eventId, {
      sectionType: TOPIC_TO_SECTION[decision.topic] || "policies_and_process",
      title: `Feedback: ${truncateText(payload.questionText, 80) || "Knowledge update"}`,
      contentText: normalizeText(payload.editedAnswer) || normalizeText(payload.userFeedbackText),
      routeConfidence: decision.confidence
    });
    await compileTenantKnowledge(db, tenantKey);
    await updateFeedbackEventTarget(db, tenantKey, eventId, targetArtifactType, targetArtifactId, "applied");
  } else if (decision.routeDecision === "answer_override" || decision.routeDecision === "guardrail") {
    targetArtifactType = "guardrail_question_test";
    targetArtifactId = await upsertFeedbackGuardrailQuestion(db, tenantKey, eventId, {
      questionText: payload.questionText,
      topic: decision.topic,
      riskLevel: inferRiskLevel(decision.topic),
      serviceTags: decision.serviceTags,
      answer: normalizeText(payload.editedAnswer) || normalizeText(payload.draftAnswer),
      routeDecision: decision.routeDecision,
      routeConfidence: decision.confidence
    });
    await compileTenantKnowledge(db, tenantKey);
    await updateFeedbackEventTarget(db, tenantKey, eventId, targetArtifactType, targetArtifactId, "applied");
  }

  return {
    eventId,
    decision,
    targetArtifactType,
    targetArtifactId,
    retrieval
  };
}
