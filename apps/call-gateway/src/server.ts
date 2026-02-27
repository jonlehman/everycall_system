import express from "express";
import http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { readCallGatewayEnv } from "@everycall/config";
import { logError, logInfo } from "@everycall/observability";
import { normalizePhone, validateTelnyxSignature } from "@everycall/telephony";
import pg from "pg";

const env = readCallGatewayEnv(process.env);
const app = express();
const databaseUrl = process.env.DATABASE_URL || "";
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const appBaseUrl = process.env.APP_BASE_URL || "";
const callSummaryToken = process.env.CALL_SUMMARY_TOKEN || "";
const callGatewayBaseUrl = process.env.CALL_GATEWAY_BASE_URL || "";
const openAiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const signatureRequired = (process.env.TELNYX_SIGNATURE_REQUIRED || "true").toLowerCase() !== "false";
const telnyxApiKey = process.env.TELNYX_API_KEY || "";
const telnyxTranscriptionModel = process.env.TELNYX_TRANSCRIPTION_MODEL || "Telnyx";
const voiceServiceUrl = process.env.VOICE_SERVICE_URL || "";
const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_DEFAULT_VOICE_ID || "";
const openAiRealtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const openAiRealtimeVoice = process.env.OPENAI_REALTIME_VOICE || "alloy";

type PlaybackAsset = {
  buffer: Buffer;
  contentType: string;
  createdAt: number;
};

const playbackStore = new Map<string, PlaybackAsset>();

type StreamSession = {
  callControlId: string;
  callSid: string;
  tenantKey: string;
  telnyxStreamId?: string;
  telnyxWs?: WebSocket;
  openAiWs?: WebSocket;
  greeting?: string;
  lastTranscript?: string;
  outputActive?: boolean;
  instructions?: string;
};

const streamSessions = new Map<string, StreamSession>();

app.set("trust proxy", true);

function parseFormBody(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function parseTelnyxParams(rawBody: string, contentType: string | undefined): Record<string, string> {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/json") && rawBody.trim().startsWith("{")) {
    try {
      const json = JSON.parse(rawBody);
      if (json && typeof json === "object") {
        return Object.fromEntries(
          Object.entries(json).map(([key, value]) => [key, String(value ?? "")])
        );
      }
    } catch {
      return {};
    }
  }
  return parseFormBody(rawBody);
}

function buildBaseUrl(req: express.Request) {
  if (callGatewayBaseUrl) return callGatewayBaseUrl;
  return `${req.protocol}://${req.get("host")}`;
}

function buildBaseUrlFromAction(actionUrl: string) {
  try {
    const parsed = new URL(actionUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return callGatewayBaseUrl || "";
  }
}

function toWebSocketUrl(baseUrl: string) {
  if (baseUrl.startsWith("https://")) return baseUrl.replace("https://", "wss://");
  if (baseUrl.startsWith("http://")) return baseUrl.replace("http://", "ws://");
  return baseUrl;
}

function sendTelnyxMedia(ws: WebSocket | undefined, streamId: string | undefined, payloadBase64: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !streamId) return;
  ws.send(
    JSON.stringify({
      event: "media",
      stream_id: streamId,
      media: {
        payload: payloadBase64
      }
    })
  );
}

function sendOpenAiEvent(ws: WebSocket | undefined, payload: Record<string, unknown>) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function connectOpenAiRealtime(session: StreamSession) {
  if (!openAiKey) {
    logError("openai_realtime_missing_key", { callSid: session.callSid });
    return;
  }
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(openAiRealtimeModel)}`;
  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });
  session.openAiWs = ws;

  ws.on("open", () => {
    const instructions = session.instructions || "";
    sendOpenAiEvent(ws, {
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        voice: openAiRealtimeVoice,
        turn_detection: { type: "server_vad" }
      }
    });

    if (session.greeting) {
      sendOpenAiEvent(ws, {
        type: "response.create",
        response: {
          modalities: ["audio"],
          instructions: session.greeting
        }
      });
    }
  });

  ws.on("message", (data) => {
    let payload: any = {};
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }
    const type = payload.type || "";
    if (type === "response.audio.delta" || type === "response.output_audio.delta" || type === "output_audio.delta") {
      const audioBase64 =
        payload.delta ||
        payload.audio?.delta ||
        payload.audio?.data ||
        payload.data ||
        "";
      if (audioBase64 && session.telnyxWs && session.telnyxStreamId) {
        session.outputActive = true;
        sendTelnyxMedia(session.telnyxWs, session.telnyxStreamId, audioBase64);
      }
      return;
    }
    if (type === "response.done" || type === "response.completed") {
      session.outputActive = false;
    }
    if (type === "error") {
      logError("openai_realtime_error", { callSid: session.callSid, detail: payload });
    }
  });

  ws.on("close", () => {
    session.openAiWs = undefined;
  });
}

async function telnyxCallAction(callControlId: string, action: string, payload: Record<string, unknown> = {}) {
  if (!telnyxApiKey) {
    throw new Error("missing_telnyx_api_key");
  }
  const resp = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`telnyx_action_failed:${action}:${resp.status}:${text}`);
  }
  return resp.json();
}

async function synthesizeAudio(text: string, tenantKey: string, callSid: string, utteranceId: string) {
  if (!voiceServiceUrl || !elevenLabsVoiceId) {
    return null;
  }
  const resp = await fetch(`${voiceServiceUrl}/v1/voice/synthesize-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trace_id: `trace_${callSid}`,
      tenant_id: tenantKey,
      call_id: callSid,
      utterance_id: utteranceId,
      provider: "elevenlabs",
      voice: { voice_id: elevenLabsVoiceId },
      audio: { format: "mp3", sample_rate_hz: 24000 },
      text
    })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`voice_service_failed:${resp.status}:${text}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function savePlaybackAsset(utteranceId: string, buffer: Buffer) {
  playbackStore.set(utteranceId, {
    buffer,
    contentType: "audio/mpeg",
    createdAt: Date.now()
  });
  setTimeout(() => {
    playbackStore.delete(utteranceId);
  }, 2 * 60 * 1000);
}

function buildTeXMLResponse(prompt: string, actionUrl: string) {
  const escaped = prompt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapedAction = actionUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const transcriptionCallback = `${buildBaseUrlFromAction(actionUrl)}/v1/telnyx/texml/transcription`;
  const escapedCallback = transcriptionCallback.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Start>\n    <Transcription language="en" transcriptionEngine="Telnyx" transcriptionCallback="${escapedCallback}" />\n  </Start>\n  <Gather input="speech" timeout="10" speechTimeout="4" language="en-US" action="${escapedAction}" method="POST">\n    <Say>${escaped}</Say>\n  </Gather>\n  <Say>We didn't catch that. Please call again.</Say>\n</Response>`;
}

