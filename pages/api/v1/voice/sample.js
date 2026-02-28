import { requireSession } from "../_lib/auth.js";

const DEFAULT_SAMPLE_TEXT = "Hi, thanks for calling. This is the Everycall assistant. How can I help you today?";
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
    const session = await requireSession(req, res);
    if (!session) return;

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const voice = String(req.query?.voice || "alloy").toLowerCase();
    if (!REALTIME_VOICES.has(voice)) {
      return res.status(400).json({ error: "invalid_voice" });
    }

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
        input: DEFAULT_SAMPLE_TEXT
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
