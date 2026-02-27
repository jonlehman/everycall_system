import { readRawBody, verifyTelnyxSignature, sendTelnyxSms } from "../../../../_lib/telnyx.js";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getSharedSmsNumber } from "../../../../_lib/alerts.js";

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

    const normalizedText = String(text || "").trim().toLowerCase();
    const isYes = normalizedText === "yes" || normalizedText === "y";
    const isStop = ["stop", "unsubscribe", "cancel", "end", "quit"].includes(normalizedText);
    if (from && (isYes || isStop)) {
      const nextStatus = isYes ? "opted_in" : "opted_out";
      const timestampField = isYes ? "sms_opt_in_confirmed_at" : "sms_opt_in_requested_at";
      await pool.query(
        `UPDATE tenant_users
         SET sms_opt_in_status = $1,
             ${timestampField} = NOW(),
             updated_at = NOW()
         WHERE phone_number = $2`,
        [nextStatus, from]
      );
      if (isYes) {
        const fromNumber = await getSharedSmsNumber(pool);
        if (fromNumber) {
          await sendTelnyxSms({
            from: fromNumber,
            to: from,
            text: "You're opted in for EveryCall alerts. Reply STOP to opt out."
          });
        }
      } else {
        const fromNumber = await getSharedSmsNumber(pool);
        if (fromNumber) {
          await sendTelnyxSms({
            from: fromNumber,
            to: from,
            text: "You are opted out of EveryCall alerts. Reply YES to opt back in."
          });
        }
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
    return res.status(500).json({ error: "telnyx_sms_inbound_error", message: err?.message || "unknown" });
  }
}
