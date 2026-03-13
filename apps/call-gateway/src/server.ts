import express from "express";
import http from "node:http";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { readCallGatewayEnv } from "@everycall/config";
import { logError, logInfo } from "@everycall/observability";
import { normalizePhone, validateTelnyxSignature } from "@everycall/telephony";
import pg from "pg";
import fs from "node:fs";
import * as AjvModule from "ajv";

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
const realtimeDebug = String(process.env.REALTIME_DEBUG || "false").toLowerCase() === "true";
const realtimeTrace = String(process.env.REALTIME_TRACE || "false").toLowerCase() === "true";
const realtimeLogRoot = String(process.env.REALTIME_LOG_FILE || "/tmp/realtime-logs.jsonl");
const Ajv = (AjvModule as unknown as { default?: new (opts?: Record<string, unknown>) => any }).default || (AjvModule as unknown as new (opts?: Record<string, unknown>) => any);
const ajv = new Ajv({ allErrors: true, strict: false });

const streamIdToCall = new Map<string, string>();

type PromptPayload = {
  system_prompt: string;
  tenant_greeting: string;
  tenant_knowledge: {
    entries: Array<{ id?: string; title: string; section_type?: string; content: string; tags?: string[]; source_url?: string | null }>;
    guardrail_questions: Array<{ id?: string; topic?: string | null; question: string; answer: string; risk_level?: string; tags?: string[]; source_url?: string | null }>;
    guardrails: Array<{ id?: string; rule_type: string; topic?: string | null; severity?: string; instruction: string; service_tags?: string[] }>;
    overrides: Array<{ id?: string; topic?: string | null; trade?: string | null; trigger_text?: string | null; preferred_answer: string; service_tags?: string[] }>;
    usage_instructions: string[];
  };
  field_schema: Record<string, unknown>;
  tool_definitions: Array<Record<string, unknown>>;
  session_config: {
    model: string;
    voice: string;
    max_output_tokens?: number;
    turn_detection: {
      type: string;
      threshold: number;
      prefix_padding_ms: number;
      silence_duration_ms: number;
      idle_timeout_ms: number | null;
      create_response?: boolean;
      interrupt_response?: boolean;
    };
    transcription_model?: string;
    noise_reduction?: string;
    input_audio_format?: string;
    output_audio_format?: string;
  };
  metadata?: Record<string, unknown>;
};

type PendingToolCall = {
  name: string;
  callId: string;
  argumentsText: string;
};

type EndCallArgs = {
  reason?: string;
};

type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  inputTextTokens: number;
  inputAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  estimatedCostMicrosUsd: number;
  responseCount: number;
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
  promptPayload?: PromptPayload;
  greetingSent?: boolean;
  outputQueue?: Buffer[];
  outputBuffer?: Buffer;
  outputTimer?: NodeJS.Timeout | null;
  hangupTimer?: NodeJS.Timeout | null;
  outputPrimed?: boolean;
  rtpSeq?: number;
  rtpTimestamp?: number;
  rtpSsrc?: number;
  realtimeModel?: string;
  aiInputRateMicrosUsd?: number;
  aiOutputRateMicrosUsd?: number;
  usageTotals?: UsageTotals;
  pendingToolCall?: PendingToolCall | null;
  realtimeLogPath?: string;
};

const streamSessions = new Map<string, StreamSession>();

function parseUsdRatePerMillion(value: string | undefined, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const realtimeInputRatePer1MUsd = parseUsdRatePerMillion(process.env.OPENAI_REALTIME_INPUT_RATE_PER_1M_USD, 4);
const realtimeOutputRatePer1MUsd = parseUsdRatePerMillion(process.env.OPENAI_REALTIME_OUTPUT_RATE_PER_1M_USD, 16);
const realtimeInputRateMicrosUsd = Math.round(realtimeInputRatePer1MUsd * 1_000_000);
const realtimeOutputRateMicrosUsd = Math.round(realtimeOutputRatePer1MUsd * 1_000_000);

function emptyUsageTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
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
  const inputTextTokens = toInt(usage?.input_token_details?.text_tokens);
  const inputAudioTokens = toInt(usage?.input_token_details?.audio_tokens);
  const outputTextTokens = toInt(usage?.output_token_details?.text_tokens);
  const outputAudioTokens = toInt(usage?.output_token_details?.audio_tokens);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    inputTextTokens,
    inputAudioTokens,
    outputTextTokens,
    outputAudioTokens
  };
}

