import crypto from "node:crypto";
import { z } from "zod";
import { callOpenAiJsonModel, embedOpenAiTexts } from "@everycall/contracts";

function normalizeText(value) {
  return String(value || "").trim();
}

const BUILD_PROGRESS_LOG_ENABLED = ["1", "true", "yes", "on"].includes(String(process.env.KNOWLEDGE_BUILD_PROGRESS_LOG || "").trim().toLowerCase());

function logCompilerProgress(event, details = {}) {
  if (!BUILD_PROGRESS_LOG_ENABLED) return;
  try {
    console.error(`build_progress:${event}:${JSON.stringify(details)}`);
  } catch {
    console.error(`build_progress:${event}`);
  }
}

function cleanLine(value) {
  return normalizeText(String(value || "").replace(/\s+/g, " "));
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringList(value, fallbackText = "") {
  return uniqueValues([
    ...asArray(value).map((item) => normalizeText(typeof item === "string" ? item : item?.text || item?.name || item?.label)),
    fallbackText
  ].filter(Boolean));
}

function deriveFactKey(value, index) {
  const text = normalizeText(value?.fact_key || value?.key || value?.id || value?.claim_text || value?.text || `fact_${index + 1}`);
  return slugify(text) || `fact_${index + 1}`;
}

function looksGenericCardName(value) {
  return /^(card|answer unit|item)\s+\d+$/i.test(normalizeText(value));
}

function deriveSpecificCardName({ canonicalName, summary, topicName, subtopicName }) {
  const preferred = normalizeText(subtopicName || topicName);
  if (preferred) return preferred;
  const summaryText = normalizeText(summary);
  if (!summaryText) return normalizeText(canonicalName);
  const sentence = summaryText.split(/[.!?]/)[0] || summaryText;
  const tokens = sentence
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9&/-]+/g, ""))
    .filter(Boolean)
    .slice(0, 8);
  return normalizeText(tokens.join(" ")) || normalizeText(canonicalName);
}

