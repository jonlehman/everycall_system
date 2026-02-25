import { ensureTables, getPool, seedDemoData } from "../_lib/db.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "bobs_plumbing");
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    await seedDemoData(pool);

    const tenantKey = getTenantKey(req);

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
        tenant: tenant.rows[0] || null,
        settings: settings.rows[0] || null
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const timezone = String(body.timezone || "America/Los_Angeles");
      const notes = String(body.notes || "");

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
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "settings_error", message: err?.message || "unknown" });
  }
}
