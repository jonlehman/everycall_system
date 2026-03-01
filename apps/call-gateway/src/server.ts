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
const openAiRealtimeInputFormat = process.env.OPENAI_REALTIME_INPUT_FORMAT || "g711_ulaw";
const openAiRealtimeOutputFormat = process.env.OPENAI_REALTIME_OUTPUT_FORMAT || "g711_ulaw";
const rtpPayloadType = Number(process.env.TELNYX_RTP_PAYLOAD_TYPE || "0");
const bidirectionalPayloadMode = (process.env.TELNYX_BIDIRECTIONAL_PAYLOAD_MODE || "rtp").toLowerCase();

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
  industryKey?: string;
  companyName?: string;
  telnyxStreamId?: string;
  telnyxWs?: WebSocket | undefined;
  openAiWs?: WebSocket | undefined;
  greeting?: string;
  lastTranscript?: string;
  outputActive?: boolean;
  responseActive?: boolean;
  instructions?: string;
  voiceOverride?: string;
  history?: { role: string; content: string }[];
  lastUserUtterance?: string;
  rtpSeq?: number;
  rtpTimestamp?: number;
  rtpSsrc?: number;
  outputBuffer?: Buffer;
  outputQueue?: Buffer[];
  outputTimer?: NodeJS.Timeout | undefined;
  outputPrimed?: boolean;
  lastResponseAt?: number;
  pendingCallerText?: string;
  pendingAssistantText?: string;
  pendingAssistantAudioText?: string;
  pendingAssistantFlush?: string;
  pendingAssistantFlushTimer?: NodeJS.Timeout | undefined;
  lastAssistantText?: string;
  lastResponseId?: string;
  lastResponseDoneAt?: number;
  lastUserUtteranceAt?: number;
  preCloseAsked?: boolean;
  preCloseAnswered?: boolean;
  collectedName?: string;
  collectedPhone?: string;
  collectedAddress?: string;
  collectedTime?: string;
  readyToClose?: boolean;
  faqs?: Array<{ question: string; answer: string; category: string }>;
  awaitingAnswer?: boolean;
  realtimeModel?: string;
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

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","to","of","in","on","for","with","at","by","from",
  "is","are","was","were","be","been","being","it","this","that","these","those","i","you","we","they",
  "my","your","our","their","me","us","him","her","them","as","so","do","does","did","can","could","should",
  "would","will","just","now","please","thanks","thank"
]);

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  plumbing: ["plumbing", "plumber", "leak", "leaking", "water heater", "drain", "toilet", "faucet", "pipe", "sewer", "clog"],
  cleaning: ["cleaning", "cleaner", "house cleaning", "deep clean", "maid", "move-out", "move in", "janitorial"],
  hvac: ["hvac", "air conditioning", "ac", "furnace", "heat", "cooling", "thermostat", "heat pump"],
  electrical: ["electrical", "electrician", "outlet", "panel", "breaker", "wiring", "lights", "spark"],
  roofing: ["roof", "roofing", "shingle", "leak in roof", "gutter"],
  landscaping: ["landscaping", "lawn", "mow", "mulch", "yard", "irrigation"],
  pest_control: ["pest", "pest control", "rodent", "ants", "termites", "bugs"],
  garage_door: ["garage door", "opener", "spring", "track"],
  window_installers: ["window", "glass", "window replacement", "window install"],
  locksmith: ["locksmith", "lock", "lockout", "key", "rekey"],
  general_contractor: ["remodel", "renovation", "general contractor", "construction", "addition"]
};

