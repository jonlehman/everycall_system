import { readRawBody, verifyTelnyxSignature } from "../../../../_lib/telnyx.js";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { claimInboundWebhookEvent } from "../../../../_lib/providerWebhookIdempotency.js";

export const config = {
  api: { bodyParser: false }
};

export function createSmsInboundHandler({getDatabase=getPool, checkSchema=ensureTables}={}) {
return async function handler(req, res) {
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

    const pool = getDatabase();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await checkSchema(pool);

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

    // Receipt and opt-outs commit together: a failed update must remain retryable.
    const db = await pool.connect();
    let duplicate = false;
    try {
      await db.query('BEGIN');
      const claim = await claimInboundWebhookEvent(db, {
        provider: 'telnyx_sms_inbound', eventId: messageId, eventType, rawPayload: rawBody
      });
      duplicate = claim.duplicate;
      if (!duplicate) {
        const word = String(text || '').trim().toLowerCase();
        const isYes = ['yes','y','start','unstop'].includes(word);
        const isStop = ['stop','stopall','unsubscribe','cancel','end','quit'].includes(word);
        if (from && isYes) await db.query(`UPDATE tenant_users SET sms_opt_in_status='opted_in', sms_opt_in_confirmed_at=NOW(), updated_at=NOW() WHERE phone_number=$1`, [from]);
        if (from && isStop) {
          await db.query(`UPDATE tenant_users SET sms_opt_in_status='opted_out', sms_opt_in_confirmed_at=NULL, updated_at=NOW() WHERE phone_number=$1`, [from]);
          // Store even unknown recipients so a later Sales import cannot restore consent.
          await db.query(`INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone',$1,'sms_opt_out') ON CONFLICT DO NOTHING`, [from]);
          await db.query(`UPDATE sales_prospects SET do_not_call=TRUE,dnc_reason='sms_opt_out',updated_at=NOW()
            WHERE phone_e164=$1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(numbers_json) n WHERE n->>'phoneE164'=$1)`, [from]);
          // Telnyx messaging-profile STOP rules send the confirmation automatically.
          // Do not send an application confirmation: it would duplicate that response.
        }
      }
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
    if (duplicate) return res.status(200).json({ok:true,duplicate:true,messageId});

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
}
export default createSmsInboundHandler();
