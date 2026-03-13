import {
  createBlankGuardrailQuestionTests,
  createBlankKnowledgeEntries
} from "../../../lib/knowledgeTemplates.js";

export const DEFAULT_KNOWLEDGE_USAGE_INSTRUCTIONS = [
  "Use only the grounded tenant knowledge returned by the lookup tool.",
  "Answer the caller's direct question first, then continue the conversation.",
  "Prefer trade-relevant examples and omit unrelated services unless the caller asks.",
  "Do not generalize beyond explicit business information or approved answers.",
  "If the returned knowledge is weak or missing, say you do not have that detail and offer callback follow-up."
];

const SECTION_TOPIC_MAP = {
  services_and_capabilities: "services",
  emergency_service: "emergency_service",
  service_area: "service_area",
  hours_and_availability: "availability",
  warranties_and_guarantees: "warranty",
  pricing_and_fees: "pricing",
  financing_and_payment: "financing",
  policies_and_process: "policies"
};

const TOPIC_RISK_MAP = {
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

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "at", "with", "about", "your", "you", "we", "our",
  "is", "are", "do", "does", "did", "can", "could", "would", "should", "what", "when", "where", "how", "why"
]);

const TOPIC_TRIGGER_TERMS = {
  warranty: ["warranty", "coverage", "covered", "guarantee", "forever warranty", "satisfaction"],
  guarantees: ["guarantee", "guaranteed", "satisfaction guarantee", "make it right"],
  emergency_service: ["emergency", "urgent", "24/7", "after hours", "same day"],
  service_area: ["service area", "coverage area", "serve", "service territory"],
  availability: ["hours", "availability", "open", "weekend", "schedule"],
  financing: ["financing", "payment plan", "monthly payment", "credit"],
  pricing: ["fees", "pricing", "estimate", "diagnostic", "cost"],
  services: ["repair", "replace", "install", "service", "fix"],
  policies: ["policy", "process", "insurance", "claim", "cancel", "reschedule"],
  general: []
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
  ["financing", /\bfinancing|payment plan\b/i],
  ["warranty", /\bwarranty|guarantee|satisfaction\b/i],
  ["service_area", /\bservice area|serve|coverage\b/i]
];

const COVERAGE_CHECKLIST_TEMPLATES = [
  { checkKey: "warranty", title: "Warranty", keywords: ["warranty", "coverage", "covered", "guarantee"], guardrailTopics: ["warranty", "guarantees"] },
  { checkKey: "service_area", title: "Service area", keywords: ["service area", "serve", "locations", "coverage area"], guardrailTopics: ["service_area"] },
  { checkKey: "emergency_service", title: "Emergency service", keywords: ["emergency", "urgent", "24/7", "after hours"], guardrailTopics: ["emergency_service"] },
  { checkKey: "availability", title: "Hours and availability", keywords: ["hours", "availability", "open", "weekend", "schedule"], guardrailTopics: ["availability"] },
  { checkKey: "pricing", title: "Pricing and fees", keywords: ["pricing", "price", "fees", "diagnostic", "estimate"], guardrailTopics: ["pricing"] },
  { checkKey: "financing", title: "Financing and payment", keywords: ["financing", "payment plan", "credit", "monthly"], guardrailTopics: ["financing"] },
  { checkKey: "guarantees", title: "Guarantees and promises", keywords: ["guarantee", "satisfaction", "make it right"], guardrailTopics: ["guarantees"] }
];

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").trim();
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

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function truncateText(value, limit = 280) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function tokenizeTerms(value) {
  return uniqueValues(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  );
}

function inferTopic(sectionType, fallbackTopic = null) {
  return normalizeText(fallbackTopic) || SECTION_TOPIC_MAP[sectionType] || normalizeText(sectionType) || "general";
}

function inferRiskLevel(topic, explicitRisk = null) {
  return normalizeText(explicitRisk) || TOPIC_RISK_MAP[inferTopic(null, topic)] || "normal";
}

function extractServiceTags(text) {
  const haystack = normalizeText(text);
  if (!haystack) return [];
  return SERVICE_TAG_PATTERNS
    .filter(([, pattern]) => pattern.test(haystack))
    .map(([tag]) => tag);
}

function buildAppliesWhenMetadata({
  kind,
  topic,
  trade,
  serviceTags,
  triggerText,
  instructionText,
  questionText,
  severity,
  routeDecision,
  compiledFrom,
  alwaysInclude = false,
  conversationStages = ["answering_question"]
}) {
  const normalizedTopic = inferTopic(null, topic);
  const normalizedTrade = normalizeText(trade) || null;
  const normalizedServiceTags = uniqueValues(serviceTags);
  const patternText = normalizeText(questionText) || normalizeText(triggerText);
  const triggerTerms = uniqueValues([
    ...tokenizeTerms(patternText),
    ...tokenizeTerms(instructionText),
    ...(TOPIC_TRIGGER_TERMS[normalizedTopic] || []),
    ...normalizedServiceTags.map((item) => item.replace(/_/g, " "))
  ]).slice(0, 18);

  return {
    version: 1,
    kind: normalizeText(kind) || null,
    alwaysInclude: Boolean(alwaysInclude),
    topics: normalizedTopic && normalizedTopic !== "general" ? [normalizedTopic] : [],
    trade: normalizedTrade,
    serviceTags: normalizedServiceTags,
    questionPatterns: patternText ? [patternText] : [],
    triggerTerms,
    conversationStages: uniqueValues(conversationStages),
    severity: normalizeText(severity) || null,
    routeDecision: normalizeText(routeDecision) || null,
    compiledFrom: normalizeText(compiledFrom) || null
  };
}