function titleCaseWords(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function contextualizeEnumeratedCardName(item, topicName, subtopicName) {
  const baseName = titleCaseWords(item);
  let contextLabel = titleCaseWords(subtopicName || "");
  if (!contextLabel || normalizeText(contextLabel).toLowerCase() === normalizeText(baseName).toLowerCase()) {
    contextLabel = titleCaseWords(topicName);
  }
  if (!baseName || !contextLabel) return baseName;
  const baseTokens = new Set(tokenizeMeaningfulWords(baseName));
  const contextTokens = tokenizeMeaningfulWords(contextLabel);
  if (contextTokens.some((token) => baseTokens.has(token))) {
    return baseName;
  }
  if (baseName.split(/\s+/).length <= 4) {
    return truncateText(`${baseName} ${contextLabel}`, 96);
  }
  return baseName;
}

function normalizeCandidateSubtopic(value, index = 0) {
  if (typeof value === "string") {
    return {
      subtopic_name: normalizeText(value),
      description: normalizeText(value),
      aliases: []
    };
  }
  const item = asObject(value);
  const name = normalizeText(item.subtopic_name || item.name || item.title || item.topic || item.label || `Subtopic ${index + 1}`);
  return {
    subtopic_name: name,
    description: normalizeText(item.description || item.summary || item.rationale || name),
    aliases: normalizeStringList(item.aliases || item.alt_names || item.synonyms)
  };
}

function normalizeCandidateTopic(value, index = 0) {
  if (typeof value === "string") {
    return {
      topic_name: normalizeText(value),
      description: normalizeText(value),
      aliases: [],
      subtopics: []
    };
  }
  const item = asObject(value);
  const name = normalizeText(item.topic_name || item.name || item.title || item.topic || item.label || `Topic ${index + 1}`);
  const rawSubtopics = item.subtopics || item.candidate_subtopics || item.children || item.items || [];
  return {
    topic_name: name,
    description: normalizeText(item.description || item.summary || item.rationale || name),
    aliases: normalizeStringList(item.aliases || item.alt_names || item.synonyms),
    subtopics: asArray(rawSubtopics)
      .map((entry, entryIndex) => normalizeCandidateSubtopic(entry, entryIndex))
      .filter((entry) => entry.subtopic_name)
      .slice(0, 8)
  };
}

function normalizeTopicInventoryInput(value) {
  const root = Array.isArray(value) ? { topics: value } : asObject(value);
  const rawTopics = root.topics || root.inventory || root.items || root.categories || [];
  return {
    topics: asArray(rawTopics)
      .map((entry, index) => normalizeCandidateTopic(entry, index))
      .filter((entry) => entry.topic_name)
      .slice(0, 20)
  };
}

function normalizeSummaryCandidateTopic(value, index = 0) {
  if (typeof value === "string") {
    return {
      topic_name: normalizeText(value),
      description: normalizeText(value),
      candidate_subtopics: []
    };
  }
  const item = asObject(value);
  const name = normalizeText(item.topic_name || item.name || item.title || item.topic || `Topic ${index + 1}`);
  const rawSubtopics = item.candidate_subtopics || item.subtopics || item.children || item.items || [];
  return {
    topic_name: name,
    description: normalizeText(item.description || item.summary || item.rationale || name),
    candidate_subtopics: asArray(rawSubtopics)
      .map((entry, entryIndex) => normalizeCandidateSubtopic(entry, entryIndex))
      .filter((entry) => entry.subtopic_name)
      .slice(0, 8)
  };
}

function normalizeSourceSummaryInput(value) {
  const root = asObject(value);
  const rawTopics = root.candidate_topics || root.topics || root.topic_candidates || [];
  const candidateTopics = asArray(rawTopics)
    .map((entry, index) => normalizeSummaryCandidateTopic(entry, index))
    .filter((entry) => entry.topic_name)
    .slice(0, 8);
  const answerableUnits = normalizeStringList(root.answerable_units || root.cards || root.answer_units);
  const questionForms = normalizeStringList(root.question_forms || root.sample_questions || root.common_questions);
  const notableBoundaries = normalizeStringList(root.notable_boundaries || root.boundaries || root.limitations);
  const summary = normalizeText(root.summary || root.overview || root.description || root.synopsis)
    || truncateText([
      candidateTopics.map((entry) => `${entry.topic_name}: ${entry.description}`).join(" "),
      answerableUnits.join(" "),
      notableBoundaries.join(" ")
    ].filter(Boolean).join(" "), 500)
    || "Approved source content captured for build-time compilation.";
  return {
    summary,
    candidate_topics: candidateTopics,
    answerable_units: answerableUnits,
    question_forms: questionForms,
    notable_boundaries: notableBoundaries
  };
}

function normalizeArtifactCard(value, index = 0) {
  const item = asObject(value);
  const rawCanonicalName = normalizeText(item.canonical_name || item.name || item.title || item.card_name || `Card ${index + 1}`);
  const topicName = normalizeText(item.topic_name || item.topic || item.primary_topic || "Business Information");
  const subtopicName = normalizeText(item.subtopic_name || item.subtopic || item.secondary_topic || "") || null;
  const summary = normalizeText(item.summary || item.description || item.answer || rawCanonicalName);
  const canonicalName = looksGenericCardName(rawCanonicalName)
    ? deriveSpecificCardName({ canonicalName: rawCanonicalName, summary, topicName, subtopicName })
    : rawCanonicalName;
  return {
    canonical_name: canonicalName,
    card_role: normalizeText(item.card_role || item.role || item.type || "answer_unit"),
    topic_name: topicName,
    subtopic_name: subtopicName,
    summary,
    support_summary: normalizeText(item.support_summary || item.support || item.summary || item.description || canonicalName),
    aliases: normalizeStringList(item.aliases || item.alt_names || item.synonyms),
    caller_phrases: normalizeStringList(item.caller_phrases || item.question_forms || item.query_examples),
    source_chunk_ids: normalizeStringList(item.source_chunk_ids || item.chunk_ids || item.source_chunk_indices || item.chunk_indices || item.chunks),
    supporting_fact_keys: normalizeStringList(item.supporting_fact_keys || item.fact_keys || item.supporting_facts)
  };
}

function normalizeArtifactFact(value, index = 0) {
  const item = asObject(value);
  const claimText = normalizeText(item.claim_text || item.text || item.claim || item.statement || "");
  return {
    fact_key: deriveFactKey(item, index),
    fact_role: normalizeText(item.fact_role || item.role || item.type || "detail"),
    topic_name: normalizeText(item.topic_name || item.topic || item.primary_topic || "Business Information"),
    subtopic_name: normalizeText(item.subtopic_name || item.subtopic || item.secondary_topic || "") || null,
    claim_text: claimText,
    support_type: normalizeText(item.support_type || item.type || item.support || "source_backed"),
    qualifiers: normalizeStringList(item.qualifiers || item.qualifier_notes || item.conditions),
    boundary_notes: normalizeStringList(item.boundary_notes || item.boundaries || item.limits || item.exclusions),
    next_steps: normalizeStringList(item.next_steps || item.process_steps || item.follow_up || item.actions),
    source_chunk_ids: normalizeStringList(item.source_chunk_ids || item.chunk_ids || item.source_chunk_indices || item.chunk_indices || item.chunks)
  };
}

function normalizeSourceArtifactsInput(value) {
  const root = asObject(value);
  const rawCards = root.cards || root.answer_units || root.card_units || [];
  const rawFacts = root.facts || root.supporting_facts || root.details || [];
  return {
    cards: asArray(rawCards)
      .map((entry, index) => normalizeArtifactCard(entry, index))
      .filter((entry) => entry.canonical_name && entry.summary)
      .slice(0, 12),
    facts: asArray(rawFacts)
      .map((entry, index) => normalizeArtifactFact(entry, index))
      .filter((entry) => entry.claim_text)
      .slice(0, 48)
  };
}

function normalizeSourceSummaryBatchInput(value) {
  const root = asObject(value);
  return {
    items: asArray(root.items || root.results || root.sources)
      .map((entry) => {
        const item = asObject(entry);
        return {
          source_ref_id: normalizeText(item.source_ref_id || item.sourceRefId || item.id),
          ...normalizeSourceSummaryInput(item)
        };
      })
      .filter((entry) => entry.source_ref_id)
  };
}

function normalizeSourceArtifactBatchInput(value) {
  const root = asObject(value);
  return {
    items: asArray(root.items || root.results || root.sources)
      .map((entry) => {
        const item = asObject(entry);
        return {
          source_ref_id: normalizeText(item.source_ref_id || item.sourceRefId || item.id),
          ...normalizeSourceArtifactsInput(item)
        };
      })
      .filter((entry) => entry.source_ref_id)
  };
}

const SOURCE_SUMMARY_SCHEMA = z.object({
  summary: z.string().min(1),
  candidate_topics: z.array(z.object({
    topic_name: z.string().min(1),
    description: z.string().min(1),
    candidate_subtopics: z.array(z.object({
      subtopic_name: z.string().min(1),
      description: z.string().min(1)
    })).default([])
  })).max(8).default([]),
  answerable_units: z.array(z.string().min(1)).default([]),
  question_forms: z.array(z.string().min(1)).default([]),
  notable_boundaries: z.array(z.string().min(1)).default([])
});

const NORMALIZED_SOURCE_SUMMARY_SCHEMA = z.preprocess(
  normalizeSourceSummaryInput,
  SOURCE_SUMMARY_SCHEMA
);

const SOURCE_SUMMARY_BATCH_SCHEMA = z.object({
  items: z.array(z.object({
    source_ref_id: z.string().min(1),
    summary: z.string().min(1),
    candidate_topics: z.array(z.object({
      topic_name: z.string().min(1),
      description: z.string().min(1),
      candidate_subtopics: z.array(z.object({
        subtopic_name: z.string().min(1),
        description: z.string().min(1)
      })).default([])
    })).max(8).default([]),
    answerable_units: z.array(z.string().min(1)).default([]),
    question_forms: z.array(z.string().min(1)).default([]),
    notable_boundaries: z.array(z.string().min(1)).default([])
  })).default([])
});

const NORMALIZED_SOURCE_SUMMARY_BATCH_SCHEMA = z.preprocess(
  normalizeSourceSummaryBatchInput,
  SOURCE_SUMMARY_BATCH_SCHEMA
);

const TOPIC_INVENTORY_SCHEMA = z.object({
  topics: z.array(z.object({
    topic_name: z.string().min(1),
    description: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    subtopics: z.array(z.object({
      subtopic_name: z.string().min(1),
      description: z.string().min(1),
      aliases: z.array(z.string().min(1)).default([])
    })).default([])
  })).max(20).default([])
});

const NORMALIZED_TOPIC_INVENTORY_SCHEMA = z.preprocess(
  normalizeTopicInventoryInput,
  TOPIC_INVENTORY_SCHEMA
);

const SOURCE_ARTIFACT_SCHEMA = z.object({
  cards: z.array(z.object({
    canonical_name: z.string().min(1),
    card_role: z.string().min(1),
    topic_name: z.string().min(1),
    subtopic_name: z.string().min(1).nullable().optional(),
    summary: z.string().min(1),
    support_summary: z.string().min(1).optional(),
    aliases: z.array(z.string().min(1)).default([]),
    caller_phrases: z.array(z.string().min(1)).default([]),
    source_chunk_ids: z.array(z.string().min(1)).default([]),
    supporting_fact_keys: z.array(z.string().min(1)).default([])
  })).max(12).default([]),
  facts: z.array(z.object({
    fact_key: z.string().min(1),
    fact_role: z.string().min(1),
    topic_name: z.string().min(1),
    subtopic_name: z.string().min(1).nullable().optional(),
    claim_text: z.string().min(1),
    support_type: z.string().min(1),
    qualifiers: z.array(z.string().min(1)).default([]),
    boundary_notes: z.array(z.string().min(1)).default([]),
    next_steps: z.array(z.string().min(1)).default([]),
    source_chunk_ids: z.array(z.string().min(1)).default([])
  })).max(48).default([])
});

const NORMALIZED_SOURCE_ARTIFACT_SCHEMA = z.preprocess(
  normalizeSourceArtifactsInput,
  SOURCE_ARTIFACT_SCHEMA
);

const SOURCE_ARTIFACT_BATCH_SCHEMA = z.object({
  items: z.array(z.object({
    source_ref_id: z.string().min(1),
    cards: SOURCE_ARTIFACT_SCHEMA.shape.cards,
    facts: SOURCE_ARTIFACT_SCHEMA.shape.facts
  })).default([])
});

const NORMALIZED_SOURCE_ARTIFACT_BATCH_SCHEMA = z.preprocess(
  normalizeSourceArtifactBatchInput,
  SOURCE_ARTIFACT_BATCH_SCHEMA
);

function readPositiveIntEnv(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const CHUNK_SOFT_CHAR_LIMIT = readPositiveIntEnv("KNOWLEDGE_BUILD_CHUNK_SOFT_CHAR_LIMIT", 1200);
const CHUNK_HARD_CHAR_LIMIT = readPositiveIntEnv("KNOWLEDGE_BUILD_CHUNK_HARD_CHAR_LIMIT", 1800);
const SOURCE_SUMMARY_BATCH_TOKEN_BUDGET = readPositiveIntEnv("KNOWLEDGE_BUILD_SOURCE_SUMMARY_BATCH_TOKENS", 18000);
const SOURCE_SUMMARY_BATCH_CONCURRENCY = readPositiveIntEnv("KNOWLEDGE_BUILD_SOURCE_SUMMARY_BATCH_CONCURRENCY", 2);
const SOURCE_SUMMARY_BATCH_MAX_ITEMS = readPositiveIntEnv("KNOWLEDGE_BUILD_SOURCE_SUMMARY_BATCH_MAX_ITEMS", 12);
const SOURCE_SUMMARY_RESPONSE_TOKENS = readPositiveIntEnv("KNOWLEDGE_BUILD_SOURCE_SUMMARY_RESPONSE_TOKENS", 4200);
const TOPIC_WINDOW_TOKEN_BUDGET = readPositiveIntEnv("KNOWLEDGE_BUILD_TOPIC_WINDOW_TOKENS", 18000);
const TOPIC_WINDOW_MAX_ITEMS = readPositiveIntEnv("KNOWLEDGE_BUILD_TOPIC_WINDOW_MAX_ITEMS", 24);
const TOPIC_WINDOW_RESPONSE_TOKENS = readPositiveIntEnv("KNOWLEDGE_BUILD_TOPIC_WINDOW_RESPONSE_TOKENS", 2600);
const SOURCE_ARTIFACT_BATCH_TOKEN_BUDGET = readPositiveIntEnv("KNOWLEDGE_BUILD_SOURCE_ARTIFACT_BATCH_TOKENS", 22000);
const SOURCE_ARTIFACT_BATCH_CONCURRENCY = readPositiveIntEnv("KNOWLEDGE_BUILD_SOURCE_ARTIFACT_BATCH_CONCURRENCY", 2);
const SOURCE_ARTIFACT_BATCH_MAX_ITEMS = readPositiveIntEnv("KNOWLEDGE_BUILD_SOURCE_ARTIFACT_BATCH_MAX_ITEMS", 8);
const SOURCE_ARTIFACT_RESPONSE_TOKENS = readPositiveIntEnv("KNOWLEDGE_BUILD_SOURCE_ARTIFACT_RESPONSE_TOKENS", 6200);
const MAX_COMPILE_SOURCE_RECORDS = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_COMPILE_SOURCES", 24);
const MAX_COMPILE_BLOG_SOURCE_RECORDS = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_COMPILE_BLOG_SOURCES", 2);
const MAX_COMPILE_UNKNOWN_WEBSITE_PAGE_RECORDS = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_COMPILE_UNKNOWN_WEBSITE_PAGES", 4);
const MAX_COMPILE_CONTACT_PAGE_RECORDS = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_COMPILE_CONTACT_PAGES", 2);
const MAX_COMPILE_SERVICE_AREA_PAGE_RECORDS = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_COMPILE_SERVICE_AREA_PAGES", 3);

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function truncateText(value, limit = 320) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function compileSourcePathDepth(sourceLocator) {
  try {
    return new URL(sourceLocator).pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
}

function compileSourceRecordScore(record, index = 0) {
  const sourceItem = record?.sourceItem || {};
  const sourceChannel = normalizeText(sourceItem.sourceChannel);
  const pageType = normalizeText(sourceItem.pageType) || "unknown_mixed";
  const sourceAuthority = normalizeText(sourceItem.sourceAuthority);
  const contentClass = normalizeText(sourceItem.contentClass) || "operational_core";
  const locator = normalizeText(sourceItem.sourceLocator);

  const channelScore = {
    owner_interview: 220,
    uploaded_document: 180,
    website_file: 150,
    website_page: 120
  }[sourceChannel] || 100;

  const pageTypeScore = {
    home: 120,
    service_detail: 115,
    faq: 110,
    policy: 108,
    process: 104,
    hours: 100,
    contact: 96,
    service_area: 92,
    unknown_mixed: 55,
    blog_article: 20
  }[pageType] || 70;

  const authorityScore = {
    owner_interview_confirmed: 35,
    uploaded_first_party_policy: 28,
    uploaded_first_party_operational: 24,
    website_public_downloadable: 18,
    website_public_page: 12,
    uploaded_first_party_reference: 10,
    owner_interview_unconfirmed: 6
  }[sourceAuthority] || 0;

  const contentClassScore = {
    operational_core: 18,
    policy_boundary: 16,
    descriptive: 6,
    educational: -10,
    marketing: -14
  }[contentClass] || 0;

  let rootBonus = 0;
  try {
    const url = new URL(locator);
    if (url.pathname === "/" || url.pathname === "") {
      rootBonus = 18;
    }
  } catch {
    rootBonus = 0;
  }

  return channelScore
    + pageTypeScore
    + authorityScore
    + contentClassScore
    + rootBonus
    - (compileSourcePathDepth(locator) * 0.5)
    - (index * 0.001);
}

function selectSourceCompileRecords(sourceRecords, warnings) {
  const records = Array.isArray(sourceRecords) ? sourceRecords : [];
  if (!records.length) return [];

  const compileEnabledRecords = records.filter((record) => record?.sourceItem?.compileEnabled !== false);
  if (compileEnabledRecords.length <= MAX_COMPILE_SOURCE_RECORDS) {
    if (compileEnabledRecords.length !== records.length) {
      warnings.push(`compile_disabled_sources_skipped:${compileEnabledRecords.length}_of_${records.length}`);
    }
    return compileEnabledRecords;
  }

  const pageTypeCaps = {
    blog_article: MAX_COMPILE_BLOG_SOURCE_RECORDS,
    unknown_mixed: MAX_COMPILE_UNKNOWN_WEBSITE_PAGE_RECORDS,
    contact: MAX_COMPILE_CONTACT_PAGE_RECORDS,
    service_area: MAX_COMPILE_SERVICE_AREA_PAGE_RECORDS
  };
  const selected = [];
  const deferred = [];
  const pageTypeCounts = new Map();
  const ranked = compileEnabledRecords
    .map((record, index) => ({
      record,
      score: compileSourceRecordScore(record, index),
      pageType: normalizeText(record?.sourceItem?.pageType) || "unknown_mixed",
      sourceChannel: normalizeText(record?.sourceItem?.sourceChannel)
    }))
    .sort((left, right) => right.score - left.score);

  for (const entry of ranked) {
    if (selected.length >= MAX_COMPILE_SOURCE_RECORDS) break;
    if (entry.sourceChannel === "website_page") {
      const cap = pageTypeCaps[entry.pageType];
      const currentCount = Number(pageTypeCounts.get(entry.pageType) || 0);
      if (cap && currentCount >= cap) {
        deferred.push(entry);
        continue;
      }
      pageTypeCounts.set(entry.pageType, currentCount + 1);
    }
    selected.push(entry);
  }

  if (selected.length < MAX_COMPILE_SOURCE_RECORDS) {
    for (const entry of deferred) {
      if (selected.length >= MAX_COMPILE_SOURCE_RECORDS) break;
      selected.push(entry);
    }
  }

  const selectedRecords = selected.map((entry) => entry.record);
  const droppedCount = compileEnabledRecords.length - selectedRecords.length;
  if (records.length !== compileEnabledRecords.length) {
    warnings.push(`compile_disabled_sources_skipped:${compileEnabledRecords.length}_of_${records.length}`);
  }
  if (droppedCount > 0) {
    warnings.push(`compile_source_budget_applied:${selectedRecords.length}_of_${compileEnabledRecords.length}`);
    const selectedPageTypeCounts = {};
    for (const entry of selected) {
      if (entry.sourceChannel !== "website_page") continue;
      selectedPageTypeCounts[entry.pageType] = Number(selectedPageTypeCounts[entry.pageType] || 0) + 1;
    }
    logCompilerProgress("compiler_source_selection_applied", {
      totalSourceCount: records.length,
      compileEnabledSourceCount: compileEnabledRecords.length,
      selectedSourceCount: selectedRecords.length,
      droppedSourceCount: droppedCount,
      selectedWebsitePageTypeCounts: selectedPageTypeCounts
    });
  }

  return selectedRecords;
}

function buildCallerPhrases(title, lines) {
  const phrases = [];
  if (title) phrases.push(title);
  for (const line of lines || []) {
    const trimmed = truncateText(line, 80);
    if (trimmed) phrases.push(trimmed);
    if (phrases.length >= 5) break;
  }
  return uniqueValues(phrases).slice(0, 5);
}

function buildDirectQuestionPhrases(baseName, variants = []) {
  const name = normalizeText(baseName);
  if (!name) return [];
  return uniqueValues([
    `How does ${name} work?`,
    `What is ${name}?`,
    `Tell me about ${name}.`,
    ...variants
  ]).slice(0, 6);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function estimateTokenCount(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4);
}

export function buildSourceChunksForSourceItem(sourceItem, sourceRefId, buildInfo) {
  const lines = Array.isArray(sourceItem.lines) ? sourceItem.lines.map(cleanLine).filter(Boolean) : [];
  const chunks = [];
  let currentLines = [];
  let currentChars = 0;
  let chunkIndex = 0;
  const headingPath = Array.isArray(sourceItem.headings) ? sourceItem.headings.map(cleanLine).filter(Boolean).join(" > ") : null;

  function flushChunk() {
    if (!currentLines.length) return;
    const textSpan = currentLines.join(" ");
    const contentHash = stableHash(textSpan);
    chunks.push({
      source_chunk_id: `sch_${stableHash(`${buildInfo.build_id}|${sourceRefId}|${chunkIndex}|${contentHash}`).slice(0, 24)}`,
      tenant_key: buildInfo.tenant_key,
      build_id: buildInfo.build_id,
      source_ref_id: sourceRefId,
      chunk_index: chunkIndex,
      chunk_kind: "content_block",
      section_title: currentLines[0]?.slice(0, 120) || sourceItem.title || null,
      heading_path: headingPath || null,
      text_span: textSpan,
      token_estimate: estimateTokenCount(textSpan),
      content_hash: contentHash,
      metadata_json: {
        source_locator: sourceItem.sourceLocator,
        source_channel: sourceItem.sourceChannel,
        page_type: sourceItem.pageType,
        content_class: sourceItem.contentClass
      }
    });
    currentLines = [];
    currentChars = 0;
    chunkIndex += 1;
  }

  for (const line of lines) {
    if (!line) continue;
    const nextChars = currentChars + line.length + 1;
    if (currentLines.length && (nextChars > CHUNK_SOFT_CHAR_LIMIT || currentLines.length >= 5)) {
      flushChunk();
    }
    currentLines.push(line);
    currentChars += line.length + 1;
    if (currentChars >= CHUNK_HARD_CHAR_LIMIT) {
      flushChunk();
    }
  }
  flushChunk();

  if (!chunks.length && normalizeText(sourceItem.text)) {
    const textSpan = truncateText(sourceItem.text, CHUNK_HARD_CHAR_LIMIT);
    const contentHash = stableHash(textSpan);
    chunks.push({
      source_chunk_id: `sch_${stableHash(`${buildInfo.build_id}|${sourceRefId}|0|${contentHash}`).slice(0, 24)}`,
      tenant_key: buildInfo.tenant_key,
      build_id: buildInfo.build_id,
      source_ref_id: sourceRefId,
      chunk_index: 0,
      chunk_kind: "content_block",
      section_title: sourceItem.title || null,
      heading_path: headingPath || null,
      text_span: textSpan,
      token_estimate: estimateTokenCount(textSpan),
      content_hash: contentHash,
      metadata_json: {
        source_locator: sourceItem.sourceLocator,
        source_channel: sourceItem.sourceChannel,
        page_type: sourceItem.pageType,
        content_class: sourceItem.contentClass
      }
    });
  }

  return chunks;
}

function buildSourceSummarySystemPrompt() {
  return [
    "You are a build-time knowledge compiler for a business receptionist system.",
    "You will receive multiple source items in one request.",
    "Return strict JSON only with one result item per source_ref_id.",
    "Read each source item independently and do not merge or blend items together.",
    "Do not invent details not supported by a source item.",
    "Preserve applicability, exclusions, limits, scope, process, next-step, and ambiguity when present.",
    "Always provide a non-empty summary for each source item.",
    "Summaries should support later topic inventory generation."
  ].join("\n");
}

function buildSourceSummaryUserPrompt(batchItems) {
  return JSON.stringify({
    items: batchItems,
    output_contract: {
      one_result_per_source_ref_id: true,
      candidate_topics_max: 8,
      capture_question_forms: true,
      capture_boundaries: true,
      source_ref_id_required: true
    }
  });
}

function buildTopicInventorySystemPrompt() {
  return [
    "You are creating a build-time topic and subtopic inventory for a business knowledge corpus.",
    "You will receive a token-budgeted summary window from the source corpus.",
    "Return strict JSON only.",
    "Topics should organize the corpus for later card and fact extraction.",
    "Do not invent information not present in the source summaries.",
    "Do not create a relationship graph.",
    "Keep topics broad enough to group related knowledge, and subtopics specific enough to support retrieval."
  ].join("\n");
}

function buildTopicInventoryUserPrompt(windowId, summaryWindow) {
  return JSON.stringify({
    window_id: windowId,
    source_summaries: summaryWindow,
    output_contract: {
      topics_max: 20,
      subtopics_per_topic_max: 8
    }
  });
}

function mergeTopicInventories(partials) {
  const topicMap = new Map();
  for (const partial of partials) {
    for (const topic of partial.topics || []) {
      const topicName = normalizeText(topic.topic_name);
      if (!topicName) continue;
      const topicKey = topicName.toLowerCase();
      const existing = topicMap.get(topicKey) || {
        topic_name: topicName,
        description: normalizeText(topic.description) || topicName,
        aliases: [],
        subtopics: []
      };
      existing.aliases = uniqueValues([...(existing.aliases || []), ...(topic.aliases || [])]);
      if (!existing.description || existing.description === existing.topic_name) {
        existing.description = normalizeText(topic.description) || existing.description;
      }
      const subtopicMap = new Map((existing.subtopics || []).map((item) => [normalizeText(item.subtopic_name).toLowerCase(), item]));
      for (const subtopic of topic.subtopics || []) {
        const subtopicName = normalizeText(subtopic.subtopic_name);
        if (!subtopicName) continue;
        const subtopicKey = subtopicName.toLowerCase();
        const current = subtopicMap.get(subtopicKey) || {
          subtopic_name: subtopicName,
          description: normalizeText(subtopic.description) || subtopicName,
          aliases: []
        };
        current.aliases = uniqueValues([...(current.aliases || []), ...(subtopic.aliases || [])]);
        if (!current.description || current.description === current.subtopic_name) {
          current.description = normalizeText(subtopic.description) || current.description;
        }
        subtopicMap.set(subtopicKey, current);
      }
      existing.subtopics = Array.from(subtopicMap.values()).slice(0, 8);
      topicMap.set(topicKey, existing);
    }
  }
  return {
    topics: Array.from(topicMap.values()).slice(0, 20)
  };
}

function buildArtifactExtractionSystemPrompt() {
  return [
    "You are a build-time knowledge compiler for a business receptionist system.",
    "You will receive multiple source items in one request.",
    "Return strict JSON only with one result item per source_ref_id.",
    "Each result item must only use evidence from that source item and its source_chunk_ids.",
    "Use the provided topic inventory to organize the extracted cards and facts.",
    "Cards are retrieval-oriented answerable units, not whole-page summaries.",
    "Facts preserve richer detail such as applicability, exclusions, limits, scope, process, next steps, and ambiguity.",
    "Do not invent details not present in the source chunks.",
    "If the source is ambiguous, preserve the ambiguity explicitly in facts.",
    "If a source contains business-relevant information, emit at least 1 card and at least 3 facts for that source item.",
    "Only return empty arrays for a source item if it truly contains no answerable business information."
  ].join("\n");
}

function buildArtifactExtractionUserPrompt(batchItems, topicInventory) {
  return JSON.stringify({
    topic_inventory: topicInventory,
    allowed_fact_roles: [
      "overview",
      "definition",
      "capability",
      "coverage",
      "applicability",
      "eligibility",
      "scope",
      "condition",
      "limit",
      "exclusion",
      "boundary",
      "process",
      "next_step",
      "contact",
      "faq_answer",
      "ambiguity",
      "unknown"
    ],
    items: batchItems,
    output_contract: {
      one_result_per_source_ref_id: true,
      cards_max: 12,
      facts_max: 48
    }
  });
}

function strictObjectSchema(properties, required = Object.keys(properties)) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}

function stringArraySchema(maxItems) {
  return {
    type: "array",
    items: { type: "string" },
    maxItems
  };
}

function candidateSubtopicJsonSchema() {
  return strictObjectSchema({
    subtopic_name: { type: "string" },
    description: { type: "string" }
  });
}

function candidateTopicJsonSchema() {
  return strictObjectSchema({
    topic_name: { type: "string" },
    description: { type: "string" },
    candidate_subtopics: {
      type: "array",
      items: candidateSubtopicJsonSchema(),
      maxItems: 8
    }
  });
}

function topicInventoryTopicJsonSchema() {
  return strictObjectSchema({
    topic_name: { type: "string" },
    description: { type: "string" },
    aliases: stringArraySchema(8),
    subtopics: {
      type: "array",
      items: strictObjectSchema({
        subtopic_name: { type: "string" },
        description: { type: "string" },
        aliases: stringArraySchema(8)
      }),
      maxItems: 8
    }
  });
}

function buildSourceSummaryBatchJsonSchema(allowedSourceRefIds) {
  return strictObjectSchema({
    items: {
      type: "array",
      maxItems: Math.max(1, allowedSourceRefIds.length),
      items: strictObjectSchema({
        source_ref_id: { type: "string", enum: allowedSourceRefIds },
        summary: { type: "string" },
        candidate_topics: {
          type: "array",
          items: candidateTopicJsonSchema(),
          maxItems: 8
        },
        answerable_units: stringArraySchema(12),
        question_forms: stringArraySchema(12),
        notable_boundaries: stringArraySchema(12)
      })
    }
  });
}

function buildTopicInventoryJsonSchema(windowId) {
  return strictObjectSchema({
    window_id: { type: "string", enum: [windowId] },
    topics: {
      type: "array",
      items: topicInventoryTopicJsonSchema(),
      maxItems: 20
    }
  });
}

function buildSourceArtifactBatchJsonSchema(allowedSourceRefIds) {
  return strictObjectSchema({
    items: {
      type: "array",
      maxItems: Math.max(1, allowedSourceRefIds.length),
      items: strictObjectSchema({
        source_ref_id: { type: "string", enum: allowedSourceRefIds },
        cards: {
          type: "array",
          maxItems: 12,
          items: strictObjectSchema({
            canonical_name: { type: "string" },
            card_role: { type: "string" },
            topic_name: { type: "string" },
            subtopic_name: { type: ["string", "null"] },
            summary: { type: "string" },
            support_summary: { type: "string" },
            aliases: stringArraySchema(12),
            caller_phrases: stringArraySchema(12),
            source_chunk_ids: stringArraySchema(24),
            supporting_fact_keys: stringArraySchema(24)
          })
        },
        facts: {
          type: "array",
          maxItems: 48,
          items: strictObjectSchema({
            fact_key: { type: "string" },
            fact_role: { type: "string" },
            topic_name: { type: "string" },
            subtopic_name: { type: ["string", "null"] },
            claim_text: { type: "string" },
            support_type: { type: "string" },
            qualifiers: stringArraySchema(12),
            boundary_notes: stringArraySchema(12),
            next_steps: stringArraySchema(12),
            source_chunk_ids: stringArraySchema(24)
          })
        }
      })
    }
  });
}

function batchItemsByTokenBudget(items, { baseTokens = 0, maxTokens, maxItems = Number.MAX_SAFE_INTEGER }) {
  const batches = [];
  let currentItems = [];
  let currentTokens = baseTokens;
  for (const item of items) {
    const itemTokens = Math.max(1, Number(item?.tokenEstimate || 0));
    const wouldOverflow = currentItems.length
      && (currentItems.length >= maxItems || currentTokens + itemTokens > maxTokens);
    if (wouldOverflow) {
      batches.push(currentItems);
      currentItems = [];
      currentTokens = baseTokens;
    }
    currentItems.push(item);
    currentTokens += itemTokens;
  }
  if (currentItems.length) {
    batches.push(currentItems);
  }
  return batches;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => run());
  await Promise.all(workers);
  return results;
}

function findTopicId(topicInventoryRows, topicName) {
  const normalized = normalizeText(topicName).toLowerCase();
  return topicInventoryRows.topics.find((topic) => normalizeText(topic.topic_name).toLowerCase() === normalized)?.knowledge_topic_id || null;
}

function findSubtopicId(topicInventoryRows, topicName, subtopicName) {
  const topicId = findTopicId(topicInventoryRows, topicName);
  if (!topicId) return null;
  const normalized = normalizeText(subtopicName).toLowerCase();
  return topicInventoryRows.subtopics.find((subtopic) =>
    subtopic.knowledge_topic_id === topicId
    && normalizeText(subtopic.subtopic_name).toLowerCase() === normalized
  )?.knowledge_subtopic_id || null;
}

function buildSourceSummaryDigest(sourceSummaries) {
  const entries = (sourceSummaries || []).map((row) => ({
    source_ref_id: normalizeText(row.source_ref_id),
    summary_text: normalizeText(row.summary_text),
    candidate_topics_json: asArray(row.candidate_topics_json),
    answerable_units_json: asArray(row.answerable_units_json),
    question_forms_json: asArray(row.question_forms_json),
    notable_boundaries_json: asArray(row.notable_boundaries_json)
  }));
  entries.sort((left, right) => left.source_ref_id.localeCompare(right.source_ref_id));
  return stableHash(JSON.stringify(entries));
}

function topicRowsSourceSummaryDigest(topicRows) {
  const topicMetadata = asObject(topicRows?.topics?.[0]?.metadata_json);
  const subtopicMetadata = asObject(topicRows?.subtopics?.[0]?.metadata_json);
  return normalizeText(topicMetadata.source_summary_digest || subtopicMetadata.source_summary_digest);
}

function buildTopicRows(buildInfo, topicInventory, options = {}) {
  const sourceSummaryDigest = normalizeText(options.sourceSummaryDigest);
  const topics = [];
  const subtopics = [];
  for (const topic of topicInventory.topics || []) {
    const knowledgeTopicId = createId("kt");
    topics.push({
      knowledge_topic_id: knowledgeTopicId,
      tenant_key: buildInfo.tenant_key,
      build_id: buildInfo.build_id,
      topic_name: topic.topic_name,
      description: topic.description,
      aliases_json: uniqueValues(topic.aliases || []),
      source_coverage_summary: truncateText(topic.description, 400),
      metadata_json: sourceSummaryDigest ? { source_summary_digest: sourceSummaryDigest } : {}
    });
    for (const subtopic of topic.subtopics || []) {
      subtopics.push({
        knowledge_subtopic_id: createId("kst"),
        tenant_key: buildInfo.tenant_key,
        build_id: buildInfo.build_id,
        knowledge_topic_id: knowledgeTopicId,
        subtopic_name: subtopic.subtopic_name,
        description: subtopic.description,
        aliases_json: uniqueValues(subtopic.aliases || []),
        source_coverage_summary: truncateText(subtopic.description, 400),
        metadata_json: sourceSummaryDigest ? { source_summary_digest: sourceSummaryDigest } : {}
      });
    }
  }
  return { topics, subtopics };
}

function buildStableBatchKey(stage, itemIds) {
  return `${stage}_${stableHash(itemIds.join("|")).slice(0, 16)}`;
}

function buildPromptCacheKey(stage) {
  return `knowledge_build_${stage}_v2`;
}

function stageCheckpoint(stage, details = {}) {
  return {
    stage,
    updated_at: new Date().toISOString(),
    ...details
  };
}

async function updateBuildCheckpoint(db, buildId, patch) {
  await db.query(
    `UPDATE knowledge_builds
     SET analysis_checkpoint_json = COALESCE(analysis_checkpoint_json, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE build_id = $1`,
    [buildId, JSON.stringify(patch || {})]
  );
}

async function beginAnalysisBatch(db, buildInfo, input) {
  const batchId = createId("kbatch");
  const result = await db.query(
    `INSERT INTO knowledge_build_analysis_batches (
       knowledge_build_analysis_batch_id, tenant_key, build_id, stage, batch_key, status,
       model, prompt_cache_key, item_ids_json, request_token_estimate, response_token_budget, attempt_count,
       result_json, error_text, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, 'running', $6, $7, $8::jsonb, $9, $10, 1, '{}'::jsonb, NULL, NOW(), NOW()
     )
     ON CONFLICT (build_id, stage, batch_key)
     DO UPDATE SET
       status = 'running',
       model = EXCLUDED.model,
       prompt_cache_key = EXCLUDED.prompt_cache_key,
       item_ids_json = EXCLUDED.item_ids_json,
       request_token_estimate = EXCLUDED.request_token_estimate,
       response_token_budget = EXCLUDED.response_token_budget,
       attempt_count = knowledge_build_analysis_batches.attempt_count + 1,
       error_text = NULL,
       updated_at = NOW(),
       completed_at = NULL
     RETURNING knowledge_build_analysis_batch_id, attempt_count`,
    [
      batchId,
      buildInfo.tenant_key,
      buildInfo.build_id,
      input.stage,
      input.batchKey,
      input.model || null,
      input.promptCacheKey || null,
      JSON.stringify(input.itemIds || []),
      Number(input.requestTokenEstimate || 0),
      Number(input.responseTokenBudget || 0)
    ]
  );
  return result.rows[0];
}

async function completeAnalysisBatch(db, batchId, resultJson, usageJson = null) {
  await db.query(
    `UPDATE knowledge_build_analysis_batches
     SET status = 'completed',
         result_json = $2::jsonb,
         usage_json = COALESCE($3::jsonb, usage_json),
         error_text = NULL,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE knowledge_build_analysis_batch_id = $1`,
    [batchId, JSON.stringify(resultJson || {}), usageJson ? JSON.stringify(usageJson) : null]
  );
}

async function fallbackAnalysisBatch(db, batchId, resultJson, errorText, usageJson = null) {
  await db.query(
    `UPDATE knowledge_build_analysis_batches
     SET status = 'fallback',
         result_json = $2::jsonb,
         usage_json = COALESCE($4::jsonb, usage_json),
         error_text = $3,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE knowledge_build_analysis_batch_id = $1`,
    [batchId, JSON.stringify(resultJson || {}), normalizeText(errorText), usageJson ? JSON.stringify(usageJson) : null]
  );
}

async function loadSourceCompileRecords(db, buildInfo) {
  const result = await db.query(
    `SELECT sr.source_ref_id,
            sr.source_channel,
            sr.source_kind,
            sr.source_authority,
            sr.source_locator,
            sr.title,
            sr.page_type,
            sr.metadata_json,
            COALESCE(segment_data.segments_json, '[]'::jsonb) AS segments_json,
            COALESCE(chunk_data.chunks_json, '[]'::jsonb) AS chunks_json
     FROM source_refs sr
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
                jsonb_build_object(
                  'segment_index', ss.segment_index,
                  'text_span', ss.text_span
                )
                ORDER BY ss.segment_index
              ) AS segments_json
       FROM source_segments ss
       WHERE ss.source_ref_id = sr.source_ref_id
     ) AS segment_data ON TRUE
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
                jsonb_build_object(
                  'source_chunk_id', sc.source_chunk_id,
                  'chunk_index', sc.chunk_index,
                  'chunk_kind', sc.chunk_kind,
                  'section_title', sc.section_title,
                  'heading_path', sc.heading_path,
                  'text_span', sc.text_span,
                  'token_estimate', sc.token_estimate,
                  'content_hash', sc.content_hash,
                  'metadata_json', sc.metadata_json
                )
                ORDER BY sc.chunk_index
              ) AS chunks_json
       FROM source_chunks sc
       WHERE sc.source_ref_id = sr.source_ref_id
     ) AS chunk_data ON TRUE
     WHERE sr.tenant_key = $1
       AND sr.build_id = $2
     ORDER BY sr.captured_at ASC, sr.source_ref_id ASC`,
    [buildInfo.tenant_key, buildInfo.build_id]
  );

  return (result.rows || []).map((row) => {
    const metadata = asObject(row.metadata_json);
    const segments = asArray(row.segments_json)
      .map((item) => asObject(item))
      .sort((left, right) => Number(left.segment_index || 0) - Number(right.segment_index || 0));
    const sourceChunks = asArray(row.chunks_json)
      .map((item) => {
        const chunk = asObject(item);
        return {
          source_chunk_id: normalizeText(chunk.source_chunk_id),
          tenant_key: buildInfo.tenant_key,
          build_id: buildInfo.build_id,
          source_ref_id: row.source_ref_id,
          chunk_index: Number(chunk.chunk_index || 0),
          chunk_kind: normalizeText(chunk.chunk_kind || "content_block"),
          section_title: normalizeText(chunk.section_title) || null,
          heading_path: normalizeText(chunk.heading_path) || null,
          text_span: normalizeText(chunk.text_span),
          token_estimate: Number(chunk.token_estimate || 0),
          content_hash: normalizeText(chunk.content_hash),
          metadata_json: asObject(chunk.metadata_json)
        };
      })
      .filter((chunk) => chunk.source_chunk_id && chunk.text_span);
    const lines = segments.map((item) => cleanLine(item.text_span)).filter(Boolean);
    const text = lines.join(" ") || sourceChunks.map((chunk) => chunk.text_span).join(" ");
    return {
      sourceRefId: row.source_ref_id,
      sourceItem: {
        sourceChannel: normalizeText(row.source_channel),
        sourceKind: normalizeText(row.source_kind),
        sourceAuthority: normalizeText(row.source_authority),
        sourceLocator: normalizeText(row.source_locator),
        sourceSessionId: normalizeText(metadata.source_session_id) || null,
        title: normalizeText(row.title),
        headings: asArray(metadata.headings).map(cleanLine).filter(Boolean),
        lines,
        text,
        pageType: normalizeText(row.page_type),
        documentClass: normalizeText(metadata.document_class) || "operational",
        contentClass: normalizeText(metadata.content_class) || "operational_core",
        compileEnabled: metadata.compile_enabled !== false,
        metadata
      },
      sourceChunks
    };
  });
}

async function loadExistingSourceSummaries(db, buildInfo) {
  const result = await db.query(
    `SELECT source_ref_id, status, summary_text, candidate_topics_json, answerable_units_json,
            question_forms_json, notable_boundaries_json, source_chunk_ids_json, token_estimate, error_text
     FROM knowledge_build_source_summaries
     WHERE tenant_key = $1
       AND build_id = $2`,
    [buildInfo.tenant_key, buildInfo.build_id]
  );
  return new Map((result.rows || []).map((row) => [row.source_ref_id, row]));
}

async function loadExistingSourceArtifacts(db, buildInfo) {
  const result = await db.query(
    `SELECT source_ref_id, status, cards_json, facts_json, source_chunk_ids_json, token_estimate,
            repair_requested, error_text
     FROM knowledge_build_source_artifacts
     WHERE tenant_key = $1
       AND build_id = $2`,
    [buildInfo.tenant_key, buildInfo.build_id]
  );
  return new Map((result.rows || []).map((row) => [row.source_ref_id, row]));
}

async function loadCompletedTopicRows(db, buildInfo) {
  const [topicRes, subtopicRes] = await Promise.all([
    db.query(
      `SELECT knowledge_topic_id, tenant_key, build_id, topic_name, description, aliases_json,
              source_coverage_summary, metadata_json
       FROM knowledge_build_topics
       WHERE tenant_key = $1
         AND build_id = $2
       ORDER BY topic_name ASC`,
      [buildInfo.tenant_key, buildInfo.build_id]
    ),
    db.query(
      `SELECT knowledge_subtopic_id, tenant_key, build_id, knowledge_topic_id, subtopic_name, description,
              aliases_json, source_coverage_summary, metadata_json
       FROM knowledge_build_subtopics
       WHERE tenant_key = $1
         AND build_id = $2
       ORDER BY knowledge_topic_id ASC, subtopic_name ASC`,
      [buildInfo.tenant_key, buildInfo.build_id]
    )
  ]);

  return {
    topics: topicRes.rows || [],
    subtopics: subtopicRes.rows || []
  };
}

async function loadExistingTopicBatchResults(db, buildInfo) {
  const result = await db.query(
    `SELECT batch_key, status, result_json
     FROM knowledge_build_analysis_batches
     WHERE tenant_key = $1
       AND build_id = $2
       AND stage = 'topic_inventory'`,
    [buildInfo.tenant_key, buildInfo.build_id]
  );
  return new Map((result.rows || []).map((row) => [normalizeText(row.batch_key), row]));
}

async function upsertSourceSummaryRows(db, buildInfo, rows) {
  for (const row of rows) {
    await db.query(
      `INSERT INTO knowledge_build_source_summaries (
         source_summary_id, tenant_key, build_id, source_ref_id, knowledge_build_analysis_batch_id, status,
         summary_text, candidate_topics_json, answerable_units_json, question_forms_json,
         notable_boundaries_json, source_chunk_ids_json, token_estimate, error_text, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, NOW(), NOW()
       )
       ON CONFLICT (build_id, source_ref_id)
       DO UPDATE SET
         knowledge_build_analysis_batch_id = EXCLUDED.knowledge_build_analysis_batch_id,
         status = EXCLUDED.status,
         summary_text = EXCLUDED.summary_text,
         candidate_topics_json = EXCLUDED.candidate_topics_json,
         answerable_units_json = EXCLUDED.answerable_units_json,
         question_forms_json = EXCLUDED.question_forms_json,
         notable_boundaries_json = EXCLUDED.notable_boundaries_json,
         source_chunk_ids_json = EXCLUDED.source_chunk_ids_json,
         token_estimate = EXCLUDED.token_estimate,
         error_text = EXCLUDED.error_text,
         updated_at = NOW()`,
      [
        row.source_summary_id || createId("ksum"),
        buildInfo.tenant_key,
        buildInfo.build_id,
        row.source_ref_id,
        row.knowledge_build_analysis_batch_id || null,
        row.status || "completed",
        row.summary_text,
        JSON.stringify(row.candidate_topics_json || []),
        JSON.stringify(row.answerable_units_json || []),
        JSON.stringify(row.question_forms_json || []),
        JSON.stringify(row.notable_boundaries_json || []),
        JSON.stringify(row.source_chunk_ids_json || []),
        Number(row.token_estimate || 0),
        row.error_text || null
      ]
    );
  }
}

async function upsertSourceArtifactRows(db, buildInfo, rows) {
  for (const row of rows) {
    await db.query(
      `INSERT INTO knowledge_build_source_artifacts (
         source_artifact_id, tenant_key, build_id, source_ref_id, knowledge_build_analysis_batch_id, status,
         cards_json, facts_json, source_chunk_ids_json, token_estimate, repair_requested, error_text, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, NOW(), NOW()
       )
       ON CONFLICT (build_id, source_ref_id)
       DO UPDATE SET
         knowledge_build_analysis_batch_id = EXCLUDED.knowledge_build_analysis_batch_id,
         status = EXCLUDED.status,
         cards_json = EXCLUDED.cards_json,
         facts_json = EXCLUDED.facts_json,
         source_chunk_ids_json = EXCLUDED.source_chunk_ids_json,
         token_estimate = EXCLUDED.token_estimate,
         repair_requested = EXCLUDED.repair_requested,
         error_text = EXCLUDED.error_text,
         updated_at = NOW()`,
      [
        row.source_artifact_id || createId("ksa"),
        buildInfo.tenant_key,
        buildInfo.build_id,
        row.source_ref_id,
        row.knowledge_build_analysis_batch_id || null,
        row.status || "completed",
        JSON.stringify(row.cards_json || []),
        JSON.stringify(row.facts_json || []),
        JSON.stringify(row.source_chunk_ids_json || []),
        Number(row.token_estimate || 0),
        Boolean(row.repair_requested),
        row.error_text || null
      ]
    );
  }
}

function buildSummaryBatchPromptItem(record) {
  return {
    source_ref_id: record.sourceRefId,
    source: {
      locator: record.sourceItem.sourceLocator,
      title: record.sourceItem.title,
      source_channel: record.sourceItem.sourceChannel,
      source_authority: record.sourceItem.sourceAuthority,
      page_type: record.sourceItem.pageType,
      content_class: record.sourceItem.contentClass
    },
    chunks: record.sourceChunks.map((chunk) => ({
      source_chunk_id: chunk.source_chunk_id,
      chunk_index: chunk.chunk_index,
      section_title: chunk.section_title,
      heading_path: chunk.heading_path,
      text: chunk.text_span
    }))
  };
}

function buildTopicSummaryWindowItem(row, sourceRecord) {
  return {
    source_ref_id: row.source_ref_id,
    source_locator: sourceRecord?.sourceItem?.sourceLocator || "",
    title: sourceRecord?.sourceItem?.title || "",
    summary: row.summary_text,
    candidate_topics: Array.isArray(row.candidate_topics_json) ? row.candidate_topics_json : [],
    answerable_units: Array.isArray(row.answerable_units_json) ? row.answerable_units_json : [],
    question_forms: Array.isArray(row.question_forms_json) ? row.question_forms_json : [],
    notable_boundaries: Array.isArray(row.notable_boundaries_json) ? row.notable_boundaries_json : []
  };
}

function buildArtifactBatchPromptItem(record) {
  return {
    source_ref_id: record.sourceRefId,
    source: {
      locator: record.sourceItem.sourceLocator,
      title: record.sourceItem.title,
      source_channel: record.sourceItem.sourceChannel,
      source_authority: record.sourceItem.sourceAuthority,
      page_type: record.sourceItem.pageType,
      content_class: record.sourceItem.contentClass
    },
    chunks: record.sourceChunks.map((chunk) => ({
      source_chunk_id: chunk.source_chunk_id,
      chunk_index: chunk.chunk_index,
      section_title: chunk.section_title,
      heading_path: chunk.heading_path,
      text: chunk.text_span
    }))
  };
}

function fallbackCandidateTopics(record) {
  const baseName = normalizeText(record.sourceItem.title || record.sourceItem.pageType || "Business Information");
  const topicName = titleCaseWords(baseName.replace(/\s*[-|–]\s*.*$/, "")) || "Business Information";
  return [{
    topic_name: truncateText(topicName, 80),
    description: truncateText(record.sourceItem.title || record.sourceItem.text || topicName, 180),
    candidate_subtopics: []
  }];
}

export function buildFallbackSourceSummary(record, errorText = "") {
  const boundarySentences = record.sourceChunks
    .flatMap((chunk) => splitChunkTextToSentences(chunk.text_span))
    .filter((sentence) => /(only|except|unless|not\b|does not|do not|cannot|can't|limited|limit|required|must\b|subject to)/i.test(sentence))
    .slice(0, 6);
  const callerPhrases = buildCallerPhrases(record.sourceItem.title, record.sourceItem.lines);
  return {
    source_summary_id: createId("ksum"),
    source_ref_id: record.sourceRefId,
    status: "fallback",
    summary_text: truncateText(record.sourceChunks.map((chunk) => chunk.text_span).join(" "), 500)
      || truncateText(record.sourceItem.text, 500)
      || "Approved source content captured for build-time compilation.",
    candidate_topics_json: fallbackCandidateTopics(record),
    answerable_units_json: uniqueValues([record.sourceItem.title, ...callerPhrases]).slice(0, 8),
    question_forms_json: buildDirectQuestionPhrases(record.sourceItem.title, callerPhrases),
    notable_boundaries_json: boundarySentences,
    source_chunk_ids_json: record.sourceChunks.map((chunk) => chunk.source_chunk_id),
    token_estimate: estimateTokenCount(record.sourceItem.text),
    error_text: normalizeText(errorText)
  };
}

function buildFallbackTopicInventory(sourceSummaries) {
  const partials = sourceSummaries.map((row) => ({
    topics: (Array.isArray(row.candidate_topics_json) ? row.candidate_topics_json : []).map((topic) => ({
      topic_name: normalizeText(topic.topic_name || topic.name),
      description: normalizeText(topic.description || topic.summary || topic.topic_name || topic.name),
      aliases: normalizeStringList(topic.aliases),
      subtopics: asArray(topic.candidate_subtopics || topic.subtopics).map((subtopic) => ({
        subtopic_name: normalizeText(subtopic.subtopic_name || subtopic.name),
        description: normalizeText(subtopic.description || subtopic.summary || subtopic.subtopic_name || subtopic.name),
        aliases: normalizeStringList(subtopic.aliases)
      })).filter((subtopic) => subtopic.subtopic_name)
    })).filter((topic) => topic.topic_name)
  }));
  const merged = mergeTopicInventories(partials);
  if (merged.topics.length) {
    return merged;
  }
  return {
    topics: [{
      topic_name: "Business Information",
      description: "General information supported by the approved source corpus.",
      aliases: [],
      subtopics: []
    }]
  };
}

function buildFallbackSourceArtifacts(record, topicInventory) {
  const enriched = ensureArtifactsHaveFallbackSupport({
    sourceItem: record.sourceItem,
    sourceChunks: record.sourceChunks,
    extracted: { cards: [], facts: [] },
    topicInventory
  });
  return {
    source_artifact_id: createId("ksa"),
    source_ref_id: record.sourceRefId,
    status: "fallback",
    cards_json: enriched.cards,
    facts_json: enriched.facts,
    source_chunk_ids_json: record.sourceChunks.map((chunk) => chunk.source_chunk_id),
    token_estimate: estimateTokenCount(record.sourceItem.text),
    repair_requested: false,
    error_text: ""
  };
}

function normalizeSummaryBatchRow(resultItem, record, batchId, status, errorText = "") {
  const normalized = normalizeSourceSummaryInput(resultItem);
  return {
    source_summary_id: createId("ksum"),
    source_ref_id: record.sourceRefId,
    knowledge_build_analysis_batch_id: batchId,
    status,
    summary_text: normalized.summary,
    candidate_topics_json: normalized.candidate_topics,
    answerable_units_json: normalized.answerable_units,
    question_forms_json: normalized.question_forms,
    notable_boundaries_json: normalized.notable_boundaries,
    source_chunk_ids_json: record.sourceChunks.map((chunk) => chunk.source_chunk_id),
    token_estimate: estimateTokenCount(normalized.summary),
    error_text: normalizeText(errorText)
  };
}

function normalizeArtifactBatchRow(resultItem, record, topicInventory, batchId, status, errorText = "") {
  const normalized = normalizeSourceArtifactsInput(resultItem);
  const enriched = ensureArtifactsHaveFallbackSupport({
    sourceItem: record.sourceItem,
    sourceChunks: record.sourceChunks,
    extracted: normalized,
    topicInventory
  });
  return {
    source_artifact_id: createId("ksa"),
    source_ref_id: record.sourceRefId,
    knowledge_build_analysis_batch_id: batchId,
    status,
    cards_json: enriched.cards,
    facts_json: enriched.facts,
    source_chunk_ids_json: record.sourceChunks.map((chunk) => chunk.source_chunk_id),
    token_estimate: estimateTokenCount(JSON.stringify(resultItem || {})),
    repair_requested: false,
    error_text: normalizeText(errorText)
  };
}

function isCompletedStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  return normalized === "completed";
}

function isUsableStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  return normalized === "completed" || normalized === "fallback";
}

function cardSearchText(card, supportingFacts, topicName, subtopicName) {
  return uniqueValues([
    card.canonical_name,
    ...(card.aliases || []),
    ...(card.caller_phrases || []),
    card.summary,
    card.support_summary,
    topicName,
    subtopicName,
    card.card_role,
    ...supportingFacts.map((fact) => fact.claim_text)
  ]).join(" ");
}

function factSearchText(fact, topicName, subtopicName) {
  return uniqueValues([
    fact.claim_text,
    ...(fact.qualifiers || []),
    ...(fact.boundary_notes || []),
    ...(fact.next_steps || []),
    topicName,
    subtopicName,
    fact.fact_role,
    fact.support_type
  ]).join(" ");
}

function buildSourceSpanRefs(sourceChunks, sourceChunkIds) {
  const allowedIds = new Set(normalizeStringList(sourceChunkIds));
  return sourceChunks
    .filter((chunk) => allowedIds.has(normalizeText(chunk.source_chunk_id)))
    .map((chunk) => ({
      source_chunk_id: chunk.source_chunk_id,
      chunk_index: chunk.chunk_index,
      section_title: chunk.section_title,
      heading_path: chunk.heading_path
    }));
}

function splitChunkTextToSentences(text) {
  return uniqueValues(
    normalizeText(text)
      .split(/(?<=[.!?])\s+|\n+/)
      .map(cleanLine)
      .filter((entry) => entry.length >= 20)
  );
}

function splitEnumeratedItems(sentence) {
  const normalized = normalizeText(sentence)
    .replace(/\s+and\s+/gi, ", ")
    .replace(/\s+or\s+/gi, ", ");
  const parts = normalized
    .split(",")
    .map((item) => cleanLine(item.replace(/^(and|or)\s+/i, "").replace(/[.:;]+$/g, "")))
    .filter((item) => item && item.split(/\s+/).length <= 6);
  return uniqueValues(parts);
}

function sentenceLooksLikeEnumeration(sentence) {
  const lower = normalizeText(sentence).toLowerCase();
  const normalizedList = lower.replace(/[.!?;:]+$/g, "").trim();
  const items = splitEnumeratedItems(sentence);
  if (items.length < 3) return false;
  if (/(provides|offer|offers|includes|serve|serves|service area|available|covers|cover)/.test(lower)) {
    return true;
  }
  return /^[a-z0-9 ,&/-]+$/i.test(normalizedList);
}

function inferFallbackFactRole(sentence, index = 0) {
  const lower = normalizeText(sentence).toLowerCase();
  if (/(only|except|unless|not\b|does not|do not|cannot|can't|limited|limit|required|must\b|subject to)/.test(lower)) {
    return "boundary";
  }
  if (/(serve|service area|coverage|available in|seattle|bellevue|kirkland|redmond)/.test(lower)) {
    return "coverage";
  }
  if (/(call|callback|contact|route|review|schedule|book|appointment|reach|email)/.test(lower)) {
    return index === 0 ? "process" : "next_step";
  }
  if (/(includes|provide|provides|offer|offers|replace|repair|install|cleaning|inspection|service)/.test(lower)) {
    return index === 0 ? "overview" : "capability";
  }
  return index === 0 ? "definition" : "scope";
}

function buildFallbackFacts(sourceItem, sourceChunks, topicName, subtopicName) {
  const facts = [];
  for (const chunk of sourceChunks) {
    const sentences = splitChunkTextToSentences(chunk.text_span);
    for (const sentence of sentences) {
      if (facts.length >= 8) break;
      facts.push({
        fact_key: deriveFactKey({ claim_text: sentence }, facts.length),
        fact_role: inferFallbackFactRole(sentence, facts.length),
        topic_name: topicName,
        subtopic_name: subtopicName,
        claim_text: sentence,
        support_type: "source_backed_fallback",
        qualifiers: [],
        boundary_notes: [],
        next_steps: /(call|callback|contact|schedule|book|reach)/i.test(sentence) ? [sentence] : [],
        source_chunk_ids: [chunk.source_chunk_id]
      });
    }
    if (facts.length >= 8) break;
  }
  if (facts.length) return facts;
  const fallbackText = truncateText(sourceItem.text, 240);
  if (!fallbackText) return [];
  return [{
    fact_key: deriveFactKey({ claim_text: fallbackText }, 0),
    fact_role: "overview",
    topic_name: topicName,
    subtopic_name: subtopicName,
    claim_text: fallbackText,
    support_type: "source_backed_fallback",
    qualifiers: [],
    boundary_notes: [],
    next_steps: [],
    source_chunk_ids: sourceChunks[0] ? [sourceChunks[0].source_chunk_id] : []
  }];
}

function buildFallbackCards(sourceItem, sourceChunks, facts, topicName, subtopicName) {
  const primaryFact = facts[0];
  if (!primaryFact) return [];
  const relatedFactKeys = facts.slice(0, 4).map((fact) => fact.fact_key);
  const summary = primaryFact.claim_text;
  const supportSummary = facts.slice(0, 3).map((fact) => fact.claim_text).join(" ");
  return [{
    canonical_name: deriveSpecificCardName({
      canonicalName: sourceItem.title || "Business Information",
      summary,
      topicName,
      subtopicName
    }),
    card_role: "answer_unit",
    topic_name: topicName,
    subtopic_name: subtopicName,
    summary,
    support_summary: supportSummary || summary,
    aliases: [],
    caller_phrases: [],
    source_chunk_ids: uniqueValues(facts.flatMap((fact) => fact.source_chunk_ids || [])),
    supporting_fact_keys: relatedFactKeys
  }];
}

function factRoleBucket(role) {
  const normalized = normalizeText(role).toLowerCase();
  if (["overview", "definition", "faq_answer", "capability", "coverage", "service_detail", "answer"].includes(normalized)) {
    return "direct";
  }
  if (["applicability", "eligibility", "scope", "condition", "ambiguity", "clarification"].includes(normalized)) {
    return "qualifier";
  }
  if (["limit", "exclusion", "boundary", "unknown", "exception"].includes(normalized)) {
    return "limit";
  }
  if (["next_step", "contact", "process_next_step", "handoff", "process"].includes(normalized)) {
    return "next_step";
  }
  return "direct";
}

function overlapCount(leftValues, rightValues) {
  const left = new Set((leftValues || []).map((value) => normalizeText(value).toLowerCase()).filter(Boolean));
  const right = new Set((rightValues || []).map((value) => normalizeText(value).toLowerCase()).filter(Boolean));
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function tokenizeMeaningfulWords(value) {
  return uniqueValues(
    normalizeText(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 4)
  );
}

function cardLooksProcessOrAction(card) {
  const text = `${normalizeText(card.canonical_name)} ${normalizeText(card.summary)} ${normalizeText(card.support_summary)}`
    .toLowerCase();
  return /(call|callback|contact|schedule|book|appointment|review|assessment|next step|process)/.test(text);
}

function selectSupportingFactKeysForCard(card, facts) {
  const explicitFactKeys = uniqueValues(card.supporting_fact_keys || []);
  if (explicitFactKeys.length) {
    return explicitFactKeys;
  }

  const cardChunkIds = new Set(normalizeStringList(card.source_chunk_ids || []));
  const cardTokens = tokenizeMeaningfulWords([
    card.canonical_name,
    ...(card.aliases || []),
    ...(card.caller_phrases || []),
    card.summary,
    card.support_summary
  ].join(" "));
  const allowActionFacts = cardLooksProcessOrAction(card);

  const scoredFacts = facts.map((fact, index) => {
    const factTokens = tokenizeMeaningfulWords(fact.claim_text);
    const roleBucket = factRoleBucket(fact.fact_role);
    const chunkOverlap = overlapCount(Array.from(cardChunkIds), fact.source_chunk_ids || []);
    const lexicalOverlap = overlapCount(cardTokens, factTokens);
    const topicMatch = normalizeText(fact.topic_name).toLowerCase() === normalizeText(card.topic_name).toLowerCase() ? 1 : 0;
    const subtopicMatch = normalizeText(fact.subtopic_name).toLowerCase() === normalizeText(card.subtopic_name).toLowerCase() ? 1 : 0;
    const rolePenalty = roleBucket === "next_step" && !allowActionFacts ? -3 : 0;
    const score = (chunkOverlap * 5) + (lexicalOverlap * 4) + (topicMatch * 2) + (subtopicMatch * 2) + rolePenalty;
    return { fact, index, score, roleBucket, chunkOverlap, lexicalOverlap };
  });

  const eligible = scoredFacts
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((entry) => entry.fact.fact_key);

  if (eligible.length) {
    return uniqueValues(eligible).slice(0, 6);
  }

  const directFallback = scoredFacts
    .filter((entry) => entry.roleBucket !== "next_step")
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.fact.fact_key)
    .filter(Boolean);

  return uniqueValues(directFallback).slice(0, 2);
}

function buildEnumeratedUnitCards(sourceChunks, facts, topicName, subtopicName, existingCards = []) {
  const existingNames = new Set(existingCards.map((card) => normalizeText(card.canonical_name).toLowerCase()));
  const cards = [];
  for (const fact of facts) {
    if (!sentenceLooksLikeEnumeration(fact.claim_text)) continue;
    const items = splitEnumeratedItems(fact.claim_text);
    for (const item of items) {
      const canonicalName = contextualizeEnumeratedCardName(item, subtopicName || topicName, topicName);
      const key = canonicalName.toLowerCase();
      if (!canonicalName || existingNames.has(key)) continue;
      existingNames.add(key);
      cards.push({
        canonical_name: canonicalName,
        card_role: "answer_unit",
        topic_name: topicName,
        subtopic_name: subtopicName,
        summary: fact.claim_text,
        support_summary: fact.claim_text,
        aliases: [],
        caller_phrases: [canonicalName],
        source_chunk_ids: fact.source_chunk_ids || [],
        supporting_fact_keys: [fact.fact_key]
      });
      if (cards.length >= 8) return cards;
    }
  }
  return cards;
}

function ensureArtifactsHaveFallbackSupport({ sourceItem, sourceChunks, extracted, topicInventory }) {
  const baseTopicName = normalizeText(extracted.cards?.[0]?.topic_name || extracted.facts?.[0]?.topic_name || topicInventory.topics?.[0]?.topic_name || "Business Information");
  const baseSubtopicName = normalizeText(
    extracted.cards?.[0]?.subtopic_name
      || extracted.facts?.[0]?.subtopic_name
      || topicInventory.topics?.[0]?.subtopics?.[0]?.subtopic_name
      || ""
  ) || null;

  let facts = Array.isArray(extracted.facts) ? extracted.facts.map((fact, index) => ({
    ...fact,
    fact_key: deriveFactKey(fact, index),
    topic_name: normalizeText(fact.topic_name || baseTopicName) || baseTopicName,
    subtopic_name: normalizeText(fact.subtopic_name || baseSubtopicName || "") || null
  })) : [];

  let cards = Array.isArray(extracted.cards) ? extracted.cards.map((card) => {
    const topicName = normalizeText(card.topic_name || baseTopicName) || baseTopicName;
    const subtopicName = normalizeText(card.subtopic_name || baseSubtopicName || "") || null;
    const canonicalName = looksGenericCardName(card.canonical_name)
      ? deriveSpecificCardName({
        canonicalName: card.canonical_name,
        summary: card.summary,
        topicName,
        subtopicName
      })
      : normalizeText(card.canonical_name);
    return {
      ...card,
      canonical_name: canonicalName,
      topic_name: topicName,
      subtopic_name: subtopicName
    };
  }) : [];

  if (!facts.length && sourceChunks.length) {
    facts = buildFallbackFacts(sourceItem, sourceChunks, baseTopicName, baseSubtopicName);
  }

  if (!cards.length && facts.length) {
    cards = buildFallbackCards(sourceItem, sourceChunks, facts, baseTopicName, baseSubtopicName);
  }

  const enumeratedCards = buildEnumeratedUnitCards(sourceChunks, facts, baseTopicName, baseSubtopicName, cards);
  if (enumeratedCards.length) {
    cards = [...cards, ...enumeratedCards];
  }

  cards = cards.map((card) => ({
    ...card,
    supporting_fact_keys: selectSupportingFactKeysForCard(card, facts)
  }));

  return { cards, facts };
}

function topicInventoryToPromptShape(topicRows) {
  return {
    topics: (topicRows.topics || []).map((topic) => ({
      topic_name: topic.topic_name,
      description: topic.description,
      aliases: Array.isArray(topic.aliases_json) ? topic.aliases_json : [],
      subtopics: (topicRows.subtopics || [])
        .filter((subtopic) => subtopic.knowledge_topic_id === topic.knowledge_topic_id)
        .map((subtopic) => ({
          subtopic_name: subtopic.subtopic_name,
          description: subtopic.description,
          aliases: Array.isArray(subtopic.aliases_json) ? subtopic.aliases_json : []
        }))
    }))
  };
}

async function withCompilerTransaction(db, work) {
  const canBorrowClient = typeof db?.connect === "function" && typeof db?.release !== "function";
  const client = canBorrowClient ? await db.connect() : db;
  const ownsClient = canBorrowClient;
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownsClient && typeof client?.release === "function") {
      client.release();
    }
  }
}

