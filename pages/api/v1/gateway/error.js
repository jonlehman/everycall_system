import { ensureTables, getPool } from "../../_lib/db.js";

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
    const tenantKey = String(body.tenant_key || "unknown").trim() || "unknown";
    const code = String(body.code || "").trim();
    const message = String(body.message || "").trim();
    const details = typeof body.details === "object" && body.details ? body.details : {};

    if (!callId || !code) {
      return res.status(400).json({ error: "missing_call_or_code" });
    }

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'error')`,
      [callId, tenantKey, "system", JSON.stringify({ code, message, details })]
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "gateway_error_callback_failed", message: err?.message || "unknown" });
  }
}
