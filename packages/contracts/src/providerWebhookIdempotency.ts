import crypto from "node:crypto";

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function hashPayload(value: unknown) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

type QueryablePool = {
  query: (...args: any[]) => Promise<{
    rowCount?: number;
    rows?: any[];
  }>;
} | null;

export async function claimInboundWebhookEvent(
  pool: QueryablePool,
  {
    provider,
    eventId,
    eventType = null,
    rawPayload = ""
  }: {
    provider: string;
    eventId: string | null | undefined;
    eventType?: string | null | undefined;
    rawPayload?: string | null | undefined;
  }
) {
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

// Voice events distinguish a processing lease from completion. Legacy SMS users
// above keep their existing contract until their effects have recovery semantics.
export async function processInboundVoiceWebhook(
  pool: NonNullable<QueryablePool>,
  input: { eventId: string; eventType: string; rawPayload: string; resourceId: string },
  handle: (context: {
    attempt: number;
    assertOwned: () => Promise<void>;
    command: (action: string, send: (commandId: string) => Promise<void>, reconcile: () => Promise<boolean>) => Promise<void>;
  }) => Promise<void>
) {
  const provider = "telnyx_voice_inbound";
  const eventId = input.eventId || `payload:${hashPayload(input.rawPayload)}`;
  const token = crypto.randomUUID();
  const hash = hashPayload(input.rawPayload);
  const claim = await pool.query(
    `INSERT INTO inbound_webhook_events
       (provider, event_id, event_type, payload_hash, resource_id, processing_status,
        processing_token, lease_expires_at, processing_attempts, raw_payload)
     VALUES ($1, $2, $3, $4, $5, 'processing', $6, NOW() + INTERVAL '120 seconds', 1, $7)
     ON CONFLICT (provider, event_id) DO UPDATE
       SET processing_status = 'processing', processing_token = $6,
           lease_expires_at = NOW() + INTERVAL '120 seconds',
           processing_attempts = inbound_webhook_events.processing_attempts + 1,
           last_seen_at = NOW(), duplicate_count = inbound_webhook_events.duplicate_count + 1
       WHERE inbound_webhook_events.payload_hash = EXCLUDED.payload_hash
         AND (inbound_webhook_events.processing_status = 'failed'
           OR (inbound_webhook_events.processing_status = 'processing'
             AND inbound_webhook_events.lease_expires_at < NOW()))
     RETURNING checkpoints, processing_attempts`,
    [provider, eventId, input.eventType, hash, input.resourceId, token, input.rawPayload]
  );
  if (!claim.rowCount) {
    const result = await pool.query(
      `SELECT processing_status, payload_hash FROM inbound_webhook_events WHERE provider=$1 AND event_id=$2`,
      [provider, eventId]
    );
    if (result.rows?.[0]?.payload_hash !== hash) throw new Error("voice_webhook_payload_conflict");
    return result.rows?.[0]?.processing_status === "completed" ? "completed" : "busy";
  }
  const checkpoints = claim.rows?.[0]?.checkpoints || {};
  const assertOwned = async () => {
    const renewed = await pool.query(
      `UPDATE inbound_webhook_events SET lease_expires_at=NOW()+INTERVAL '120 seconds'
       WHERE provider=$1 AND event_id=$2 AND processing_token=$3
         AND processing_status='processing' AND lease_expires_at > NOW() RETURNING id`,
      [provider, eventId, token]
    );
    if (!renewed.rowCount) throw new Error("voice_webhook_lease_lost");
  };
  const checkpoint = async (action: string, status: string, commandId: string) => {
    const result = await pool.query(
      `UPDATE inbound_webhook_events SET checkpoints=checkpoints || $4::jsonb
       WHERE provider=$1 AND event_id=$2 AND processing_token=$3
         AND processing_status='processing' AND lease_expires_at > NOW() RETURNING id`,
      [provider, eventId, token, JSON.stringify({ [action]: { status, commandId } })]
    );
    if (!result.rowCount) throw new Error("voice_webhook_lease_lost");
    checkpoints[action] = { status, commandId };
  };
  let heartbeatFailure: unknown;
  const heartbeat = setInterval(() => { void assertOwned().catch(error => { heartbeatFailure = error; }); }, 30000);
  heartbeat.unref?.();
  try {
    await handle({
      attempt: Number(claim.rows?.[0]?.processing_attempts || 1),
      assertOwned,
      command: async (action, send, reconcile) => {
        await assertOwned();
        const previous = checkpoints[action];
        if (previous?.status === "completed") return;
        // A crash/timeout after submission is not evidence of rejection. Never
        // blindly retry beyond the provider's bounded deduplication window.
        if (previous?.status === "submitted" || previous?.status === "rejected") {
          if (await reconcile()) {
            await checkpoint(action, "completed", previous.commandId);
            return;
          }
          throw new Error(`voice_command_reconciliation_required:${action}`);
        }
        const digest = hashPayload(`${provider}:${eventId}:${input.resourceId}:${action}`);
        const commandId = `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
        await checkpoint(action, "submitted", commandId);
        try {
          await send(commandId);
        } catch (error) {
          const status = Number((error as any)?.status);
          // 429 is a definite rejection and may be retried. Network, 408, and
          // 5xx results remain ambiguous. Other 4xx require reconciliation.
          if (status === 429) await checkpoint(action, "retryable", commandId);
          else if (status >= 400 && status < 500 && status !== 408) await checkpoint(action, "rejected", commandId);
          throw error;
        }
        await checkpoint(action, "completed", commandId);
      }
    });
    if (heartbeatFailure) throw heartbeatFailure;
    const completed = await pool.query(
      `UPDATE inbound_webhook_events SET processing_status='completed', completed_at=NOW(),
         processing_token=NULL, lease_expires_at=NULL, last_error=NULL, raw_payload=NULL
       WHERE provider=$1 AND event_id=$2 AND processing_token=$3
         AND processing_status='processing' AND lease_expires_at > NOW() RETURNING id`,
      [provider, eventId, token]
    );
    if (!completed.rowCount) throw new Error("voice_webhook_lease_lost");
    return "completed";
  } catch (error) {
    await pool.query(
      `UPDATE inbound_webhook_events SET processing_status='failed', processing_token=NULL,
         lease_expires_at=NULL, last_error=$4,
         next_attempt_at=NOW()+(LEAST(300, 5*power(2,LEAST(processing_attempts,6))) * INTERVAL '1 second')
       WHERE provider=$1 AND event_id=$2 AND processing_token=$3 AND processing_status='processing'`,
      [provider, eventId, token, String((error as Error)?.message || error).slice(0, 500)]
    ).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

// Only payloads admitted by the signature-checked route enter this queue. Keep
// unresolved evidence until recovery and erase payload text on completion.
export async function recoverInboundVoiceWebhooks(
  pool: NonNullable<QueryablePool>,
  handle: (rawPayload: string) => Promise<unknown>
) {
  const pending = await pool.query(
    `SELECT raw_payload FROM inbound_webhook_events
     WHERE provider='telnyx_voice_inbound' AND raw_payload IS NOT NULL AND next_attempt_at <= NOW()
       AND (processing_status='failed' OR (processing_status='processing' AND lease_expires_at < NOW()))
     ORDER BY next_attempt_at, first_received_at LIMIT 10`
  );
  return Promise.allSettled((pending.rows || []).map(row => handle(String(row.raw_payload))));
}
