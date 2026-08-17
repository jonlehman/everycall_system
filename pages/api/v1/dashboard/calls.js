import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

const DEFAULT_LIMIT = 30;

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
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

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
      return res.status(200).json({ configured: true, detail: detail.rows[0] || null });
    }

    const limit = Math.max(1, Math.min(Number(req.query?.limit) || DEFAULT_LIMIT, 100));
    const rows = await pool.query(
      `SELECT call_sid, status, from_number, to_number, created_at
       FROM calls
       WHERE tenant_key = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantKey, limit]
    );

    const calls = rows.rows.map((c) => ({
      sid: c.call_sid,
      status: c.status,
      direction: "inbound",
      from: c.from_number,
      to: c.to_number,
      duration: null,
      start_time: c.created_at,
      end_time: null,
      price: null,
      price_unit: null
    }));

    return res.status(200).json({ configured: true, calls });
  } catch (err) {
    return res.status(500).json({ error: "dashboard_calls_error", message: err?.message || "unknown" });
  }
}
