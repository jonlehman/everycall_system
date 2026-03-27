import { ensureTables, getPool } from "../../../_lib/db.js";
import { normalizeCapturedCallFields } from "../../../_lib/callCapture.js";

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
      const fields = normalizeCapturedCallFields(payload);
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
         DO UPDATE SET
           extracted_json = COALESCE(call_details.extracted_json, '{}'::jsonb) || EXCLUDED.extracted_json,
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
          fields.extractedJson,
          fields.transcriptCombined,
          fields.firstName,
          fields.lastName,
          fields.callbackNumber,
          fields.serviceRequired,
          fields.urgencyLevel,
          fields.addressLine1,
          fields.addressLine2,
          fields.city,
          fields.state,
          fields.postalCode,
          fields.requestedDate,
          fields.requestedTime
        ]
      );

      await pool.query(
        `UPDATE calls
         SET urgency = COALESCE($2, urgency),
             disposition = COALESCE($3, disposition)
         WHERE call_sid = $1`,
        [callId, fields.urgencyLevel, fields.outcomeType]
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "tool_result_error", message: err?.message || "unknown" });
  }
}
