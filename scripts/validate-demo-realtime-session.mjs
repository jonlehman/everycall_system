import assert from "node:assert/strict";
import { buildDemoRealtimeSessionPayload } from "../pages/api/_lib/demoRealtimeSession.js";
import { buildPreviewSessionUpdate } from "../pages/api/v1/voice/sample.js";

const originalVoice = process.env.XAI_DEMO_REALTIME_VOICE;
try {
  delete process.env.XAI_DEMO_REALTIME_VOICE;
  const payload = buildDemoRealtimeSessionPayload({ businessName: "Example Co" });
  assert.equal(payload.model, "grok-voice-think-fast-2.0");
  assert.equal(payload.voice, "eve");
  assert.equal(payload.session.model, undefined);
  assert.deepEqual(payload.session.modalities, ["audio", "text"]);
  assert.equal(payload.session.voice, "eve");
  assert.equal(payload.session.turn_detection.type, "server_vad");
  assert.equal(payload.session.input_audio_transcription.model, "grok-transcribe");
  assert.equal(payload.session.type, undefined);
  assert.equal(payload.session.audio, undefined);

  process.env.XAI_DEMO_REALTIME_VOICE = "ara";
  assert.equal(buildDemoRealtimeSessionPayload().voice, "ara");

  const preview = buildPreviewSessionUpdate({
    instructions: "Preview greeting only.",
    promptPayload: { tool_definitions: [], session_config: { max_output_tokens: 512 } },
    voice: "rex"
  });
  assert.deepEqual(preview.session.modalities, ["audio", "text"]);
  assert.equal(preview.session.output_audio_format, "pcm16");
  assert.equal(preview.session.voice, "rex");
  assert.equal(preview.session.max_response_output_tokens, 512);
  assert.equal(preview.session.audio, undefined);

  console.log("xAI demo Realtime session validation passed.");
} finally {
  if (originalVoice === undefined) delete process.env.XAI_DEMO_REALTIME_VOICE;
  else process.env.XAI_DEMO_REALTIME_VOICE = originalVoice;
}
