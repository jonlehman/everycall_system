import { ensureTables, getPool } from "../_lib/db.js";
import { getSession, requireSession, resolveTenantKey } from "../_lib/auth.js";
import { buildCallSummarySms, getSharedSmsNumber } from "../_lib/alerts.js";
import { sendTelnyxSms } from "../_lib/telnyx.js";

const openAiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const openAiSummaryModel = process.env.OPENAI_SUMMARY_MODEL || "gpt-5.2";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

function normalizeSummary(rawText) {
  const cleaned = String(rawText || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  let left = "";
  let right = "";
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":");
    left = parts.shift() || "";
    right = parts.join(":");
  } else if (cleaned.includes(" - ")) {
    const parts = cleaned.split(" - ");
    left = parts.shift() || "";
    right = parts.join(" - ");
  } else if (cleaned.includes(" — ")) {
    const parts = cleaned.split(" — ");
    left = parts.shift() || "";
    right = parts.join(" — ");
  } else {
    left = "Call Summary";
    right = cleaned;
  }

  let leftWords = left.trim().split(/\s+/).filter(Boolean);
  if (leftWords.length < 2) {
    leftWords = [...leftWords, "Summary"];
  }
  if (leftWords.length > 4) {
    leftWords = leftWords.slice(0, 4);
  }

  let rightWords = right.trim().split(/\s+/).filter(Boolean);
  if (rightWords.length === 0) {
    rightWords = ["Follow", "up", "needed"];
  }
  if (rightWords.length > 12) {
    rightWords = rightWords.slice(0, 12);
  }

  return `${leftWords.join(" ")}: ${rightWords.join(" ")}`;
}

async function generateSummaryFromTranscript(transcript) {
  const trimmed = String(transcript || "").trim();
  if (!trimmed || !openAiKey) return null;

  const prompt = [
    "Format: 2-4 words describing the type of service required, colon,",
    "then a 12-word max description of the service request.",
    "Do not use generic words like service, repair, appointment, scheduling, booking.",
    "Return only the summary text."
  ].join(" ");

  const input = [
    { role: "system", content: prompt },
    { role: "user", content: trimmed.slice(0, 6000) }
  ];

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: openAiSummaryModel, input })
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  const output =
    json.output_text ||
    json.output
      ?.flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text" && typeof item.text === "string")
      ?.text;

  return normalizeSummary(output);
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
                d.transcript, d.transcript_combined, d.extracted_json, d.routing_json, d.state_json,
                d.caller_first_name, d.caller_last_name, d.callback_number, d.service_required, d.urgency_level,
                d.address_line1, d.address_line2, d.city, d.state, d.postal_code, d.requested_date, d.requested_time
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
        const transcriptFromPayload = extracted?.transcript || null;
        let finalSummary = summary;

        if (!finalSummary || finalSummary === "Call completed.") {
          const generated = await generateSummaryFromTranscript(transcriptFromPayload || "");
          if (generated) {
            finalSummary = generated;
          }
        }

        await pool.query(
          `INSERT INTO calls (call_sid, tenant_key, status, summary, urgency, disposition)
           VALUES ($1, $2, 'new', $3, $4, $5)
           ON CONFLICT (call_sid)
           DO UPDATE SET summary = EXCLUDED.summary,
                         urgency = EXCLUDED.urgency,
                         disposition = EXCLUDED.disposition`,
          [callId, tenantKey, finalSummary || null, urgency, disposition]
        );

        if (extracted) {
          const payload = typeof extracted === "object" ? extracted : {};
          await pool.query(
            `INSERT INTO call_details (
               call_sid,
               extracted_json,
               caller_first_name,
               caller_last_name,
               callback_number,
               service_required,
               urgency_level,
               address_line1,
               address_line2,
               city,
               state,
               postal_code,
               requested_date,
               requested_time,
               updated_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
             ON CONFLICT (call_sid)
             DO UPDATE SET extracted_json = EXCLUDED.extracted_json,
                           caller_first_name = EXCLUDED.caller_first_name,
                           caller_last_name = EXCLUDED.caller_last_name,
                           callback_number = EXCLUDED.callback_number,
                           service_required = EXCLUDED.service_required,
                           urgency_level = EXCLUDED.urgency_level,
                           address_line1 = EXCLUDED.address_line1,
                           address_line2 = EXCLUDED.address_line2,
                           city = EXCLUDED.city,
                           state = EXCLUDED.state,
                           postal_code = EXCLUDED.postal_code,
                           requested_date = EXCLUDED.requested_date,
                           requested_time = EXCLUDED.requested_time,
                           updated_at = NOW()`,
            [
              callId,
              payload,
              payload.first_name || null,
              payload.last_name || null,
              payload.callback_number || null,
              payload.service_required || null,
              payload.urgency || null,
              payload.address_line1 || null,
              payload.address_line2 || null,
              payload.city || null,
              payload.state || null,
              payload.postal_code || null,
              payload.requested_date || null,
              payload.requested_time || null
            ]
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

      if (body.action === "backfill_summaries") {
        if (!session) {
          return res.status(403).json({ error: "forbidden" });
        }

        const missing = await pool.query(
          `SELECT c.call_sid, c.summary, d.transcript, d.transcript_combined
           FROM calls c
           LEFT JOIN call_details d ON d.call_sid = c.call_sid
           WHERE c.tenant_key = $1
             AND (c.summary IS NULL OR c.summary = '' OR c.summary = '-' OR c.summary = 'Call completed.')
           ORDER BY c.created_at DESC`,
          [tenantKey]
        );

        let updated = 0;
        for (const row of missing.rows) {
          const transcript = row.transcript_combined || row.transcript || "";
          const generated = await generateSummaryFromTranscript(transcript);
          if (!generated) continue;
          await pool.query(
            `UPDATE calls
             SET summary = $3
             WHERE tenant_key = $1 AND call_sid = $2`,
            [tenantKey, row.call_sid, generated]
          );
          updated += 1;
        }

        return res.status(200).json({ ok: true, updated });
      }

      if (body.action === "update") {
        if (!session) {
          return res.status(403).json({ error: "forbidden" });
        }
        const callId = String(body.callSid || "").trim();
        if (!callId) {
          return res.status(400).json({ error: "missing_call_id" });
        }

        const allowedStatus = new Set([
          "new",
          "contacted",
          "scheduled",
          "in_progress",
          "completed",
          "unable_to_reach",
          "canceled",
          "spam"
        ]);
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
