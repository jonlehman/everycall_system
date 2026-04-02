import { readRawBody, verifyTelnyxSignature } from "../../../../_lib/telnyx.js";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { claimInboundWebhookEvent } from "../../../../_lib/providerWebhookIdempotency.js";

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const rawBody = await readRawBody(req, { maxBytes: 256 * 1024 });
    const signature = req.headers["telnyx-signature-ed25519"];
    const timestamp = req.headers["telnyx-timestamp"];
    const publicKey = process.env.TELNYX_PUBLIC_KEY;
    if (!publicKey) {
      return res.status(500).json({ error: "telnyx_public_key_missing" });
    }
    const ok = verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey });
    if (!ok) {
      return res.status(403).json({ error: "invalid_signature" });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    // Telnyx sends JSON. We accept and acknowledge for now.
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }
    const data = body.data || {};
    const payload = data.payload || {};

    // Minimal fields for logging/inspection if needed later.
    const from = payload.from?.phone_number || payload.from || null;
    const to = payload.to?.[0]?.phone_number || payload.to || null;
    const text = payload.text || payload.body || null;
    const messageId = data.id || null;
    const eventType = String(data.event_type || body.data?.event_type || "telnyx_sms_inbound");

    const claim = await claimInboundWebhookEvent(pool, {
      provider: "telnyx_sms_inbound",
      eventId: messageId,
      eventType,
      rawPayload: rawBody
    });
    if (claim.duplicate) {
      return res.status(200).json({ ok: true, duplicate: true, messageId });
    }

    const normalizedText = String(text || "").trim().toLowerCase();
    const isYes = ["yes", "y", "start", "unstop"].includes(normalizedText);
    const isStop = ["stop", "unsubscribe", "cancel", "end", "quit"].includes(normalizedText);
    const isHelp = ["help", "info", "support"].includes(normalizedText);
    if (from && (isYes || isStop || isHelp)) {
      if (isYes) {
        await pool.query(
          `UPDATE tenant_users
           SET sms_opt_in_status = 'opted_in',
               sms_opt_in_confirmed_at = NOW(),
               updated_at = NOW()
           WHERE phone_number = $1`,
          [from]
        );
      } else if (isStop) {
        await pool.query(
          `UPDATE tenant_users
           SET sms_opt_in_status = 'opted_out',
               sms_opt_in_confirmed_at = NULL,
               updated_at = NOW()
           WHERE phone_number = $1`,
          [from]
        );
      }
    }

    res.status(200).json({
      ok: true,
      received: true,
      messageId,
      from,
      to,
      text
    });
  } catch (err) {
    if (String(err?.message || "") === "request_body_too_large") {
      return res.status(413).json({ error: "payload_too_large" });
    }
    return res.status(500).json({ error: "telnyx_sms_inbound_error", message: err?.message || "unknown" });
  }
}
