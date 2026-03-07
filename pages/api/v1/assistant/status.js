import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { getSetupReadiness } from "../../_lib/setupReadiness.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
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
      const readiness = await getSetupReadiness(pool, tenantKey);
      if (!readiness.ready && readiness.requestedEnabled) {
        await pool.query(
          `UPDATE tenant_settings
           SET assistant_enabled = false, updated_at = NOW()
           WHERE tenant_key = $1`,
          [tenantKey]
        );
        readiness.requestedEnabled = false;
        readiness.enabled = false;
      }
      return res.status(200).json({ ok: true, assistant: readiness });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const enabled = body.enabled === true;
      const readiness = await getSetupReadiness(pool, tenantKey);
      if (enabled && !readiness.ready) {
        return fail(409, "setup_incomplete", "Assistant cannot be enabled until setup is complete.", {
          assistant: readiness
        });
      }

      await pool.query(
        `INSERT INTO tenant_settings (tenant_key, timezone, notes, assistant_enabled)
         VALUES ($1, 'America/Los_Angeles', '', $2)
         ON CONFLICT (tenant_key)
         DO UPDATE SET assistant_enabled = EXCLUDED.assistant_enabled, updated_at = NOW()`,
        [tenantKey, enabled]
      );

      await pool.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, 'tenant_user', 'assistant.enabled_updated', $2)`,
        [tenantKey, `enabled=${enabled}`]
      );

      const updated = await getSetupReadiness(pool, tenantKey);
      return res.status(200).json({ ok: true, assistant: updated });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    return fail(500, "assistant_status_error", err?.message || "unknown");
  }
}
