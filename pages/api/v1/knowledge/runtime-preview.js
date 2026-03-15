import { getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { assembleKnowledgeRuntimePreview } from "../../_lib/knowledgeReceptionistPrompt.js";

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  }

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

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const preview = await assembleKnowledgeRuntimePreview(pool, tenantKey, body);
    return res.status(200).json({ ok: true, ...preview });
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "query_required") {
      return fail(res, 400, "query_required", "A caller query is required to assemble a runtime preview.");
    }
    if (message === "no_active_build") {
      return fail(res, 409, "no_active_build", "There is no active published build for this tenant.");
    }
    if (message === "build_not_found") {
      return fail(res, 404, "build_not_found", "The requested build was not found for this tenant.");
    }
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    return fail(res, 500, "runtime_preview_error", message);
  }
}
