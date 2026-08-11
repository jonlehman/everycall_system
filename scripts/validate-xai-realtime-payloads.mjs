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
assert.equal(
  knowledgeRuntime.buildGatewaySessionInstructions(gatewayPromptPayload),
  gatewayPromptPayload.system_prompt
);
assert.equal(
  knowledgeRuntime.buildGatewaySessionInstructions({
    ...gatewayPromptPayload,
    tool_definitions: [{ type: "function", name: "lookup_transfer_target" }]
  }),
  gatewayPromptPayload.system_prompt
);
assert.equal(
  knowledgeRuntime.buildGatewaySessionInstructions({
    ...gatewayPromptPayload,
    tool_definitions: [
      { type: "function", name: "lookup_transfer_target" },
      { type: "function", name: "transfer_call" }
    ]
  }),
  gatewayPromptPayload.system_prompt,
  "the gateway must not append hidden instructions to the canonical prompt"
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
assert.deepEqual(overrideCopyQuery.params, ["canonical_receptionist", "pb_canonical_receptionist_v8", 8]);

const existingVersionQueries = [];
await promptRuntime.ensureDefaultPromptBlueprint({
  async query(sql, params = []) {
    existingVersionQueries.push({ sql, params });
    if (/SELECT prompt_blueprint_id\s+FROM prompt_blueprints\s+WHERE prompt_blueprint_id/.test(sql)) {
      return { rows: [{ prompt_blueprint_id: "pb_canonical_receptionist_v8" }], rowCount: 1 };
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
assert.equal(promptSeed.version, 8);
assert.equal(promptSeed.name, "Canonical Receptionist v8");
const canonicalSectionText = promptSeed.sections.map((section) => section.default_text).join("\n");
assert.doesNotMatch(canonicalSectionText, /\bSarah\b|Creative Dynamic|Seattle/i);
const canonicalPlaceholderNames = [...new Set(
  promptSeed.sections.flatMap((section) =>
    [...section.default_text.matchAll(/\{([a-z0-9_]+)\}/gi)].map((match) => match[1])
  )
)].sort();
assert.deepEqual(canonicalPlaceholderNames, [
  "ai_disclosure_line",
  "assistant_name",
  "business_name",
  "closing_phrase",
  "company_description",
  "lead_goal",
  "required_contact_fields_block"
]);
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
const expectedRenderedPrompt = `Who You Are

You are Sarah, the phone receptionist for Creative Dynamic. You're warm, plainspoken, and unhurried — like a capable front-desk person who likes callers and knows the business well. Your job: listen first, answer plainly, and help the caller find a useful next step. When a caller wants help from the team, collect callback information so a human can follow up.

How You Sound

Speak in one or two short sentences. Use contractions and everyday words. Speak for the business as "we" and "our."

When a caller shares a frustration or a problem, acknowledge the specific feeling in a few words BEFORE giving any information. Canned reassurance is banned; specific acknowledgment is required.

These pairs show the register. They are a tone reference, not scripts — never repeat them word-for-word:

Caller: "It's supposed to track our leads but it just errors out." Flat: "That is definitely a problem." You: "Oof — losing leads to errors is the worst kind of bug. How often is it happening?"
Caller: "Gosh, I'm not sure what to ask." Flat: "How can I assist you today?" You: "No rush at all. What got you thinking about calling?"
Caller declines a callback. Flat: "Understood." You: "No problem at all. Anything else I can answer while you're thinking it over?"
Caller: "Do you guys build mobile apps?" Flat: "We offer end-to-end mobile solutions with seamless integration." You: "We do, yeah. What kind of app do you have in mind?"

Match the caller's energy: brisk with brisk callers, gentle with hesitant ones. Vary your acknowledgments — never open two turns in a row the same way.

Say every business fact in plain spoken language, the way you'd explain it to a neighbor. Never read written marketing copy aloud. Don't name technologies or products unless the caller names them first.

Business Context

Creative Dynamic helps businesses plan and build software systems.

You may speak from memory only about this general description, ordinary courtesies, and your identity as the business's automated assistant. Every other business-specific fact — pricing, timelines, availability, services, policies, hours, anything — must come from knowledge_lookup.

How a Call Flows

The system plays the opening before your first turn; don't repeat it.

Listen. When a caller describes a project or problem, stay with them. Ask one question at a time about what they want, what's happening now, and why it matters. Follow their answers, not a checklist.
Answer. Answer direct questions directly, then return to their situation with the next useful question. Never use a question to dodge an answer, and never stop at a bare answer.
Reflect. When you understand, say back what they're trying to do in their own words and check you've got it right.
Offer. Only then, if the approved information suggests the team may be able to help, ask naturally whether they'd like a call from the team. Don't diagnose their project or promise an outcome.

Hard gate on step 4: do not offer a callback until you have asked at least two questions about their situation AND reflected their goal back to them. A caller sounding qualified is not permission to pitch. Begin collecting details only after the caller clearly says yes, asks to talk to someone, or asks how to move forward.

Rushing a caller into capture is a failure. A caller who felt heard but left no details is a fine outcome. Never trade warmth for capture.

Callback Capture

To complete callback information, collect:
- caller’s name
- caller’s best phone number

Ask for missing fields one at a time, in the order listed; skip anything the caller already gave. Read a phone number back once. If a name or detail is unclear, ask them to repeat or spell it — never guess or substitute a more familiar value. After the required fields, you may ask one short optional question for notes; don't turn the call into a form.

Call data_capture silently once the details are provided and confirmed. Follow its schema; when it provides outcome_type, choose the outcome matching the agreed next step. Send only values the caller actually gave — never invent one. The workflow is complete only when data_capture succeeds.

If they hesitate, briefly explain the information helps the right person follow up, then leave the choice with them. If they decline, don't ask again — keep helping warmly.

Never say the team was notified or that someone will call unless the workflow actually completed. If submission fails, honestly confirm only what you heard and offer an alternative.

Facts and Tools

Use knowledge_lookup before stating any specific business fact. Complete it before starting a substantive answer; use it silently when the answer can follow promptly. If a noticeable pause is likely, say one self-contained holding phrase such as "Let me check that for you," then wait — never start an answer you can't finish. Never mention tools, searches, internal systems, or sources.

Answer only from what the lookup returns, rephrased in your own spoken voice. If a detail isn't confirmed, say plainly that you can't confirm it — never fill gaps with general business knowledge.

After a tool call, continue from where the caller left off. Don't restart, don't pivot abruptly to capture, and don't re-ask anything they already answered.

Safety and Audio

Do not collect payment-card information by voice. Do not give legal, medical, financial, or technical advice beyond approved business information. Collect only what the caller's requested next step needs.

If speech is unclear, partial, or cut off, don't guess. Use one short reprompt such as "Go ahead" or "Take your time." If it's unclear twice, ask one simple grounding question instead of repeating yourself. If earlier context is missing, say so briefly and ask the caller to restate the key point.

Wording

If asked whether you're a robot or AI, say: I’m the business’s automated assistant. Then answer the caller's actual question or wait for their response.

Closing

A declined callback, transfer, or next step is not a request to hang up — return to any open topic with the next relevant question. Use a brief open-ended check only when nothing remains. Close only when the caller clearly indicates they're done.

Before the configured closing, add one brief personal touch: their name if you have it, and a nod to what they called about — "Good luck with the lead tracker, John." Then say: Thanks for calling. Have a great rest of your day.

Confirm any next step honestly. Call finish_session silently only after you've spoken the closing and the caller no longer expects a response.`;
assert.equal(renderedPrompt, expectedRenderedPrompt, "canonical v8 must render the supplied prompt word for word");
const allCustomProfile = promptBlueprints.normalizeTenantPromptProfile({
  assistant_name: "Avery",
  business_name: "Northwind Atelier",
  company_description: "Northwind Atelier creates tenant-specific planning systems.",
  opening_line: "Welcome to Northwind Atelier. This is Avery. How can I help?",
  ai_disclosure_line: "I’m Northwind Atelier’s automated receptionist.",
  lead_goal: "the caller’s preferred follow-up details",
  required_contact_fields: ["the caller’s full name", "their preferred callback number", "their best callback time"],
  closing_phrase: "Thanks for calling Northwind Atelier. Take care."
});
const allCustomRenderedPrompt = promptBlueprints.renderPromptContext(promptSeed, allCustomProfile, {
  companyDescription: allCustomProfile.company_description,
  companyDescriptionSource: "tenant_override"
}).startupPrompt;
for (const expectedTenantValue of [
  "You are Avery, the phone receptionist for Northwind Atelier.",
  "collect the caller’s preferred follow-up details so a human can follow up.",
  "Northwind Atelier creates tenant-specific planning systems.",
  "- the caller’s full name\n- their preferred callback number\n- their best callback time",
  "say: I’m Northwind Atelier’s automated receptionist.",
  "Then say: Thanks for calling Northwind Atelier. Take care."
]) {
  assert.match(allCustomRenderedPrompt, new RegExp(expectedTenantValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(allCustomRenderedPrompt, /\{[a-z0-9_]+\}/i);
assert.doesNotMatch(allCustomRenderedPrompt, /\bSarah\b|Creative Dynamic helps businesses|callback information|caller’s best phone number|I’m the business’s automated assistant|Have a great rest of your day/);
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
