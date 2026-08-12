import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { readCallGatewayEnv } from "@everycall/config";
import type { CallState } from "@everycall/contracts";
import { estimateBillableMinutes, estimateTelephonyCostMicrosUsd, usdToMicros } from "@everycall/contracts/callCosting";
import {
  buildTranscriptFromEvents,
  selectPreferredTranscriptSnapshot
} from "@everycall/contracts/callTranscript";
import {
  INTERNAL_AUTH_PURPOSES,
  getInternalServiceToken,
  isValidInternalServiceToken,
  resolveInternalServiceSecret
} from "@everycall/contracts/internalAuth";
import { claimInboundWebhookEvent } from "@everycall/contracts/providerWebhookIdempotency";
import { logError as baseLogError, logInfo as baseLogInfo, type LogContext } from "@everycall/observability";
import { normalizePhone, validateTelnyxSignature } from "@everycall/telephony";
import pg from "pg";
import fs from "node:fs";
import * as AjvModule from "ajv";
import {
  applyCapturedFieldsToCallState,
  buildGatewaySessionInstructions,
  clearKnowledgeBuildAssetCache,
  fetchKnowledgeRuntimeTurn,
  formatKnowledgeRuntimeToolOutput,
  type GatewayPromptPayload,
  initializeKnowledgeCallState,
  mergeRuntimeTurnState,
  prewarmKnowledgeBuildAssets,
  persistKnowledgeCallState,
  validateGatewayPromptPayload
} from "./knowledgeRuntime.js";
import {
  prewarmActiveKnowledgeBuildAssets,
  recoverStreamSessionBootstrap
} from "./runtimeLifecycle.js";
import {
  applyAssistantInterruption,
  buildAssistantInterruptionPlan,
  hasPendingAssistantAudio,
  noteAssistantAudioChunkQueued,
  noteAssistantAudioFrameSent,
  noteAssistantOutputItem,
  noteAssistantPlaybackDrained,
  noteAssistantResponseCompleted,
  noteAssistantResponseCreated
} from "./voiceRuntimeControl.js";
import {
  beginToolExecution,
  completeToolExecution,
  dequeueAssistantResponseRequest,
  discardQueuedAssistantResponses,
  enqueueAssistantResponseRequest,
  failToolExecution,
  hasActiveAssistantResponse,
  markAssistantResponseCreated,
  markAssistantResponseFinished,
  normalizeToolExecutionKey,
  type AssistantResponseRequest
} from "./toolResponseControl.js";
import {
  buildRealtimeForceMessageEvent,
  buildXAiRealtimeHeaders,
  buildRealtimeResponseCreateEvent,
  buildRealtimeSessionUpdateEvent
} from "./realtimePayloads.js";
import { beginInboundCallStartup } from "./inboundCallStartup.js";
import {
  classifyTransferConfirmation,
  normalizeTransferLookupText,
  rankTransferMatches
} from "./transferDirectory.js";
import {
  finishRealtimeTurnTiming,
  noteRealtimeTurnResponseCreated,
  startRealtimeTurnTiming,
  type RealtimeTurnTiming
} from "./realtimeTurnTiming.js";
import {
  buildTelnyxClearEvent,
  shouldForwardTelnyxInputTrack,
  TELNYX_INPUT_STREAM_TRACK
} from "./telephonyStreamControl.js";
import {
  beginAudioQueueGap,
  calculatePendingPlaybackMs,
  closeAudioQueueGap,
  ensureAudioPumpTraceForResponse,
  finishAudioQueueGapWithoutReprime,
  noteAudioChunkQueued,
  noteAudioPumpReprimed,
  shouldClearAudioPumpTraceAfterSummary,
  shouldLogAudioGap,
  type AudioPumpTrace
} from "./audioPumpTelemetry.js";
import { evaluateFinishSessionPolicy } from "./finishSessionPolicy.js";
import { buildKnowledgeLookupTimingDetails } from "./knowledgeLookupTelemetry.js";
import {
  claimDataCaptureContinuation,
  createDataCaptureControlState,
  fingerprintDataCaptureArgs,
  getCompletedDataCapture,
  recordCompletedDataCapture,
  type DataCaptureControlState,
  type DataCaptureValidation
} from "./dataCaptureControl.js";
import {
  createToolResponseTimingState,
  finishToolResponse,
  matchAssistantResponseCreated,
  matchToolResponseFirstAudio,
  trackAssistantResponseDispatch,
  type ToolResponseMetadata,
  type ToolResponseTimingState
} from "./toolResponseTiming.js";

const env = readCallGatewayEnv(process.env);
const app = express();
app.set("trust proxy", true);

const databaseUrl = process.env.DATABASE_URL || "";
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const appBaseUrl = process.env.APP_BASE_URL || "";
const internalServiceSecret = resolveInternalServiceSecret(process.env);
const gatewayPromptToken = getInternalServiceToken(process.env, INTERNAL_AUTH_PURPOSES.gatewayPrompt);
const gatewayToolResultToken = getInternalServiceToken(process.env, INTERNAL_AUTH_PURPOSES.gatewayToolResult);
const gatewayErrorToken = getInternalServiceToken(process.env, INTERNAL_AUTH_PURPOSES.gatewayError);
const callSummaryFinalizeToken = getInternalServiceToken(process.env, INTERNAL_AUTH_PURPOSES.callSummaryFinalize);
const gatewayDebugLogToken = getInternalServiceToken(process.env, INTERNAL_AUTH_PURPOSES.gatewayDebugLog);
const callGatewayBaseUrl = process.env.CALL_GATEWAY_BASE_URL || "";
const XAiKey = process.env.XAI_API_KEY || "";
const XAI_REALTIME_MODEL = "grok-voice-think-fast-2.0";
const XAI_REALTIME_VOICE = "ara";
const signatureRequired = (process.env.TELNYX_SIGNATURE_REQUIRED || "true").toLowerCase() !== "false";
const telnyxApiKey = process.env.TELNYX_API_KEY || "";
const rtpPayloadType = Number(process.env.TELNYX_RTP_PAYLOAD_TYPE || "0");
const bidirectionalPayloadMode = (process.env.TELNYX_BIDIRECTIONAL_PAYLOAD_MODE || "raw").toLowerCase();
const outboundAudioFrameMs = 20;
// The former 60 ms cushion repeatedly drained during measured xAI chunk gaps.
// Four hundred ms absorbs the observed 382 ms starvation and reduces a 461 ms
// starvation to roughly one audio-frame boundary, while remaining overrideable.
const configuredOutboundJitterBufferFrames = Number(process.env.TELNYX_OUTBOUND_BUFFER_FRAMES || "20");
const outboundJitterBufferFrames = Number.isFinite(configuredOutboundJitterBufferFrames)
  ? Math.max(1, Math.floor(configuredOutboundJitterBufferFrames))
  : 20;
const realtimeDebug = String(process.env.REALTIME_DEBUG || "false").toLowerCase() === "true";
const realtimeTrace = String(process.env.REALTIME_TRACE || "false").toLowerCase() === "true";
const verboseGatewayLogging = String(process.env.GATEWAY_VERBOSE_LOGGING || "false").toLowerCase() === "true";
const realtimeLogRoot = String(process.env.REALTIME_LOG_FILE || "/tmp/realtime-logs.jsonl");
const Ajv = (AjvModule as unknown as { default?: new (opts?: Record<string, unknown>) => any }).default || (AjvModule as unknown as new (opts?: Record<string, unknown>) => any);
const ajv = new Ajv({ allErrors: true, strict: false });

const streamIdToCall = new Map<string, string>();
const PRODUCTION_INFO_LOG_ALLOWLIST = new Set([
  "call_gateway_started",
  "gateway_call_session_end",
  "knowledge_build_assets_startup_preload_started",
  "knowledge_build_assets_startup_preload_completed",
  "xai_realtime_session_start",
  "xai_realtime_session_updated",
  "xai_realtime_response_done",
  "xai_realtime_turn_latency",
  "xai_realtime_tool_response_requested",
  "xai_realtime_tool_response_created",
  "xai_realtime_tool_response_first_audio",
  "knowledge_lookup_timing",
  "assistant_audio_pump_trace",
  "assistant_audio_gap",
  "assistant_barge_in_decision",
  "assistant_barge_in_applied",
  "assistant_finish_session_rejected",
  "data_capture_duplicate_suppressed",
  "data_capture_response_suppressed",
  "xai_realtime_queued_responses_discarded",
  "xai_realtime_post_finish_response_suppressed",
  "caller_transcript_turn_coalesced",
  "telnyx_call_control_answer_requested",
  "telnyx_call_control_answer_accepted",
  "telnyx_bidirectional_payload_mode_normalized"
]);

function logInfo(event: string, details: LogContext = {}) {
  if (process.env.NODE_ENV === "production" && !verboseGatewayLogging && !PRODUCTION_INFO_LOG_ALLOWLIST.has(event)) {
    return;
  }
  baseLogInfo(event, details);
}

function logError(event: string, details: LogContext = {}) {
  baseLogError(event, details);
}

type PendingToolCall = {
  name: string;
  callId: string;
  argumentsText: string;
};

type ToolCallTimingContext = {
  sourceType: string;
  speechStoppedAtMs: number | null;
  toolCallReadyAtMs: number;
  callerTurnSequence: number;
};

type FinishSessionArgs = {
  reason?: string;
};

type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cachedInputTextTokens: number;
  cachedInputAudioTokens: number;
  inputTextTokens: number;
  inputAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  estimatedCostMicrosUsd: number;
  responseCount: number;
};

type TransferLookupMatch = {
  target_id: string;
  name: string;
  extension: string | null;
};

type TransferTargetRow = {
  id: number;
  name: string;
  transfer_extension: string | null;
  forward_to_number: string;
};

type TransferState = {
  status: "pending" | "connected";
  targetId: string;
  targetName: string;
  targetExtension: string | null;
  commandId: string;
  requestedAt: string;
  targetCallControlId?: string | null;
  targetCallSessionId?: string | null;
};

type PendingReconnectAssistantResponse = {
  reason: string;
  response: Record<string, unknown>;
  dedupeKey: string;
};

type PendingTransferCandidate = {
  targetId: string;
  targetName: string;
  targetExtension: string | null;
  confirmed: boolean;
  createdAt: string;
  confirmedAt?: string | null;
};

type TransferLegClientState = {
  everycall: "transfer_leg_v1";
  source_call_control_id: string;
  source_call_sid: string;
  tenant_key: string;
  target_id: string;
};

type CallerTranscriptTurnState = {
  rowId: string | null;
  text: string;
  snapshotsReceived: number;
  databaseWrites: number;
  summaryLogged: boolean;
};

type StreamSession = {
  callControlId: string;
  callSid: string;
  tenantKey: string;
  callActive?: boolean;
  isShuttingDown?: boolean;
  telnyxStreamId?: string;
  telnyxWs?: WebSocket;
  XAiWs?: WebSocket;
  XAiReady?: boolean;
  XAiSessionUpdated?: boolean;
  reconnectAttempted?: boolean;
  promptPayload?: GatewayPromptPayload;
  knowledgeCallState?: CallState | null;
  greetingSent?: boolean;
  outputQueue?: Buffer[];
  outputBuffer?: Buffer;
  outputTimer?: NodeJS.Timeout | null;
  outputNextFrameAtMs?: number | null;
  hangupTimer?: NodeJS.Timeout | null;
  outputPrimed?: boolean;
  currentResponseId?: string | null;
  currentAssistantItemId?: string | null;
  assistantAudioActive?: boolean;
  assistantAudioMsSent?: number;
  lastInterruptionAtMs?: number | null;
  lastInterruptionReason?: string | null;
  rtpSeq?: number;
  rtpTimestamp?: number;
  rtpSsrc?: number;
  realtimeModel?: string;
  aiInputRateMicrosUsd?: number;
  aiOutputRateMicrosUsd?: number;
  callAnsweredAt?: string | null;
  usageTotals?: UsageTotals;
  pendingToolCall?: PendingToolCall | null;
  realtimeLogPath?: string;
  responseCreatePending?: boolean;
  activeAssistantResponseDedupeKey?: string | null;
  queuedAssistantResponses?: AssistantResponseRequest[];
  executingToolCallKeys?: Set<string>;
  completedToolCallKeys?: Set<string>;
  toolExecutionTail?: Promise<void>;
  toolResponseTiming?: ToolResponseTimingState;
  dataCaptureControl?: DataCaptureControlState;
  callerTurnSequence?: number;
  finishSessionAccepted?: boolean;
  audioPumpTrace?: AudioPumpTrace | null;
  suppressXAiReconnect?: boolean;
  aiDetached?: boolean;
  transferState?: TransferState | null;
  pendingReconnectAssistantResponse?: PendingReconnectAssistantResponse | null;
  pendingTransferCandidate?: PendingTransferCandidate | null;
  telnyxStreamBaseUrl?: string;
  ignoreNextStreamingStopped?: boolean;
  callerTurnTiming?: RealtimeTurnTiming | null;
  lastAssistantTranscript?: string | null;
  callerTranscriptTurn?: CallerTranscriptTurnState | null;
  callerTranscriptPersistenceTail?: Promise<void>;
};

const streamSessions = new Map<string, StreamSession>();
const inboundSessionBootstraps = new Map<string, Promise<StreamSession | undefined>>();

function createStreamSession(
  callControlId: string,
  callSid: string,
  tenantKey: string,
  promptPayload: GatewayPromptPayload,
  knowledgeCallState: CallState,
  realtimeLogPath?: string
): StreamSession {
  return {
    callControlId,
    callSid,
    tenantKey,
    callActive: true,
    isShuttingDown: false,
    reconnectAttempted: false,
    XAiSessionUpdated: false,
    greetingSent: false,
    aiInputRateMicrosUsd: 0,
    aiOutputRateMicrosUsd: usdToMicros(xAiAudioRatePerMinuteUsd),
    callAnsweredAt: null,
    usageTotals: emptyUsageTotals(),
    promptPayload,
    knowledgeCallState,
    outputQueue: [],
    outputBuffer: Buffer.alloc(0),
    outputNextFrameAtMs: null,
    outputPrimed: false,
    currentResponseId: null,
    lastAssistantTranscript: null,
    callerTranscriptTurn: null,
    callerTranscriptPersistenceTail: Promise.resolve(),
    currentAssistantItemId: null,
    assistantAudioActive: false,
    assistantAudioMsSent: 0,
    lastInterruptionAtMs: null,
    lastInterruptionReason: null,
    responseCreatePending: false,
    activeAssistantResponseDedupeKey: null,
    queuedAssistantResponses: [],
    executingToolCallKeys: new Set<string>(),
    completedToolCallKeys: new Set<string>(),
    toolExecutionTail: Promise.resolve(),
    toolResponseTiming: createToolResponseTimingState(),
    dataCaptureControl: createDataCaptureControlState(),
    callerTurnSequence: 0,
    finishSessionAccepted: false,
    audioPumpTrace: null,
    suppressXAiReconnect: false,
    aiDetached: false,
    transferState: null,
    pendingReconnectAssistantResponse: null,
    pendingTransferCandidate: null,
    ignoreNextStreamingStopped: false,
    ...(realtimeLogPath ? { realtimeLogPath } : {})
  };
}

function createCallerTranscriptTurnState(): CallerTranscriptTurnState {
  return {
    rowId: null,
    text: "",
    snapshotsReceived: 0,
    databaseWrites: 0,
    summaryLogged: false
  };
}

