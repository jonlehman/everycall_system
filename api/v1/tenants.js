import { ensureTables, getPool, seedDemoData } from "../_lib/db.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    await seedDemoData(pool);

    if (req.method === "GET") {
      const tenantKey = req.query?.tenantKey;
      if (tenantKey) {
        const row = await pool.query(
          `SELECT tenant_key, name, status, data_region, plan, primary_number
           FROM tenants
           WHERE tenant_key = $1
           LIMIT 1`,
          [String(tenantKey)]
        );
        return res.status(200).json({ tenant: row.rows[0] || null });
      }

      const rows = await pool.query(
        `SELECT t.tenant_key, t.name, t.status, t.data_region, t.plan, t.primary_number,
                (SELECT COUNT(*)::int FROM tenant_users u WHERE u.tenant_key = t.tenant_key) AS user_count
         FROM tenants t
         ORDER BY t.name ASC`
      );
      return res.status(200).json({ tenants: rows.rows });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const tenantKey = String(body.tenantKey || "").trim();
      const name = String(body.name || "").trim();
      if (!tenantKey || !name) {
        return res.status(400).json({ error: "missing_fields" });
      }
      const status = String(body.status || "active");
      const dataRegion = String(body.dataRegion || "US");
      const plan = String(body.plan || "Growth");
      const primaryNumber = body.primaryNumber ? String(body.primaryNumber) : null;

      await pool.query(
        `INSERT INTO tenants (tenant_key, name, status, data_region, plan, primary_number)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_key)
         DO UPDATE SET name = EXCLUDED.name,
                       status = EXCLUDED.status,
                       data_region = EXCLUDED.data_region,
                       plan = EXCLUDED.plan,
                       primary_number = EXCLUDED.primary_number,
                       updated_at = NOW()`,
        [tenantKey, name, status, dataRegion, plan, primaryNumber]
      );

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "tenants_error", message: err?.message || "unknown" });
  }
}