function normalizeText(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string) {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

function detectPhone(text: string) {
  const match = String(text || "").match(/\b(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function detectTime(text: string) {
  const lower = String(text || "").toLowerCase();
  const timeMatch = lower.match(/\b(\d{1,2})(:\d{2})?\s?(am|pm)\b/);
  if (timeMatch) return timeMatch[0];
  if (/(today|tonight|tomorrow|morning|afternoon|evening)/.test(lower)) {
    return lower.match(/(today|tonight|tomorrow|morning|afternoon|evening)/)?.[0] || "";
  }
  return "";
}

function detectAddress(text: string) {
  const lower = String(text || "").toLowerCase();
  if (!/\b\d{2,6}\b/.test(lower)) return "";
  if (
    /(street|st\b|avenue|ave\b|road|rd\b|drive|dr\b|boulevard|blvd\b|lane|ln\b|way\b|court|ct\b|circle|cir\b|place|pl\b|parkway|pkwy\b|highway|hwy\b)/.test(lower)
  ) {
    return String(text || "");
  }
  return "";
}

function detectName(text: string) {
  const cleaned = normalizeText(text);
  if (/\d/.test(cleaned)) return "";
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return "";
  if (/(name is|this is|i am|i'm)/.test(cleaned)) {
    const tail = cleaned.split(/name is|this is|i am|i'm/)[1]?.trim() || "";
    const tailParts = tail.split(" ").filter(Boolean);
    if (tailParts.length) return tailParts[0];
  }
  return parts[0] || "";
}

function isQuestionLike(text: string) {
  const lower = String(text || "").toLowerCase();
  return /\?$/.test(text.trim()) || /\b(do you|can you|could you|what|how|when|where|why|is it|are you)\b/.test(lower);
}

function detectIndustryMismatch(industryKey: string | undefined, text: string) {
  if (!industryKey) return "";
  const lower = normalizeText(text);
  const currentKeywords = INDUSTRY_KEYWORDS[industryKey] || [];
  const mentionsCurrent = currentKeywords.some((kw) => lower.includes(kw));
  for (const [key, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (key === industryKey) continue;
    if (keywords.some((kw) => lower.includes(kw))) {
      if (!mentionsCurrent) return key;
    }
  }
  return "";
}

function detectIntent(text: string) {
  const lower = normalizeText(text);
  if (/(reschedule|change time|move it|different time|another time)/.test(lower)) return "reschedule_request";
  if (/(price|cost|estimate|quote|fee|diagnostic)/.test(lower)) return "pricing_question";
  if (/(warranty|guarantee)/.test(lower)) return "warranty_question";
  if (/(insurance|claim)/.test(lower)) return "insurance_question";
  if (/(payment|pay|credit card|cash|check|apple pay|google pay)/.test(lower)) return "payment_methods_question";
  if (/(area|coverage|service area|serve|cover)/.test(lower)) return "coverage_area_question";
  if (/(schedule|appointment|availability|how soon|soon can|when can|same day|tomorrow|tonight)/.test(lower)) return "availability_question";
  if (/(what happens next|next steps|process|before you arrive|before the visit)/.test(lower)) return "process_question";
  if (/(prepare|prep|before you come|anything i should do)/.test(lower)) return "preparation_question";
  if (/(emergency|urgent|asap|right away)/.test(lower)) return "emergency_question";
  if (/(should i|how do i|can i fix|what should i do|drano|troubleshoot|diagnose)/.test(lower)) return "technical_question";
  if (isQuestionLike(text)) return "faq_business";
  return "general";
}

async function loadFaqs(session: StreamSession) {
  if (session.faqs || !pool) return session.faqs || [];
  const rows = await pool.query(
    `SELECT question, answer, category
     FROM faqs
     WHERE tenant_key = $1
     ORDER BY id ASC`,
    [session.tenantKey]
  );
  session.faqs = rows.rows || [];
  return session.faqs;
}

function scoreFaqMatch(text: string, faq: { question: string }) {
  const textTokens = new Set(tokenize(text));
  const questionTokens = tokenize(faq.question);
  let score = 0;
  for (const token of questionTokens) {
    if (textTokens.has(token)) score += 1;
  }
  return score;
}

function findBestFaq(text: string, faqs: Array<{ question: string; answer: string; category: string }>) {
  let best = null as null | { question: string; answer: string; category: string; score: number };
  for (const faq of faqs) {
    const score = scoreFaqMatch(text, faq);
    if (!best || score > best.score) {
      best = { ...faq, score };
    }
  }
  if (!best || best.score < 2) return null;
  return best;
}

function buildFaqAnswer(text: string, faqs: Array<{ question: string; answer: string; category: string }>) {
  const intent = detectIntent(text);
  const categoryMap: Record<string, string> = {
    pricing_question: "Pricing",
    warranty_question: "Warranty",
    insurance_question: "Insurance",
    payment_methods_question: "Payments",
    coverage_area_question: "Coverage",
    availability_question: "Scheduling",
    process_question: "Process",
    preparation_question: "Preparation",
    emergency_question: "Emergency"
  };
  const targetCategory = categoryMap[intent];
  const candidates = targetCategory ? faqs.filter((f) => f.category === targetCategory) : faqs;
  const best = findBestFaq(text, candidates);
  return best ? best.answer : "";
}

function buildClosing(session: StreamSession) {
  const name = session.collectedName || "there";
  const phone = session.collectedPhone || "the number you provided";
  const time = session.collectedTime || "";
  if (time) {
    return `I've got you penciled in for ${time}. Someone from our team will call you at ${phone} to confirm the details. Thanks for calling ${session.companyName || "our team"}, ${name}—talk to you soon.`;
  }
  return `Someone from our team will call you at ${phone} shortly to confirm the details. Thanks for calling ${session.companyName || "our team"}, ${name}—talk to you soon.`;
}

async function handleCallerUtterance(session: StreamSession, transcript: string) {
  const text = String(transcript || "").trim();
  if (!text) return;

  const preClosePrompt = "Do you have any other questions, or anything else I can help with?";
  const needsPreCloseFollowup = Boolean(session.preCloseAsked && !session.preCloseAnswered);

  const phone = detectPhone(text);
  const time = detectTime(text);
  const address = detectAddress(text);
  const name = detectName(text);
  if (phone) session.collectedPhone = phone;
  if (time) session.collectedTime = time;
  if (address) session.collectedAddress = address;
  if (name) session.collectedName = name;

  session.readyToClose = Boolean(session.collectedPhone && session.collectedAddress && session.collectedTime && session.collectedName);

  if (session.preCloseAsked && !session.preCloseAnswered) {
    if (isDonePhrase(text)) {
      session.preCloseAnswered = true;
      const closingText = buildClosing(session);
      sendOpenAiEvent(session.openAiWs, {
        type: "response.create",
        response: { modalities: ["audio", "text"], instructions: `Say exactly: "${closingText}"` }
      });
      return;
    }
  }

  const mismatch = detectIndustryMismatch(session.industryKey, text);
  if (mismatch) {
    const industryLabel = session.industryKey ? session.industryKey.replace(/_/g, " ") : "our services";
    const reply = `We specialize in ${industryLabel}. Are you calling about ${industryLabel} service?`;
    sendOpenAiEvent(session.openAiWs, {
      type: "response.create",
      response: { modalities: ["audio", "text"], instructions: `Say exactly: "${reply}"` }
    });
    return;
  }

  const intent = detectIntent(text);
  const faqs = await loadFaqs(session);
  const faqAnswer = buildFaqAnswer(text, faqs);

  if (intent === "technical_question") {
    const reply = "Great question — the technician will cover that when they call.";
    sendOpenAiEvent(session.openAiWs, {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions: needsPreCloseFollowup
          ? `Say exactly: "${reply}" Then ask: "${preClosePrompt}"`
          : `Say exactly: "${reply}" Then continue the call flow with the next needed question in one short sentence.`
      }
    });
    return;
  }

  if (faqAnswer) {
    sendOpenAiEvent(session.openAiWs, {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions: needsPreCloseFollowup
          ? `Say exactly: "${faqAnswer}" Then ask: "${preClosePrompt}"`
          : `Say exactly: "${faqAnswer}" Then continue the call flow with the next needed question in one short sentence.`
      }
    });
    return;
  }

  if (session.readyToClose && !session.preCloseAsked) {
    session.preCloseAsked = true;
    sendOpenAiEvent(session.openAiWs, {
      type: "response.create",
      response: { modalities: ["audio", "text"], instructions: `Say exactly: "${preClosePrompt}"` }
    });
    return;
  }

  if (needsPreCloseFollowup) {
    sendOpenAiEvent(session.openAiWs, {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions: `Answer the caller briefly, then ask: "${preClosePrompt}"`
      }
    });
    return;
  }

  sendOpenAiEvent(session.openAiWs, {
    type: "response.create",
    response: { modalities: ["audio", "text"] }
  });
}

async function flushAssistantText(session: StreamSession) {
  const text = (session.pendingAssistantFlush || "").trim();
  session.pendingAssistantFlush = "";
  session.pendingAssistantFlushTimer = undefined;
  if (!text) return;
  if (text === session.lastAssistantText) {
    return;
  }
  await pool?.query(
    `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
     VALUES ($1, $2, $3, $4, 'message')`,
    [session.callSid, session.tenantKey, "assistant", text]
  );
  await appendCombinedTranscript(session.callSid, "assistant", text);
  await pool?.query(
    `UPDATE call_details
     SET transcript = COALESCE(transcript, '') || $2,
         updated_at = NOW()
     WHERE call_sid = $1`,
    [session.callSid, `\nAssistant: ${text}`]
  );
  session.history = (session.history || [])
    .concat({ role: "assistant", content: text })
    .slice(-12);
  session.lastAssistantText = text;
}

function decodeRtpPayload(packet: Buffer): Buffer | null {
  if (packet.length < 12) return null;
  const first = packet[0];
  if (first === undefined) return null;
  const hasExtension = (first & 0x10) !== 0;
  const csrcCount = first & 0x0f;
  let headerLen = 12 + csrcCount * 4;
  if (packet.length < headerLen) return null;
  if (hasExtension) {
    if (packet.length < headerLen + 4) return null;
    const extLenWords = packet.readUInt16BE(headerLen + 2);
    headerLen += 4 + extLenWords * 4;
    if (packet.length < headerLen) return null;
  }
  return packet.subarray(headerLen);
}

function buildRtpPacket(payload: Buffer, session: StreamSession): Buffer {
  if (session.rtpSeq === undefined) {
    session.rtpSeq = Math.floor(Math.random() * 65535);
  }
  if (session.rtpTimestamp === undefined) {
    session.rtpTimestamp = Math.floor(Math.random() * 0xffffffff);
  }
  if (session.rtpSsrc === undefined) {
    session.rtpSsrc = Math.floor(Math.random() * 0xffffffff);
  }
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = rtpPayloadType & 0x7f;
  header.writeUInt16BE(session.rtpSeq, 2);
  header.writeUInt32BE(session.rtpTimestamp, 4);
  header.writeUInt32BE(session.rtpSsrc, 8);
  session.rtpSeq = (session.rtpSeq + 1) & 0xffff;
  session.rtpTimestamp = (session.rtpTimestamp + 160) >>> 0;
  return Buffer.concat([header, payload]);
}

function enqueueOutputPcm(session: StreamSession, pcmChunk: Buffer) {
  const buffer = session.outputBuffer ? Buffer.concat([session.outputBuffer, pcmChunk]) : pcmChunk;
  const frameSize = 160;
  let offset = 0;
  if (!session.outputQueue) {
    session.outputQueue = [];
  }
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
  // Pre-buffer a few frames to avoid initial underruns while keeping latency low.
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
    const base64 = payload.toString("base64");
    sendTelnyxMedia(session.telnyxWs, session.telnyxStreamId, base64);
  }, 20);
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
    logInfo("openai_realtime_session_start", {
      callSid: session.callSid,
      model: openAiRealtimeModel
    });
    sendOpenAiEvent(ws, {
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions,
        input_audio_format: openAiRealtimeInputFormat,
        output_audio_format: openAiRealtimeOutputFormat,
        voice: session.voiceOverride || openAiRealtimeVoice,
        turn_detection: {
          type: "server_vad",
          silence_duration_ms: 350,
          prefix_padding_ms: 200,
          create_response: false
        },
        input_audio_transcription: { model: "gpt-4o-mini-transcribe", language: "en" }
      }
    });

    if (session.greeting) {
      session.responseActive = true;
      sendOpenAiEvent(ws, {
        type: "response.create",
        response: {
          modalities: ["audio", "text"]
        }
      });
    }
  });

  ws.on("message", async (data) => {
    let payload: any = {};
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }
    const type = payload.type || "";
    if (type === "session.updated") {
      const model = payload?.session?.model || openAiRealtimeModel;
      session.realtimeModel = model;
      logInfo("openai_realtime_session_updated", {
        callSid: session.callSid,
        model
      });
    }
    if (type === "response.audio.delta" || type === "response.output_audio.delta" || type === "output_audio.delta") {
      const audioBase64 =
        payload.delta ||
        payload.audio?.delta ||
        payload.audio?.data ||
        payload.data ||
        "";
      if (audioBase64 && session.telnyxWs && session.telnyxStreamId) {
        session.outputActive = true;
        session.responseActive = true;
        const pcm = Buffer.from(audioBase64, "base64");
        enqueueOutputPcm(session, pcm);
      }
      return;
    }
    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      const delta = payload.delta || payload.text || payload.data || "";
      if (delta) {
        session.pendingAssistantAudioText = (session.pendingAssistantAudioText || "") + String(delta);
      }
    }
    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      const doneText = payload.transcript || payload.text || payload.data || "";
      if (doneText) {
        // Prefer the finalized transcript to avoid duplicate text from deltas.
        session.pendingAssistantAudioText = String(doneText);
      }
    }
    if (
      type === "response.output_text.delta" ||
      type === "response.text.delta" ||
      type === "output_text.delta"
    ) {
      const delta = payload.delta || payload.text || payload.data || "";
      if (delta) {
        session.pendingAssistantText = (session.pendingAssistantText || "") + String(delta);
      }
    }
    if (
      type === "response.output_text.done" ||
      type === "response.text.done" ||
      type === "output_text.done"
    ) {
      const doneText = payload.text || payload.data || "";
      if (doneText) {
        session.pendingAssistantText = String(doneText);
      }
    }
    if (type === "response.done" || type === "response.completed") {
      session.outputActive = false;
      session.responseActive = false;
      const responseId =
        payload.response?.id ||
        payload.response_id ||
        payload.id ||
        "";
      if (responseId && responseId === session.lastResponseId) {
        return;
      }
      const derivedText = extractAssistantText(payload);
      const text = (session.pendingAssistantText || derivedText || session.pendingAssistantAudioText || "").trim();
      session.pendingAssistantText = "";
      session.pendingAssistantAudioText = "";
      logInfo("openai_realtime_response_done", {
        callSid: session.callSid,
        model: session.realtimeModel || openAiRealtimeModel,
        responseId: responseId || null,
        textLength: text.length
      });
      session.lastResponseId = responseId || session.lastResponseId;
      session.lastResponseDoneAt = Date.now();
      if (text) {
        // Debounce short multi-part outputs into a single assistant message.
        session.pendingAssistantFlush = (session.pendingAssistantFlush || "").trim();
        const merged = session.pendingAssistantFlush
          ? `${session.pendingAssistantFlush} ${text}`.trim()
          : text;
        session.pendingAssistantFlush = merged;
        if (session.pendingAssistantFlushTimer) {
          clearTimeout(session.pendingAssistantFlushTimer);
        }
        session.pendingAssistantFlushTimer = setTimeout(() => {
          flushAssistantText(session).catch((err) => {
            logError("assistant_transcript_flush_failed", {
              callSid: session.callSid,
              message: err instanceof Error ? err.message : "unknown"
            });
          });
        }, 350);
        return;
      }
      if (session.lastUserUtterance) {
        logInfo("assistant_transcript_fallback_triggered", {
          callSid: session.callSid,
          responseId: responseId || null,
          lastUserUtterance: session.lastUserUtterance,
          derivedTextLength: derivedText ? derivedText.length : 0,
          pendingTextLength: session.pendingAssistantText ? session.pendingAssistantText.length : 0,
          pendingAudioTextLength: session.pendingAssistantAudioText ? session.pendingAssistantAudioText.length : 0,
          outputTextLength: Number(payload?.response?.output_text?.length || 0)
        });
        try {
          const fallbackText = await generateAssistantReply(
            session.instructions || "",
            session.history || [],
            session.lastUserUtterance
          );
          if (fallbackText) {
            await pool?.query(
              `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
               VALUES ($1, $2, $3, $4, 'message')`,
              [session.callSid, session.tenantKey, "assistant", fallbackText]
            );
            await appendCombinedTranscript(session.callSid, "assistant", fallbackText);
            await pool?.query(
              `UPDATE call_details
               SET transcript = COALESCE(transcript, '') || $2,
                   updated_at = NOW()
               WHERE call_sid = $1`,
              [session.callSid, `\nAssistant: ${fallbackText}`]
            );
            session.history = (session.history || [])
              .concat({ role: "assistant", content: fallbackText })
              .slice(-12);
            session.lastAssistantText = fallbackText;
            session.lastResponseId = responseId || session.lastResponseId;
          }
        } catch (err) {
          logError("assistant_transcript_fallback_failed", {
            callSid: session.callSid,
            message: err instanceof Error ? err.message : "unknown"
          });
        }
      }
    }
    if (type === "response.text.delta" || type === "response.output_text.delta" || type === "output_text.delta") {
      const delta = payload.delta || payload.text || payload.data || "";
      if (delta) {
        session.pendingAssistantText = (session.pendingAssistantText || "") + String(delta);
      }
    }
    if (type === "response.output_text.done" || type === "output_text.done") {
      const doneText = payload.text || payload.data || payload.output_text || "";
      if (doneText) {
        // Prefer the finalized text to avoid duplicate text from deltas.
        session.pendingAssistantText = String(doneText);
      }
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      const delta = payload.delta || payload.transcript || payload.text || "";
      if (delta) {
        session.pendingCallerText = (session.pendingCallerText || "") + String(delta);
      }
    }
    if (
      type === "conversation.item.input_audio_transcription.completed" ||
      type === "input_audio_transcription.completed"
    ) {
      const transcript =
        payload.transcript ||
        payload.text ||
        payload.data?.transcript ||
        payload.data?.text ||
        session.pendingCallerText ||
        "";
      session.pendingCallerText = "";
      if (transcript) {
        await pool?.query(
          `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
           VALUES ($1, $2, $3, $4, 'message')`,
          [session.callSid, session.tenantKey, "caller", String(transcript)]
        );
        await appendCombinedTranscript(session.callSid, "caller", String(transcript));
        session.history = (session.history || [])
          .concat({ role: "user", content: String(transcript) })
          .slice(-12);
        session.lastUserUtterance = String(transcript);
        session.lastUserUtteranceAt = Date.now();
        await pool?.query(
          `UPDATE call_details
           SET transcript = COALESCE(transcript, '') || $2,
               updated_at = NOW()
           WHERE call_sid = $1`,
          [session.callSid, `\nCaller: ${transcript}`]
        );
        await handleCallerUtterance(session, String(transcript));
      }
    }
    // With server VAD auto-response enabled, we do not manually create responses here.
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

