import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { loadTenantKnowledgeFeedbackEvents, loadTenantKnowledgeRuntime } from "../../_lib/knowledge.js";
import { reviewKnowledgeFeedbackEvent } from "../../_lib/knowledgeReview.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

function normalizeText(value) {
  return String(value || "").trim();
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
    const eventId = Number(body.eventId || 0);
    const action = normalizeText(body.action).toLowerCase();
    const resolutionText = normalizeText(body.resolutionText);

    const client = await pool.connect();
    let reviewed;
    try {
      await client.query("BEGIN");
      reviewed = await reviewKnowledgeFeedbackEvent(client, tenantKey, {
        eventId,
        action,
        resolutionText
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const [runtime, feedbackEvents] = await Promise.all([
      loadTenantKnowledgeRuntime(pool, tenantKey),
      loadTenantKnowledgeFeedbackEvents(pool, tenantKey, { limit: 12 })
    ]);

    return res.status(200).json({
      ok: true,
      reviewed,
      runtimeCounts: runtime.counts || { runtimeCardCount: 0, runtimeFactCount: 0 },
      feedbackEvents
    });
  } catch (err) {
    return fail(500, "knowledge_feedback_review_error", err?.message || "unknown");
  }
}
