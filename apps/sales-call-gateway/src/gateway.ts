import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  INTERNAL_AUTH_PURPOSES,
  isValidInternalServiceToken
} from "@everycall/contracts/internalAuth";
import {
  createInMemorySalesRealtimeRegistry,
  createSalesCallOrchestrator
} from "./salesCallOrchestrator.js";
import {
  buildSalesRealtimeAcceptPayload,
  normalizeSalesOpenAIIncomingCallEvent,
  verifySalesOpenAIWebhook
} from "./salesOpenAIRealtime.js";
import {
  normalizeSalesTelnyxWebhookEvent,
  salesTelnyxCallPatch,
  verifySalesTelnyxWebhook
} from "./salesTelnyxClient.js";
import {
  deriveSalesCommandId,
  summarizeSalesProviderError
} from "./salesCallProviderUtils.js";
import {
  isPreparedSalesDemo,
  resolveSalesDemoBusinessName,
  resolveSalesDemoInstructions
} from "./salesDemoInstructions.js";
import type {
  JsonObject,
  SalesCallContext,
  SalesCallPatch,
  SalesGatewayRepository
} from "./repository.js";

type Logger = {
  info?: (event: string, fields?: JsonObject) => void;
  warn?: (event: string, fields?: JsonObject) => void;
  error?: (event: string, fields?: JsonObject) => void;
};

type GatewayOptions = {
  repository: SalesGatewayRepository;
  telnyx: any;
  openai: any;
  internalAuthEnv?: Record<string, unknown>;
  telnyxPublicKey?: string;
  telnyxOperatorConnectionId?: string;
  openaiWebhookSecret?: string;
  requireTelnyxSignature?: boolean;
  requireOpenAISignature?: boolean;
  logger?: Logger;
  now?: () => number | Date;
  salesCallingWindowEnv?: Record<string, string | undefined>;
  participantJoinWaiter?: ((input: JsonObject) => Promise<unknown>) | null;
  aiDemoMaxSeconds?: number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
};

type GatewayAction = "start_demo" | "pause_ai" | "end_demo" | "end_call";

type GatewayActionResult = {
  call: SalesCallContext;
  replayed: boolean;
  pending?: boolean;
};

const TERMINAL_STATES = new Set([
  "closed",
  "completed",
  "ended",
  "failed",
  "no_answer",
  "voicemail",
  "wrong_number",
  "not_interested",
  "do_not_call",
  "canceled",
  "cancelled"
]);
const ACTIVE_PROSPECT_STATUSES = new Set(["queued", "ready_to_call"]);
const ACTIONS = new Set<GatewayAction>([
  "start_demo",
  "pause_ai",
  "end_demo",
  "end_call"
]);
const INTENTIONAL_AI_TEARDOWN_STATES = new Set([
  "ending_demo",
  "ending",
  "demo_ended",
  "closed",
  "ended",
  "failed"
]);

function parseLocalClock(value: unknown, fallback: string) {
  const normalized = text(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return parseLocalClock(fallback, "00:00");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return parseLocalClock(fallback, "00:00");
  }
  return (hours * 60) + minutes;
}

export function gatewaySalesCallingWindowAllows({
  timezone,
  now,
  env = process.env
}: {
  timezone: string | null;
  now: number | Date;
  env?: Record<string, string | undefined>;
}): boolean {
  const normalizedTimezone = text(timezone);
  if (!normalizedTimezone) {
    return text(env.SALES_CALL_MISSING_TIMEZONE_POLICY).toLowerCase() === "allow";
  }
  let localMinutes;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(now));
    localMinutes = (
      Number(parts.find((part) => part.type === "hour")?.value || 0) * 60
    ) + Number(parts.find((part) => part.type === "minute")?.value || 0);
  } catch {
    return false;
  }
  const start = parseLocalClock(
    env.SALES_CALL_WINDOW_START_LOCAL,
    "08:00"
  );
  const end = parseLocalClock(
    env.SALES_CALL_WINDOW_END_LOCAL,
    "20:00"
  );
  if (start === end) return true;
  return start < end
    ? localMinutes >= start && localMinutes < end
    : localMinutes >= start || localMinutes < end;
}

export class SalesGatewayHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SalesGatewayHttpError";
    this.status = status;
    this.code = code;
  }
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function rawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  return JSON.stringify(req.body ?? {});
}