function buildFallbackAppliesWhen({
  kind,
  topic,
  trade,
  serviceTags,
  triggerText,
  instructionText,
  severity
}) {
  const normalizedTopic = normalizeText(topic);
  const normalizedTrade = normalizeText(trade);
  const normalizedServiceTags = uniqueValues(serviceTags);
  const normalizedTrigger = normalizeText(triggerText);
  const hasScopedRules = Boolean(normalizedTopic || normalizedTrade || normalizedServiceTags.length || normalizedTrigger);
  return buildAppliesWhenMetadata({
    kind,
    topic: normalizedTopic,
    trade: normalizedTrade,
    serviceTags: normalizedServiceTags,
    triggerText: normalizedTrigger,
    instructionText,
    severity,
    alwaysInclude: kind === "guardrail" && !hasScopedRules
  });
}

function splitIntoClaims(text) {
  const raw = normalizeText(text);
  if (!raw) return [];

  const candidates = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.replace(/^[\s\-*•]+|[\s\-*•]+$/g, "").trim())
    .filter((line) => line.length >= 8);

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
    if (unique.length >= 10) break;
  }

  return unique.length ? unique : [raw];
}

function isUsableGuardrailAnswer(answer, topic) {
  const cleaned = normalizeText(answer);
  if (!cleaned) return false;
  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount < 4 && !["availability", "service_area"].includes(String(topic || ""))) return false;
  const topicKeywords = TOPIC_TRIGGER_TERMS[topic] || [];
  if (topicKeywords.length && !topicKeywords.some((keyword) => cleaned.toLowerCase().includes(String(keyword).toLowerCase())) && wordCount < 10) {
    return false;
  }
  return true;
}

function mapKnowledgeEntryRow(row) {
  const metadata = asObject(row.metadata_json);
  return {
    id: String(row.id),
    entryType: row.entry_type || "manual_note",
    sectionType: row.section_type || "general",
    title: normalizeText(row.title),
    contentText: normalizeText(row.content_text),
    sourceType: normalizeText(metadata.sourceType) || null,
    sourceUrl: normalizeText(row.source_url) || null,
    sourceConfidence: toNumberOrNull(metadata.sourceConfidence),
    compilationStatus: row.compilation_status || "pending",
    updatedAt: row.updated_at || null
  };
}

function mapGuardrailQuestionRow(row) {
  const metadata = asObject(row.supporting_artifacts_json);
  const answer = normalizeText(row.approved_answer) || normalizeText(row.draft_answer);
  const serviceTags = Array.isArray(metadata.serviceTags)
    ? metadata.serviceTags.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  return {
    id: String(row.id),
    topic: normalizeText(row.topic) || null,
    questionText: normalizeText(row.question_text),
    riskLevel: row.risk_level || "high",
    answer,
    draftAnswer: normalizeText(row.draft_answer),
    approvedAnswer: normalizeText(row.approved_answer),
    reviewStatus: row.review_status || (answer ? "approved" : "pending"),
    sourceType: normalizeText(metadata.sourceType) || null,
    sourceUrl: normalizeText(metadata.sourceUrl) || null,
    sourceConfidence: toNumberOrNull(metadata.sourceConfidence),
    serviceTags,
    managedBy: normalizeText(metadata.managedBy) || null,
    routeDecision: normalizeText(metadata.routeDecision) || null,
    sourceFeedbackEventId: metadata.sourceFeedbackEventId ? Number(metadata.sourceFeedbackEventId) : null,
    updatedAt: row.updated_at || null
  };
}

function mapKnowledgeOverrideRow(row) {
  const appliesWhen = asObject(row.applies_when_json);
  return {
    id: String(row.id),
    topic: normalizeText(row.topic) || null,
    trade: normalizeText(row.trade) || null,
    serviceTags: Array.isArray(row.service_tags) ? row.service_tags.filter(Boolean) : [],
    audience: normalizeText(row.audience) || "general",
    triggerText: normalizeText(row.trigger_text) || null,
    preferredAnswer: normalizeText(row.preferred_answer),
    appliesWhen: Object.keys(appliesWhen).length
      ? appliesWhen
      : buildFallbackAppliesWhen({
          kind: "override",
          topic: row.topic,
          trade: row.trade,
          serviceTags: row.service_tags,
          triggerText: row.trigger_text
        }),
    updatedAt: row.updated_at || null
  };
}