function estimateUsageCostMicrosUsd(inputTokens: number, outputTokens: number) {
  return Math.round((inputTokens * realtimeInputRateMicrosUsd) / 1_000_000)
    + Math.round((outputTokens * realtimeOutputRateMicrosUsd) / 1_000_000);
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
           ai_input_text_tokens = $6,
           ai_input_audio_tokens = $7,
           ai_output_text_tokens = $8,
           ai_output_audio_tokens = $9,
           ai_input_rate_micros_usd = $10,
           ai_output_rate_micros_usd = $11,
           ai_estimated_cost_micros_usd = $12,
           ai_response_count = $13
       WHERE call_sid = $1`,
      [
        session.callSid,
        session.realtimeModel || null,
        usage.inputTokens,
        usage.outputTokens,
        usage.cachedInputTokens,
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

function buildSessionInstructions(payload: PromptPayload) {
  const entryIndex = payload.tenant_knowledge.entries
    .map((entry) => `- ${entry.title}${entry.section_type ? ` [${entry.section_type}]` : ""}`)
    .join("\n");
  const guardrailIndex = payload.tenant_knowledge.guardrail_questions
    .map((item) => `- ${item.question}${item.topic ? ` [${item.topic}]` : ""}`)
    .join("\n");
  const usageInstructions = payload.tenant_knowledge.usage_instructions
    .map((instruction) => `- ${instruction}`)
    .join("\n");
  const activeGuardrails = payload.tenant_knowledge.guardrails
    .map((rule) => `- ${rule.rule_type}${rule.topic ? ` [${rule.topic}]` : ""}: ${rule.instruction}`)
    .join("\n");

  const knowledgeUsagePolicy = `# KNOWLEDGE TOOL POLICY
For any tenant-specific factual question (hours, service area, location, pricing/payment, services, warranty, scheduling), call tool "knowledge_lookup" before answering.
Do not answer tenant-specific facts from memory.
If knowledge_lookup returns no match, say you do not have that detail and offer callback follow-up.`;

  const knowledgeIndexSections = [
    entryIndex ? `# AVAILABLE KNOWLEDGE SECTIONS\n${entryIndex}` : "",
    guardrailIndex ? `# AVAILABLE GUARDRAIL QUESTIONS\n${guardrailIndex}` : "",
    activeGuardrails ? `# ACTIVE KNOWLEDGE GUARDRAILS\n${activeGuardrails}` : "",
    usageInstructions ? `# KNOWLEDGE USAGE INSTRUCTIONS\n${usageInstructions}` : ""
  ].filter(Boolean).join("\n\n");

  return [payload.system_prompt, knowledgeUsagePolicy, payload.tenant_greeting, knowledgeIndexSections].filter(Boolean).join("\n\n");
}

