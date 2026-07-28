import type { Pool, PoolClient, QueryResult } from "pg";

export type JsonObject = Record<string, unknown>;

export type SalesCallContext = {
  salesCallId: string;
  prospectId: string;
  adminUserId: number | null;
  state: string;
  aiState: string | null;
  conferenceId: string | null;
  conferenceName: string | null;
  operatorCallControlId: string | null;
  operatorLegId: string | null;
  operatorSessionId: string | null;
  prospectCallControlId: string | null;
  prospectLegId: string | null;
  prospectSessionId: string | null;
  aiTelnyxCallControlId: string | null;
  aiTelnyxLegId: string | null;
  aiTelnyxSessionId: string | null;
  openaiCallId: string | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  outcome: string | null;
  startedAt: string | Date | null;
  connectedAt: string | Date | null;
  demoStartedAt: string | Date | null;
  demoEndedAt: string | Date | null;
  endedAt: string | Date | null;
  metadata: JsonObject;
  businessName: string;
  prospectNumber: string;
  permissionGranted: boolean;
  suppressed: boolean;
  doNotCall: boolean;
  prospectStatus: string;
  prospectTimezone: string | null;
  demoProfileId: string | null;
  demoStatus: string | null;
  demoExpiresAt: string | Date | null;
  demoBusinessName: string | null;
  demoBundle: JsonObject;
};

export type SalesCallPatch = {
  state?: string | null;
  ai_state?: string | null;
  aiState?: string | null;
  conference_id?: string | null;
  conferenceId?: string | null;
  conference_name?: string | null;
  conferenceName?: string | null;
  operator_call_control_id?: string | null;
  operatorCallControlId?: string | null;
  operator_leg_id?: string | null;
  operatorLegId?: string | null;
  operator_session_id?: string | null;
  operatorSessionId?: string | null;
  prospect_call_control_id?: string | null;
  prospectCallControlId?: string | null;
  prospect_leg_id?: string | null;
  prospectLegId?: string | null;
  prospect_session_id?: string | null;
  prospectSessionId?: string | null;
  ai_telnyx_call_control_id?: string | null;
  aiTelnyxCallControlId?: string | null;
  ai_telnyx_leg_id?: string | null;
  aiTelnyxLegId?: string | null;
  ai_telnyx_session_id?: string | null;
  aiTelnyxSessionId?: string | null;
  openai_call_id?: string | null;
  openaiCallId?: string | null;
  provider_error_code?: string | null;
  providerErrorCode?: string | null;
  provider_error_message?: string | null;
  providerErrorMessage?: string | null;
  started_at?: string | Date | null;
  startedAt?: string | Date | null;
  connected_at?: string | Date | null;
  connectedAt?: string | Date | null;
  demo_started_at?: string | Date | null;
  demoStartedAt?: string | Date | null;
  demo_ended_at?: string | Date | null;
  demoEndedAt?: string | Date | null;
  ended_at?: string | Date | null;
  endedAt?: string | Date | null;
  outcome?: string | null;
  metadata_json?: JsonObject | null;
  metadata?: JsonObject | null;
};

export type SalesCallEventInput = {
  salesCallId: string;
  provider: string;
  eventId: string;
  type: string;
  payload: JsonObject;
  occurredAt?: string | null;
};

export type SalesCallEventClaimInput = SalesCallEventInput & {
  claimToken: string;
  staleAfterSeconds?: number;
};

export type RecoverableSalesCallEvent = {
  salesCallId: string;
  provider: string;
  eventId: string;
  type: string;
  payload: JsonObject;
  occurredAt: string | Date | null;
  processingAttempts: number;
};

export type ClaimTransitionInput = {
  allowedStates?: string[];
  allowedAiStates?: Array<string | null>;
  patch: SalesCallPatch;
};

