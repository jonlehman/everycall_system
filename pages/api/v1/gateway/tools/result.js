import { ensureTables, getPool } from "../../../_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const token = String(req.headers["x-everycall-internal"] || "");
  if (!process.env.CALL_SUMMARY_TOKEN || token !== process.env.CALL_SUMMARY_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const callId = String(body.call_id || "").trim();
    const tool = String(body.tool || "").trim();
    const payload = typeof body.payload === "object" && body.payload ? body.payload : {};
    const validation = typeof body.validation === "object" && body.validation ? body.validation : {};

    if (!callId || !tool) {
      return res.status(400).json({ error: "missing_call_or_tool" });
    }

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'tool')`,
      [callId, body.tenant_key || "unknown", "system", JSON.stringify({ tool, payload, validation })]
    );

    if (tool === "data_capture") {
      await pool.query(
        `UPDATE call_details
         SET extracted_json = $2,
             updated_at = NOW()
         WHERE call_sid = $1`,
        [callId, payload]
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "tool_result_error", message: err?.message || "unknown" });
  }
}
