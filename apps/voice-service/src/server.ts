import express from "express";
import { readVoiceServiceEnv } from "@everycall/config";
import { logError, logInfo } from "@everycall/observability";
import { ttsSynthesizeSchema } from "@everycall/contracts";
import { synthesizeSpeech } from "@everycall/voice";

const env = readVoiceServiceEnv(process.env);
const app = express();
app.use(express.json());

const stoppedUtterances = new Set<string>();

app.post("/v1/voice/synthesize-stream", async (req, res) => {
  const parsed = ttsSynthesizeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const body = parsed.data;

  logInfo("tts_synthesize_started", {
    trace_id: body.trace_id,
    tenant_id: body.tenant_id,
    call_id: body.call_id,
    utterance_id: body.utterance_id,
    requested_provider: body.provider
  });

  const result = await synthesizeSpeech(body, {
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    elevenLabsModelId: env.ELEVENLABS_MODEL_ID
  });

  logInfo("tts_synthesize_provider_result", {
    trace_id: body.trace_id,
    call_id: body.call_id,
    utterance_id: body.utterance_id,
    provider_used: result.provider
  });

  res.setHeader("X-Utterance-Id", body.utterance_id);
  res.setHeader("X-Provider", result.provider);
  res.setHeader("Content-Type", "application/octet-stream");

  for (const chunk of result.chunks) {
    if (stoppedUtterances.has(body.utterance_id)) {
      break;
    }
    res.write(chunk);
  }

  stoppedUtterances.delete(body.utterance_id);
  return res.end();
});

app.post("/v1/voice/utterances/:utteranceId/stop", (req, res) => {
  const utteranceId = req.params.utteranceId;
  stoppedUtterances.add(utteranceId);

  logInfo("tts_utterance_stopped", { utterance_id: utteranceId });
  return res.status(202).json({ ok: true, utterance_id: utteranceId });
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "voice-service" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError("voice_service_unhandled_error", { message: err instanceof Error ? err.message : "unknown" });
  res.status(500).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  logInfo("voice_service_started", {
    port: env.PORT,
    elevenlabs_model: env.ELEVENLABS_MODEL_ID,
    elevenlabs_enabled: Boolean(env.ELEVENLABS_API_KEY)
  });
});