async function replaceTopicRows(db, buildInfo, topicRows) {
  await withCompilerTransaction(db, async (client) => {
    await client.query(
      `DELETE FROM knowledge_build_subtopics
       WHERE tenant_key = $1
         AND build_id = $2`,
      [buildInfo.tenant_key, buildInfo.build_id]
    );
    await client.query(
      `DELETE FROM knowledge_build_topics
       WHERE tenant_key = $1
         AND build_id = $2`,
      [buildInfo.tenant_key, buildInfo.build_id]
    );
    for (const topic of topicRows.topics || []) {
      await client.query(
        `INSERT INTO knowledge_build_topics (
           knowledge_topic_id, tenant_key, build_id, topic_name, description, aliases_json,
           source_coverage_summary, metadata_json
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)`,
        [
          topic.knowledge_topic_id,
          topic.tenant_key,
          topic.build_id,
          topic.topic_name,
          topic.description,
          JSON.stringify(topic.aliases_json || []),
          topic.source_coverage_summary || null,
          JSON.stringify(topic.metadata_json || {})
        ]
      );
    }
    for (const subtopic of topicRows.subtopics || []) {
      await client.query(
        `INSERT INTO knowledge_build_subtopics (
           knowledge_subtopic_id, tenant_key, build_id, knowledge_topic_id, subtopic_name, description,
           aliases_json, source_coverage_summary, metadata_json
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)`,
        [
          subtopic.knowledge_subtopic_id,
          subtopic.tenant_key,
          subtopic.build_id,
          subtopic.knowledge_topic_id,
          subtopic.subtopic_name,
          subtopic.description,
          JSON.stringify(subtopic.aliases_json || []),
          subtopic.source_coverage_summary || null,
          JSON.stringify(subtopic.metadata_json || {})
        ]
      );
    }
  });
}