function buildHangupResponse(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>${escaped}</Say>\n  <Hangup/>\n</Response>`;
}

function isDonePhrase(text: string) {
  return /\b(no|nope|that'?s it|thats it|nothing else|done|goodbye|bye|stop)\b/i.test(String(text || ""));
}

async function composePromptForTenant(tenantKey: string) {
  if (!pool) return "";
  const systemParts = await pool.query(
    `SELECT global_emergency_phrase,
            personality_prompt,
            datetime_prompt,
            numbers_symbols_prompt,
            confirmation_prompt,
            faq_usage_prompt
     FROM system_config
     WHERE id = 1`
  );
  const tenantRow = await pool.query(
    `SELECT industry FROM tenants WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );
  const industryKey = tenantRow.rows[0]?.industry || null;
  const industryPromptRow = industryKey
    ? await pool.query(`SELECT prompt FROM industry_prompts WHERE industry_key = $1`, [industryKey])
    : { rows: [] };
  const tenantPromptRow = await pool.query(
    `SELECT tenant_prompt_override, system_prompt FROM agents WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );

  const sections: string[] = [];
  const format = (title: string, body?: string) => (body ? `# ${title}\n${body}` : "");
  sections.push(format("SYSTEM EMERGENCY PHRASE", systemParts.rows[0]?.global_emergency_phrase));
  sections.push(format("PERSONALITY", systemParts.rows[0]?.personality_prompt));
  sections.push(format("DATE & TIME", systemParts.rows[0]?.datetime_prompt));
  sections.push(format("NUMBERS & SYMBOLS", systemParts.rows[0]?.numbers_symbols_prompt));
  sections.push(format("CONFIRMATION", systemParts.rows[0]?.confirmation_prompt));
  sections.push(format("WHEN TO USE FAQ", systemParts.rows[0]?.faq_usage_prompt));
  sections.push(format("INDUSTRY PROMPT", industryPromptRow.rows[0]?.prompt));
  const tenantOverride = tenantPromptRow.rows[0]?.tenant_prompt_override || tenantPromptRow.rows[0]?.system_prompt || "";
  sections.push(format("TENANT PROMPT OVERRIDE", tenantOverride));
  return sections.filter(Boolean).join("\n\n");
}

