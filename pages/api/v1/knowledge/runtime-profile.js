import { getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { loadKnowledgeRuntimeProfile, saveKnowledgeRuntimeProfile } from "../../_lib/knowledgeReceptionistConfig.js";

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
      const profile = await loadKnowledgeRuntimeProfile(pool, tenantKey);
      return res.status(200).json({ ok: true, profile });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const current = await loadKnowledgeRuntimeProfile(pool, tenantKey);
      const incoming = body.profile || body;
      const profile = await saveKnowledgeRuntimeProfile(pool, tenantKey, {
        ...current,
        ...incoming,
        session_config: {
          ...(current?.session_config || {}),
          ...(incoming?.session_config || {})
        },
        tool_policy: {
          ...(current?.tool_policy || {}),
          ...(incoming?.tool_policy || {})
        },
        wording_defaults: {
          ...(current?.wording_defaults || {}),
          ...(incoming?.wording_defaults || {})
        },
        runtime_defaults: {
          ...(current?.runtime_defaults || {}),
          ...(incoming?.runtime_defaults || {})
        }
      }, session);
      return res.status(200).json({ ok: true, profile });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    return fail(res, 500, "runtime_profile_error", message);
  }
}
