import assert from "node:assert/strict";
import { buildDemoRealtimeSessionPayload } from "../pages/api/_lib/demoRealtimeSession.js";
import {
  buildPreviewSessionUpdate,
  isRealtime2Model,
  resolveRealtimeApiShape
} from "../pages/api/v1/voice/sample.js";

const ENV_KEYS = [
  "OPENAI_DEMO_REALTIME_MODEL",
  "OPENAI_REALTIME_MODEL",
  "OPENAI_DEMO_REALTIME_VOICE",
  "OPENAI_REALTIME_VOICE"
];
const originalEnvironment = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearTestEnvironment() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function assertNestedRealtimeSession(payload, expectedModel) {
  assert.equal(payload.model, expectedModel);
  assert.equal(payload.session.type, "realtime");
  assert.equal(payload.session.model, expectedModel);
  assert.equal(payload.session.audio.output.voice, payload.voice);
  assert.equal(payload.session.audio.input.turn_detection.type, "semantic_vad");
  assert.equal(Object.hasOwn(payload.session, "modalities"), false);
  assert.equal(Object.hasOwn(payload.session, "output_audio_format"), false);
}

try {
  clearTestEnvironment();
  assertNestedRealtimeSession(buildDemoRealtimeSessionPayload({ businessName: "Example Co" }), "gpt-realtime-2.1");

  process.env.OPENAI_REALTIME_MODEL = "gpt-realtime-1.5";
  assertNestedRealtimeSession(buildDemoRealtimeSessionPayload(), "gpt-realtime-2.1");

  process.env.OPENAI_DEMO_REALTIME_MODEL = "gpt-realtime-1.5";
  process.env.OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";
  assertNestedRealtimeSession(buildDemoRealtimeSessionPayload(), "gpt-realtime-1.5");

  clearTestEnvironment();
  process.env.OPENAI_REALTIME_MODEL = "gpt-realtime";
  assertNestedRealtimeSession(buildDemoRealtimeSessionPayload(), "gpt-realtime-2.1");

  process.env.OPENAI_DEMO_REALTIME_MODEL = "gpt-realtime-2.1-preview";
  assertNestedRealtimeSession(buildDemoRealtimeSessionPayload(), "gpt-realtime-2.1-preview");

  clearTestEnvironment();
  process.env.OPENAI_DEMO_REALTIME_MODEL = "gpt-realtime";
  assertNestedRealtimeSession(buildDemoRealtimeSessionPayload(), "gpt-realtime-2.1");

  assert.equal(isRealtime2Model("gpt-realtime-2.1"), true);
  assert.equal(resolveRealtimeApiShape("auto", "gpt-realtime-2.1"), "realtime2");
  assert.equal(resolveRealtimeApiShape("legacy", "gpt-realtime-2.1"), "legacy");

  const previewSessionUpdate = buildPreviewSessionUpdate({
    apiShape: "realtime2",
    instructions: "Preview greeting only.",
    promptPayload: { tool_definitions: [], session_config: { max_output_tokens: 512 } },
    voice: "marin"
  });
  assert.deepEqual(previewSessionUpdate.session.output_modalities, ["audio"]);
  assert.deepEqual(previewSessionUpdate.session.audio.output.format, { type: "audio/pcm", rate: 24000 });
  assert.equal(previewSessionUpdate.session.audio.output.voice, "marin");
  assert.equal(Object.hasOwn(previewSessionUpdate.session, "modalities"), false);
  assert.equal(Object.hasOwn(previewSessionUpdate.session, "output_audio_format"), false);

  console.log("Demo Realtime session validation passed.");
} finally {
  restoreEnvironment();
}