async function generateAssistantReply(prompt: string, history: Array<{ role: string; content: string }>, userText: string) {
  if (!openAiKey) {
    return "Thanks. What is the service address and best callback number?";
  }
  const input = [
    { role: "system", content: prompt },
    ...history,
    { role: "user", content: userText }
  ];
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: openAiModel, input })
  });
  if (!resp.ok) {
    return "Thanks. Can you share your service address and best callback number?";
  }
  const json = await resp.json();
  const text =
    json.output_text ||
    json.output
      ?.flatMap((item: any) => item.content || [])
      .find((item: any) => item.type === "output_text" && typeof item.text === "string")
      ?.text;
  return String(text || "").slice(0, 400) || "Thanks. What is the service address?";
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

app.post("/v1/telnyx/texml/inbound", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  logInfo("telnyx_texml_inbound_request", {
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
  if (!pool) {
    res.type("text/xml").status(200).send(buildHangupResponse("Thanks for calling. Goodbye."));
    return;
  }

  try {
    const params = parseTelnyxParams(rawBody, req.header("content-type"));
    const toRaw = String(params.To || "");
    const fromRaw = String(params.From || "");
    const to = normalizePhone(toRaw);
    const from = normalizePhone(fromRaw);
    const callSid = String(params.CallSid || "unknown");
    logInfo("telnyx_texml_inbound_params", {
      callSid,
      toRaw,
      fromRaw,
      to,
      from
    });

    const tenantRow = await pool.query(
      `SELECT tenant_key, status, name FROM tenants WHERE telnyx_voice_number = $1 LIMIT 1`,
      [to]
    );
    logInfo("telnyx_texml_inbound_tenant_lookup", {
      callSid,
      matched: Boolean(tenantRow.rowCount),
      tenantKey: tenantRow.rows[0]?.tenant_key,
      status: tenantRow.rows[0]?.status
    });
    if (!tenantRow.rowCount || tenantRow.rows[0].status !== "active") {
      res.type("text/xml").status(200).send(buildHangupResponse("Thanks for calling. Goodbye."));
      return;
    }
    const tenantKey = tenantRow.rows[0].tenant_key;
    const companyName = tenantRow.rows[0].name || "our team";

    await pool.query(
      `INSERT INTO calls (call_sid, tenant_key, from_number, to_number, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       ON CONFLICT (call_sid)
       DO UPDATE SET from_number = EXCLUDED.from_number,
                     to_number = EXCLUDED.to_number`,
      [callSid, tenantKey, from, to]
    );

    await pool.query(
      `INSERT INTO call_details (call_sid, state_json)
       VALUES ($1, $2)
       ON CONFLICT (call_sid)
       DO UPDATE SET state_json = COALESCE(call_details.state_json, EXCLUDED.state_json)`,
      [callSid, JSON.stringify({ turn: 0, history: [] })]
    );

    const greeting = `Thanks for calling ${companyName}. I can help get you scheduled. What's your name and best callback number?`;
    const actionUrl = `${buildBaseUrl(req)}/v1/telnyx/texml/gather?tenantKey=${encodeURIComponent(tenantKey)}&callSid=${encodeURIComponent(callSid)}`;
    logInfo("telnyx_texml_inbound_response", {
      callSid,
      tenantKey,
      actionUrl
    });
    res.type("text/xml").status(200).send(buildTeXMLResponse(greeting, actionUrl));
  } catch (err) {
    logError("telnyx_texml_inbound_error", {
      message: err instanceof Error ? err.message : "unknown"
    });
    res.type("text/xml").status(200).send(buildHangupResponse("We are unable to take your call right now."));
  }
});

app.post("/v1/telnyx/texml/debug", express.raw({ type: "*/*" }), (_req, res) => {
  res
    .type("text/xml")
    .status(200)
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>Everycall debug endpoint is live.</Say>\n  <Hangup/>\n</Response>`
    );
});

app.post("/v1/telnyx/texml/gather", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  logInfo("telnyx_texml_gather_request", {
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
  if (!pool) {
    res.type("text/xml").status(200).send(buildHangupResponse("Thanks for calling. Goodbye."));
    return;
  }

  try {
    const params = parseTelnyxParams(rawBody, req.header("content-type"));
    const tenantKey = String(req.query?.tenantKey || "");
    const callSid = String(req.query?.callSid || params.CallSid || "unknown");
    let speech = String(params.SpeechResult || "");
    logInfo("telnyx_texml_gather_params", {
      callSid,
      tenantKey,
      speechLength: speech.trim().length,
      speechPreview: speech.slice(0, 120),
      confidence: params.Confidence || "",
      digits: params.Digits || ""
    });

    if (!speech.trim()) {
      const retryPrompt = "Sorry, I didn't catch that. Please say your name and best callback number.";
      const actionUrl = `${buildBaseUrl(req)}/v1/telnyx/texml/gather?tenantKey=${encodeURIComponent(tenantKey)}&callSid=${encodeURIComponent(callSid)}`;
      res.type("text/xml").status(200).send(buildTeXMLResponse(retryPrompt, actionUrl));
      return;
    }

    const detailRow = await pool.query(
      `SELECT state_json, transcript FROM call_details WHERE call_sid = $1`,
      [callSid]
    );
    const state = detailRow.rows[0]?.state_json || { turn: 0, history: [] };
    const turn = Number(state.turn || 0) + 1;
    const history = Array.isArray(state.history) ? state.history : [];

    if (!speech.trim() && state.last_transcript) {
      speech = String(state.last_transcript || "");
      state.last_transcript = "";
    }

    if (!speech.trim()) {
      const retryPrompt = "Sorry, I didn't catch that. Please say your name and best callback number.";
      const actionUrl = `${buildBaseUrl(req)}/v1/telnyx/texml/gather?tenantKey=${encodeURIComponent(tenantKey)}&callSid=${encodeURIComponent(callSid)}`;
      res.type("text/xml").status(200).send(buildTeXMLResponse(retryPrompt, actionUrl));
      return;
    }

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'message')`,
      [callSid, tenantKey, "caller", speech]
    );

    const done = isDonePhrase(speech) || turn >= 6;
    if (done) {
      await pool.query(`UPDATE calls SET status = 'completed' WHERE call_sid = $1`, [callSid]);
      const transcript = `${detailRow.rows[0]?.transcript || ""}\nCaller: ${speech}`.trim();
      await pool.query(
        `UPDATE call_details SET transcript = $2, updated_at = NOW() WHERE call_sid = $1`,
        [callSid, transcript]
      );
      if (appBaseUrl && callSummaryToken) {
        await fetch(`${appBaseUrl}/api/v1/calls?tenantKey=${encodeURIComponent(tenantKey)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-everycall-internal": callSummaryToken
          },
          body: JSON.stringify({
            action: "summary",
            tenantKey,
            callSid,
            summary: "Call completed.",
            extracted: { transcript }
          })
        });
      }
      res.type("text/xml").status(200).send(buildHangupResponse("Thanks. We have your details and will follow up soon."));
      return;
    }

    const prompt = await composePromptForTenant(tenantKey);
    const assistantReply = await generateAssistantReply(prompt, history, speech);
    const updatedHistory = history
      .concat({ role: "user", content: speech }, { role: "assistant", content: assistantReply })
      .slice(-12);
    const updatedTranscript = `${detailRow.rows[0]?.transcript || ""}\nCaller: ${speech}\nAssistant: ${assistantReply}`.trim();

    await pool.query(
      `UPDATE call_details
       SET state_json = $2,
           transcript = $3,
           updated_at = NOW()
       WHERE call_sid = $1`,
      [callSid, JSON.stringify({ turn, history: updatedHistory }), updatedTranscript]
    );

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'message')`,
      [callSid, tenantKey, "assistant", assistantReply]
    );

    const actionUrl = `${buildBaseUrl(req)}/v1/telnyx/texml/gather?tenantKey=${encodeURIComponent(tenantKey)}&callSid=${encodeURIComponent(callSid)}`;
    res.type("text/xml").status(200).send(buildTeXMLResponse(assistantReply, actionUrl));
  } catch (err) {
    logError("telnyx_texml_gather_error", {
      message: err instanceof Error ? err.message : "unknown"
    });
    res.type("text/xml").status(200).send(buildHangupResponse("We are unable to take your call right now."));
  }
});

app.post("/v1/telnyx/texml/transcription", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  logInfo("telnyx_texml_transcription_request", {
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
  if (!pool) {
    return res.status(200).send("ok");
  }
  try {
    const params = parseTelnyxParams(rawBody, req.header("content-type"));
    const callSid = String(params.CallSid || "unknown");
    const transcript = String(
      params.TranscriptionText || params.Transcript || params.SpeechResult || ""
    );
    const isFinal = String(params.TranscriptionStatus || params.IsFinal || "true");
    if (transcript.trim()) {
      await pool.query(
        `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
         VALUES ($1, $2, $3, $4, 'transcript')`,
        [callSid, params.TenantKey || "unknown", "caller", transcript]
      );
      await pool.query(
        `UPDATE call_details
         SET state_json = COALESCE(state_json, '{}'::jsonb) || jsonb_build_object('last_transcript', $2),
             updated_at = NOW()
         WHERE call_sid = $1`,
        [callSid, transcript]
      );
    }
    logInfo("telnyx_texml_transcription_params", {
      callSid,
      transcriptLength: transcript.trim().length,
      isFinal
    });
  } catch (err) {
    logError("telnyx_texml_transcription_error", {
      message: err instanceof Error ? err.message : "unknown"
    });
  }
  res.status(200).send("ok");
});

app.get("/v1/voice/playback/:utteranceId", (req, res) => {
  const utteranceId = String(req.params.utteranceId || "");
  const asset = playbackStore.get(utteranceId);
  if (!asset) {
    return res.status(404).send("not_found");
  }
  res.setHeader("Content-Type", asset.contentType);
  res.status(200).send(asset.buffer);
});

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

    logInfo("telnyx_call_control_initiated", {
      callSid,
      callControlId,
      to,
      from
    });

    const tenantRow = await pool.query(
      `SELECT tenant_key, status, name FROM tenants WHERE telnyx_voice_number = $1 LIMIT 1`,
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
    const companyName = tenantRow.rows[0].name || "our team";

    await pool.query(
      `INSERT INTO calls (call_sid, tenant_key, from_number, to_number, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       ON CONFLICT (call_sid)
       DO UPDATE SET from_number = EXCLUDED.from_number,
                     to_number = EXCLUDED.to_number`,
      [callSid, tenantKey, from, to]
    );

    await pool.query(
      `INSERT INTO call_details (call_sid, state_json)
       VALUES ($1, $2)
       ON CONFLICT (call_sid)
       DO UPDATE SET state_json = COALESCE(call_details.state_json, EXCLUDED.state_json)`,
      [callSid, JSON.stringify({ turn: 0, history: [] })]
    );

    const greeting = `Thanks for calling ${companyName}. I can help get you scheduled. What's your name and best callback number?`;
    const instructions = await composePromptForTenant(tenantKey);

    streamSessions.set(callControlId, {
      callControlId,
      callSid,
      tenantKey,
      greeting,
      instructions
    });
    try {
      if (callControlId) {
        await telnyxCallAction(callControlId, "answer", {});
        const streamUrl = `${toWebSocketUrl(callGatewayBaseUrl || buildBaseUrl(req))}/v1/telnyx/stream`;
        await telnyxCallAction(callControlId, "streaming_start", {
          stream_url: streamUrl,
          stream_track: "both_tracks",
          stream_bidirectional_mode: "rtp",
          stream_bidirectional_codec: "l16",
          stream_codec: "l16"
        });
      }
    } catch (err) {
      logError("telnyx_call_control_start_error", {
        message: err instanceof Error ? err.message : "unknown"
      });
    }
  }

  if (eventType === "call.transcription" || eventType === "call.transcription.updated") {
    const callControlId = String(eventPayload.call_control_id || "");
    const callSid = callControlId || String(eventPayload.call_session_id || "unknown");
    const transcript =
      String(
        eventPayload.transcription_data?.transcript ||
          eventPayload.transcription?.transcript ||
          eventPayload.transcript ||
          ""
      ) || "";
    const isFinal =
      eventPayload.transcription_data?.is_final ??
      eventPayload.transcription?.is_final ??
      eventPayload.is_final ??
      true;

    if (!transcript.trim() || !isFinal) {
      return res.status(200).send("ok");
    }

    const callRow = await pool.query(
      `SELECT tenant_key FROM calls WHERE call_sid = $1 LIMIT 1`,
      [callSid]
    );
    const tenantKey = callRow.rows[0]?.tenant_key || "";
    if (!tenantKey) {
      return res.status(200).send("ok");
    }

    const detailRow = await pool.query(
      `SELECT state_json, transcript FROM call_details WHERE call_sid = $1`,
      [callSid]
    );
    const state = detailRow.rows[0]?.state_json || { turn: 0, history: [], last_transcript: "" };
    if (state.last_transcript && state.last_transcript === transcript) {
      return res.status(200).send("ok");
    }

    state.last_transcript = transcript;
    const turn = Number(state.turn || 0) + 1;
    const history = Array.isArray(state.history) ? state.history : [];

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'transcript')`,
      [callSid, tenantKey, "caller", transcript]
    );

    const prompt = await composePromptForTenant(tenantKey);
    const assistantReply = await generateAssistantReply(prompt, history, transcript);
    const updatedHistory = history
      .concat({ role: "user", content: transcript }, { role: "assistant", content: assistantReply })
      .slice(-12);
    const updatedTranscript = `${detailRow.rows[0]?.transcript || ""}\nCaller: ${transcript}\nAssistant: ${assistantReply}`.trim();

    await pool.query(
      `UPDATE call_details
       SET state_json = $2,
           transcript = $3,
           updated_at = NOW()
       WHERE call_sid = $1`,
      [callSid, JSON.stringify({ ...state, turn, history: updatedHistory }), updatedTranscript]
    );

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'message')`,
      [callSid, tenantKey, "assistant", assistantReply]
    );

    try {
      const utteranceId = `${callSid}-turn-${turn}`;
      const audio = await synthesizeAudio(assistantReply, tenantKey, callSid, utteranceId);
      if (audio) {
        savePlaybackAsset(utteranceId, audio);
        const audioUrl = `${callGatewayBaseUrl || buildBaseUrl(req)}/v1/voice/playback/${encodeURIComponent(utteranceId)}`;
        await telnyxCallAction(callControlId, "playback_start", { audio_url: audioUrl });
      } else {
        await telnyxCallAction(callControlId, "speak", { payload: assistantReply, voice: "female" });
      }
    } catch (err) {
      logError("telnyx_call_control_playback_error", {
        message: err instanceof Error ? err.message : "unknown"
      });
    }
  }

  if (
    eventType === "call.conversation.ended" ||
    eventType === "call.conversation_ended" ||
    eventType === "call.hangup"
  ) {
    const callControlId = String(eventPayload.call_control_id || "");
    const callSid = callControlId || String(eventPayload.call_session_id || "unknown");
    await pool.query(`UPDATE calls SET status = 'completed' WHERE call_sid = $1`, [callSid]);
    if (callControlId) {
      const session = streamSessions.get(callControlId);
      if (session?.openAiWs) {
        session.openAiWs.close();
      }
      streamSessions.delete(callControlId);
    }
  }

  return res.status(200).send("ok");
});

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "call-gateway" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError("call_gateway_unhandled_error", { message: err instanceof Error ? err.message : "unknown" });
  res.status(500).json({ error: "internal_error" });
});