async function runSourceSummaryStage(db, buildInfo, sourceRecords, buildModel, warnings) {
  const existing = await loadExistingSourceSummaries(db, buildInfo);
  const pendingRecords = sourceRecords.filter((record) => !isCompletedStatus(existing.get(record.sourceRefId)?.status));
  const summaryPromptItems = pendingRecords.map((record) => {
    const promptItem = buildSummaryBatchPromptItem(record);
    return {
      record,
      promptItem,
      tokenEstimate: estimateTokenCount(JSON.stringify(promptItem))
    };
  });
  const summaryBatches = batchItemsByTokenBudget(summaryPromptItems, {
    baseTokens: estimateTokenCount(buildSourceSummarySystemPrompt()) + 800,
    maxTokens: SOURCE_SUMMARY_BATCH_TOKEN_BUDGET,
    maxItems: SOURCE_SUMMARY_BATCH_MAX_ITEMS
  });

  logCompilerProgress("source_summary_batches_planned", {
    buildId: buildInfo.build_id,
    sourceCount: sourceRecords.length,
    pendingSourceCount: pendingRecords.length,
    batchCount: summaryBatches.length
  });

  let completedSources = sourceRecords.length - pendingRecords.length;
  await mapWithConcurrency(summaryBatches, SOURCE_SUMMARY_BATCH_CONCURRENCY, async (batch, batchIndex) => {
    const itemIds = batch.map((item) => item.record.sourceRefId);
    const batchKey = buildStableBatchKey("source_summary", itemIds);
    const started = await beginAnalysisBatch(db, buildInfo, {
      stage: "source_summary",
      batchKey,
      model: buildModel,
      promptCacheKey: buildPromptCacheKey("source_summary"),
      itemIds,
      requestTokenEstimate: batch.reduce((sum, item) => sum + item.tokenEstimate, 0),
      responseTokenBudget: SOURCE_SUMMARY_RESPONSE_TOKENS
    });

    try {
      const result = await callOpenAiJsonModel({
        model: buildModel,
        system: buildSourceSummarySystemPrompt(),
        user: buildSourceSummaryUserPrompt(batch.map((item) => item.promptItem)),
        schema: NORMALIZED_SOURCE_SUMMARY_BATCH_SCHEMA,
        jsonSchemaName: "knowledge_build_source_summary_batch",
        jsonSchema: buildSourceSummaryBatchJsonSchema(itemIds),
        promptCacheKey: buildPromptCacheKey("source_summary"),
        temperature: 0,
        maxOutputTokens: SOURCE_SUMMARY_RESPONSE_TOKENS
      });
      const itemMap = new Map((result.parsed.items || []).map((item) => [normalizeText(item.source_ref_id), item]));
      const rows = batch.map((item) => {
        const output = itemMap.get(item.record.sourceRefId);
        if (!output) {
          warnings.push(`source_summary_missing_output:${item.record.sourceItem.sourceLocator}`);
          return {
            ...buildFallbackSourceSummary(item.record, "missing_summary_output"),
            knowledge_build_analysis_batch_id: started.knowledge_build_analysis_batch_id
          };
        }
        return normalizeSummaryBatchRow(output, item.record, started.knowledge_build_analysis_batch_id, "completed");
      });
      await upsertSourceSummaryRows(db, buildInfo, rows);
      const fallbackCount = rows.filter((row) => normalizeText(row.status) === "fallback").length;
      if (fallbackCount > 0) {
        await fallbackAnalysisBatch(db, started.knowledge_build_analysis_batch_id, {
          completed_source_ref_ids: rows.filter((row) => row.status === "completed").map((row) => row.source_ref_id),
          fallback_source_ref_ids: rows.filter((row) => row.status === "fallback").map((row) => row.source_ref_id)
        }, "source_summary_missing_output", result.usage);
      } else {
        await completeAnalysisBatch(db, started.knowledge_build_analysis_batch_id, {
          completed_source_ref_ids: rows.map((row) => row.source_ref_id)
        }, result.usage);
      }
    } catch (err) {
      const errorText = normalizeText(err?.message || "source_summary_failed");
      warnings.push(`source_summary_batch_failed:${batchIndex + 1}:${errorText}`);
      const fallbackRows = batch.map((item) => ({
        ...buildFallbackSourceSummary(item.record, errorText),
        knowledge_build_analysis_batch_id: started.knowledge_build_analysis_batch_id
      }));
      await upsertSourceSummaryRows(db, buildInfo, fallbackRows);
      await fallbackAnalysisBatch(db, started.knowledge_build_analysis_batch_id, {
        fallback_source_ref_ids: fallbackRows.map((row) => row.source_ref_id)
      }, errorText);
    }

    completedSources += batch.length;
    if (completedSources % 25 === 0 || completedSources === sourceRecords.length) {
      logCompilerProgress("source_summaries_completed", {
        completed: completedSources,
        total: sourceRecords.length
      });
    }
  });

  const updated = await loadExistingSourceSummaries(db, buildInfo);
  const usableRows = sourceRecords
    .map((record) => updated.get(record.sourceRefId))
    .filter((row) => row && isUsableStatus(row.status));

  const sourceSummaryDigest = buildSourceSummaryDigest(usableRows);
  await updateBuildCheckpoint(db, buildInfo.build_id, {
    source_summary_stage: stageCheckpoint("source_summary", {
      total_sources: sourceRecords.length,
      completed_sources: usableRows.length,
      pending_sources: sourceRecords.length - usableRows.length,
      batch_count: summaryBatches.length,
      source_summary_digest: sourceSummaryDigest
    })
  });

  return usableRows;
}

