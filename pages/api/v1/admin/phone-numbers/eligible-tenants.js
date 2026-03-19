import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const result = await pool.query(
      `SELECT
         t.tenant_key,
         t.name,
         t.status,
         tu.owner_name,
         tu.owner_email
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT name AS owner_name, email AS owner_email
         FROM tenant_users
         WHERE tenant_key = t.tenant_key
           AND role = 'owner'
         ORDER BY id ASC
         LIMIT 1
       ) tu ON TRUE
       WHERE COALESCE(NULLIF(TRIM(t.telnyx_voice_number), ''), '') = ''
       ORDER BY t.name ASC, t.tenant_key ASC`
    );

    return res.status(200).json({
      ok: true,
      tenants: (result.rows || []).map((row) => ({
        tenantKey: row.tenant_key,
        tenantName: row.name,
        status: row.status,
        ownerName: row.owner_name || "",
        ownerEmail: row.owner_email || ""
      }))
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "eligible_tenants_error",
      message: err?.message || "unknown"
    });
  }
}
