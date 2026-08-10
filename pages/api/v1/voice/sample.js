import crypto from "node:crypto";
import WebSocket from "ws";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess, requireTenantRoles } from "../../_lib/billing.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { enforceRateLimit } from "../../_lib/rateLimit.js";
import { loadKnowledgeRuntimeProfile } from "../../_lib/knowledgeReceptionistConfig.js";

const DEFAULT_SAMPLE_TEXT = "Hi, thanks for calling. This is the Everycall assistant. How can I help you today?";
const MAX_SAMPLE_TEXT_LENGTH = 600;
const PREVIEW_TIMEOUT_MS = 20000;
const PREVIEW_SAMPLE_RATE_HZ = 24000;
const REALTIME_VOICES = new Set([
  "luna",
  "eve",
  "ara",
  "leo",
  "rex",
  "sal"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeHeaderValue(value, maxLength = 180) {
  return normalizeText(value).replace(/[^\x20-\x7E]/g, "").slice(0, maxLength);
}

function createPreviewCallId() {
  return `preview_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function createRealtimePreviewInstructions(sampleText) {
  return [
    "This is a voice preview for the business greeting.",
    "Answer the phone by speaking exactly the greeting text below and nothing else.",
    "Do not add extra words, explanations, or filler.",
    "Sound like a real person answering the business phone.",
    `Greeting text: ${sampleText}`
  ].join(" ");
}

function createWavHeader(dataLength, sampleRate, channelCount = 1, bitsPerSample = 16) {
  const blockAlign = channelCount * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

function encodePcm16Wav(pcmBuffer, sampleRate = PREVIEW_SAMPLE_RATE_HZ) {
  return Buffer.concat([createWavHeader(pcmBuffer.length, sampleRate), pcmBuffer]);
}

function buildPreviewPromptPayload(runtimeProfile, voice) {
  const sessionConfig = runtimeProfile?.session_config && typeof runtimeProfile.session_config === "object"
    ? runtimeProfile.session_config
    : {};
  return {
    system_prompt: "This is a voice preview for a business greeting. Follow the response instructions exactly and do not use any tools.",
    tool_definitions: [],
    session_config: {
      ...sessionConfig,
      voice,
      output_audio_format: "pcm16"
    }
  };
}

export function buildPreviewSessionUpdate({ instructions, promptPayload, voice }) {
  return {
    type: "session.update",
    session: {
      instructions,
      tools: Array.isArray(promptPayload.tool_definitions) ? promptPayload.tool_definitions : [],
      voice,
      reasoning: { effort: "high" },
      audio: {
        output: {
          format: { type: "audio/pcm", rate: PREVIEW_SAMPLE_RATE_HZ },
          transport: "json"
        }
      }
    }
  };
}

function buildPreviewResponseCreate(sampleText) {
  return {
    type: "response.create",
    response: {
      instructions: createRealtimePreviewInstructions(sampleText)
    }
  };
}

async function requestRealtimePreview({ apiKey, promptPayload, sampleText }) {
  return new Promise((resolve, reject) => {
    const model = "grok-voice-think-fast-2.0";
    const voice = String(promptPayload?.session_config?.voice || "ara").trim() || "ara";
    const instructions = normalizeText(promptPayload?.system_prompt);
    const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    const audioChunks = [];
    let settled = false;
    let firstServerError = "";

    const timeout = setTimeout(() => {
      fail(new Error("realtime_preview_timeout"));
    }, PREVIEW_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      ws.removeAllListeners();
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {}
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function succeed() {
      if (settled) return;
      settled = true;
      const pcmBuffer = Buffer.concat(audioChunks);
      cleanup();
      resolve({
        audioBuffer: encodePcm16Wav(pcmBuffer),
        model,
        voice,
        path: "realtime",
        format: "wav"
      });
    }

    ws.on("open", () => {
      ws.send(JSON.stringify(buildPreviewSessionUpdate({ instructions, promptPayload, voice })));
    });

    ws.on("message", (data) => {
      let event = {};
      try {
        event = JSON.parse(data.toString());
      } catch {
        return;
      }

      const type = String(event?.type || "");
      if (type === "session.updated") {
        ws.send(JSON.stringify(buildPreviewResponseCreate(sampleText)));
        return;
      }

      if (type === "error") {
        const message = normalizeText(event?.error?.message || event?.message || "realtime_preview_error");
        firstServerError = firstServerError || message;
        fail(new Error(message));
        return;
      }

      if (type === "response.output_audio.delta" || type === "response.audio.delta" || type === "output_audio.delta") {
        const audioBase64 = event?.delta || event?.audio?.delta || event?.audio?.data || event?.data || "";
        if (audioBase64) {
          audioChunks.push(Buffer.from(audioBase64, "base64"));
        }
        return;
      }

      if (type === "response.done") {
        const responseStatus = normalizeText(event?.response?.status || event?.status);
        const statusDetailsType = normalizeText(event?.response?.status_details?.type || event?.status_details?.type);
        if (responseStatus === "failed" || statusDetailsType === "failed") {
          const detail = normalizeText(
            event?.response?.status_details?.error?.message
            || event?.response?.status_details?.reason
            || firstServerError
            || "realtime_preview_failed"
          );
          fail(new Error(detail));
          return;
        }
        if (audioChunks.length > 0) {
          succeed();
          return;
        }
      }

      if (type === "response.output_audio.done" || type === "response.audio.done") {
        if (audioChunks.length > 0) {
          succeed();
        }
      }
    });

    ws.on("error", (error) => {
      fail(error instanceof Error ? error : new Error("realtime_preview_socket_error"));
    });

    ws.on("close", () => {
      if (!settled) {
        if (audioChunks.length > 0) {
          succeed();
          return;
        }
        fail(new Error(firstServerError || "realtime_preview_closed_without_audio"));
      }
    });
  });
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || body?.tenantKey || ""));
    if (session.role === "tenant") {
      const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
      if (!access) return;
    }
    const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
      message: "Only account admins and owners can generate voice previews."
    });
    if (!manager) return;

    const previewLimit = await enforceRateLimit(res, pool, {
      scope: "voice.sample_preview",
      key: `${tenantKey}:${session.role}:${session.user_id || "unknown"}`,
      maxHits: 20,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 30 * 60 * 1000,
      message: "Too many voice previews. Please try again later."
    });
    if (previewLimit?.limited) return;

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const voice = String(req.method === "POST" ? body.voice : req.query?.voice || "ara").toLowerCase();
    if (!REALTIME_VOICES.has(voice)) {
      return res.status(400).json({ error: "invalid_voice" });
    }

    const sampleText = normalizeText(req.method === "POST" ? body.text : req.query?.text || DEFAULT_SAMPLE_TEXT)
      .slice(0, MAX_SAMPLE_TEXT_LENGTH) || DEFAULT_SAMPLE_TEXT;

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "missing_xai_key" });
    }

    const runtimeProfile = await loadKnowledgeRuntimeProfile(pool, tenantKey).catch(() => null);
    const promptPayload = buildPreviewPromptPayload(runtimeProfile, voice);
    const preview = await requestRealtimePreview({
      apiKey,
      promptPayload,
      sampleText
    });

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-EveryCall-Voice-Sample-Path, X-EveryCall-Voice-Sample-Model, X-EveryCall-Voice-Sample-Voice, X-EveryCall-Voice-Sample-Format"
    );
    res.setHeader("X-EveryCall-Voice-Sample-Path", preview.path);
    res.setHeader("X-EveryCall-Voice-Sample-Model", normalizeHeaderValue(preview.model));
    res.setHeader("X-EveryCall-Voice-Sample-Voice", normalizeHeaderValue(preview.voice));
    res.setHeader("X-EveryCall-Voice-Sample-Format", preview.format);
    res.status(200).send(preview.audioBuffer);
  } catch (err) {
    return res.status(500).json({
      error: "sample_error",
      message: err?.message || "unknown"
    });
  }
}
