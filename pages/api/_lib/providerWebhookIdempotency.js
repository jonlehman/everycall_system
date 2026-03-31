import crypto from "crypto";

function normalizeText(value) {
  return String(value || "").trim();
}

function hashPayload(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export async function claimInboundWebhookEvent(pool, {
  provider,
  eventId,
  eventType = null,
  rawPayload = ""
}) {
  const normalizedProvider = normalizeText(provider).slice(0, 80);
  const normalizedEventId = normalizeText(eventId).slice(0, 240);
  if (!pool || !normalizedProvider || !normalizedEventId) {
    return { accepted: true, duplicate: false };
  }

  const payloadHash = hashPayload(rawPayload);
  const inserted = await pool.query(
    `INSERT INTO inbound_webhook_events (
       provider,
       event_id,
       event_type,
       payload_hash,
       first_received_at,
       last_seen_at,
       duplicate_count
     )
     VALUES ($1, $2, $3, $4, NOW(), NOW(), 0)
     ON CONFLICT (provider, event_id)
     DO NOTHING
     RETURNING id`,
    [
      normalizedProvider,
      normalizedEventId,
      normalizeText(eventType) || null,
      payloadHash
    ]
  );

  if (inserted.rowCount) {
    return { accepted: true, duplicate: false };
  }

  await pool.query(
    `UPDATE inbound_webhook_events
     SET last_seen_at = NOW(),
         duplicate_count = duplicate_count + 1
     WHERE provider = $1
       AND event_id = $2`,
    [normalizedProvider, normalizedEventId]
  );
  return { accepted: false, duplicate: true };
}
