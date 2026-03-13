import { createBlankGuardrailQuestionTests, createBlankKnowledgeEntries } from "../../../lib/knowledgeTemplates.js";
import { getIndustryKnowledgeSeed } from "../../../lib/industryKnowledgeSeeds.js";
import { compileTenantKnowledge } from "./knowledge.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeQuestionKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function mapIndustryKnowledgeEntryRow(row) {
  return {
    id: row?.id ? String(row.id) : null,
    sectionType: normalizeText(row.section_type),
    title: normalizeText(row.title) || normalizeText(row.section_type),
    contentText: normalizeText(row.content_text),
    sourceType: normalizeText(row.source_type) || null,
    sourceUrl: normalizeText(row.source_url) || null,
    sourceConfidence: toNumberOrNull(row.source_confidence)
  };
}

function mapIndustryGuardrailRow(row) {
  return {
    id: row?.id ? String(row.id) : null,
    topic: normalizeText(row.topic) || null,
    questionText: normalizeText(row.question_text),
    riskLevel: normalizeText(row.risk_level) || "high",
    answer: normalizeText(row.answer),
    sourceType: normalizeText(row.source_type) || null,
    sourceUrl: normalizeText(row.source_url) || null,
    sourceConfidence: toNumberOrNull(row.source_confidence),
    serviceTags: asStringArray(row.service_tags)
  };
}

function mergeIndustryKnowledgeEntries(dbRows, seedRows) {
  const templates = createBlankKnowledgeEntries();
  const dbBySection = new Map((dbRows || []).map((row) => [row.sectionType, row]));
  const seedBySection = new Map((seedRows || []).map((row) => [row.sectionType, row]));
  const extras = (dbRows || []).filter((row) => !templates.some((template) => template.sectionType === row.sectionType));

  return [
    ...templates.map((template) => {
      if (dbBySection.has(template.sectionType)) return dbBySection.get(template.sectionType);
      if (seedBySection.has(template.sectionType)) return seedBySection.get(template.sectionType);
      return {
        id: null,
        sectionType: template.sectionType,
        title: template.title,
        contentText: "",
        sourceType: null,
        sourceUrl: null,
        sourceConfidence: null
      };
    }),
    ...extras
  ];
}

function mergeIndustryGuardrails(dbRows, seedRows) {
  const templates = createBlankGuardrailQuestionTests();
  const dbByQuestion = new Map((dbRows || []).map((row) => [normalizeQuestionKey(row.questionText), row]));
  const seedByQuestion = new Map((seedRows || []).map((row) => [normalizeQuestionKey(row.questionText), row]));
  const extras = (dbRows || []).filter((row) => !templates.some((template) => normalizeQuestionKey(template.questionText) === normalizeQuestionKey(row.questionText)));

  return [
    ...templates.map((template) => {
      const key = normalizeQuestionKey(template.questionText);
      if (dbByQuestion.has(key)) return dbByQuestion.get(key);
      if (seedByQuestion.has(key)) return seedByQuestion.get(key);
      return {
        id: null,
        topic: template.topic,
        questionText: template.questionText,
        riskLevel: template.riskLevel,
        answer: "",
        sourceType: null,
        sourceUrl: null,
        sourceConfidence: null,
        serviceTags: []
      };
    }),
    ...extras
  ];
}

export async function loadIndustryKnowledgeDefaults(db, industryKey) {
  const [entryRes, guardrailRes] = await Promise.all([
    db.query(
      `SELECT id, section_type, title, content_text, source_type, source_url, source_confidence
       FROM industry_knowledge_entries
       WHERE industry_key = $1
       ORDER BY section_type ASC, id ASC`,
      [industryKey]
    ),
    db.query(
      `SELECT id, topic, question_text, risk_level, answer, service_tags, source_type, source_url, source_confidence
       FROM industry_guardrail_question_templates
       WHERE industry_key = $1
       ORDER BY question_text ASC, id ASC`,
      [industryKey]
    )
  ]);

  const seed = getIndustryKnowledgeSeed(industryKey);
  const knowledgeEntries = mergeIndustryKnowledgeEntries(
    (entryRes.rows || []).map(mapIndustryKnowledgeEntryRow),
    seed.knowledgeEntries || []
  );
  const guardrailQuestionTests = mergeIndustryGuardrails(
    (guardrailRes.rows || []).map(mapIndustryGuardrailRow),
    seed.guardrailQuestionTests || []
  );

  return { knowledgeEntries, guardrailQuestionTests };
}