export interface SalesGatewayRepository {
  getCallContext(salesCallId: string): Promise<SalesCallContext | null>;
  patchCall(salesCallId: string, patch: SalesCallPatch): Promise<SalesCallContext>;
  claimTransition(
    salesCallId: string,
    input: ClaimTransitionInput
  ): Promise<{ claimed: boolean; call: SalesCallContext | null }>;
  claimEvent(input: SalesCallEventClaimInput): Promise<{
    claimed: boolean;
    status: string;
    processingAttempts: number;
  }>;
  completeEvent(provider: string, eventId: string, claimToken: string): Promise<boolean>;
  failEvent(
    provider: string,
    eventId: string,
    claimToken: string,
    errorCode: string,
    errorMessage: string
  ): Promise<boolean>;
  findCallIdByProviderRefs(payload: JsonObject): Promise<string | null>;
  listRecoverableEvents(): Promise<RecoverableSalesCallEvent[]>;
  listRecoverableCalls(): Promise<SalesCallContext[]>;
}

type Queryable = Pick<Pool | PoolClient, "query">;

const CALL_CONTEXT_SELECT = `
  SELECT
    s.*,
    p.business_name AS prospect_business_name,
    p.phone_e164 AS prospect_number,
    p.permission_granted,
    p.suppressed,
    p.do_not_call,
    p.status AS prospect_status,
    p.timezone AS prospect_timezone,
    d.demo_profile_id,
    d.status AS demo_status,
    d.expires_at AS demo_expires_at,
    d.business_name AS demo_business_name,
    d.demo_bundle_json
  FROM sales_call_sessions s
  JOIN sales_prospects p ON p.prospect_id = s.prospect_id
  LEFT JOIN sales_demo_profiles d ON d.prospect_id = s.prospect_id`;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function serializeCallContext(row: Record<string, unknown> | undefined): SalesCallContext | null {
  if (!row) return null;
  return {
    salesCallId: text(row.sales_call_id),
    prospectId: text(row.prospect_id),
    adminUserId: row.admin_user_id ? Number(row.admin_user_id) : null,
    state: text(row.state) || "created",
    aiState: nullableText(row.ai_state),
    conferenceId: nullableText(row.conference_id),
    conferenceName: nullableText(row.conference_name),
    operatorCallControlId: nullableText(row.operator_call_control_id),
    operatorLegId: nullableText(row.operator_leg_id),
    operatorSessionId: nullableText(row.operator_session_id),
    prospectCallControlId: nullableText(row.prospect_call_control_id),
    prospectLegId: nullableText(row.prospect_leg_id),
    prospectSessionId: nullableText(row.prospect_session_id),
    aiTelnyxCallControlId: nullableText(row.ai_telnyx_call_control_id),
    aiTelnyxLegId: nullableText(row.ai_telnyx_leg_id),
    aiTelnyxSessionId: nullableText(row.ai_telnyx_session_id),
    openaiCallId: nullableText(row.openai_call_id),
    providerErrorCode: nullableText(row.provider_error_code),
    providerErrorMessage: nullableText(row.provider_error_message),
    outcome: nullableText(row.outcome),
    startedAt: row.started_at as string | Date | null,
    connectedAt: row.connected_at as string | Date | null,
    demoStartedAt: row.demo_started_at as string | Date | null,
    demoEndedAt: row.demo_ended_at as string | Date | null,
    endedAt: row.ended_at as string | Date | null,
    metadata: jsonObject(row.metadata_json),
    businessName: text(row.prospect_business_name),
    prospectNumber: text(row.prospect_number),
    permissionGranted: Boolean(row.permission_granted),
    suppressed: Boolean(row.suppressed),
    doNotCall: Boolean(row.do_not_call),
    prospectStatus: text(row.prospect_status),
    prospectTimezone: nullableText(row.prospect_timezone),
    demoProfileId: nullableText(row.demo_profile_id),
    demoStatus: nullableText(row.demo_status),
    demoExpiresAt: row.demo_expires_at as string | Date | null,
    demoBusinessName: nullableText(row.demo_business_name),
    demoBundle: jsonObject(row.demo_bundle_json)
  };
}

