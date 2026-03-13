import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { loadTenantKnowledgeFeedbackEvents, loadTenantKnowledgeRuntime } from "../../_lib/knowledge.js";
import { buildKnowledgeRetrieval, generateKnowledgeAnswerPreview } from "../../_lib/knowledgeReview.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function asStringArray(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

export default async function handler(req, res) {
  const fail = (status, error, message, extra = {}) =>
    res.status(status).json({ ok: false, error, message, ...extra });

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return fail(405, "method_not_allowed", "Method not allowed.");
    }

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

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const questionText = normalizeText(body.questionText || body.query);
    if (!questionText) {
      return fail(400, "missing_question", "Question text is required.");
    }

    const runtime = await loadTenantKnowledgeRuntime(pool, tenantKey);
    const retrieval = buildKnowledgeRetrieval(runtime, {
      query: questionText,
      topic: normalizeText(body.topic) || null,
      topicHints: asStringArray(body.topicHints),
      serviceTags: asStringArray(body.serviceTags || body.service_tags),
      tradeHint: normalizeText(body.tradeHint || body.trade) || null,
      conversationStage: normalizeText(body.conversationStage || body.conversation_stage) || null
    });
    const answerPreview = await generateKnowledgeAnswerPreview(questionText, retrieval);
    const feedbackEvents = await loadTenantKnowledgeFeedbackEvents(pool, tenantKey, { limit: 8 });

    return res.status(200).json({
      ok: true,
      questionText,
      retrieval,
      answerPreview,
      runtimeCounts: runtime.counts || { runtimeCardCount: 0, runtimeFactCount: 0 },
      feedbackEvents
    });
  } catch (err) {
    return fail(500, "knowledge_query_error", err?.message || "unknown");
  }
}
