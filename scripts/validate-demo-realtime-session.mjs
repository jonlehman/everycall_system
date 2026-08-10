import assert from "node:assert/strict";
import { buildDemoRealtimeSessionPayload } from "../pages/api/_lib/demoRealtimeSession.js";
import { buildPreviewSessionUpdate } from "../pages/api/v1/voice/sample.js";

const payload = buildDemoRealtimeSessionPayload({ businessName: "Example Co" });
assert.equal(payload.model, "grok-voice-think-fast-2.0");
assert.equal(payload.voice, "ara");
assert.equal(payload.session.model, undefined);
assert.equal(payload.session.modalities, undefined);
assert.equal(payload.session.voice, "ara");
assert.deepEqual(payload.session.reasoning, { effort: "high" });
assert.deepEqual(payload.session.turn_detection, {
  type: "server_vad",
  threshold: 0.9,
  silence_duration_ms: 350
});
assert.equal(payload.session.audio.input.transcription.model, "grok-transcribe");
assert.deepEqual(payload.session.audio.input.format, { type: "audio/pcm", rate: 24000 });
assert.deepEqual(payload.session.audio.output.format, { type: "audio/pcm", rate: 24000 });
assert.equal(payload.session.type, undefined);

process.env.XAI_DEMO_REALTIME_VOICE = "luna";
assert.equal(buildDemoRealtimeSessionPayload().voice, "ara");
delete process.env.XAI_DEMO_REALTIME_VOICE;

const preview = buildPreviewSessionUpdate({
  instructions: "Preview greeting only.",
  promptPayload: { tool_definitions: [], session_config: {} },
  voice: "rex"
});
assert.equal(preview.session.modalities, undefined);
assert.equal(preview.session.output_audio_format, undefined);
assert.equal(preview.session.voice, "rex");
assert.deepEqual(preview.session.reasoning, { effort: "high" });
assert.deepEqual(preview.session.audio.output.format, { type: "audio/pcm", rate: 24000 });
assert.equal(preview.session.max_response_output_tokens, undefined);

console.log("xAI demo Realtime session validation passed.");