async function runTopicInventoryStage(db, buildInfo, sourceRecords, sourceSummaries, buildModel, warnings) {
  const sourceSummaryDigest = buildSourceSummaryDigest(sourceSummaries);
  const existingTopicRows = await loadCompletedTopicRows(db, buildInfo);
  if ((existingTopicRows.topics || []).length && topicRowsSourceSummaryDigest(existingTopicRows) === sourceSummaryDigest) {
    await updateBuildCheckpoint(db, buildInfo.build_id, {
      topic_inventory_stage: stageCheckpoint("topic_inventory", {
        topic_count: existingTopicRows.topics.length,
        subtopic_count: existingTopicRows.subtopics.length,
        reused_existing: true,
        source_summary_digest: sourceSummaryDigest
      })
    });
    return {
      topicInventory: topicInventoryToPromptShape(existingTopicRows),
      topicRows: existingTopicRows
    };
  }

  const sourceRecordMap = new Map(sourceRecords.map((record) => [record.sourceRefId, record]));
  const summaryItems = sourceSummaries.map((row) => {
    const promptItem = buildTopicSummaryWindowItem(row, sourceRecordMap.get(row.source_ref_id));
    return {
      row,
      promptItem,
      tokenEstimate: estimateTokenCount(JSON.stringify(promptItem))
    };
  });
  const windows = batchItemsByTokenBudget(summaryItems, {
    baseTokens: estimateTokenCount(buildTopicInventorySystemPrompt()) + 800,
    maxTokens: TOPIC_WINDOW_TOKEN_BUDGET,
    maxItems: TOPIC_WINDOW_MAX_ITEMS
  });
  const existingBatches = await loadExistingTopicBatchResults(db, buildInfo);
  const partials = [];

  for (let index = 0; index < windows.length; index += 1) {
    const windowItems = windows[index];
    const itemIds = windowItems.map((item) => item.row.source_ref_id);
    const batchKey = buildStableBatchKey("topic_inventory", [sourceSummaryDigest, ...itemIds]);
    const windowId = `topic_window_${index + 1}`;
    const existingBatch = existingBatches.get(batchKey);
    if (existingBatch && isUsableStatus(existingBatch.status)) {
      partials.push(NORMALIZED_TOPIC_INVENTORY_SCHEMA.parse(existingBatch.result_json || {}));
      continue;
    }

    const started = await beginAnalysisBatch(db, buildInfo, {
      stage: "topic_inventory",
      batchKey,
      model: buildModel,
      promptCacheKey: buildPromptCacheKey("topic_inventory"),
      itemIds,
      requestTokenEstimate: windowItems.reduce((sum, item) => sum + item.tokenEstimate, 0),
      responseTokenBudget: TOPIC_WINDOW_RESPONSE_TOKENS
    });

    try {
      const result = await callOpenAiJsonModel({
        model: buildModel,
        system: buildTopicInventorySystemPrompt(),
        user: buildTopicInventoryUserPrompt(windowId, windowItems.map((item) => item.promptItem)),
        schema: NORMALIZED_TOPIC_INVENTORY_SCHEMA,
        jsonSchemaName: "knowledge_build_topic_inventory_window",
        jsonSchema: buildTopicInventoryJsonSchema(windowId),
        promptCacheKey: buildPromptCacheKey("topic_inventory"),
        temperature: 0,
        maxOutputTokens: TOPIC_WINDOW_RESPONSE_TOKENS
      });
      partials.push(result.parsed);
      await completeAnalysisBatch(db, started.knowledge_build_analysis_batch_id, {
        window_id: windowId,
        topics: result.parsed.topics || []
      }, result.usage);
    } catch (err) {
      const errorText = normalizeText(err?.message || "topic_inventory_failed");
      warnings.push(`topic_inventory_batch_failed:${index + 1}:${errorText}`);
      const fallback = buildFallbackTopicInventory(windowItems.map((item) => item.row));
      partials.push(fallback);
      await fallbackAnalysisBatch(db, started.knowledge_build_analysis_batch_id, {
        window_id: windowId,
        topics: fallback.topics || []
      }, errorText);
    }
  }

  const merged = mergeTopicInventories(partials);
  const topicInventory = merged.topics.length ? merged : buildFallbackTopicInventory(sourceSummaries);
  const topicRows = buildTopicRows(buildInfo, topicInventory, { sourceSummaryDigest });
  await replaceTopicRows(db, buildInfo, topicRows);

  await updateBuildCheckpoint(db, buildInfo.build_id, {
    topic_inventory_stage: stageCheckpoint("topic_inventory", {
      topic_count: topicRows.topics.length,
      subtopic_count: topicRows.subtopics.length,
      window_count: windows.length,
      source_summary_digest: sourceSummaryDigest
    })
  });

  return { topicInventory, topicRows };
}