function mapKnowledgeGuardrailRow(row) {
  const appliesWhen = asObject(row.applies_when_json);
  return {
    id: String(row.id),
    ruleType: normalizeText(row.rule_type) || "general",
    topic: normalizeText(row.topic) || null,
    trade: normalizeText(row.trade) || null,
    serviceTags: Array.isArray(row.service_tags) ? row.service_tags.filter(Boolean) : [],
    severity: normalizeText(row.severity) || "high",
    instructionText: normalizeText(row.instruction_text),
    appliesWhen: Object.keys(appliesWhen).length
      ? appliesWhen
      : buildFallbackAppliesWhen({
          kind: "guardrail",
          topic: row.topic,
          trade: row.trade,
          serviceTags: row.service_tags,
          instructionText: row.instruction_text,
          severity: row.severity
        }),
    updatedAt: row.updated_at || null
  };
}

function mapRuntimeFactRow(row) {
  return {
    id: String(row.id),
    topic: normalizeText(row.topic) || null,
    trade: normalizeText(row.trade) || null,
    serviceTags: Array.isArray(row.service_tags) ? row.service_tags.filter(Boolean) : [],
    claim: normalizeText(row.claim),
    evidenceText: normalizeText(row.evidence_text) || null,
    sourceUrl: normalizeText(row.source_url) || null,
    confidence: toNumberOrNull(row.confidence),
    riskLevel: normalizeText(row.risk_level) || "normal",
    sourceType: normalizeText(row.source_type) || null,
    reviewStatus: normalizeText(row.review_status) || "reviewed"
  };
}

