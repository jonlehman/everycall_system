import { getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess, requireTenantRoles } from "../../_lib/billing.js";
import { listKnowledgeGuardrails, saveKnowledgeGuardrail } from "../../_lib/knowledgeReceptionistConfig.js";

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
      const guardrails = await listKnowledgeGuardrails(pool, tenantKey);
      return res.status(200).json({ ok: true, guardrails });
    }

    if (req.method === "POST") {
      const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
        message: "Only account admins and owners can update guardrails."
      });
      if (!manager) return;
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const guardrail = await saveKnowledgeGuardrail(pool, tenantKey, body.guardrail || body, session);
      return res.status(200).json({ ok: true, guardrail });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    return fail(res, 500, "knowledge_guardrail_error", message);
  }
}
