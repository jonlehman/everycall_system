import { ensureTables, getPool } from "../../_lib/db.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const tenants = await pool.query(`SELECT COUNT(*)::int AS count FROM tenants WHERE status = 'active'`);
    const calls = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= $1) AS calls_24h,
         COUNT(*) FILTER (WHERE status = 'error' AND created_at >= $1) AS errors_24h,
         AVG(latency_ms) FILTER (WHERE created_at >= $1) AS avg_latency
       FROM calls`,
      [since]
    );

    const incidents = await pool.query(
      `SELECT tenant_key, issue, status, created_at
       FROM incidents
       ORDER BY created_at DESC
       LIMIT 5`
    );

    return res.status(200).json({
      stats: {
        activeTenants: Number(tenants.rows[0]?.count || 0),
        calls24h: Number(calls.rows[0]?.calls_24h || 0),
        errors24h: Number(calls.rows[0]?.errors_24h || 0),
        avgLatencyMs: Math.round(Number(calls.rows[0]?.avg_latency || 0))
      },
      incidents: incidents.rows
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_overview_error", message: err?.message || "unknown" });
  }
}