const PATCH_COLUMNS: ReadonlyArray<{
  camel: keyof SalesCallPatch;
  snake: keyof SalesCallPatch;
  column: string;
  json?: boolean;
}> = [
  { camel: "state", snake: "state", column: "state" },
  { camel: "aiState", snake: "ai_state", column: "ai_state" },
  { camel: "conferenceId", snake: "conference_id", column: "conference_id" },
  { camel: "conferenceName", snake: "conference_name", column: "conference_name" },
  {
    camel: "operatorCallControlId",
    snake: "operator_call_control_id",
    column: "operator_call_control_id"
  },
  { camel: "operatorLegId", snake: "operator_leg_id", column: "operator_leg_id" },
  {
    camel: "operatorSessionId",
    snake: "operator_session_id",
    column: "operator_session_id"
  },
  {
    camel: "prospectCallControlId",
    snake: "prospect_call_control_id",
    column: "prospect_call_control_id"
  },
  { camel: "prospectLegId", snake: "prospect_leg_id", column: "prospect_leg_id" },
  {
    camel: "prospectSessionId",
    snake: "prospect_session_id",
    column: "prospect_session_id"
  },
  {
    camel: "aiTelnyxCallControlId",
    snake: "ai_telnyx_call_control_id",
    column: "ai_telnyx_call_control_id"
  },
  { camel: "aiTelnyxLegId", snake: "ai_telnyx_leg_id", column: "ai_telnyx_leg_id" },
  {
    camel: "aiTelnyxSessionId",
    snake: "ai_telnyx_session_id",
    column: "ai_telnyx_session_id"
  },
  { camel: "openaiCallId", snake: "openai_call_id", column: "openai_call_id" },
  {
    camel: "providerErrorCode",
    snake: "provider_error_code",
    column: "provider_error_code"
  },
  {
    camel: "providerErrorMessage",
    snake: "provider_error_message",
    column: "provider_error_message"
  },
  { camel: "startedAt", snake: "started_at", column: "started_at" },
  { camel: "connectedAt", snake: "connected_at", column: "connected_at" },
  { camel: "demoStartedAt", snake: "demo_started_at", column: "demo_started_at" },
  { camel: "demoEndedAt", snake: "demo_ended_at", column: "demo_ended_at" },
  { camel: "endedAt", snake: "ended_at", column: "ended_at" },
  { camel: "outcome", snake: "outcome", column: "outcome" },
  { camel: "metadata", snake: "metadata_json", column: "metadata_json", json: true }
];

function patchAssignments(
  patch: SalesCallPatch,
  values: unknown[]
): string[] {
  const assignments: string[] = [];
  for (const descriptor of PATCH_COLUMNS) {
    const camelPresent = Object.prototype.hasOwnProperty.call(patch, descriptor.camel);
    const snakePresent = Object.prototype.hasOwnProperty.call(patch, descriptor.snake);
    if (!camelPresent && !snakePresent) continue;
    const value = camelPresent ? patch[descriptor.camel] : patch[descriptor.snake];
    values.push(descriptor.json ? JSON.stringify(jsonObject(value)) : value ?? null);
    const placeholder = `$${values.length}`;
    assignments.push(descriptor.json
      ? `${descriptor.column} = COALESCE(${descriptor.column}, '{}'::jsonb) || ${placeholder}::jsonb`
      : `${descriptor.column} = ${placeholder}`);
  }
  return assignments;
}

async function loadCall(db: Queryable, salesCallId: string): Promise<SalesCallContext | null> {
  const result = await db.query(
    `${CALL_CONTEXT_SELECT}
     WHERE s.sales_call_id = $1
     LIMIT 1`,
    [text(salesCallId)]
  );
  return serializeCallContext(result.rows[0] as Record<string, unknown> | undefined);
}