function nowIso(now: () => number | Date): string {
  const value = now();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function eventIdOrDigest(provider: string, eventId: unknown, body: string): string {
  const normalized = text(eventId);
  if (normalized) return normalized;
  return `${provider}:sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
}

function secureTextEqual(left: unknown, right: unknown): boolean {
  const leftBytes = Buffer.from(text(left), "utf8");
  const rightBytes = Buffer.from(text(right), "utf8");
  return leftBytes.length > 0
    && leftBytes.length === rightBytes.length
    && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function errorPatch(error: any): SalesCallPatch {
  const explicit = asObject(error?.patch) as SalesCallPatch;
  const summarized = summarizeSalesProviderError(error);
  return {
    ...explicit,
    provider_error_code: text(explicit.provider_error_code) || summarized.provider_error_code,
    provider_error_message: text(explicit.provider_error_message)
      || summarized.provider_error_message
  };
}

function teardownErrorPatch(teardown: unknown): SalesCallPatch {
  const failed = Array.isArray(teardown)
    ? teardown.filter((entry) => entry?.status === "rejected")
    : [];
  if (!failed.length) {
    return {
      provider_error_code: null,
      provider_error_message: null
    };
  }
  return {
    provider_error_code: "teardown_partial_failure",
    provider_error_message: failed
      .map((entry) => `${text(entry?.action)}: ${text(entry?.error)}`)
      .join(" | ")
      .slice(0, 1000)
  };
}

function teardownHasFailures(teardown: unknown): boolean {
  return Array.isArray(teardown)
    && teardown.some((entry) => entry?.status === "rejected");
}

function callIsEligible(
  call: SalesCallContext,
  now: () => number | Date,
  salesCallingWindowEnv: Record<string, string | undefined>
): boolean {
  return call.permissionGranted
    && !call.suppressed
    && !call.doNotCall
    && ACTIVE_PROSPECT_STATUSES.has(call.prospectStatus)
    && gatewaySalesCallingWindowAllows({
      timezone: call.prospectTimezone,
      now: now(),
      env: salesCallingWindowEnv
    })
    && isPreparedSalesDemo(call);
}

function providerFieldsFromEvent(event: any): SalesCallPatch {
  return asObject(event?.patch) as SalesCallPatch;
}

function bearerToken(req: Request): string {
  const authorization = text(req.header("authorization"));
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
}

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function createCallLock() {
  const tails = new Map<string, Promise<void>>();
  return async function withCallLock<T>(salesCallId: string, action: () => Promise<T>): Promise<T> {
    const key = text(salesCallId);
    const previous = tails.get(key) || Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    tails.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

export function createSalesCallGateway(options: GatewayOptions) {
  const {
    repository,
    telnyx,
    openai,
    internalAuthEnv = process.env,
    telnyxPublicKey = "",
    telnyxOperatorConnectionId = "",
    openaiWebhookSecret = "",
    requireTelnyxSignature = true,
    requireOpenAISignature = true,
    logger = {},
    now = Date.now,
    salesCallingWindowEnv = process.env,
    participantJoinWaiter = null,
    aiDemoMaxSeconds = 600,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
  } = options;
  if (!repository || !telnyx || !openai) {
    throw new Error("sales_gateway_dependencies_required");
  }

  const realtimeRegistry = createInMemorySalesRealtimeRegistry();
  const orchestrator: any = (createSalesCallOrchestrator as any)({
    telnyx,
    openai,
    realtimeRegistry,
    participantJoinWaiter,
    now,
    logger
  });
  const withCallLock = createCallLock();
  const demoTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const selectedDemoMaxSeconds = Math.max(
    30,
    Math.min(3600, Number(aiDemoMaxSeconds) || 600)
  );
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  function log(level: keyof Logger, event: string, fields: JsonObject = {}) {
    const writer = logger[level];
    if (typeof writer === "function") writer.call(logger, event, fields);
  }

  function clearDemoTimer(salesCallId: string) {
    const timer = demoTimers.get(salesCallId);
    if (timer) clearTimeoutImpl(timer);
    demoTimers.delete(salesCallId);
  }

  async function expireDemoWithinLock(call: SalesCallContext) {
    if (!["ai_live", "ai_paused"].includes(call.state)
      && !["live", "paused"].includes(call.aiState || "")) return call;
    const result = await orchestrator.endDemo({
      salesCallId: call.salesCallId,
      correlationId: text(call.metadata.correlation_id) || call.salesCallId,
      conferenceId: call.conferenceId,
      aiTelnyxCallControlId: call.aiTelnyxCallControlId,
      openaiCallId: call.openaiCallId
    });
    clearDemoTimer(call.salesCallId);
    return repository.patchCall(call.salesCallId, {
      ...result.patch,
      ...teardownErrorPatch(result.teardown),
      metadata_json: {
        demo_auto_ended_at: nowIso(now),
        demo_auto_end_reason: "duration_limit"
      }
    });
  }

  function scheduleDemoTimer(call: SalesCallContext) {
    clearDemoTimer(call.salesCallId);
    if (!call.demoStartedAt || !["live", "paused"].includes(call.aiState || "")) {
      return;
    }
    const startedAtMs = new Date(call.demoStartedAt).getTime();
    const nowValue = now();
    const nowMs = (nowValue instanceof Date ? nowValue : new Date(nowValue)).getTime();
    const elapsedMs = Number.isFinite(startedAtMs)
      ? Math.max(0, nowMs - startedAtMs)
      : 0;
    const remainingMs = Math.max(
      0,
      selectedDemoMaxSeconds * 1000 - elapsedMs
    );
    const timer = setTimeoutImpl(() => {
      demoTimers.delete(call.salesCallId);
      void withCallLock(call.salesCallId, async () => {
        const current = await repository.getCallContext(call.salesCallId);
        if (!current) return;
        await expireDemoWithinLock(current);
      }).catch((error) => {
        log("error", "sales_ai_demo_duration_teardown_failed", {
          sales_call_id: call.salesCallId,
          message: text((error as Error)?.message)
        });
      });
    }, remainingMs);
    if (typeof (timer as any)?.unref === "function") (timer as any).unref();
    demoTimers.set(call.salesCallId, timer);
  }

  async function loadRequiredCall(salesCallId: string): Promise<SalesCallContext> {
    const call = await repository.getCallContext(salesCallId);
    if (!call) {
      throw new SalesGatewayHttpError(404, "sales_call_not_found", "Sales call not found.");
    }
    return call;
  }

  function monitorCallbacks(salesCallId: string) {
    const noteRuntimeProblem = async (code: string, message: string) => {
      try {
        await withCallLock(salesCallId, async () => {
          const call = await repository.getCallContext(salesCallId);
          if (!call || TERMINAL_STATES.has(call.state)
            || INTENTIONAL_AI_TEARDOWN_STATES.has(call.state)
            || call.aiState === "failed") return;
          clearDemoTimer(salesCallId);
          let teardown: unknown = [];
          try {
            const result = await orchestrator.endDemo({
              salesCallId,
              correlationId: text(call.metadata.correlation_id) || salesCallId,
              conferenceId: call.conferenceId,
              aiTelnyxCallControlId: call.aiTelnyxCallControlId,
              openaiCallId: call.openaiCallId
            });
            teardown = result.teardown;
          } catch (error) {
            log("error", "sales_ai_runtime_teardown_failed", {
              sales_call_id: salesCallId,
              message: text((error as Error)?.message)
            });
          }
          const teardownFailed = teardownHasFailures(teardown);
          await repository.patchCall(salesCallId, {
            ...teardownErrorPatch(teardown),
            ...(teardownFailed
              ? {
                  state: "ending_demo",
                  ai_state: "tearing_down",
                  metadata_json: {
                    teardown_return_state: "prospect_connected",
                    teardown_failure_mode: "runtime_failed"
                  }
                }
              : {
                  ...(["ai_live", "ai_paused", "starting_demo"]
                    .includes(call.state)
                    ? { state: "prospect_connected" }
                    : {}),
                  ai_state: "failed"
                }),
            provider_error_code: code,
            provider_error_message: message.slice(0, 1000)
          });
        });
      } catch (error) {
        log("error", "sales_ai_runtime_error_persist_failed", {
          sales_call_id: salesCallId,
          message: text((error as Error)?.message)
        });
      }
    };
    return {
      onEvent(event: any) {
        if (event?.type !== "error") return;
        const message = text(event?.error?.message || "OpenAI Realtime reported an error.");
        void noteRuntimeProblem(
          `openai:realtime:${text(event?.error?.code) || "error"}`,
          message
        );
      },
      onError(error: unknown) {
        void noteRuntimeProblem(
          "openai:realtime:websocket_error",
          text((error as Error)?.message || "OpenAI Realtime WebSocket error.")
        );
      },
      onClose() {
        realtimeRegistry.delete(salesCallId);
        void noteRuntimeProblem(
          "openai:realtime:websocket_closed",
          "OpenAI Realtime standby disconnected unexpectedly."
        );
      }
    };
  }

  async function runCallPreparation(
    call: SalesCallContext,
    providerPatch: SalesCallPatch = {}
  ): Promise<SalesCallContext> {
    const salesCallId = call.salesCallId;
    try {
      const result = await orchestrator.beginCall({
        salesCallId,
        correlationId: text(call.metadata.correlation_id) || salesCallId,
        operator: {
          call_control_id: call.operatorCallControlId
            || providerPatch.operator_call_control_id,
          call_leg_id: call.operatorLegId || providerPatch.operator_leg_id,
          call_session_id: call.operatorSessionId || providerPatch.operator_session_id
        },
        prospectNumber: text(call.metadata.prospect_number) || call.prospectNumber,
        correlationNonce: text(call.metadata.sip_correlation_nonce),
        existingConference: call.conferenceId
          ? {
              conference_id: call.conferenceId,
              conference_name: call.conferenceName
            }
          : null,
        existingProspect: call.prospectCallControlId
          ? {
              call_control_id: call.prospectCallControlId,
              call_leg_id: call.prospectLegId,
              call_session_id: call.prospectSessionId
            }
          : null,
        existingAI: call.aiTelnyxCallControlId
          ? {
              call_control_id: call.aiTelnyxCallControlId,
              call_leg_id: call.aiTelnyxLegId,
              call_session_id: call.aiTelnyxSessionId
            }
          : null,
        onCheckpoint: (patch: SalesCallPatch) => (
          repository.patchCall(salesCallId, patch)
        )
      });
      const latest = await loadRequiredCall(salesCallId);
      return repository.patchCall(salesCallId, {
        ...result.patch,
        ...(latest.connectedAt ? { state: "prospect_connected" } : {}),
        provider_error_code: null,
        provider_error_message: null
      });
    } catch (error) {
      const teardown = Array.isArray((error as any)?.teardown)
        ? (error as any).teardown
        : [];
      const teardownFailed = teardown.some((entry: any) => (
        entry?.status === "rejected"
      ));
      await repository.patchCall(salesCallId, {
        ...errorPatch(error),
        ...(teardownFailed ? teardownErrorPatch(teardown) : {}),
        state: teardownFailed ? "ending" : "failed",
        ai_state: teardownFailed ? "tearing_down" : "failed",
        ...(teardownFailed ? {} : { ended_at: nowIso(now) })
      });
      throw error;
    }
  }

  async function rejectOperatorLeg(
    call: SalesCallContext,
    providerPatch: SalesCallPatch,
    code: string,
    message: string
  ): Promise<SalesCallContext> {
    const salesCallId = call.salesCallId;
    const ending = await repository.patchCall(salesCallId, {
      ...providerPatch,
      state: "ending",
      ai_state: "tearing_down",
      provider_error_code: code,
      provider_error_message: message,
      metadata_json: { operator_rejection_code: code }
    });
    const result = await orchestrator.endCall({
      salesCallId,
      correlationId: text(call.metadata.correlation_id) || salesCallId,
      operatorCallControlId: ending.operatorCallControlId,
      outcome: "canceled"
    });
    return repository.patchCall(salesCallId, {
      ...result.patch,
      ...(result.teardown_complete
        ? {
            state: "failed",
            ai_state: "ended",
            provider_error_code: code,
            provider_error_message: message
          }
        : teardownErrorPatch(result.teardown))
    });
  }

  async function beginCallFromOperator(
    salesCallId: string,
    event: any
  ): Promise<SalesCallContext> {
    const existing = await loadRequiredCall(salesCallId);
    const providerPatch = providerFieldsFromEvent(event);
    if (existing.conferenceId || !["created", "connecting_browser"].includes(existing.state)) {
      const incomingOperatorId = text(providerPatch.operator_call_control_id);
      if (
        incomingOperatorId
        && (
          TERMINAL_STATES.has(existing.state)
          || existing.state === "ending"
          || !existing.operatorCallControlId
          || incomingOperatorId !== existing.operatorCallControlId
        )
      ) {
        await telnyx.hangupCall({
          callControlId: incomingOperatorId,
          commandId: deriveSalesCommandId({
            correlationId: text(event?.event_id) || salesCallId,
            operation: "hangup_duplicate_operator",
            target: incomingOperatorId
          })
        });
        log("warn", "sales_duplicate_operator_leg_rejected", {
          sales_call_id: salesCallId,
          call_control_id: incomingOperatorId
        });
      }
      return existing;
    }
    if (
      telnyxOperatorConnectionId
      && text(event?.payload?.connection_id) !== text(telnyxOperatorConnectionId)
    ) {
      return rejectOperatorLeg(
        existing,
        providerPatch,
        "operator_leg_wrong_connection",
        "The operator leg did not arrive on the dedicated sales Telnyx connection."
      );
    }
    if (text(event?.payload?.state).toLowerCase() !== "parked") {
      return rejectOperatorLeg(
        existing,
        providerPatch,
        "operator_leg_not_parked",
        "The dedicated sales WebRTC credential must have Park Outbound Calls enabled."
      );
    }
    if (!callIsEligible(existing, now, salesCallingWindowEnv)) {
      return rejectOperatorLeg(
        existing,
        providerPatch,
        "sales:eligibility:changed",
        "The prospect or prepared demo became ineligible before the provider call began."
      );
    }

    const claimed = await repository.claimTransition(salesCallId, {
      allowedStates: ["created", "connecting_browser"],
      patch: {
        ...providerPatch,
        state: "preparing_call",
        ai_state: "dialing_standby",
        metadata_json: {
          sip_correlation_nonce:
            text(existing.metadata.sip_correlation_nonce)
            || crypto.randomBytes(24).toString("base64url")
        },
        provider_error_code: null,
        provider_error_message: null
      }
    });
    if (!claimed.claimed) return loadRequiredCall(salesCallId);
    const call = claimed.call || existing;
    return runCallPreparation(call, providerPatch);
  }

  async function endWholeCall(
    call: SalesCallContext,
    outcome?: string
  ): Promise<SalesCallContext> {
    if (TERMINAL_STATES.has(call.state)) return call;
    clearDemoTimer(call.salesCallId);
    const claim = await repository.claimTransition(call.salesCallId, {
      allowedStates: [call.state],
      patch: {
        state: "ending",
        ai_state: call.aiState === "ended" ? "ended" : "tearing_down"
      }
    });
    if (!claim.claimed) return loadRequiredCall(call.salesCallId);
    const current = claim.call || call;
    try {
      const result = await orchestrator.endCall({
        salesCallId: current.salesCallId,
        correlationId: text(current.metadata.correlation_id) || current.salesCallId,
        conferenceId: current.conferenceId,
        operatorCallControlId: current.operatorCallControlId,
        prospectCallControlId: current.prospectCallControlId,
        aiTelnyxCallControlId: current.aiTelnyxCallControlId,
        openaiCallId: current.openaiCallId,
        outcome
      });
      return repository.patchCall(current.salesCallId, {
        ...result.patch,
        ...teardownErrorPatch(result.teardown),
        ...(outcome ? { outcome } : {})
      });
    } catch (error) {
      await repository.patchCall(current.salesCallId, {
        ...errorPatch(error),
        state: "failed",
        ended_at: nowIso(now)
      });
      throw error;
    }
  }

  async function handleAiTelnyxHangup(call: SalesCallContext): Promise<SalesCallContext> {
    if (["ended", "failed"].includes(call.aiState || "")
      || INTENTIONAL_AI_TEARDOWN_STATES.has(call.state)) return call;
    clearDemoTimer(call.salesCallId);
    try {
      const result = await orchestrator.endDemo({
        salesCallId: call.salesCallId,
        correlationId: text(call.metadata.correlation_id) || call.salesCallId,
        conferenceId: call.conferenceId,
        aiTelnyxCallControlId: call.aiTelnyxCallControlId,
        openaiCallId: call.openaiCallId
      });
      const teardownFailed = teardownHasFailures(result.teardown);
      return repository.patchCall(call.salesCallId, {
        ...teardownErrorPatch(result.teardown),
        ...(teardownFailed
          ? {
              state: "ending_demo",
              ai_state: "tearing_down",
              metadata_json: {
                teardown_return_state: "prospect_connected",
                teardown_failure_mode: "ai_leg_hangup"
              }
            }
          : {
              ...(["ai_live", "ai_paused", "starting_demo", "ending_demo"]
                .includes(call.state)
                ? { state: "prospect_connected" }
                : {}),
              ai_state: "failed"
            }),
        provider_error_code: "telnyx:ai_leg:hangup",
        provider_error_message: "The AI standby leg disconnected."
      });
    } catch (error) {
      return repository.patchCall(call.salesCallId, {
        ai_state: "failed",
        ...errorPatch(error)
      });
    }
  }

  async function processTelnyxEvent(salesCallId: string, event: any) {
    return withCallLock(salesCallId, async () => {
      const type = text(event.type);
      const normalizedRole = text(event.role);
      let call = await loadRequiredCall(salesCallId);
      const wholeCallTeardown =
        TERMINAL_STATES.has(call.state) || call.state === "ending";
      if (
        type === "call.initiated"
        && normalizedRole === "operator"
        && !wholeCallTeardown
      ) {
        return beginCallFromOperator(salesCallId, event);
      }

      const participantCallControlId = text(event?.payload?.call_control_id);
      const boundRole = participantCallControlId === call.aiTelnyxCallControlId
        ? "ai"
        : participantCallControlId === call.prospectCallControlId
          ? "prospect"
          : participantCallControlId === call.operatorCallControlId
            ? "operator"
            : "";
      const normalizedRoleAlreadyBound = normalizedRole === "ai"
        ? Boolean(call.aiTelnyxCallControlId)
        : normalizedRole === "prospect"
          ? Boolean(call.prospectCallControlId)
          : normalizedRole === "operator"
            ? Boolean(call.operatorCallControlId)
            : true;
      const role = type.startsWith("conference.")
        ? boundRole
        : boundRole || (!normalizedRoleAlreadyBound ? normalizedRole : "");
      const normalizedFields = providerFieldsFromEvent(event);
      const fields: SalesCallPatch = {
        ...(normalizedFields.conference_id
          ? { conference_id: normalizedFields.conference_id }
          : {}),
        ...(normalizedFields.conference_name
          ? { conference_name: normalizedFields.conference_name }
          : {}),
        ...(!type.startsWith("conference.") && role
          ? (salesTelnyxCallPatch as any)(role, event.payload)
          : {})
      };
      if (Object.keys(fields).length) {
        call = await repository.patchCall(salesCallId, fields);
      }

      const aiResourceTeardown = (
        role === "ai" || normalizedRole === "ai"
      ) && (
        INTENTIONAL_AI_TEARDOWN_STATES.has(call.state)
        || ["ended", "failed", "tearing_down"].includes(call.aiState || "")
      );
      const cleanupActions: Promise<unknown>[] = [];
      if (
        participantCallControlId
        && type !== "call.hangup"
        && (wholeCallTeardown || aiResourceTeardown)
      ) {
        cleanupActions.push(telnyx.hangupCall({
          callControlId: participantCallControlId,
          commandId: deriveSalesCommandId({
            correlationId: text(event?.event_id) || salesCallId,
            operation: wholeCallTeardown
              ? "hangup_late_terminal_leg"
              : "hangup_late_ai_leg",
            target: participantCallControlId
          })
        }));
      }
      const revealedConferenceId = text(normalizedFields.conference_id);
      if (
        revealedConferenceId
        && type !== "conference.ended"
        && wholeCallTeardown
      ) {
        cleanupActions.push(telnyx.endConference({
          conferenceId: revealedConferenceId,
          commandId: deriveSalesCommandId({
            correlationId: text(event?.event_id) || salesCallId,
            operation: "end_late_terminal_conference",
            target: revealedConferenceId
          })
        }));
      }
      if (cleanupActions.length) {
        const cleanup = await Promise.allSettled(cleanupActions);
        const failed = cleanup.find((entry) => entry.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        log("warn", "sales_late_telnyx_resource_removed", {
          sales_call_id: salesCallId,
          event_type: type,
          call_control_id: participantCallControlId || null,
          conference_id: revealedConferenceId || null
        });
        return call;
      }
      if (wholeCallTeardown) return call;

      if (type === "call.answered" && role === "prospect") {
        return repository.patchCall(salesCallId, {
          state: "prospect_connected",
          connected_at: call.connectedAt || nowIso(now),
          provider_error_code: null,
          provider_error_message: null
        });
      }
      if (type === "call.answered" && role === "ai") {
        if (
          TERMINAL_STATES.has(call.state)
          || INTENTIONAL_AI_TEARDOWN_STATES.has(call.state)
          || ["ended", "failed"].includes(call.aiState || "")
          || (
            call.aiTelnyxCallControlId
            && participantCallControlId !== call.aiTelnyxCallControlId
          )
        ) return call;
        if (["ready", "live", "paused"].includes(call.aiState || "")) return call;
        const monitorReady =
          call.aiState === "realtime_ready_waiting_sip"
          && Boolean(realtimeRegistry.get(salesCallId)?.isOpen);
        return repository.patchCall(salesCallId, {
          ai_state: monitorReady ? "ready" : "sip_connected"
        });
      }
      if (type === "conference.participant.joined" && role === "ai") {
        if (call.aiState === "joining") {
          return repository.patchCall(salesCallId, { ai_state: "joined" });
        }
        return call;
      }
      if (type === "call.hangup" && (role === "operator" || role === "prospect")) {
        const noAnswer = role === "prospect" && !call.connectedAt;
        return endWholeCall(call, noAnswer ? "no_answer" : undefined);
      }
      if (type === "call.hangup" && role === "ai") {
        return handleAiTelnyxHangup(call);
      }
      return call;
    });
  }

  async function processOpenAIIncoming(salesCallId: string, event: any) {
    return withCallLock(salesCallId, async () => {
      let call = await loadRequiredCall(salesCallId);
      const openaiCallId = text(event.openai_call_id);
      const expectedNonce = text(call.metadata.sip_correlation_nonce);
      const incomingNonce = text(event.correlation_nonce);
      const expectedCorrelationId =
        text(call.metadata.correlation_id) || salesCallId;
      if (
        text(event.role) !== "ai"
        || !secureTextEqual(expectedNonce, incomingNonce)
        || text(event.correlation_id) !== expectedCorrelationId
      ) {
        await openai.hangupCall({ callId: openaiCallId });
        log("warn", "sales_openai_correlation_rejected", {
          sales_call_id: salesCallId,
          openai_call_id: openaiCallId,
          reason: "invalid_or_missing_correlation_nonce"
        });
        return call;
      }
      if (TERMINAL_STATES.has(call.state) || call.state === "ending") {
        await openai.hangupCall({ callId: openaiCallId });
        return call;
      }
      if (
        INTENTIONAL_AI_TEARDOWN_STATES.has(call.state)
        || ["ended", "failed", "tearing_down"].includes(call.aiState || "")
      ) {
        await openai.hangupCall({ callId: openaiCallId });
        return call;
      }
      if (call.openaiCallId && call.openaiCallId !== openaiCallId) {
        await openai.hangupCall({ callId: openaiCallId });
        log("warn", "sales_openai_correlation_rejected", {
          sales_call_id: salesCallId,
          openai_call_id: openaiCallId,
          reason: "different_openai_call_already_bound"
        });
        return call;
      }
      if (!callIsEligible(call, now, salesCallingWindowEnv)) {
        await openai.hangupCall({ callId: openaiCallId });
        return repository.patchCall(salesCallId, {
          openai_call_id: openaiCallId,
          ai_state: "failed",
          provider_error_code: "sales:demo:not_ready",
          provider_error_message: "The prepared demo is no longer eligible or ready."
        });
      }
      if (
        call.openaiCallId === openaiCallId
        && ["realtime_ready_waiting_sip", "ready", "live", "paused"]
          .includes(call.aiState || "")
        && realtimeRegistry.get(salesCallId)?.isOpen
      ) {
        return call;
      }
      const sipConnectedBeforeAccept = call.aiState === "sip_connected";
      call = await repository.patchCall(salesCallId, {
        openai_call_id: openaiCallId,
        ai_state: sipConnectedBeforeAccept
          ? "accepting_sip_connected"
          : "accepting"
      });
      try {
        const callbacks = monitorCallbacks(salesCallId);
        const result = await orchestrator.prepareAIStandby({
          salesCallId,
          correlationId: text(call.metadata.correlation_id) || salesCallId,
          openaiCallId,
          aiTelnyxCallControlId: call.aiTelnyxCallControlId,
          realtimeSession: (buildSalesRealtimeAcceptPayload as any)({
            instructions: resolveSalesDemoInstructions(call)
          }),
          ...callbacks
        });
        call = await repository.patchCall(salesCallId, {
          ...result.patch,
          ai_state: sipConnectedBeforeAccept
            ? "ready"
            : "realtime_ready_waiting_sip",
          provider_error_code: null,
          provider_error_message: null
        });
        return call;
      } catch (error) {
        const teardown = (error as any)?.teardown;
        const teardownFailed = teardownHasFailures(teardown);
        await repository.patchCall(salesCallId, {
          ...errorPatch(error),
          openai_call_id: openaiCallId,
          ...(teardownFailed
            ? {
                ...teardownErrorPatch(teardown),
                state: "ending_demo",
                ai_state: "tearing_down",
                metadata_json: {
                  teardown_return_state: "prospect_connected",
                  teardown_failure_mode: "standby_failed"
                }
              }
            : { ai_state: "failed" })
        });
        throw error;
      }
    });
  }

  async function performAction(
    salesCallId: string,
    action: GatewayAction
  ): Promise<GatewayActionResult> {
    return withCallLock(salesCallId, async () => {
      let call = await loadRequiredCall(salesCallId);
      const correlationId = text(call.metadata.correlation_id) || salesCallId;
      if (action === "end_call") {
        if (TERMINAL_STATES.has(call.state)) return { call, replayed: true };
        call = await endWholeCall(call);
        return {
          call,
          replayed: false,
          pending: call.state === "ending"
        };
      }
      if (TERMINAL_STATES.has(call.state) || call.state === "ending") {
        throw new SalesGatewayHttpError(
          409,
          "sales_call_terminal",
          "The sales call has already ended."
        );
      }

      if (action === "start_demo") {
        if (["live", "paused"].includes(call.aiState || "")) {
          return { call, replayed: true };
        }
        const resuming = call.state === "starting_demo" && call.aiState === "joining";
        if (!resuming && (call.state !== "prospect_connected" || call.aiState !== "ready")) {
          throw new SalesGatewayHttpError(
            409,
            "sales_demo_not_ready",
            "The prospect and prepared AI standby must both be connected."
          );
        }
        if (!resuming) {
          const claim = await repository.claimTransition(salesCallId, {
            allowedStates: ["prospect_connected"],
            allowedAiStates: ["ready"],
            patch: { state: "starting_demo", ai_state: "joining" }
          });
          if (!claim.claimed) {
            return {
              call: await loadRequiredCall(salesCallId),
              replayed: true,
              pending: true
            };
          }
          call = claim.call || call;
        }
        try {
          const result = await orchestrator.startDemo({
            salesCallId,
            correlationId,
            conferenceId: call.conferenceId,
            aiTelnyxCallControlId: call.aiTelnyxCallControlId,
            openaiCallId: call.openaiCallId,
            businessName: resolveSalesDemoBusinessName(call),
            beforeGreeting: () => repository.patchCall(salesCallId, {
              metadata_json: {
                greeting_dispatch_started_at: nowIso(now)
              }
            }),
            onGreetingAcknowledged: () => repository.patchCall(salesCallId, {
              metadata_json: {
                greeting_acknowledged_at: nowIso(now)
              }
            })
          });
          call = await repository.patchCall(salesCallId, {
            ...result.patch,
            provider_error_code: null,
            provider_error_message: null
          });
          scheduleDemoTimer(call);
          return { call, replayed: false };
        } catch (error) {
          const teardown = (error as any)?.teardown;
          const teardownFailed = teardownHasFailures(teardown);
          await repository.patchCall(salesCallId, {
            ...errorPatch(error),
            ...(teardownFailed
              ? {
                  ...teardownErrorPatch(teardown),
                  state: "ending_demo",
                  ai_state: "tearing_down",
                  metadata_json: {
                    teardown_return_state: "prospect_connected",
                    teardown_failure_mode: "start_failed"
                  }
                }
              : {
                  state: "prospect_connected",
                  ai_state: "failed"
                })
          });
          throw error;
        }
      }

      if (action === "pause_ai") {
        if (call.aiState === "paused") return { call, replayed: true };
        const resuming = call.aiState === "pausing";
        if (!resuming && call.aiState !== "live") {
          throw new SalesGatewayHttpError(
            409,
            "sales_ai_not_live",
            "The AI demonstration is not currently live."
          );
        }
        if (!resuming) {
          const claim = await repository.claimTransition(salesCallId, {
            allowedAiStates: ["live"],
            patch: { state: "ai_live", ai_state: "pausing" }
          });
          if (!claim.claimed) {
            return {
              call: await loadRequiredCall(salesCallId),
              replayed: true,
              pending: true
            };
          }
        }
        try {
          const result = await orchestrator.pauseAI({ salesCallId });
          call = await repository.patchCall(salesCallId, {
            ...result.patch,
            state: "ai_paused",
            provider_error_code: null,
            provider_error_message: null
          });
          return { call, replayed: false };
        } catch (error) {
          await repository.patchCall(salesCallId, {
            ...errorPatch(error),
            state: "ai_live",
            ai_state: "live"
          });
          throw error;
        }
      }

      if (call.state === "demo_ended" || call.aiState === "ended") {
        return { call, replayed: true };
      }
      const resumingEndDemo =
        call.state === "ending_demo"
        && ["ending", "tearing_down"].includes(call.aiState || "");
      if (!resumingEndDemo && !["live", "paused"].includes(call.aiState || "")) {
        throw new SalesGatewayHttpError(
          409,
          "sales_demo_not_live",
          "The AI demonstration has not joined this call."
        );
      }
      if (!resumingEndDemo) {
        const claim = await repository.claimTransition(salesCallId, {
          allowedAiStates: ["live", "paused"],
          patch: { state: "ending_demo", ai_state: "ending" }
        });
        if (!claim.claimed) {
          return {
            call: await loadRequiredCall(salesCallId),
            replayed: true,
            pending: true
          };
        }
        call = claim.call || call;
      }
      clearDemoTimer(salesCallId);
      try {
        const result = await orchestrator.endDemo({
          salesCallId,
          correlationId,
          conferenceId: call.conferenceId,
          aiTelnyxCallControlId: call.aiTelnyxCallControlId,
          openaiCallId: call.openaiCallId
        });
        call = await repository.patchCall(salesCallId, {
          ...result.patch,
          ...teardownErrorPatch(result.teardown)
        });
        return {
          call,
          replayed: false,
          pending: call.state === "ending_demo"
        };
      } catch (error) {
        await repository.patchCall(salesCallId, {
          ...errorPatch(error),
          state: "prospect_connected",
          ai_state: "failed"
        });
        throw error;
      }
    });
  }

  async function correlateProviderEvent(event: any): Promise<string | null> {
    const payload = asObject(event?.payload || event?.data || {});
    const suppliedSalesCallId = text(event?.sales_call_id);
    if (suppliedSalesCallId) {
      const suppliedCall = await repository.getCallContext(suppliedSalesCallId);
      if (suppliedCall) return suppliedSalesCallId;
    }
    return repository.findCallIdByProviderRefs(payload);
  }

  async function claimProviderEvent(
    provider: "telnyx" | "openai",
    event: any,
    body: string,
    salesCallId: string,
    staleAfterSeconds = 120
  ): Promise<{
    claimed: boolean;
    status: string;
    eventId: string;
    claimToken: string;
  }> {
    const eventId = eventIdOrDigest(provider, event?.event_id, body);
    const claimToken = crypto.randomUUID();
    const claimed = await repository.claimEvent({
      salesCallId,
      provider,
      eventId,
      type: text(event?.type) || "unknown",
      payload: JSON.parse(body) as JsonObject,
      occurredAt: event?.occurred_at || null,
      claimToken,
      staleAfterSeconds
    });
    return {
      claimed: claimed.claimed,
      status: claimed.status,
      eventId,
      claimToken
    };
  }

  async function failClaimedEvent(
    provider: "telnyx" | "openai",
    eventId: string,
    claimToken: string,
    error: unknown
  ) {
    const summarized = summarizeSalesProviderError(error);
    await repository.failEvent(
      provider,
      eventId,
      claimToken,
      summarized.provider_error_code,
      summarized.provider_error_message
    );
  }

  async function teardownUncorrelatedTelnyx(event: any) {
    const callControlId = text(event?.payload?.call_control_id);
    const isDedicatedConnection = !telnyxOperatorConnectionId
      || text(event?.payload?.connection_id) === text(telnyxOperatorConnectionId);
    if (
      text(event?.type) !== "call.initiated"
      || text(event?.payload?.state).toLowerCase() !== "parked"
      || !callControlId
      || !isDedicatedConnection
    ) return;
    await telnyx.hangupCall({
      callControlId,
      commandId: deriveSalesCommandId({
        correlationId: text(event?.event_id) || callControlId,
        operation: "hangup_uncorrelated_operator",
        target: callControlId
      })
    });
  }

  async function teardownUncorrelatedOpenAI(event: any) {
    const openaiCallId = text(event?.openai_call_id);
    if (!openaiCallId) return;
    await openai.hangupCall({
      callId: openaiCallId,
      clientRequestId: deriveSalesCommandId({
        correlationId: text(event?.event_id) || openaiCallId,
        operation: "hangup_uncorrelated_openai",
        target: openaiCallId
      })
    });
  }

  app.post(
    "/webhooks/telnyx",
    express.raw({ type: "*/*", limit: "1mb" }),
    asyncRoute(async (req, res) => {
      const body = rawBody(req);
      if (
        requireTelnyxSignature
        && !verifySalesTelnyxWebhook({
          rawBody: body,
          headers: req.headers,
          publicKey: telnyxPublicKey
        })
      ) {
        return res.status(401).json({ ok: false, error: "invalid_telnyx_signature" });
      }
      let event;
      try {
        event = normalizeSalesTelnyxWebhookEvent(body);
      } catch {
        return res.status(400).json({ ok: false, error: "invalid_telnyx_event" });
      }
      const salesCallId = await correlateProviderEvent(event);
      if (!salesCallId) {
        log("warn", "sales_telnyx_event_uncorrelated", {
          event_id: text(event.event_id),
          type: text(event.type)
        });
        await teardownUncorrelatedTelnyx(event);
        return res.status(202).json({ ok: true, correlated: false });
      }
      const claim = await claimProviderEvent("telnyx", event, body, salesCallId);
      if (!claim.claimed) {
        return res.status(claim.status === "processed" ? 200 : 202).json({
          ok: true,
          duplicate: claim.status === "processed",
          pending: claim.status !== "processed"
        });
      }
      try {
        await processTelnyxEvent(salesCallId, event);
        await repository.completeEvent("telnyx", claim.eventId, claim.claimToken);
      } catch (error) {
        await failClaimedEvent("telnyx", claim.eventId, claim.claimToken, error);
        throw error;
      }
      return res.status(200).json({ ok: true });
    })
  );

  app.post(
    "/webhooks/openai",
    express.raw({ type: "*/*", limit: "1mb" }),
    asyncRoute(async (req, res) => {
      const body = rawBody(req);
      if (
        requireOpenAISignature
        && !verifySalesOpenAIWebhook({
          rawBody: body,
          headers: req.headers,
          secret: openaiWebhookSecret
        })
      ) {
        return res.status(401).json({ ok: false, error: "invalid_openai_signature" });
      }
      let event;
      try {
        event = normalizeSalesOpenAIIncomingCallEvent(body);
      } catch {
        return res.status(400).json({ ok: false, error: "invalid_openai_event" });
      }
      const salesCallId = await correlateProviderEvent(event);
      if (!salesCallId) {
        log("warn", "sales_openai_event_uncorrelated", {
          event_id: text(event.event_id),
          openai_call_id: text(event.openai_call_id)
        });
        await teardownUncorrelatedOpenAI(event);
        return res.status(202).json({ ok: true, correlated: false });
      }
      const claim = await claimProviderEvent("openai", event, body, salesCallId);
      if (!claim.claimed) {
        return res.status(claim.status === "processed" ? 200 : 202).json({
          ok: true,
          duplicate: claim.status === "processed",
          pending: claim.status !== "processed"
        });
      }
      try {
        await processOpenAIIncoming(salesCallId, event);
        await repository.completeEvent("openai", claim.eventId, claim.claimToken);
      } catch (error) {
        await failClaimedEvent("openai", claim.eventId, claim.claimToken, error);
        throw error;
      }
      return res.status(200).json({ ok: true });
    })
  );

  app.use(express.json({ limit: "256kb" }));

  function requireInternalAuth(req: Request, res: Response, next: NextFunction) {
    const valid = isValidInternalServiceToken(
      bearerToken(req),
      internalAuthEnv,
      INTERNAL_AUTH_PURPOSES.salesCallControl
    );
    if (!valid) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
  }

  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  app.get(
    "/internal/health",
    requireInternalAuth,
    asyncRoute(async (_req, res) => {
      return res.status(200).json({
        ok: true,
        service: "everycall-sales-call-gateway",
        runtime: {
          mode: "single_instance",
          limitation:
            "Realtime monitor sockets and per-call locks are process-local; deploy exactly one service instance.",
          telnyx_requirement:
            "The dedicated sales WebRTC credential must have Park Outbound Calls enabled.",
          realtime_sessions: realtimeRegistry.size(),
          active_demo_timers: demoTimers.size,
          ai_demo_max_seconds: selectedDemoMaxSeconds
        }
      });
    })
  );

  app.post(
    "/internal/calls/:salesCallId/actions",
    requireInternalAuth,
    asyncRoute(async (req, res) => {
      const salesCallId = text(req.params.salesCallId);
      const action = text(req.body?.action).toLowerCase() as GatewayAction;
      if (!salesCallId) {
        throw new SalesGatewayHttpError(
          400,
          "sales_call_id_required",
          "Sales call ID is required."
        );
      }
      if (!ACTIONS.has(action)) {
        throw new SalesGatewayHttpError(
          400,
          "invalid_sales_call_action",
          "Sales call action is not supported."
        );
      }
      const result = await performAction(salesCallId, action);
      return res.status(result.pending ? 202 : 200).json({
        ok: true,
        action,
        replayed: result.replayed,
        pending: Boolean(result.pending),
        call: result.call
      });
    })
  );

  app.use((
    error: any,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    const status = error instanceof SalesGatewayHttpError
      ? error.status
      : 502;
    const code = error instanceof SalesGatewayHttpError
      ? error.code
      : text(error?.code) || "sales_gateway_provider_error";
    log("error", "sales_gateway_request_failed", {
      code,
      status,
      message: text(error?.message)
    });
    return res.status(status).json({
      ok: false,
      error: code,
      message: status >= 500
        ? "The sales call provider operation failed."
        : text(error?.message)
    });
  });

  async function runProviderEventRecovery() {
    const pendingEvents = await repository.listRecoverableEvents();
    let recovered = 0;
    let skipped = 0;
    let failed = 0;
    for (const pending of pendingEvents) {
      const provider = text(pending.provider) as "telnyx" | "openai";
      const claimToken = crypto.randomUUID();
      try {
        if (provider !== "telnyx" && provider !== "openai") {
          throw new Error("unsupported_sales_provider_event");
        }
        const claim = await repository.claimEvent({
          salesCallId: pending.salesCallId,
          provider,
          eventId: pending.eventId,
          type: pending.type,
          payload: pending.payload,
          occurredAt: pending.occurredAt
            ? new Date(pending.occurredAt).toISOString()
            : null,
          claimToken,
          staleAfterSeconds: 120
        });
        if (!claim.claimed) {
          skipped += 1;
          continue;
        }
        const event = provider === "telnyx"
          ? normalizeSalesTelnyxWebhookEvent(pending.payload)
          : normalizeSalesOpenAIIncomingCallEvent(pending.payload);
        if (provider === "telnyx") {
          await processTelnyxEvent(pending.salesCallId, event);
        } else {
          await processOpenAIIncoming(pending.salesCallId, event);
        }
        await repository.completeEvent(
          provider,
          pending.eventId,
          claimToken
        );
        recovered += 1;
      } catch (error) {
        failed += 1;
        await failClaimedEvent(
          provider,
          pending.eventId,
          claimToken,
          error
        ).catch(() => {});
        log("error", "sales_provider_event_recovery_failed", {
          provider,
          event_id: pending.eventId,
          sales_call_id: pending.salesCallId,
          message: text((error as Error)?.message)
        });
      }
    }
    return {
      scanned: pendingEvents.length,
      recovered,
      skipped,
      failed
    };
  }

  let providerEventRecoveryInFlight: ReturnType<
    typeof runProviderEventRecovery
  > | null = null;
  function recoverProviderEvents() {
    if (providerEventRecoveryInFlight) return providerEventRecoveryInFlight;
    const recovery = runProviderEventRecovery();
    providerEventRecoveryInFlight = recovery;
    const clearRecovery = () => {
      if (providerEventRecoveryInFlight === recovery) {
        providerEventRecoveryInFlight = null;
      }
    };
    void recovery.then(clearRecovery, clearRecovery);
    return recovery;
  }

  async function recoverOneCall(call: SalesCallContext): Promise<boolean> {
    if (
      call.state === "preparing_call"
      || (
        call.aiState === "dialing_standby"
        && (
          !call.conferenceId
          || !call.prospectCallControlId
          || !call.aiTelnyxCallControlId
        )
      )
    ) {
      await runCallPreparation(call);
      return true;
    }
    if (call.state === "ending") {
      const result = await orchestrator.endCall({
        salesCallId: call.salesCallId,
        correlationId: text(call.metadata.correlation_id) || call.salesCallId,
        conferenceId: call.conferenceId,
        operatorCallControlId: call.operatorCallControlId,
        prospectCallControlId: call.prospectCallControlId,
        aiTelnyxCallControlId: call.aiTelnyxCallControlId,
        openaiCallId: call.openaiCallId,
        outcome: call.outcome
      });
      await repository.patchCall(call.salesCallId, {
        ...result.patch,
        ...teardownErrorPatch(result.teardown)
      });
      return true;
    }
    if (call.state === "ending_demo") {
      const result = await orchestrator.endDemo({
        salesCallId: call.salesCallId,
        correlationId: text(call.metadata.correlation_id) || call.salesCallId,
        conferenceId: call.conferenceId,
        aiTelnyxCallControlId: call.aiTelnyxCallControlId,
        openaiCallId: call.openaiCallId
      });
      const returnState = text(call.metadata.teardown_return_state);
      await repository.patchCall(call.salesCallId, {
        ...result.patch,
        ...(returnState && result.teardown_complete
          ? {
              state: returnState,
              ai_state: "failed"
            }
          : {}),
        ...(returnState && result.teardown_complete
          ? {}
          : teardownErrorPatch(result.teardown))
      });
      return true;
    }
    if (
      call.state === "starting_demo"
      && text(call.metadata.greeting_dispatch_started_at)
    ) {
      const result = await orchestrator.endDemo({
        salesCallId: call.salesCallId,
        correlationId: text(call.metadata.correlation_id) || call.salesCallId,
        conferenceId: call.conferenceId,
        aiTelnyxCallControlId: call.aiTelnyxCallControlId,
        openaiCallId: call.openaiCallId
      });
      await repository.patchCall(call.salesCallId, {
        ...teardownErrorPatch(result.teardown),
        ...(result.teardown_complete
          ? {
              state: "prospect_connected",
              ai_state: "failed"
            }
          : {
              state: "ending_demo",
              ai_state: "tearing_down"
            }),
        provider_error_code: "sales:greeting:recovery_uncertain",
        provider_error_message:
          "The gateway restarted while dispatching the greeting; the AI was removed to prevent a duplicate greeting."
      });
      return true;
    }
    if (!call.openaiCallId) return false;
    const existingController = realtimeRegistry.get(call.salesCallId);
    if (!existingController?.isOpen) {
      const controller = await openai.connectMonitor({
        callId: call.openaiCallId,
        correlationId: text(call.metadata.correlation_id) || call.salesCallId,
        ...monitorCallbacks(call.salesCallId)
      });
      realtimeRegistry.set(call.salesCallId, controller);
    }
    if (["sip_connected", "accepting_sip_connected"].includes(call.aiState || "")) {
      await repository.patchCall(call.salesCallId, {
        ai_state: "ready",
        provider_error_code: null,
        provider_error_message: null
      });
    } else if (call.aiState === "accepting") {
      await repository.patchCall(call.salesCallId, {
        ai_state: "realtime_ready_waiting_sip",
        provider_error_code: null,
        provider_error_message: null
      });
    }
    if (call.state === "starting_demo" && call.aiState === "joining") {
      const result = await orchestrator.startDemo({
        salesCallId: call.salesCallId,
        correlationId: text(call.metadata.correlation_id) || call.salesCallId,
        conferenceId: call.conferenceId,
        aiTelnyxCallControlId: call.aiTelnyxCallControlId,
        openaiCallId: call.openaiCallId,
        businessName: resolveSalesDemoBusinessName(call),
        beforeGreeting: () => repository.patchCall(call.salesCallId, {
          metadata_json: {
            greeting_dispatch_started_at: nowIso(now)
          }
        }),
        onGreetingAcknowledged: () => repository.patchCall(call.salesCallId, {
          metadata_json: {
            greeting_acknowledged_at: nowIso(now)
          }
        })
      });
      await repository.patchCall(call.salesCallId, {
        ...result.patch,
        provider_error_code: null,
        provider_error_message: null
      });
    } else if (call.aiState === "pausing") {
      const result = await orchestrator.pauseAI({
        salesCallId: call.salesCallId
      });
      await repository.patchCall(call.salesCallId, {
        ...result.patch,
        state: "ai_paused",
        provider_error_code: null,
        provider_error_message: null
      });
    }
    const latest = await loadRequiredCall(call.salesCallId);
    scheduleDemoTimer(latest);
    return true;
  }

  async function runCallRecovery() {
    const calls = await repository.listRecoverableCalls();
    let recovered = 0;
    let failed = 0;
    for (const listedCall of calls) {
      const result = await withCallLock(listedCall.salesCallId, async () => {
        const call = await repository.getCallContext(listedCall.salesCallId);
        if (!call || TERMINAL_STATES.has(call.state)) return "skipped";
        try {
          return await recoverOneCall(call) ? "recovered" : "skipped";
        } catch (error) {
          if (["ending", "ending_demo"].includes(call.state)) {
            await repository.patchCall(call.salesCallId, {
              state: call.state,
              ai_state: "tearing_down",
              ...errorPatch(error)
            });
          } else if (call.state !== "preparing_call") {
            let teardown: unknown = [];
            try {
              const ended = await orchestrator.endDemo({
                salesCallId: call.salesCallId,
                correlationId:
                  text(call.metadata.correlation_id) || call.salesCallId,
                conferenceId: call.conferenceId,
                aiTelnyxCallControlId: call.aiTelnyxCallControlId,
                openaiCallId: call.openaiCallId
              });
              teardown = ended.teardown;
            } catch {
              // The recovery error remains primary.
            }
            const teardownFailed = teardownHasFailures(teardown);
            await repository.patchCall(call.salesCallId, {
              ...teardownErrorPatch(teardown),
              ...(teardownFailed
                ? {
                    state: "ending_demo",
                    ai_state: "tearing_down",
                    metadata_json: {
                      teardown_return_state: "prospect_connected",
                      teardown_failure_mode: "recovery_failed"
                    }
                  }
                : {
                    ...(["starting_demo", "ai_live", "ai_paused"]
                      .includes(call.state)
                      ? { state: "prospect_connected" }
                      : {}),
                    ai_state: "failed"
                  }),
              ...errorPatch(error)
            });
          }
          log("error", "sales_call_recovery_failed", {
            sales_call_id: call.salesCallId,
            state: call.state,
            message: text((error as Error)?.message)
          });
          return "failed";
        }
      });
      if (result === "recovered") recovered += 1;
      if (result === "failed") failed += 1;
    }
    return { scanned: calls.length, recovered, failed };
  }

  let callRecoveryInFlight: ReturnType<typeof runCallRecovery> | null = null;
  function recoverRealtimeSessions() {
    if (callRecoveryInFlight) return callRecoveryInFlight;
    const recovery = runCallRecovery();
    callRecoveryInFlight = recovery;
    const clearRecovery = () => {
      if (callRecoveryInFlight === recovery) callRecoveryInFlight = null;
    };
    void recovery.then(clearRecovery, clearRecovery);
    return recovery;
  }

  return {
    app,
    orchestrator,
    realtimeRegistry,
    performAction,
    processTelnyxEvent,
    processOpenAIIncoming,
    recoverProviderEvents,
    recoverRealtimeSessions
  };
}
