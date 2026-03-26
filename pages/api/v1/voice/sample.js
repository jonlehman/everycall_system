import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { loadPromptRuntimeContext } from "../../_lib/promptBlueprints.js";

const DEFAULT_SAMPLE_TEXT = "Hi, thanks for calling. This is the Everycall assistant. How can I help you today?";
const MAX_SAMPLE_TEXT_LENGTH = 600;
const MAX_TTS_INSTRUCTIONS_LENGTH = 2000;
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

function buildTtsInstructions(promptRuntime, sampleText = "") {
  const renderedSections = Array.isArray(promptRuntime?.rendered?.renderedSections)
    ? promptRuntime.rendered.renderedSections
    : [];
  const byId = new Map(renderedSections.map((section) => [normalizeText(section?.section_id), normalizeText(section?.text)]));
  const styleSections = [
    byId.get("personality_tone"),
    byId.get("conversational_attunement"),
    byId.get("wording_preferences"),
    byId.get("closing")
  ].filter(Boolean);

  const styleLines = styleSections
    .flatMap((sectionText) => sectionText.split("\n"))
    .map((line) => normalizeText(line.replace(/^#+\s*/, "").replace(/^-+\s*/, "")))
    .filter((line) => line && !/:$/.test(line));

  const assistantName = normalizeText(promptRuntime?.tenantProfile?.assistant_name);
  const businessName = normalizeText(promptRuntime?.tenantProfile?.business_name);
  const prelude = [
    assistantName && businessName
      ? `Speak as ${assistantName}, the live phone receptionist for ${businessName}.`
      : "Speak as a live business phone receptionist.",
    "Read the provided text exactly as written.",
    "Match the live receptionist's warmth, pacing, personality, and prosody."
  ].filter(Boolean);

  const combined = [...prelude, ...styleLines].join(" ");
  return normalizeText(combined).slice(0, MAX_TTS_INSTRUCTIONS_LENGTH) || `Read this exactly as written: ${normalizeText(sampleText)}`;
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

    let ttsInstructions = "";
    if (tenantKey) {
      try {
        const promptRuntime = await loadPromptRuntimeContext(pool, tenantKey);
        ttsInstructions = buildTtsInstructions(promptRuntime, sampleText);
      } catch {
        ttsInstructions = "";
      }
    }

    let resp = await requestSpeech({
      apiKey,
      voice,
      sampleText,
      instructions: ttsInstructions
    });

    if (!resp.ok && ttsInstructions) {
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
    res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: "sample_error", message: err?.message || "unknown" });
  }
}