async function runSourceArtifactStage(db, buildInfo, sourceRecords, topicRows, warnings, buildModel) {
  const existing = await loadExistingSourceArtifacts(db, buildInfo);
  const pendingRecords = sourceRecords.filter((record) => !isCompletedStatus(existing.get(record.sourceRefId)?.status));
  const topicInventoryPrompt = topicInventoryToPromptShape(topicRows);
  const artifactPromptItems = pendingRecords.map((record) => {
    const promptItem = buildArtifactBatchPromptItem(record);
    return {
      record,
      promptItem,
      tokenEstimate: estimateTokenCount(JSON.stringify(promptItem))
    };
  });
  const topicInventoryTokenEstimate = estimateTokenCount(JSON.stringify(topicInventoryPrompt));
  const artifactBatches = batchItemsByTokenBudget(artifactPromptItems, {
    baseTokens: estimateTokenCount(buildArtifactExtractionSystemPrompt()) + topicInventoryTokenEstimate + 800,
    maxTokens: SOURCE_ARTIFACT_BATCH_TOKEN_BUDGET,
    maxItems: SOURCE_ARTIFACT_BATCH_MAX_ITEMS
  });

  logCompilerProgress("artifact_batches_planned", {
    buildId: buildInfo.build_id,
    sourceCount: sourceRecords.length,
    pendingSourceCount: pendingRecords.length,
    batchCount: artifactBatches.length
  });

  let completedSources = sourceRecords.length - pendingRecords.length;
  await mapWithConcurrency(artifactBatches, SOURCE_ARTIFACT_BATCH_CONCURRENCY, async (batch, batchIndex) => {
    const itemIds = batch.map((item) => item.record.sourceRefId);
    const batchKey = buildStableBatchKey("source_artifact", itemIds);
    const started = await beginAnalysisBatch(db, buildInfo, {
      stage: "source_artifact",
      batchKey,
      model: buildModel,
      promptCacheKey: buildPromptCacheKey("source_artifact"),
      itemIds,
      requestTokenEstimate: batch.reduce((sum, item) => sum + item.tokenEstimate, topicInventoryTokenEstimate),
      responseTokenBudget: SOURCE_ARTIFACT_RESPONSE_TOKENS
    });

    try {
      const result = await callOpenAiJsonModel({
        model: buildModel,
        system: buildArtifactExtractionSystemPrompt(),
        user: buildArtifactExtractionUserPrompt(batch.map((item) => item.promptItem), topicInventoryPrompt),
        schema: NORMALIZED_SOURCE_ARTIFACT_BATCH_SCHEMA,
        jsonSchemaName: "knowledge_build_source_artifact_batch",
        jsonSchema: buildSourceArtifactBatchJsonSchema(itemIds),
        promptCacheKey: buildPromptCacheKey("source_artifact"),
        temperature: 0,
        maxOutputTokens: SOURCE_ARTIFACT_RESPONSE_TOKENS
      });
      const itemMap = new Map((result.parsed.items || []).map((item) => [normalizeText(item.source_ref_id), item]));
      const rows = batch.map((item) => {
        const output = itemMap.get(item.record.sourceRefId);
        if (!output) {
          warnings.push(`source_artifact_missing_output:${item.record.sourceItem.sourceLocator}`);
          return {
            ...buildFallbackSourceArtifacts(item.record, topicInventoryPrompt),
            knowledge_build_analysis_batch_id: started.knowledge_build_analysis_batch_id,
            error_text: "missing_artifact_output"
          };
        }
        return normalizeArtifactBatchRow(output, item.record, topicInventoryPrompt, started.knowledge_build_analysis_batch_id, "completed");
      });
      await upsertSourceArtifactRows(db, buildInfo, rows);
      const fallbackCount = rows.filter((row) => normalizeText(row.status) === "fallback").length;
      if (fallbackCount > 0) {
        await fallbackAnalysisBatch(db, started.knowledge_build_analysis_batch_id, {
          completed_source_ref_ids: rows.filter((row) => row.status === "completed").map((row) => row.source_ref_id),
          fallback_source_ref_ids: rows.filter((row) => row.status === "fallback").map((row) => row.source_ref_id)
        }, "source_artifact_missing_output", result.usage);
      } else {
        await completeAnalysisBatch(db, started.knowledge_build_analysis_batch_id, {
          completed_source_ref_ids: rows.map((row) => row.source_ref_id)
        }, result.usage);
      }
    } catch (err) {
      const errorText = normalizeText(err?.message || "source_artifact_failed");
      warnings.push(`source_artifact_batch_failed:${batchIndex + 1}:${errorText}`);
      const fallbackRows = batch.map((item) => ({
        ...buildFallbackSourceArtifacts(item.record, topicInventoryPrompt),
        knowledge_build_analysis_batch_id: started.knowledge_build_analysis_batch_id,
        error_text: errorText
      }));
      await upsertSourceArtifactRows(db, buildInfo, fallbackRows);
      await fallbackAnalysisBatch(db, started.knowledge_build_analysis_batch_id, {
        fallback_source_ref_ids: fallbackRows.map((row) => row.source_ref_id)
      }, errorText);
    }

    completedSources += batch.length;
    if (completedSources % 25 === 0 || completedSources === sourceRecords.length) {
      logCompilerProgress("artifact_extractions_completed", {
        completed: completedSources,
        total: sourceRecords.length
      });
    }
  });

  const updated = await loadExistingSourceArtifacts(db, buildInfo);
  const usableRows = sourceRecords
    .map((record) => updated.get(record.sourceRefId))
    .filter((row) => row && isUsableStatus(row.status));

  await updateBuildCheckpoint(db, buildInfo.build_id, {
    source_artifact_stage: stageCheckpoint("source_artifact", {
      total_sources: sourceRecords.length,
      completed_sources: usableRows.length,
      pending_sources: sourceRecords.length - usableRows.length,
      batch_count: artifactBatches.length
    })
  });

  return usableRows;
}

