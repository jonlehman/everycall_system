import express from "express";
import { readCallGatewayEnv } from "@everycall/config";
import { logError, logInfo } from "@everycall/observability";
import { normalizePhone, validateTelnyxSignature } from "@everycall/telephony";
import { resolveTenantByToNumber } from "@everycall/tenancy";

const env = readCallGatewayEnv(process.env);
const app = express();

app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false }));

function safeJsonParse(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

app.post("/v1/telnyx/webhooks/voice/inbound", express.raw({ type: "*/*" }), (req, res) => {
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

  const routing = resolveTenantByToNumber(to, env.TENANT_NUMBERS_FILE);
  if (!routing || !routing.active) {
    return res.status(404).json({ error: "tenant_not_found_for_number" });
  }

  const providerCallId = body?.data?.payload?.call_control_id || body?.data?.id || "unknown";
  const traceId = req.header("x-trace-id") ?? `trc_${providerCallId}`;
  const callId = `cal_${providerCallId}`;

  logInfo("telnyx_inbound_received", {
    trace_id: traceId,
    call_id: callId,
    tenant_id: routing.tenantId,
    provider_call_id: providerCallId,
    from_number: from,
    to_number: to
  });

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
