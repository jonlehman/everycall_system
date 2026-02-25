import { ensureTables, getPool } from "../../_lib/db.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const rows = await pool.query(
      `SELECT username, email, role, last_active_at
       FROM admin_users
       ORDER BY username ASC`
    );
    return res.status(200).json({ users: rows.rows });
  } catch (err) {
    return res.status(500).json({ error: "admin_users_error", message: err?.message || "unknown" });
  }
}
