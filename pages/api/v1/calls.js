import { ensureTables, getPool } from "../_lib/db.js";
import { getSession, requireSession, resolveTenantKey } from "../_lib/auth.js";
import { requireTenantBillingAccess } from "../_lib/billing.js";
import { sendLeadNotifications } from "../_lib/leadNotifications.js";
import { normalizeCapturedCallFields } from "../_lib/callCapture.js";

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
    const sessionTenantKey = session ? resolveTenantKey(session, getTenantKey(req)) : null;
    if (session && sessionTenantKey) {
      const access = await requireTenantBillingAccess(res, pool, session, sessionTenantKey);
      if (!access) return;
    }
    const tenantKey = sessionTenantKey || getTenantKey(req);
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
        let effectiveTenantKey = sessionTenantKey
          || String(body.tenantKey || body.tenant_key || "").trim()
          || null;
        if (!effectiveTenantKey) {
          const callTenant = await pool.query(
            `SELECT tenant_key
             FROM calls
             WHERE call_sid = $1
             LIMIT 1`,
            [callId]
          );
          effectiveTenantKey = String(callTenant.rows[0]?.tenant_key || "").trim() || null;
        }
        if (!effectiveTenantKey) {
          return res.status(400).json({ error: "missing_tenant_key" });
        }
        const summary = String(body.summary || "").trim();
        const extracted = body.extracted || null;
        const extractedFields = normalizeCapturedCallFields(extracted);
        const transcriptFromPayload = extractedFields.transcriptCombined || null;
        const urgency = String(body.urgency || extractedFields.urgencyLevel || "").trim() || null;
        const disposition = String(body.disposition || extractedFields.outcomeType || "").trim() || null;
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
           DO UPDATE SET summary = COALESCE(EXCLUDED.summary, calls.summary),
                         urgency = COALESCE(EXCLUDED.urgency, calls.urgency),
                         disposition = COALESCE(EXCLUDED.disposition, calls.disposition)`,
          [callId, effectiveTenantKey, finalSummary || null, urgency, disposition]
        );

        if (extracted) {
          await pool.query(
            `INSERT INTO call_details (
               call_sid,
               extracted_json,
               transcript_combined,
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
             VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
             ON CONFLICT (call_sid)
             DO UPDATE SET extracted_json = COALESCE(call_details.extracted_json, '{}'::jsonb) || EXCLUDED.extracted_json,
                           transcript_combined = COALESCE(EXCLUDED.transcript_combined, call_details.transcript_combined),
                           caller_first_name = COALESCE(EXCLUDED.caller_first_name, call_details.caller_first_name),
                           caller_last_name = COALESCE(EXCLUDED.caller_last_name, call_details.caller_last_name),
                           callback_number = COALESCE(EXCLUDED.callback_number, call_details.callback_number),
                           service_required = COALESCE(EXCLUDED.service_required, call_details.service_required),
                           urgency_level = COALESCE(EXCLUDED.urgency_level, call_details.urgency_level),
                           address_line1 = COALESCE(EXCLUDED.address_line1, call_details.address_line1),
                           address_line2 = COALESCE(EXCLUDED.address_line2, call_details.address_line2),
                           city = COALESCE(EXCLUDED.city, call_details.city),
                           state = COALESCE(EXCLUDED.state, call_details.state),
                           postal_code = COALESCE(EXCLUDED.postal_code, call_details.postal_code),
                           requested_date = COALESCE(EXCLUDED.requested_date, call_details.requested_date),
                           requested_time = COALESCE(EXCLUDED.requested_time, call_details.requested_time),
                           updated_at = NOW()`,
            [
              callId,
              extractedFields.extractedJson,
              transcriptFromPayload,
              extractedFields.firstName,
              extractedFields.lastName,
              extractedFields.callbackNumber,
              extractedFields.serviceRequired,
              extractedFields.urgencyLevel,
              extractedFields.addressLine1,
              extractedFields.addressLine2,
              extractedFields.city,
              extractedFields.state,
              extractedFields.postalCode,
              extractedFields.requestedDate,
              extractedFields.requestedTime
            ]
          );
        }

        try {
          await sendLeadNotifications(pool, { tenantKey: effectiveTenantKey, callSid: callId });
        } catch (notificationErr) {
          console.error("lead_notifications_failed", {
            tenantKey: effectiveTenantKey,
            callId,
            message: notificationErr?.message || "unknown"
          });
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
        const firstName = String(body.firstName || "").trim().slice(0, 120);
        const lastName = String(body.lastName || "").trim().slice(0, 120);
        const callbackNumber = String(body.callbackNumber || "").trim().slice(0, 40);
        const serviceRequired = String(body.serviceRequired || "").trim().slice(0, 240);
        const addressLine1 = String(body.addressLine1 || "").trim().slice(0, 240);
        const addressLine2 = String(body.addressLine2 || "").trim().slice(0, 240);
        const city = String(body.city || "").trim().slice(0, 120);
        const state = String(body.state || "").trim().slice(0, 60);
        const postalCode = String(body.postalCode || "").trim().slice(0, 20);
        const requestedDate = String(body.requestedDate || "").trim().slice(0, 32);
        const requestedTime = String(body.requestedTime || "").trim().slice(0, 32);

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

        await pool.query(
          `UPDATE call_details
           SET caller_first_name = $3,
               caller_last_name = $4,
               callback_number = $5,
               service_required = $6,
               urgency_level = $7,
               address_line1 = $8,
               address_line2 = $9,
               city = $10,
               state = $11,
               postal_code = $12,
               requested_date = $13,
               requested_time = $14,
               updated_at = NOW()
           WHERE call_sid = $1`,
          [
            callId,
            firstName || null,
            lastName || null,
            callbackNumber || null,
            serviceRequired || null,
            urgencyValue || null,
            addressLine1 || null,
            addressLine2 || null,
            city || null,
            state || null,
            postalCode || null,
            requestedDate || null,
            requestedTime || null
          ]
        );

        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "unsupported_action" });
    }

    const limit = Math.max(1, Math.min(Number(req.query?.limit) || 30, 200));
    const rows = await pool.query(
      `SELECT c.call_sid,
              c.from_number,
              c.status,
              c.urgency,
              c.summary,
              c.created_at,
              d.caller_first_name,
              d.caller_last_name,
              d.address_line1,
              d.address_line2,
              d.city,
              d.state,
              d.postal_code
       FROM calls c
       LEFT JOIN call_details d ON d.call_sid = c.call_sid
       WHERE c.tenant_key = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantKey, limit]
    );

    return res.status(200).json({ calls: rows.rows });
  } catch (err) {
    return res.status(500).json({ error: "calls_error", message: err?.message || "unknown" });
  }
}
