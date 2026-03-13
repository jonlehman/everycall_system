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
    updatedAt: row.updated_at || null
  };
}

function mapKnowledgeOverrideRow(row) {
  return {
    id: String(row.id),
    topic: normalizeText(row.topic) || null,
    trade: normalizeText(row.trade) || null,
    serviceTags: Array.isArray(row.service_tags) ? row.service_tags.filter(Boolean) : [],
    audience: normalizeText(row.audience) || "general",
    triggerText: normalizeText(row.trigger_text) || null,
    preferredAnswer: normalizeText(row.preferred_answer),
    updatedAt: row.updated_at || null
  };
}

function mapKnowledgeGuardrailRow(row) {
  return {
    id: String(row.id),
    ruleType: normalizeText(row.rule_type) || "general",
    topic: normalizeText(row.topic) || null,
    trade: normalizeText(row.trade) || null,
    serviceTags: Array.isArray(row.service_tags) ? row.service_tags.filter(Boolean) : [],
    severity: normalizeText(row.severity) || "high",
    instructionText: normalizeText(row.instruction_text),
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
        updatedAt: null
      };
    }),
    ...extras
  ];
}

export async function loadTenantKnowledge(pool, tenantKey, options = {}) {
  const includeEmptyTemplates = options.includeEmptyTemplates !== false;

  const [entryRes, questionRes, overrideRes, guardrailRes] = await Promise.all([
    pool.query(
      `SELECT id, entry_type, section_type, title, content_text, source_url, compilation_status, metadata_json, updated_at
       FROM knowledge_entries
       WHERE tenant_key = $1
       ORDER BY updated_at DESC, id DESC`,
      [tenantKey]
    ),
    pool.query(
      `SELECT id, topic, question_text, risk_level, draft_answer, approved_answer, review_status, supporting_artifacts_json, updated_at
       FROM guardrail_question_tests
       WHERE tenant_key = $1
         AND status = 'active'
       ORDER BY updated_at DESC, id DESC`,
      [tenantKey]
    ),
    pool.query(
      `SELECT id, topic, trade, service_tags, audience, trigger_text, preferred_answer, updated_at
       FROM knowledge_overrides
       WHERE tenant_key = $1
         AND status = 'active'
       ORDER BY updated_at DESC, id DESC`,
      [tenantKey]
    ),
    pool.query(
      `SELECT id, rule_type, topic, trade, service_tags, severity, instruction_text, updated_at
       FROM knowledge_guardrails
       WHERE tenant_key = $1
         AND status = 'active'
       ORDER BY updated_at DESC, id DESC`,
      [tenantKey]
    )
  ]);

  const knowledgeEntries = mergeKnowledgeEntries(entryRes.rows || [], includeEmptyTemplates);
  const guardrailQuestionTests = mergeGuardrailQuestions(questionRes.rows || [], includeEmptyTemplates);
  const overrides = (overrideRes.rows || []).map(mapKnowledgeOverrideRow);
  const guardrails = (guardrailRes.rows || []).map(mapKnowledgeGuardrailRow);

  const knowledgeEntryCount = knowledgeEntries.filter((entry) => normalizeText(entry.contentText)).length;
  const answeredGuardrailCount = guardrailQuestionTests.filter((item) => normalizeText(item.answer)).length;
  const unresolvedBlankGuardrailCount = guardrailQuestionTests.filter((item) => !normalizeText(item.answer)).length;

  return {
    knowledgeEntries,
    guardrailQuestionTests,
    overrides,
    guardrails,
    usageInstructions: [...DEFAULT_KNOWLEDGE_USAGE_INSTRUCTIONS],
    counts: {
      knowledgeEntryCount,
      guardrailQuestionCount: guardrailQuestionTests.length,
      answeredGuardrailCount,
      unresolvedBlankGuardrailCount
    }
  };
}