function logCallerTranscriptTurnSummary(session: StreamSession, source: string) {
  const turn = session.callerTranscriptTurn;
  if (!turn || turn.summaryLogged || turn.snapshotsReceived < 2) return;
  turn.summaryLogged = true;
  logInfo("caller_transcript_turn_coalesced", {
    callSid: session.callSid,
    source,
    snapshotsReceived: turn.snapshotsReceived,
    snapshotsCollapsed: Math.max(0, turn.snapshotsReceived - 1),
    databaseWrites: turn.databaseWrites,
    finalTextCharacters: turn.text.length
  });
}

async function persistCallerTranscriptSnapshot(session: StreamSession, transcript: string) {
  if (!pool) return;
  const turn = session.callerTranscriptTurn || createCallerTranscriptTurnState();
  session.callerTranscriptTurn = turn;
  turn.snapshotsReceived += 1;

  const preferredText = selectPreferredTranscriptSnapshot(turn.text, transcript);
  if (!preferredText || preferredText === turn.text) return;
  turn.text = preferredText;
  const textToPersist = preferredText;

  const persistence = (session.callerTranscriptPersistenceTail || Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      if (turn.rowId) {
        await pool.query(
          `UPDATE call_events
           SET text = $1
           WHERE id = $2 AND call_sid = $3 AND role = 'caller'`,
          [textToPersist, turn.rowId, session.callSid]
        );
      } else {
        const inserted = await pool.query(
          `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
           VALUES ($1, $2, $3, $4, 'message')
           RETURNING id`,
          [session.callSid, session.tenantKey, "caller", textToPersist]
        );
        turn.rowId = inserted.rows?.[0]?.id ? String(inserted.rows[0].id) : null;
      }
      turn.databaseWrites += 1;
    });
  session.callerTranscriptPersistenceTail = persistence;
  try {
    await persistence;
  } catch (err) {
    logError("caller_transcript_persist_failed", {
      callSid: session.callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function logPrewarmOutcome(callSid: string, tenantKey: string, source: string, result: { status: "ready" | "failed"; fetchMs: number; cacheHit: boolean; message?: string; buildId?: string }) {
  if (result.status === "ready") {
    logInfo("knowledge_build_assets_prewarmed", {
      callSid,
      tenantKey,
      source,
      buildId: result.buildId || undefined,
      cacheHit: result.cacheHit,
      fetchMs: result.fetchMs
    });
    return;
  }
  logError("knowledge_build_assets_prewarm_failed", {
    callSid,
    tenantKey,
    source,
    buildId: result.buildId || undefined,
    message: result.message || "unknown"
  });
}

function parsePositiveRate(value: string | undefined, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const xAiAudioRatePerMinuteUsd = parsePositiveRate(process.env.XAI_REALTIME_AUDIO_RATE_PER_MINUTE_USD, 0.05);
const telnyxEstimatedInboundRatePerMinuteUsd = parsePositiveRate(process.env.TELNYX_ESTIMATED_INBOUND_RATE_PER_MINUTE_USD, 0.0055);
const telnyxEstimatedInboundRateMicrosUsd = usdToMicros(telnyxEstimatedInboundRatePerMinuteUsd);

function emptyUsageTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cachedInputTextTokens: 0,
    cachedInputAudioTokens: 0,
    inputTextTokens: 0,
    inputAudioTokens: 0,
    outputTextTokens: 0,
    outputAudioTokens: 0,
    estimatedCostMicrosUsd: 0,
    responseCount: 0
  };
}

function toInt(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function collectUsage(payloadMsg: any) {
  const usage = payloadMsg?.response?.usage || payloadMsg?.usage || {};
  const inputTokens = toInt(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = toInt(usage?.output_tokens ?? usage?.completion_tokens);
  const cachedInputTokens = toInt(usage?.input_token_details?.cached_tokens);
  const cachedInputTextTokens = toInt(usage?.input_token_details?.cached_tokens_details?.text_tokens);
  const cachedInputAudioTokens = toInt(usage?.input_token_details?.cached_tokens_details?.audio_tokens);
  const inputTextTokens = toInt(usage?.input_token_details?.text_tokens);
  const inputAudioTokens = toInt(usage?.input_token_details?.audio_tokens);
  const outputTextTokens = toInt(usage?.output_token_details?.text_tokens);
  const outputAudioTokens = toInt(usage?.output_token_details?.audio_tokens);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cachedInputTextTokens,
    cachedInputAudioTokens,
    inputTextTokens,
    inputAudioTokens,
    outputTextTokens,
    outputAudioTokens
  };
}

function estimateUsageCostMicrosUsd(_usage: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number | null;
  cachedInputTextTokens?: number | null;
  cachedInputAudioTokens?: number | null;
  inputTextTokens?: number | null;
  inputAudioTokens?: number | null;
  outputTextTokens?: number | null;
  outputAudioTokens?: number | null;
}) {
  return 0;
}

async function persistCallUsage(session: StreamSession) {
  if (!pool) return;
  const usage = session.usageTotals || emptyUsageTotals();
  const startedAtMs = session.callAnsweredAt ? Date.parse(session.callAnsweredAt) : Date.now();
  usage.estimatedCostMicrosUsd = usdToMicros(
    (Math.max(0, Date.now() - startedAtMs) / 60000) * xAiAudioRatePerMinuteUsd
  );
  try {
    await pool.query(
      `UPDATE calls
       SET ai_model = $2,
           ai_input_tokens = $3,
           ai_output_tokens = $4,
           ai_cached_input_tokens = $5,
           ai_cached_input_text_tokens = $6,
           ai_cached_input_audio_tokens = $7,
           ai_input_text_tokens = $8,
           ai_input_audio_tokens = $9,
           ai_output_text_tokens = $10,
           ai_output_audio_tokens = $11,
           ai_input_rate_micros_usd = $12,
           ai_output_rate_micros_usd = $13,
           ai_estimated_cost_micros_usd = $14,
           ai_response_count = $15,
           total_estimated_cost_micros_usd = COALESCE(telephony_estimated_cost_micros_usd, 0)
             + COALESCE(notification_estimated_cost_micros_usd, 0)
             + $14
       WHERE call_sid = $1`,
      [
        session.callSid,
        session.realtimeModel || null,
        usage.inputTokens,
        usage.outputTokens,
        usage.cachedInputTokens,
        usage.cachedInputTextTokens,
        usage.cachedInputAudioTokens,
        usage.inputTextTokens,
        usage.inputAudioTokens,
        usage.outputTextTokens,
        usage.outputAudioTokens,
        0,
        usdToMicros(xAiAudioRatePerMinuteUsd),
        usage.estimatedCostMicrosUsd,
        usage.responseCount
      ]
    );
  } catch (err) {
    logError("call_usage_persist_failed", {
      callSid: session.callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function resolveBidirectionalPayloadMode() {
  return bidirectionalPayloadMode === "rtp" ? "rtp" : "rtp";
}

function buildTelnyxMediaStreamToken(callControlId: string) {
  const normalizedCallControlId = String(callControlId || "").trim();
  if (!normalizedCallControlId || !internalServiceSecret) return "";
  return getInternalServiceToken(
    { INTERNAL_SERVICE_SECRET: internalServiceSecret },
    INTERNAL_AUTH_PURPOSES.telnyxMediaStream,
    normalizedCallControlId
  );
}

function buildTelnyxMediaStreamUrl(baseUrl: string, callControlId: string) {
  const streamToken = buildTelnyxMediaStreamToken(callControlId);
  if (!streamToken) {
    throw new Error("missing_internal_service_secret");
  }
  const url = new URL(baseUrl);
  url.searchParams.set("stream_token", streamToken);
  return url.toString();
}

function getConfiguredBidirectionalPayloadMode() {
  return bidirectionalPayloadMode;
}

function logBidirectionalPayloadModeNormalization() {
  const configuredMode = getConfiguredBidirectionalPayloadMode();
  const resolvedMode = resolveBidirectionalPayloadMode();
  if (configuredMode !== resolvedMode) {
    logInfo("telnyx_bidirectional_payload_mode_normalized", {
      configuredMode,
      resolvedMode
    });
  }
}

function getTelnyxStreamingStartPayload(baseUrl: string, callControlId: string) {
  return {
    stream_url: buildTelnyxMediaStreamUrl(baseUrl, callControlId),
    stream_track: TELNYX_INPUT_STREAM_TRACK,
    stream_bidirectional_mode: resolveBidirectionalPayloadMode(),
    stream_bidirectional_codec: "PCMU",
    stream_bidirectional_sampling_rate: 8000,
    stream_codec: "PCMU"
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCallId(callId: string) {
  return callId.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function getRealtimeLogPath(callId: string) {
  const safeCallId = normalizeCallId(callId);
  if (realtimeLogRoot.endsWith(".jsonl")) {
    const dir = path.dirname(realtimeLogRoot);
    return path.join(dir, `${safeCallId}.jsonl`);
  }
  return path.join(realtimeLogRoot, `${safeCallId}.jsonl`);
}

function ensureRealtimeLogDir(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function initRealtimeLog(callSid: string) {
  const logPath = getRealtimeLogPath(callSid);
  try {
    ensureRealtimeLogDir(logPath);
    fs.writeFileSync(logPath, "");
  } catch (err) {
    logError("realtime_log_init_failed", {
      callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
  return logPath;
}

function ensureSessionRealtimeLogPath(session: StreamSession) {
  if (session.realtimeLogPath) return session.realtimeLogPath;
  const logPath = initRealtimeLog(session.callSid);
  session.realtimeLogPath = logPath;
  return logPath;
}

function logRealtimeEntry(session: StreamSession | undefined, entry: Record<string, unknown>) {
  if (!realtimeDebug && !realtimeTrace) return;
  const logPath = session?.realtimeLogPath;
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    logError("realtime_log_write_failed", {
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function logRealtimeDetailEntry(session: StreamSession | undefined, entry: Record<string, unknown>) {
  if (!session) return;
  const logPath = ensureSessionRealtimeLogPath(session);
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    logError("realtime_log_write_failed", {
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function logRealtimeRaw(session: StreamSession, payload: Record<string, unknown>) {
  if (!realtimeDebug) return;
  logRealtimeEntry(session, {
    ts: new Date().toISOString(),
    kind: "raw",
    callSid: session.callSid,
    payload
  });
}

function logRealtimeTrace(session: StreamSession, payload: Record<string, unknown>) {
  if (!realtimeTrace) return;
  logRealtimeEntry(session, {
    ts: new Date().toISOString(),
    kind: "trace",
    callSid: session.callSid,
    payload
  });
}

function buildSessionInstructions(payload: GatewayPromptPayload) {
  return buildGatewaySessionInstructions(payload);
}

function validatePromptPayload(input: unknown): GatewayPromptPayload {
  return validateGatewayPromptPayload(input);
}

async function notifyGatewayError(
  callId: string,
  tenantKey: string,
  code: string,
  message: string,
  details: Record<string, unknown> = {}
) {
  if (!appBaseUrl || !gatewayErrorToken) return;
  try {
    const resp = await fetch(`${appBaseUrl}/api/v1/gateway/error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-everycall-internal": gatewayErrorToken
      },
      body: JSON.stringify({
        call_id: callId,
        tenant_key: tenantKey,
        code,
        message,
        details
      })
    });
    if (!resp.ok) {
      logError("gateway_error_callback_failed", { callId, code, status: resp.status });
    }
  } catch (err) {
    logError("gateway_error_callback_failed", {
      callId,
      code,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function verifyTelnyx(req: express.Request, rawBody: string) {
  const signature = req.header("telnyx-signature-ed25519");
  const timestamp = req.header("telnyx-timestamp");
  return validateTelnyxSignature({
    signatureHeader: signature,
    timestampHeader: timestamp,
    publicKey: env.TELNYX_PUBLIC_KEY,
    rawBody
  });
}

function buildBaseUrl(req: express.Request) {
  if (callGatewayBaseUrl) return callGatewayBaseUrl;
  return `${req.protocol}://${req.get("host")}`;
}

function toWebSocketUrl(baseUrl: string) {
  if (baseUrl.startsWith("https://")) return baseUrl.replace("https://", "wss://");
  if (baseUrl.startsWith("http://")) return baseUrl.replace("http://", "ws://");
  return baseUrl;
}

function sendXAiEvent(ws: WebSocket | undefined, payload: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function createAudioTextResponseEvent(response: Record<string, unknown> = {}) {
  return buildRealtimeResponseCreateEvent(response);
}

function createFunctionCallOutputEvent(callId: string, output: unknown) {
  return {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output)
    }
  };
}

function ensureAudioPumpTrace(session: StreamSession, responseId?: string | null) {
  const normalizedResponseId = String(responseId || session.currentResponseId || "").trim() || null;
  session.audioPumpTrace = ensureAudioPumpTraceForResponse(
    session.audioPumpTrace,
    normalizedResponseId,
    performance.now()
  );
  return session.audioPumpTrace;
}

function logAssistantAudioGap(
  session: StreamSession,
  trace: AudioPumpTrace,
  gapMs: number | null,
  source: "reprime" | "response_done" | "session_end"
) {
  if (gapMs === null) return;
  if (!shouldLogAudioGap(
    trace,
    gapMs,
    outboundJitterBufferFrames * outboundAudioFrameMs
  )) return;
  logInfo("assistant_audio_gap", {
    callSid: session.callSid,
    responseId: trace.responseId || undefined,
    source,
    gapMs: Number(gapMs.toFixed(3)),
    bufferTargetFrames: outboundJitterBufferFrames,
    bufferTargetMs: outboundJitterBufferFrames * outboundAudioFrameMs,
    queuedFrames: session.outputQueue?.length || 0,
    bufferedBytes: session.outputBuffer?.length || 0
  });
}

function logAudioPumpTraceSummary(
  session: StreamSession,
  stage: "response_done" | "playback_drained" | "interrupted" | "session_end"
) {
  const trace = session.audioPumpTrace;
  if (!trace) return;
  const nowMs = performance.now();
  finishAudioQueueGapWithoutReprime(trace, nowMs);
  if (stage === "playback_drained") {
    trace.playbackDrainedAtMs = nowMs;
  }
  if (trace.chunksQueued === 0 && trace.framesSent === 0) {
    if (shouldClearAudioPumpTraceAfterSummary(trace, stage)) {
      session.audioPumpTrace = null;
    }
    return;
  }
  const payload = {
    callSid: session.callSid,
    stage,
    responseId: trace.responseId || undefined,
    traceWindowMs: Number((nowMs - trace.startedAtMs).toFixed(3)),
    chunksQueued: trace.chunksQueued,
    chunkBytes: trace.chunkBytes,
    interChunkGapCount: trace.interChunkGapCount,
    maxInterChunkGapMs: Number(trace.maxInterChunkGapMs.toFixed(3)),
    interChunkGapOverBufferTargetCount: trace.interChunkGapOverBufferTargetCount,
    framesSent: trace.framesSent,
    queueDrainCount: trace.queueDrainCount,
    underrunCount: trace.underrunCount,
    totalUnderrunMs: Number(trace.totalUnderrunMs.toFixed(3)),
    maxUnderrunMs: Number(trace.maxUnderrunMs.toFixed(3)),
    reprimeCount: trace.reprimeCount,
    terminalGapCount: trace.terminalGapCount,
    totalTerminalGapMs: Number(trace.totalTerminalGapMs.toFixed(3)),
    maxTerminalGapMs: Number(trace.maxTerminalGapMs.toFixed(3)),
    timerLateCount: trace.timerLateCount,
    totalTimerLateMs: Number(trace.totalTimerLateMs.toFixed(3)),
    maxTimerLateMs: Number(trace.maxTimerLateMs.toFixed(3)),
    catchupBurstCount: trace.catchupBurstCount,
    maxBurstFrames: trace.maxBurstFrames,
    bufferTargetFrames: outboundJitterBufferFrames,
    bufferTargetMs: outboundJitterBufferFrames * outboundAudioFrameMs,
    responseDone: trace.responseDoneAtMs !== null,
    playbackDrained: trace.playbackDrainedAtMs !== null,
    interrupted: trace.interruptedAtMs !== null,
    queuedFramesRemaining: session.outputQueue?.length || 0,
    bufferedBytesRemaining: session.outputBuffer?.length || 0,
    outputPrimed: Boolean(session.outputPrimed),
    outputTimerActive: Boolean(session.outputTimer),
    telnyxStreamOpen: session.telnyxWs?.readyState === WebSocket.OPEN
  };
  logInfo("assistant_audio_pump_trace", payload);
  logRealtimeDetailEntry(session, {
    ts: new Date().toISOString(),
    kind: "assistant_audio_pump_trace",
    ...payload
  });
  if (shouldClearAudioPumpTraceAfterSummary(trace, stage)) {
    session.audioPumpTrace = null;
  }
}

function requestAssistantResponse(
  session: StreamSession,
  reason: string,
  response: Record<string, unknown> = {},
  dedupeKey?: string | null,
  toolResponse?: ToolResponseMetadata | null
) {
  if (session.finishSessionAccepted) {
    logInfo("xai_realtime_post_finish_response_suppressed", {
      callSid: session.callSid,
      reason,
      dedupeKey: dedupeKey || undefined,
      tool: toolResponse?.tool,
      callId: toolResponse?.callId
    });
    return "suppressed_after_finish" as const;
  }
  const result = enqueueAssistantResponseRequest(session, {
    reason,
    response,
    dedupeKey,
    toolResponse
  });
  if (result.action === "duplicate_active" || result.action === "duplicate_queued") {
    logInfo("xai_realtime_response_request_deduped", {
      callSid: session.callSid,
      reason,
      dedupeKey: dedupeKey || undefined,
      duplicateState: result.action,
      queueDepth: result.queueDepth
    });
    return result.action;
  }

  if (result.action === "queued") {
    logInfo("xai_realtime_response_queued", {
      callSid: session.callSid,
      reason,
      dedupeKey: dedupeKey || undefined,
      queueDepth: result.queueDepth,
      activeResponseId: session.currentResponseId || undefined
    });
    return result.action;
  }

  dispatchAssistantResponseRequest(session, result.request);
  return result.action;
}

function dispatchAssistantResponseRequest(
  session: StreamSession,
  request: AssistantResponseRequest
) {
  const responseEvent = createAudioTextResponseEvent(request.response);
  const sent = sendXAiEvent(session.XAiWs, responseEvent);
  if (!sent) {
    markAssistantResponseFinished(session);
    logError("xai_realtime_response_dispatch_failed", {
      callSid: session.callSid,
      reason: request.reason,
      dedupeKey: request.dedupeKey || undefined,
      tool: request.toolResponse?.tool,
      callId: request.toolResponse?.callId
    });
    return false;
  }

  const timingState = session.toolResponseTiming || createToolResponseTimingState();
  session.toolResponseTiming = timingState;
  const wait = trackAssistantResponseDispatch(
    timingState,
    request.toolResponse || null,
    performance.now()
  );
  if (wait) {
    logInfo("xai_realtime_tool_response_requested", {
      callSid: session.callSid,
      tool: wait.tool,
      callId: wait.callId,
      traceFile: session.realtimeLogPath || ensureSessionRealtimeLogPath(session),
      toolResultPayloadBytes: wait.toolResultPayloadBytes,
      responseCreatePayloadBytes: estimatePayloadBytes(responseEvent)
    });
    logRealtimeDetailEntry(session, {
      ts: new Date().toISOString(),
      kind: "tool_response_create_send",
      callSid: session.callSid,
      tool: wait.tool,
      callId: wait.callId,
      payload: responseEvent
    });
  }
  return true;
}

function flushQueuedAssistantResponses(session: StreamSession) {
  if (hasActiveAssistantResponse(session)) return;
  const next = dequeueAssistantResponseRequest(session);
  if (!next) return;
  logInfo("xai_realtime_response_flushed", {
    callSid: session.callSid,
    reason: next.reason,
    dedupeKey: next.dedupeKey || undefined,
    remainingQueueDepth: session.queuedAssistantResponses?.length || 0
  });
  dispatchAssistantResponseRequest(session, next);
}

function sendTelnyxMedia(ws: WebSocket | undefined, streamId: string | undefined, payloadBase64: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !streamId) return;
  ws.send(
    JSON.stringify({
      event: "media",
      stream_id: streamId,
      media: { payload: payloadBase64 }
    })
  );
}

function clearTelnyxMedia(ws: WebSocket | undefined) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(buildTelnyxClearEvent()));
  return true;
}

function decodeInboundAudioPayload(encoded: string) {
  return Buffer.from(encoded, "base64");
}

function enqueueOutputPcm(session: StreamSession, pcmChunk: Buffer) {
  const frameSize = 160;
  const buffer = session.outputBuffer ? Buffer.concat([session.outputBuffer, pcmChunk]) : pcmChunk;
  if (!session.outputQueue) {
    session.outputQueue = [];
  }
  const trace = ensureAudioPumpTrace(session);
  noteAudioChunkQueued(
    trace,
    pcmChunk.length,
    performance.now(),
    outboundJitterBufferFrames * outboundAudioFrameMs
  );
  noteAssistantAudioChunkQueued(session);
  let offset = 0;
  while (buffer.length - offset >= frameSize) {
    const frame = buffer.subarray(offset, offset + frameSize);
    session.outputQueue.push(frame);
    offset += frameSize;
  }
  session.outputBuffer = buffer.subarray(offset);
  startOutputPump(session);
}

function hasBufferedFramesReady(session: StreamSession) {
  const queuedFrames = session.outputQueue?.length || 0;
  if (queuedFrames === 0) return false;
  return queuedFrames >= outboundJitterBufferFrames || !session.currentResponseId;
}

function pumpAvailableOutputFrames(session: StreamSession, nowMs = performance.now()) {
  const trace = ensureAudioPumpTrace(session);
  if (!session.outputQueue || session.outputQueue.length === 0) {
    if (session.currentResponseId && trace.underrunStartAtMs === null) {
      beginAudioQueueGap(trace, nowMs);
    }
    return 0;
  }
  if (!session.outputNextFrameAtMs) {
    session.outputNextFrameAtMs = nowMs;
  }

  const lateMs = Math.max(0, nowMs - session.outputNextFrameAtMs);
  if (lateMs >= 5) {
    trace.timerLateCount += 1;
    trace.totalTimerLateMs += lateMs;
    trace.maxTimerLateMs = Math.max(trace.maxTimerLateMs, lateMs);
  }

  const frameBudget = Math.min(
    session.outputQueue.length,
    Math.max(1, Math.floor((nowMs - session.outputNextFrameAtMs) / outboundAudioFrameMs) + 1),
    8
  );
  if (frameBudget > 1) {
    trace.catchupBurstCount += 1;
    trace.maxBurstFrames = Math.max(trace.maxBurstFrames, frameBudget);
  }

  let sent = 0;
  while (sent < frameBudget && session.outputQueue.length > 0) {
    const payload = session.outputQueue.shift();
    if (!payload) break;
    noteAssistantAudioFrameSent(session);
    sendTelnyxMedia(session.telnyxWs, session.telnyxStreamId, payload.toString("base64"));
    session.outputNextFrameAtMs = (session.outputNextFrameAtMs || nowMs) + outboundAudioFrameMs;
    sent += 1;
  }
  trace.framesSent += sent;

  if (session.outputNextFrameAtMs && session.outputNextFrameAtMs < nowMs - (outboundAudioFrameMs * 4)) {
    session.outputNextFrameAtMs = nowMs;
  }
  return sent;
}

function startOutputPump(session: StreamSession) {
  if (session.outputTimer) return;
  if (!hasBufferedFramesReady(session)) {
    session.outputPrimed = false;
    return;
  }
  session.outputPrimed = true;
  session.outputNextFrameAtMs = performance.now();
  pumpAvailableOutputFrames(session, session.outputNextFrameAtMs);
  session.outputTimer = setInterval(() => {
    const nowMs = performance.now();
    if (!session.outputPrimed) {
      if (!hasBufferedFramesReady(session)) {
        return;
      }
      const trace = ensureAudioPumpTrace(session);
      const gapMs = closeAudioQueueGap(trace, nowMs);
      if (gapMs !== null) {
        noteAudioPumpReprimed(trace);
        logAssistantAudioGap(session, trace, gapMs, "reprime");
      }
      session.outputPrimed = true;
      session.outputNextFrameAtMs = nowMs;
    }
    pumpAvailableOutputFrames(session, nowMs);
    if (!session.outputQueue || session.outputQueue.length === 0) {
      // Realtime audio can arrive in bursts. Keep the Telnyx pump alive while the
      // current assistant response is still active so the next chunk can re-prime
      // a small jitter buffer instead of forcing a full pump restart.
      if (session.currentResponseId) {
        const trace = ensureAudioPumpTrace(session);
        beginAudioQueueGap(trace, session.outputNextFrameAtMs || nowMs);
        session.outputPrimed = false;
        session.outputNextFrameAtMs = null;
        return;
      }
      if (session.outputTimer) {
        clearInterval(session.outputTimer);
        session.outputTimer = null;
      }
      session.outputNextFrameAtMs = null;
      if (session.outputBuffer && session.outputBuffer.length > 0 && !session.currentResponseId) {
        session.outputBuffer = Buffer.alloc(0);
      }
      if (!(session.outputBuffer && session.outputBuffer.length > 0) && !session.currentResponseId) {
        logAudioPumpTraceSummary(session, "playback_drained");
        noteAssistantPlaybackDrained(session);
        flushQueuedAssistantResponses(session);
      }
      return;
    }
  }, 5);
}

async function interruptAssistantForCallerSpeech(session: StreamSession | undefined, reason: string) {
  if (!session) return false;
  const assistantPending = hasPendingAssistantAudio(session);
  if (!assistantPending) {
    logInfo("assistant_barge_in_decision", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      reason,
      decision: "no_pending_audio",
      clearSent: false,
      assistantPending: false,
      queuedFrames: session.outputQueue?.length || 0,
      bufferedBytes: session.outputBuffer?.length || 0,
      outputPrimed: Boolean(session.outputPrimed),
      assistantAudioMsSent: Math.max(0, Number(session.assistantAudioMsSent || 0))
    });
    return false;
  }
  const plan = buildAssistantInterruptionPlan(session, reason);
  if (!plan.shouldInterrupt) {
    logInfo("assistant_barge_in_decision", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      reason,
      decision: "debounced",
      clearSent: false,
      assistantPending,
      responseId: plan.responseId || undefined,
      queuedFrames: session.outputQueue?.length || 0,
      bufferedBytes: session.outputBuffer?.length || 0,
      outputPrimed: Boolean(session.outputPrimed),
      assistantAudioMsSent: Math.max(0, Number(session.assistantAudioMsSent || 0))
    });
    return false;
  }

  const clearSent = clearTelnyxMedia(session.telnyxWs);
  logInfo("assistant_barge_in_decision", {
    callSid: session.callSid,
    callControlId: session.callControlId,
    reason,
    decision: clearSent ? "clear_applied" : "clear_not_sent",
    clearSent,
    assistantPending,
    responseId: plan.responseId || undefined,
    queuedFrames: plan.queuedFramesDropped,
    bufferedBytes: plan.bufferedBytesDropped,
    outputPrimed: Boolean(session.outputPrimed),
    assistantAudioMsSent: Math.max(0, Number(session.assistantAudioMsSent || 0))
  });
  applyAssistantInterruption(session, plan);
  if (session.audioPumpTrace) {
    session.audioPumpTrace.interruptedAtMs = performance.now();
  }
  logAudioPumpTraceSummary(session, "interrupted");
  if (session.knowledgeCallState) {
    await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, session.knowledgeCallState, {
      source: "barge_in",
      reason,
      truncated_audio_ms: plan.truncatedAudioMs,
      queued_frames_dropped: plan.queuedFramesDropped,
      buffered_bytes_dropped: plan.bufferedBytesDropped
    });
  }
  logInfo("assistant_barge_in_applied", {
    callSid: session.callSid,
    callControlId: session.callControlId,
    reason,
    responseId: plan.responseId || undefined,
    assistantItemId: plan.assistantItemId || undefined,
    truncatedAudioMs: plan.truncatedAudioMs,
    queuedFramesDropped: plan.queuedFramesDropped,
    bufferedBytesDropped: plan.bufferedBytesDropped,
    clearSent
  });
  return true;
}

async function telnyxCallAction(callControlId: string, action: string, payload: Record<string, unknown> = {}) {
  if (!telnyxApiKey) throw new Error("missing_telnyx_key");
  const resp = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`telnyx_${action}_failed:${resp.status}:${text.slice(0, 200)}`);
  }
}

async function markCallCompleted(callSid: string, answeredAtHint: string | null = null) {
  if (!pool) return;
  try {
    const callRow = await pool.query(
      `SELECT
         call_sid,
         created_at,
         answered_at,
         completed_at,
         ai_estimated_cost_micros_usd,
         notification_estimated_cost_micros_usd
       FROM calls
       WHERE call_sid = $1
       LIMIT 1`,
      [callSid]
    );
    const row = callRow.rows[0] || null;
    if (!row) return;

    const completedAt = row.completed_at ? new Date(row.completed_at) : new Date();
    const answeredAt = row.answered_at || answeredAtHint || null;
    const durationSeconds = answeredAt
      ? Math.max(0, Math.round((completedAt.getTime() - new Date(answeredAt).getTime()) / 1000))
      : 0;
    const telephonyBillableMinutes = estimateBillableMinutes(durationSeconds);
    const telephonyEstimatedCostMicrosUsd = estimateTelephonyCostMicrosUsd(
      durationSeconds,
      telnyxEstimatedInboundRatePerMinuteUsd
    );
    const totalEstimatedCostMicrosUsd = Math.max(0, Number(row.ai_estimated_cost_micros_usd || 0))
      + Math.max(0, Number(row.notification_estimated_cost_micros_usd || 0))
      + telephonyEstimatedCostMicrosUsd;

    await pool.query(
      `UPDATE calls
       SET status = 'completed',
           completed_at = COALESCE(completed_at, $2),
           duration_seconds = $3,
           telephony_billable_minutes = $4,
           telephony_rate_micros_usd = $5,
           telephony_estimated_cost_micros_usd = $6,
           total_estimated_cost_micros_usd = $7
       WHERE call_sid = $1`,
      [
        callSid,
        completedAt.toISOString(),
        durationSeconds,
        telephonyBillableMinutes,
        telnyxEstimatedInboundRateMicrosUsd,
        telephonyEstimatedCostMicrosUsd,
        totalEstimatedCostMicrosUsd
      ]
    );
  } catch (err) {
    logError("call_status_update_failed", {
      callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

async function markCallAnswered(callSid: string, answeredAtHint: string | null = null) {
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE calls
       SET answered_at = COALESCE(answered_at, $2::timestamptz, NOW())
       WHERE call_sid = $1`,
      [callSid, answeredAtHint]
    );
  } catch (err) {
    logError("call_answered_update_failed", {
      callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function normalizeOptionalText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function buildTransferTargetId(id: number) {
  return `tenant_user_${id}`;
}

function parseTransferTargetId(value: unknown) {
  const match = /^tenant_user_(\d+)$/.exec(String(value || "").trim());
  return match ? Number(match[1]) : 0;
}

function serializeTransferMatch(row: TransferTargetRow): TransferLookupMatch {
  return {
    target_id: buildTransferTargetId(row.id),
    name: String(row.name || "").trim(),
    extension: normalizeOptionalText(row.transfer_extension)
  };
}

function encodeTransferLegClientState(state: TransferLegClientState) {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64");
}

function parseTransferLegClientState(value: unknown): TransferLegClientState | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (
      parsed?.everycall !== "transfer_leg_v1"
      || !String(parsed?.source_call_control_id || "").trim()
      || !String(parsed?.source_call_sid || "").trim()
      || !String(parsed?.tenant_key || "").trim()
      || !String(parsed?.target_id || "").trim()
    ) {
      return null;
    }
    return {
      everycall: "transfer_leg_v1",
      source_call_control_id: String(parsed.source_call_control_id).trim(),
      source_call_sid: String(parsed.source_call_sid).trim(),
      tenant_key: String(parsed.tenant_key).trim(),
      target_id: String(parsed.target_id).trim()
    };
  } catch {
    return null;
  }
}

async function loadTransferTargetsForTenant(tenantKey: string): Promise<TransferTargetRow[]> {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT id, name, transfer_extension, forward_to_number
     FROM tenant_users
     WHERE tenant_key = $1
       AND status = 'active'
       AND transfer_enabled = TRUE
       AND forward_to_number IS NOT NULL
       AND TRIM(forward_to_number) <> ''
     ORDER BY name ASC, id ASC`,
    [tenantKey]
  );
  return (result.rows || []).map((row: any) => ({
    id: Number(row.id),
    name: String(row.name || "").trim(),
    transfer_extension: normalizeOptionalText(row.transfer_extension),
    forward_to_number: String(row.forward_to_number || "").trim()
  }));
}

async function lookupTransferTarget(tenantKey: string, query: string) {
  const trimmedQuery = String(query || "").trim();
  const targets = await loadTransferTargetsForTenant(tenantKey);
  if (!targets.length) {
    return {
      status: "unavailable",
      query: trimmedQuery,
      matches: [] as TransferLookupMatch[]
    };
  }
  const matches = rankTransferMatches(targets, trimmedQuery).map(serializeTransferMatch);
  if (!matches.length) {
    return {
      status: "not_found",
      query: trimmedQuery,
      matches
    };
  }
  return {
    status: matches.length === 1 ? "match" : "ambiguous",
    query: trimmedQuery,
    matches,
    ...(matches.length === 1 ? {
      target: matches[0],
      requires_confirmation: true,
      next_step: "ask_for_confirmation_before_transfer"
    } : {})
  };
}

async function loadTransferTargetById(tenantKey: string, targetId: string) {
  const parsedId = parseTransferTargetId(targetId);
  if (!parsedId || !pool) return null;
  const result = await pool.query(
    `SELECT id, name, transfer_extension, forward_to_number
     FROM tenant_users
     WHERE tenant_key = $1
       AND id = $2
       AND status = 'active'
       AND transfer_enabled = TRUE
       AND forward_to_number IS NOT NULL
       AND TRIM(forward_to_number) <> ''
     LIMIT 1`,
    [tenantKey, parsedId]
  );
  if (!result.rowCount) return null;
  return {
    id: Number(result.rows[0].id),
    name: String(result.rows[0].name || "").trim(),
    transfer_extension: normalizeOptionalText(result.rows[0].transfer_extension),
    forward_to_number: String(result.rows[0].forward_to_number || "").trim()
  } satisfies TransferTargetRow;
}

async function persistTransferCallState(session: StreamSession, target: TransferTargetRow) {
  if (!session.promptPayload) return;
  const nextState = applyCapturedFieldsToCallState(
    session.knowledgeCallState || session.promptPayload.knowledge_runtime.initial_call_state,
    {
      outcome_type: "transfer",
      transfer_target_name: target.name,
      transfer_target_extension: target.transfer_extension || null
    }
  );
  session.knowledgeCallState = nextState;
  await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, nextState, {
    source: "transfer_call",
    transfer_target_id: buildTransferTargetId(target.id),
    transfer_target_name: target.name,
    transfer_target_extension: target.transfer_extension || null
  });
}

function notePendingTransferLookup(session: StreamSession, lookupResult: {
  status?: string;
  target?: TransferLookupMatch;
}) {
  if (lookupResult.status === "match" && lookupResult.target) {
    session.pendingTransferCandidate = {
      targetId: lookupResult.target.target_id,
      targetName: lookupResult.target.name,
      targetExtension: lookupResult.target.extension || null,
      confirmed: false,
      createdAt: new Date().toISOString(),
      confirmedAt: null
    };
    return;
  }
  session.pendingTransferCandidate = null;
}

function noteCallerTransferConfirmation(session: StreamSession, transcript: string) {
  const pendingCandidate = session.pendingTransferCandidate;
  if (!pendingCandidate) return;
  const classification = classifyTransferConfirmation(transcript);
  if (classification === "confirmed") {
    if (pendingCandidate.confirmed) return;
    pendingCandidate.confirmed = true;
    pendingCandidate.confirmedAt = new Date().toISOString();
    logInfo("call_transfer_confirmation_received", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      targetId: pendingCandidate.targetId,
      targetName: pendingCandidate.targetName,
      targetExtension: pendingCandidate.targetExtension || undefined
    });
    return;
  }
  if (classification === "rejected") {
    logInfo("call_transfer_confirmation_rejected", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      targetId: pendingCandidate.targetId,
      targetName: pendingCandidate.targetName,
      targetExtension: pendingCandidate.targetExtension || undefined
    });
    session.pendingTransferCandidate = null;
    return;
  }
  if (pendingCandidate.confirmed) {
    pendingCandidate.confirmed = false;
    pendingCandidate.confirmedAt = null;
    logInfo("call_transfer_confirmation_revised", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      targetId: pendingCandidate.targetId,
      targetName: pendingCandidate.targetName,
      targetExtension: pendingCandidate.targetExtension || undefined
    });
  }
}

async function detachAiForTransferredCall(session: StreamSession, source: string) {
  if (session.aiDetached) return;
  session.aiDetached = true;
  session.suppressXAiReconnect = true;
  session.pendingToolCall = null;
  session.toolResponseTiming = createToolResponseTimingState();
  session.queuedAssistantResponses = [];
  session.activeAssistantResponseDedupeKey = null;
  session.outputQueue = [];
  session.outputBuffer = Buffer.alloc(0);
  if (session.outputTimer) {
    clearInterval(session.outputTimer);
    session.outputTimer = null;
  }
  session.outputNextFrameAtMs = null;

  if (session.XAiWs && session.XAiWs.readyState === WebSocket.OPEN) {
    session.XAiWs.close();
  }
  delete session.XAiWs;
  session.ignoreNextStreamingStopped = true;

  try {
    await telnyxCallAction(session.callControlId, "streaming_stop", {});
  } catch (err) {
    logError("telnyx_stream_stop_for_transfer_failed", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      source,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

async function reattachAiAfterFailedTransfer(session: StreamSession, reason: string) {
  if (!session.aiDetached) return true;
  const streamBaseUrl = String(session.telnyxStreamBaseUrl || "").trim();
  if (!streamBaseUrl) {
    logError("telnyx_stream_restart_missing_url", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      reason
    });
    return false;
  }

  session.aiDetached = false;
  session.suppressXAiReconnect = false;
  session.XAiReady = false;
  session.XAiSessionUpdated = false;
  session.pendingToolCall = null;
  session.toolResponseTiming = createToolResponseTimingState();
  session.queuedAssistantResponses = [];
  session.activeAssistantResponseDedupeKey = null;
  session.outputQueue = [];
  session.outputBuffer = Buffer.alloc(0);
  if (session.outputTimer) {
    clearInterval(session.outputTimer);
    session.outputTimer = null;
  }
  session.outputNextFrameAtMs = null;

  try {
    await telnyxCallAction(session.callControlId, "streaming_start", getTelnyxStreamingStartPayload(streamBaseUrl, session.callControlId));
    logInfo("telnyx_stream_restart_requested_after_transfer_failure", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      reason
    });
    return true;
  } catch (err) {
    session.aiDetached = true;
    session.suppressXAiReconnect = true;
    logError("telnyx_stream_restart_failed_after_transfer_failure", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      reason,
      message: err instanceof Error ? err.message : "unknown"
    });
    return false;
  }
}

async function handleTransferConnected(session: StreamSession, source: string, extra: Record<string, unknown> = {}) {
  if (!session.transferState || session.transferState.status !== "pending") return;
  session.transferState = {
    ...session.transferState,
    status: "connected",
    ...(extra.targetCallControlId ? { targetCallControlId: String(extra.targetCallControlId) } : {}),
    ...(extra.targetCallSessionId ? { targetCallSessionId: String(extra.targetCallSessionId) } : {})
  };
  logInfo("call_transfer_connected", {
    callSid: session.callSid,
    callControlId: session.callControlId,
    targetId: session.transferState.targetId,
    targetName: session.transferState.targetName,
    targetExtension: session.transferState.targetExtension || undefined,
    source,
    ...(extra.targetCallControlId ? { targetCallControlId: String(extra.targetCallControlId) } : {})
  });
  if (session.knowledgeCallState) {
    await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, session.knowledgeCallState, {
      source: "transfer_connected",
      transfer_target_id: session.transferState.targetId,
      transfer_target_name: session.transferState.targetName,
      transfer_target_extension: session.transferState.targetExtension || null
    });
  }
  await detachAiForTransferredCall(session, source);
}

async function handleTransferFailed(session: StreamSession, source: string, details: Record<string, unknown> = {}) {
  const currentTransfer = session.transferState;
  if (!currentTransfer || currentTransfer.status !== "pending") return;
  session.transferState = null;
  session.pendingTransferCandidate = null;
  logInfo("call_transfer_failed", {
    callSid: session.callSid,
    callControlId: session.callControlId,
    targetId: currentTransfer.targetId,
    targetName: currentTransfer.targetName,
    targetExtension: currentTransfer.targetExtension || undefined,
    source,
    ...details
  });
  if (session.knowledgeCallState) {
    await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, session.knowledgeCallState, {
      source: "transfer_failed",
      transfer_target_id: currentTransfer.targetId,
      transfer_target_name: currentTransfer.targetName,
      transfer_target_extension: currentTransfer.targetExtension || null,
      failure_reason: source,
      ...details
    });
  }
  const recoveryResponse = {
    instructions: `The attempted transfer to ${currentTransfer.targetName} did not connect. Briefly apologize, then offer to take a message or try another person. Keep it to one or two short sentences.`
  };
  if (session.aiDetached) {
    const restartRequested = await reattachAiAfterFailedTransfer(session, source);
    if (restartRequested) {
      session.pendingReconnectAssistantResponse = {
        reason: "transfer_failed",
        response: recoveryResponse,
        dedupeKey: `transfer_failed:${currentTransfer.commandId}`
      };
      return;
    }
  }
  requestAssistantResponse(session, "transfer_failed", recoveryResponse, `transfer_failed:${currentTransfer.commandId}`);
}

async function loadCombinedTranscriptForCall(callSid: string) {
  if (!pool) return "";
  try {
    const events = await pool.query(
      `SELECT role, text, event_type
       FROM call_events
       WHERE call_sid = $1
       ORDER BY created_at ASC`,
      [callSid]
    );
    return buildTranscriptFromEvents(events.rows || []);
  } catch (err) {
    logError("call_transcript_load_failed", {
      callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
    return "";
  }
}

async function finalizeCallSummary(session: StreamSession) {
  if (!appBaseUrl || !callSummaryFinalizeToken) return;

  const capturedFieldSource = session.knowledgeCallState?.captured_fields
    && typeof session.knowledgeCallState.captured_fields === "object"
    && !Array.isArray(session.knowledgeCallState.captured_fields)
    ? session.knowledgeCallState.captured_fields as Record<string, unknown>
    : {};
  const capturedFields: Record<string, unknown> = { ...capturedFieldSource };

  const transcript = await loadCombinedTranscriptForCall(session.callSid);
  if (transcript) {
    capturedFields.transcript = transcript;
  }

  const urgency = normalizeOptionalText(
    capturedFields.urgency_level
    || capturedFields.urgency
  );
  const disposition = normalizeOptionalText(
    capturedFields.outcome_type
    || session.knowledgeCallState?.outcome_in_progress
  );

  try {
    const resp = await fetch(`${appBaseUrl}/api/v1/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-everycall-internal": callSummaryFinalizeToken
      },
      body: JSON.stringify({
        action: "summary",
        callSid: session.callSid,
        tenantKey: session.tenantKey,
        ...(urgency ? { urgency } : {}),
        ...(disposition ? { disposition } : {}),
        extracted: capturedFields
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      logError("call_summary_finalize_failed", {
        callSid: session.callSid,
        status: resp.status,
        message: text.slice(0, 200)
      });
    }
  } catch (err) {
    logError("call_summary_finalize_failed", {
      callSid: session.callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

async function endCallSession(session: StreamSession | undefined, reason: string, shouldHangup: boolean) {
  if (!session || session.isShuttingDown) return;
  session.isShuttingDown = true;
  session.callActive = false;
  try {
    await session.callerTranscriptPersistenceTail;
  } catch {
    // Persistence failures are logged where the queued write is performed.
  }
  logCallerTranscriptTurnSummary(session, "session_end");
  await persistCallUsage(session);
  if (session.knowledgeCallState) {
    await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, session.knowledgeCallState, {
      source: "call_end",
      end_reason: reason
    });
  }

  logAudioPumpTraceSummary(session, "session_end");
  logInfo("gateway_call_session_end", {
    callSid: session.callSid,
    callControlId: session.callControlId,
    reason
  });

  if (session.outputTimer) {
    clearInterval(session.outputTimer);
    session.outputTimer = null;
  }
  session.outputNextFrameAtMs = null;

  if (session.hangupTimer) {
    clearTimeout(session.hangupTimer);
    session.hangupTimer = null;
  }

  if (session.XAiWs && session.XAiWs.readyState === WebSocket.OPEN) {
    session.XAiWs.close();
  }

  await finalizeCallSummary(session);

  if (shouldHangup && session.callControlId) {
    try {
      await telnyxCallAction(session.callControlId, "hangup", {});
    } catch (err) {
      logError("telnyx_call_control_hangup_error", {
        callSid: session.callSid,
        message: err instanceof Error ? err.message : "unknown"
      });
    }
  }

  if (session.telnyxStreamId) {
    streamIdToCall.delete(session.telnyxStreamId);
  }
  streamSessions.delete(session.callControlId);
  await markCallCompleted(session.callSid, session.callAnsweredAt || null);
}

async function flushFinalAudioAndEnd(session: StreamSession | undefined, reason: string, shouldHangup: boolean) {
  if (!session) return;
  await endCallSession(session, reason, shouldHangup);
}

async function handleStreamingStoppedForSession(session: StreamSession | undefined, reason: string) {
  if (!session) return;
  if (session.ignoreNextStreamingStopped) {
    session.ignoreNextStreamingStopped = false;
    if (session.telnyxStreamId) {
      streamIdToCall.delete(session.telnyxStreamId);
    }
    delete session.telnyxStreamId;
    delete session.telnyxWs;
    logInfo("telnyx_stream_stopped_expected", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      reason
    });
    return;
  }
  if (session.telnyxStreamId) {
    streamIdToCall.delete(session.telnyxStreamId);
  }
  delete session.telnyxStreamId;
  delete session.telnyxWs;
  if (session.aiDetached || session.transferState?.status === "connected") {
    logInfo("telnyx_stream_stopped_after_transfer", {
      callSid: session.callSid,
      callControlId: session.callControlId,
      reason,
      targetId: session.transferState?.targetId || undefined,
      targetName: session.transferState?.targetName || undefined
    });
    return;
  }
  await flushFinalAudioAndEnd(session, reason, false);
}

async function fetchPromptPayload(tenantKey: string, callSid: string, to: string, from: string): Promise<GatewayPromptPayload> {
  if (!appBaseUrl || !gatewayPromptToken) {
    throw new Error("missing_app_base_or_token");
  }
  const resp = await fetch(`${appBaseUrl}/api/v1/gateway/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-everycall-internal": gatewayPromptToken
    },
    body: JSON.stringify({ tenantKey, callSid, to, from })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`prompt_fetch_failed:${resp.status}:${text.slice(0, 200)}`);
  }
  const body = await resp.json();
  return validatePromptPayload(body);
}

async function safePrewarmBuildAssets(callSid: string, tenantKey: string, buildId: string, source: string) {
  try {
    const prewarmed = await prewarmKnowledgeBuildAssets(pool, tenantKey, buildId);
    logPrewarmOutcome(callSid, tenantKey, source, { status: "ready", buildId, ...prewarmed });
    return { status: "ready" as const, buildId, ...prewarmed };
  } catch (err) {
    const failed = {
      status: "failed" as const,
      buildId,
      cacheHit: false,
      fetchMs: 0,
      message: err instanceof Error ? err.message : "unknown"
    };
    logPrewarmOutcome(callSid, tenantKey, source, failed);
    return failed;
  }
}

async function recoverSessionForCallControlId(callControlId: string, source: string) {
  const recovered = await recoverStreamSessionBootstrap(
    pool,
    callControlId,
    fetchPromptPayload,
    prewarmKnowledgeBuildAssets,
    initializeKnowledgeCallState,
    source
  );
  if (!recovered) {
    return undefined;
  }

  logPrewarmOutcome(recovered.callSid, recovered.tenantKey, source, {
    buildId: recovered.promptPayload.knowledge_runtime.active_build_id,
    ...recovered.prewarm
  });
  const realtimeLogPath = realtimeDebug || realtimeTrace ? initRealtimeLog(recovered.callSid) : undefined;
  await persistKnowledgeCallState(pool, recovered.tenantKey, recovered.callSid, recovered.knowledgeCallState, {
    source
  });
  const session = createStreamSession(
    callControlId,
    recovered.callSid,
    recovered.tenantKey,
    recovered.promptPayload,
    recovered.knowledgeCallState,
    realtimeLogPath
  );
  streamSessions.set(callControlId, session);
  return session;
}

async function initializeInboundCallSession(params: {
  callControlId: string;
  callSid: string;
  tenantKey: string;
  to: string;
  from: string;
}) {
  const { callControlId, callSid, tenantKey, to, from } = params;
  const promptPayload = await fetchPromptPayload(tenantKey, callSid, to, from);
  await safePrewarmBuildAssets(callSid, tenantKey, promptPayload.knowledge_runtime.active_build_id, "call_initiated");
  const realtimeLogPath = realtimeDebug || realtimeTrace ? initRealtimeLog(callSid) : undefined;
  const knowledgeCallState = initializeKnowledgeCallState(promptPayload);
  await persistKnowledgeCallState(pool, tenantKey, callSid, knowledgeCallState, {
    source: "call_initiated"
  });
  const session = createStreamSession(
    callControlId,
    callSid,
    tenantKey,
    promptPayload,
    knowledgeCallState,
    realtimeLogPath
  );
  streamSessions.set(callControlId, session);
  return session;
}

async function waitForInboundSessionBootstrap(callControlId: string, source: string) {
  const pending = inboundSessionBootstraps.get(callControlId);
  if (!pending) return undefined;
  logInfo("inbound_session_bootstrap_wait", { callControlId, source });
  const session = await pending;
  logInfo("inbound_session_bootstrap_wait_completed", {
    callControlId,
    source,
    ready: Boolean(session)
  });
  return session;
}

async function preloadActiveBuildAssetsOnStartup() {
  if (!pool) return;
  const started = Date.now();
  logInfo("knowledge_build_assets_startup_preload_started", {});
  try {
    clearKnowledgeBuildAssetCache();
    const summary = await prewarmActiveKnowledgeBuildAssets(pool, prewarmKnowledgeBuildAssets);
    logInfo("knowledge_build_assets_startup_preload_completed", {
      attempted: summary.attempted,
      succeeded: summary.succeeded,
      failed: summary.failed,
      totalFetchMs: summary.totalFetchMs,
      maxFetchMs: summary.maxFetchMs,
      wallClockMs: Date.now() - started
    });
  } catch (err) {
    logError("knowledge_build_assets_startup_preload_failed", {
      wallClockMs: Date.now() - started,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function validateAgainstSchema(schema: Record<string, unknown>, payload: Record<string, unknown>) {
  try {
    const validate = ajv.compile(schema);
    const isValid = validate(payload);
    const errors = (validate.errors || []).map((err: { instancePath?: string; message?: string }) =>
      `${err.instancePath || "/"}:${err.message || "invalid"}`
    );
    return { status: isValid ? "accepted" : "invalid", errors } as const;
  } catch (err) {
    return {
      status: "invalid",
      errors: [`schema_compile_failed:${err instanceof Error ? err.message : "unknown"}`]
    } as const;
  }
}

async function forwardToolResult(
  callId: string,
  tenantKey: string,
  tool: string,
  payload: Record<string, unknown>,
  validation: { status: string; errors: string[] }
) {
  if (!appBaseUrl || !gatewayToolResultToken) return "not_configured" as const;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const resp = await fetch(`${appBaseUrl}/api/v1/gateway/tools/result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-everycall-internal": gatewayToolResultToken
        },
        body: JSON.stringify({ call_id: callId, tenant_key: tenantKey, tool, payload, validation })
      });
      if (resp.ok) return "succeeded" as const;
      throw new Error(`status_${resp.status}`);
    } catch (err) {
      if (attempt === maxAttempts) {
        logError("gateway_tool_result_forward_failed", {
          callId,
          tool,
          attempts: maxAttempts,
          message: err instanceof Error ? err.message : "unknown"
        });
        return "failed" as const;
      }
      await sleep(100 * 2 ** (attempt - 1));
    }
  }
  return "failed" as const;
}

function estimatePayloadBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function createToolResponseMetadata(
  tool: string,
  callId: string,
  toolResultEvent: Record<string, unknown>
): ToolResponseMetadata {
  return {
    tool,
    callId,
    toolResultPayloadBytes: estimatePayloadBytes(toolResultEvent)
  };
}

function logRealtimeToolPayloads(session: StreamSession, params: {
  callSid: string;
  tool: string;
  callId: string;
  toolResultEvent: Record<string, unknown>;
}) {
  logRealtimeDetailEntry(session, {
    ts: new Date().toISOString(),
    kind: "tool_result_send",
    callSid: params.callSid,
    tool: params.tool,
    callId: params.callId,
    payload: params.toolResultEvent
  });
}

async function executeToolCall(
  session: StreamSession,
  name: string,
  callId: string,
  argsText: string,
  timing: ToolCallTimingContext
) {
  let args: Record<string, unknown> = {};
  try {
    args = argsText ? JSON.parse(argsText) : {};
  } catch {
    args = {};
  }

  if (name === "knowledge_lookup") {
    const executionStartedAtMs = performance.now();
    const query = String((args as any).query || "");
    if (!session.promptPayload) {
      throw new Error("missing_prompt_payload");
    }

    const runtimeResult = await fetchKnowledgeRuntimeTurn(pool, session.promptPayload, {
      tenantKey: session.tenantKey,
      callId: session.callSid,
      query,
      buildId: session.promptPayload.knowledge_runtime.active_build_id,
      callState: session.knowledgeCallState || session.promptPayload.knowledge_runtime.initial_call_state
    });
    const runtimeCompletedAtMs = performance.now();
    const nextState = mergeRuntimeTurnState(
      session.knowledgeCallState || session.promptPayload.knowledge_runtime.initial_call_state,
      runtimeResult
    );
    session.knowledgeCallState = nextState;
    const callStatePersistStartedAtMs = performance.now();
    await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, nextState, {
      runtime_mode: runtimeResult.runtime_bundle.runtime_mode,
      source: "knowledge_lookup"
    });
    const callStatePersistCompletedAtMs = performance.now();

    const toolOutput = formatKnowledgeRuntimeToolOutput(runtimeResult);
    logRealtimeDetailEntry(session, {
      ts: new Date().toISOString(),
      kind: "planner_request",
      callSid: session.callSid,
      tool: name,
      callId,
      query,
      payload: runtimeResult.retrieval_telemetry.planner_request_payload || null
    });
    logRealtimeDetailEntry(session, {
      ts: new Date().toISOString(),
      kind: "planner_response",
      callSid: session.callSid,
      tool: name,
      callId,
      query,
      payload: runtimeResult.retrieval_telemetry.planner_response_payload || null
    });
    logRealtimeDetailEntry(session, {
      ts: new Date().toISOString(),
      kind: "embedding_request",
      callSid: session.callSid,
      tool: name,
      callId,
      query,
      payload: runtimeResult.retrieval_telemetry.embedding_request_payload || null
    });
    logRealtimeDetailEntry(session, {
      ts: new Date().toISOString(),
      kind: "embedding_response",
      callSid: session.callSid,
      tool: name,
      callId,
      query,
      payload: runtimeResult.retrieval_telemetry.embedding_response_payloads || []
    });
    logInfo("knowledge_lookup_tool_called", {
      callSid: session.callSid,
      coverageItemCount: Array.isArray(runtimeResult.answer_packet.coverage) ? runtimeResult.answer_packet.coverage.length : 0,
      cardCount: Array.isArray(runtimeResult.answer_packet.used_card_ids) ? runtimeResult.answer_packet.used_card_ids.length : 0,
      factCount: Array.isArray(runtimeResult.answer_packet.used_fact_ids) ? runtimeResult.answer_packet.used_fact_ids.length : 0,
      overrideCount: runtimeResult.matched_overrides.length,
      guardrailCount: runtimeResult.matched_guardrails.length,
      assetCacheHit: typeof runtimeResult.retrieval_telemetry.asset_cache_hit === "boolean"
        ? runtimeResult.retrieval_telemetry.asset_cache_hit
        : undefined,
      assetFetchMs: typeof runtimeResult.retrieval_telemetry.asset_fetch_ms === "number"
        ? runtimeResult.retrieval_telemetry.asset_fetch_ms
        : undefined,
      recentConversationSummaryMs: typeof runtimeResult.retrieval_telemetry.recent_conversation_summary_ms === "number"
        ? runtimeResult.retrieval_telemetry.recent_conversation_summary_ms
        : undefined,
      plannerMs: typeof runtimeResult.retrieval_telemetry.planner_ms === "number"
        ? runtimeResult.retrieval_telemetry.planner_ms
        : undefined,
      embeddingMs: typeof runtimeResult.retrieval_telemetry.embedding_ms === "number"
        ? runtimeResult.retrieval_telemetry.embedding_ms
        : undefined,
      retrievalMs: typeof runtimeResult.retrieval_telemetry.retrieval_ms === "number"
        ? runtimeResult.retrieval_telemetry.retrieval_ms
        : undefined,
      packetMs: typeof runtimeResult.retrieval_telemetry.packet_ms === "number"
        ? runtimeResult.retrieval_telemetry.packet_ms
        : undefined,
      runtimeCoreMs: typeof runtimeResult.retrieval_telemetry.runtime_core_ms === "number"
        ? runtimeResult.retrieval_telemetry.runtime_core_ms
        : undefined,
      runtimeBundlePersistMs: typeof runtimeResult.retrieval_telemetry.runtime_bundle_persist_ms === "number"
        ? runtimeResult.retrieval_telemetry.runtime_bundle_persist_ms
        : undefined,
      coverageGapPersistMs: typeof runtimeResult.retrieval_telemetry.coverage_gap_persist_ms === "number"
        ? runtimeResult.retrieval_telemetry.coverage_gap_persist_ms
        : undefined,
      totalGatewayTurnMs: typeof runtimeResult.retrieval_telemetry.total_gateway_turn_ms === "number"
        ? runtimeResult.retrieval_telemetry.total_gateway_turn_ms
        : undefined,
      traceFile: session.realtimeLogPath || ensureSessionRealtimeLogPath(session),
      plannerRequestBytes: runtimeResult.retrieval_telemetry.planner_request_payload
        ? estimatePayloadBytes(runtimeResult.retrieval_telemetry.planner_request_payload)
        : undefined,
      plannerResponseBytes: runtimeResult.retrieval_telemetry.planner_response_payload
        ? estimatePayloadBytes(runtimeResult.retrieval_telemetry.planner_response_payload)
        : undefined,
      embeddingRequestBytes: runtimeResult.retrieval_telemetry.embedding_request_payload
        ? estimatePayloadBytes(runtimeResult.retrieval_telemetry.embedding_request_payload)
        : undefined,
      embeddingResponseBytes: Array.isArray(runtimeResult.retrieval_telemetry.embedding_response_payloads)
        ? estimatePayloadBytes(runtimeResult.retrieval_telemetry.embedding_response_payloads)
        : undefined
    });
    const appToolResultForwardStartedAtMs = performance.now();
    const appToolResultForwardOutcome = await forwardToolResult(
      session.callSid,
      session.tenantKey,
      name,
      {
        query,
        answer_packet: runtimeResult.answer_packet,
        runtime_bundle: runtimeResult.runtime_bundle,
        matched_overrides: runtimeResult.matched_overrides,
        matched_guardrails: runtimeResult.matched_guardrails,
        call_state: runtimeResult.call_state,
        retrieval_telemetry: runtimeResult.retrieval_telemetry
      },
      { status: "accepted", errors: [] }
    );
    const appToolResultForwardCompletedAtMs = performance.now();
    const toolResultEvent = createFunctionCallOutputEvent(callId, toolOutput);
    const xaiSocketOpenAtResultDispatch = sendXAiEvent(session.XAiWs, toolResultEvent);
    const resultDispatchAtMs = performance.now();
    logInfo("knowledge_lookup_timing", {
      callSid: session.callSid,
      callId,
      ...buildKnowledgeLookupTimingDetails({
        sourceType: timing.sourceType,
        speechStoppedAtMs: timing.speechStoppedAtMs,
        toolCallReadyAtMs: timing.toolCallReadyAtMs,
        executionStartedAtMs,
        runtimeCompletedAtMs,
        callStatePersistStartedAtMs,
        callStatePersistCompletedAtMs,
        appToolResultForwardStartedAtMs,
        appToolResultForwardCompletedAtMs,
        appToolResultForwardOutcome,
        resultDispatchAtMs,
        xaiSocketOpenAtResultDispatch,
        retrieval: runtimeResult.retrieval_telemetry
      })
    });
    logRealtimeToolPayloads(session, {
      callSid: session.callSid,
      tool: name,
      callId,
      toolResultEvent
    });
    requestAssistantResponse(
      session,
      "tool_result",
      {},
      normalizeToolExecutionKey(name, callId),
      createToolResponseMetadata(name, callId, toolResultEvent)
    );
    return;
  }

  if (name === "lookup_transfer_target") {
    const query = String((args as any).query || "").trim();
    const lookupResult = await lookupTransferTarget(session.tenantKey, query);
    notePendingTransferLookup(session, lookupResult);
    await forwardToolResult(
      session.callSid,
      session.tenantKey,
      name,
      lookupResult,
      { status: "accepted", errors: [] }
    );
    const toolResultEvent = createFunctionCallOutputEvent(callId, lookupResult);
    sendXAiEvent(session.XAiWs, toolResultEvent);
    logRealtimeToolPayloads(session, {
      callSid: session.callSid,
      tool: name,
      callId,
      toolResultEvent
    });
    requestAssistantResponse(
      session,
      "tool_result",
      {},
      normalizeToolExecutionKey(name, callId),
      createToolResponseMetadata(name, callId, toolResultEvent)
    );
    return;
  }

  if (name === "data_capture") {
    const captureControl = session.dataCaptureControl || createDataCaptureControlState();
    session.dataCaptureControl = captureControl;
    const fingerprint = fingerprintDataCaptureArgs(args);
    const completed = getCompletedDataCapture(captureControl, fingerprint);
    const schema = session.promptPayload?.field_schema || {};
    let validation: DataCaptureValidation = completed || validateAgainstSchema(schema, args);
    if (!completed) {
      if (validation.status === "accepted" && session.promptPayload) {
        const nextState = applyCapturedFieldsToCallState(
          session.knowledgeCallState || session.promptPayload.knowledge_runtime.initial_call_state,
          args
        );
        session.knowledgeCallState = nextState;
        await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, nextState, {
          source: "data_capture"
        });
      }
      const forwardOutcome = await forwardToolResult(
        session.callSid,
        session.tenantKey,
        name,
        args,
        validation
      );
      if (validation.status === "accepted" && forwardOutcome !== "succeeded") {
        validation = {
          status: "invalid",
          errors: ["capture_persistence_failed"]
        };
      }
      if (validation.status === "accepted") {
        recordCompletedDataCapture(captureControl, fingerprint, validation);
      }
    } else {
      logInfo("data_capture_duplicate_suppressed", {
        callSid: session.callSid,
        callId,
        callerTurnSequence: timing.callerTurnSequence
      });
    }
    const toolOutput = completed
      ? {
          ...validation,
          duplicate: true,
          instruction: "These exact values are already recorded. Do not call data_capture again unless the caller provides a correction or a new value. Continue from the caller's latest turn."
        }
      : validation;
    const toolResultEvent = createFunctionCallOutputEvent(callId, toolOutput);
    sendXAiEvent(session.XAiWs, toolResultEvent);
    logRealtimeToolPayloads(session, {
      callSid: session.callSid,
      tool: name,
      callId,
      toolResultEvent
    });
    const callerTurnSequence = timing.callerTurnSequence;
    if (!claimDataCaptureContinuation(captureControl, callerTurnSequence)) {
      logInfo("data_capture_response_suppressed", {
        callSid: session.callSid,
        callId,
        callerTurnSequence,
        duplicate: Boolean(completed)
      });
      return;
    }
    requestAssistantResponse(
      session,
      "data_capture_result",
      completed
        ? {
            instructions: "The identical data capture already succeeded. Do not call data_capture again unless the caller corrects or adds a value. Continue naturally from the caller's latest turn."
          }
        : {},
      `data_capture:turn:${callerTurnSequence}`,
      createToolResponseMetadata(name, callId, toolResultEvent)
    );
    return;
  }

  if (name === "transfer_call") {
    const requestedTargetId = String((args as any).target_id || "").trim();
    const target = await loadTransferTargetById(session.tenantKey, requestedTargetId);
    const pendingCandidate = session.pendingTransferCandidate;

    if (session.transferState?.status === "pending") {
      const output = {
        status: "failed",
        reason: "transfer_already_in_progress"
      };
      await forwardToolResult(session.callSid, session.tenantKey, name, output, { status: "accepted", errors: [] });
      const toolResultEvent = createFunctionCallOutputEvent(callId, output);
      sendXAiEvent(session.XAiWs, toolResultEvent);
      logRealtimeToolPayloads(session, {
        callSid: session.callSid,
        tool: name,
        callId,
        toolResultEvent
      });
      requestAssistantResponse(
        session,
        "tool_result",
        {},
        normalizeToolExecutionKey(name, callId),
        createToolResponseMetadata(name, callId, toolResultEvent)
      );
      return;
    }

    if (!pendingCandidate || pendingCandidate.targetId !== requestedTargetId || !pendingCandidate.confirmed) {
      const confirmationOutput = {
        status: "failed",
        reason: "confirmation_required",
        target_id: requestedTargetId
      };
      await forwardToolResult(session.callSid, session.tenantKey, name, confirmationOutput, { status: "accepted", errors: [] });
      const toolResultEvent = createFunctionCallOutputEvent(callId, confirmationOutput);
      sendXAiEvent(session.XAiWs, toolResultEvent);
      logRealtimeToolPayloads(session, {
        callSid: session.callSid,
        tool: name,
        callId,
        toolResultEvent
      });
      requestAssistantResponse(
        session,
        "transfer_confirmation_required",
        {
          instructions: pendingCandidate && pendingCandidate.targetId === requestedTargetId
            ? `You have identified ${pendingCandidate.targetName}${pendingCandidate.targetExtension ? ` at extension ${pendingCandidate.targetExtension}` : ""}, but the caller has not explicitly confirmed the transfer yet. Ask one short confirmation question such as whether they want to be transferred now.`
            : "Before transferring, ask one short confirmation question to make sure the caller wants to be transferred now."
        },
        normalizeToolExecutionKey(name, `${callId}:confirmation_required`),
        createToolResponseMetadata(name, callId, toolResultEvent)
      );
      return;
    }

    if (!target) {
      const output = {
        status: "failed",
        reason: "transfer_target_unavailable"
      };
      await forwardToolResult(session.callSid, session.tenantKey, name, output, { status: "accepted", errors: [] });
      const toolResultEvent = createFunctionCallOutputEvent(callId, output);
      sendXAiEvent(session.XAiWs, toolResultEvent);
      logRealtimeToolPayloads(session, {
        callSid: session.callSid,
        tool: name,
        callId,
        toolResultEvent
      });
      requestAssistantResponse(
        session,
        "tool_result",
        {},
        normalizeToolExecutionKey(name, callId),
        createToolResponseMetadata(name, callId, toolResultEvent)
      );
      return;
    }

    const commandId = `everycall_transfer_${crypto.randomUUID()}`;
    session.transferState = {
      status: "pending",
      targetId: requestedTargetId,
      targetName: target.name,
      targetExtension: target.transfer_extension || null,
      commandId,
      requestedAt: new Date().toISOString(),
      targetCallControlId: null,
      targetCallSessionId: null
    };

    try {
      await telnyxCallAction(session.callControlId, "transfer", {
        to: target.forward_to_number,
        timeout_secs: 25,
        command_id: commandId,
        target_leg_client_state: encodeTransferLegClientState({
          everycall: "transfer_leg_v1",
          source_call_control_id: session.callControlId,
          source_call_sid: session.callSid,
          tenant_key: session.tenantKey,
          target_id: requestedTargetId
        })
      });
      session.pendingTransferCandidate = null;
      await persistTransferCallState(session, target);
      await detachAiForTransferredCall(session, "transfer_command_accepted");
      const output = {
        status: "accepted",
        target_id: requestedTargetId,
        target_name: target.name,
        target_extension: target.transfer_extension || null
      };
      await forwardToolResult(session.callSid, session.tenantKey, name, output, { status: "accepted", errors: [] });
      const toolResultEvent = createFunctionCallOutputEvent(callId, output);
      sendXAiEvent(session.XAiWs, toolResultEvent);
      logRealtimeToolPayloads(session, {
        callSid: session.callSid,
        tool: name,
        callId,
        toolResultEvent
      });
      return;
    } catch (err) {
      session.transferState = null;
      const output = {
        status: "failed",
        reason: "transfer_command_failed"
      };
      logError("call_transfer_command_failed", {
        callSid: session.callSid,
        callControlId: session.callControlId,
        targetId: requestedTargetId,
        targetName: target.name,
        targetExtension: target.transfer_extension || undefined,
        message: err instanceof Error ? err.message : "unknown"
      });
      await forwardToolResult(session.callSid, session.tenantKey, name, output, { status: "accepted", errors: [] });
      const toolResultEvent = createFunctionCallOutputEvent(callId, output);
      sendXAiEvent(session.XAiWs, toolResultEvent);
      logRealtimeToolPayloads(session, {
        callSid: session.callSid,
        tool: name,
        callId,
        toolResultEvent
      });
      requestAssistantResponse(
        session,
        "tool_result",
        {},
        normalizeToolExecutionKey(name, callId),
        createToolResponseMetadata(name, callId, toolResultEvent)
      );
      return;
    }
  }

  if (name === "finish_session") {
    const finishSessionArgs = args as FinishSessionArgs;
    const reason = String(finishSessionArgs.reason || "assistant_completed_call");
    const runtimeProfile = session.promptPayload?.knowledge_runtime?.approved_configuration?.runtime_profile;
    const finishPolicy = evaluateFinishSessionPolicy({
      requireSpokenClose: runtimeProfile?.tool_policy?.allow_finish_session_only_after_spoken_close !== false,
      lastAssistantTranscript: session.lastAssistantTranscript ?? null,
      configuredClosingPhrase: String(
        session.promptPayload?.knowledge_runtime?.tenant_prompt_profile?.closing_phrase
        || runtimeProfile?.wording_defaults?.closing_phrase
        || ""
      )
    });
    if (!finishPolicy.allowed) {
      logInfo("assistant_finish_session_rejected", {
        callSid: session.callSid,
        callId,
        reason: finishPolicy.reason
      });
      const rejection = {
        status: "rejected",
        reason: finishPolicy.reason,
        instruction: "The call remains active. Continue naturally, and finish only after the caller is clearly done and you have spoken the configured closing."
      };
      await forwardToolResult(
        session.callSid,
        session.tenantKey,
        name,
        rejection,
        { status: "rejected", errors: [finishPolicy.reason] }
      );
      const toolResultEvent = createFunctionCallOutputEvent(callId, rejection);
      sendXAiEvent(session.XAiWs, toolResultEvent);
      logRealtimeToolPayloads(session, {
        callSid: session.callSid,
        tool: name,
        callId,
        toolResultEvent
      });
      requestAssistantResponse(
        session,
        "tool_result",
        {},
        normalizeToolExecutionKey(name, callId),
        createToolResponseMetadata(name, callId, toolResultEvent)
      );
      return;
    }
    logInfo("assistant_finish_session_requested", {
      callSid: session.callSid,
      callId,
      reason
    });
    await forwardToolResult(session.callSid, session.tenantKey, name, { reason }, { status: "accepted", errors: [] });
    const toolResultEvent = createFunctionCallOutputEvent(callId, { status: "accepted", reason });
    sendXAiEvent(session.XAiWs, toolResultEvent);
    logRealtimeToolPayloads(session, {
      callSid: session.callSid,
      tool: name,
      callId,
      toolResultEvent
    });

    session.finishSessionAccepted = true;
    const discardedResponses = discardQueuedAssistantResponses(session);
    if (discardedResponses.length > 0) {
      logInfo("xai_realtime_queued_responses_discarded", {
        callSid: session.callSid,
        reason: "finish_session_accepted",
        discardedCount: discardedResponses.length,
        discardedToolResponseCount: discardedResponses.filter((entry) => entry.toolResponse).length
      });
    }

    const queuedFrames = session.outputQueue?.length || 0;
    const drainMs = Math.min(Math.max(queuedFrames * 20 + 1200, 1200), 4000);
    if (session.hangupTimer) {
      clearTimeout(session.hangupTimer);
    }
    session.hangupTimer = setTimeout(() => {
      void endCallSession(session, "assistant_finish_session", true);
    }, drainMs);
    return;
  }

  await forwardToolResult(session.callSid, session.tenantKey, name, args, { status: "accepted", errors: [] });
  const toolResultEvent = createFunctionCallOutputEvent(callId, { status: "accepted" });
  sendXAiEvent(session.XAiWs, toolResultEvent);
  logRealtimeToolPayloads(session, {
    callSid: session.callSid,
    tool: name,
    callId,
    toolResultEvent
  });
  requestAssistantResponse(
    session,
    "tool_result",
    {},
    normalizeToolExecutionKey(name, callId),
    createToolResponseMetadata(name, callId, toolResultEvent)
  );
}

async function handleToolCallEvent(
  session: StreamSession,
  name: string,
  callId: string,
  argsText: string,
  sourceType: string
) {
  const timing: ToolCallTimingContext = {
    sourceType,
    speechStoppedAtMs: session.callerTurnTiming?.speechStoppedAtMs ?? null,
    toolCallReadyAtMs: performance.now(),
    callerTurnSequence: session.callerTurnSequence || 0
  };
  const attempt = beginToolExecution(session, name, callId);
  if (!attempt.shouldExecute) {
    logInfo("xai_realtime_tool_event_deduped", {
      callSid: session.callSid,
      tool: name,
      callId,
      sourceType,
      reason: attempt.reason
    });
    return;
  }

  try {
    await executeToolCall(session, name, callId, argsText, timing);
    completeToolExecution(session, attempt.key);
  } catch (err) {
    failToolExecution(session, attempt.key);
    throw err;
  }
}

function queueToolCallEvent(
  session: StreamSession,
  name: string,
  callId: string,
  argsText: string,
  sourceType: string
) {
  const previous = session.toolExecutionTail || Promise.resolve();
  const execution = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await handleToolCallEvent(session, name, callId, argsText, sourceType);
      } catch (err) {
        logError("xai_realtime_tool_execution_failed", {
          callSid: session.callSid,
          tool: name,
          callId,
          sourceType,
          message: err instanceof Error ? err.message : "unknown"
        });
      }
    });
  session.toolExecutionTail = execution;
  return execution;
}

function connectXAiRealtime(session: StreamSession) {
  if (!XAiKey) {
    logError("xai_realtime_missing_key", { callSid: session.callSid });
    void notifyGatewayError(session.callSid, session.tenantKey, "xai_realtime_missing_key", "XAI_API_KEY is missing");
    void endCallSession(session, "xai_key_missing", true);
    return;
  }
  const payload = session.promptPayload;
  if (!payload) {
    logError("xai_realtime_missing_prompt_payload", { callSid: session.callSid });
    void notifyGatewayError(
      session.callSid,
      session.tenantKey,
      "xai_realtime_missing_prompt_payload",
      "Prompt payload was not present when realtime connection was attempted"
    );
    void endCallSession(session, "prompt_payload_missing", true);
    return;
  }

  session.XAiReady = false;
  const model = XAI_REALTIME_MODEL;
  const voice = String(payload.session_config.voice || XAI_REALTIME_VOICE).trim() || XAI_REALTIME_VOICE;
  const instructions = buildSessionInstructions(payload);
  const url = `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`;
  const ws = new WebSocket(url, {
    headers: buildXAiRealtimeHeaders(XAiKey)
  });
  session.XAiWs = ws;

  ws.on("open", () => {
    session.XAiReady = true;
    logInfo("xai_realtime_session_start", {
      callSid: session.callSid,
      model,
      voice,
      turnDetectionType: "server_vad",
      inputAudioFormat: payload.session_config.input_audio_format || "g711_ulaw",
      outputAudioFormat: payload.session_config.output_audio_format || "g711_ulaw"
    });

    const sessionUpdate = buildRealtimeSessionUpdateEvent({
      instructions,
      tools: payload.tool_definitions,
      sessionConfig: {
        ...payload.session_config,
        voice
      }
    });

    logRealtimeEntry(session, {
      ts: new Date().toISOString(),
      kind: "outbound",
      callSid: session.callSid,
      type: "session.update",
      instructions,
      tools: payload.tool_definitions,
      payload: sessionUpdate
    });

    sendXAiEvent(ws, sessionUpdate);
  });

  ws.on("message", async (data) => {
    let payloadMsg: any = {};
    try {
      payloadMsg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const type = payloadMsg.type || "";
    logRealtimeRaw(session, payloadMsg);
    logRealtimeTrace(session, payloadMsg);

    if (type === "session.updated") {
      session.realtimeModel = payloadMsg?.session?.model || model;
      session.XAiSessionUpdated = true;
      const acceptedInputAudioFormat = payloadMsg?.session?.audio?.input?.format?.type;
      const acceptedOutputAudioFormat = payloadMsg?.session?.audio?.output?.format?.type;
      logInfo("xai_realtime_session_updated", {
        callSid: session.callSid,
        model: session.realtimeModel,
        voice: payloadMsg?.session?.voice,
        reasoningEffort: payloadMsg?.session?.reasoning?.effort,
        turnDetection: payloadMsg?.session?.turn_detection,
        inputAudioFormat: acceptedInputAudioFormat,
        outputAudioFormat: acceptedOutputAudioFormat
      });
      if (session.pendingReconnectAssistantResponse) {
        const pendingResponse = session.pendingReconnectAssistantResponse;
        session.pendingReconnectAssistantResponse = null;
        requestAssistantResponse(
          session,
          pendingResponse.reason,
          pendingResponse.response,
          pendingResponse.dedupeKey
        );
      }
      if (!session.greetingSent) {
        const greetingEvent = buildRealtimeForceMessageEvent(payload.tenant_greeting, {
          interruptible: true
        });
        session.greetingSent = true;
        logInfo("xai_realtime_greeting_requested", {
          callSid: session.callSid,
          callControlId: session.callControlId,
          mode: "force_message",
          interruptible: true
        });
        logRealtimeEntry(session, {
          ts: new Date().toISOString(),
          kind: "outbound",
          callSid: session.callSid,
          type: "conversation.item.create",
          purpose: "tenant_greeting",
          payload: greetingEvent
        });
        sendXAiEvent(ws, greetingEvent);
      }
      return;
    }

    if (type === "error") {
      logError("xai_realtime_server_error", {
        callSid: session.callSid,
        errorType: payloadMsg?.error?.type,
        errorCode: payloadMsg?.error?.code,
        errorParam: payloadMsg?.error?.param,
        eventId: payloadMsg?.error?.event_id || payloadMsg?.event_id,
        message: payloadMsg?.error?.message || "unknown"
      });
      return;
    }

    if (type === "response.created") {
      const responseId = payloadMsg?.response?.id || payloadMsg?.response_id || null;
      const responseCreatedAtMs = performance.now();
      const turnCreated = noteRealtimeTurnResponseCreated(
        session.callerTurnTiming,
        responseId,
        responseCreatedAtMs
      );
      if (turnCreated) {
        logRealtimeDetailEntry(session, {
          ts: new Date().toISOString(),
          kind: "turn_response_created",
          callSid: session.callSid,
          responseId,
          ...turnCreated
        });
      }
      ensureAudioPumpTrace(session, payloadMsg?.response?.id || payloadMsg?.response_id || null);
      const timingState = session.toolResponseTiming || createToolResponseTimingState();
      session.toolResponseTiming = timingState;
      const toolWait = matchAssistantResponseCreated(
        timingState,
        responseId,
        responseCreatedAtMs
      );
      if (toolWait) {
        const waitMs = Number((responseCreatedAtMs - toolWait.requestedAtMs).toFixed(3));
        logInfo("xai_realtime_tool_response_created", {
          callSid: session.callSid,
          tool: toolWait.tool,
          callId: toolWait.callId,
          responseId: toolWait.responseId || undefined,
          waitMs
        });
        logRealtimeDetailEntry(session, {
          ts: new Date().toISOString(),
          kind: "tool_response_created",
          callSid: session.callSid,
          tool: toolWait.tool,
          callId: toolWait.callId,
          responseId: toolWait.responseId,
          waitMs,
          payload: payloadMsg
        });
      }
      markAssistantResponseCreated(session, payloadMsg?.response?.id || payloadMsg?.response_id || null);
      noteAssistantResponseCreated(session, payloadMsg?.response?.id || payloadMsg?.response_id || null);
      logInfo("xai_realtime_response_created", {
        callSid: session.callSid,
        responseId: payloadMsg?.response?.id || payloadMsg?.response_id
      });
      return;
    }

    if (type === "response.done") {
      const responseDoneAtMs = performance.now();
      const responseId = payloadMsg?.response?.id || payloadMsg?.response_id || null;
      const audioTrace = ensureAudioPumpTrace(session, responseId);
      audioTrace.responseDoneAtMs = responseDoneAtMs;
      const queuedFramesAtDone = session.outputQueue?.length || 0;
      const bufferedBytesAtDone = session.outputBuffer?.length || 0;
      const pendingPlaybackMs = calculatePendingPlaybackMs(
        queuedFramesAtDone,
        bufferedBytesAtDone
      );
      const outputPrimedAtDone = Boolean(session.outputPrimed);
      const outputTimerActiveAtDone = Boolean(session.outputTimer);
      const underrunOpenAtDone = audioTrace.underrunStartAtMs !== null;
      markAssistantResponseFinished(session);
      noteAssistantResponseCompleted(session);
      const statusDetails = payloadMsg?.response?.status_details || payloadMsg?.status_details;
      const usage = collectUsage(payloadMsg);
      const totals = session.usageTotals || emptyUsageTotals();
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
      totals.cachedInputTokens += usage.cachedInputTokens;
      totals.cachedInputTextTokens += usage.cachedInputTextTokens;
      totals.cachedInputAudioTokens += usage.cachedInputAudioTokens;
      totals.inputTextTokens += usage.inputTextTokens;
      totals.inputAudioTokens += usage.inputAudioTokens;
      totals.outputTextTokens += usage.outputTextTokens;
      totals.outputAudioTokens += usage.outputAudioTokens;
      totals.responseCount += 1;
      totals.estimatedCostMicrosUsd += estimateUsageCostMicrosUsd(usage);
      session.usageTotals = totals;
      void persistCallUsage(session);
      logInfo("xai_realtime_response_done", {
        callSid: session.callSid,
        responseId: responseId || undefined,
        status: payloadMsg?.response?.status || payloadMsg?.status,
        statusDetailsType: statusDetails?.type,
        statusDetailsReason: statusDetails?.reason,
        errorType: statusDetails?.error?.type,
        errorCode: statusDetails?.error?.code,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostMicrosUsd: estimateUsageCostMicrosUsd(usage),
        audioReceived: audioTrace.chunksQueued > 0,
        audioChunksReceived: audioTrace.chunksQueued,
        audioBytesReceived: audioTrace.chunkBytes,
        queuedFramesAtDone,
        bufferedBytesAtDone,
        pendingPlaybackMs,
        outputPrimedAtDone,
        outputTimerActiveAtDone,
        underrunOpenAtDone
      });
      logAudioPumpTraceSummary(session, "response_done");
      const completedToolWait = finishToolResponse(
        session.toolResponseTiming || createToolResponseTimingState(),
        responseId
      );
      if (completedToolWait) {
        logRealtimeDetailEntry(session, {
          ts: new Date().toISOString(),
          kind: "tool_response_done",
          callSid: session.callSid,
          tool: completedToolWait.tool,
          callId: completedToolWait.callId,
          responseId,
          payload: payloadMsg
        });
      }
      if (!hasPendingAssistantAudio(session)) {
        session.audioPumpTrace = null;
        flushQueuedAssistantResponses(session);
      }
      return;
    }

    if (type === "response.output_item.added") {
      const item = payloadMsg.item || payloadMsg.output_item || {};
      const itemType = String(item?.type || "");
      if (itemType === "message" || itemType === "assistant_message") {
        noteAssistantOutputItem(session, item?.id || payloadMsg.item_id || null);
      }
      return;
    }

    if (type === "response.output_audio.done" || type === "response.audio.done") {
      noteAssistantResponseCompleted(session);
      return;
    }

    if (type === "response.output_audio.delta" || type === "response.audio.delta" || type === "output_audio.delta") {
      const audioBase64 = payloadMsg.delta || payloadMsg.audio?.delta || payloadMsg.audio?.data || payloadMsg.data || "";
      if (audioBase64) {
        const turnLatency = finishRealtimeTurnTiming(session.callerTurnTiming, performance.now());
        if (turnLatency) {
          logInfo("xai_realtime_turn_latency", {
            callSid: session.callSid,
            responseId: payloadMsg?.response_id || payloadMsg?.response?.id || turnLatency.response_id || undefined,
            endpointToResponseCreatedMs: turnLatency.endpoint_to_response_created_ms ?? undefined,
            responseCreatedToFirstAudioMs: turnLatency.response_created_to_first_audio_ms ?? undefined,
            endpointToFirstAudioMs: turnLatency.endpoint_to_first_audio_ms
          });
          logRealtimeDetailEntry(session, {
            ts: new Date().toISOString(),
            kind: "turn_first_audio",
            callSid: session.callSid,
            ...turnLatency
          });
          session.callerTurnTiming = null;
        }
        const audioResponseId = payloadMsg?.response_id || payloadMsg?.response?.id || null;
        const firstAudio = matchToolResponseFirstAudio(
          session.toolResponseTiming || createToolResponseTimingState(),
          audioResponseId,
          performance.now()
        );
        if (firstAudio) {
          const waitMs = Number(firstAudio.waitMs.toFixed(3));
          const responseCreatedToFirstAudioMs = firstAudio.responseCreatedToFirstAudioMs === null
            ? undefined
            : Number(firstAudio.responseCreatedToFirstAudioMs.toFixed(3));
          logInfo("xai_realtime_tool_response_first_audio", {
            callSid: session.callSid,
            tool: firstAudio.wait.tool,
            callId: firstAudio.wait.callId,
            responseId: audioResponseId,
            waitMs,
            responseCreatedToFirstAudioMs
          });
          logRealtimeDetailEntry(session, {
            ts: new Date().toISOString(),
            kind: "tool_response_first_audio",
            callSid: session.callSid,
            tool: firstAudio.wait.tool,
            callId: firstAudio.wait.callId,
            responseId: audioResponseId,
            waitMs,
            responseCreatedToFirstAudioMs
          });
        }
        noteAssistantResponseCreated(session, payloadMsg?.response_id || payloadMsg?.response?.id || null);
        noteAssistantOutputItem(session, payloadMsg?.item_id || payloadMsg?.item?.id || payloadMsg?.output_item?.id || null);
        enqueueOutputPcm(session, Buffer.from(audioBase64, "base64"));
      }
      return;
    }

    if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
      const transcript = payloadMsg.transcript || payloadMsg.text || payloadMsg.data || "";
      if (transcript) {
        session.lastAssistantTranscript = String(transcript);
      }
      if (transcript && pool) {
        await pool.query(
          `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
           VALUES ($1, $2, $3, $4, 'message')`,
          [session.callSid, session.tenantKey, "assistant", String(transcript)]
        );
      }
      return;
    }

    if (
      type === "conversation.item.input_audio_transcription.updated"
      || type === "conversation.item.input_audio_transcription.completed"
      || type === "input_audio_transcription.updated"
      || type === "input_audio_transcription.completed"
    ) {
      const transcript = payloadMsg.transcript || payloadMsg.text || "";
      if (transcript && pool) {
        if (type.endsWith(".completed")) {
          noteCallerTransferConfirmation(session, String(transcript));
        }
        await persistCallerTranscriptSnapshot(session, String(transcript));
      }
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      session.callerTurnTiming = startRealtimeTurnTiming(performance.now());
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      logCallerTranscriptTurnSummary(session, "next_speech_started");
      session.callerTranscriptTurn = createCallerTranscriptTurnState();
      session.callerTurnSequence = (session.callerTurnSequence || 0) + 1;
      session.lastAssistantTranscript = null;
      if (session.transferState?.status === "pending" || session.aiDetached) {
        logInfo("assistant_barge_in_decision", {
          callSid: session.callSid,
          callControlId: session.callControlId,
          reason: "caller_speech_detected_realtime",
          decision: "transfer_ignored",
          clearSent: false,
          assistantPending: hasPendingAssistantAudio(session),
          responseId: session.currentResponseId || undefined,
          queuedFrames: session.outputQueue?.length || 0,
          bufferedBytes: session.outputBuffer?.length || 0,
          outputPrimed: Boolean(session.outputPrimed),
          assistantAudioMsSent: Math.max(0, Number(session.assistantAudioMsSent || 0))
        });
        return;
      }
      await interruptAssistantForCallerSpeech(session, "caller_speech_detected_realtime");
      return;
    }

    if (type === "response.function_call_arguments.delta") {
      const name = payloadMsg.name || payloadMsg?.function_call?.name || "";
      const callId = payloadMsg.call_id || payloadMsg?.function_call?.call_id || payloadMsg?.response_id || "";
      const delta = payloadMsg.delta || payloadMsg?.arguments_delta || "";
      if (!name || !callId) return;
      if (!session.pendingToolCall || session.pendingToolCall.callId !== callId) {
        session.pendingToolCall = { name, callId, argumentsText: "" };
      }
      session.pendingToolCall.argumentsText += String(delta || "");
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const name = payloadMsg.name || payloadMsg?.function_call?.name || session.pendingToolCall?.name || "";
      const callId = payloadMsg.call_id || payloadMsg?.function_call?.call_id || session.pendingToolCall?.callId || "";
      const argsText = payloadMsg.arguments || session.pendingToolCall?.argumentsText || "";
      if (!name || !callId) return;
      session.pendingToolCall = null;
      await queueToolCallEvent(session, String(name), String(callId), String(argsText || ""), "response.function_call_arguments.done");
      return;
    }

    // Handle newer Realtime format where function calls are emitted in output items.
    if (type === "response.output_item.done") {
      const item = payloadMsg.item || payloadMsg.output_item || {};
      const itemType = String(item?.type || "");
      if (itemType === "function_call") {
        const name = String(item?.name || "");
        const callId = String(item?.call_id || item?.id || "");
        const argsText = String(item?.arguments || "");
        if (!name || !callId) return;
        await queueToolCallEvent(session, name, callId, argsText, "response.output_item.done");
      }
    }
  });

  ws.on("close", () => {
    logInfo("xai_realtime_session_closed", {
      callSid: session.callSid,
      reconnectAttempted: Boolean(session.reconnectAttempted),
      XAiReady: Boolean(session.XAiReady),
      XAiSessionUpdated: Boolean(session.XAiSessionUpdated)
    });

    if (session.isShuttingDown || !session.callActive) return;
    if (session.suppressXAiReconnect || session.aiDetached) return;

    const wasInitialized = Boolean(session.XAiReady && session.XAiSessionUpdated);
    if (!wasInitialized) {
      void notifyGatewayError(
        session.callSid,
        session.tenantKey,
        "xai_realtime_session_init_failed",
        "Realtime session closed before initialization completed"
      );
      void endCallSession(session, "xai_init_failed", true);
      return;
    }

    if (!session.reconnectAttempted) {
      session.reconnectAttempted = true;
      logInfo("xai_realtime_reconnect_attempt", { callSid: session.callSid });
      connectXAiRealtime(session);
      return;
    }

    void notifyGatewayError(
      session.callSid,
      session.tenantKey,
      "xai_realtime_disconnected",
      "Realtime session disconnected and reconnect attempt failed"
    );
    void endCallSession(session, "xai_disconnect_after_retry", true);
  });

  ws.on("error", (err) => {
    logError("xai_realtime_session_error", {
      callSid: session.callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  });
}

app.post("/v1/telnyx/webhooks/voice/inbound", express.raw({ type: "*/*", limit: "256kb" }), async (req, res) => {
  const webhookReceivedAtMs = Date.now();
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  logInfo("telnyx_call_control_request", {
    path: req.path,
    contentLength: req.header("content-length"),
    contentType: req.header("content-type"),
    hasSignature: Boolean(req.header("telnyx-signature-ed25519")),
    hasTimestamp: Boolean(req.header("telnyx-timestamp"))
  });
  if (signatureRequired && !verifyTelnyx(req, rawBody)) {
    logError("telnyx_signature_invalid", {
      path: req.path,
      hasSignature: Boolean(req.header("telnyx-signature-ed25519")),
      hasTimestamp: Boolean(req.header("telnyx-timestamp"))
    });
    return res.status(401).send("invalid_signature");
  }

  let payload: any = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    logError("telnyx_call_control_parse_error", {
      message: err instanceof Error ? err.message : "unknown"
    });
    return res.status(400).send("invalid_json");
  }

  const eventType = payload.data?.event_type || payload.event_type || payload.data?.eventType || "";
  const eventPayload = payload.data?.payload || payload.payload || payload.data || payload;
  const providerEventId = String(payload.data?.id || payload.id || "").trim();
  const transferLegState = parseTransferLegClientState(eventPayload.client_state);

  if (!pool) {
    return res.status(200).send("ok");
  }

  const claim = await claimInboundWebhookEvent(pool, {
    provider: "telnyx_voice_inbound",
    eventId: providerEventId,
    eventType,
    rawPayload: rawBody
  });
  if (claim.duplicate) {
    return res.status(200).send("ok");
  }

  if (eventType === "call_initiated" || eventType === "call.initiated") {
    const callControlId = String(eventPayload.call_control_id || "");
    const callSid = callControlId || String(eventPayload.call_session_id || "unknown");
    const to = normalizePhone(String(eventPayload.to || ""));
    const from = normalizePhone(String(eventPayload.from || ""));

    if (transferLegState) {
      const sourceSession = streamSessions.get(transferLegState.source_call_control_id);
      if (sourceSession?.transferState?.status === "pending" && sourceSession.transferState.targetId === transferLegState.target_id) {
        sourceSession.transferState = {
          ...sourceSession.transferState,
          targetCallControlId: callControlId || null,
          targetCallSessionId: String(eventPayload.call_session_id || "").trim() || null
        };
        logInfo("call_transfer_target_leg_initiated", {
          callSid: sourceSession.callSid,
          callControlId: sourceSession.callControlId,
          targetCallControlId: callControlId,
          targetId: transferLegState.target_id,
          to,
          from
        });
      }
      return res.status(200).send("ok");
    }

    logInfo("telnyx_call_control_initiated", { callSid, callControlId, to, from });

    const tenantRow = await pool.query(
      `SELECT tenant_key, status
       FROM tenants
       WHERE telnyx_voice_number = $1
       LIMIT 1`,
      [to]
    );
    if (!tenantRow.rowCount || tenantRow.rows[0].status !== "active") {
      try {
        if (callControlId) {
          await telnyxCallAction(callControlId, "hangup", {});
        }
      } catch (err) {
        logError("telnyx_call_control_hangup_error", {
          message: err instanceof Error ? err.message : "unknown"
        });
      }
      return res.status(200).send("ok");
    }

    const tenantKey = tenantRow.rows[0].tenant_key;

    await pool.query(
      `INSERT INTO calls (call_sid, tenant_key, from_number, to_number, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       ON CONFLICT (call_sid)
       DO UPDATE SET from_number = EXCLUDED.from_number,
                     to_number = EXCLUDED.to_number`,
      [callSid, tenantKey, from, to]
    );

    logInfo("telnyx_call_control_answer_requested", {
      callSid,
      callControlId,
      webhookToAnswerRequestMs: Date.now() - webhookReceivedAtMs
    });
    const startup = beginInboundCallStartup(
      () => telnyxCallAction(callControlId, "answer", {}),
      () => initializeInboundCallSession({ callControlId, callSid, tenantKey, to, from })
    );
    const trackedBootstrap = startup.bootstrapPromise.catch(async (err) => {
      logError("prompt_payload_fetch_failed", {
        callSid,
        tenantKey,
        message: err instanceof Error ? err.message : "unknown"
      });
      await notifyGatewayError(
        callSid,
        tenantKey,
        "prompt_payload_fetch_failed",
        err instanceof Error ? err.message : "unknown"
      );
      await endCallSession(
        {
          callControlId,
          callSid,
          tenantKey
        },
        "prompt_payload_fetch_failed",
        true
      );
      return undefined;
    });
    inboundSessionBootstraps.set(callControlId, trackedBootstrap);

    try {
      await startup.answerPromise;
      logInfo("telnyx_call_control_answer_accepted", {
        callSid,
        callControlId,
        webhookToAnswerAcceptedMs: Date.now() - webhookReceivedAtMs
      });
    } catch (err) {
      logError("telnyx_call_control_answer_error", {
        callSid,
        message: err instanceof Error ? err.message : "unknown"
      });
    }
    await trackedBootstrap;
    if (inboundSessionBootstraps.get(callControlId) === trackedBootstrap) {
      inboundSessionBootstraps.delete(callControlId);
    }

    return res.status(200).send("ok");
  }

  if (eventType === "call.bridged" || eventType === "call.bridged.v1") {
    if (transferLegState) {
      const sourceSession = streamSessions.get(transferLegState.source_call_control_id);
      if (sourceSession?.transferState?.status === "pending" && sourceSession.transferState.targetId === transferLegState.target_id) {
        await handleTransferConnected(sourceSession, "target_leg_bridged", {
          targetCallControlId: eventPayload.call_control_id,
          targetCallSessionId: eventPayload.call_session_id
        });
      }
      return res.status(200).send("ok");
    }

    const callControlId = String(eventPayload.call_control_id || "");
    const session = streamSessions.get(callControlId);
    if (session?.transferState?.status === "pending") {
      await handleTransferConnected(session, "source_leg_bridged", {
        targetCallControlId: session.transferState.targetCallControlId,
        targetCallSessionId: session.transferState.targetCallSessionId
      });
    }
    return res.status(200).send("ok");
  }

  if (eventType === "call.answered" || eventType === "call_answered") {
    const callControlId = String(eventPayload.call_control_id || "");
    if (!callControlId) return res.status(200).send("ok");

    if (transferLegState) {
      const sourceSession = streamSessions.get(transferLegState.source_call_control_id);
      if (sourceSession?.transferState?.status === "pending" && sourceSession.transferState.targetId === transferLegState.target_id) {
        await handleTransferConnected(sourceSession, "target_leg_answered", {
          targetCallControlId: callControlId,
          targetCallSessionId: eventPayload.call_session_id
        });
      }
      return res.status(200).send("ok");
    }

    const answeredAt = normalizeOptionalText(payload.data?.occurred_at || payload.occurred_at)
      || new Date().toISOString();
    await markCallAnswered(callControlId, answeredAt);

    let session = streamSessions.get(callControlId);
    if (!session) {
      session = await waitForInboundSessionBootstrap(callControlId, "call_answered");
    }
    if (!session) {
      const callSid = callControlId;
      logInfo("call_answered_session_recovery_attempt", { callSid, callControlId });
      try {
        session = await recoverSessionForCallControlId(callControlId, "call_answered_recovery");
        if (session) {
          logInfo("call_answered_session_recovered", { callSid, callControlId, tenantKey: session.tenantKey });
        } else {
          logError("call_answered_session_missing_tenant", { callSid, callControlId });
        }
      } catch (err) {
        logError("call_answered_session_recovery_failed", {
          callSid,
          callControlId,
          message: err instanceof Error ? err.message : "unknown"
        });
      }
    }

    if (session) {
      session.callAnsweredAt = session.callAnsweredAt || answeredAt;
      const streamUrl = `${toWebSocketUrl(callGatewayBaseUrl || buildBaseUrl(req))}/v1/telnyx/stream`;
      session.telnyxStreamBaseUrl = streamUrl;
      try {
        logInfo("telnyx_stream_start_request", {
          callSid: session.callSid,
          callControlId,
          streamUrl,
          bidirectionalPayloadMode: resolveBidirectionalPayloadMode()
        });
        await telnyxCallAction(callControlId, "streaming_start", getTelnyxStreamingStartPayload(streamUrl, callControlId));
        logInfo("telnyx_stream_start_requested", { callSid: session.callSid, callControlId });
      } catch (err) {
        logError("telnyx_call_control_stream_start_error", {
          callSid: session.callSid,
          callControlId,
          streamUrl,
          message: err instanceof Error ? err.message : "unknown"
        });
      }
    } else {
      logError("telnyx_stream_start_skipped_no_session", { callControlId });
    }
    return res.status(200).send("ok");
  }

  if (eventType === "streaming.started" || eventType === "streaming.started.v1") {
    return res.status(200).send("ok");
  }

  if (eventType === "streaming.stopped" || eventType === "streaming.stopped.v1") {
    const callControlId = String(eventPayload.call_control_id || "");
    if (callControlId) {
      const session = streamSessions.get(callControlId);
      if (session) {
        await handleStreamingStoppedForSession(session, "telnyx_streaming_stopped");
      } else {
        await markCallCompleted(callControlId);
      }
    }
    return res.status(200).send("ok");
  }

  if (eventType === "call.hangup" || eventType === "call.hangup.v1") {
    if (transferLegState) {
      const sourceSession = streamSessions.get(transferLegState.source_call_control_id);
      if (sourceSession?.transferState?.status === "pending" && sourceSession.transferState.targetId === transferLegState.target_id) {
        await handleTransferFailed(sourceSession, "target_leg_hangup", {
          targetCallControlId: eventPayload.call_control_id,
          hangupCause: normalizeOptionalText(eventPayload.hangup_cause)
        });
      }
      return res.status(200).send("ok");
    }

    const callControlId = String(eventPayload.call_control_id || "");
    if (callControlId) {
      const session = streamSessions.get(callControlId);
      if (session) {
        await flushFinalAudioAndEnd(session, "telnyx_hangup", false);
      } else {
        await markCallCompleted(callControlId);
      }
    }
    return res.status(200).send("ok");
  }

  return res.status(200).send("ok");
});

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

function handleRealtimeLogDownload(req: express.Request, res: express.Response) {
  if (!realtimeDebug && !realtimeTrace) {
    return res.status(404).json({ error: "not_found" });
  }
  const provided = String(req.header("x-everycall-internal") || "");
  if (!gatewayDebugLogToken || provided !== gatewayDebugLogToken) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const callId = String(req.query?.call_id || "").trim();
  if (!callId) {
    return res.status(400).json({ error: "missing_call_id" });
  }
  const logPath = getRealtimeLogPath(callId);
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: "not_found" });
  }
  res.setHeader("Content-Type", "application/jsonl");
  fs.createReadStream(logPath).pipe(res);
}

app.get("/v1/gateway/debug/realtime-log", handleRealtimeLogDownload);
app.get("/v1/debug/realtime-log", handleRealtimeLogDownload);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/v1/telnyx/stream" });

wss.on("connection", (ws, req) => {
  let presentedStreamToken = "";
  try {
    const url = new URL(req.url || "/v1/telnyx/stream", "http://localhost");
    presentedStreamToken = String(url.searchParams.get("stream_token") || "").trim();
  } catch {
    presentedStreamToken = "";
  }
  ws.on("message", async (message) => {
    let payload: any = {};
    try {
      payload = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (payload.event === "start") {
      const streamId = payload.stream_id;
      const callControlId = payload.start?.call_control_id || payload.call_control_id;
      if (!streamId || !callControlId) return;
      if (!isValidInternalServiceToken(
        presentedStreamToken,
        { INTERNAL_SERVICE_SECRET: internalServiceSecret },
        INTERNAL_AUTH_PURPOSES.telnyxMediaStream,
        String(callControlId)
      )) {
        logError("telnyx_stream_unauthorized", {
          callControlId,
          streamId,
          hasToken: Boolean(presentedStreamToken)
        });
        try {
          ws.close();
        } catch {}
        return;
      }
      let session = streamSessions.get(callControlId);
      if (!session) {
        session = await waitForInboundSessionBootstrap(callControlId, "stream_start");
      }
      if (!session) {
        logInfo("stream_start_session_recovery_attempt", { callControlId, streamId });
        try {
          session = await recoverSessionForCallControlId(callControlId, "stream_start_recovery");
          if (session) {
            logInfo("stream_start_session_recovered", {
              callSid: session.callSid,
              callControlId,
              tenantKey: session.tenantKey,
              streamId
            });
          }
        } catch (err) {
          logError("stream_start_session_recovery_failed", {
            callControlId,
            streamId,
            message: err instanceof Error ? err.message : "unknown"
          });
        }
      }
      if (!session) return;
      session.telnyxWs = ws;
      session.telnyxStreamId = streamId;
      streamIdToCall.set(streamId, callControlId);
      logInfo("telnyx_stream_started", {
        callSid: session.callSid,
        callControlId,
        streamId,
        mediaEncoding: payload.start?.media_format?.encoding,
        mediaSampleRate: payload.start?.media_format?.sample_rate,
        mediaChannels: payload.start?.media_format?.channels
      });
      connectXAiRealtime(session);
      return;
    }

    if (payload.event === "media") {
      const streamId = payload.stream_id;
      const encoded = payload.media?.payload;
      const track = String(payload.media?.track || payload.track || "").toLowerCase();
      if (!streamId || !encoded) return;
      if (!shouldForwardTelnyxInputTrack(track)) return;
      const callControlId = streamIdToCall.get(streamId);
      if (!callControlId) return;
      const session = streamSessions.get(callControlId);
      if (!session?.XAiWs) return;
      if (session.transferState?.status === "pending" || session.aiDetached) return;
      const pcm = decodeInboundAudioPayload(encoded);
      sendXAiEvent(session.XAiWs, {
        type: "input_audio_buffer.append",
        audio: pcm.toString("base64")
      });
      return;
    }

    if (payload.event === "stop") {
      const streamId = payload.stream_id;
      if (!streamId) return;
      const callControlId = streamIdToCall.get(streamId);
      if (!callControlId) return;
      const session = streamSessions.get(callControlId);
      if (session) {
        await handleStreamingStoppedForSession(session, "telnyx_stream_stop");
      } else {
        await markCallCompleted(callControlId);
      }
    }
  });
});

const port = Number(process.env.PORT || 3101);
server.listen(port, () => {
  logBidirectionalPayloadModeNormalization();
  logInfo("call_gateway_started", {
    port,
    bidirectionalPayloadMode: resolveBidirectionalPayloadMode(),
    rtpPayloadType,
    outboundBufferFrames: outboundJitterBufferFrames,
    outboundBufferMs: outboundJitterBufferFrames * outboundAudioFrameMs
  });
  void preloadActiveBuildAssetsOnStartup();
});
