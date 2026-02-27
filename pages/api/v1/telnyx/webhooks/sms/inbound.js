import { readRawBody, verifyTelnyxSignature } from "../../../../_lib/telnyx.js";

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const rawBody = await readRawBody(req);
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

    // TODO: persist to DB or enqueue for processing.
    res.status(200).json({
      ok: true,
      received: true,
      messageId,
      from,
      to,
      text
    });
  } catch (err) {
    return res.status(500).json({ error: "telnyx_sms_inbound_error", message: err?.message || "unknown" });
  }
}
