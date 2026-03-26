import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";

const DEFAULT_SAMPLE_TEXT = "Hi, thanks for calling. This is the Everycall assistant. How can I help you today?";
const MAX_SAMPLE_TEXT_LENGTH = 600;
const SAMPLE_TTS_INSTRUCTIONS = [
  "Speak as a live business phone receptionist answering an incoming call.",
  "Sound natural, warm, conversational, and confident.",
  "Do not sound like a narrator, announcer, or commercial voiceover.",
  "Begin like you just picked up the phone.",
  "Read the provided text exactly as written."
].join(" ");
const REALTIME_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeHeaderValue(value, maxLength = 180) {
  return normalizeText(value).replace(/[^\x20-\x7E]/g, "").slice(0, maxLength);
}

async function requestSpeech({ apiKey, voice, sampleText, instructions }) {
  return fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      format: "mp3",
      input: sampleText,
      ...(instructions ? { instructions } : {})
    })
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

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const voice = String(req.method === "POST" ? body.voice : req.query?.voice || "alloy").toLowerCase();
    if (!REALTIME_VOICES.has(voice)) {
      return res.status(400).json({ error: "invalid_voice" });
    }
    const sampleText = normalizeText(req.method === "POST" ? body.text : req.query?.text || DEFAULT_SAMPLE_TEXT)
      .slice(0, MAX_SAMPLE_TEXT_LENGTH) || DEFAULT_SAMPLE_TEXT;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "missing_openai_key" });
    }

    let firstAttemptStatus = 0;
    let firstAttemptUsedInstructions = true;
    let fallbackUsed = false;
    let firstAttemptError = "";
    let resp = await requestSpeech({
      apiKey,
      voice,
      sampleText,
      instructions: SAMPLE_TTS_INSTRUCTIONS
    });
    firstAttemptStatus = resp.status;

    if (!resp.ok) {
      firstAttemptError = normalizeHeaderValue(await resp.text());
      fallbackUsed = true;
      firstAttemptUsedInstructions = false;
      resp = await requestSpeech({
        apiKey,
        voice,
        sampleText,
        instructions: ""
      });
    }

    if (!resp.ok) {
      const errorText = await resp.text();
      return res.status(502).json({ error: "tts_failed", detail: errorText });
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-EveryCall-TTS-Instructions-Attempted, X-EveryCall-TTS-Instructions-Used, X-EveryCall-TTS-Fallback-Used, X-EveryCall-TTS-First-Status, X-EveryCall-TTS-First-Error"
    );
    res.setHeader("X-EveryCall-TTS-Instructions-Attempted", "true");
    res.setHeader("X-EveryCall-TTS-Instructions-Used", firstAttemptUsedInstructions ? "true" : "false");
    res.setHeader("X-EveryCall-TTS-Fallback-Used", fallbackUsed ? "true" : "false");
    res.setHeader("X-EveryCall-TTS-First-Status", String(firstAttemptStatus || 0));
    if (firstAttemptError) {
      res.setHeader("X-EveryCall-TTS-First-Error", firstAttemptError);
    }
    res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: "sample_error", message: err?.message || "unknown" });
  }
}
