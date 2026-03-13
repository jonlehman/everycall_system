import { ensureTables, getPool } from "../_lib/db.js";
import { requireSession, resolveTenantKey } from "../_lib/auth.js";
import { requireTenantBillingAccess } from "../_lib/billing.js";
import { loadTenantKnowledge } from "../_lib/knowledge.js";
import {
  createBlankGuardrailQuestionTests,
  createBlankKnowledgeEntries
} from "../../../lib/knowledgeTemplates.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

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

function normalizeKnowledgeEntriesInput(value) {
  const templates = createBlankKnowledgeEntries();
  const templateBySection = new Map(templates.map((item) => [item.sectionType, item]));
  const items = Array.isArray(value) ? value : templates;
  const seen = new Set();
  const normalized = [];

  for (const raw of items) {
    const sectionType = normalizeText(raw?.sectionType || raw?.section_type);
    if (!sectionType || seen.has(sectionType)) continue;
    seen.add(sectionType);
    const template = templateBySection.get(sectionType);
    normalized.push({
      id: raw?.id ? String(raw.id) : null,
      sectionType,
      title: normalizeText(raw?.title) || template?.title || sectionType,
      contentText: normalizeText(raw?.contentText || raw?.content_text),
      sourceType: normalizeText(raw?.sourceType || raw?.source_type) || null,
      sourceUrl: normalizeText(raw?.sourceUrl || raw?.source_url) || null,
      sourceConfidence: toNumberOrNull(raw?.sourceConfidence ?? raw?.source_confidence)
    });
  }

  for (const template of templates) {
    if (seen.has(template.sectionType)) continue;
    normalized.push({
      id: null,
      sectionType: template.sectionType,
      title: template.title,
      contentText: "",
      sourceType: null,
      sourceUrl: null,
      sourceConfidence: null
    });
  }

  return normalized;
}

function normalizeGuardrailQuestionTestsInput(value) {
  const templates = createBlankGuardrailQuestionTests();
  const templateByQuestion = new Map(templates.map((item) => [item.questionText, item]));
  const items = Array.isArray(value) ? value : templates;
  const seen = new Set();
  const normalized = [];

  for (const raw of items) {
    const questionText = normalizeText(raw?.questionText || raw?.question_text);
    if (!questionText || seen.has(questionText)) continue;
    seen.add(questionText);
    const template = templateByQuestion.get(questionText);
    const answer = normalizeText(raw?.answer || raw?.approvedAnswer || raw?.approved_answer || raw?.draftAnswer || raw?.draft_answer);
    normalized.push({
      id: raw?.id ? String(raw.id) : null,
      topic: normalizeText(raw?.topic) || template?.topic || null,
      questionText,
      riskLevel: normalizeText(raw?.riskLevel || raw?.risk_level) || template?.riskLevel || "high",
      answer,
      sourceType: normalizeText(raw?.sourceType || raw?.source_type) || null,
      sourceUrl: normalizeText(raw?.sourceUrl || raw?.source_url) || null,
      sourceConfidence: toNumberOrNull(raw?.sourceConfidence ?? raw?.source_confidence),
      serviceTags: asStringArray(raw?.serviceTags || raw?.service_tags)
    });
  }

  for (const template of templates) {
    if (seen.has(template.questionText)) continue;
    normalized.push({
      id: null,
      topic: template.topic,
      questionText: template.questionText,
      riskLevel: template.riskLevel,
      answer: "",
      sourceType: null,
      sourceUrl: null,
      sourceConfidence: null,
      serviceTags: []
    });
  }

  return normalized;
}