export async function saveIndustryKnowledgeDefaults(db, industryKey, knowledgeEntries, guardrailQuestionTests) {
  await db.query(`DELETE FROM industry_guardrail_question_templates WHERE industry_key = $1`, [industryKey]);
  await db.query(`DELETE FROM industry_knowledge_entries WHERE industry_key = $1`, [industryKey]);

  for (const entry of knowledgeEntries || []) {
    await db.query(
      `INSERT INTO industry_knowledge_entries (industry_key, section_type, title, content_text, source_type, source_url, source_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        industryKey,
        normalizeText(entry.sectionType) || "general",
        normalizeText(entry.title) || normalizeText(entry.sectionType) || "General",
        normalizeText(entry.contentText),
        normalizeText(entry.sourceType) || "industry_seed",
        normalizeText(entry.sourceUrl) || null,
        toNumberOrNull(entry.sourceConfidence)
      ]
    );
  }

  for (const item of guardrailQuestionTests || []) {
    await db.query(
      `INSERT INTO industry_guardrail_question_templates (industry_key, topic, question_text, risk_level, answer, service_tags, source_type, source_url, source_confidence)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9)`,
      [
        industryKey,
        normalizeText(item.topic) || null,
        normalizeText(item.questionText),
        normalizeText(item.riskLevel) || "high",
        normalizeText(item.answer),
        asStringArray(item.serviceTags),
        normalizeText(item.sourceType) || "industry_seed",
        normalizeText(item.sourceUrl) || null,
        toNumberOrNull(item.sourceConfidence)
      ]
    );
  }
}

export async function seedIndustryKnowledgeDefaults(db, industryKey, options = {}) {
  const force = options.force === true;
  const seed = getIndustryKnowledgeSeed(industryKey);
  const [entryCountRes, guardrailCountRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS count FROM industry_knowledge_entries WHERE industry_key = $1`, [industryKey]),
    db.query(`SELECT COUNT(*)::int AS count FROM industry_guardrail_question_templates WHERE industry_key = $1`, [industryKey])
  ]);

  const existingEntryCount = Number(entryCountRes.rows[0]?.count || 0);
  const existingGuardrailCount = Number(guardrailCountRes.rows[0]?.count || 0);
  const inserted = { knowledgeEntries: 0, guardrailQuestionTests: 0 };

  if (force || existingEntryCount === 0 || existingGuardrailCount === 0) {
    await saveIndustryKnowledgeDefaults(
      db,
      industryKey,
      seed.knowledgeEntries || [],
      seed.guardrailQuestionTests || []
    );
    inserted.knowledgeEntries = seed.knowledgeEntries?.length || 0;
    inserted.guardrailQuestionTests = seed.guardrailQuestionTests?.length || 0;
  }

  return inserted;
}

async function upsertIndustrySeedKnowledgeEntries(db, tenantKey, industryKey, knowledgeEntries) {
  const rows = await db.query(
    `SELECT id, section_type, content_text, created_by_type, created_by_id
     FROM knowledge_entries
     WHERE tenant_key = $1`,
    [tenantKey]
  );
  const bySection = new Map();
  for (const row of rows.rows || []) {
    const key = normalizeText(row.section_type);
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(row);
  }

  const activeSections = new Set();
  for (const entry of knowledgeEntries || []) {
    const sectionType = normalizeText(entry.sectionType);
    const contentText = normalizeText(entry.contentText);
    if (!sectionType || !contentText) continue;
    activeSections.add(sectionType);
    const existingRows = bySection.get(sectionType) || [];
    const manualRow = existingRows.find((row) => normalizeText(row.created_by_type) !== "industry_seed" && normalizeText(row.content_text));
    if (manualRow) {
      await db.query(
        `DELETE FROM knowledge_entries
         WHERE tenant_key = $1
           AND section_type = $2
           AND created_by_type = 'industry_seed'
           AND created_by_id = $3`,
        [tenantKey, sectionType, industryKey]
      );
      continue;
    }
    const seedRow = existingRows.find((row) => normalizeText(row.created_by_type) === "industry_seed" && normalizeText(row.created_by_id) === industryKey);
    const metadataJson = JSON.stringify({
      sourceType: normalizeText(entry.sourceType) || "industry_seed",
      sourceConfidence: toNumberOrNull(entry.sourceConfidence),
      importedFromIndustryKey: industryKey
    });

    if (seedRow) {
      await db.query(
        `UPDATE knowledge_entries
         SET entry_type = 'industry_seed',
             section_type = $3,
             title = $4,
             content_text = $5,
             source_url = $6,
             compilation_status = 'compiled',
             metadata_json = $7::jsonb,
             created_by_type = 'industry_seed',
             created_by_id = $8,
             updated_at = NOW()
         WHERE tenant_key = $1
           AND id = $2`,
        [
          tenantKey,
          Number(seedRow.id),
          sectionType,
          normalizeText(entry.title) || sectionType,
          contentText,
          normalizeText(entry.sourceUrl) || null,
          metadataJson,
          industryKey
        ]
      );
      continue;
    }

    await db.query(
      `INSERT INTO knowledge_entries (tenant_key, entry_type, section_type, title, content_text, source_url, compilation_status, metadata_json, created_by_type, created_by_id)
       VALUES ($1, 'industry_seed', $2, $3, $4, $5, 'compiled', $6::jsonb, 'industry_seed', $7)`,
      [
        tenantKey,
        sectionType,
        normalizeText(entry.title) || sectionType,
        contentText,
        normalizeText(entry.sourceUrl) || null,
        metadataJson,
        industryKey
      ]
    );
  }

  await db.query(
    `DELETE FROM knowledge_entries
     WHERE tenant_key = $1
       AND created_by_type = 'industry_seed'
       AND created_by_id = $2
       AND section_type <> ALL($3::text[])`,
    [tenantKey, industryKey, Array.from(activeSections)]
  );
}

