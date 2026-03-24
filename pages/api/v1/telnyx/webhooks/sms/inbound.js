import { readRawBody, verifyTelnyxSignature, sendTelnyxSms } from "../../../../_lib/telnyx.js";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getSharedSmsNumber } from "../../../../_lib/alerts.js";

export const config = {
  api: { bodyParser: false }
};

const DEFAULT_APP_BASE_URL = "https://app.everycall.io";

function getAppBaseUrl() {
  return String(process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_APP_BASE_URL;
}

function getHelpMessage() {
  return `EveryCall by Creative Dynamic: For help with SMS new lead alerts, contact support@everycall.io or visit ${getAppBaseUrl()}/terms. Reply STOP to opt out.`;
}

const OPT_IN_CONFIRMATION_MESSAGE = "EveryCall by Creative Dynamic: Thanks for subscribing to SMS new lead alerts. Message frequency may vary. Msg&data rates may apply. Consent is not a condition of purchase. Reply HELP for help. Reply STOP to opt out.";
const OPT_OUT_CONFIRMATION_MESSAGE = "EveryCall by Creative Dynamic: You are unsubscribed from SMS new lead alerts and will receive no further messages. Reply YES to opt back in.";

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
      const fromNumber = await getSharedSmsNumber(pool);
      if (fromNumber) {
        await sendTelnyxSms({
          from: fromNumber,
          to: from,
          text: isHelp
            ? getHelpMessage()
            : isYes
              ? OPT_IN_CONFIRMATION_MESSAGE
              : OPT_OUT_CONFIRMATION_MESSAGE
        });
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
