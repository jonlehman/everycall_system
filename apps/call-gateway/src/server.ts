import express from "express";
import http from "node:http";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { readCallGatewayEnv } from "@everycall/config";
import type { CallState } from "@everycall/contracts";
import { estimateAiCostMicrosUsd, estimateBillableMinutes, estimateTelephonyCostMicrosUsd, usdToMicros } from "@everycall/contracts/callCosting";
import { buildTranscriptFromEvents } from "@everycall/contracts/callTranscript";
import { logError, logInfo } from "@everycall/observability";
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
  enqueueAssistantResponseRequest,
  failToolExecution,
  hasActiveAssistantResponse,
  markAssistantResponseCreated,
  markAssistantResponseFinished,
  normalizeToolExecutionKey
} from "./toolResponseControl.js";

const env = readCallGatewayEnv(process.env);
const app = express();
app.set("trust proxy", true);

const databaseUrl = process.env.DATABASE_URL || "";
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const appBaseUrl = process.env.APP_BASE_URL || "";
const callSummaryToken = process.env.CALL_SUMMARY_TOKEN || "";
const callGatewayBaseUrl = process.env.CALL_GATEWAY_BASE_URL || "";
const openAiKey = process.env.OPENAI_API_KEY || "";
const signatureRequired = (process.env.TELNYX_SIGNATURE_REQUIRED || "true").toLowerCase() !== "false";
const telnyxApiKey = process.env.TELNYX_API_KEY || "";
const rtpPayloadType = Number(process.env.TELNYX_RTP_PAYLOAD_TYPE || "0");
const bidirectionalPayloadMode = (process.env.TELNYX_BIDIRECTIONAL_PAYLOAD_MODE || "raw").toLowerCase();
const outboundAudioFrameMs = 20;
const outboundJitterBufferFrames = Math.max(1, Number(process.env.TELNYX_OUTBOUND_BUFFER_FRAMES || "3"));
const realtimeDebug = String(process.env.REALTIME_DEBUG || "false").toLowerCase() === "true";
const realtimeTrace = String(process.env.REALTIME_TRACE || "false").toLowerCase() === "true";
const realtimeLogRoot = String(process.env.REALTIME_LOG_FILE || "/tmp/realtime-logs.jsonl");
const Ajv = (AjvModule as unknown as { default?: new (opts?: Record<string, unknown>) => any }).default || (AjvModule as unknown as new (opts?: Record<string, unknown>) => any);
const ajv = new Ajv({ allErrors: true, strict: false });

const streamIdToCall = new Map<string, string>();

type PendingToolCall = {
  name: string;
  callId: string;
  argumentsText: string;
};

type FinishSessionArgs = {
  reason?: string;
};

type PendingToolSpeechWait = {
  tool: string;
  callId: string;
  requestedAtMs: number;
  responseCreatedAtMs?: number | null;
  responseId?: string | null;
  firstAudioLogged?: boolean;
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

type AudioPumpTrace = {
  responseId: string | null;
  chunksQueued: number;
  framesSent: number;
  underrunCount: number;
  underrunStartAtMs: number | null;
  totalUnderrunMs: number;
  maxUnderrunMs: number;
  timerLateCount: number;
  totalTimerLateMs: number;
  maxTimerLateMs: number;
  catchupBurstCount: number;
  maxBurstFrames: number;
};

type StreamSession = {
  callControlId: string;
  callSid: string;
  tenantKey: string;
  callActive?: boolean;
  isShuttingDown?: boolean;
  telnyxStreamId?: string;
  telnyxWs?: WebSocket;
  openAiWs?: WebSocket;
  openAiReady?: boolean;
  openAiSessionUpdated?: boolean;
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
  queuedAssistantResponses?: Array<{ reason: string; response: Record<string, unknown>; dedupeKey?: string | null }>;
  executingToolCallKeys?: Set<string>;
  completedToolCallKeys?: Set<string>;
  pendingToolSpeechWait?: PendingToolSpeechWait | null;
  audioPumpTrace?: AudioPumpTrace | null;
};

const streamSessions = new Map<string, StreamSession>();

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
    openAiSessionUpdated: false,
    greetingSent: false,
    aiInputRateMicrosUsd: realtimeInputRateMicrosUsd,
    aiOutputRateMicrosUsd: realtimeOutputRateMicrosUsd,
    callAnsweredAt: null,
    usageTotals: emptyUsageTotals(),
    promptPayload,
    knowledgeCallState,
    outputQueue: [],
    outputBuffer: Buffer.alloc(0),
    outputNextFrameAtMs: null,
    outputPrimed: false,
    currentResponseId: null,
    currentAssistantItemId: null,
    assistantAudioActive: false,
    assistantAudioMsSent: 0,
    lastInterruptionAtMs: null,
    lastInterruptionReason: null,
    responseCreatePending: false,
    queuedAssistantResponses: [],
    executingToolCallKeys: new Set<string>(),
    completedToolCallKeys: new Set<string>(),
    pendingToolSpeechWait: null,
    audioPumpTrace: null,
    ...(realtimeLogPath ? { realtimeLogPath } : {})
  };
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

