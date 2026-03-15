import { ensureTables, getPool } from "../_lib/db.js";
import { requireSession, resolveTenantKey } from "../_lib/auth.js";
import { requireTenantBillingAccess } from "../_lib/billing.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

export default async function handler(req, res) {
  const fail = (status, error, message) => res.status(status).json({ ok: false, error, message });

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
      const tenant = await pool.query(
        `SELECT tenant_key, name, plan, data_region, status FROM tenants WHERE tenant_key = $1`,
        [tenantKey]
      );
      const settings = await pool.query(
        `SELECT tenant_key, timezone, notes FROM tenant_settings WHERE tenant_key = $1`,
        [tenantKey]
      );
      return res.status(200).json({
        ok: true,
        tenant: tenant.rows[0] || null,
        settings: settings.rows[0] || null
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const timezone = String(body.timezone || "America/Los_Angeles");
      const notes = String(body.notes || "");
      if (!timezone.trim()) {
        return fail(400, "invalid_timezone", "Timezone is required.");
      }

      await pool.query(
        `INSERT INTO tenant_settings (tenant_key, timezone, notes)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_key)
         DO UPDATE SET timezone = EXCLUDED.timezone, notes = EXCLUDED.notes, updated_at = NOW()`,
        [tenantKey, timezone, notes]
      );

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    return fail(500, "settings_error", err?.message || "unknown");
  }
}