function buildDefaultGreeting(companyName: string, agentName: string) {
  return `Hi, thanks for calling ${companyName}. This is ${agentName}, how can I help you?`;
}

function extractAssistantText(payload: any): string {
  const direct = payload?.response?.output_text || payload?.response?.text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = payload?.response?.output;
  if (Array.isArray(output)) {
    const parts: string[] = [];
    for (const item of output) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "output_text" && typeof c.text === "string") {
            parts.push(c.text);
          }
        }
      }
    }
    const joined = parts.join("").trim();
    if (joined) return joined;
  }
  return "";
}

async function appendCombinedTranscript(callSid: string, role: string, text: string) {
  if (!pool || !callSid || !text) return;
  const firstChar = role ? role[0] : "";
  const safeRole = firstChar ? firstChar.toUpperCase() + role.slice(1) : "Speaker";
  try {
    await pool.query(
      `UPDATE call_details
       SET transcript_combined = COALESCE(transcript_combined, '') || $2,
           updated_at = NOW()
       WHERE call_sid = $1`,
      [callSid, `\n${safeRole}: ${text}`]
    );
  } catch (err) {
    logError("transcript_combined_update_failed", {
      callSid,
      message: err instanceof Error ? err.message : "unknown"
    });
  }
}

async function composePromptForTenant(tenantKey: string, greeting?: string) {
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
  const singleUseGreeting = greeting
    ? `Begin the conversation with: "${greeting}". Do not repeat it.`
    : "";
  sections.push(format("Single use greeting: begin the conversation with this. do not repeat it", singleUseGreeting));
  const toneOverride =
    "Always speak in a warm, inviting, lightly playful, leaning-in manner while staying professional. Avoid an announcer or broadcast cadence; aim for a softer, closer-mic delivery with lower energy and gentle warmth. Use contractions and natural phrasing. Do not mirror urgency or intensity from the caller; acknowledge briefly, then continue at a steady, soothing pace. Avoid pet names or overly intimate language unless the caller uses them first.";
  sections.push(format("TONE OVERRIDE (highest priority)", toneOverride));
  sections.push(format("SYSTEM EMERGENCY PHRASE", systemParts.rows[0]?.global_emergency_phrase));
  const basePersonality = systemParts.rows[0]?.personality_prompt || "";
  const voiceTone =
    "Deliver speech with a warm, inviting, understanding tone. Avoid being insistent or pushy; keep a calm, helpful pace. Do not interrupt; allow the caller to finish and tolerate short pauses.";
  const personalityWithTone = basePersonality
    ? `${basePersonality}\n\n${voiceTone}`
    : voiceTone;
  sections.push(format("PERSONALITY", personalityWithTone));
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
      `SELECT tenant_key, status, name, industry
       FROM tenants
       WHERE telnyx_voice_number = $1
       LIMIT 1`,
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
    const industryKey = tenantRow.rows[0].industry || undefined;
    const agentRow = await pool.query(
      `SELECT agent_name, greeting_text, voice_type FROM agents WHERE tenant_key = $1 LIMIT 1`,
      [tenantKey]
    );
    const agentName = agentRow.rows[0]?.agent_name || "our team";
    const greetingText = agentRow.rows[0]?.greeting_text || "";
    const voiceType = agentRow.rows[0]?.voice_type || "";

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

    const greeting =
      greetingText.trim() ||
      buildDefaultGreeting(companyName, agentName);

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'message')`,
      [callSid, tenantKey, "assistant", greeting]
    );
    await appendCombinedTranscript(callSid, "assistant", greeting);
    await pool.query(
      `UPDATE call_details
       SET transcript = COALESCE(transcript, '') || $2,
           updated_at = NOW()
       WHERE call_sid = $1`,
      [callSid, `\nAssistant: ${greeting}`]
    );
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
    await appendCombinedTranscript(callSid, "caller", speech);

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
    await appendCombinedTranscript(callSid, "assistant", assistantReply);

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
      await appendCombinedTranscript(callSid, "caller", transcript);
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
    const agentRow = await pool.query(
      `SELECT agent_name, greeting_text, voice_type FROM agents WHERE tenant_key = $1 LIMIT 1`,
      [tenantKey]
    );
    const agentName = agentRow.rows[0]?.agent_name || "our team";
    const greetingText = agentRow.rows[0]?.greeting_text || "";
    const voiceType = agentRow.rows[0]?.voice_type || "";

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

    const greeting =
      greetingText.trim() ||
      buildDefaultGreeting(companyName, agentName);
    const instructions = await composePromptForTenant(tenantKey, greeting);

    streamSessions.set(callControlId, {
      callControlId,
      callSid,
      tenantKey,
      industryKey,
      companyName,
      greeting,
      instructions,
      ...(voiceType ? { voiceOverride: voiceType } : {}),
      awaitingAnswer: true
    });
    try {
      if (callControlId) {
        await telnyxCallAction(callControlId, "answer", {});
      }
    } catch (err) {
      logError("telnyx_call_control_start_error", {
        message: err instanceof Error ? err.message : "unknown"
      });
    }
  }

  if (eventType === "call.answered") {
    const callControlId = String(eventPayload.call_control_id || "");
    const session = callControlId ? streamSessions.get(callControlId) : undefined;
    if (callControlId && session?.awaitingAnswer) {
      session.awaitingAnswer = false;
      try {
        const streamUrl = `${toWebSocketUrl(callGatewayBaseUrl || buildBaseUrl(req))}/v1/telnyx/stream`;
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
          message: err instanceof Error ? err.message : "unknown"
        });
      }
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
    await appendCombinedTranscript(callSid, "caller", transcript);

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
    await appendCombinedTranscript(callSid, "assistant", assistantReply);

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
      session.outputBuffer = Buffer.alloc(0);
      session.outputActive = false;
      session.responseActive = false;
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
        // Telnyx streaming payload is raw audio (RTP payload) for the selected codec.
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
