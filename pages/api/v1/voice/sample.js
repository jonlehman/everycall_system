import { requireSession } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";

const DEFAULT_SAMPLE_TEXT = "Hi, thanks for calling. This is the Everycall assistant. How can I help you today?";
const MAX_SAMPLE_TEXT_LENGTH = 600;
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

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);
    const session = await requireSession(req, res);
    if (!session) return;
    if (session.role === "tenant") {
      const access = await requireTenantBillingAccess(res, pool, session, String(session.tenant_key || ""));
      if (!access) return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const voice = String(req.method === "POST" ? body.voice : req.query?.voice || "alloy").toLowerCase();
    if (!REALTIME_VOICES.has(voice)) {
      return res.status(400).json({ error: "invalid_voice" });
    }
    const sampleText = String(req.method === "POST" ? body.text : req.query?.text || DEFAULT_SAMPLE_TEXT)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SAMPLE_TEXT_LENGTH) || DEFAULT_SAMPLE_TEXT;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "missing_openai_key" });
    }

    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        format: "mp3",
        input: sampleText
      })
    });

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
