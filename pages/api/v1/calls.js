import { ensureTables, getPool } from "../_lib/db.js";
import { getSession, requireSession, resolveTenantKey } from "../_lib/auth.js";
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

    const session = req.method === "POST"
      ? await getSession(req)
      : await requireSession(req, res);
    if (!session && req.method !== "POST") return;
    const tenantKey = session ? resolveTenantKey(session, getTenantKey(req)) : getTenantKey(req);
    const callSid = req.query?.callSid;
    const mode = String(req.query?.mode || "");

    if (req.method === "GET" && mode === "transcript") {
      const resolveCombined = async (row) => {
        if (!row?.call_sid) return { callSid: null, createdAt: null, transcript: "" };
        if (row.transcript_combined) {
          return { callSid: row.call_sid, createdAt: row.created_at, transcript: row.transcript_combined };
        }
        const events = await pool.query(
          `SELECT role, text
           FROM call_events
           WHERE call_sid = $1
           ORDER BY created_at ASC`,
          [row.call_sid]
        );
        if (events.rows.length) {
          const combined = events.rows
            .map((evt) => `${(evt.role || "Speaker").replace(/^[a-z]/, (c) => c.toUpperCase())}: ${evt.text || ""}`)
            .join("\n");
          return { callSid: row.call_sid, createdAt: row.created_at, transcript: combined };
        }
        return { callSid: row.call_sid, createdAt: row.created_at, transcript: row.transcript || "" };
      };

      if (callSid) {
        const detail = await pool.query(
          `SELECT c.call_sid, c.created_at,
                  d.transcript_combined, d.transcript
           FROM calls c
           LEFT JOIN call_details d ON d.call_sid = c.call_sid
           WHERE c.tenant_key = $1 AND c.call_sid = $2
           LIMIT 1`,
          [tenantKey, String(callSid)]
        );
        const resolved = await resolveCombined(detail.rows[0]);
        return res.status(200).json(resolved);
      }

      const latest = await pool.query(
        `SELECT c.call_sid, c.created_at,
                d.transcript_combined, d.transcript
         FROM calls c
         LEFT JOIN call_details d ON d.call_sid = c.call_sid
         WHERE c.tenant_key = $1
         ORDER BY c.created_at DESC
         LIMIT 1`,
        [tenantKey]
      );
      const resolved = await resolveCombined(latest.rows[0]);
      return res.status(200).json(resolved);
    }

    if (callSid) {
      const detail = await pool.query(
        `SELECT c.call_sid, c.status, c.from_number, c.to_number, c.summary, c.urgency, c.disposition, c.created_at,
                d.transcript, d.transcript_combined, d.extracted_json, d.routing_json, d.state_json
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

      if (body.action === "update") {
        if (!session) {
          return res.status(403).json({ error: "forbidden" });
        }
        const callId = String(body.callSid || "").trim();
        if (!callId) {
          return res.status(400).json({ error: "missing_call_id" });
        }

        const allowedStatus = new Set(["completed", "missed", "error", "in_progress"]);
        const allowedUrgency = new Set(["critical", "high", "normal", "low"]);
        const statusValue = String(body.status || "").trim().toLowerCase();
        const urgencyValue = String(body.urgency || "").trim().toLowerCase();
        const summaryValue = String(body.summary || "").trim().slice(0, 500);
        const notesValue = String(body.notes || "").trim().slice(0, 5000);

        if (statusValue && !allowedStatus.has(statusValue)) {
          return res.status(400).json({ error: "invalid_status" });
        }
        if (urgencyValue && !allowedUrgency.has(urgencyValue)) {
          return res.status(400).json({ error: "invalid_urgency" });
        }

        const existing = await pool.query(
          `SELECT d.state_json
           FROM calls c
           LEFT JOIN call_details d ON d.call_sid = c.call_sid
           WHERE c.tenant_key = $1 AND c.call_sid = $2
           LIMIT 1`,
          [tenantKey, callId]
        );
        if (!existing.rows[0]) {
          return res.status(404).json({ error: "call_not_found" });
        }

        await pool.query(
          `UPDATE calls
           SET status = COALESCE($3, status),
               urgency = COALESCE($4, urgency),
               summary = COALESCE($5, summary)
           WHERE tenant_key = $1 AND call_sid = $2`,
          [tenantKey, callId, statusValue || null, urgencyValue || null, summaryValue || null]
        );

        const nextState = {
          ...((existing.rows[0]?.state_json && typeof existing.rows[0].state_json === "object") ? existing.rows[0].state_json : {}),
          client_notes: notesValue
        };
        await pool.query(
          `INSERT INTO call_details (call_sid, state_json, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (call_sid)
           DO UPDATE SET state_json = EXCLUDED.state_json,
                         updated_at = NOW()`,
          [callId, nextState]
        );

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "unsupported_action" });
    }

    const limit = Math.max(1, Math.min(Number(req.query?.limit) || 30, 200));
    const rows = await pool.query(
      `SELECT call_sid, from_number, status, urgency, summary, created_at
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