export function createPostgresSalesGatewayRepository(
  pool: Pool
): SalesGatewayRepository {
  return {
    getCallContext(salesCallId) {
      return loadCall(pool, salesCallId);
    },

    async patchCall(salesCallId, patch) {
      const values: unknown[] = [];
      const assignments = patchAssignments(patch, values);
      if (assignments.length) {
        values.push(text(salesCallId));
        const result = await pool.query(
          `UPDATE sales_call_sessions
           SET ${assignments.join(", ")},
               updated_at = NOW()
           WHERE sales_call_id = $${values.length}
           RETURNING sales_call_id`,
          values
        );
        if (!result.rowCount) throw new Error("sales_call_not_found");
      }
      const call = await loadCall(pool, salesCallId);
      if (!call) throw new Error("sales_call_not_found");
      return call;
    },

    async claimTransition(salesCallId, input) {
      const values: unknown[] = [];
      const assignments = patchAssignments(input.patch, values);
      if (!assignments.length) throw new Error("sales_call_transition_patch_required");
      const where = [`sales_call_id = $${values.length + 1}`];
      values.push(text(salesCallId));
      if (input.allowedStates?.length) {
        values.push(input.allowedStates);
        where.push(`state = ANY($${values.length}::text[])`);
      }
      if (input.allowedAiStates?.length) {
        const nonNull = input.allowedAiStates.filter((value): value is string => value !== null);
        const acceptsNull = nonNull.length !== input.allowedAiStates.length;
        if (nonNull.length) {
          values.push(nonNull);
          const match = `ai_state = ANY($${values.length}::text[])`;
          where.push(acceptsNull ? `(${match} OR ai_state IS NULL)` : match);
        } else {
          where.push("ai_state IS NULL");
        }
      }
      const result = await pool.query(
        `UPDATE sales_call_sessions
         SET ${assignments.join(", ")},
             updated_at = NOW()
         WHERE ${where.join(" AND ")}
         RETURNING sales_call_id`,
        values
      );
      return {
        claimed: Boolean(result.rowCount),
        call: await loadCall(pool, salesCallId)
      };
    },

    async claimEvent(input) {
      const claimToken = text(input.claimToken);
      if (!claimToken) throw new Error("sales_call_event_claim_token_required");
      const requestedStaleSeconds = Number(input.staleAfterSeconds);
      const staleAfterSeconds = Math.max(
        0,
        Math.min(
          3600,
          Number.isFinite(requestedStaleSeconds) ? requestedStaleSeconds : 120
        )
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO sales_call_events (
             sales_call_id,
             provider,
             event_id,
             type,
             payload_json,
             occurred_at,
             processing_status
           )
           VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()), 'received')
           ON CONFLICT (provider, event_id)
           DO NOTHING`,
          [
            text(input.salesCallId),
            text(input.provider),
            text(input.eventId),
            text(input.type),
            JSON.stringify(jsonObject(input.payload)),
            input.occurredAt || null
          ]
        );
        const claimed = await client.query(
          `UPDATE sales_call_events
           SET processing_status = 'processing',
               processing_attempts = processing_attempts + 1,
               processing_token = $4,
               processing_started_at = NOW(),
               last_error_code = NULL,
               last_error_message = NULL
           WHERE provider = $1
             AND event_id = $2
             AND sales_call_id = $3
             AND (
               processing_status IN ('received', 'failed')
               OR (
                 processing_status = 'processing'
                 AND processing_started_at < NOW() - ($5::double precision * INTERVAL '1 second')
               )
             )
           RETURNING processing_status, processing_attempts`,
          [
            text(input.provider),
            text(input.eventId),
            text(input.salesCallId),
            claimToken,
            staleAfterSeconds
          ]
        );
        const current = claimed.rowCount
          ? claimed
          : await client.query(
              `SELECT processing_status, processing_attempts
               FROM sales_call_events
               WHERE provider = $1
                 AND event_id = $2
               LIMIT 1`,
              [text(input.provider), text(input.eventId)]
            );
        await client.query("COMMIT");
        const row = current.rows[0] as Record<string, unknown> | undefined;
        return {
          claimed: Boolean(claimed.rowCount),
          status: text(row?.processing_status) || "unknown",
          processingAttempts: Number(row?.processing_attempts) || 0
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async completeEvent(provider, eventId, claimToken) {
      const result = await pool.query(
        `UPDATE sales_call_events
         SET processing_status = 'processed',
             processing_token = NULL,
             processed_at = NOW(),
             last_error_code = NULL,
             last_error_message = NULL
         WHERE provider = $1
           AND event_id = $2
           AND processing_token = $3
           AND processing_status = 'processing'`,
        [text(provider), text(eventId), text(claimToken)]
      );
      return Boolean(result.rowCount);
    },

    async failEvent(provider, eventId, claimToken, errorCode, errorMessage) {
      const result = await pool.query(
        `UPDATE sales_call_events
         SET processing_status = 'failed',
             processing_token = NULL,
             last_error_code = $4,
             last_error_message = $5
         WHERE provider = $1
           AND event_id = $2
           AND processing_token = $3
           AND processing_status = 'processing'`,
        [
          text(provider),
          text(eventId),
          text(claimToken),
          text(errorCode).slice(0, 200) || "processing_failed",
          text(errorMessage).slice(0, 1000) || "Provider event processing failed."
        ]
      );
      return Boolean(result.rowCount);
    },

    async findCallIdByProviderRefs(payload) {
      const callControlId = text(payload.call_control_id);
      const callLegId = text(payload.call_leg_id);
      const callSessionId = text(payload.call_session_id);
      const conferenceId = text(payload.conference_id);
      const openaiCallId = text(payload.call_id ?? payload.openai_call_id);
      if (!callControlId && !callLegId && !callSessionId && !conferenceId && !openaiCallId) {
        return null;
      }
      const result = await pool.query(
        `SELECT sales_call_id
         FROM sales_call_sessions
         WHERE ($1 <> '' AND $1 IN (
                  COALESCE(operator_call_control_id, ''),
                  COALESCE(prospect_call_control_id, ''),
                  COALESCE(ai_telnyx_call_control_id, '')
                ))
            OR ($2 <> '' AND $2 IN (
                  COALESCE(operator_leg_id, ''),
                  COALESCE(prospect_leg_id, ''),
                  COALESCE(ai_telnyx_leg_id, '')
                ))
            OR ($3 <> '' AND $3 IN (
                  COALESCE(operator_session_id, ''),
                  COALESCE(prospect_session_id, ''),
                  COALESCE(ai_telnyx_session_id, '')
                ))
            OR ($4 <> '' AND $4 = COALESCE(conference_id, ''))
            OR ($5 <> '' AND $5 = COALESCE(openai_call_id, ''))
         ORDER BY created_at DESC
         LIMIT 1`,
        [callControlId, callLegId, callSessionId, conferenceId, openaiCallId]
      );
      return nullableText(result.rows[0]?.sales_call_id);
    },

    async listRecoverableEvents() {
      const result: QueryResult = await pool.query(
        `SELECT
           sales_call_id,
           provider,
           event_id,
           type,
           payload_json,
           occurred_at,
           processing_attempts
         FROM sales_call_events
         WHERE processing_status IN ('received', 'processing', 'failed')
         ORDER BY created_at ASC
         LIMIT 100`
      );
      return result.rows.map((row) => ({
        salesCallId: text(row.sales_call_id),
        provider: text(row.provider),
        eventId: text(row.event_id),
        type: text(row.type),
        payload: jsonObject(row.payload_json),
        occurredAt: row.occurred_at as string | Date | null,
        processingAttempts: Number(row.processing_attempts) || 0
      }));
    },

    async listRecoverableCalls() {
      const result: QueryResult = await pool.query(
        `${CALL_CONTEXT_SELECT}
         WHERE (
             s.state = 'preparing_call'
             OR (
               s.ai_state = 'dialing_standby'
               AND (
                 s.conference_id IS NULL
                 OR s.prospect_call_control_id IS NULL
                 OR s.ai_telnyx_call_control_id IS NULL
               )
             )
             OR
             (
               s.openai_call_id IS NOT NULL
               AND s.ai_state IN (
                 'sip_connected',
                 'accepting',
                 'accepting_sip_connected',
                 'realtime_ready_waiting_sip',
                 'ready',
                 'joining',
                 'live',
                 'pausing',
                 'paused'
               )
             )
             OR s.state IN ('ending_demo', 'ending')
           )
           AND s.state NOT IN ('closed', 'ended', 'completed', 'failed')
         ORDER BY s.updated_at DESC
         LIMIT 100`
      );
      return result.rows
        .map((row) => serializeCallContext(row as Record<string, unknown>))
        .filter((call): call is SalesCallContext => Boolean(call));
    }
  };
}
