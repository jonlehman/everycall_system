import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { loadClientSetupStatus } from "../../_lib/clientSetupStatus.js";

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return fail(res, 405, "method_not_allowed", "Method not allowed.");
    }

    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }
    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || ""));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey, {
      allowBillingLocked: true,
      allowDeactivated: true
    });
    if (!access) return;

    const setupStatus = await loadClientSetupStatus(pool, tenantKey, { session });
    if (!setupStatus) {
      return fail(res, 404, "tenant_not_found", "Tenant not found.");
    }

    return res.status(200).json({
      ok: true,
      tenantKey,
      setupStatus
    });
  } catch (err) {
    return fail(res, 500, "client_setup_status_error", String(err?.message || "unknown"));
  }
}