function validatePromptPayload(input: unknown): PromptPayload {
  if (!input || typeof input !== "object") throw new Error("prompt_payload_not_object");
  const payload = input as Record<string, unknown>;
  const requiredKeys = ["system_prompt", "tenant_greeting", "tenant_knowledge", "field_schema", "tool_definitions", "session_config"];
  for (const key of requiredKeys) {
    if (!(key in payload)) throw new Error(`prompt_payload_missing_${key}`);
  }
  if (typeof payload.system_prompt !== "string" || !payload.system_prompt.trim()) {
    throw new Error("prompt_payload_invalid_system_prompt");
  }
  if (typeof payload.tenant_greeting !== "string") throw new Error("prompt_payload_invalid_tenant_greeting");
  if (!Array.isArray(payload.tool_definitions)) throw new Error("prompt_payload_invalid_tool_definitions");
  if (!payload.field_schema || typeof payload.field_schema !== "object") throw new Error("prompt_payload_invalid_field_schema");
  if (!payload.session_config || typeof payload.session_config !== "object") throw new Error("prompt_payload_invalid_session_config");
  if (!payload.tenant_knowledge || typeof payload.tenant_knowledge !== "object") {
    throw new Error("prompt_payload_invalid_tenant_knowledge");
  }

  const sessionConfig = payload.session_config as Record<string, unknown>;
  if (typeof sessionConfig.model !== "string" || !sessionConfig.model.trim()) throw new Error("prompt_payload_invalid_session_model");
  if (typeof sessionConfig.voice !== "string" || !sessionConfig.voice.trim()) throw new Error("prompt_payload_invalid_session_voice");
  if (!sessionConfig.turn_detection || typeof sessionConfig.turn_detection !== "object") {
    throw new Error("prompt_payload_invalid_turn_detection");
  }
  const turnDetection = sessionConfig.turn_detection as Record<string, unknown>;
  if (typeof turnDetection.type !== "string") throw new Error("prompt_payload_invalid_turn_detection_type");

  const tenantKnowledge = payload.tenant_knowledge as Record<string, unknown>;
  const knowledgeKeys = ["entries", "guardrail_questions", "guardrails", "overrides", "usage_instructions"];
  for (const key of knowledgeKeys) {
    if (!Array.isArray(tenantKnowledge[key])) {
      throw new Error(`prompt_payload_invalid_tenant_knowledge_${key}`);
    }
  }

  for (const entry of tenantKnowledge.entries as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== "object") throw new Error("prompt_payload_invalid_knowledge_entry");
    if (typeof entry.title !== "string" || typeof entry.content !== "string") {
      throw new Error("prompt_payload_invalid_knowledge_entry_shape");
    }
  }

  for (const item of tenantKnowledge.guardrail_questions as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") throw new Error("prompt_payload_invalid_guardrail_question");
    if (typeof item.question !== "string" || typeof item.answer !== "string") {
      throw new Error("prompt_payload_invalid_guardrail_question_shape");
    }
  }

  for (const rule of tenantKnowledge.guardrails as Array<Record<string, unknown>>) {
    if (!rule || typeof rule !== "object") throw new Error("prompt_payload_invalid_guardrail");
    if (typeof rule.rule_type !== "string" || typeof rule.instruction !== "string") {
      throw new Error("prompt_payload_invalid_guardrail_shape");
    }
  }

  for (const override of tenantKnowledge.overrides as Array<Record<string, unknown>>) {
    if (!override || typeof override !== "object") throw new Error("prompt_payload_invalid_override");
    if (typeof override.preferred_answer !== "string") {
      throw new Error("prompt_payload_invalid_override_shape");
    }
  }

  return payload as unknown as PromptPayload;
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
  let offset = 0;
  while (buffer.length - offset >= frameSize) {
    const frame = buffer.subarray(offset, offset + frameSize);
    session.outputQueue.push(frame);
    offset += frameSize;
  }
  session.outputBuffer = buffer.subarray(offset);
  startOutputPump(session);
}

