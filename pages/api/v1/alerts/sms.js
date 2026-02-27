import { ensureTables, getPool } from "../_lib/db.js";
import { requireSession } from "../_lib/auth.js";
import { buildCallSummarySms, getSharedSmsNumber } from "../_lib/alerts.js";
import { sendTelnyxSms } from "../_lib/telnyx.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const tenantKey = String(body.tenantKey || "").trim();
    const type = String(body.type || "").trim();
    if (!tenantKey || !type) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const fromNumber = await getSharedSmsNumber(pool);
    if (!fromNumber) {
      return res.status(500).json({ error: "sms_number_missing" });
    }

    const tenantRow = await pool.query(
      `SELECT name FROM tenants WHERE tenant_key = $1 LIMIT 1`,
      [tenantKey]
    );
    const tenantName = tenantRow.rows[0]?.name || tenantKey;

    let messageText = "";
    if (type === "call_summary") {
      const payload = body.payload || {};
      messageText = buildCallSummarySms({
        tenantName,
        caller: payload.caller,
        callbackNumber: payload.callbackNumber,
        timeRequested: payload.timeRequested
      });
    } else {
      return res.status(400).json({ error: "unsupported_type" });
    }

    const recipients = await pool.query(
      `SELECT phone_number
       FROM tenant_users
       WHERE tenant_key = $1
         AND status = 'active'
         AND phone_number IS NOT NULL
         AND sms_opt_in_status = 'opted_in'`,
      [tenantKey]
    );

    let sent = 0;
    for (const user of recipients.rows) {
      await sendTelnyxSms({ from: fromNumber, to: user.phone_number, text: messageText });
      sent += 1;
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    return res.status(500).json({ error: "sms_alert_error", message: err?.message || "unknown" });
  }
}