function mapKnowledgeFeedbackEventRow(row) {
  return {
    id: String(row.id),
    questionText: normalizeText(row.question_text) || null,
    draftAnswer: normalizeText(row.draft_answer) || null,
    userFeedbackText: normalizeText(row.user_feedback_text) || null,
    editedAnswer: normalizeText(row.edited_answer) || null,
    routeDecision: normalizeText(row.route_decision) || null,
    routeConfidence: toNumberOrNull(row.route_confidence),
    routeReason: normalizeText(row.route_reason) || null,
    targetArtifactType: normalizeText(row.target_artifact_type) || null,
    targetArtifactId: row.target_artifact_id ? String(row.target_artifact_id) : null,
    status: normalizeText(row.status) || "pending",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapSiteTopicRow(row) {
  const metadata = asObject(row.metadata_json);
  return {
    id: String(row.id),
    topicKey: normalizeText(row.topic_key) || null,
    parentTopicKey: normalizeText(row.parent_topic_key) || null,
    topicPath: normalizeText(row.topic_path),
    parentTopicPath: normalizeText(row.parent_topic_path) || null,
    displayTitle: normalizeText(row.display_title) || normalizeText(row.topic_path),
    topicType: normalizeText(row.topic_type) || "page",
    summaryObjective: normalizeText(row.summary_objective),
    sourceUrl: normalizeText(row.source_url) || null,
    sourceConfidence: toNumberOrNull(row.source_confidence),
    riskLevel: normalizeText(row.risk_level) || "normal",
    metadata,
    updatedAt: row.updated_at || null
  };
}

function mapCoverageCheckRow(row) {
  return {
    id: String(row.id),
    checkKey: normalizeText(row.check_key),
    title: normalizeText(row.title),
    status: normalizeText(row.status) || "missing",
    coverageConfidence: toNumberOrNull(row.coverage_confidence),
    matchedTopicPaths: Array.isArray(row.matched_topic_paths_json) ? row.matched_topic_paths_json.map((item) => normalizeText(item)).filter(Boolean) : [],
    notes: normalizeText(row.notes) || null,
    metadata: asObject(row.metadata_json),
    updatedAt: row.updated_at || null
  };
}

function mergeKnowledgeEntries(rows, includeEmptyTemplates) {
  const templates = createBlankKnowledgeEntries();
  const templateBySection = new Map(templates.map((item) => [item.sectionType, item]));
  const rowBySection = new Map();
  const extras = [];

  for (const row of rows) {
    const mapped = mapKnowledgeEntryRow(row);
    if (templateBySection.has(mapped.sectionType) && !rowBySection.has(mapped.sectionType)) {
      rowBySection.set(mapped.sectionType, mapped);
      continue;
    }
    extras.push(mapped);
  }

  if (!includeEmptyTemplates) {
    return [...rowBySection.values(), ...extras];
  }

  return [
    ...templates.map((template) => {
      const existing = rowBySection.get(template.sectionType);
      return existing || {
        id: null,
        entryType: "manual_note",
        sectionType: template.sectionType,
        title: template.title,
        contentText: "",
        sourceType: null,
        sourceUrl: null,
        sourceConfidence: null,
        compilationStatus: "pending",
        updatedAt: null
      };
    }),
    ...extras
  ];
}

function mergeGuardrailQuestions(rows, includeEmptyTemplates) {
  const templates = createBlankGuardrailQuestionTests();
  const templateByQuestion = new Map(templates.map((item) => [item.questionText, item]));
  const rowByQuestion = new Map();
  const extras = [];

  for (const row of rows) {
    const mapped = mapGuardrailQuestionRow(row);
    if (templateByQuestion.has(mapped.questionText) && !rowByQuestion.has(mapped.questionText)) {
      rowByQuestion.set(mapped.questionText, mapped);
      continue;
    }
    extras.push(mapped);
  }

  if (!includeEmptyTemplates) {
    return [...rowByQuestion.values(), ...extras];
  }

  return [
    ...templates.map((template) => {
      const existing = rowByQuestion.get(template.questionText);
      return existing || {
        id: null,
        topic: template.topic,
        questionText: template.questionText,
        riskLevel: template.riskLevel,
        answer: "",
        draftAnswer: "",
        approvedAnswer: "",
        reviewStatus: "pending",
        sourceType: null,
        sourceUrl: null,
        sourceConfidence: null,
        serviceTags: [],
        updatedAt: null
      };
    }),
    ...extras
  ];
}

async function loadKnowledgeAuthoringRows(db, tenantKey) {
  const [entryRes, questionRes, topicRes, coverageRes] = await Promise.all([
    db.query(
      `SELECT id, entry_type, section_type, title, content_text, source_url, compilation_status, metadata_json, updated_at
       FROM knowledge_entries
       WHERE tenant_key = $1
       ORDER BY updated_at DESC, id DESC`,
      [tenantKey]
    ),
    db.query(
      `SELECT id, topic, question_text, risk_level, draft_answer, approved_answer, review_status, supporting_artifacts_json, updated_at
       FROM guardrail_question_tests
       WHERE tenant_key = $1
         AND status = 'active'
       ORDER BY updated_at DESC, id DESC`,
      [tenantKey]
    ),
    db.query(
      `SELECT id, topic_key, parent_topic_key, topic_path, parent_topic_path, display_title, topic_type, summary_objective, source_url, source_confidence, risk_level, metadata_json, updated_at
       FROM site_topics
       WHERE tenant_key = $1
       ORDER BY topic_path ASC, updated_at DESC, id DESC`,
      [tenantKey]
    ),
    db.query(
      `SELECT id, check_key, title, status, coverage_confidence, matched_topic_paths_json, notes, metadata_json, updated_at
       FROM knowledge_coverage_checks
       WHERE tenant_key = $1
       ORDER BY title ASC, updated_at DESC, id DESC`,
      [tenantKey]
    )
  ]);
  return {
    entryRows: entryRes.rows || [],
    questionRows: questionRes.rows || [],
    topicRows: topicRes.rows || [],
    coverageRows: coverageRes.rows || []
  };
}

function buildGeneratedGuardrailInstruction(item) {
  const question = normalizeText(item.questionText) || "this high-risk question";
  return `When asked "${question}", stay within the approved answer and do not add unstated promises or coverage details.`;
}

async function insertCompiledCard(db, tenantKey, values) {
  const result = await db.query(
    `INSERT INTO knowledge_cards (tenant_key, card_key, status, topic, trade, service_tags, audience, title, summary, usage_notes, metadata_json)
     VALUES ($1, $2, 'active', $3, $4, $5::text[], $6, $7, $8, $9, $10::jsonb)
     RETURNING id`,
    [
      tenantKey,
      values.cardKey,
      values.topic,
      values.trade,
      values.serviceTags,
      values.audience || "general",
      values.title,
      values.summary,
      values.usageNotes,
      JSON.stringify(values.metadata || {})
    ]
  );
  return Number(result.rows[0]?.id);
}

async function insertCompiledFact(db, tenantKey, values) {
  const result = await db.query(
    `INSERT INTO knowledge_facts (tenant_key, knowledge_entry_id, status, review_status, source_type, topic, trade, service_tags, claim, evidence_text, source_url, confidence, risk_level, explicit, metadata_json)
     VALUES ($1, $2, 'active', $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12, true, $13::jsonb)
     RETURNING id`,
    [
      tenantKey,
      values.knowledgeEntryId,
      values.reviewStatus || "reviewed",
      values.sourceType,
      values.topic,
      values.trade,
      values.serviceTags,
      values.claim,
      values.evidenceText,
      values.sourceUrl,
      values.confidence,
      values.riskLevel,
      JSON.stringify(values.metadata || {})
    ]
  );
  return Number(result.rows[0]?.id);
}

async function linkCardFact(db, cardId, factId, factRank, required = false) {
  await db.query(
    `INSERT INTO knowledge_card_facts (card_id, fact_id, fact_rank, required)
     VALUES ($1, $2, $3, $4)`,
    [cardId, factId, factRank, required]
  );
}

function inferTopicFromFreeformText(text) {
  const haystack = normalizeText(text).toLowerCase();
  if (!haystack) return "general";
  for (const [topic, terms] of Object.entries(TOPIC_TRIGGER_TERMS)) {
    if (topic === "general") continue;
    if (terms.some((term) => haystack.includes(String(term).toLowerCase()))) {
      return topic;
    }
  }
  return "general";
}

function selectSiteTopicCompileRows(siteTopics) {
  const sorted = [...(siteTopics || [])].sort((left, right) =>
    right.topicPath.split(">").length - left.topicPath.split(">").length
    || left.topicPath.localeCompare(right.topicPath)
  );
  const seenParent = new Set();
  const selected = [];

  for (const topic of sorted) {
    if (!normalizeText(topic.summaryObjective)) continue;
    const parentPath = normalizeText(topic.parentTopicPath);
    if (parentPath) {
      seenParent.add(parentPath);
    }
    selected.push(topic);
  }

  return selected.filter((topic) => {
    const isContainer = seenParent.has(topic.topicPath);
    return !isContainer || topic.topicType !== "group";
  });
}

function buildDerivedCoverageChecklist({ siteTopics, guardrailQuestionTests }) {
  return COVERAGE_CHECKLIST_TEMPLATES.map((template) => {
    const matchingTopics = (siteTopics || []).filter((topic) => {
      const haystack = `${topic.topicPath} ${topic.displayTitle} ${topic.summaryObjective}`.toLowerCase();
      return template.keywords.some((keyword) => haystack.includes(String(keyword).toLowerCase()));
    });
    const matchingGuardrails = (guardrailQuestionTests || []).filter((item) => template.guardrailTopics.includes(item.topic));
    const strongGuardrail = matchingGuardrails.some((item) => isUsableGuardrailAnswer(item.answer, item.topic) && Number(item.sourceConfidence || 0) >= 0.55);
    const mediumGuardrail = matchingGuardrails.some((item) => isUsableGuardrailAnswer(item.answer, item.topic));
    const topicConfidence = matchingTopics.length
      ? Math.max(...matchingTopics.map((topic) => Number(topic.sourceConfidence || 0.5)))
      : 0;

    let status = "missing";
    if ((matchingTopics.length >= 1 && topicConfidence >= 0.72) && strongGuardrail) {
      status = "ready";
    } else if (matchingTopics.length || mediumGuardrail) {
      status = "partial";
    }

    return {
      checkKey: template.checkKey,
      title: template.title,
      status,
      coverageConfidence: Number(Math.max(topicConfidence, strongGuardrail ? 0.85 : mediumGuardrail ? 0.55 : 0).toFixed(2)),
      matchedTopicPaths: matchingTopics.map((topic) => topic.topicPath).slice(0, 8),
      notes: status === "ready"
        ? "Grounded site topics and guardrail coverage were found."
        : status === "partial"
          ? "Some relevant site knowledge exists, but review is still needed."
          : "No reliable grounded coverage was found yet.",
      metadata: {
        topicCount: matchingTopics.length,
        guardrailCount: matchingGuardrails.length
      }
    };
  });
}

async function replaceCoverageChecklist(db, tenantKey, siteTopics, guardrailQuestionTests) {
  const coverageChecklist = buildDerivedCoverageChecklist({ siteTopics, guardrailQuestionTests });
  await db.query(`DELETE FROM knowledge_coverage_checks WHERE tenant_key = $1`, [tenantKey]);
  for (const item of coverageChecklist) {
    await db.query(
      `INSERT INTO knowledge_coverage_checks (tenant_key, check_key, title, status, coverage_confidence, matched_topic_paths_json, notes, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)`,
      [
        tenantKey,
        item.checkKey,
        item.title,
        item.status,
        item.coverageConfidence,
        JSON.stringify(item.matchedTopicPaths || []),
        item.notes,
        JSON.stringify(item.metadata || {})
      ]
    );
  }
}

export async function compileTenantKnowledge(db, tenantKey) {
  const tenantRes = await db.query(
    `SELECT industry
     FROM tenants
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const trade = normalizeText(tenantRes.rows[0]?.industry) || null;
  const { entryRows, questionRows, topicRows } = await loadKnowledgeAuthoringRows(db, tenantKey);
  const siteTopics = (topicRows || []).map(mapSiteTopicRow);
  const hasSiteTopics = siteTopics.length > 0;
  const knowledgeEntries = mergeKnowledgeEntries(entryRows, false)
    .filter((entry) => normalizeText(entry.contentText))
    .filter((entry) => !hasSiteTopics || entry.entryType !== "intake_review");
  const guardrailQuestionTests = mergeGuardrailQuestions(questionRows, false).filter((item) => normalizeText(item.answer));

  await db.query(
    `DELETE FROM knowledge_card_facts
     WHERE card_id IN (SELECT id FROM knowledge_cards WHERE tenant_key = $1)`,
    [tenantKey]
  );
  await Promise.all([
    db.query(`DELETE FROM knowledge_cards WHERE tenant_key = $1`, [tenantKey]),
    db.query(`DELETE FROM knowledge_facts WHERE tenant_key = $1`, [tenantKey]),
    db.query(`DELETE FROM knowledge_overrides WHERE tenant_key = $1`, [tenantKey]),
    db.query(`DELETE FROM knowledge_guardrails WHERE tenant_key = $1`, [tenantKey])
  ]);

  let runtimeCardCount = 0;
  let runtimeFactCount = 0;
  let compiledTopicCount = 0;

  const compiledSiteTopics = selectSiteTopicCompileRows(siteTopics);
  for (let index = 0; index < compiledSiteTopics.length; index += 1) {
    const item = compiledSiteTopics[index];
    const topicText = `${item.topicPath} ${item.displayTitle} ${item.summaryObjective}`;
    const topic = inferTopicFromFreeformText(topicText);
    const riskLevel = inferRiskLevel(topic, item.riskLevel);
    const serviceTags = extractServiceTags(topicText);
    const cardId = await insertCompiledCard(db, tenantKey, {
      cardKey: `site_topic:${item.topicKey || slugify(item.topicPath) || index + 1}`,
      topic,
      trade,
      serviceTags,
      title: item.displayTitle || item.topicPath,
      summary: truncateText(item.summaryObjective),
      usageNotes: "Use when the caller asks about this site-derived topic. Prefer this grounded summary over marketing phrasing.",
      metadata: {
        compiledFrom: "site_topic",
        siteTopicId: item.id,
        topicPath: item.topicPath,
        topicType: item.topicType
      }
    });
    runtimeCardCount += 1;
    compiledTopicCount += 1;

    const claims = splitIntoClaims(item.summaryObjective);
    for (let claimIndex = 0; claimIndex < claims.length; claimIndex += 1) {
      const claim = claims[claimIndex];
      const factId = await insertCompiledFact(db, tenantKey, {
        knowledgeEntryId: null,
        reviewStatus: "reviewed",
        sourceType: "site_topic_compiled",
        topic,
        trade,
        serviceTags,
        claim,
        evidenceText: item.summaryObjective,
        sourceUrl: item.sourceUrl,
        confidence: item.sourceConfidence ?? 0.8,
        riskLevel,
        metadata: {
          compiledFrom: "site_topic",
          siteTopicId: item.id,
          topicPath: item.topicPath
        }
      });
      runtimeFactCount += 1;
      await linkCardFact(db, cardId, factId, claimIndex, claimIndex === 0);
    }
  }

  for (let index = 0; index < knowledgeEntries.length; index += 1) {
    const entry = knowledgeEntries[index];
    const topic = inferTopic(entry.sectionType);
    const riskLevel = inferRiskLevel(topic);
    const serviceTags = extractServiceTags(`${entry.title} ${entry.contentText}`);
    const cardId = await insertCompiledCard(db, tenantKey, {
      cardKey: `entry:${entry.sectionType}:${entry.id || index + 1}`,
      topic,
      trade,
      serviceTags,
      title: entry.title || entry.sectionType,
      summary: truncateText(entry.contentText),
      usageNotes: "Use when the caller is asking about tenant-specific business details in this section.",
      metadata: {
        compiledFrom: "knowledge_entry",
        knowledgeEntryId: entry.id
      }
    });
    runtimeCardCount += 1;

    const claims = splitIntoClaims(entry.contentText);
    for (let claimIndex = 0; claimIndex < claims.length; claimIndex += 1) {
      const claim = claims[claimIndex];
      const factId = await insertCompiledFact(db, tenantKey, {
        knowledgeEntryId: entry.id ? Number(entry.id) : null,
        reviewStatus: "reviewed",
        sourceType: entry.sourceType || "manual_business_provided",
        topic,
        trade,
        serviceTags,
        claim,
        evidenceText: entry.contentText,
        sourceUrl: entry.sourceUrl,
        confidence: entry.sourceConfidence ?? (entry.sourceType ? 0.9 : 1),
        riskLevel,
        metadata: {
          compiledFrom: "knowledge_entry",
          sectionType: entry.sectionType
        }
      });
      runtimeFactCount += 1;
      await linkCardFact(db, cardId, factId, claimIndex, claimIndex === 0);
    }

    if (entry.id) {
      await db.query(
        `UPDATE knowledge_entries
         SET compilation_status = 'compiled',
             last_compiled_at = NOW(),
             updated_at = NOW()
         WHERE tenant_key = $1
           AND id = $2`,
        [tenantKey, Number(entry.id)]
      );
    }
  }

  for (let index = 0; index < guardrailQuestionTests.length; index += 1) {
    const item = guardrailQuestionTests[index];
    const topic = inferTopic(null, item.topic);
    const riskLevel = inferRiskLevel(topic, item.riskLevel);
    const serviceTags = Array.from(new Set([...(item.serviceTags || []), ...extractServiceTags(`${item.questionText} ${item.answer}`)]));
    const routeDecision = normalizeText(item.routeDecision) || null;

    const cardId = await insertCompiledCard(db, tenantKey, {
      cardKey: `guardrail:${slugify(item.questionText) || topic}:${item.id || index + 1}`,
      topic,
      trade,
      serviceTags,
      title: item.questionText,
      summary: truncateText(item.answer),
      usageNotes: "Use when the caller asks this high-risk question or a close variant of it.",
      metadata: {
        compiledFrom: "guardrail_question_test",
        guardrailQuestionId: item.id
      }
    });
    runtimeCardCount += 1;

    const factId = await insertCompiledFact(db, tenantKey, {
      knowledgeEntryId: null,
      reviewStatus: "reviewed",
      sourceType: item.sourceType || "approved_guardrail_answer",
      topic,
      trade,
      serviceTags,
      claim: item.answer,
      evidenceText: item.answer,
      sourceUrl: item.sourceUrl,
      confidence: item.sourceConfidence ?? 1,
      riskLevel,
      metadata: {
        compiledFrom: "guardrail_question_test",
        questionText: item.questionText
      }
    });
    runtimeFactCount += 1;
    await linkCardFact(db, cardId, factId, 0, true);

    if (routeDecision !== "guardrail") {
      const appliesWhen = buildAppliesWhenMetadata({
        kind: "override",
        topic,
        trade,
        serviceTags,
        triggerText: item.questionText,
        questionText: item.questionText,
        severity: riskLevel,
        routeDecision,
        compiledFrom: "guardrail_question_test"
      });
      await db.query(
        `INSERT INTO knowledge_overrides (tenant_key, status, topic, trade, service_tags, audience, trigger_text, preferred_answer, applies_when_json, source_feedback_event_id)
         VALUES ($1, 'active', $2, $3, $4::text[], 'general', $5, $6, $7::jsonb, $8)`,
        [
          tenantKey,
          topic,
          trade,
          serviceTags,
          item.questionText,
          item.answer,
          JSON.stringify(appliesWhen),
          item.sourceFeedbackEventId
        ]
      );
    }

    if (routeDecision !== "answer_override") {
      const appliesWhen = buildAppliesWhenMetadata({
        kind: "guardrail",
        topic,
        trade,
        serviceTags,
        questionText: item.questionText,
        instructionText: buildGeneratedGuardrailInstruction(item),
        severity: riskLevel,
        routeDecision,
        compiledFrom: "guardrail_question_test"
      });
      await db.query(
        `INSERT INTO knowledge_guardrails (tenant_key, status, rule_type, topic, trade, service_tags, severity, instruction_text, applies_when_json, source_feedback_event_id)
         VALUES ($1, 'active', 'approved_answer_scope', $2, $3, $4::text[], $5, $6, $7::jsonb, $8)`,
        [
          tenantKey,
          topic,
          trade,
          serviceTags,
          riskLevel,
          buildGeneratedGuardrailInstruction(item),
          JSON.stringify(appliesWhen),
          item.sourceFeedbackEventId
        ]
      );
    }

    if (item.id) {
      await db.query(
        `UPDATE guardrail_question_tests
         SET last_run_at = NOW(),
             last_run_confidence = $3,
             updated_at = NOW()
         WHERE tenant_key = $1
           AND id = $2`,
        [tenantKey, Number(item.id), item.sourceConfidence ?? 1]
      );
    }
  }

  await replaceCoverageChecklist(db, tenantKey, siteTopics, guardrailQuestionTests);

  return {
    compiledTopicCount,
    compiledEntryCount: knowledgeEntries.length,
    compiledGuardrailCount: guardrailQuestionTests.length,
    runtimeCardCount,
    runtimeFactCount
  };
}

export async function loadTenantKnowledgeAuthoring(db, tenantKey, options = {}) {
  const includeEmptyTemplates = options.includeEmptyTemplates !== false;
  const { entryRows, questionRows, topicRows, coverageRows } = await loadKnowledgeAuthoringRows(db, tenantKey);
  const [overrideRes, guardrailRes] = await Promise.all([
    db.query(
      `SELECT id, topic, trade, service_tags, audience, trigger_text, preferred_answer, updated_at, applies_when_json
       FROM knowledge_overrides
       WHERE tenant_key = $1
         AND status = 'active'
       ORDER BY updated_at DESC, id DESC`,
      [tenantKey]
    ),
    db.query(
      `SELECT id, rule_type, topic, trade, service_tags, severity, instruction_text, updated_at, applies_when_json
       FROM knowledge_guardrails
       WHERE tenant_key = $1
         AND status = 'active'
       ORDER BY updated_at DESC, id DESC`,
      [tenantKey]
    )
  ]);

  const knowledgeEntries = mergeKnowledgeEntries(entryRows, includeEmptyTemplates);
  const guardrailQuestionTests = mergeGuardrailQuestions(questionRows, includeEmptyTemplates);
  const siteTopics = (topicRows || []).map(mapSiteTopicRow);
  const coverageChecklist = (coverageRows || []).map(mapCoverageCheckRow);
  const overrides = (overrideRes.rows || []).map(mapKnowledgeOverrideRow);
  const guardrails = (guardrailRes.rows || []).map(mapKnowledgeGuardrailRow);

  const knowledgeEntryCount = knowledgeEntries.filter((entry) => normalizeText(entry.contentText)).length;
  const answeredGuardrailCount = guardrailQuestionTests.filter((item) => normalizeText(item.answer)).length;
  const unresolvedBlankGuardrailCount = guardrailQuestionTests.filter((item) => !normalizeText(item.answer)).length;

  return {
    knowledgeEntries,
    guardrailQuestionTests,
    siteTopics,
    coverageChecklist,
    overrides,
    guardrails,
    usageInstructions: [...DEFAULT_KNOWLEDGE_USAGE_INSTRUCTIONS],
    counts: {
      siteTopicCount: siteTopics.length,
      coverageCheckCount: coverageChecklist.length,
      knowledgeEntryCount,
      guardrailQuestionCount: guardrailQuestionTests.length,
      answeredGuardrailCount,
      unresolvedBlankGuardrailCount
    }
  };
}

export async function loadTenantKnowledgeRuntime(db, tenantKey) {
  async function queryRuntime() {
    const [cardFactRes, overrideRes, guardrailRes, standaloneFactsRes] = await Promise.all([
      db.query(
        `SELECT
           c.id AS card_id,
           c.card_key,
           c.topic AS card_topic,
           c.trade AS card_trade,
           c.service_tags AS card_service_tags,
           c.audience,
           c.title,
           c.summary,
           c.usage_notes,
           c.updated_at AS card_updated_at,
           f.id AS fact_id,
           f.topic,
           f.trade,
           f.service_tags,
           f.claim,
           f.evidence_text,
           f.source_url,
           f.confidence,
           f.risk_level,
           f.source_type,
           f.review_status,
           kcf.fact_rank,
           kcf.required
         FROM knowledge_cards c
         LEFT JOIN knowledge_card_facts kcf
           ON kcf.card_id = c.id
         LEFT JOIN knowledge_facts f
           ON f.id = kcf.fact_id
         WHERE c.tenant_key = $1
           AND c.status = 'active'
         ORDER BY c.updated_at DESC, c.id DESC, kcf.fact_rank ASC, f.id ASC`,
        [tenantKey]
      ),
      db.query(
        `SELECT id, topic, trade, service_tags, audience, trigger_text, preferred_answer, updated_at, applies_when_json
         FROM knowledge_overrides
         WHERE tenant_key = $1
           AND status = 'active'
         ORDER BY updated_at DESC, id DESC`,
        [tenantKey]
      ),
      db.query(
        `SELECT id, rule_type, topic, trade, service_tags, severity, instruction_text, updated_at, applies_when_json
         FROM knowledge_guardrails
         WHERE tenant_key = $1
           AND status = 'active'
         ORDER BY updated_at DESC, id DESC`,
        [tenantKey]
      ),
      db.query(
        `SELECT id, topic, trade, service_tags, claim, evidence_text, source_url, confidence, risk_level, source_type, review_status
         FROM knowledge_facts
         WHERE tenant_key = $1
           AND status = 'active'
         ORDER BY updated_at DESC, id DESC`,
        [tenantKey]
      )
    ]);
    return { cardFactRes, overrideRes, guardrailRes, standaloneFactsRes };
  }

  let { cardFactRes, overrideRes, guardrailRes, standaloneFactsRes } = await queryRuntime();
  if ((cardFactRes.rows || []).length === 0 && (standaloneFactsRes.rows || []).length === 0) {
    const authoring = await loadTenantKnowledgeAuthoring(db, tenantKey, { includeEmptyTemplates: false });
    if (
      (authoring.counts?.siteTopicCount || 0) > 0
      || (authoring.counts?.knowledgeEntryCount || 0) > 0
      || (authoring.counts?.answeredGuardrailCount || 0) > 0
    ) {
      await compileTenantKnowledge(db, tenantKey);
      ({ cardFactRes, overrideRes, guardrailRes, standaloneFactsRes } = await queryRuntime());
    }
  }

  const cardMap = new Map();
  for (const row of cardFactRes.rows || []) {
    const cardId = String(row.card_id);
    if (!cardMap.has(cardId)) {
      cardMap.set(cardId, {
        id: cardId,
        cardKey: normalizeText(row.card_key),
        topic: normalizeText(row.card_topic) || null,
        trade: normalizeText(row.card_trade) || null,
        serviceTags: Array.isArray(row.card_service_tags) ? row.card_service_tags.filter(Boolean) : [],
        audience: normalizeText(row.audience) || "general",
        title: normalizeText(row.title),
        summary: normalizeText(row.summary),
        usageNotes: normalizeText(row.usage_notes) || null,
        facts: []
      });
    }
    if (row.fact_id) {
      const card = cardMap.get(cardId);
      card.facts.push({
        ...mapRuntimeFactRow(row),
        required: Boolean(row.required),
        factRank: Number(row.fact_rank || 0)
      });
    }
  }

  const cards = Array.from(cardMap.values());
  const factMap = new Map();
  for (const row of standaloneFactsRes.rows || []) {
    const fact = mapRuntimeFactRow(row);
    factMap.set(fact.id, fact);
  }
  for (const card of cards) {
    for (const fact of card.facts) {
      factMap.set(fact.id, {
        id: fact.id,
        topic: fact.topic,
        trade: fact.trade,
        serviceTags: fact.serviceTags,
        claim: fact.claim,
        evidenceText: fact.evidenceText,
        sourceUrl: fact.sourceUrl,
        confidence: fact.confidence,
        riskLevel: fact.riskLevel,
        sourceType: fact.sourceType,
        reviewStatus: fact.reviewStatus
      });
    }
  }

  return {
    cards,
    facts: Array.from(factMap.values()),
    overrides: (overrideRes.rows || []).map(mapKnowledgeOverrideRow),
    guardrails: (guardrailRes.rows || []).map(mapKnowledgeGuardrailRow),
    usageInstructions: [...DEFAULT_KNOWLEDGE_USAGE_INSTRUCTIONS],
    counts: {
      runtimeCardCount: cards.length,
      runtimeFactCount: factMap.size
    }
  };
}

export async function loadTenantKnowledgeFeedbackEvents(db, tenantKey, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.min(50, Number(options.limit))) : 12;
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
            created_at,
            updated_at
     FROM knowledge_feedback_events
     WHERE tenant_key = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [tenantKey, limit]
  );
  return (result.rows || []).map(mapKnowledgeFeedbackEventRow);
}

export async function loadTenantKnowledge(db, tenantKey, options = {}) {
  return loadTenantKnowledgeAuthoring(db, tenantKey, options);
}
