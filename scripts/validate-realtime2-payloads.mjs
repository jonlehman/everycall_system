import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/realtimePayloads.js")
).href;

const realtime = await import(modulePath);
const safetyIdentifier = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/openAiSafetyIdentifier.js")
).href);
const migration = await import(pathToFileURL(
  path.join(process.cwd(), "scripts/migrate-realtime2-runtime-profiles.mjs")
).href);

const sessionConfig = {
  model: "gpt-realtime-2.1",
  voice: "marin",
  max_output_tokens: 4096,
  turn_detection: {
    type: "semantic_vad",
    eagerness: "high",
    create_response: true,
    interrupt_response: true
  },
  transcription_model: "gpt-4o-mini-transcribe",
  noise_reduction: "far_field",
  input_audio_format: "g711_ulaw",
  output_audio_format: "g711_ulaw"
};

assert.equal(realtime.resolveRealtimeApiShape(undefined, "gpt-realtime-2.1"), "realtime2");
assert.equal(realtime.resolveRealtimeApiShape(undefined, "gpt-realtime-2.1-mini"), "realtime2");
assert.equal(realtime.resolveRealtimeApiShape(undefined, "gpt-realtime-2"), "realtime2");
assert.equal(realtime.resolveRealtimeApiShape("legacy", "gpt-realtime-2.1"), "legacy");
assert.equal(realtime.resolveRealtimeApiShape(undefined, "gpt-realtime-1.5"), "legacy");
assert.equal(realtime.resolveRealtimeApiShape(undefined, "gpt-realtime-20"), "legacy");

const realtime2Headers = realtime.buildOpenAiRealtimeHeaders({
  apiKey: "test_key",
  apiShape: "realtime2",
  safetyIdentifier: "hashed-user"
});
assert.equal(realtime2Headers.Authorization, "Bearer test_key");
assert.equal(realtime2Headers["OpenAI-Beta"], undefined);
assert.equal(realtime2Headers["OpenAI-Safety-Identifier"], "hashed-user");

const legacyHeaders = realtime.buildOpenAiRealtimeHeaders({
  apiKey: "test_key",
  apiShape: "legacy"
});
assert.equal(legacyHeaders["OpenAI-Beta"], "realtime=v1");

const stableCallerIdentifier = safetyIdentifier.buildStableOpenAiSafetyIdentifier({
  callerNumber: "+1 (206) 555-0199",
  tenantKey: "tenant-a",
  secret: "test-secret"
});
assert.equal(stableCallerIdentifier.length, 64);
assert.equal(
  stableCallerIdentifier,
  safetyIdentifier.buildStableOpenAiSafetyIdentifier({
    callerNumber: "+12065550199",
    tenantKey: "tenant-b",
    secret: "test-secret"
  }),
  "the same caller must keep one privacy-preserving safety identifier across calls and tenants"
);
assert.notEqual(
  stableCallerIdentifier,
  safetyIdentifier.buildStableOpenAiSafetyIdentifier({
    callerNumber: "+12065550198",
    tenantKey: "tenant-a",
    secret: "test-secret"
  }),
  "different callers must not share a safety identifier"
);
assert.equal(
  safetyIdentifier.buildStableOpenAiSafetyIdentifier({
    callerNumber: "+12065550199",
    configuredIdentifier: "operator-override",
    secret: "test-secret"
  }),
  "operator-override"
);