function startOutputPump(session: StreamSession) {
  if (session.outputTimer) return;
  if (!session.outputPrimed && session.outputQueue && session.outputQueue.length < 3) {
    return;
  }
  session.outputPrimed = true;
  session.outputTimer = setInterval(() => {
    if (!session.outputQueue || session.outputQueue.length === 0) {
      if (session.outputTimer) {
        clearInterval(session.outputTimer);
        session.outputTimer = null;
      }
      return;
    }
    const payload = session.outputQueue.shift();
    if (!payload) return;
    sendTelnyxMedia(session.telnyxWs, session.telnyxStreamId, payload.toString("base64"));
  }, 20);
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

async function markCallCompleted(callSid: string) {
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE calls
       SET status = 'completed'
       WHERE call_sid = $1`,
      [callSid]
    );
  } catch (err) {
    logError("call_status_update_failed", {
      callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

async function endCallSession(session: StreamSession | undefined, reason: string, shouldHangup: boolean) {
  if (!session || session.isShuttingDown) return;
  session.isShuttingDown = true;
  session.callActive = false;
  await persistCallUsage(session);

  logInfo("gateway_call_session_end", {
    callSid: session.callSid,
    callControlId: session.callControlId,
    reason
  });

  if (session.outputTimer) {
    clearInterval(session.outputTimer);
    session.outputTimer = null;
  }

  if (session.hangupTimer) {
    clearTimeout(session.hangupTimer);
    session.hangupTimer = null;
  }

  if (session.openAiWs && session.openAiWs.readyState === WebSocket.OPEN) {
    session.openAiWs.close();
  }

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
  await markCallCompleted(session.callSid);
}

async function flushFinalAudioAndEnd(session: StreamSession | undefined, reason: string, shouldHangup: boolean) {
  if (!session) return;
  await endCallSession(session, reason, shouldHangup);
}

async function fetchPromptPayload(tenantKey: string, callSid: string, to: string, from: string): Promise<PromptPayload> {
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

function tokenizeLookupText(text: string) {
  return Array.from(
    new Set(
      String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2)
    )
  );
}

function scoreLookupText(query: string, haystack: string) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedHaystack = String(haystack || "").trim().toLowerCase();
  if (!normalizedQuery || !normalizedHaystack) return 0;
  const queryTokens = tokenizeLookupText(normalizedQuery);
  let score = normalizedHaystack.includes(normalizedQuery)
    ? Math.max(3, queryTokens.length + 2)
    : 0;
  for (const token of queryTokens) {
    if (normalizedHaystack.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function buildKnowledgeMatches(knowledge: PromptPayload["tenant_knowledge"], query: string) {
  const matches = [
    ...(knowledge.entries || []).map((entry, index) => ({
      id: entry.id || `knowledge_entry_${index + 1}`,
      artifactType: "knowledge_entry",
      title: entry.title,
      topic: entry.section_type || null,
      content: entry.content,
      sourceUrl: entry.source_url || null,
      score: scoreLookupText(query, `${entry.title} ${entry.section_type || ""} ${entry.content} ${(entry.tags || []).join(" ")}`)
    })),
    ...(knowledge.guardrail_questions || []).map((item, index) => ({
      id: item.id || `guardrail_question_${index + 1}`,
      artifactType: "guardrail_question",
      title: item.question,
      topic: item.topic || null,
      content: item.answer,
      riskLevel: item.risk_level || "high",
      sourceUrl: item.source_url || null,
      score: scoreLookupText(query, `${item.question} ${item.answer} ${item.topic || ""} ${(item.tags || []).join(" ")}`)
    }))
  ]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const overrides = (knowledge.overrides || [])
    .map((item, index) => ({
      id: item.id || `knowledge_override_${index + 1}`,
      topic: item.topic || null,
      triggerText: item.trigger_text || null,
      preferredAnswer: item.preferred_answer,
      score: scoreLookupText(query, `${item.topic || ""} ${item.trigger_text || ""} ${item.preferred_answer} ${(item.service_tags || []).join(" ")}`)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const guardrails = (knowledge.guardrails || [])
    .map((item, index) => ({
      id: item.id || `knowledge_guardrail_${index + 1}`,
      ruleType: item.rule_type,
      topic: item.topic || null,
      severity: item.severity || "high",
      instruction: item.instruction,
      score: scoreLookupText(query, `${item.rule_type} ${item.topic || ""} ${item.instruction} ${(item.service_tags || []).join(" ")}`)
    }))
    .filter((item) => item.score > 0);

  return {
    matches,
    overrides,
    guardrails: guardrails.length ? guardrails.slice(0, 5) : (knowledge.guardrails || []).slice(0, 3).map((item, index) => ({
      id: item.id || `knowledge_guardrail_${index + 1}`,
      ruleType: item.rule_type,
      topic: item.topic || null,
      severity: item.severity || "high",
      instruction: item.instruction
    })),
    usage_instructions: Array.isArray(knowledge.usage_instructions) ? knowledge.usage_instructions : []
  };
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

async function executeToolCall(session: StreamSession, name: string, callId: string, argsText: string) {
  let args: Record<string, unknown> = {};
  try {
    args = argsText ? JSON.parse(argsText) : {};
  } catch {
    args = {};
  }

  if (name === "knowledge_lookup") {
    const query = String((args as any).query || "");
    const matches = buildKnowledgeMatches(
      session.promptPayload?.tenant_knowledge || { entries: [], guardrail_questions: [], guardrails: [], overrides: [], usage_instructions: [] },
      query
    );
    logInfo("knowledge_lookup_tool_called", {
      callSid: session.callSid,
      query,
      matchCount: matches.matches.length
    });
    await forwardToolResult(session.callSid, session.tenantKey, name, { query, matches }, { status: "accepted", errors: [] });
    sendOpenAiEvent(session.openAiWs, {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(matches)
      }
    });
    logInfo("openai_realtime_tool_response_requested", {
      callSid: session.callSid,
      tool: name,
      callId
    });
    sendOpenAiEvent(session.openAiWs, createAudioTextResponseEvent());
    return;
  }

  if (name === "data_capture") {
    const schema = session.promptPayload?.field_schema || {};
    const validation = validateAgainstSchema(schema, args);
    await forwardToolResult(session.callSid, session.tenantKey, name, args, validation);
    sendOpenAiEvent(session.openAiWs, {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(validation)
      }
    });
    logInfo("openai_realtime_tool_response_requested", {
      callSid: session.callSid,
      tool: name,
      callId
    });
    sendOpenAiEvent(session.openAiWs, createAudioTextResponseEvent());
    return;
  }

  if (name === "end_call") {
    const endCallArgs = args as EndCallArgs;
    const reason = String(endCallArgs.reason || "assistant_completed_call");
    logInfo("assistant_end_call_requested", {
      callSid: session.callSid,
      callId,
      reason
    });
    await forwardToolResult(session.callSid, session.tenantKey, name, { reason }, { status: "accepted", errors: [] });
    sendOpenAiEvent(session.openAiWs, {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ status: "accepted", reason })
      }
    });

    const queuedFrames = session.outputQueue?.length || 0;
    const drainMs = Math.min(Math.max(queuedFrames * 20 + 1200, 1200), 4000);
    if (session.hangupTimer) {
      clearTimeout(session.hangupTimer);
    }
    session.hangupTimer = setTimeout(() => {
      void endCallSession(session, "assistant_end_call", true);
    }, drainMs);
    return;
  }

  await forwardToolResult(session.callSid, session.tenantKey, name, args, { status: "accepted", errors: [] });
  sendOpenAiEvent(session.openAiWs, {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({ status: "accepted" })
    }
  });
  logInfo("openai_realtime_tool_response_requested", {
    callSid: session.callSid,
    tool: name,
    callId
  });
  sendOpenAiEvent(session.openAiWs, createAudioTextResponseEvent());
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
        turn_detection: {
          ...payload.session_config.turn_detection,
          create_response: payload.session_config.turn_detection.create_response ?? true,
          interrupt_response: payload.session_config.turn_detection.interrupt_response ?? true
        },
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
        sendOpenAiEvent(
          session.openAiWs,
          createAudioTextResponseEvent({
            instructions: `Call just connected. Greet the caller now using this greeting: ${payload.tenant_greeting || "Hi, thanks for calling. How can I help you?"}`
          })
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
      logInfo("openai_realtime_response_created", {
        callSid: session.callSid,
        responseId: payloadMsg?.response?.id || payloadMsg?.response_id
      });
      return;
    }

    if (type === "response.done") {
      const statusDetails = payloadMsg?.response?.status_details || payloadMsg?.status_details;
      const usage = collectUsage(payloadMsg);
      const totals = session.usageTotals || emptyUsageTotals();
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
      totals.cachedInputTokens += usage.cachedInputTokens;
      totals.inputTextTokens += usage.inputTextTokens;
      totals.inputAudioTokens += usage.inputAudioTokens;
      totals.outputTextTokens += usage.outputTextTokens;
      totals.outputAudioTokens += usage.outputAudioTokens;
      totals.responseCount += 1;
      totals.estimatedCostMicrosUsd += estimateUsageCostMicrosUsd(usage.inputTokens, usage.outputTokens);
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
        estimatedCostMicrosUsd: estimateUsageCostMicrosUsd(usage.inputTokens, usage.outputTokens)
      });
      return;
    }

    if (type === "response.output_audio.delta" || type === "response.audio.delta" || type === "output_audio.delta") {
      const audioBase64 = payloadMsg.delta || payloadMsg.audio?.delta || payloadMsg.audio?.data || payloadMsg.data || "";
      if (audioBase64) {
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
      await executeToolCall(session, String(name), String(callId), String(argsText || ""));
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
        await executeToolCall(session, name, callId, argsText);
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

    let promptPayload: PromptPayload;
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

    const realtimeLogPath = realtimeDebug || realtimeTrace ? initRealtimeLog(callSid) : undefined;
    streamSessions.set(callControlId, {
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
      usageTotals: emptyUsageTotals(),
      promptPayload,
      outputQueue: [],
      outputBuffer: Buffer.alloc(0),
      ...(realtimeLogPath ? { realtimeLogPath } : {})
    });

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
      // Recover session on call.answered in case memory state was lost between webhook events.
      const to = normalizePhone(String(eventPayload.to || ""));
      const from = normalizePhone(String(eventPayload.from || ""));
      const callSid = callControlId;
      logInfo("call_answered_session_recovery_attempt", { callSid, callControlId, to, from });

      let tenantKey = "";
      const callRow = await pool.query(
        `SELECT tenant_key FROM calls WHERE call_sid = $1 LIMIT 1`,
        [callSid]
      );
      if (callRow.rowCount) {
        tenantKey = String(callRow.rows[0].tenant_key || "");
      } else if (to) {
        const tenantRow = await pool.query(
          `SELECT tenant_key FROM tenants WHERE telnyx_voice_number = $1 LIMIT 1`,
          [to]
        );
        tenantKey = String(tenantRow.rows[0]?.tenant_key || "");
      }

      if (tenantKey) {
        try {
          const promptPayload = await fetchPromptPayload(tenantKey, callSid, to, from);
          const realtimeLogPath = realtimeDebug || realtimeTrace ? initRealtimeLog(callSid) : undefined;
          session = {
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
            usageTotals: emptyUsageTotals(),
            promptPayload,
            outputQueue: [],
            outputBuffer: Buffer.alloc(0),
            ...(realtimeLogPath ? { realtimeLogPath } : {})
          };
          streamSessions.set(callControlId, session);
          logInfo("call_answered_session_recovered", { callSid, callControlId, tenantKey });
        } catch (err) {
          logError("call_answered_session_recovery_failed", {
            callSid,
            callControlId,
            tenantKey,
            message: err instanceof Error ? err.message : "unknown"
          });
        }
      } else {
        logError("call_answered_session_missing_tenant", { callSid, callControlId, to });
      }
    }

    if (session) {
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
      const session = streamSessions.get(callControlId);
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
});
