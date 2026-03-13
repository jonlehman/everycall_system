import { ensureTables, getPool } from "../_lib/db.js";
import { requireSession, resolveTenantKey } from "../_lib/auth.js";
import { requireTenantBillingAccess } from "../_lib/billing.js";
import {
  compileTenantKnowledge,
  loadTenantKnowledgeAuthoring,
  loadTenantKnowledgeFeedbackEvents,
  loadTenantKnowledgeRuntime
} from "../_lib/knowledge.js";
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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function normalizeSiteTopicsInput(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];

  for (const raw of items) {
    const id = raw?.id ? String(raw.id) : null;
    const topicPath = normalizeText(raw?.topicPath || raw?.topic_path);
    const dedupeKey = id || topicPath.toLowerCase();
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push({
      id,
      topicPath,
      displayTitle: normalizeText(raw?.displayTitle || raw?.display_title) || topicPath,
      summaryObjective: normalizeText(raw?.summaryObjective || raw?.summary_objective),
      riskLevel: normalizeText(raw?.riskLevel || raw?.risk_level) || null
    });
  }

  return normalized;
}

async function loadKnowledgeResponse(pool, tenantKey) {
  const [authoring, runtime, feedbackEvents] = await Promise.all([
    loadTenantKnowledgeAuthoring(pool, tenantKey, { includeEmptyTemplates: true }),
    loadTenantKnowledgeRuntime(pool, tenantKey),
    loadTenantKnowledgeFeedbackEvents(pool, tenantKey, { limit: 12 })
  ]);
  return {
    ...authoring,
    runtimeCounts: runtime.counts || { runtimeCardCount: 0, runtimeFactCount: 0 },
    feedbackEvents
  };
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
      const knowledge = await loadKnowledgeResponse(pool, tenantKey);
      return res.status(200).json({ ok: true, ...knowledge });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const hasKnowledgeEntriesInput = Array.isArray(body.knowledgeEntries);
      const hasSiteTopicsInput = Array.isArray(body.siteTopics);
      const hasGuardrailQuestionTestsInput = Array.isArray(body.guardrailQuestionTests);
      const knowledgeEntries = hasKnowledgeEntriesInput ? normalizeKnowledgeEntriesInput(body.knowledgeEntries) : [];
      const siteTopics = hasSiteTopicsInput ? normalizeSiteTopicsInput(body.siteTopics) : [];
      const guardrailQuestionTests = hasGuardrailQuestionTestsInput
        ? normalizeGuardrailQuestionTestsInput(body.guardrailQuestionTests)
        : [];

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (hasKnowledgeEntriesInput) {
          const existingEntryRes = await client.query(
            `SELECT id, entry_type, section_type, metadata_json
             FROM knowledge_entries
             WHERE tenant_key = $1`,
            [tenantKey]
          );
          const entryBySection = new Map(
            existingEntryRes.rows
              .filter((row) => row?.section_type)
              .map((row) => [String(row.section_type), row])
          );

          for (const entry of knowledgeEntries) {
            const existingRow = (entry.id
              ? existingEntryRes.rows.find((row) => Number(row.id) === Number(entry.id))
              : null) || entryBySection.get(entry.sectionType);
            const metadataJson = JSON.stringify({
              ...asObject(existingRow?.metadata_json),
              sourceType: entry.sourceType,
              sourceConfidence: entry.sourceConfidence
            });
            const existingId = existingRow ? Number(existingRow.id) : null;
            if (existingId) {
              await client.query(
                `UPDATE knowledge_entries
                 SET entry_type = $3,
                     section_type = $4,
                     title = $5,
                     content_text = $6,
                     source_url = $7,
                     compilation_status = 'compiled',
                     metadata_json = $8::jsonb,
                     created_by_type = 'tenant',
                     updated_at = NOW()
                 WHERE tenant_key = $1 AND id = $2`,
                [
                  tenantKey,
                  existingId,
                  normalizeText(existingRow.entry_type) || "manual_note",
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
        }

        if (hasSiteTopicsInput) {
          const existingTopicRes = await client.query(
            `SELECT id, topic_path, risk_level
             FROM site_topics
             WHERE tenant_key = $1`,
            [tenantKey]
          );
          const topicByPath = new Map(
            existingTopicRes.rows
              .filter((row) => row?.topic_path)
              .map((row) => [String(row.topic_path), row])
          );

          for (const topic of siteTopics) {
            const existingRow = (topic.id
              ? existingTopicRes.rows.find((row) => Number(row.id) === Number(topic.id))
              : null) || topicByPath.get(topic.topicPath);
            if (!existingRow) continue;

            await client.query(
              `UPDATE site_topics
               SET display_title = $3,
                   summary_objective = $4,
                   risk_level = $5,
                   updated_at = NOW()
               WHERE tenant_key = $1
                 AND id = $2`,
              [
                tenantKey,
                Number(existingRow.id),
                topic.displayTitle,
                topic.summaryObjective,
                topic.riskLevel || normalizeText(existingRow.risk_level) || "normal"
              ]
            );
          }
        }

        if (hasGuardrailQuestionTestsInput) {
          const existingQuestionRes = await client.query(
            `SELECT id, question_text, supporting_artifacts_json
             FROM guardrail_question_tests
             WHERE tenant_key = $1
               AND status = 'active'`,
            [tenantKey]
          );
          const questionByText = new Map(
            existingQuestionRes.rows
              .filter((row) => row?.question_text)
              .map((row) => [String(row.question_text), row])
          );

          for (const item of guardrailQuestionTests) {
            const answer = item.answer;
            const reviewStatus = answer ? "approved" : "pending";
            const existingRow = (item.id
              ? existingQuestionRes.rows.find((row) => Number(row.id) === Number(item.id))
              : null) || questionByText.get(item.questionText);
            const artifactsJson = JSON.stringify({
              ...asObject(existingRow?.supporting_artifacts_json),
              sourceType: item.sourceType,
              sourceUrl: item.sourceUrl,
              sourceConfidence: item.sourceConfidence,
              serviceTags: item.serviceTags
            });
            const existingId = existingRow ? Number(existingRow.id) : null;
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
        }

        await compileTenantKnowledge(client, tenantKey);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      const knowledge = await loadKnowledgeResponse(pool, tenantKey);
      return res.status(200).json({ ok: true, ...knowledge });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    return fail(500, "knowledge_error", err?.message || "unknown");
  }
}