const server = http.createServer(app);
const streamIdToCall = new Map<string, string>();
const wss = new WebSocketServer({ server, path: "/v1/telnyx/stream" });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let payload: any = {};
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }
    const event = payload.event;
    if (event === "start") {
      const streamId = payload.stream_id;
      const callControlId = payload.start?.call_control_id || payload.start?.call_control_id;
      if (!streamId || !callControlId) return;
      const session = streamSessions.get(callControlId);
      if (!session) return;
      session.telnyxWs = ws;
      session.telnyxStreamId = streamId;
      streamIdToCall.set(streamId, callControlId);
      logInfo("telnyx_stream_started", { callSid: session.callSid, callControlId, streamId });
      if (!session.openAiWs) {
        connectOpenAiRealtime(session);
      }
      return;
    }

    if (event === "media") {
      const streamId = payload.stream_id;
      const media = payload.media || {};
      const track = media.track || "inbound";
      const encoded = media.payload || "";
      if (!streamId || !encoded) return;
      const callControlId = streamIdToCall.get(streamId);
      if (!callControlId) return;
      const session = streamSessions.get(callControlId);
      if (!session) return;
      if (track === "inbound") {
        if (session.outputActive && session.openAiWs) {
          session.outputActive = false;
          sendOpenAiEvent(session.openAiWs, { type: "response.cancel" });
        }
        sendOpenAiEvent(session.openAiWs, { type: "input_audio_buffer.append", audio: encoded });
      }
      return;
    }

    if (event === "stop") {
      const streamId = payload.stream_id;
      if (!streamId) return;
      const callControlId = streamIdToCall.get(streamId);
      if (!callControlId) return;
      const session = streamSessions.get(callControlId);
      if (session?.openAiWs) {
        session.openAiWs.close();
      }
      streamIdToCall.delete(streamId);
      return;
    }
  });
});

server.listen(env.PORT, () => {
  logInfo("call_gateway_started", {
    port: env.PORT
  });
});