export default async function handler(req, res) {
  const fail = (status, error, message, extra = {}) =>
    res.status(status).json({ ok: false, error, message, ...extra });

  try {
    const pool = getPool();
    if (!pool) {
      return fail(500, "database_unavailable", "Database is unavailable.");
    }

    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, getTenantKey(req));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    if (req.method === "GET") {
      const knowledge = await loadTenantKnowledge(pool, tenantKey, { includeEmptyTemplates: true });
      return res.status(200).json({ ok: true, ...knowledge });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const knowledgeEntries = normalizeKnowledgeEntriesInput(body.knowledgeEntries);
      const guardrailQuestionTests = normalizeGuardrailQuestionTestsInput(body.guardrailQuestionTests);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const existingEntryRes = await client.query(
          `SELECT id, section_type
           FROM knowledge_entries
           WHERE tenant_key = $1`,
          [tenantKey]
        );
        const entryIdBySection = new Map(
          existingEntryRes.rows
            .filter((row) => row?.section_type)
            .map((row) => [String(row.section_type), Number(row.id)])
        );

        for (const entry of knowledgeEntries) {
          const metadataJson = JSON.stringify({
            sourceType: entry.sourceType,
            sourceConfidence: entry.sourceConfidence
          });
          const existingId = entry.id ? Number(entry.id) : entryIdBySection.get(entry.sectionType);
          if (existingId) {
            await client.query(
              `UPDATE knowledge_entries
               SET entry_type = 'manual_note',
                   section_type = $3,
                   title = $4,
                   content_text = $5,
                   source_url = $6,
                   compilation_status = 'compiled',
                   metadata_json = $7::jsonb,
                   created_by_type = 'tenant',
                   updated_at = NOW()
               WHERE tenant_key = $1 AND id = $2`,
              [
                tenantKey,
                existingId,
                entry.sectionType,
                entry.title,
                entry.contentText,
                entry.sourceUrl,
                metadataJson
              ]
            );
            continue;
          }

          await client.query(
            `INSERT INTO knowledge_entries (tenant_key, entry_type, section_type, title, content_text, source_url, compilation_status, metadata_json, created_by_type)
             VALUES ($1, 'manual_note', $2, $3, $4, $5, 'compiled', $6::jsonb, 'tenant')`,
            [
              tenantKey,
              entry.sectionType,
              entry.title,
              entry.contentText,
              entry.sourceUrl,
              metadataJson
            ]
          );
        }

        const existingQuestionRes = await client.query(
          `SELECT id, question_text
           FROM guardrail_question_tests
           WHERE tenant_key = $1
             AND status = 'active'`,
          [tenantKey]
        );
        const questionIdByText = new Map(
          existingQuestionRes.rows
            .filter((row) => row?.question_text)
            .map((row) => [String(row.question_text), Number(row.id)])
        );

        for (const item of guardrailQuestionTests) {
          const answer = item.answer;
          const reviewStatus = answer ? "approved" : "pending";
          const artifactsJson = JSON.stringify({
            sourceType: item.sourceType,
            sourceUrl: item.sourceUrl,
            sourceConfidence: item.sourceConfidence,
            serviceTags: item.serviceTags
          });
          const existingId = item.id ? Number(item.id) : questionIdByText.get(item.questionText);
          if (existingId) {
            await client.query(
              `UPDATE guardrail_question_tests
               SET topic = $3,
                   question_text = $4,
                   risk_level = $5,
                   service_tags = $6::text[],
                   draft_answer = $7,
                   approved_answer = $8,
                   review_status = $9,
                   supporting_artifacts_json = $10::jsonb,
                   updated_at = NOW()
               WHERE tenant_key = $1 AND id = $2`,
              [
                tenantKey,
                existingId,
                item.topic,
                item.questionText,
                item.riskLevel,
                item.serviceTags,
                answer || null,
                answer || null,
                reviewStatus,
                artifactsJson
              ]
            );
            continue;
          }

          await client.query(
            `INSERT INTO guardrail_question_tests (tenant_key, topic, question_text, risk_level, service_tags, draft_answer, approved_answer, review_status, supporting_artifacts_json)
             VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9::jsonb)`,
            [
              tenantKey,
              item.topic,
              item.questionText,
              item.riskLevel,
              item.serviceTags,
              answer || null,
              answer || null,
              reviewStatus,
              artifactsJson
            ]
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      const knowledge = await loadTenantKnowledge(pool, tenantKey, { includeEmptyTemplates: true });
      return res.status(200).json({ ok: true, ...knowledge });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    return fail(500, "knowledge_error", err?.message || "unknown");
  }
}
