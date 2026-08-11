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
const knowledgeRuntime = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/knowledgeRuntime.js")
).href);
const telephony = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/telephonyStreamControl.js")
).href);
const voiceControl = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/voiceRuntimeControl.js")
).href);
const audioPumpTelemetry = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/audioPumpTelemetry.js")
).href);
const knowledgeLookupTelemetry = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/knowledgeLookupTelemetry.js")
).href);
const finishSessionPolicy = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/finishSessionPolicy.js")
).href);
const migration = await import(pathToFileURL(
  path.join(process.cwd(), "scripts/migrate-xai-runtime-profiles.mjs")
).href);
const promptBlueprints = await import(pathToFileURL(
  path.join(process.cwd(), "packages/contracts/dist/promptBlueprints.js")
).href);
const callTranscript = await import(pathToFileURL(
  path.join(process.cwd(), "packages/contracts/dist/callTranscript.js")
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

const cumulativeCallerRows = [
  { role: "assistant", text: "How can I help?", event_type: "message" },
  { role: "caller", text: "Well, it worked.", event_type: "message" },
  { role: "caller", text: "Well, it works.", event_type: "message" },
  { role: "caller", text: "Well, it works. But sometimes it'll error out.", event_type: "message" },
  { role: "caller", text: "Well, it works. But sometimes it'll error out.", event_type: "message" },
  { role: "assistant", text: "Let me check on that for you.", event_type: "message" },
  { role: "assistant", text: "Yes, this fits what we do.", event_type: "message" }
];
assert.equal(
  callTranscript.buildTranscriptFromEvents(cumulativeCallerRows),
  [
    "Assistant: How can I help?",
    "Caller: Well, it works. But sometimes it'll error out.",
    "Assistant: Let me check on that for you.",
    "Assistant: Yes, this fits what we do."
  ].join("\n")
);
assert.equal(
  callTranscript.sanitizeTranscriptText([
    "Caller: 4 2",
    "Caller: 4 2 5 6 1 5",
    "Caller: 4 2 5 6 1 5 4 6 4 zero",
    "Caller: 4 2 5 6 1 5 4 6 4 zero"
  ].join("\n")),
  "Caller: 4 2 5 6 1 5 4 6 4 zero"
);
assert.equal(
  callTranscript.sanitizeTranscriptText([
    "Caller: I need help with billing.",
    "Caller: I also have a support question.",
    "Caller: I want to talk to Sarah.",
    "Caller: I want to talk to someone else."
  ].join("\n")),
  [
    "Caller: I need help with billing.",
    "Caller: I also have a support question.",
    "Caller: I want to talk to Sarah.",
    "Caller: I want to talk to someone else."
  ].join("\n"),
  "separate same-speaker thoughts must not be collapsed"
);
assert.equal(
  callTranscript.sanitizeTranscriptText([
    "Caller: Necesito ayuda.",
    "Caller: Necesito ayuda con mi cuenta."
  ].join("\n")),
  "Caller: Necesito ayuda con mi cuenta.",
  "multilingual cumulative snapshots must be collapsed"
);
assert.equal(
  callTranscript.sanitizeTranscriptText([
    "Caller: I need a plumber today.",
    "Caller: I need a plumber."
  ].join("\n")),
  "Caller: I need a plumber.",
  "a later corrected snapshot may be shorter than an earlier update"
);
assert.equal(
  callTranscript.sanitizeTranscriptText([
    "Assistant: We can help.",
    "Assistant: We can help. Let me check the details."
  ].join("\n")),
  [
    "Assistant: We can help.",
    "Assistant: We can help. Let me check the details."
  ].join("\n"),
  "assistant messages must never be treated as caller transcription snapshots"
);

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

const tenantAlphaGreeting = realtime.buildRealtimeForceMessageEvent(
  "Thanks for calling Tenant Alpha. This is Ava. How can I help you today?"
);
const tenantBetaGreeting = realtime.buildRealtimeForceMessageEvent(
  "Thanks for calling Tenant Beta. This is Ben. How can I help you today?"
);
assert.deepEqual(tenantAlphaGreeting, {
  type: "conversation.item.create",
  item: {
    type: "force_message",
    role: "assistant",
    interruptible: true,
    content: [{
      type: "output_text",
      text: "Thanks for calling Tenant Alpha. This is Ava. How can I help you today?"
    }]
  }
});
assert.equal(tenantAlphaGreeting.type, "conversation.item.create");
assert.notEqual(tenantAlphaGreeting.item.content[0].text, tenantBetaGreeting.item.content[0].text);
assert.doesNotMatch(tenantAlphaGreeting.item.content[0].text, /Tenant Beta|Ben/);
assert.doesNotMatch(tenantBetaGreeting.item.content[0].text, /Tenant Alpha|Ava/);
assert.throws(
  () => realtime.buildRealtimeForceMessageEvent("   "),
  /force_message_text_required/
);

const gatewayPromptPayload = {
  system_prompt: "Answer naturally.",
  tenant_greeting: "Thanks for calling Tenant Alpha.",
  tool_definitions: [],
  knowledge_runtime: { active_build_id: "kb_1" }
};
assert.equal(
  knowledgeRuntime.validateGatewayPromptPayload(gatewayPromptPayload).tenant_greeting,
  "Thanks for calling Tenant Alpha."
);
assert.throws(
  () => knowledgeRuntime.validateGatewayPromptPayload({ ...gatewayPromptPayload, tenant_greeting: "" }),
  /invalid_gateway_prompt_payload/
);
assert.doesNotMatch(
  knowledgeRuntime.buildGatewaySessionInstructions(gatewayPromptPayload),
  /# Transfer Rules/
);
assert.doesNotMatch(
  knowledgeRuntime.buildGatewaySessionInstructions({
    ...gatewayPromptPayload,
    tool_definitions: [{ type: "function", name: "lookup_transfer_target" }]
  }),
  /# Transfer Rules/
);
assert.match(
  knowledgeRuntime.buildGatewaySessionInstructions({
    ...gatewayPromptPayload,
    tool_definitions: [
      { type: "function", name: "lookup_transfer_target" },
      { type: "function", name: "transfer_call" }
    ]
  }),
  /# Transfer Rules/
);

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
assert.match(overrideCopyQuery.sql, /WHERE source\.section_id <> 'wording_preferences'/);
assert.match(overrideCopyQuery.sql, /ON CONFLICT \(tenant_key, prompt_blueprint_id, section_id\) DO NOTHING/);
assert.deepEqual(overrideCopyQuery.params, ["canonical_receptionist", "pb_canonical_receptionist_v7", 7]);

const existingVersionQueries = [];
await promptRuntime.ensureDefaultPromptBlueprint({
  async query(sql, params = []) {
    existingVersionQueries.push({ sql, params });
    if (/SELECT prompt_blueprint_id\s+FROM prompt_blueprints\s+WHERE prompt_blueprint_id/.test(sql)) {
      return { rows: [{ prompt_blueprint_id: "pb_canonical_receptionist_v7" }], rowCount: 1 };
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
assert.equal(promptSeed.version, 7);
assert.equal(promptSeed.name, "Canonical Receptionist v7");
const canonicalSectionText = promptSeed.sections.map((section) => section.default_text).join("\n");
assert.doesNotMatch(canonicalSectionText, /\bSarah\b|Creative Dynamic|Seattle|Oof/i);
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
assert.match(renderedPrompt, /You may speak from memory only about this general description/);
assert.doesNotMatch(renderedPrompt, /This legacy description must not be rendered/);
assert.doesNotMatch(
  renderedPrompt,
  /Thanks for calling Creative Dynamic\. This is Sarah\. How can I help you today\?/
);
assert.equal("basic_no_tool_allowed_statement" in promptProfile, false);
assert.equal(
  promptRuntime.normalizeTenantPromptSectionOverride(
    "business_context",
    "# Business Context\n{company_description}\n- the general statement that {basic_no_tool_allowed_statement}"
  ),
  "# Business Context\n{company_description}\n- a brief general summary of the company description above"
);
assert.equal(
  promptRuntime.normalizeTenantPromptSectionOverride(
    "wording_preferences",
    "# Wording Preferences\n- Use this exact opening on the first turn: {opening_line}\n- Keep all other wording flexible and natural."
  ),
  "# Wording Preferences\n- Keep all other wording flexible and natural."
);
assert.equal(
  promptRuntime.normalizeTenantPromptSectionOverride(
    "wording_preferences",
    "# Wording Preferences\n- Use this exact opening on the first turn: {opening_line}"
  ),
  ""
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
const renderedPromptWordCount = renderedPrompt.match(/\S+/g)?.length || 0;
assert.ok(
  renderedPromptWordCount >= 800 && renderedPromptWordCount <= 1250,
  `canonical prompt word count must stay between 800 and 1250; received ${renderedPromptWordCount}`
);
assert.match(renderedPrompt, /briefly reflect it in their language and check that you have it right/);
assert.match(renderedPrompt, /A caller merely sounding qualified is not permission to begin capture\./);
assert.match(renderedPrompt, /Do not offer a callback merely because the project sounds like a possible fit or because you answered one question\./);
assert.match(renderedPrompt, /Do not stop after a bare answer or use a callback offer as a substitute for discovery\./);
assert.match(renderedPrompt, /Do not append generic reassurance, filler, or a canned offer to help\./);
assert.match(renderedPrompt, /Call data_capture silently once the caller has provided and confirmed the configured details/);
assert.match(renderedPrompt, /when it provides outcome_type, choose the allowed outcome that matches the agreed next step/);
assert.match(renderedPrompt, /call finish_session silently/);
assert.match(renderedPrompt, /Complete knowledge_lookup before beginning any substantive answer\./);
assert.match(renderedPrompt, /Never state a preliminary conclusion or begin an answer that must pause for the lookup\./);
assert.match(renderedPrompt, /Declining a callback, transfer, or suggested next step means only that the caller declined that option\./);
assert.match(renderedPrompt, /do not treat it as a request to end the call\./);
assert.match(renderedPrompt, /When a project thread remains open, return to it with the next relevant question\./);
assert.match(renderedPrompt, /Offer a callback only when the caller is ready under the Conversation rules\./);
assert.match(renderedPrompt, /Do not collect payment-card information by voice\./);
assert.match(renderedPrompt, /The system delivers the configured opening before your first model-generated turn\. Do not repeat it\./);
assert.match(
  promptSeed.tool_definitions.knowledge_lookup.description,
  /Do not begin a substantive answer until the result returns\./
);
assert.match(
  promptSeed.tool_definitions.finish_session.description,
  /Declining a callback, transfer, or suggested next step alone is not permission to finish\./
);
assert.deepEqual(
  finishSessionPolicy.evaluateFinishSessionPolicy({
    requireSpokenClose: true,
    lastAssistantTranscript: "Understood.",
    configuredClosingPhrase: "Thanks for calling. Have a great rest of your day."
  }),
  { allowed: false, reason: "spoken_close_required" }
);
assert.deepEqual(
  finishSessionPolicy.evaluateFinishSessionPolicy({
    requireSpokenClose: true,
    lastAssistantTranscript: "Thanks for calling — have a great rest of your day!",
    configuredClosingPhrase: "Thanks for calling. Have a great rest of your day."
  }),
  { allowed: true, reason: "spoken_close_confirmed" }
);
assert.deepEqual(
  finishSessionPolicy.evaluateFinishSessionPolicy({
    requireSpokenClose: false,
    lastAssistantTranscript: "Understood.",
    configuredClosingPhrase: "Thanks for calling. Have a great rest of your day."
  }),
  { allowed: true, reason: "policy_disabled" }
);
assert.deepEqual(
  finishSessionPolicy.evaluateFinishSessionPolicy({
    requireSpokenClose: true,
    lastAssistantTranscript: "Thanks for calling.",
    configuredClosingPhrase: ""
  }),
  { allowed: false, reason: "configured_closing_missing" }
);

const smoothAudioTrace = audioPumpTelemetry.createAudioPumpTrace("resp_smooth", 0);
audioPumpTelemetry.noteAudioChunkQueued(smoothAudioTrace, 640, 0, 60);
audioPumpTelemetry.noteAudioChunkQueued(smoothAudioTrace, 640, 40, 60);
audioPumpTelemetry.noteAudioChunkQueued(smoothAudioTrace, 640, 80, 60);
assert.equal(smoothAudioTrace.underrunCount, 0);
assert.equal(smoothAudioTrace.queueDrainCount, 0);
assert.equal(smoothAudioTrace.interChunkGapOverBufferTargetCount, 0);

const starvedAudioTrace = audioPumpTelemetry.createAudioPumpTrace("resp_starved", 0);
audioPumpTelemetry.noteAudioChunkQueued(starvedAudioTrace, 640, 0, 60);
assert.equal(audioPumpTelemetry.beginAudioQueueGap(starvedAudioTrace, 100), true);
assert.equal(audioPumpTelemetry.beginAudioQueueGap(starvedAudioTrace, 110), false);
audioPumpTelemetry.noteAudioChunkQueued(starvedAudioTrace, 640, 225, 60);
const resumedGapMs = audioPumpTelemetry.closeAudioQueueGap(starvedAudioTrace, 225);
audioPumpTelemetry.noteAudioPumpReprimed(starvedAudioTrace);
assert.equal(resumedGapMs, 125);
assert.equal(starvedAudioTrace.queueDrainCount, 1);
assert.equal(starvedAudioTrace.underrunCount, 1);
assert.equal(starvedAudioTrace.reprimeCount, 1);
assert.equal(starvedAudioTrace.totalUnderrunMs, 125);
assert.equal(starvedAudioTrace.maxUnderrunMs, 125);
assert.equal(starvedAudioTrace.maxInterChunkGapMs, 225);
assert.equal(starvedAudioTrace.interChunkGapOverBufferTargetCount, 1);

const terminalAudioTrace = audioPumpTelemetry.createAudioPumpTrace("resp_terminal", 0);
audioPumpTelemetry.noteAudioChunkQueued(terminalAudioTrace, 640, 0, 60);
audioPumpTelemetry.beginAudioQueueGap(terminalAudioTrace, 100);
const terminalGapMs = audioPumpTelemetry.finishAudioQueueGapWithoutReprime(
  terminalAudioTrace,
  225
);
assert.equal(terminalGapMs, 125);
assert.equal(terminalAudioTrace.queueDrainCount, 1);
assert.equal(terminalAudioTrace.underrunCount, 0);
assert.equal(terminalAudioTrace.reprimeCount, 0);
assert.equal(terminalAudioTrace.terminalGapCount, 1);
assert.equal(terminalAudioTrace.totalTerminalGapMs, 125);

const interruptedAudioTrace = audioPumpTelemetry.createAudioPumpTrace("resp_interrupted", 0);
audioPumpTelemetry.noteAudioChunkQueued(interruptedAudioTrace, 640, 0, 60);
interruptedAudioTrace.framesSent = 4;
interruptedAudioTrace.interruptedAtMs = 100;
const interruptedResponseDoneTrace = audioPumpTelemetry.ensureAudioPumpTraceForResponse(
  interruptedAudioTrace,
  "resp_interrupted",
  200
);
interruptedResponseDoneTrace.responseDoneAtMs = 200;
assert.equal(interruptedResponseDoneTrace, interruptedAudioTrace);
assert.equal(interruptedResponseDoneTrace.chunksQueued, 1);
assert.equal(interruptedResponseDoneTrace.framesSent, 4);
assert.equal(interruptedResponseDoneTrace.interruptedAtMs, 100);

const playbackFirstTrace = audioPumpTelemetry.createAudioPumpTrace("resp_playback_first", 0);
audioPumpTelemetry.noteAudioChunkQueued(playbackFirstTrace, 640, 0, 60);
playbackFirstTrace.framesSent = 4;
playbackFirstTrace.playbackDrainedAtMs = 100;
assert.equal(
  audioPumpTelemetry.shouldClearAudioPumpTraceAfterSummary(playbackFirstTrace, "playback_drained"),
  false
);
const playbackFirstResponseDoneTrace = audioPumpTelemetry.ensureAudioPumpTraceForResponse(
  playbackFirstTrace,
  "resp_playback_first",
  200
);
playbackFirstResponseDoneTrace.responseDoneAtMs = 200;
assert.equal(playbackFirstResponseDoneTrace, playbackFirstTrace);
assert.equal(playbackFirstResponseDoneTrace.chunksQueued, 1);
assert.equal(playbackFirstResponseDoneTrace.framesSent, 4);
assert.equal(
  audioPumpTelemetry.shouldClearAudioPumpTraceAfterSummary(playbackFirstResponseDoneTrace, "playback_drained"),
  true
);

const cappedGapTrace = audioPumpTelemetry.createAudioPumpTrace("resp_gap_cap", 0);
const gapLogDecisions = Array.from({ length: 10 }, () => (
  audioPumpTelemetry.shouldLogAudioGap(cappedGapTrace, 125, 60)
));
assert.deepEqual(gapLogDecisions, [true, true, true, true, true, true, true, true, false, false]);
assert.equal(cappedGapTrace.gapLogsEmitted, 8);

const retainedAudioTrace = audioPumpTelemetry.ensureAudioPumpTraceForResponse(
  starvedAudioTrace,
  null,
  300
);
assert.equal(retainedAudioTrace, starvedAudioTrace);
const replacementAudioTrace = audioPumpTelemetry.ensureAudioPumpTraceForResponse(
  starvedAudioTrace,
  "resp_next",
  300
);
assert.notEqual(replacementAudioTrace, starvedAudioTrace);
assert.equal(replacementAudioTrace.responseId, "resp_next");
assert.equal(audioPumpTelemetry.calculatePendingPlaybackMs(5, 80), 110);

const knowledgeTimingDetails = knowledgeLookupTelemetry.buildKnowledgeLookupTimingDetails({
  sourceType: "response.function_call_arguments.done",
  speechStoppedAtMs: 1000,
  toolCallReadyAtMs: 1400,
  executionStartedAtMs: 1420,
  runtimeCompletedAtMs: 1900,
  callStatePersistStartedAtMs: 1900,
  callStatePersistCompletedAtMs: 1950,
  appToolResultForwardStartedAtMs: 1980,
  appToolResultForwardCompletedAtMs: 2050,
  appToolResultForwardOutcome: "succeeded",
  resultDispatchAtMs: 2060,
  xaiSocketOpenAtResultDispatch: true,
  retrieval: {
    asset_cache_hit: true,
    asset_fetch_ms: 2,
    recent_conversation_summary_ms: 8,
    planner_ms: 210,
    embedding_ms: 90,
    retrieval_ms: 40,
    packet_ms: 15,
    runtime_core_ms: 355,
    runtime_bundle_persist_ms: 20,
    coverage_gap_persist_ms: 10,
    total_gateway_turn_ms: 480
  }
});
assert.deepEqual(knowledgeTimingDetails, {
  sourceType: "response.function_call_arguments.done",
  endpointToToolCallReadyMs: 400,
  toolCallReadyToExecutionStartMs: 20,
  knowledgeRuntimeWallClockMs: 480,
  knowledgeCallStatePersistMs: 50,
  runtimeToCallStatePersistStartMs: 0,
  callStatePersistCompletedToAppForwardStartMs: 30,
  appToolResultForwardMs: 70,
  appForwardCompletedToXAiResultDispatchMs: 10,
  appToolResultForwardOutcome: "succeeded",
  toolCallReadyToXAiResultDispatchMs: 660,
  endpointToXAiResultDispatchMs: 1060,
  xaiSocketOpenAtResultDispatch: true,
  assetCacheHit: true,
  assetFetchMs: 2,
  recentConversationSummaryMs: 8,
  plannerMs: 210,
  embeddingMs: 90,
  retrievalMs: 40,
  packetMs: 15,
  runtimeCoreMs: 355,
  runtimeBundlePersistMs: 20,
  coverageGapPersistMs: 10,
  totalGatewayTurnMs: 480
});
const noEndpointTimingDetails = knowledgeLookupTelemetry.buildKnowledgeLookupTimingDetails({
  sourceType: "response.output_item.done",
  speechStoppedAtMs: null,
  toolCallReadyAtMs: 10,
  executionStartedAtMs: 10,
  runtimeCompletedAtMs: 10,
  callStatePersistStartedAtMs: 10,
  callStatePersistCompletedAtMs: 10,
  appToolResultForwardStartedAtMs: 10,
  appToolResultForwardCompletedAtMs: 10,
  appToolResultForwardOutcome: "not_configured",
  resultDispatchAtMs: 10,
  xaiSocketOpenAtResultDispatch: false,
  retrieval: {
    asset_cache_hit: true,
    asset_fetch_ms: 0,
    recent_conversation_summary_ms: 0,
    planner_ms: 0,
    embedding_ms: 0,
    retrieval_ms: 0,
    packet_ms: 0,
    runtime_core_ms: 0,
    runtime_bundle_persist_ms: 0,
    coverage_gap_persist_ms: 0,
    total_gateway_turn_ms: 0
  }
});
assert.equal(noEndpointTimingDetails.endpointToToolCallReadyMs, undefined);
assert.equal(noEndpointTimingDetails.endpointToXAiResultDispatchMs, undefined);
assert.equal(noEndpointTimingDetails.xaiSocketOpenAtResultDispatch, false);
assert.equal(noEndpointTimingDetails.appToolResultForwardOutcome, "not_configured");
for (const zeroMetric of [
  "assetFetchMs",
  "recentConversationSummaryMs",
  "plannerMs",
  "embeddingMs",
  "retrievalMs",
  "packetMs",
  "runtimeCoreMs",
  "runtimeBundlePersistMs",
  "coverageGapPersistMs",
  "totalGatewayTurnMs"
]) {
  assert.equal(noEndpointTimingDetails[zeroMetric], 0, `${zeroMetric} must preserve a measured zero`);
}
assert.equal(
  knowledgeLookupTelemetry.buildKnowledgeLookupTimingDetails({
    sourceType: "response.output_item.done",
    speechStoppedAtMs: Number.NaN,
    toolCallReadyAtMs: 10,
    executionStartedAtMs: 10,
    runtimeCompletedAtMs: 10,
    callStatePersistStartedAtMs: 10,
    callStatePersistCompletedAtMs: 10,
    appToolResultForwardStartedAtMs: 10,
    appToolResultForwardCompletedAtMs: 10,
    appToolResultForwardOutcome: "failed",
    resultDispatchAtMs: 10,
    xaiSocketOpenAtResultDispatch: false,
    retrieval: { planner_ms: Number.NaN }
  }).plannerMs,
  undefined
);
assert.doesNotMatch(
  JSON.stringify(knowledgeTimingDetails),
  /"(?:query|transcript|prompt|phone|payload|arguments|callerName)"\s*:/i,
  "knowledge lookup timing details must not contain caller content or tool payloads"
);

const callGatewaySource = readFileSync(
  path.join(process.cwd(), "apps/call-gateway/src/server.ts"),
  "utf8"
);
const productionAllowlist = callGatewaySource.match(
  /const PRODUCTION_INFO_LOG_ALLOWLIST = new Set\(\[([\s\S]*?)\]\);/
)?.[1] || "";
for (const eventName of [
  "assistant_audio_pump_trace",
  "assistant_audio_gap",
  "assistant_barge_in_decision",
  "assistant_barge_in_applied",
  "assistant_finish_session_rejected",
  "caller_transcript_turn_coalesced",
  "knowledge_lookup_timing"
]) {
  assert.match(
    productionAllowlist,
    new RegExp(`"${eventName}"`),
    `${eventName} must remain visible in production process logs`
  );
}
assert.match(
  callGatewaySource,
  /decision: clearSent \? "clear_applied" : "clear_not_sent"/,
  "a closed Telnyx socket must not be logged as an applied clear"
);
assert.match(callGatewaySource, /evaluateFinishSessionPolicy\(/);
assert.match(callGatewaySource, /logInfo\("assistant_finish_session_rejected"/);
assert.match(
  callGatewaySource,
  /type === "conversation\.item\.input_audio_transcription\.updated"[\s\S]*persistCallerTranscriptSnapshot\(session, String\(transcript\)\)/,
  "cumulative xAI caller transcript updates must be coalesced before persistence"
);
assert.match(
  callGatewaySource,
  /UPDATE call_events[\s\S]*WHERE id = \$2 AND call_sid = \$3 AND role = 'caller'/,
  "later snapshots from one caller turn must update the existing call event"
);
assert.match(
  callGatewaySource,
  /if \(type === "input_audio_buffer\.speech_started"\) \{[\s\S]*?session\.callerTranscriptTurn = createCallerTranscriptTurnState\(\);\s+session\.lastAssistantTranscript = null;/,
  "a new caller turn must invalidate any closing spoken on an earlier turn"
);

const forbiddenDiagnosticFields = /\b(transcript|prompt|phone|phoneNumber|payloadBase64|argumentsText|toolResultPayload)\b/;
for (const eventName of ["assistant_audio_gap", "assistant_barge_in_decision"]) {
  let searchFrom = 0;
  let occurrences = 0;
  const marker = `logInfo("${eventName}", {`;
  while (true) {
    const start = callGatewaySource.indexOf(marker, searchFrom);
    if (start < 0) break;
    const end = callGatewaySource.indexOf("});", start);
    assert.notEqual(end, -1, `${eventName} log block must be complete`);
    const logBlock = callGatewaySource.slice(start, end + 3);
    assert.doesNotMatch(
      logBlock,
      forbiddenDiagnosticFields,
      `${eventName} must not emit caller content, prompts, audio, or tool arguments`
    );
    occurrences += 1;
    searchFrom = end + 3;
  }
  assert.ok(occurrences > 0, `${eventName} must be emitted by the gateway`);
}
const knowledgeTimingLogStart = callGatewaySource.indexOf('logInfo("knowledge_lookup_timing", {');
assert.notEqual(knowledgeTimingLogStart, -1, "knowledge lookup timing must be emitted by the gateway");
const knowledgeTimingLogEnd = callGatewaySource.indexOf("});", knowledgeTimingLogStart);
assert.notEqual(knowledgeTimingLogEnd, -1, "knowledge lookup timing log block must be complete");
assert.doesNotMatch(
  callGatewaySource.slice(knowledgeTimingLogStart, knowledgeTimingLogEnd + 3),
  forbiddenDiagnosticFields,
  "knowledge lookup timing process logs must not include caller content or tool payloads"
);
const legacyKnowledgeLogStart = callGatewaySource.indexOf('logInfo("knowledge_lookup_tool_called", {');
assert.notEqual(legacyKnowledgeLogStart, -1, "legacy knowledge lookup summary must remain available");
const legacyKnowledgeLogEnd = callGatewaySource.indexOf("});", legacyKnowledgeLogStart);
assert.notEqual(legacyKnowledgeLogEnd, -1, "legacy knowledge lookup summary must be complete");
assert.doesNotMatch(
  callGatewaySource.slice(legacyKnowledgeLogStart, legacyKnowledgeLogEnd + 3),
  /\bquery\b/,
  "verbose process logs must not emit the caller's raw knowledge query"
);

console.log(JSON.stringify({ ok: true, checked: "xai_realtime_payloads" }, null, 2));
