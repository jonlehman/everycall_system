import { ensureTables, getPool, seedDemoData } from "../../_lib/db.js";

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
      const rows = await pool.query(
        `SELECT id, name, email, role, status
         FROM tenant_users
         WHERE tenant_key = $1
         ORDER BY id ASC`,
        [tenantKey]
      );
      return res.status(200).json({ users: rows.rows });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim();
      if (!name || !email) {
        return res.status(400).json({ error: "missing_fields" });
      }
      const role = String(body.role || "member");
      const status = String(body.status || "active");
      await pool.query(
        `INSERT INTO tenant_users (tenant_key, name, email, role, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantKey, name, email, role, status]
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "tenant_users_error", message: err?.message || "unknown" });
  }
}
