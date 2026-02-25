import { ensureTables, getPool } from "../../_lib/db.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const rows = await pool.query(
      `SELECT id, tenant_key, stage, status, updated_at
       FROM provisioning_jobs
       ORDER BY updated_at DESC
       LIMIT 50`
    );
    return res.status(200).json({ jobs: rows.rows });
  } catch (err) {
    return res.status(500).json({ error: "admin_jobs_error", message: err?.message || "unknown" });
  }
}
