import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    const rows = await pool.query(
      `SELECT tenant_key, actor, action, details, created_at
       FROM audit_log
       ORDER BY created_at DESC
       LIMIT 50`
    );
    return res.status(200).json({ entries: rows.rows });
  } catch (err) {
    return res.status(500).json({ error: "admin_audit_error", message: err?.message || "unknown" });
  }
}
