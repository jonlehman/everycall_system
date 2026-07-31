import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const realtime = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/realtimePayloads.js")
).href);
const migration = await import(pathToFileURL(
  path.join(process.cwd(), "scripts/migrate-xai-runtime-profiles.mjs")
).href);

assert.deepEqual(realtime.buildXAiRealtimeHeaders("test_key"), {
  Authorization: "Bearer test_key"
});

const update = realtime.buildRealtimeSessionUpdateEvent({
  instructions: "Answer clearly.",
  tools: [{ type: "function", name: "knowledge_lookup" }],
  sessionConfig: {
    voice: "eve",
    max_output_tokens: 4096,
    turn_detection: { type: "semantic_vad" },
    input_audio_format: "g711_ulaw",
    output_audio_format: "g711_ulaw"
  }
});
assert.equal(update.type, "session.update");
assert.deepEqual(update.session.modalities, ["audio", "text"]);
assert.equal(update.session.voice, "eve");
assert.equal(update.session.input_audio_format, "g711_ulaw");
assert.equal(update.session.output_audio_format, "g711_ulaw");
assert.equal(update.session.turn_detection.type, "server_vad");
assert.equal(update.session.input_audio_transcription.model, "grok-transcribe");
assert.equal(update.session.max_response_output_tokens, 4096);
assert.equal(update.session.audio, undefined);
assert.equal(update.session.type, undefined);

const response = realtime.buildRealtimeResponseCreateEvent({ instructions: "Say hello." });
assert.deepEqual(response.response.modalities, ["audio", "text"]);
assert.equal(response.response.instructions, "Say hello.");

assert.equal(migration.TARGET_MODEL, "grok-voice-think-fast-2.0");
assert.deepEqual(
  migration.planProfileMigration({
    tenant_key: "legacy",
    session_config_json: {
      model: "gpt-realtime-2.1",
      voice: "marin",
      transcription_model: "gpt-4o-mini-transcribe"
    }
  }),
  {
    tenant_key: "legacy",
    action: "update_to_xai",
    current_model: "gpt-realtime-2.1",
    next_session_config_json: {
      model: "grok-voice-think-fast-2.0",
      voice: "eve",
      transcription_model: "grok-transcribe",
      turn_detection: {
        type: "server_vad",
        create_response: true,
        interrupt_response: true
      }
    }
  }
);

console.log(JSON.stringify({ ok: true, checked: "xai_realtime_payloads" }, null, 2));