const realtime2Session = realtime.buildRealtimeSessionUpdateEvent({
  apiShape: "realtime2",
  instructions: "Answer clearly.",
  tools: [{ type: "function", name: "knowledge_lookup" }],
  sessionConfig
});
assert.equal(realtime2Session.type, "session.update");
assert.equal(realtime2Session.session.type, "realtime");
assert.deepEqual(realtime2Session.session.output_modalities, ["audio"]);
assert.equal(realtime2Session.session.modalities, undefined);
assert.equal(realtime2Session.session.input_audio_format, undefined);
assert.deepEqual(realtime2Session.session.audio.input.format, { type: "audio/pcmu" });
assert.deepEqual(realtime2Session.session.audio.output.format, { type: "audio/pcmu" });
assert.equal(realtime2Session.session.audio.output.voice, "marin");
assert.equal(realtime2Session.session.audio.input.transcription.model, "gpt-4o-mini-transcribe");
assert.equal(realtime2Session.session.audio.input.turn_detection.type, "semantic_vad");
assert.equal(realtime2Session.session.max_output_tokens, 4096);

const legacySession = realtime.buildRealtimeSessionUpdateEvent({
  apiShape: "legacy",
  instructions: "Answer clearly.",
  tools: [{ type: "function", name: "knowledge_lookup" }],
  sessionConfig
});
assert.deepEqual(legacySession.session.modalities, ["audio", "text"]);
assert.equal(legacySession.session.output_modalities, undefined);
assert.equal(legacySession.session.input_audio_format, "g711_ulaw");
assert.equal(legacySession.session.output_audio_format, "g711_ulaw");
assert.equal(legacySession.session.max_response_output_tokens, 4096);

const realtime2Response = realtime.buildRealtimeResponseCreateEvent({ instructions: "Say hello." }, "realtime2");
assert.equal(realtime2Response.type, "response.create");
assert.deepEqual(realtime2Response.response.output_modalities, ["audio"]);
assert.equal(realtime2Response.response.modalities, undefined);
assert.equal(realtime2Response.response.instructions, "Say hello.");

const legacyResponse = realtime.buildRealtimeResponseCreateEvent({ instructions: "Say hello." }, "legacy");
assert.deepEqual(legacyResponse.response.modalities, ["audio", "text"]);
assert.equal(legacyResponse.response.output_modalities, undefined);

assert.equal(migration.TARGET_MODEL, "gpt-realtime-2.1");
assert.deepEqual(
  migration.planProfileMigration({ tenant_key: "inherits", session_config_json: { voice: "marin" } }),
  {
    tenant_key: "inherits",
    action: "inherits_new_default",
    current_model: null,
    next_session_config_json: { voice: "marin" }
  }
);
assert.deepEqual(
  migration.planProfileMigration({
    tenant_key: "already-target",
    session_config_json: { model: "gpt-realtime-2.1", voice: "marin" }
  }),
  {
    tenant_key: "already-target",
    action: "already_target",
    current_model: "gpt-realtime-2.1",
    next_session_config_json: { model: "gpt-realtime-2.1", voice: "marin" }
  }
);
assert.deepEqual(
  migration.planProfileMigration({
    tenant_key: "previous-default",
    session_config_json: { model: "gpt-realtime-2", voice: "marin" }
  }),
  {
    tenant_key: "previous-default",
    action: "remove_previous_default_model_override",
    current_model: "gpt-realtime-2",
    next_model: "gpt-realtime-2.1",
    next_session_config_json: { voice: "marin" }
  }
);
assert.deepEqual(
  migration.planProfileMigration({
    tenant_key: "legacy-rollback",
    session_config_json: { model: "gpt-realtime-1.5", voice: "marin" }
  }),
  {
    tenant_key: "legacy-rollback",
    action: "remove_legacy_model_override",
    current_model: "gpt-realtime-1.5",
    next_model: "gpt-realtime-2.1",
    next_session_config_json: { voice: "marin" }
  }
);
assert.deepEqual(
  migration.planProfileMigration({
    tenant_key: "custom-pin",
    session_config_json: { model: "gpt-realtime-2.1-mini" }
  }),
  {
    tenant_key: "custom-pin",
    action: "manual_review",
    current_model: "gpt-realtime-2.1-mini",
    next_session_config_json: { model: "gpt-realtime-2.1-mini" }
  }
);

console.log(JSON.stringify({ ok: true, checked: "realtime2_payloads" }, null, 2));