function parseUsdRatePerMillion(value: string | undefined, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const realtimeInputRatePer1MUsd = parseUsdRatePerMillion(process.env.OPENAI_REALTIME_INPUT_RATE_PER_1M_USD, 4);
const realtimeCachedInputRatePer1MUsd = parseUsdRatePerMillion(process.env.OPENAI_REALTIME_CACHED_INPUT_RATE_PER_1M_USD, 0.4);
const realtimeAudioInputRatePer1MUsd = parseUsdRatePerMillion(process.env.OPENAI_REALTIME_AUDIO_INPUT_RATE_PER_1M_USD, 32);
const realtimeOutputRatePer1MUsd = parseUsdRatePerMillion(process.env.OPENAI_REALTIME_OUTPUT_RATE_PER_1M_USD, 16);
const realtimeAudioOutputRatePer1MUsd = parseUsdRatePerMillion(process.env.OPENAI_REALTIME_AUDIO_OUTPUT_RATE_PER_1M_USD, 64);
const realtimeInputRateMicrosUsd = usdToMicros(realtimeInputRatePer1MUsd);
const realtimeOutputRateMicrosUsd = usdToMicros(realtimeOutputRatePer1MUsd);
const telnyxEstimatedInboundRatePerMinuteUsd = parseUsdRatePerMillion(process.env.TELNYX_ESTIMATED_INBOUND_RATE_PER_MINUTE_USD, 0.0055);
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

function estimateUsageCostMicrosUsd(usage: {
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
  return estimateAiCostMicrosUsd({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cachedInputTextTokens: usage.cachedInputTextTokens,
    cachedInputAudioTokens: usage.cachedInputAudioTokens,
    inputTextTokens: usage.inputTextTokens,
    inputAudioTokens: usage.inputAudioTokens,
    outputTextTokens: usage.outputTextTokens,
    outputAudioTokens: usage.outputAudioTokens
  }, {
    textInputRatePer1MUsd: realtimeInputRatePer1MUsd,
    cachedInputRatePer1MUsd: realtimeCachedInputRatePer1MUsd,
    audioInputRatePer1MUsd: realtimeAudioInputRatePer1MUsd,
    textOutputRatePer1MUsd: realtimeOutputRatePer1MUsd,
    audioOutputRatePer1MUsd: realtimeAudioOutputRatePer1MUsd
  });
}

async function persistCallUsage(session: StreamSession) {
  if (!pool) return;
  const usage = session.usageTotals || emptyUsageTotals();
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
        session.aiInputRateMicrosUsd ?? realtimeInputRateMicrosUsd,
        session.aiOutputRateMicrosUsd ?? realtimeOutputRateMicrosUsd,
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

function getTelnyxStreamingStartPayload(baseUrl: string) {
  return {
    stream_url: baseUrl,
    stream_track: "both_tracks",
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
  if (!appBaseUrl || !callSummaryToken) return;
  try {
    const resp = await fetch(`${appBaseUrl}/api/v1/gateway/error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-everycall-internal": callSummaryToken
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

function sendOpenAiEvent(ws: WebSocket | undefined, payload: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function createAudioTextResponseEvent(response: Record<string, unknown> = {}) {
  return {
    type: "response.create",
    response: {
      modalities: ["audio", "text"],
      ...response
    }
  };
}

function buildRealtimeTurnDetectionConfig(turnDetection: Record<string, unknown> | undefined) {
  const type = String(turnDetection?.type || "semantic_vad").trim() || "semantic_vad";
  const createResponse = turnDetection?.create_response === undefined ? true : Boolean(turnDetection.create_response);
  const interruptResponse = turnDetection?.interrupt_response === undefined ? true : Boolean(turnDetection.interrupt_response);
  if (type === "semantic_vad") {
    const eagerness = String(turnDetection?.eagerness || "high").trim() || "high";
    return {
      type: "semantic_vad",
      eagerness,
      create_response: createResponse,
      interrupt_response: interruptResponse
    };
  }
  return {
    type,
    threshold: typeof turnDetection?.threshold === "number" ? turnDetection.threshold : 0.75,
    prefix_padding_ms: typeof turnDetection?.prefix_padding_ms === "number" ? turnDetection.prefix_padding_ms : 300,
    silence_duration_ms: typeof turnDetection?.silence_duration_ms === "number" ? turnDetection.silence_duration_ms : 600,
    idle_timeout_ms: turnDetection?.idle_timeout_ms === undefined ? null : turnDetection.idle_timeout_ms,
    create_response: createResponse,
    interrupt_response: interruptResponse
  };
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

function createAudioPumpTrace(responseId?: string | null): AudioPumpTrace {
  return {
    responseId: responseId || null,
    chunksQueued: 0,
    framesSent: 0,
    underrunCount: 0,
    underrunStartAtMs: null,
    totalUnderrunMs: 0,
    maxUnderrunMs: 0,
    timerLateCount: 0,
    totalTimerLateMs: 0,
    maxTimerLateMs: 0,
    catchupBurstCount: 0,
    maxBurstFrames: 0
  };
}

function ensureAudioPumpTrace(session: StreamSession, responseId?: string | null) {
  const normalizedResponseId = String(responseId || session.currentResponseId || "").trim() || null;
  if (!session.audioPumpTrace || session.audioPumpTrace.responseId !== normalizedResponseId) {
    session.audioPumpTrace = createAudioPumpTrace(normalizedResponseId);
  }
  return session.audioPumpTrace;
}

function closeAudioUnderrun(trace: AudioPumpTrace | null | undefined, nowMs: number) {
  if (!trace || trace.underrunStartAtMs === null) return;
  const durationMs = Math.max(0, nowMs - trace.underrunStartAtMs);
  trace.totalUnderrunMs += durationMs;
  trace.maxUnderrunMs = Math.max(trace.maxUnderrunMs, durationMs);
  trace.underrunStartAtMs = null;
}

function logAudioPumpTraceSummary(
  session: StreamSession,
  stage: "response_done" | "playback_drained" | "interrupted"
) {
  const trace = session.audioPumpTrace;
  if (!trace) return;
  closeAudioUnderrun(trace, performance.now());
  if (trace.chunksQueued === 0 && trace.framesSent === 0) {
    if (stage === "playback_drained" || stage === "interrupted") {
      session.audioPumpTrace = null;
    }
    return;
  }
  const payload = {
    callSid: session.callSid,
    stage,
    responseId: trace.responseId || undefined,
    chunksQueued: trace.chunksQueued,
    framesSent: trace.framesSent,
    underrunCount: trace.underrunCount,
    totalUnderrunMs: Number(trace.totalUnderrunMs.toFixed(3)),
    maxUnderrunMs: Number(trace.maxUnderrunMs.toFixed(3)),
    timerLateCount: trace.timerLateCount,
    totalTimerLateMs: Number(trace.totalTimerLateMs.toFixed(3)),
    maxTimerLateMs: Number(trace.maxTimerLateMs.toFixed(3)),
    catchupBurstCount: trace.catchupBurstCount,
    maxBurstFrames: trace.maxBurstFrames,
    queuedFramesRemaining: session.outputQueue?.length || 0,
    bufferedBytesRemaining: session.outputBuffer?.length || 0
  };
  logInfo("assistant_audio_pump_trace", payload);
  logRealtimeDetailEntry(session, {
    ts: new Date().toISOString(),
    kind: "assistant_audio_pump_trace",
    ...payload
  });
  if (stage === "playback_drained" || stage === "interrupted") {
    session.audioPumpTrace = null;
  }
}

function requestAssistantResponse(
  session: StreamSession,
  reason: string,
  response: Record<string, unknown> = {},
  dedupeKey?: string | null
) {
  const result = enqueueAssistantResponseRequest(session, { reason, response, dedupeKey });
  if (result.action === "duplicate_queued") {
    logInfo("openai_realtime_response_request_deduped", {
      callSid: session.callSid,
      reason,
      dedupeKey: dedupeKey || undefined,
      queueDepth: result.queueDepth
    });
    return;
  }

  if (result.action === "queued") {
    logInfo("openai_realtime_response_queued", {
      callSid: session.callSid,
      reason,
      dedupeKey: dedupeKey || undefined,
      queueDepth: result.queueDepth,
      activeResponseId: session.currentResponseId || undefined
    });
    return;
  }

  sendOpenAiEvent(session.openAiWs, createAudioTextResponseEvent(result.request.response));
}

function flushQueuedAssistantResponses(session: StreamSession) {
  if (hasActiveAssistantResponse(session)) return;
  const next = dequeueAssistantResponseRequest(session);
  if (!next) return;
  logInfo("openai_realtime_response_flushed", {
    callSid: session.callSid,
    reason: next.reason,
    dedupeKey: next.dedupeKey || undefined,
    remainingQueueDepth: session.queuedAssistantResponses?.length || 0
  });
  sendOpenAiEvent(session.openAiWs, createAudioTextResponseEvent(next.response));
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
  trace.chunksQueued += 1;
  closeAudioUnderrun(trace, performance.now());
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
      trace.underrunCount += 1;
      trace.underrunStartAtMs = nowMs;
    }
    return 0;
  }
  if (!session.outputNextFrameAtMs) {
    session.outputNextFrameAtMs = nowMs;
  }

  closeAudioUnderrun(trace, nowMs);
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
      session.outputPrimed = true;
      session.outputNextFrameAtMs = nowMs;
    }
    pumpAvailableOutputFrames(session, nowMs);
    if (!session.outputQueue || session.outputQueue.length === 0) {
      // Realtime audio can arrive in bursts. Keep the Telnyx pump alive while the
      // current assistant response is still active so the next chunk can re-prime
      // a small jitter buffer instead of forcing a full pump restart.
      if (session.currentResponseId) {
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
      }
      return;
    }
  }, 5);
}

async function interruptAssistantForCallerSpeech(session: StreamSession | undefined, reason: string) {
  if (!session || !hasPendingAssistantAudio(session)) return false;
  const plan = buildAssistantInterruptionPlan(session, reason);
  if (!plan.shouldInterrupt) return false;

  for (const event of plan.events) {
    sendOpenAiEvent(session.openAiWs, event);
  }
  applyAssistantInterruption(session, plan);
  if (session.knowledgeCallState) {
    await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, session.knowledgeCallState, {
      source: "barge_in",
      reason,
      truncated_audio_ms: plan.truncatedAudioMs,
      queued_frames_dropped: plan.queuedFramesDropped,
      buffered_bytes_dropped: plan.bufferedBytesDropped
    });
  }
  logAudioPumpTraceSummary(session, "interrupted");
  logInfo("assistant_response_canceled", {
    callSid: session.callSid,
    callControlId: session.callControlId,
    reason,
    responseId: plan.responseId || undefined,
    assistantItemId: plan.assistantItemId || undefined,
    truncatedAudioMs: plan.truncatedAudioMs,
    queuedFramesDropped: plan.queuedFramesDropped,
    bufferedBytesDropped: plan.bufferedBytesDropped
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

async function markCallAnswered(callSid: string) {
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE calls
       SET answered_at = COALESCE(answered_at, NOW())
       WHERE call_sid = $1`,
      [callSid]
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
  if (!appBaseUrl || !callSummaryToken) return;

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
        "x-everycall-internal": callSummaryToken
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
  await persistCallUsage(session);
  if (session.knowledgeCallState) {
    await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, session.knowledgeCallState, {
      source: "call_end",
      end_reason: reason
    });
  }

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

  if (session.openAiWs && session.openAiWs.readyState === WebSocket.OPEN) {
    session.openAiWs.close();
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

async function fetchPromptPayload(tenantKey: string, callSid: string, to: string, from: string): Promise<GatewayPromptPayload> {
  if (!appBaseUrl || !callSummaryToken) {
    throw new Error("missing_app_base_or_token");
  }
  const resp = await fetch(`${appBaseUrl}/api/v1/gateway/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-everycall-internal": callSummaryToken
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
  if (!appBaseUrl || !callSummaryToken) return;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const resp = await fetch(`${appBaseUrl}/api/v1/gateway/tools/result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-everycall-internal": callSummaryToken
        },
        body: JSON.stringify({ call_id: callId, tenant_key: tenantKey, tool, payload, validation })
      });
      if (resp.ok) return;
      throw new Error(`status_${resp.status}`);
    } catch (err) {
      if (attempt === maxAttempts) {
        logError("gateway_tool_result_forward_failed", {
          callId,
          tool,
          attempts: maxAttempts,
          message: err instanceof Error ? err.message : "unknown"
        });
        return;
      }
      await sleep(100 * 2 ** (attempt - 1));
    }
  }
}

function noteToolResponseRequested(session: StreamSession, tool: string, callId: string) {
  session.pendingToolSpeechWait = {
    tool,
    callId,
    requestedAtMs: performance.now(),
    responseCreatedAtMs: null,
    responseId: null,
    firstAudioLogged: false
  };
}

function estimatePayloadBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function logRealtimeToolPayloads(session: StreamSession, params: {
  callSid: string;
  tool: string;
  callId: string;
  toolResultEvent: Record<string, unknown>;
  responseEvent?: Record<string, unknown>;
}) {
  logRealtimeDetailEntry(session, {
    ts: new Date().toISOString(),
    kind: "tool_result_send",
    callSid: params.callSid,
    tool: params.tool,
    callId: params.callId,
    payload: params.toolResultEvent
  });
  if (params.responseEvent) {
    logRealtimeDetailEntry(session, {
      ts: new Date().toISOString(),
      kind: "tool_response_create_send",
      callSid: params.callSid,
      tool: params.tool,
      callId: params.callId,
      payload: params.responseEvent
    });
  }
  logInfo("openai_realtime_tool_response_requested", {
    callSid: params.callSid,
    tool: params.tool,
    callId: params.callId,
    traceFile: session.realtimeLogPath || ensureSessionRealtimeLogPath(session),
    toolResultPayloadBytes: estimatePayloadBytes(params.toolResultEvent),
    responseCreatePayloadBytes: params.responseEvent ? estimatePayloadBytes(params.responseEvent) : undefined
  });
}

async function executeToolCall(session: StreamSession, name: string, callId: string, argsText: string) {
  let args: Record<string, unknown> = {};
  try {
    args = argsText ? JSON.parse(argsText) : {};
  } catch {
    args = {};
  }

  if (name === "knowledge_lookup") {
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
    const nextState = mergeRuntimeTurnState(
      session.knowledgeCallState || session.promptPayload.knowledge_runtime.initial_call_state,
      runtimeResult
    );
    session.knowledgeCallState = nextState;
    await persistKnowledgeCallState(pool, session.tenantKey, session.callSid, nextState, {
      runtime_mode: runtimeResult.runtime_bundle.runtime_mode,
      source: "knowledge_lookup"
    });

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
      query,
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
    await forwardToolResult(
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
    const toolResultEvent = createFunctionCallOutputEvent(callId, toolOutput);
    const responseEvent = createAudioTextResponseEvent({});
    sendOpenAiEvent(session.openAiWs, toolResultEvent);
    logRealtimeToolPayloads(session, {
      callSid: session.callSid,
      tool: name,
      callId,
      toolResultEvent,
      responseEvent
    });
    noteToolResponseRequested(session, name, callId);
    requestAssistantResponse(session, "tool_result", {}, normalizeToolExecutionKey(name, callId));
    return;
  }

  if (name === "data_capture") {
    const schema = session.promptPayload?.field_schema || {};
    const validation = validateAgainstSchema(schema, args);
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
    await forwardToolResult(session.callSid, session.tenantKey, name, args, validation);
    const toolResultEvent = createFunctionCallOutputEvent(callId, validation);
    const responseEvent = createAudioTextResponseEvent({});
    sendOpenAiEvent(session.openAiWs, toolResultEvent);
    logRealtimeToolPayloads(session, {
      callSid: session.callSid,
      tool: name,
      callId,
      toolResultEvent,
      responseEvent
    });
    noteToolResponseRequested(session, name, callId);
    requestAssistantResponse(session, "tool_result", {}, normalizeToolExecutionKey(name, callId));
    return;
  }

  if (name === "finish_session") {
    const finishSessionArgs = args as FinishSessionArgs;
    const reason = String(finishSessionArgs.reason || "assistant_completed_call");
    logInfo("assistant_finish_session_requested", {
      callSid: session.callSid,
      callId,
      reason
    });
    await forwardToolResult(session.callSid, session.tenantKey, name, { reason }, { status: "accepted", errors: [] });
    const toolResultEvent = createFunctionCallOutputEvent(callId, { status: "accepted", reason });
    sendOpenAiEvent(session.openAiWs, toolResultEvent);
    logRealtimeToolPayloads(session, {
      callSid: session.callSid,
      tool: name,
      callId,
      toolResultEvent
    });

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
  const responseEvent = createAudioTextResponseEvent({});
  sendOpenAiEvent(session.openAiWs, toolResultEvent);
  logRealtimeToolPayloads(session, {
    callSid: session.callSid,
    tool: name,
    callId,
    toolResultEvent,
    responseEvent
  });
  noteToolResponseRequested(session, name, callId);
  requestAssistantResponse(session, "tool_result", {}, normalizeToolExecutionKey(name, callId));
}

async function handleToolCallEvent(
  session: StreamSession,
  name: string,
  callId: string,
  argsText: string,
  sourceType: string
) {
  const attempt = beginToolExecution(session, name, callId);
  if (!attempt.shouldExecute) {
    logInfo("openai_realtime_tool_event_deduped", {
      callSid: session.callSid,
      tool: name,
      callId,
      sourceType,
      reason: attempt.reason
    });
    return;
  }

  try {
    await executeToolCall(session, name, callId, argsText);
    completeToolExecution(session, attempt.key);
  } catch (err) {
    failToolExecution(session, attempt.key);
    throw err;
  }
}

function connectOpenAiRealtime(session: StreamSession) {
  if (!openAiKey) {
    logError("openai_realtime_missing_key", { callSid: session.callSid });
    void notifyGatewayError(session.callSid, session.tenantKey, "openai_realtime_missing_key", "OPENAI_API_KEY is missing");
    void endCallSession(session, "openai_key_missing", true);
    return;
  }
  const payload = session.promptPayload;
  if (!payload) {
    logError("openai_realtime_missing_prompt_payload", { callSid: session.callSid });
    void notifyGatewayError(
      session.callSid,
      session.tenantKey,
      "openai_realtime_missing_prompt_payload",
      "Prompt payload was not present when realtime connection was attempted"
    );
    void endCallSession(session, "prompt_payload_missing", true);
    return;
  }

  session.openAiReady = false;
  const model = payload.session_config.model;
  const instructions = buildSessionInstructions(payload);
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });
  session.openAiWs = ws;

  ws.on("open", () => {
    session.openAiReady = true;
    logInfo("openai_realtime_session_start", { callSid: session.callSid, model });

    const sessionUpdate = {
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions,
        tools: payload.tool_definitions,
        input_audio_format: payload.session_config.input_audio_format || "g711_ulaw",
        output_audio_format: payload.session_config.output_audio_format || "g711_ulaw",
        voice: payload.session_config.voice,
        turn_detection: buildRealtimeTurnDetectionConfig(payload.session_config.turn_detection),
        input_audio_transcription: {
          model: payload.session_config.transcription_model || "gpt-4o-mini-transcribe",
          language: "en"
        },
        input_audio_noise_reduction: payload.session_config.noise_reduction
          ? { type: payload.session_config.noise_reduction }
          : undefined,
        max_response_output_tokens: payload.session_config.max_output_tokens ?? 4096
      }
    };

    logRealtimeEntry(session, {
      ts: new Date().toISOString(),
      kind: "outbound",
      callSid: session.callSid,
      type: "session.update",
      instructions,
      tools: payload.tool_definitions
    });

    sendOpenAiEvent(ws, sessionUpdate);
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
      session.openAiSessionUpdated = true;
      logInfo("openai_realtime_session_updated", {
        callSid: session.callSid,
        model: session.realtimeModel
      });
      if (!session.greetingSent) {
        session.greetingSent = true;
        logInfo("openai_realtime_greeting_requested", {
          callSid: session.callSid,
          callControlId: session.callControlId
        });
        requestAssistantResponse(
          session,
          "greeting",
          {},
          "greeting"
        );
      }
      return;
    }

    if (type === "error") {
      logError("openai_realtime_server_error", {
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
      ensureAudioPumpTrace(session, payloadMsg?.response?.id || payloadMsg?.response_id || null);
      if (session.pendingToolSpeechWait && !session.pendingToolSpeechWait.responseId) {
        session.pendingToolSpeechWait.responseCreatedAtMs = performance.now();
        session.pendingToolSpeechWait.responseId = payloadMsg?.response?.id || payloadMsg?.response_id || null;
        const waitMs = Number((session.pendingToolSpeechWait.responseCreatedAtMs - session.pendingToolSpeechWait.requestedAtMs).toFixed(3));
        logInfo("openai_realtime_tool_response_created", {
          callSid: session.callSid,
          tool: session.pendingToolSpeechWait.tool,
          callId: session.pendingToolSpeechWait.callId,
          responseId: session.pendingToolSpeechWait.responseId || undefined,
          waitMs
        });
        logRealtimeDetailEntry(session, {
          ts: new Date().toISOString(),
          kind: "tool_response_created",
          callSid: session.callSid,
          tool: session.pendingToolSpeechWait.tool,
          callId: session.pendingToolSpeechWait.callId,
          responseId: session.pendingToolSpeechWait.responseId,
          waitMs,
          payload: payloadMsg
        });
      }
      markAssistantResponseCreated(session, payloadMsg?.response?.id || payloadMsg?.response_id || null);
      noteAssistantResponseCreated(session, payloadMsg?.response?.id || payloadMsg?.response_id || null);
      logInfo("openai_realtime_response_created", {
        callSid: session.callSid,
        responseId: payloadMsg?.response?.id || payloadMsg?.response_id
      });
      return;
    }

    if (type === "response.done") {
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
      logInfo("openai_realtime_response_done", {
        callSid: session.callSid,
        responseId: payloadMsg?.response?.id || payloadMsg?.response_id,
        status: payloadMsg?.response?.status || payloadMsg?.status,
        statusDetailsType: statusDetails?.type,
        statusDetailsReason: statusDetails?.reason,
        errorType: statusDetails?.error?.type,
        errorCode: statusDetails?.error?.code,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostMicrosUsd: estimateUsageCostMicrosUsd(usage)
      });
      logAudioPumpTraceSummary(session, "response_done");
      if (session.pendingToolSpeechWait) {
        const responseId = payloadMsg?.response?.id || payloadMsg?.response_id || null;
        if (!session.pendingToolSpeechWait.responseId || session.pendingToolSpeechWait.responseId === responseId) {
          logRealtimeDetailEntry(session, {
            ts: new Date().toISOString(),
            kind: "tool_response_done",
            callSid: session.callSid,
            tool: session.pendingToolSpeechWait.tool,
            callId: session.pendingToolSpeechWait.callId,
            responseId,
            payload: payloadMsg
          });
          session.pendingToolSpeechWait = null;
        }
      }
      flushQueuedAssistantResponses(session);
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
        if (session.pendingToolSpeechWait && !session.pendingToolSpeechWait.firstAudioLogged) {
          const waitMs = Number((performance.now() - session.pendingToolSpeechWait.requestedAtMs).toFixed(3));
          const responseCreatedToFirstAudioMs = session.pendingToolSpeechWait.responseCreatedAtMs
            ? Number((performance.now() - session.pendingToolSpeechWait.responseCreatedAtMs).toFixed(3))
            : undefined;
          logInfo("openai_realtime_tool_response_first_audio", {
            callSid: session.callSid,
            tool: session.pendingToolSpeechWait.tool,
            callId: session.pendingToolSpeechWait.callId,
            responseId: payloadMsg?.response_id || payloadMsg?.response?.id || null,
            waitMs,
            responseCreatedToFirstAudioMs
          });
          logRealtimeDetailEntry(session, {
            ts: new Date().toISOString(),
            kind: "tool_response_first_audio",
            callSid: session.callSid,
            tool: session.pendingToolSpeechWait.tool,
            callId: session.pendingToolSpeechWait.callId,
            responseId: payloadMsg?.response_id || payloadMsg?.response?.id || null,
            waitMs,
            responseCreatedToFirstAudioMs
          });
          session.pendingToolSpeechWait.firstAudioLogged = true;
        }
        noteAssistantResponseCreated(session, payloadMsg?.response_id || payloadMsg?.response?.id || null);
        noteAssistantOutputItem(session, payloadMsg?.item_id || payloadMsg?.item?.id || payloadMsg?.output_item?.id || null);
        enqueueOutputPcm(session, Buffer.from(audioBase64, "base64"));
      }
      return;
    }

    if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
      const transcript = payloadMsg.transcript || payloadMsg.text || payloadMsg.data || "";
      if (transcript && pool) {
        await pool.query(
          `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
           VALUES ($1, $2, $3, $4, 'message')`,
          [session.callSid, session.tenantKey, "assistant", String(transcript)]
        );
      }
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed" || type === "input_audio_transcription.completed") {
      const transcript = payloadMsg.transcript || payloadMsg.text || "";
      if (transcript && pool) {
        await pool.query(
          `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
           VALUES ($1, $2, $3, $4, 'message')`,
          [session.callSid, session.tenantKey, "caller", String(transcript)]
        );
      }
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
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
      await handleToolCallEvent(session, String(name), String(callId), String(argsText || ""), "response.function_call_arguments.done");
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
        await handleToolCallEvent(session, name, callId, argsText, "response.output_item.done");
      }
    }
  });

  ws.on("close", () => {
    logInfo("openai_realtime_session_closed", {
      callSid: session.callSid,
      reconnectAttempted: Boolean(session.reconnectAttempted),
      openAiReady: Boolean(session.openAiReady),
      openAiSessionUpdated: Boolean(session.openAiSessionUpdated)
    });

    if (session.isShuttingDown || !session.callActive) return;

    const wasInitialized = Boolean(session.openAiReady && session.openAiSessionUpdated);
    if (!wasInitialized) {
      void notifyGatewayError(
        session.callSid,
        session.tenantKey,
        "openai_realtime_session_init_failed",
        "Realtime session closed before initialization completed"
      );
      void endCallSession(session, "openai_init_failed", true);
      return;
    }

    if (!session.reconnectAttempted) {
      session.reconnectAttempted = true;
      logInfo("openai_realtime_reconnect_attempt", { callSid: session.callSid });
      connectOpenAiRealtime(session);
      return;
    }

    void notifyGatewayError(
      session.callSid,
      session.tenantKey,
      "openai_realtime_disconnected",
      "Realtime session disconnected and reconnect attempt failed"
    );
    void endCallSession(session, "openai_disconnect_after_retry", true);
  });

  ws.on("error", (err) => {
    logError("openai_realtime_session_error", {
      callSid: session.callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  });
}

app.post("/v1/telnyx/webhooks/voice/inbound", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  logInfo("telnyx_call_control_request", {
    path: req.path,
    contentLength: req.header("content-length"),
    contentType: req.header("content-type"),
    hasSignature: Boolean(req.header("telnyx-signature-ed25519")),
    hasTimestamp: Boolean(req.header("telnyx-timestamp")),
    bodyPreview: rawBody ? rawBody.slice(0, 200) : ""
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

  if (!pool) {
    return res.status(200).send("ok");
  }

  if (eventType === "call_initiated" || eventType === "call.initiated") {
    const callControlId = String(eventPayload.call_control_id || "");
    const callSid = callControlId || String(eventPayload.call_session_id || "unknown");
    const to = normalizePhone(String(eventPayload.to || ""));
    const from = normalizePhone(String(eventPayload.from || ""));

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

    let promptPayload: GatewayPromptPayload;
    try {
      promptPayload = await fetchPromptPayload(tenantKey, callSid, to, from);
    } catch (err) {
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
      return res.status(200).send("ok");
    }

    await safePrewarmBuildAssets(callSid, tenantKey, promptPayload.knowledge_runtime.active_build_id, "call_initiated");
    const realtimeLogPath = realtimeDebug || realtimeTrace ? initRealtimeLog(callSid) : undefined;
    const knowledgeCallState = initializeKnowledgeCallState(promptPayload);
    await persistKnowledgeCallState(pool, tenantKey, callSid, knowledgeCallState, {
      source: "call_initiated"
    });
    streamSessions.set(callControlId, createStreamSession(callControlId, callSid, tenantKey, promptPayload, knowledgeCallState, realtimeLogPath));

    try {
      await telnyxCallAction(callControlId, "answer", {});
    } catch (err) {
      logError("telnyx_call_control_answer_error", {
        callSid,
        message: err instanceof Error ? err.message : "unknown"
      });
    }

    return res.status(200).send("ok");
  }

  if (eventType === "call.answered" || eventType === "call_answered") {
    const callControlId = String(eventPayload.call_control_id || "");
    if (!callControlId) return res.status(200).send("ok");

    let session = streamSessions.get(callControlId);
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
      session.callAnsweredAt = session.callAnsweredAt || new Date().toISOString();
      await markCallAnswered(session.callSid);
      const streamUrl = `${toWebSocketUrl(callGatewayBaseUrl || buildBaseUrl(req))}/v1/telnyx/stream`;
      try {
        logInfo("telnyx_stream_start_request", {
          callSid: session.callSid,
          callControlId,
          streamUrl,
          bidirectionalPayloadMode: resolveBidirectionalPayloadMode()
        });
        await telnyxCallAction(callControlId, "streaming_start", getTelnyxStreamingStartPayload(streamUrl));
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
        await flushFinalAudioAndEnd(session, "telnyx_streaming_stopped", false);
      } else {
        await markCallCompleted(callControlId);
      }
    }
    return res.status(200).send("ok");
  }

  if (eventType === "call.hangup" || eventType === "call.hangup.v1") {
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
  const provided = String(req.header("x-everycall-internal") || req.query?.token || "");
  if (!callSummaryToken || provided !== callSummaryToken) {
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

wss.on("connection", (ws) => {
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
      let session = streamSessions.get(callControlId);
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
      connectOpenAiRealtime(session);
      return;
    }

    if (payload.event === "media") {
      const streamId = payload.stream_id;
      const encoded = payload.media?.payload;
      const track = String(payload.media?.track || payload.track || "").toLowerCase();
      if (!streamId || !encoded) return;
      if (track && !track.includes("inbound")) return;
      const callControlId = streamIdToCall.get(streamId);
      if (!callControlId) return;
      const session = streamSessions.get(callControlId);
      if (!session?.openAiWs) return;
      const pcm = decodeInboundAudioPayload(encoded);
      sendOpenAiEvent(session.openAiWs, {
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
        await flushFinalAudioAndEnd(session, "telnyx_stream_stop", false);
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
    rtpPayloadType
  });
  void preloadActiveBuildAssetsOnStartup();
});
