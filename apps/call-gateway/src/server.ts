import express from "express";
import { readCallGatewayEnv } from "@everycall/config";
import { logError, logInfo } from "@everycall/observability";
import { normalizePhone, validateTelnyxSignature } from "@everycall/telephony";
import pg from "pg";
import { telnyxCallCommand } from "./telnyx.js";

const env = readCallGatewayEnv(process.env);
const app = express();
const databaseUrl = process.env.DATABASE_URL || "";
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const telnyxApiKey = process.env.TELNYX_API_KEY || "";
const appBaseUrl = process.env.APP_BASE_URL || "";
const callSummaryToken = process.env.CALL_SUMMARY_TOKEN || "";

app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false }));

function safeJsonParse(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

app.post("/v1/telnyx/webhooks/voice/inbound", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const signature = req.header("telnyx-signature-ed25519");
  const timestamp = req.header("telnyx-timestamp");
  const validSignature = validateTelnyxSignature({
    signatureHeader: signature,
    timestampHeader: timestamp,
    publicKey: env.TELNYX_PUBLIC_KEY,
    rawBody
  });

  if (!validSignature) {
    return res.status(401).json({ error: "invalid_signature" });
  }

  const body = safeJsonParse(rawBody);
  if (!body) {
    return res.status(400).json({ error: "invalid_json" });
  }

  const payload = body?.data?.payload || {};
  const toRaw = payload.to?.[0]?.phone_number || payload.to?.phone_number || payload.to;
  const fromRaw = payload.from?.phone_number || payload.from;
  if (!toRaw || !fromRaw) {
    return res.status(422).json({ error: "missing_numbers" });
  }

  const to = normalizePhone(String(toRaw));
  const from = normalizePhone(String(fromRaw));

  if (!pool) {
    return res.status(500).json({ error: "database_unavailable" });
  }
  const eventType = body?.data?.event_type || "unknown";
  const tenantRow = await pool.query(
    `SELECT tenant_key, status
     FROM tenants
     WHERE telnyx_voice_number = $1
     LIMIT 1`,
    [to]
  );
  if (!tenantRow.rowCount || tenantRow.rows[0].status !== "active") {
    return res.status(404).json({ error: "tenant_not_found_for_number" });
  }

  const providerCallId = body?.data?.payload?.call_control_id || body?.data?.id || "unknown";
  const traceId = req.header("x-trace-id") ?? `trc_${providerCallId}`;
  const callId = `cal_${providerCallId}`;
  const tenantKey = tenantRow.rows[0].tenant_key;

  logInfo("telnyx_inbound_received", {
    trace_id: traceId,
    call_id: callId,
    tenant_id: tenantRow.rows[0].tenant_key,
    provider_call_id: providerCallId,
    from_number: from,
    to_number: to
  });

  await pool.query(
    `INSERT INTO calls (call_sid, tenant_key, from_number, to_number, status)
     VALUES ($1, $2, $3, $4, 'in_progress')
     ON CONFLICT (call_sid)
     DO UPDATE SET from_number = EXCLUDED.from_number,
                   to_number = EXCLUDED.to_number`,
    [callId, tenantKey, from, to]
  );

  await pool.query(
    `INSERT INTO call_details (call_sid, state_json)
     VALUES ($1, $2)
     ON CONFLICT (call_sid)
     DO UPDATE SET state_json = COALESCE(call_details.state_json, EXCLUDED.state_json)`,
    [callId, JSON.stringify({ status: "initiated", turn: 0 })]
  );

  await pool.query(
    `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
     VALUES ($1, $2, $3, $4, $5)`,
    [callId, tenantKey, "system", null, eventType]
  );

  const callControlId = body?.data?.payload?.call_control_id;
  if (!callControlId || !telnyxApiKey) {
    return res.status(200).json({ ok: true, warning: "call_control_id_or_key_missing" });
  }

  if (eventType === "call.initiated") {
    await telnyxCallCommand({ apiKey: telnyxApiKey, callControlId, action: "answer" });
    return res.status(200).json({ ok: true });
  }

  if (eventType === "call.answered") {
    const tenantInfo = await pool.query(
      `SELECT name FROM tenants WHERE tenant_key = $1 LIMIT 1`,
      [tenantKey]
    );
    const companyName = tenantInfo.rows[0]?.name || "our team";
    const greeting = `Thanks for calling ${companyName}. I can help get you scheduled. What's your name and best callback number?`;
    await telnyxCallCommand({
      apiKey: telnyxApiKey,
      callControlId,
      action: "gather_using_ai",
      payload: {
        greeting,
        language: "en-US",
        voice: "female",
        maximum_digits: 0,
        minimum_digits: 0,
        maximum_wait_time: 8,
        max_transcript_confidence: 0.6,
        parameters: [
          { name: "caller_name", description: "Full name of the caller" },
          { name: "callback_number", description: "Best callback phone number" },
          { name: "service_address", description: "Service address including city and zip" },
          { name: "preferred_time", description: "Preferred time for the visit or callback" },
          { name: "urgency", description: "Urgency level (normal or urgent)" }
        ]
      }
    });
    return res.status(200).json({ ok: true });
  }

  if (eventType === "call.ai_gather.ended") {
    const aiResult = payload?.results || payload?.result || payload?.data || null;
    await pool.query(
      `UPDATE call_details
       SET extracted_json = $2,
           updated_at = NOW()
       WHERE call_sid = $1`,
      [callId, aiResult ? JSON.stringify(aiResult) : null]
    );
    await pool.query(
      `UPDATE calls
       SET status = 'completed',
           summary = $2
       WHERE call_sid = $1`,
      [callId, "Call captured via AI gather."]
    );

    if (appBaseUrl && callSummaryToken) {
      await fetch(`${appBaseUrl}/api/v1/calls?tenantKey=${encodeURIComponent(tenantKey)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-everycall-internal": callSummaryToken
        },
        body: JSON.stringify({
          action: "summary",
          tenantKey,
          callSid: callId,
          summary: "Call captured via AI gather.",
          extracted: aiResult || {}
        })
      });
    }

    await telnyxCallCommand({ apiKey: telnyxApiKey, callControlId, action: "hangup" });
    return res.status(200).json({ ok: true });
  }

  if (eventType === "call.hangup") {
    await pool.query(
      `UPDATE calls
       SET status = 'completed'
       WHERE call_sid = $1`,
      [callId]
    );
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true });
});

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "call-gateway" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError("call_gateway_unhandled_error", { message: err instanceof Error ? err.message : "unknown" });
  res.status(500).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  logInfo("call_gateway_started", {
    port: env.PORT
  });
});
