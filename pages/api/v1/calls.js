import { ensureTables, getPool } from "../_lib/db.js";
import { requireSession, resolveTenantKey } from "../_lib/auth.js";
import { buildCallSummarySms, getSharedSmsNumber } from "../_lib/alerts.js";
import { sendTelnyxSms } from "../_lib/telnyx.js";

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

    let session = null;
    if (req.method !== "POST") {
      session = await requireSession(req, res);
      if (!session) return;
    }
    const tenantKey = session ? resolveTenantKey(session, getTenantKey(req)) : getTenantKey(req);
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

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const internalToken = req.headers["x-everycall-internal"];
      const expectedToken = process.env.CALL_SUMMARY_TOKEN || "";
      if (!session && (!expectedToken || internalToken !== expectedToken)) {
        return res.status(403).json({ error: "forbidden" });
      }

      if (body.action === "summary") {
        const callId = String(body.callSid || "").trim();
        if (!callId) {
          return res.status(400).json({ error: "missing_call_id" });
        }
        const summary = String(body.summary || "").trim();
        const urgency = String(body.urgency || "").trim() || null;
        const disposition = String(body.disposition || "").trim() || null;
        const extracted = body.extracted || null;

        await pool.query(
          `INSERT INTO calls (call_sid, tenant_key, status, summary, urgency, disposition)
           VALUES ($1, $2, 'completed', $3, $4, $5)
           ON CONFLICT (call_sid)
           DO UPDATE SET summary = EXCLUDED.summary,
                         urgency = EXCLUDED.urgency,
                         disposition = EXCLUDED.disposition`,
          [callId, tenantKey, summary || null, urgency, disposition]
        );

        if (extracted) {
          await pool.query(
            `INSERT INTO call_details (call_sid, extracted_json)
             VALUES ($1, $2)
             ON CONFLICT (call_sid)
             DO UPDATE SET extracted_json = EXCLUDED.extracted_json`,
            [callId, extracted]
          );
        }

        const fromNumber = await getSharedSmsNumber(pool);
        if (fromNumber) {
          const tenantRow = await pool.query(
            `SELECT name FROM tenants WHERE tenant_key = $1 LIMIT 1`,
            [tenantKey]
          );
          const tenantName = tenantRow.rows[0]?.name || tenantKey;
          const messageText = buildCallSummarySms({
            tenantName,
            caller: extracted?.caller_name || extracted?.caller || null,
            callbackNumber: extracted?.callback_number || extracted?.callback || null,
            timeRequested: extracted?.preferred_time || extracted?.time_requested || null
          });
          const recipients = await pool.query(
            `SELECT phone_number
             FROM tenant_users
             WHERE tenant_key = $1
               AND status = 'active'
               AND phone_number IS NOT NULL
               AND sms_opt_in_status = 'opted_in'`,
            [tenantKey]
          );
          for (const user of recipients.rows) {
            await sendTelnyxSms({ from: fromNumber, to: user.phone_number, text: messageText });
          }
        }

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "unsupported_action" });
    }

    const limit = Math.max(1, Math.min(Number(req.query?.limit) || 30, 200));
    const rows = await pool.query(
      `SELECT call_sid, from_number, status, urgency, created_at
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
