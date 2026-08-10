import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const realtime = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/realtimePayloads.js")
).href);
const inboundStartup = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/inboundCallStartup.js")
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
const promptBlueprints = await import(pathToFileURL(
  path.join(process.cwd(), "packages/contracts/dist/promptBlueprints.js")
).href);
const knowledgeConfig = await import(pathToFileURL(
  path.join(process.cwd(), "pages/api/_lib/knowledgeReceptionistConfig.js")
).href);
const promptRuntime = await import(pathToFileURL(
  path.join(process.cwd(), "pages/api/_lib/promptBlueprints.js")
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
assert.equal(update.session.voice, "ara");
assert.deepEqual(update.session.reasoning, { effort: "high" });
assert.deepEqual(update.session.tools.map((tool) => tool.name), [
  "knowledge_lookup",
  "lookup_transfer_target",
  "transfer_call"
]);
assert.equal(update.session.input_audio_format, undefined);
assert.equal(update.session.output_audio_format, undefined);
assert.deepEqual(update.session.turn_detection, {
  type: "server_vad",
  threshold: 0.9,
  silence_duration_ms: 200
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

const explicitNonReasoningUpdate = realtime.buildRealtimeSessionUpdateEvent({
  instructions: "Answer quickly.",
  tools: [],
  sessionConfig: { reasoning: { effort: "none" } }
});
assert.deepEqual(explicitNonReasoningUpdate.session.reasoning, { effort: "none" });
assert.equal(explicitNonReasoningUpdate.session.voice, "ara");
assert.deepEqual(explicitNonReasoningUpdate.session.turn_detection, {
  type: "server_vad",
  threshold: 0.9,
  silence_duration_ms: 200
});

const startupOrder = [];
let releaseAnswer;
const answerGate = new Promise((resolve) => {
  releaseAnswer = resolve;
});
const inboundCallStartup = inboundStartup.beginInboundCallStartup(
  async () => {
    startupOrder.push("answer_started");
    await answerGate;
    startupOrder.push("answer_accepted");
  },
  async () => {
    startupOrder.push("bootstrap_started");
    return "session_ready";
  }
);
assert.deepEqual(startupOrder, ["answer_started", "bootstrap_started"]);
assert.equal(await inboundCallStartup.bootstrapPromise, "session_ready");
assert.deepEqual(startupOrder, ["answer_started", "bootstrap_started"]);
releaseAnswer();
await inboundCallStartup.answerPromise;
assert.deepEqual(startupOrder, ["answer_started", "bootstrap_started", "answer_accepted"]);

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
assert.equal(migration.TARGET_VOICE, "ara");
assert.equal(migration.TARGET_VAD_THRESHOLD, 0.9);
assert.equal(migration.TARGET_SILENCE_DURATION_MS, 200);
assert.equal(knowledgeConfig.DEFAULT_RUNTIME_SESSION_CONFIG.voice, "ara");
assert.equal(knowledgeConfig.DEFAULT_RUNTIME_SESSION_CONFIG.reasoning.effort, "high");
assert.equal(knowledgeConfig.DEFAULT_RUNTIME_SESSION_CONFIG.turn_detection.threshold, 0.9);
assert.equal(knowledgeConfig.DEFAULT_RUNTIME_SESSION_CONFIG.turn_detection.silence_duration_ms, 200);
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
      voice: "ara",
      reasoning: { effort: "high" },
      transcription_model: "grok-transcribe",
      turn_detection: {
        type: "server_vad",
        threshold: 0.9,
        silence_duration_ms: 200
      }
    }
  }
);

const highReasoningMigrationSql = readFileSync(
  path.join(process.cwd(), "migrations/0035_xai_high_reasoning.sql"),
  "utf8"
);
assert.match(highReasoningMigrationSql, /'\{reasoning\}'/);
assert.match(highReasoningMigrationSql, /'\{"effort":"high"\}'::jsonb/);

const araEchoMigrationSql = readFileSync(
  path.join(process.cwd(), "migrations/0036_xai_ara_echo_resistance.sql"),
  "utf8"
);
assert.match(araEchoMigrationSql, /to_jsonb\('ara'::text\)/);
assert.match(araEchoMigrationSql, /"threshold":0\.9/);

const fasterEndpointingMigrationSql = readFileSync(
  path.join(process.cwd(), "migrations/0037_xai_faster_turn_endpointing.sql"),
  "utf8"
);
assert.match(fasterEndpointingMigrationSql, /'\{turn_detection,silence_duration_ms\}'/);
assert.match(fasterEndpointingMigrationSql, /'200'::jsonb/);

const singleCompanyDescriptionMigrationSql = readFileSync(
  path.join(process.cwd(), "migrations/0038_prompt_single_company_description.sql"),
  "utf8"
);
assert.match(singleCompanyDescriptionMigrationSql, /company_description = COALESCE/);
assert.match(singleCompanyDescriptionMigrationSql, /basic_no_tool_allowed_statement = NULL/);
assert.match(singleCompanyDescriptionMigrationSql, /tenant_prompt_section_overrides/);

const newVersionQueries = [];
await promptRuntime.ensureDefaultPromptBlueprint({
  async query(sql, params = []) {
    newVersionQueries.push({ sql, params });
    if (/SELECT prompt_blueprint_id\s+FROM prompt_blueprints\s+WHERE prompt_blueprint_id/.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  }
});
const overrideCopyQuery = newVersionQueries.find(({ sql }) => /INSERT INTO tenant_prompt_section_overrides/.test(sql));
assert(overrideCopyQuery, "new prompt versions must copy tenant section overrides forward");
assert.match(overrideCopyQuery.sql, /JOIN prompt_blueprint_sections AS target_section/);
assert.match(overrideCopyQuery.sql, /AND version < \$3/);
assert.match(overrideCopyQuery.sql, /a brief general summary of the company description above/);
assert.match(overrideCopyQuery.sql, /ON CONFLICT \(tenant_key, prompt_blueprint_id, section_id\) DO NOTHING/);
assert.deepEqual(overrideCopyQuery.params, ["canonical_receptionist", "pb_canonical_receptionist_v5", 5]);

const existingVersionQueries = [];
await promptRuntime.ensureDefaultPromptBlueprint({
  async query(sql, params = []) {
    existingVersionQueries.push({ sql, params });
    if (/SELECT prompt_blueprint_id\s+FROM prompt_blueprints\s+WHERE prompt_blueprint_id/.test(sql)) {
      return { rows: [{ prompt_blueprint_id: "pb_canonical_receptionist_v5" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }
});
assert.equal(
  existingVersionQueries.some(({ sql }) => /INSERT INTO tenant_prompt_section_overrides/.test(sql)),
  false,
  "existing prompt versions must not repopulate deliberately reset overrides"
);

const promptSeed = promptBlueprints.getDefaultPromptBlueprintSeed();
assert.equal(promptSeed.version, 5);
assert.equal(promptSeed.name, "Canonical Receptionist v5");
const promptProfile = promptBlueprints.normalizeTenantPromptProfile({
  assistant_name: "Sarah",
  business_name: "Creative Dynamic",
  company_description: "Creative Dynamic helps businesses plan and build software systems.",
  opening_line: "Thanks for calling Creative Dynamic. This is Sarah. How can I help you today?",
  ai_disclosure_line: "I’m the business’s automated assistant.",
  lead_goal: "callback information",
  required_contact_fields: ["caller’s name", "caller’s best phone number"],
  closing_phrase: "Thanks for calling. Have a great rest of your day.",
  basic_no_tool_allowed_statement: "This legacy description must not be rendered."
});
const renderedPrompt = promptBlueprints.renderPromptContext(promptSeed, promptProfile, {
  companyDescription: promptProfile.company_description,
  companyDescriptionSource: "tenant_override"
}).startupPrompt;
assert.equal(
  renderedPrompt.match(/Creative Dynamic helps businesses plan and build software systems\./g)?.length,
  1,
  "the canonical prompt must render the tenant company description exactly once"
);
assert.match(renderedPrompt, /a brief general summary of the company description above/);
assert.doesNotMatch(renderedPrompt, /This legacy description must not be rendered/);
assert.equal("basic_no_tool_allowed_statement" in promptProfile, false);
assert.equal(
  promptRuntime.normalizeTenantPromptSectionOverride(
    "business_context",
    "# Business Context\n{company_description}\n- the general statement that {basic_no_tool_allowed_statement}"
  ),
  "# Business Context\n{company_description}\n- a brief general summary of the company description above"
);
for (const [businessName, companyDescription, otherDescription] of [
  ["Tenant Alpha", "Tenant Alpha repairs residential plumbing systems.", "Tenant Beta manages commercial landscaping."],
  ["Tenant Beta", "Tenant Beta manages commercial landscaping.", "Tenant Alpha repairs residential plumbing systems."]
]) {
  const tenantRenderedPrompt = promptBlueprints.renderPromptContext(
    promptSeed,
    promptBlueprints.normalizeTenantPromptProfile({
      assistant_name: "Sarah",
      business_name: businessName,
      company_description: companyDescription,
      opening_line: `Thanks for calling ${businessName}. This is Sarah. How can I help you today?`
    }),
    { companyDescription, companyDescriptionSource: "tenant_override" }
  ).startupPrompt;
  assert.equal(tenantRenderedPrompt.match(new RegExp(companyDescription.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length, 1);
  assert.doesNotMatch(tenantRenderedPrompt, new RegExp(otherDescription.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(renderedPrompt, /Discovery does not have a fixed number of turns\./);
assert.match(renderedPrompt, /briefly summarize the need in the caller’s language and confirm that you understood it correctly\./);
assert.match(renderedPrompt, /Do not suggest speaking with the team until the caller confirms the summary/);
assert.match(renderedPrompt, /Do not ask for callback information immediately after the caller’s first substantive explanation/);
assert.match(renderedPrompt, /Do not automatically append a generic reassurance, offer to help, or conversation bridge/);
assert.match(renderedPrompt, /if the caller explicitly requests a person, callback, or next step before a summary is needed/);
assert.doesNotMatch(renderedPrompt, /Use one or two short discovery turns/);
assert.doesNotMatch(renderedPrompt, /If the caller is not clearly receptive, do ONE more brief engagement turn/);

console.log(JSON.stringify({ ok: true, checked: "xai_realtime_payloads" }, null, 2));