function consolidateArtifacts(buildInfo, topicRows, extractedBySource) {
  const factMap = new Map();
  const cardMap = new Map();

  for (const extracted of extractedBySource) {
    const { sourceItem, sourceRefId, sourceChunks, facts: extractedFacts, cards: extractedCards } = extracted;
    const factIdByKey = new Map();

    for (const fact of extractedFacts) {
      const topicId = findTopicId(topicRows, fact.topic_name);
      const subtopicId = findSubtopicId(topicRows, fact.topic_name, fact.subtopic_name);
      const key = [
        normalizeText(fact.topic_name).toLowerCase(),
        normalizeText(fact.subtopic_name).toLowerCase(),
        normalizeText(fact.fact_role).toLowerCase(),
        normalizeText(fact.claim_text).toLowerCase()
      ].join("::");
      const current = factMap.get(key) || {
        knowledge_fact_id: createId("kf"),
        tenant_key: buildInfo.tenant_key,
        build_id: buildInfo.build_id,
        domain_id: buildInfo.primaryDomainId,
        subdomain_id: buildInfo.primarySubdomainId,
        knowledge_topic_id: topicId,
        knowledge_subtopic_id: subtopicId,
        fact_type: "source_compiled_fact",
        object_type: "knowledge_support",
        subject: normalizeText(fact.topic_name) || normalizeText(sourceItem.title),
        predicate: normalizeText(fact.fact_role) || "supports",
        object_text: fact.claim_text,
        normalized_value_json: null,
        confidence: sourceItem.sourceAuthority === "owner_interview_confirmed" ? 0.94 : 0.82,
        source_ref_ids_json: [],
        scope_json: {
          source_authority: sourceItem.sourceAuthority,
          source_channel: sourceItem.sourceChannel,
          source_locator: sourceItem.sourceLocator,
          page_type: sourceItem.pageType,
          content_class: sourceItem.contentClass
        },
        content_class: sourceItem.contentClass,
        risk_level: "normal",
        claim_text: fact.claim_text,
        evidence_text: fact.claim_text,
        fact_role: normalizeText(fact.fact_role) || "detail",
        support_type: normalizeText(fact.support_type) || "source_backed",
        source_span_refs_json: [],
        source_chunk_ids_json: [],
        qualifier_json: { statements: uniqueValues(fact.qualifiers || []) },
        boundary_json: { statements: uniqueValues(fact.boundary_notes || []) },
        support_metadata_json: { next_steps: uniqueValues(fact.next_steps || []), card_ids: [] },
        search_text: factSearchText(fact, fact.topic_name, fact.subtopic_name)
      };
      current.source_ref_ids_json = uniqueValues([...(current.source_ref_ids_json || []), sourceRefId]);
      const spanRefs = buildSourceSpanRefs(sourceChunks, fact.source_chunk_ids);
      current.source_span_refs_json = [...(current.source_span_refs_json || []), ...spanRefs];
      current.source_chunk_ids_json = uniqueValues([...(current.source_chunk_ids_json || []), ...spanRefs.map((item) => item.source_chunk_id)]);
      current.qualifier_json = {
        statements: uniqueValues([...(current.qualifier_json?.statements || []), ...(fact.qualifiers || [])])
      };
      current.boundary_json = {
        statements: uniqueValues([...(current.boundary_json?.statements || []), ...(fact.boundary_notes || [])])
      };
      current.support_metadata_json = {
        ...(current.support_metadata_json || {}),
        next_steps: uniqueValues([...(current.support_metadata_json?.next_steps || []), ...(fact.next_steps || [])])
      };
      factMap.set(key, current);
      factIdByKey.set(normalizeText(fact.fact_key).toLowerCase(), current.knowledge_fact_id);
    }

    for (const card of extractedCards) {
      const topicId = findTopicId(topicRows, card.topic_name);
      const subtopicId = findSubtopicId(topicRows, card.topic_name, card.subtopic_name);
      const key = [
        normalizeText(card.topic_name).toLowerCase(),
        normalizeText(card.subtopic_name).toLowerCase(),
        normalizeText(card.card_role).toLowerCase(),
        normalizeText(card.canonical_name).toLowerCase()
      ].join("::");
      const supportingFactIds = uniqueValues((card.supporting_fact_keys || []).map((factKey) => factIdByKey.get(normalizeText(factKey).toLowerCase())));
      const supportingFacts = Array.from(factMap.values()).filter((factRow) => supportingFactIds.includes(factRow.knowledge_fact_id));
      const current = cardMap.get(key) || {
        knowledge_card_id: createId("kc"),
        tenant_key: buildInfo.tenant_key,
        build_id: buildInfo.build_id,
        domain_id: buildInfo.primaryDomainId,
        subdomain_id: buildInfo.primarySubdomainId,
        knowledge_topic_id: topicId,
        knowledge_subtopic_id: subtopicId,
        card_type: "answer_unit",
        card_role: normalizeText(card.card_role) || "answer_unit",
        object_type: "knowledge_answer_unit",
        canonical_name: card.canonical_name,
        topic_path: uniqueValues([card.topic_name, card.subtopic_name]).join(" / ") || null,
        intent_tags_json: uniqueValues([card.card_role, card.topic_name, card.subtopic_name]),
        entity_tags_json: [],
        aliases_json: uniqueValues(card.aliases || []),
        caller_phrases_json: uniqueValues(card.caller_phrases || []),
        scope_json: {
          source_authority: sourceItem.sourceAuthority,
          source_channel: sourceItem.sourceChannel,
          source_locator: sourceItem.sourceLocator,
          page_type: sourceItem.pageType,
          content_class: sourceItem.contentClass
        },
        speakable_summary: truncateText(card.summary, 300),
        support_summary: truncateText(card.support_summary || card.summary, 420),
        answer_facts_json: [],
        related_card_ids_json: [],
        source_ref_ids_json: [],
        source_span_refs_json: [],
        content_class: sourceItem.contentClass,
        allowed_uses_json: ["answer", "clarify", "advance_next_step"],
        risk_level: sourceItem.contentClass === "policy_boundary" ? "high" : "normal",
        quality_score: 0.8,
        search_text: cardSearchText(card, supportingFacts, card.topic_name, card.subtopic_name),
        support_metadata_json: {
          fact_ids: supportingFactIds
        }
      };
      current.aliases_json = uniqueValues([...(current.aliases_json || []), ...(card.aliases || [])]);
      current.caller_phrases_json = uniqueValues([...(current.caller_phrases_json || []), ...(card.caller_phrases || [])]);
      current.source_ref_ids_json = uniqueValues([...(current.source_ref_ids_json || []), sourceRefId]);
      current.answer_facts_json = uniqueValues(supportingFacts.map((factRow) => factRow.knowledge_fact_id)).map((knowledgeFactId) => {
        const factRow = Array.from(factMap.values()).find((item) => item.knowledge_fact_id === knowledgeFactId);
        return factRow ? {
          fact_id: factRow.knowledge_fact_id,
          claim: factRow.claim_text,
          fact_role: factRow.fact_role
        } : null;
      }).filter(Boolean);
      const spanRefs = buildSourceSpanRefs(sourceChunks, card.source_chunk_ids);
      current.source_span_refs_json = [...(current.source_span_refs_json || []), ...spanRefs];
      current.support_metadata_json = {
        ...(current.support_metadata_json || {}),
        fact_ids: uniqueValues([...(current.support_metadata_json?.fact_ids || []), ...supportingFactIds])
      };
      cardMap.set(key, current);
    }
  }

  for (const card of cardMap.values()) {
    const linkedFactIds = uniqueValues(card.support_metadata_json?.fact_ids || []);
    for (const factId of linkedFactIds) {
      const factRow = Array.from(factMap.values()).find((item) => item.knowledge_fact_id === factId);
      if (!factRow) continue;
      factRow.support_metadata_json = {
        ...(factRow.support_metadata_json || {}),
        next_steps: uniqueValues(factRow.support_metadata_json?.next_steps || []),
        card_ids: uniqueValues([...(factRow.support_metadata_json?.card_ids || []), card.knowledge_card_id])
      };
    }
  }

  for (const fact of factMap.values()) {
    fact.search_text = factSearchText(fact, fact.subject, "");
  }
  for (const card of cardMap.values()) {
    card.source_span_refs_json = uniqueValues((card.source_span_refs_json || []).map((item) => JSON.stringify(item))).map((item) => JSON.parse(item));
  }

  return {
    facts: Array.from(factMap.values()),
    cards: Array.from(cardMap.values())
  };
}

