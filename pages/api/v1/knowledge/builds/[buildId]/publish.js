import { getPool } from "../../../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../../../_lib/billing.js";
import { publishKnowledgeBuild } from "../../../../_lib/knowledgeReceptionistBuilds.js";

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
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || ""));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    const buildId = String(req.query?.buildId || "").trim();
    if (!buildId) {
      return fail(res, 400, "build_id_required", "Build ID is required.");
    }

    const result = await publishKnowledgeBuild(pool, tenantKey, buildId);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    if (message === "build_not_found") {
      return fail(res, 404, "build_not_found", "Build not found.");
    }
    if (message === "build_not_ready_to_publish") {
      return fail(res, 409, "build_not_ready_to_publish", "Only ready-to-publish builds can be activated.");
    }
    return fail(res, 500, "build_publish_error", message);
  }
}
