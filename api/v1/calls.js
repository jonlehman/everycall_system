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
    const callSid = req.query?.callSid;

    if (callSid) {
      const detail = await pool.query(
        `SELECT c.call_sid, c.status, c.from_number, c.to_number, c.summary, c.urgency, c.disposition, c.created_at,
                d.transcript, d.extracted_json, d.routing_json
         FROM calls c
         LEFT JOIN call_details d ON d.call_sid = c.call_sid
         WHERE c.tenant_key = $1 AND c.call_sid = $2
         LIMIT 1`,
        [tenantKey, String(callSid)]
      );
      return res.status(200).json({ call: detail.rows[0] || null });
    }

    const limit = Math.max(1, Math.min(Number(req.query?.limit) || 30, 200));
    const rows = await pool.query(
      `SELECT call_sid, from_number, status, created_at
       FROM calls
       WHERE tenant_key = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantKey, limit]
    );

    return res.status(200).json({ calls: rows.rows });
  } catch (err) {
    return res.status(500).json({ error: "calls_error", message: err?.message || "unknown" });
  }
}
