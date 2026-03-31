import { ensureTables, getPool } from "../../../../_lib/db.js";
import { updateNotificationChannelHealth } from "../../../../_lib/notificationHealth.js";
import { readRawBody, verifyTelnyxSignature } from "../../../../_lib/telnyx.js";
import { claimInboundWebhookEvent } from "../../../../_lib/providerWebhookIdempotency.js";

function normalizeText(value) {
  return String(value || "").trim();
}

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

    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const data = body.data || {};
    const payload = data.payload || {};
    const eventId = normalizeText(data.id) || null;
    const eventType = normalizeText(data.event_type || body.data?.event_type) || "telnyx_sms_failover";
    const claim = await claimInboundWebhookEvent(pool, {
      provider: "telnyx_sms_failover",
      eventId,
      eventType,
      rawPayload: rawBody
    });
    if (claim.duplicate) {
      return res.status(200).json({ ok: true, duplicate: true, eventId });
    }
    const providerMessageId = normalizeText(payload.message_id || payload.id || payload.record_id) || null;
    const destination = normalizeText(payload.to?.[0]?.phone_number || payload.to) || null;
    const reason = normalizeText(payload?.errors?.[0]?.description || payload?.errors?.[0]?.title) || "sms_failover";

    const delivery = providerMessageId
      ? await pool.query(
          `SELECT tenant_key, destination
           FROM lead_notification_deliveries
           WHERE provider_reference = $1
           LIMIT 1`,
          [providerMessageId]
        )
      : { rowCount: 0, rows: [] };
    const resolvedTenantKey = normalizeText(delivery.rows?.[0]?.tenant_key) || (
      destination
        ? normalizeText((await pool.query(
            `SELECT tenant_key
             FROM tenant_users
             WHERE phone_number = $1
             LIMIT 1`,
            [destination]
          )).rows?.[0]?.tenant_key)
        : ""
    ) || null;
    const resolvedDestination = normalizeText(delivery.rows?.[0]?.destination) || destination || null;

    if (providerMessageId) {
      await pool.query(
        `UPDATE lead_notification_deliveries
         SET status = 'failed',
             last_error_code = COALESCE(last_error_code, 'sms_failover'),
             last_error_message = $2,
             updated_at = NOW()
         WHERE provider_reference = $1`,
        [providerMessageId, reason]
      );
    }

    if (resolvedTenantKey && resolvedDestination) {
      await updateNotificationChannelHealth(pool, {
        tenantKey: resolvedTenantKey,
        channel: "sms",
        destination: resolvedDestination,
        status: "non_functioning",
        errorCode: "sms_failover",
        errorMessage: reason
      });
    }

    await pool.query(
      `INSERT INTO sms_failover_events (
         tenant_key,
         destination,
         provider_event_id,
         provider_message_id,
         reason,
         payload_json
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        resolvedTenantKey,
        resolvedDestination,
        eventId,
        providerMessageId,
        reason,
        JSON.stringify(body || {})
      ]
    );

    return res.status(200).json({
      ok: true,
      received: true,
      eventId,
      providerMessageId,
      tenantKey: resolvedTenantKey,
      destination: resolvedDestination,
      reason
    });
  } catch (err) {
    if (String(err?.message || "") === "request_body_too_large") {
      return res.status(413).json({ error: "payload_too_large" });
    }
    return res.status(500).json({ error: "telnyx_sms_failover_error", message: err?.message || "unknown" });
  }
}
