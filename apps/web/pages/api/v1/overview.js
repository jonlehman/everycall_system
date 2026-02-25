import { ensureTables, getPool } from "../_lib/db.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const tenantKey = getTenantKey(req);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= $2) AS calls_today,
         COUNT(*) FILTER (WHERE status = 'missed' AND created_at >= $2) AS missed,
         COUNT(*) FILTER (WHERE urgency = 'high' AND created_at >= $2) AS urgent
       FROM calls
       WHERE tenant_key = $1`,
      [tenantKey, since]
    );

    const callbacks = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM dispatch_queue
       WHERE tenant_key = $1 AND status IN ('new', 'pending')`,
      [tenantKey]
    );

    const recentCalls = await pool.query(
      `SELECT call_sid, from_number, status, summary, urgency, created_at
       FROM calls
       WHERE tenant_key = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [tenantKey]
    );

    const actionQueue = await pool.query(
      `SELECT caller_name, summary, due_at
       FROM dispatch_queue
       WHERE tenant_key = $1
       ORDER BY due_at ASC
       LIMIT 6`,
      [tenantKey]
    );

    return res.status(200).json({
      tenantKey,
      stats: {
        callsToday: Number(stats.rows[0]?.calls_today || 0),
        missed: Number(stats.rows[0]?.missed || 0),
        urgent: Number(stats.rows[0]?.urgent || 0),
        callbacksDue: Number(callbacks.rows[0]?.count || 0)
      },
      recentCalls: recentCalls.rows,
      actionQueue: actionQueue.rows
    });
  } catch (err) {
    return res.status(500).json({ error: "overview_error", message: err?.message || "unknown" });
  }
}