async function upsertIndustrySeedGuardrails(db, tenantKey, industryKey, guardrailQuestionTests) {
  const existingRes = await db.query(
    `SELECT id, question_text, draft_answer, approved_answer, supporting_artifacts_json
     FROM guardrail_question_tests
     WHERE tenant_key = $1
       AND status = 'active'`,
    [tenantKey]
  );
  const rowsByQuestion = new Map();
  for (const row of existingRes.rows || []) {
    const key = normalizeQuestionKey(row.question_text);
    if (!rowsByQuestion.has(key)) rowsByQuestion.set(key, []);
    rowsByQuestion.get(key).push(row);
  }

  const activeQuestions = new Set();
  for (const item of guardrailQuestionTests || []) {
    const questionText = normalizeText(item.questionText);
    const answer = normalizeText(item.answer);
    if (!questionText || !answer) continue;
    const questionKey = normalizeQuestionKey(questionText);
    activeQuestions.add(questionKey);
    const rows = rowsByQuestion.get(questionKey) || [];
    const manualRow = rows.find((row) => {
      const meta = asObject(row.supporting_artifacts_json);
      const managedBy = normalizeText(meta.managedBy);
      const answerText = normalizeText(row.approved_answer) || normalizeText(row.draft_answer);
      return managedBy !== "industry_seed" && answerText;
    });
    if (manualRow) {
      await db.query(
        `DELETE FROM guardrail_question_tests
         WHERE tenant_key = $1
           AND lower(regexp_replace(question_text, '\s+', ' ', 'g')) = $2
           AND supporting_artifacts_json->>'managedBy' = 'industry_seed'
           AND supporting_artifacts_json->>'importedFromIndustryKey' = $3`,
        [tenantKey, questionKey, industryKey]
      );
      continue;
    }

    const seedRow = rows.find((row) => {
      const meta = asObject(row.supporting_artifacts_json);
      return normalizeText(meta.managedBy) === "industry_seed" && normalizeText(meta.importedFromIndustryKey) === industryKey;
    });
    const artifactsJson = JSON.stringify({
      managedBy: "industry_seed",
      importedFromIndustryKey: industryKey,
      sourceType: normalizeText(item.sourceType) || "industry_seed",
      sourceUrl: normalizeText(item.sourceUrl) || null,
      sourceConfidence: toNumberOrNull(item.sourceConfidence),
      serviceTags: asStringArray(item.serviceTags)
    });

    if (seedRow) {
      await db.query(
        `UPDATE guardrail_question_tests
         SET topic = $3,
             question_text = $4,
             risk_level = $5,
             service_tags = $6::text[],
             draft_answer = $7,
             approved_answer = $8,
             review_status = 'approved',
             supporting_artifacts_json = $9::jsonb,
             updated_at = NOW()
         WHERE tenant_key = $1
           AND id = $2`,
        [
          tenantKey,
          Number(seedRow.id),
          normalizeText(item.topic) || null,
          questionText,
          normalizeText(item.riskLevel) || "high",
          asStringArray(item.serviceTags),
          answer,
          answer,
          artifactsJson
        ]
      );
      continue;
    }

    await db.query(
      `INSERT INTO guardrail_question_tests (tenant_key, topic, question_text, risk_level, service_tags, draft_answer, approved_answer, review_status, supporting_artifacts_json)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, 'approved', $8::jsonb)`,
      [
        tenantKey,
        normalizeText(item.topic) || null,
        questionText,
        normalizeText(item.riskLevel) || "high",
        asStringArray(item.serviceTags),
        answer,
        answer,
        artifactsJson
      ]
    );
  }

  await db.query(
    `DELETE FROM guardrail_question_tests
     WHERE tenant_key = $1
       AND status = 'active'
       AND supporting_artifacts_json->>'managedBy' = 'industry_seed'
       AND supporting_artifacts_json->>'importedFromIndustryKey' = $2
       AND lower(regexp_replace(question_text, '\s+', ' ', 'g')) <> ALL($3::text[])`,
    [tenantKey, industryKey, Array.from(activeQuestions)]
  );
}

export async function applyIndustryKnowledgeToTenant(db, tenantKey, industryKey) {
  const { knowledgeEntries, guardrailQuestionTests } = await loadIndustryKnowledgeDefaults(db, industryKey);
  await upsertIndustrySeedKnowledgeEntries(db, tenantKey, industryKey, knowledgeEntries);
  await upsertIndustrySeedGuardrails(db, tenantKey, industryKey, guardrailQuestionTests);
  await compileTenantKnowledge(db, tenantKey);
}
