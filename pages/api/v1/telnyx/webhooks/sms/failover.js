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

    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }
    const data = body.data || {};
    const payload = data.payload || {};
    const messageId = data.id || null;
    const reason = payload?.errors?.[0]?.description || payload?.errors?.[0]?.title || null;

    // TODO: persist failures for alerts/monitoring.
    return res.status(200).json({ ok: true, received: true, messageId, reason });
  } catch (err) {
    return res.status(500).json({ error: "telnyx_sms_failover_error", message: err?.message || "unknown" });
  }
}
