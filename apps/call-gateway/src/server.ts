import express from "express";
import { readCallGatewayEnv } from "@everycall/config";
import { inboundWebhookSchema } from "@everycall/contracts";
import { logError, logInfo } from "@everycall/observability";
import { normalizePhone, validateTwilioSignature } from "@everycall/telephony";
import { resolveTenantByToNumber } from "@everycall/tenancy";

const env = readCallGatewayEnv(process.env);
const app = express();

app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function getWebhookUrl(req: express.Request): string {
  if (env.TWILIO_WEBHOOK_BASE_URL) {
    return `${env.TWILIO_WEBHOOK_BASE_URL}${req.path}`;
  }
  return `${req.protocol}://${req.get("host")}${req.originalUrl}`;
}

function toStringRecord(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") {
    return out;
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = String(value ?? "");
  }

  return out;
}

app.post("/v1/twilio/webhooks/voice/inbound", (req, res) => {
  const signature = req.header("X-Twilio-Signature");
  const validSignature = validateTwilioSignature({
    signatureHeader: signature,
    authToken: env.TWILIO_AUTH_TOKEN,
    url: getWebhookUrl(req),
    params: toStringRecord(req.body)
  });

  if (!validSignature) {
    return res.status(401).json({ error: "invalid_signature" });
  }

  const parsed = inboundWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const body = parsed.data;
  const to = normalizePhone(body.To);
  const from = normalizePhone(body.From);

  const routing = resolveTenantByToNumber(to, env.TENANT_NUMBERS_FILE);
  if (!routing || !routing.active) {
    return res.status(404).json({ error: "tenant_not_found_for_number" });
  }

  const traceId = req.header("x-trace-id") ?? `trc_${body.CallSid}`;
  const callId = `cal_${body.CallSid}`;

  logInfo("twilio_inbound_received", {
    trace_id: traceId,
    call_id: callId,
    tenant_id: routing.tenantId,
    provider_call_sid: body.CallSid,
    from_number: from,
    to_number: to
  });

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>Connecting you now.</Say>\n</Response>`;
  res.type("text/xml").status(200).send(twiml);
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "call-gateway" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError("call_gateway_unhandled_error", { message: err instanceof Error ? err.message : "unknown" });
  res.status(500).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  logInfo("call_gateway_started", {
    port: env.PORT,
    webhook_base_url: env.TWILIO_WEBHOOK_BASE_URL ?? "auto"
  });
});
