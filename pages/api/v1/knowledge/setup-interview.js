import { getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import {
  createSetupInterviewSessionSkeleton,
  loadSetupInterviewState,
  saveSetupInterviewSubmission,
  saveSetupInterviewIntent
} from "../../_lib/knowledgeReceptionistSetupInterview.js";

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || req.body?.tenantKey || ""));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    if (req.method === "GET") {
      const state = await loadSetupInterviewState(pool, tenantKey);
      return res.status(200).json({ ok: true, ...state });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      if (body.intent && body.session) {
        const result = await saveSetupInterviewSubmission(pool, tenantKey, body);
        return res.status(200).json({ ok: true, ...result });
      }
      const intent = body.intent ? await saveSetupInterviewIntent(pool, tenantKey, body.intent) : null;
      const sessionSkeleton = body.session
        ? await createSetupInterviewSessionSkeleton(pool, tenantKey, {
            ...body.session,
            setupInterviewIntentId: body.session.setupInterviewIntentId || intent?.setup_interview_intent_id || null
          })
        : null;
      return res.status(200).json({ ok: true, intent, session: sessionSkeleton?.session || null, summaryBlocks: sessionSkeleton?.summaryBlocks || [] });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    if (message === "setup_interview_intent_not_found") {
      return fail(res, 404, "setup_interview_intent_not_found", "The referenced setup interview intent was not found.");
    }
    if (message === "setup_interview_intent_tenant_mismatch") {
      return fail(res, 403, "setup_interview_intent_tenant_mismatch", "The referenced setup interview intent does not belong to the tenant.");
    }
    return fail(res, 500, "setup_interview_error", message);
  }
}
