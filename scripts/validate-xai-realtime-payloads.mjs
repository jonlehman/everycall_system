import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const realtime = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/realtimePayloads.js")
).href);
const turnTiming = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/realtimeTurnTiming.js")
).href);
const telephony = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/telephonyStreamControl.js")
).href);
const voiceControl = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/voiceRuntimeControl.js")
).href);
const migration = await import(pathToFileURL(
  path.join(process.cwd(), "scripts/migrate-xai-runtime-profiles.mjs")
).href);

assert.deepEqual(realtime.buildXAiRealtimeHeaders("test_key"), {
  Authorization: "Bearer test_key"
});

const update = realtime.buildRealtimeSessionUpdateEvent({
  instructions: "Answer clearly.",
  tools: [
    { type: "function", name: "knowledge_lookup" },
    { type: "function", name: "lookup_transfer_target" },
    { type: "function", name: "transfer_call" }
  ],
  sessionConfig: {
    voice: "luna",
    max_output_tokens: 4096,
    turn_detection: {
      type: "semantic_vad",
      eagerness: "high",
      create_response: true,
      interrupt_response: true
    },
    input_audio_format: "g711_ulaw",
    output_audio_format: "g711_ulaw"
  }
});
assert.equal(update.type, "session.update");
assert.equal(update.session.modalities, undefined);
assert.equal(update.session.voice, "luna");
assert.deepEqual(update.session.reasoning, { effort: "none" });
assert.deepEqual(update.session.tools.map((tool) => tool.name), [
  "knowledge_lookup",
  "lookup_transfer_target",
  "transfer_call"
]);
assert.equal(update.session.input_audio_format, undefined);
assert.equal(update.session.output_audio_format, undefined);
assert.deepEqual(update.session.turn_detection, {
  type: "server_vad",
  silence_duration_ms: 350
});
assert.equal(update.session.turn_detection.eagerness, undefined);
assert.equal(update.session.turn_detection.create_response, undefined);
assert.equal(update.session.turn_detection.interrupt_response, undefined);
assert.deepEqual(update.session.audio, {
  input: {
    format: { type: "audio/pcmu" },
    transport: "json",
    transcription: {
      model: "grok-transcribe",
      language_hint: "en"
    }
  },
  output: {
    format: { type: "audio/pcmu" },
    transport: "json"
  }
});
assert.equal(update.session.max_response_output_tokens, undefined);
assert.equal(update.session.type, undefined);

const response = realtime.buildRealtimeResponseCreateEvent({ instructions: "Say hello." });
assert.deepEqual(response, { type: "response.create", response: { instructions: "Say hello." } });
assert.deepEqual(realtime.buildRealtimeResponseCreateEvent(), { type: "response.create" });

assert.equal(telephony.TELNYX_INPUT_STREAM_TRACK, "inbound_track");
assert.equal(telephony.shouldForwardTelnyxInputTrack("inbound"), true);
assert.equal(telephony.shouldForwardTelnyxInputTrack("outbound"), false);
assert.deepEqual(telephony.buildTelnyxClearEvent(), { event: "clear" });

const speakingSession = {
  outputQueue: [Buffer.alloc(160)],
  outputBuffer: Buffer.alloc(80),
  outputTimer: setInterval(() => {}, 1000),
  currentResponseId: "response_1",
  currentAssistantItemId: "item_1",
  assistantAudioActive: true,
  assistantAudioMsSent: 120
};
const interruption = voiceControl.buildAssistantInterruptionPlan(speakingSession, "caller_speech", 1000);
assert.equal(interruption.shouldInterrupt, true);
assert.deepEqual(interruption.events, []);
voiceControl.applyAssistantInterruption(speakingSession, interruption);
assert.equal(speakingSession.outputQueue.length, 0);
assert.equal(speakingSession.outputTimer, null);

const timing = turnTiming.startRealtimeTurnTiming(1000);
assert.deepEqual(turnTiming.noteRealtimeTurnResponseCreated(timing, "response_1", 1125), {
  endpoint_to_response_created_ms: 125
});
assert.deepEqual(turnTiming.finishRealtimeTurnTiming(timing, 1450), {
  response_id: "response_1",
  endpoint_to_response_created_ms: 125,
  response_created_to_first_audio_ms: 325,
  endpoint_to_first_audio_ms: 450
});

assert.equal(migration.TARGET_MODEL, "grok-voice-think-fast-2.0");
assert.deepEqual(
  migration.planProfileMigration({
    tenant_key: "legacy",
    session_config_json: {
      model: "gpt-realtime-2.1",
      voice: "marin",
      max_output_tokens: 4096,
      maxResponseOutputTokens: 4096,
      noise_reduction: "far_field",
      modalities: ["audio", "text"],
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      reasoning_effort: "high",
      transcription_model: "gpt-4o-mini-transcribe",
      turnDetection: { type: "semantic_vad" },
      turn_detection: {
        type: "semantic_vad",
        eagerness: "high",
        create_response: true,
        interrupt_response: true
      }
    }
  }),
  {
    tenant_key: "legacy",
    action: "update_to_xai",
    current_model: "gpt-realtime-2.1",
    next_session_config_json: {
      model: "grok-voice-think-fast-2.0",
      voice: "luna",
      reasoning: { effort: "none" },
      transcription_model: "grok-transcribe",
      turn_detection: {
        type: "server_vad",
        silence_duration_ms: 350
      }
    }
  }
);

console.log(JSON.stringify({ ok: true, checked: "xai_realtime_payloads" }, null, 2));