function serializeEmbedding(embedding) {
  return `[${embedding.map((value) => Number(value || 0)).join(",")}]`;
}

async function embedArtifacts(cards, facts, buildInfo) {
  const cardTexts = cards.map((card) => card.search_text);
  const factTexts = facts.map((fact) => fact.search_text || fact.claim_text);
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const [cardEmbeddings, factEmbeddings] = await Promise.all([
    embedOpenAiTexts({ model: embeddingModel, texts: cardTexts }),
    embedOpenAiTexts({ model: embeddingModel, texts: factTexts })
  ]);
  return {
    embeddingModel,
    cardVectors: cards.map((card, index) => ({
      tenant_key: buildInfo.tenant_key,
      build_id: buildInfo.build_id,
      knowledge_card_id: card.knowledge_card_id,
      embedding_model: embeddingModel,
      embedding: serializeEmbedding(cardEmbeddings[index]?.embedding || [])
    })),
    factVectors: facts.map((fact, index) => ({
      tenant_key: buildInfo.tenant_key,
      build_id: buildInfo.build_id,
      knowledge_fact_id: fact.knowledge_fact_id,
      embedding_model: embeddingModel,
      embedding: serializeEmbedding(factEmbeddings[index]?.embedding || [])
    }))
  };
}

export async function compileKnowledgeBuildArtifacts({ db, buildInfo }) {
  const buildModel = process.env.OPENAI_KNOWLEDGE_BUILD_MODEL || "gpt-4.1";
  const warnings = [];
  const sourceRecords = selectSourceCompileRecords(await loadSourceCompileRecords(db, buildInfo), warnings);
  const sourceChunks = sourceRecords.flatMap((record) => record.sourceChunks);
  logCompilerProgress("compiler_started", {
    buildId: buildInfo.build_id,
    sourceCount: sourceRecords.length,
    chunkCount: sourceChunks.length
  });

  const sourceSummaries = await runSourceSummaryStage(db, buildInfo, sourceRecords, buildModel, warnings);
  const sourceSummaryDigest = buildSourceSummaryDigest(sourceSummaries);

  logCompilerProgress("topic_inventory_started", {
    summaryCount: sourceSummaries.length
  });
  const { topicInventory, topicRows } = await runTopicInventoryStage(db, buildInfo, sourceRecords, sourceSummaries, buildModel, warnings);
  logCompilerProgress("topic_inventory_completed", {
    topicCount: topicRows.topics.length,
    subtopicCount: topicRows.subtopics.length
  });

  const sourceArtifactRows = await runSourceArtifactStage(db, buildInfo, sourceRecords, topicRows, warnings, buildModel);
  const artifactMap = new Map(sourceArtifactRows.map((row) => [row.source_ref_id, row]));
  const extractedBySource = sourceRecords.map((record) => {
    const stored = artifactMap.get(record.sourceRefId);
    const extracted = {
      cards: asArray(stored?.cards_json),
      facts: asArray(stored?.facts_json)
    };
    const enriched = ensureArtifactsHaveFallbackSupport({
      sourceItem: record.sourceItem,
      sourceChunks: record.sourceChunks,
      extracted,
      topicInventory
    });
    if (!(enriched.cards || []).length && !(enriched.facts || []).length && record.sourceChunks.length) {
      warnings.push(`artifact_extraction_empty:${record.sourceItem.sourceLocator}`);
    }
    return {
      sourceItem: record.sourceItem,
      sourceRefId: record.sourceRefId,
      sourceChunks: record.sourceChunks,
      cards: enriched.cards,
      facts: enriched.facts
    };
  });

  const consolidated = consolidateArtifacts(buildInfo, topicRows, extractedBySource);
  logCompilerProgress("artifact_consolidation_completed", {
    cardCount: consolidated.cards.length,
    factCount: consolidated.facts.length
  });
  await updateBuildCheckpoint(db, buildInfo.build_id, {
    artifact_consolidation_stage: stageCheckpoint("artifact_consolidation", {
      card_count: consolidated.cards.length,
      fact_count: consolidated.facts.length
    })
  });
  const embedded = await embedArtifacts(consolidated.cards, consolidated.facts, buildInfo);
  logCompilerProgress("artifact_embeddings_completed", {
    cardVectorCount: embedded.cardVectors.length,
    factVectorCount: embedded.factVectors.length,
    embeddingModel: embedded.embeddingModel
  });
  await updateBuildCheckpoint(db, buildInfo.build_id, {
    artifact_embedding_stage: stageCheckpoint("artifact_embedding", {
      card_vector_count: embedded.cardVectors.length,
      fact_vector_count: embedded.factVectors.length,
      embedding_model: embedded.embeddingModel
    })
  });

  return {
    sourceChunks,
    topics: topicRows.topics,
    subtopics: topicRows.subtopics,
    cards: consolidated.cards,
    facts: consolidated.facts,
    cardVectors: embedded.cardVectors,
    factVectors: embedded.factVectors,
    topicInventorySummary: {
      topic_count: topicRows.topics.length,
      subtopic_count: topicRows.subtopics.length,
      summary_count: sourceSummaries.length,
      source_summary_digest: sourceSummaryDigest
    },
    embeddingModel: embedded.embeddingModel,
    plannerModel: process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini",
    compilerVersion: "planner_pgvector_v2_batched",
    warnings
  };
}
