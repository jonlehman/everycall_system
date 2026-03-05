import express from "express";
import http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { readCallGatewayEnv } from "@everycall/config";
import { logError, logInfo } from "@everycall/observability";
import { normalizePhone, validateTelnyxSignature } from "@everycall/telephony";
import pg from "pg";
import fs from "node:fs";

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
const bidirectionalPayloadMode = (process.env.TELNYX_BIDIRECTIONAL_PAYLOAD_MODE || "rtp").toLowerCase();
const realtimeDebug = String(process.env.REALTIME_DEBUG || "false").toLowerCase() === "true";
const realtimeTrace = String(process.env.REALTIME_TRACE || "false").toLowerCase() === "true";
const realtimeLogFile = String(process.env.REALTIME_LOG_FILE || "/tmp/realtime-logs.jsonl");

const streamIdToCall = new Map<string, string>();

type PromptPayload = {
  system_prompt: string;
  tenant_greeting: string;
  tenant_faqs: Array<{ id?: string; question: string; answer: string; tags?: string[] }>;
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

type StreamSession = {
  callControlId: string;
  callSid: string;
  tenantKey: string;
  telnyxStreamId?: string;
  telnyxWs?: WebSocket;
  openAiWs?: WebSocket;
  promptPayload?: PromptPayload;
  outputQueue?: Buffer[];
  outputBuffer?: Buffer;
  outputTimer?: NodeJS.Timeout;
  outputPrimed?: boolean;
  rtpSeq?: number;
  rtpTimestamp?: number;
  rtpSsrc?: number;
  realtimeModel?: string;
  pendingToolCall?: PendingToolCall;
  realtimeLogInitialized?: boolean;
};

const streamSessions = new Map<string, StreamSession>();

function resetRealtimeLog() {
  try {
    fs.writeFileSync(realtimeLogFile, "");
  } catch (err) {
    logError("realtime_log_reset_failed", {
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function logRealtimeEntry(entry: Record<string, unknown>) {
  if (!realtimeDebug && !realtimeTrace) return;
  try {
    fs.appendFileSync(realtimeLogFile, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    logError("realtime_log_write_failed", {
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function logRealtimeRaw(session: StreamSession, payload: Record<string, unknown>) {
  if (!realtimeDebug) return;
  logRealtimeEntry({
    ts: new Date().toISOString(),
    kind: "raw",
    callSid: session.callSid,
    payload
  });
}

function logRealtimeTrace(session: StreamSession, payload: Record<string, unknown>) {
  if (!realtimeTrace) return;
  logRealtimeEntry({
    ts: new Date().toISOString(),
    kind: "trace",
    callSid: session.callSid,
    payload
  });
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

function buildRtpPacket(frame: Buffer, session: StreamSession) {
  const payloadType = rtpPayloadType & 0x7f;
  session.rtpSeq = (session.rtpSeq ?? Math.floor(Math.random() * 65535)) + 1;
  session.rtpTimestamp = (session.rtpTimestamp ?? Math.floor(Math.random() * 2 ** 32)) + frame.length;
  session.rtpSsrc = session.rtpSsrc ?? Math.floor(Math.random() * 2 ** 32);
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = payloadType;
  header.writeUInt16BE(session.rtpSeq % 65536, 2);
  header.writeUInt32BE(session.rtpTimestamp >>> 0, 4);
  header.writeUInt32BE(session.rtpSsrc >>> 0, 8);
  return Buffer.concat([header, frame]);
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
    const payload = bidirectionalPayloadMode === "raw" ? frame : buildRtpPacket(frame, session);
    session.outputQueue.push(payload);
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
        session.outputTimer = undefined;
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
  return resp.json();
}

function buildFaqMatches(faqs: Array<{ question: string; answer: string; tags?: string[] }>, query: string) {
  const q = query.toLowerCase();
  const scored = faqs
    .map((faq) => {
      const hay = `${faq.question} ${faq.answer} ${(faq.tags || []).join(" ")}`.toLowerCase();
      const score = hay.includes(q) ? 1 : 0;
      return { faq, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => ({
      id: undefined,
      question: item.faq.question,
      answer: item.faq.answer,
      score: item.score
    }));
  return { matches: scored };
}

function validateAgainstSchema(schema: Record<string, unknown>, payload: Record<string, unknown>) {
  const required = Array.isArray((schema as any).required) ? (schema as any).required : [];
  const errors: string[] = [];
  for (const field of required) {
    if (!(field in payload)) {
      errors.push(`missing:${field}`);
    }
  }
  return { status: errors.length ? "invalid" : "accepted", errors } as const;
}

async function forwardToolResult(
  callId: string,
  tenantKey: string,
  tool: string,
  payload: Record<string, unknown>,
  validation: { status: string; errors: string[] }
) {
  if (!appBaseUrl || !callSummaryToken) return;
  try {
    await fetch(`${appBaseUrl}/api/v1/gateway/tools/result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-everycall-internal": callSummaryToken
      },
      body: JSON.stringify({ call_id: callId, tenant_key: tenantKey, tool, payload, validation })
    });
  } catch (err) {
    logError("gateway_tool_result_forward_failed", {
      callId,
      tool,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

function connectOpenAiRealtime(session: StreamSession) {
  if (!openAiKey) {
    logError("openai_realtime_missing_key", { callSid: session.callSid });
    return;
  }
  const payload = session.promptPayload;
  if (!payload) {
    logError("openai_realtime_missing_prompt_payload", { callSid: session.callSid });
    return;
  }

  const model = payload.session_config.model;
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });
  session.openAiWs = ws;

  ws.on("open", () => {
    logInfo("openai_realtime_session_start", { callSid: session.callSid, model });

    const sessionUpdate = {
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions: payload.system_prompt,
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

    logRealtimeEntry({
      ts: new Date().toISOString(),
      kind: "outbound",
      callSid: session.callSid,
      type: "session.update",
      instructions: payload.system_prompt
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
      logInfo("openai_realtime_session_updated", {
        callSid: session.callSid,
        model: session.realtimeModel
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
      session.pendingToolCall = undefined;
      let args: Record<string, unknown> = {};
      try {
        args = argsText ? JSON.parse(argsText) : {};
      } catch {
        args = {};
      }

      if (name === "faq_lookup") {
        const query = String((args as any).query || "");
        const matches = buildFaqMatches(session.promptPayload?.tenant_faqs || [], query);
        sendOpenAiEvent(session.openAiWs, {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(matches)
          }
        });
        sendOpenAiEvent(session.openAiWs, { type: "response.create", response: { modalities: ["audio", "text"] } });
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
        sendOpenAiEvent(session.openAiWs, { type: "response.create", response: { modalities: ["audio", "text"] } });
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
      sendOpenAiEvent(session.openAiWs, { type: "response.create", response: { modalities: ["audio", "text"] } });
    }
  });

  ws.on("close", () => {
    logInfo("openai_realtime_session_closed", { callSid: session.callSid });
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

    if (realtimeDebug || realtimeTrace) {
      resetRealtimeLog();
    }

    let promptPayload: PromptPayload;
    try {
      promptPayload = await fetchPromptPayload(tenantKey, callSid, to, from);
    } catch (err) {
      logError("prompt_payload_fetch_failed", {
        callSid,
        tenantKey,
        message: err instanceof Error ? err.message : "unknown"
      });
      try {
        if (callControlId) {
          await telnyxCallAction(callControlId, "hangup", {});
        }
      } catch {}
      return res.status(200).send("ok");
    }

    streamSessions.set(callControlId, {
      callControlId,
      callSid,
      tenantKey,
      promptPayload,
      outputQueue: [],
      outputBuffer: Buffer.alloc(0)
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
    const session = streamSessions.get(callControlId);
    if (callControlId && session) {
      const streamUrl = `${toWebSocketUrl(callGatewayBaseUrl || buildBaseUrl(req))}/v1/telnyx/stream`;
      try {
        await telnyxCallAction(callControlId, "streaming_start", {
          stream_url: streamUrl,
          stream_track: "both_tracks",
          stream_bidirectional_mode: "rtp",
          stream_bidirectional_codec: "PCMU",
          stream_bidirectional_sampling_rate: 8000,
          stream_codec: "PCMU"
        });
      } catch (err) {
        logError("telnyx_call_control_stream_start_error", {
          callSid: session.callSid,
          message: err instanceof Error ? err.message : "unknown"
        });
      }
    }
    return res.status(200).send("ok");
  }

  if (eventType === "streaming.started" || eventType === "streaming.started.v1") {
    return res.status(200).send("ok");
  }

  if (eventType === "streaming.stopped" || eventType === "streaming.stopped.v1") {
    return res.status(200).send("ok");
  }

  if (eventType === "call.hangup" || eventType === "call.hangup.v1") {
    const callControlId = String(eventPayload.call_control_id || "");
    if (callControlId) {
      const session = streamSessions.get(callControlId);
      if (session?.openAiWs && session.openAiWs.readyState === WebSocket.OPEN) {
        session.openAiWs.close();
      }
      streamSessions.delete(callControlId);
    }
    return res.status(200).send("ok");
  }

  return res.status(200).send("ok");
});

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/v1/debug/realtime-log", (req, res) => {
  const provided = String(req.header("x-everycall-internal") || req.query?.token || "");
  if (!callSummaryToken || provided !== callSummaryToken) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!fs.existsSync(realtimeLogFile)) {
    return res.status(404).json({ error: "not_found" });
  }
  res.setHeader("Content-Type", "application/jsonl");
  fs.createReadStream(realtimeLogFile).pipe(res);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/v1/telnyx/stream" });

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
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
      logInfo("telnyx_stream_started", { callSid: session.callSid, callControlId, streamId });
      connectOpenAiRealtime(session);
      return;
    }

    if (payload.event === "media") {
      const streamId = payload.stream_id;
      const encoded = payload.media?.payload;
      if (!streamId || !encoded) return;
      const callControlId = streamIdToCall.get(streamId);
      if (!callControlId) return;
      const session = streamSessions.get(callControlId);
      if (!session?.openAiWs) return;
      const pcm = Buffer.from(encoded, "base64");
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
      if (session?.openAiWs) {
        session.openAiWs.close();
      }
      streamIdToCall.delete(streamId);
      streamSessions.delete(callControlId);
    }
  });
});

const port = Number(process.env.PORT || 3101);
server.listen(port, () => {
  logInfo("call_gateway_started", { port });
});
