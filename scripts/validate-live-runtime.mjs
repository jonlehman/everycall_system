import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { LiveRuntime, buildLiveStart, resolveVoiceRuntime, liveAppend, pcmuHasSpeech } from "../apps/call-gateway/dist/apps/call-gateway/src/liveRuntime.js";
import { PreparedResponsesSession, RESPONSES_WS_URL, resolveLiveReasoningEffort } from "../apps/call-gateway/dist/apps/call-gateway/src/liveBackendSession.js";
import { LIVE_SPEECH_INSTRUCTIONS, LIVE_BACKEND_ADAPTER, LIVE_HANDOFF_FORMAT, parseBackendHandoff, HandoffValidationError } from "../apps/call-gateway/dist/apps/call-gateway/src/liveContract.js";
import { LiveLatency } from "../apps/call-gateway/dist/apps/call-gateway/src/liveLatency.js";
import { LiveConversationController, bindLookupIntent } from "../apps/call-gateway/dist/apps/call-gateway/src/liveConversation.js";

// All models, sockets and operations are fake. This suite never reads credentials.
const tick = () => new Promise(resolve => setImmediate(resolve));
const idle = async () => { for (let n = 0; n < 8; n++) await tick(); };
let seq = 0;
const caller = delta => ({ type: "session.input_transcript.delta", event_id: `u-${++seq}`, delta, start_ms: seq * 100, end_ms: seq * 100 + 50 });
const assistant = delta => ({ ...caller(delta), type: "session.output_transcript.delta" });
const delegate = id => ({ type: "session.delegation.created", event_id: `d-${id}`, offset_ms: seq * 100, delegation: { id, target: "client" } });
const question = (text, kind = "intake", target_id = null) => ({ text, kind, target_id });
const plan = (question_purpose = "none", beat = "answer", readiness = "exploring", caller_goal = "Help with the caller's request") => ({ caller_goal, readiness, beat, question_purpose, contact_field: null, clarifies_question_id: null });
const fixturePlan = q => q?.kind === "intake" ? plan("discovery", "understand")
  : q?.kind === "callback_consent" ? plan(q.kind, "offer_callback", "receptive")
  : q ? plan(q.kind, q.kind === "other_questions" ? "checkpoint" : "confirm") : plan();
const contract = (spoken_response = "", next_question = null, extra = {}) => ({ conversation_plan: fixturePlan(next_question), verified_facts: [], action_status: "none", spoken_response, next_question, completed_operation_ids: [], ...extra });
const answer = value => ({ id: `r-${++seq}`, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }], usage: { input_tokens: 10, output_tokens: 5 } });
const tool = (name = "data_capture", args = { first_name: "Ada" }, id = `f-${++seq}`) => ({ id: `r-${++seq}`, status: "completed", output: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(name === "knowledge_lookup" ? { lookup_intent: { purpose: "caller_question", missing_fact: args.query || "The requested business fact", caller_turn_id: 0, caller_quote: "__CURRENT_CALLER__" }, ...args } : args) }] });
const all = [];
function harness({ replies = [answer(contract("We repair windows."))], executeTool, ...overrides } = {}) {
  const sent = [], calls = [], logs = [], transcripts = [], finishes = [], requests = [];
  let closed = false, prepared = false, index = 0, latestCaller;
  const backend = {
    prepare: async () => { prepared = true; }, close: () => { closed = true; },
    respond: async (input, signal) => {
      assert.equal(prepared, true); assert.equal(closed, false);
      requests.push(structuredClone(input));
      const userInput = input.find(x => x.role === "user");
      if (userInput) { try { latestCaller = JSON.parse(userInput.content).finalized_turns?.filter(x => x.role === "user" && x.kind === "meaningful").at(-1) || latestCaller; } catch {} }
      const reply = replies[index++]; assert.ok(reply, "fixture must supply every backend response");
      const response = typeof reply === "function" ? await reply(input, signal) : structuredClone(reply);
      for (const item of response.output || []) if (item.type === "function_call" && item.name === "knowledge_lookup") {
        const args = JSON.parse(item.arguments);
        if (args.lookup_intent?.caller_quote === "__CURRENT_CALLER__") {
          args.lookup_intent.caller_turn_id = latestCaller.id; args.lookup_intent.caller_quote = latestCaller.text; item.arguments = JSON.stringify(args);
        }
      }
      return response;
    }
  };
  const runtime = new LiveRuntime({
    tenantKey: "tenant-a", callSid: "call-a", apiKey: "never-used", safetyIdentifier: "hashed-subject",
    backendModel: "gpt-5.6-terra", instructions: "CANONICAL BUSINESS RULES", settleMs: 0, backend,
    tools: ["knowledge_lookup", "data_capture", "lookup_transfer_target", "transfer_call", "finish_session"].map(name => ({ type: "function", name, parameters: { type: "object", ...(name === "data_capture" ? { properties: { first_name: { type: "string" }, last_name: { type: "string" }, callback_number: { type: "string" } } } : {}) } })),
    send: event => sent.push(event), isActive: () => true,
    executeTool: async (...args) => { calls.push(args); return executeTool ? executeTool(...args) : { status: "accepted" }; },
    validateTool: () => true, state: () => ({ captured_fields: {} }), transcript: entry => transcripts.push(entry),
    audio: bytes => assert.equal(bytes.length, 160), ready: () => {}, finish: reason => finishes.push(reason),
    audit: (event, details) => logs.push({ event, ...details }), ...overrides
  });
  const h = { runtime, sent, calls, logs, transcripts, finishes, requests, closed: () => closed }; all.push(h); return h;
}
async function start(h, utterance) { await h.runtime.handle({ type: "session.started" }); if (utterance) await h.runtime.handle(caller(utterance)); }
const speech = h => h.sent.filter(x => x.type === "session.commentary.append").map(x => x.content);
const state = request => JSON.parse(request.find(x => x.role === "user").content);

assert.equal(resolveVoiceRuntime(undefined), "realtime"); assert.equal(resolveVoiceRuntime("live"), "live");
assert.throws(() => resolveVoiceRuntime("other")); assert.equal(resolveLiveReasoningEffort(undefined), "medium");
assert.equal(resolveLiveReasoningEffort("high"), "high"); assert.throws(() => resolveLiveReasoningEffort("invalid"));
const liveStart = buildLiveStart(LIVE_SPEECH_INSTRUCTIONS, "marin");
assert.equal(liveStart.session.model, "gpt-live-1"); assert.equal(liveStart.session.store, false);
assert.deepEqual(liveStart.session.audio.format, { type: "audio/pcmu", rate: 8000 });
assert.deepEqual(liveStart.session.delegation, { type: "client" }); assert.equal("tools" in liveStart.session, false);
assert.equal("turn_detection" in liveStart.session, false); assert.ok(!LIVE_SPEECH_INSTRUCTIONS.includes("CANONICAL BUSINESS RULES"));
assert.match(LIVE_SPEECH_INSTRUCTIONS, /Delegate every substantive caller turn/);
assert.match(LIVE_SPEECH_INSTRUCTIONS, /After you finish a supplied reflection or listening beat, delegate the caller's acknowledgement/);
assert.match(LIVE_BACKEND_ADAPTER, /No appointment-booking or calendar tool exists/);
const chunks = liveAppend("instructions", "界🙂".repeat(400), "delegation");
assert.ok(chunks.every(x => Buffer.byteLength(x.content) <= 480)); assert.equal(chunks.map(x => x.content).join(""), "界🙂".repeat(400));
assert.equal(pcmuHasSpeech(Buffer.alloc(160, 255)), false); assert.equal(pcmuHasSpeech(Buffer.alloc(160, 0)), true);
assert.throws(() => parseBackendHandoff(JSON.stringify(contract("x".repeat(481))), new Set()));
assert.throws(() => parseBackendHandoff(JSON.stringify(contract("Saved", null, { action_status: "completed", completed_operation_ids: ["invented"] })), new Set()));
assert.throws(() => parseBackendHandoff(JSON.stringify(contract("data_capture succeeded")), new Set()));
assert.throws(() => parseBackendHandoff(JSON.stringify(contract("", question("Connect you?", "transfer_confirmation"))), new Set()));
assert.throws(() => parseBackendHandoff(JSON.stringify(contract("What is your name?")), new Set()), error => error instanceof HandoffValidationError && error.constraint === "unbound_question" && !error.message.includes("name"));

// A silent caller gets one proactive greeting. Only the matching instruction
// acknowledgement triggers commentary; repeated events cannot replay it.
const greeting = harness({ greeting: "Thanks for calling. This is Sarah. How can I help?" });
await start(greeting); assert.equal(greeting.requests.length, 0);
const greetingInstruction = greeting.sent.find(x => x.type === "session.instructions.append");
assert.match(greetingInstruction.content, /without waiting for caller speech/);
assert.equal(speech(greeting).length, 0);
greeting.runtime.input(Buffer.alloc(160, 255).toString("base64"));
assert.ok(greeting.sent.some(x => x.type === "session.input_audio.append"), "pre-greeting input silence keeps flowing");
await greeting.runtime.handle({ type: "session.instructions.appended", client_event_id: "unrelated" });
assert.equal(speech(greeting).length, 0);
await greeting.runtime.handle({ type: "session.instructions.appended", client_event_id: greetingInstruction.event_id });
await greeting.runtime.handle({ type: "session.instructions.appended", client_event_id: greetingInstruction.event_id });
await greeting.runtime.handle({ type: "session.started" });
assert.deepEqual(speech(greeting), ["Thanks for calling. This is Sarah. How can I help?"]);
await greeting.runtime.handle({ type: "session.output_audio.delta", delta: Buffer.alloc(160, 0).toString("base64") });
assert.equal(greeting.finishes.length, 0);
const earlyGreeting = harness({ greeting: "Hello, this is Sarah." }); await start(earlyGreeting);
await earlyGreeting.runtime.handle({ type: "session.output_audio.delta", delta: Buffer.alloc(160, 0).toString("base64") });
await earlyGreeting.runtime.handle({ type: "session.instructions.appended", client_event_id: earlyGreeting.sent[0].event_id });
assert.equal(speech(earlyGreeting).length, 0, "already-started greeting is never retriggered");
const stalledGreeting = harness({ greeting: "Hello.", greetingTimeoutMs: 10 }); await start(stalledGreeting);
await new Promise(resolve => setTimeout(resolve, 20));
assert.deepEqual(stalledGreeting.finishes, ["openai_live_greeting_timeout"]);
assert.ok(stalledGreeting.logs.some(x => x.milestone === "greeting_failed" && x.reason === "instruction_acceptance_timeout"));
const talkFirst = harness({ greeting: "Hello, this is Sarah.", greetingTimeoutMs: 10 }); await start(talkFirst);
const talkFirstInstruction = talkFirst.sent[0];
for (let n = 0; n < 6; n++) {
  talkFirst.runtime.input(Buffer.alloc(160, 0).toString("base64"));
  if (!n) await talkFirst.runtime.handle(caller("I have a long request before the introduction."));
  await new Promise(resolve => setTimeout(resolve, 5));
}
await talkFirst.runtime.handle({ type: "session.instructions.appended", client_event_id: talkFirstInstruction.event_id });
assert.equal(talkFirst.finishes.length, 0, "caller speech longer than greeting timeout must never hang up");
assert.equal(speech(talkFirst).length, 0, "late acknowledgement cannot greet over the caller");
assert.ok(talkFirst.logs.some(x => x.milestone === "greeting_yielded_to_caller"));

const delayedDelegation = harness({ delegationWaitMs: 15 }); await start(delayedDelegation);
delayedDelegation.runtime.input(Buffer.alloc(160, 0).toString("base64"));
await delayedDelegation.runtime.handle(caller("I need my house painted."));
for (let n = 0; n < 6; n++) {
  delayedDelegation.runtime.input(Buffer.alloc(160, 0).toString("base64"));
  await new Promise(resolve => setTimeout(resolve, 5));
}
assert.equal(delayedDelegation.sent.filter(x => x.type === "session.instructions.append").length, 0, "ongoing caller speech suppresses the delegation watchdog");
for (let n = 0; n < 10; n++) {
  delayedDelegation.runtime.input(Buffer.alloc(160, 255).toString("base64"));
  await new Promise(resolve => setTimeout(resolve, 5));
}
const nudges = delayedDelegation.sent.filter(x => x.type === "session.instructions.append");
assert.equal(nudges.length, 1); assert.match(nudges[0].content, /Delegate that existing request/);
assert.equal(nudges[0].delegation_id, null); assert.equal(delayedDelegation.requests.length, 0, "watchdog never fabricates a delegation or executes backend work");
assert.ok(delayedDelegation.logs.some(x => x.milestone === "delegation_missing"));
await delayedDelegation.runtime.handle(delegate("eventual-delegation"));
await delayedDelegation.runtime.handle(delegate("eventual-delegation"));
assert.equal(delayedDelegation.requests.length, 1);
assert.equal(delayedDelegation.sent.filter(x => x.type === "session.instructions.append" && /Delegate that existing request/.test(x.content)).length, 1);

// Byte provenance survives delayed queue playback and later commentary. Provider
// audio has no delegation ID, so these remain explicitly temporal candidates.
const latencyLogs = [], latency = new LiveLatency((event, details) => latencyLogs.push({ event, ...details }));
const realNow = Date.now; let observedNow = 1000;
try {
  Date.now = () => observedNow;
  latency.input(true, 1000); const initial = latency.transcript(0, 20, true);
  latency.input(false, 1200); observedNow = 9600;
  latency.input(true, 9600); latency.transcript(8600, 8620, true); latency.input(false, 9800);
  assert.equal(latency.caller.requestId, initial.requestId);
  assert.equal(latency.caller.startedAt, 1000); assert.equal(latency.caller.firstSpeechEndObservedAt, 1000);
  latency.output = { trace: initial, delegationId: "old-delegation", commentaryEventId: "old-commentary" };
  latency.received(Buffer.alloc(100, 0), true);
  const next = latency.create("caller"); latency.output = { trace: next, delegationId: "next-delegation", commentaryEventId: "next-commentary" };
  latency.received(Buffer.alloc(60, 0), true);
  const mixedFrame = Buffer.alloc(160, 0); latency.queued(mixedFrame);
  latency.sent(mixedFrame, true, 10000); latency.sent(mixedFrame, true, 10020);
  const delivered = latencyLogs.filter(x => x.milestone === "telnyx_audio_sent");
  assert.equal(delivered.length, 2); assert.deepEqual(delivered.map(x => x.commentaryEventId), ["old-commentary", "next-commentary"]);
  assert.equal(delivered[0].sinceFirstEstimatedSpeechEndMs, 9000);
  assert.ok(delivered.every(x => x.telnyxWriteConfirmed && !x.playbackConfirmed && !x.humanHearingConfirmed && x.correlation === "temporal_candidate"));
} finally { Date.now = realNow; }

const fragmented = harness({ settleMs: 10 }); await start(fragmented, "I need my house ");
await new Promise(resolve => setTimeout(resolve, 20));
await fragmented.runtime.handle(caller("painted."));
assert.equal(fragmented.runtime.taskRevision, 0, "transcript quiet alone never invents a caller turn");
await fragmented.runtime.handle(delegate("fragmented"));
assert.equal(fragmented.runtime.taskRevision, 1); assert.equal(state(fragmented.requests[0]).finalized_turns[0].text, "I need my house painted.");

const repaired = harness({ replies: [answer(contract("What is your name?")), answer(contract("", question("What is your name?")))] });
await start(repaired, "I need painting"); await repaired.runtime.handle(delegate("repair"));
assert.equal(repaired.requests.length, 2); assert.equal(repaired.calls.length, 0);
assert.deepEqual(speech(repaired), ["What is your name?"]);
assert.match(repaired.requests[1][0].content, /unbound_question/);
assert.equal(new Set(repaired.logs.filter(x => x.requestId).map(x => x.requestId)).size, 1);
assert.deepEqual(repaired.logs.filter(x => x.milestone === "handoff_validated").map(x => x.outcome), ["rejected", "accepted"]);
const unrepairable = harness({ replies: [answer(contract("What is your name?")), answer(contract("What is your name?"))] });
await start(unrepairable, "Painting please"); await unrepairable.runtime.handle(delegate("unrepairable"));
assert.equal(unrepairable.requests.length, 2); assert.equal(unrepairable.calls.length, 0);
assert.deepEqual(speech(unrepairable), ["I'm sorry, I couldn't confirm that."]);
assert.equal(unrepairable.logs.filter(x => x.milestone === "handoff_validated" && x.outcome === "rejected").length, 2);
const repairTool = harness({ replies: [answer(contract("What is your name?")), tool()] });
await start(repairTool, "Painting please"); await repairTool.runtime.handle(delegate("repair-tool"));
assert.equal(repairTool.calls.length, 0); assert.ok(repairTool.logs.some(x => x.error === "live_backend_repair_tool_rejected"));

// Conversation control: replay the observed house/exterior/whole-thing chain.
// The third optional discovery question must not reach Live. Recovery uses the
// same backend state and does not force a callback on an unreceptive caller.
const discover = (reflection, text, goal) => contract(reflection, question(text), {
  conversation_plan: plan("discovery", "understand", "exploring", goal)
});
const painting = harness({ replies: [
  answer(discover("You're looking to repaint your house.", "Is that inside or outside?", "House painting")),
  answer(discover("An exterior repaint.", "Is it the whole exterior or one area?", "Exterior house painting")),
  answer(discover("The whole exterior.", "Is the paint peeling or does the wood need repairs?", "Whole exterior repaint")),
  answer(contract("A full exterior repaint, then. That gives me a clear picture of the project.", null, { conversation_plan: plan("none", "listen", "exploring", "Whole exterior repaint") })),
  answer(contract("", question("Would you like the team to call you about the exterior repaint?", "callback_consent"), { conversation_plan: plan("callback_consent", "offer_callback", "receptive", "Whole exterior repaint") }))
] });
await start(painting, "I have a house that needs to get painted."); await painting.runtime.handle(delegate("paint-start"));
await painting.runtime.handle(assistant(speech(painting).at(-1)));
await painting.runtime.handle(caller("Exterior.")); await painting.runtime.handle(delegate("paint-exterior"));
await painting.runtime.handle(assistant(speech(painting).at(-1)));
await painting.runtime.handle(caller("The whole thing.")); await painting.runtime.handle(delegate("paint-whole"));
assert.equal(painting.calls.length, 0);
assert.equal(speech(painting).length, 3);
assert.ok(!speech(painting).some(x => /peeling|wood need|repairs\?/i.test(x)));
assert.equal(speech(painting).at(-1).includes("?"), false);
assert.equal(state(painting.requests[2]).conversation_state.discovery_questions_remaining, 0);
assert.equal(state(painting.requests[2]).conversation_state.last_plan.caller_goal, "Exterior house painting");
assert.ok(painting.logs.some(x => x.constraint === "conversation_discovery_limit"));
assert.ok(!JSON.stringify(painting.sent).includes("caller_goal"), "private controller record never reaches Live");
await painting.runtime.handle(assistant(speech(painting).at(-1)));
await painting.runtime.handle(caller("Yes, I would like someone to call me about it.")); await painting.runtime.handle(delegate("paint-callback"));
assert.match(speech(painting).at(-1), /call you/); assert.ok(!/appointment|scheduled/i.test(speech(painting).join(" ")));
assert.equal(painting.calls.length, 0, "a callback offer is not a completed action");

// A question may interrupt discovery. Lookup is a backend decision with a
// specific missing fact; its result and purpose do not reset the current beat.
let queried = 0;
const questionDuringDiscovery = harness({ replies: [
  answer(discover("An exterior repaint.", "Is it the whole house?", "Exterior repaint")),
  tool("knowledge_lookup", { query: "Do you paint metal siding?" }),
  answer(contract("We paint metal siding.", null, { conversation_plan: plan("none", "answer", "exploring", "Exterior repaint; metal siding") })),
  answer(contract("Yes, metal siding is included.", null, { conversation_plan: plan("none", "answer", "exploring", "Exterior repaint; metal siding") }))
], executeTool: async (_name, _id, args) => { queried++; assert.deepEqual(JSON.parse(args), { query: "First, do you paint metal siding?" }); return { status: "accepted", answer: "We paint metal siding." }; } });
await start(questionDuringDiscovery, "I'd like the exterior painted."); await questionDuringDiscovery.runtime.handle(delegate("discovery-before-question"));
await questionDuringDiscovery.runtime.handle(assistant(speech(questionDuringDiscovery).at(-1)));
await questionDuringDiscovery.runtime.handle(caller("First, do you paint metal siding?")); await questionDuringDiscovery.runtime.handle(delegate("siding-question"));
assert.equal(state(questionDuringDiscovery.requests[1]).conversation_state.discovery_questions_issued, 1);
assert.equal(speech(questionDuringDiscovery).at(-1), "We paint metal siding.");
await questionDuringDiscovery.runtime.handle(assistant(speech(questionDuringDiscovery).at(-1)));
await questionDuringDiscovery.runtime.handle(caller("Did you say you paint metal siding?")); await questionDuringDiscovery.runtime.handle(delegate("siding-repeat"));
assert.equal(queried, 1, "controller can answer a repeated question from its established fact without another lookup");
assert.equal(state(questionDuringDiscovery.requests[3]).conversation_state.discovery_questions_issued, 1);
assert.ok(questionDuringDiscovery.logs.some(x => x.event === "openai_live_lookup_decision" && x.purpose === "caller_question"));

const earlyLookup = harness({ replies: [
  tool("knowledge_lookup", { query: "The whole thing", lookup_intent: null }),
  input => { assert.equal(JSON.parse(input[0].output).reason, "conversation_lookup_intent_required"); return answer(contract("The full exterior — understood.", null, { conversation_plan: plan("none", "listen", "exploring", "Full exterior repaint") })); }
] });
await start(earlyLookup, "The whole thing."); await earlyLookup.runtime.handle(delegate("early-lookup"));
assert.equal(earlyLookup.calls.length, 0); assert.equal(earlyLookup.finishes.length, 0);
assert.deepEqual(speech(earlyLookup), ["The full exterior — understood."]);
const hesitant = harness({ replies: [
  answer(contract("You're still weighing up the exterior project.", question("Would you like a callback?", "callback_consent"), { conversation_plan: plan("callback_consent", "offer_callback", "hesitant", "Exterior repaint") })),
  answer(contract("You're still weighing up the exterior project. Take your time.", null, { conversation_plan: plan("none", "listen", "hesitant", "Exterior repaint") }))
] });
await start(hesitant, "I'm not ready for that yet."); await hesitant.runtime.handle(delegate("hesitant"));
assert.equal(hesitant.calls.length, 0); assert.equal(speech(hesitant).some(x => x.includes("?")), false);
assert.ok(hesitant.logs.some(x => x.constraint === "conversation_callback_readiness"));
const declinedConversation = harness({ replies: [
  answer(contract("", question("Would you like a callback?", "callback_consent"))),
  answer(contract("Of course. You can keep talking through the project here.", null, { conversation_plan: plan("none", "listen", "declined", "Exterior repaint") })),
  answer(contract("Just the garage exterior — understood.", null, { conversation_plan: plan("none", "understand", "declined", "Garage exterior repaint") }))
] });
await start(declinedConversation, "How can I talk with the team?"); await declinedConversation.runtime.handle(delegate("offer-before-decline"));
await declinedConversation.runtime.handle(assistant(speech(declinedConversation).at(-1)));
await declinedConversation.runtime.handle(caller("No, I don't want a callback.")); await declinedConversation.runtime.handle(delegate("decline-callback"));
await declinedConversation.runtime.handle(assistant(speech(declinedConversation).at(-1)));
await declinedConversation.runtime.handle(caller("Actually, it is only the garage.")); await declinedConversation.runtime.handle(delegate("correct-project"));
assert.equal(state(declinedConversation.requests[2]).conversation_state.last_plan.readiness, "declined");
assert.equal(declinedConversation.calls.length, 0); assert.equal(declinedConversation.finishes.length, 0);
assert.match(speech(declinedConversation).at(-1), /garage/);

// A completed reflection makes an acknowledgement a new conversational beat,
// while the existing in-flight lookup backchannel fixture below stays silent.
for (const acknowledgement of ["Okay.", "Go on."]) {
  const h = harness({ replies: [
    answer(contract("So the whole exterior needs repainting.", null, { conversation_plan: plan("none", "listen", "exploring", "Whole exterior repaint") })),
    answer(contract("", question("Would you like the team to call you about the project?", "callback_consent")))
  ] });
  await start(h, "The whole exterior needs painting."); await h.runtime.handle(delegate(`reflection-${acknowledgement}`));
  await h.runtime.handle(assistant(speech(h).at(-1)));
  await h.runtime.handle(caller(acknowledgement)); await h.runtime.handle(delegate(`reflection-answer-${acknowledgement}`));
  assert.equal(h.requests.length, 2); assert.equal(h.runtime.taskRevision, 2);
  assert.equal(state(h.requests[1]).conversation_state.callback_consent_confirmed, false, "reflection acknowledgement is readiness, never permission");
  assert.equal(h.calls.length, 0);
}

// The budget applies to the actual question class even when the backend gives
// it a misleading purpose. Contact exemptions require real application state.
const controller = new LiveConversationController();
controller.accept(plan("discovery", "understand")); controller.accept(plan("discovery", "understand"));
const evidence = { caller: { id: 7, text: "The whole thing." }, capturedFields: {}, contactFields: ["first_name", "callback_number"] };
const conditionQuestion = "Is the paint peeling or does the wood need repairs?";
assert.equal(controller.validate(plan("clarification", "understand"), question(conditionQuestion, "clarification"), evidence), "conversation_discovery_limit");
const contactPlan = { ...plan("required_contact", "capture", "receptive"), contact_field: "first_name" };
assert.equal(controller.validate(contactPlan, question(conditionQuestion), evidence), "conversation_contact_without_consent");
for (const consent of ["Yes, that would be great.", "Yes, please have them call me.", "Sure, my name is Ada."]) {
  const c = new LiveConversationController();
  c.observeAnswer({ id: "callback-q", kind: "callback_consent", text: "Would you like a callback?", spokenSequence: 10, answerTurnId: 11 }, { id: 11, text: consent });
  assert.equal(c.snapshot().callback_consent_confirmed, true);
  assert.equal(c.validate(contactPlan, question(conditionQuestion), evidence), "conversation_contact_question_binding");
  assert.equal(c.validate(contactPlan, question("What is your first name?"), evidence), undefined);
  assert.equal(c.validate(contactPlan, question("What is your first name?"), { ...evidence, capturedFields: { first_name: "Ada" } }), "conversation_contact_field_binding");
  c.observeCaller({ id: 12, text: "Don't call me." });
  assert.equal(c.snapshot().callback_consent_confirmed, false);
  assert.equal(c.validate(contactPlan, question("What is your first name?"), evidence), "conversation_contact_without_consent");
}
const pendingClarification = { id: "scope-q", kind: "clarification", text: "Is that the house or the garage?", spokenSequence: 5, answerTurnId: 7 };
const repeatPlan = { ...plan("clarification", "understand"), clarifies_question_id: pendingClarification.id };
assert.equal(controller.validate(repeatPlan, question(conditionQuestion, "clarification"), { ...evidence, pendingQuestion: pendingClarification }), "conversation_clarification_binding");
assert.equal(controller.validate(repeatPlan, question(pendingClarification.text, "clarification"), { ...evidence, pendingQuestion: pendingClarification }), undefined);
controller.accept(repeatPlan, pendingClarification);
assert.equal(controller.validate(repeatPlan, question(pendingClarification.text, "clarification"), { ...evidence, pendingQuestion: pendingClarification }), "conversation_clarification_binding");

const intent = (purpose, caller_quote, caller_turn_id = 7) => ({ purpose, caller_quote, caller_turn_id, missing_fact: "How much paint is peeling?" });
assert.equal(bindLookupIntent(intent("service_fit", "How much paint is peeling?"), evidence.caller).error, "lookup_caller_quote_binding");
assert.equal(bindLookupIntent(intent("service_fit", "The whole thing."), evidence.caller).error, "lookup_not_service_request");
assert.equal(bindLookupIntent(intent("caller_question", "The whole thing."), evidence.caller).error, "lookup_not_caller_question");
assert.equal(bindLookupIntent(intent("caller_question", "Do you repair peeling paint?"), { id: 7, text: "Do you repair peeling paint?" }).query, "Do you repair peeling paint?");
assert.match(bindLookupIntent(intent("service_fit", "I need my house painted."), { id: 7, text: "I need my house painted." }).query, /^Does the business offer the service/);
assert.equal(bindLookupIntent(intent("caller_question", "What is your warranty?", 6), { id: 7, text: "What is your warranty?" }).error, "lookup_caller_turn_binding");

// After project discovery, a genuine business question may still need a
// clarification. Its short answer must preserve the unresolved original query.
const clarifiedLookup = harness({ replies: [
  answer(discover("A house repaint.", "Inside or outside?", "House repaint")),
  answer(discover("Exterior painting.", "The whole house or one area?", "Exterior repaint")),
  input => {
    const latest = state(input).finalized_turns.filter(x => x.role === "user").at(-1);
    return answer(contract("", question("What type of siding?", "clarification"), { conversation_plan: { ...plan("clarification", "answer", "exploring", "Siding painting capability"), clarifies_question_id: `caller:${latest.id}` } }));
  },
  tool("knowledge_lookup", { query: "Do you paint metal siding?" }),
  answer(contract("We paint metal siding."))
], executeTool: async (_name, _id, args) => {
  assert.match(JSON.parse(args).query, /Do you paint siding\?/);
  assert.match(JSON.parse(args).query, /Caller clarified: Metal\./);
  return { status: "accepted", answer: "We paint metal siding." };
} });
await start(clarifiedLookup, "I need my house painted."); await clarifiedLookup.runtime.handle(delegate("clarify-project-one"));
await clarifiedLookup.runtime.handle(assistant(speech(clarifiedLookup).at(-1)));
await clarifiedLookup.runtime.handle(caller("Exterior.")); await clarifiedLookup.runtime.handle(delegate("clarify-project-two"));
await clarifiedLookup.runtime.handle(assistant(speech(clarifiedLookup).at(-1)));
await clarifiedLookup.runtime.handle(caller("Do you paint siding?")); await clarifiedLookup.runtime.handle(delegate("clarify-business"));
assert.equal(speech(clarifiedLookup).at(-1), "What type of siding?");
await clarifiedLookup.runtime.handle(assistant(speech(clarifiedLookup).at(-1)));
await clarifiedLookup.runtime.handle(caller("Metal.")); await clarifiedLookup.runtime.handle(delegate("clarify-business-answer"));
assert.equal(clarifiedLookup.calls.length, 1);
assert.equal(state(clarifiedLookup.requests[3]).conversation_state.discovery_questions_issued, 2);
assert.equal(speech(clarifiedLookup).at(-1), "We paint metal siding.");

const contactFlow = harness({ replies: [
  answer(contract("", question("Would you like a callback?", "callback_consent"))),
  answer(contract("", question("What is your first name?"), { conversation_plan: contactPlan })),
  answer(contract("", question("What is your callback number?"), { conversation_plan: { ...contactPlan, contact_field: "callback_number" } })),
  answer(contract("Of course, no callback.", null, { conversation_plan: plan("none", "listen", "declined") }))
] });
await start(contactFlow, "I want to talk with someone."); await contactFlow.runtime.handle(delegate("contact-offer"));
await contactFlow.runtime.handle(assistant(speech(contactFlow).at(-1)));
await contactFlow.runtime.handle(caller("Yes, that would be great.")); await contactFlow.runtime.handle(delegate("contact-consent"));
assert.equal(speech(contactFlow).at(-1), "What is your first name?");
await contactFlow.runtime.handle(assistant(speech(contactFlow).at(-1)));
await contactFlow.runtime.handle(caller("Don't call me.")); await contactFlow.runtime.handle(delegate("contact-revoke"));
assert.equal(speech(contactFlow).at(-1), "Of course, no callback.");
assert.ok(contactFlow.logs.some(x => x.constraint === "conversation_contact_without_consent"));
assert.equal(contactFlow.calls.length, 0);

// Actual transport with fake WebSockets: prepared affinity, incremental input,
// store:false cache-loss recovery and exact encrypted reasoning/tool-output replay.
class FakeSocket extends EventEmitter {
  readyState = 0; requests = [];
  constructor(onRequest) { super(); this.onRequest = onRequest; queueMicrotask(() => { this.readyState = 1; this.emit("open"); }); }
  send(raw) { const request = JSON.parse(raw); this.requests.push(request); queueMicrotask(() => this.onRequest(this, request)); }
  complete(response) { this.emit("message", JSON.stringify({ type: "response.completed", response })); }
  terminate() { this.readyState = 3; this.emit("close"); } close() { this.terminate(); }
}
const sockets = [], backendLogs = []; let generated = 0, failContinuation = true;
const session = new PreparedResponsesSession({
  apiKey: "fake-key", model: "gpt-5.6-terra", reasoningEffort: "medium", safetyIdentifier: "hashed-subject",
  instructions: "CANONICAL BUSINESS RULES" + LIVE_BACKEND_ADAPTER, tools: [{ type: "function", name: "knowledge_lookup", parameters: {} }], text: LIVE_HANDOFF_FORMAT,
  audit: (event, details) => backendLogs.push({ event, ...details }),
  socketFactory: (url, options) => {
    assert.equal(url, RESPONSES_WS_URL); assert.equal(options.headers.Authorization, "Bearer fake-key");
    const socket = new FakeSocket((ws, request) => {
      if (request.generate === false) { ws.complete({ id: `warm-${sockets.length}`, status: "completed", output: [] }); return; }
      if (generated === 1 && failContinuation) { failContinuation = false; ws.emit("message", JSON.stringify({ type: "error", error: { code: "previous_response_not_found" } })); return; }
      generated++;
      ws.complete(generated === 1 ? { id: "response-1", status: "completed", output: [{ type: "reasoning", encrypted_content: "opaque" }, tool("knowledge_lookup", { query: "hours" }, "lookup-1").output[0]] } : { ...answer(contract("We close at five.")), id: "response-2" });
    }); sockets.push(socket); return socket;
  }
});
await session.prepare(); assert.equal(sockets.length, 1); assert.equal(sockets[0].requests[0].generate, false);
const warmup = sockets[0].requests[0];
assert.equal(warmup.store, false); assert.equal(warmup.reasoning.effort, "medium");
assert.ok(warmup.instructions.startsWith("CANONICAL BUSINESS RULES")); assert.equal("stream" in warmup, false); assert.equal("background" in warmup, false);
const signal = new AbortController().signal;
await session.respond([{ role: "user", content: "What are your hours?" }], signal, { requestId: "request-1", delegationId: "delegation-1", generation: 1, step: 0 });
assert.deepEqual(backendLogs.filter(x => x.requestId === "request-1").map(x => x.milestone), ["backend_request_sent", "backend_first_event", "backend_response_completed"]);
assert.equal(sockets[0].requests[1].previous_response_id, "warm-1");
const resultInput = [{ type: "function_call_output", call_id: "lookup-1", output: '{"status":"accepted"}' }];
await session.respond(resultInput, signal); assert.equal(sockets.length, 2);
assert.deepEqual(sockets[0].requests[2].input, resultInput); assert.equal(sockets[1].requests[0].generate, false);
const recovered = sockets[1].requests[1]; assert.equal(recovered.previous_response_id, "warm-2");
assert.ok(recovered.input.some(x => x.encrypted_content === "opaque"));
assert.ok(recovered.input.some(x => x.call_id === "lookup-1" && x.type === "function_call_output"));
assert.equal(generated, 2); assert.ok(backendLogs.some(x => x.actionsReplayed === false));
session.close(); await assert.rejects(() => session.respond([], signal), /closed|aborted/);

const abortSockets = []; let streamedOnly = 0;
const abortSession = new PreparedResponsesSession({
  apiKey: "fake", model: "gpt-5.6-terra", reasoningEffort: "medium", safetyIdentifier: "hash", instructions: "rules", tools: [], text: LIVE_HANDOFF_FORMAT, audit() {},
  socketFactory: () => {
    const socket = new FakeSocket((ws, request) => {
      if (request.generate === false) ws.complete({ id: "prepared", status: "completed", output: [] });
      else { streamedOnly++; ws.emit("message", JSON.stringify({ type: "response.output_item.done", item: tool().output[0] })); }
    }); abortSockets.push(socket); return socket;
  }
});
await abortSession.prepare(); const abortController = new AbortController();
const abortPending = abortSession.respond([{ role: "user", content: "Save Ada" }], abortController.signal);
await tick(); abortController.abort(); await assert.rejects(() => abortPending, /aborted/);
assert.equal(streamedOnly, 1, "aborted generation is not automatically retried");
assert.equal(abortSockets[0].readyState, 3); abortSession.close();

// Scripted content proves handoff boundaries; it is not paid model-behavior certification.
for (const [utterance, result] of [
  ["Do you replace glass?", contract("We replace window glass.", null, { verified_facts: [{ text: "We replace window glass.", source: "approved_context", source_operation_id: null }] })],
  ["Can you schedule tomorrow?", contract("I can't book an appointment.", question("Would you like someone to call you back?", "callback_consent"))],
  ["Does this brand work?", contract("I don't have that confirmed.", question("Would you like someone to call you back?", "callback_consent"))]
]) {
  const h = harness({ replies: [answer(result)] }); await start(h, utterance); await h.runtime.handle(delegate(`matrix-${++seq}`));
  assert.deepEqual(speech(h), [[result.spoken_response, result.next_question?.text].filter(Boolean).join(" ")]);
  assert.ok(!JSON.stringify(h.sent).includes("verified_facts"));
}
const capture = harness({ replies: [tool("data_capture", { first_name: "Ada", last_name: "Qzynn", code: "A7K-92Q" }), answer(contract("", question("What is your callback number?")))] });
capture.runtime.input("before-start"); assert.equal(capture.sent.length, 0); await start(capture);
for (const fragment of ["My first name is Ada. My surname is ", "Q", " z", " y", " n", " n", ". The code is A7K-92Q."]) await capture.runtime.handle(caller(fragment));
assert.equal(capture.runtime.taskRevision, 0); await capture.runtime.handle(delegate("capture")); await capture.runtime.handle(delegate("capture"));
assert.equal(capture.runtime.taskRevision, 1); assert.match(state(capture.requests[0]).finalized_turns[0].text, /Q z y n n/);
assert.equal(JSON.parse(capture.calls[0][2]).code, "A7K-92Q"); assert.deepEqual(speech(capture), ["What is your callback number?"]);
assert.ok(capture.logs.some(x => x.milestone === "operation_completed"));
await capture.runtime.handle({ type: "session.output_audio.delta", delta: Buffer.alloc(160, 0).toString("base64") });
assert.ok(capture.logs.some(x => x.milestone === "live_audio_received" && x.playbackConfirmed === false));
const long = harness({ replies: [answer(contract("", question("Which window needs repair first?", "clarification")))] });
await start(long); const fragments = Array.from({ length: 60 }, (_, n) => `Window ${n + 1} is cracked, and `);
for (const part of fragments) await long.runtime.handle(caller(part));
await long.runtime.handle(delegate("long-request")); assert.equal(long.runtime.taskRevision, 1);
assert.equal(state(long.requests[0]).finalized_turns[0].text, fragments.join(""));

let releaseLookup;
const backchannel = harness({ replies: [tool("knowledge_lookup", { query: "hours" }), input => {
  const output = JSON.parse(input[0].output);
  return answer(contract("We close at five.", null, { verified_facts: [{ text: "We close at five.", source: "tool", source_operation_id: output.operation_id }], action_status: "completed", completed_operation_ids: [output.operation_id] }));
}], executeTool: async () => new Promise(resolve => { releaseLookup = () => resolve({ status: "accepted", raw_private_packet: "DO NOT EXPOSE" }); }) });
await start(backchannel, "What time do you close?"); const lookupPending = backchannel.runtime.handle(delegate("lookup")); await tick();
await backchannel.runtime.handle(caller("mm-hmm")); await backchannel.runtime.handle(delegate("backchannel")); releaseLookup(); await lookupPending;
assert.equal(backchannel.runtime.taskRevision, 1); assert.equal(backchannel.calls.length, 1); assert.deepEqual(speech(backchannel), ["We close at five."]);
assert.ok(!JSON.stringify(backchannel.sent).includes("DO NOT EXPOSE")); assert.ok(backchannel.logs.some(x => x.milestone === "commentary_sent" && x.useful));

let releaseReasoning;
const corrected = harness({ replies: [() => new Promise(resolve => { releaseReasoning = () => resolve(tool()); }), answer(contract("", question("Is Grace your first name?", "clarification")))] });
await start(corrected, "My name is Ada"); const old = corrected.runtime.handle(delegate("old")); await tick();
await corrected.runtime.handle(caller("Actually, Grace")); releaseReasoning(); await old; await idle();
assert.equal(corrected.calls.length, 0); assert.equal(corrected.runtime.taskRevision, 2);
assert.match(state(corrected.requests[1]).finalized_turns.at(-1).text, /Grace/);
assert.equal(JSON.parse(corrected.requests[1][0].output).status, "not_executed"); assert.deepEqual(speech(corrected), ["Is Grace your first name?"]);

const duplicate = harness({ replies: [tool(), tool(), answer(contract("", question("What is your callback number?")))] });
await start(duplicate, "Ada"); await duplicate.runtime.handle(delegate("duplicate")); assert.equal(duplicate.calls.length, 1);
let unknownCalls = 0;
const unknown = harness({ replies: [tool(), answer(contract("I couldn't confirm that.")), tool(), answer(contract("That action is still unconfirmed."))], executeTool: async () => { unknownCalls++; throw new Error("network_after_commit"); } });
await start(unknown, "My name is Ada"); await unknown.runtime.handle(delegate("unknown"));
await unknown.runtime.handle(caller("Try saving Ada again")); await unknown.runtime.handle(delegate("unknown-again"));
assert.equal(unknownCalls, 1); assert.ok(unknown.logs.some(x => x.event === "openai_live_operation" && x.status === "unknown"));
const returnedUnknown = harness({ replies: [tool("transfer_call", { target_id: "alice" }), tool("transfer_call", { target_id: "alice" }), answer(contract("The transfer is unconfirmed."))], executeTool: async () => ({ status: "unknown", reason: "transfer_outcome_unconfirmed" }) });
await start(returnedUnknown, "Connect me"); await returnedUnknown.runtime.handle(delegate("returned-unknown"));
assert.equal(returnedUnknown.calls.length, 1); assert.ok(returnedUnknown.logs.some(x => x.status === "unknown"));
assert.ok(!returnedUnknown.logs.some(x => x.status === "completed"));
let readAttempts = 0;
const retryRead = harness({ replies: [tool("knowledge_lookup", { query: "hours" }), tool("knowledge_lookup", { query: "hours" }), answer(contract("We close at five."))], executeTool: async () => {
  if (++readAttempts === 1) throw new Error("stale_live_lookup"); return { status: "accepted" };
} });
await start(retryRead, "Hours please"); await retryRead.runtime.handle(delegate("read-retry")); assert.equal(readAttempts, 2);
assert.notEqual(retryRead.calls[0][1], retryRead.calls[1][1]); assert.ok(!retryRead.logs.some(x => x.status === "unknown"));

// Run the real transfer handler in isolation. Provider timeouts and persistence
// failures after provider acceptance must retain the command and report unknown.
const source = readFileSync("apps/call-gateway/src/server.ts", "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const sendMediaNode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "sendTelnyxMedia");
assert.ok(sendMediaNode);
const sendMediaSandbox = vm.createContext({ WebSocket: { OPEN: 1 } });
vm.runInContext(ts.transpileModule(sendMediaNode.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, sendMediaSandbox);
let writeCallback, writeCount = 0, confirmedWrites = 0;
const telnyxSocket = { readyState: 1, send(_payload, callback) { writeCount++; writeCallback = callback; } };
sendMediaSandbox.sendTelnyxMedia(telnyxSocket, "stream", "AA==", () => confirmedWrites++);
assert.equal(confirmedWrites, 0, "queue submission is not a confirmed Telnyx write");
writeCallback(new Error("write_failed")); assert.equal(confirmedWrites, 0);
sendMediaSandbox.sendTelnyxMedia(telnyxSocket, "stream", "AA==", () => confirmedWrites++);
writeCallback(); assert.equal(confirmedWrites, 1);
sendMediaSandbox.sendTelnyxMedia({ ...telnyxSocket, readyState: 3 }, "stream", "AA==", () => confirmedWrites++);
sendMediaSandbox.sendTelnyxMedia(telnyxSocket, undefined, "AA==", () => confirmedWrites++);
assert.equal(writeCount, 2); assert.equal(confirmedWrites, 1);
const executeNode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "executeToolCall");
assert.ok(executeNode);
const executeJs = ts.transpileModule(executeNode.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const failure of ["provider", "persistence"]) {
  const outputs = []; let commands = 0;
  const gateway = { live: {}, tenantKey: "tenant-a", callSid: "call-a", callControlId: "control-a", pendingTransferCandidate: { targetId: "alice", confirmed: true }, transferState: null };
  const sandbox = vm.createContext({
    crypto: { randomUUID: () => "stable-command" },
    loadTransferTargetById: async () => ({ name: "Alice", transfer_extension: "3", forward_to_number: "fake-destination" }),
    telnyxCallAction: async () => { commands++; if (failure === "provider") throw new Error("timeout_after_submission"); },
    persistTransferCallState: async () => { if (failure === "persistence") throw new Error("database_unavailable_after_acceptance"); },
    detachAiForTransferredCall: async () => {}, encodeTransferLegClientState: () => "fake-state",
    forwardToolResult: async (_call, _tenant, _name, output) => outputs.push(output),
    createFunctionCallOutputEvent: (_id, output) => output, createAudioTextResponseEvent: () => ({}),
    sendOpenAiEvent() {}, logError() {}, logRealtimeToolPayloads() {}, noteToolResponseRequested() {}, requestAssistantResponse() {}, normalizeToolExecutionKey: () => "key"
  });
  vm.runInContext(executeJs + "\nthis.execute = executeToolCall;", sandbox);
  await sandbox.execute(gateway, "transfer_call", "first", '{"target_id":"alice"}', () => true);
  assert.equal(outputs.at(-1).status, "unknown"); assert.equal(gateway.transferState.commandId, "everycall_transfer_stable-command");
  await sandbox.execute(gateway, "transfer_call", "second", '{"target_id":"alice"}', () => true);
  assert.equal(commands, 1); assert.equal(outputs.at(-1).reason, "transfer_already_in_progress");
}

let releaseAction; const permitChecks = [];
const race = harness({ replies: [tool(), answer(contract("", question("What name should I use?", "clarification")))], executeTool: async (_name, _id, _args, mayCommit) => {
  permitChecks.push(mayCommit()); await new Promise(resolve => { releaseAction = resolve; }); permitChecks.push(mayCommit());
  if (!mayCommit()) throw new Error("stale_preflight"); return { status: "accepted" };
} });
await start(race, "Ada"); const racing = race.runtime.handle(delegate("race")); await tick();
await race.runtime.handle(caller("No, don't save that")); releaseAction(); await racing; await idle(); assert.deepEqual(permitChecks, [true, false]);

// Exact target and actual spoken question are required. The gateway's existing
// consent classifier receives the bound answer, including explicit refusal.
for (const response of ["Yes please", "No, don't transfer"]) {
  const h = harness({ replies: [answer(contract("", question("Would you like me to transfer you to Alice?", "transfer_confirmation", "alice"))), tool("transfer_call", { target_id: "alice" }), answer(contract("I couldn't confirm the transfer."))], executeTool: async () => {
    assert.equal(h.runtime.callerConfirmationAfter(1, "alice"), response);
    assert.equal(h.runtime.callerConfirmationAfter(1, "bob"), "");
    return { status: "failed", reason: response.startsWith("No") ? "confirmation_required" : "provider_failure" };
  } });
  await start(h, "Please transfer"); await h.runtime.handle(delegate(`q-${++seq}`));
  assert.equal(h.runtime.callerConfirmationAfter(1, "alice"), "");
  await h.runtime.handle(assistant("Would you like me to transfer you to Alice?")); await h.runtime.handle(caller(response)); await h.runtime.handle(delegate(`a-${++seq}`));
  const bound = state(h.requests[1]).pending_question; assert.equal(bound.target_id, "alice"); assert.equal(bound.answer, response); assert.ok(bound.spokenSequence);
  assert.ok(h.logs.some(x => x.event === "openai_live_operation" && x.status === "failed"));
}
const unrelated = harness({ replies: [answer(contract("", question("Would you like me to transfer you to Alice?", "transfer_confirmation", "alice"))), answer(contract("Please clarify."))] });
await start(unrelated, "Transfer me"); await unrelated.runtime.handle(delegate("unrelated-q"));
await unrelated.runtime.handle(assistant("Is your name Ada?")); await unrelated.runtime.handle(caller("Yes")); await unrelated.runtime.handle(delegate("unrelated-a"));
assert.equal(unrelated.runtime.callerConfirmationAfter(1, "alice"), ""); assert.equal(state(unrelated.requests[1]).pending_question, null);

const denied = harness({ replies: [tool("delete_tenant")] }); await start(denied, "Delete it"); await denied.runtime.handle(delegate("denied"));
assert.equal(denied.calls.length, 0); assert.ok(denied.logs.some(x => x.event === "openai_live_task_failed"));
assert.deepEqual(speech(denied), ["I'm sorry, I couldn't confirm that."]);
const schemaDenied = harness({ replies: [tool()], validateTool: () => false });
await start(schemaDenied, "Save malformed input"); await schemaDenied.runtime.handle(delegate("bad-schema")); assert.equal(schemaDenied.calls.length, 0);
const invalidCapture = harness({ replies: [tool(), input => {
  assert.equal(JSON.parse(input[0].output).action_status, "failed"); return answer(contract("I couldn't save that detail."));
}], executeTool: async () => ({ status: "invalid", errors: ["phone_number_invalid"] }) });
await start(invalidCapture, "Ada"); await invalidCapture.runtime.handle(delegate("invalid-capture"));
assert.ok(invalidCapture.logs.some(x => x.name === "data_capture" && x.status === "failed"));
assert.ok(!invalidCapture.logs.some(x => x.status === "completed"));
const refusalFailure = harness({ replies: [answer(contract("", question("Would you like someone to call you back?", "callback_consent"))), () => { throw new Error("live_backend_unavailable"); }, answer(contract("I understand."))] });
await start(refusalFailure, "Can you book tomorrow?"); await refusalFailure.runtime.handle(delegate("refusal-offer"));
await refusalFailure.runtime.handle(assistant("Would you like someone to call you back?")); await refusalFailure.runtime.handle(caller("No callback, please"));
await refusalFailure.runtime.handle(delegate("refusal-failure"));
assert.equal(speech(refusalFailure).at(-1), "I'm sorry, I couldn't confirm that.");
await refusalFailure.runtime.handle(caller("Did you hear me?")); await refusalFailure.runtime.handle(delegate("after-refusal"));
assert.equal(state(refusalFailure.requests[2]).pending_question.answer, "No callback, please", "failure preserves the refusal without inventing a new question");
const otherTenant = harness({ tenantKey: "tenant-b", replies: [tool(), answer(contract("Saved."))] });
await start(otherTenant, "Ada"); await otherTenant.runtime.handle(delegate("other")); assert.notEqual(duplicate.calls[0][1], otherTenant.calls[0][1]);

let closeRuntime; const closeText = "Thanks for calling. Have a good one.";
const closing = harness({ replies: [answer(contract("", question("Is there anything else I can help you with?", "other_questions"))), tool("finish_session", { reason: "caller_finished" })], executeTool: async () => ({ status: closeRuntime.requestFinish(closeText) ? "accepted" : "failed" }) });
closeRuntime = closing.runtime; await start(closing, "That's all"); assert.equal(closeRuntime.requestFinish(closeText), false);
await closeRuntime.handle(delegate("preclose")); await closeRuntime.handle(assistant("Is there anything else I can help you with?"));
await closeRuntime.handle(caller("No, that's all")); await closeRuntime.handle(delegate("finish")); assert.match(closing.sent.at(-1).content, /Say exactly this closing once/);
await closeRuntime.handle({ type: "session.instructions.appended", client_event_id: closing.sent.at(-1).event_id }); closeRuntime.checkFinish(true); assert.equal(closing.finishes.length, 0);
await closeRuntime.handle(assistant(closeText)); closeRuntime.notePlayback(Buffer.alloc(160, 0)); closeRuntime.checkFinish(false, Date.now() + 2000); assert.equal(closing.finishes.length, 0);
closeRuntime.checkFinish(true, Date.now() + 2000); assert.deepEqual(closing.finishes, ["assistant_finish_session"]);

let interruptedRuntime;
const interrupted = harness({ replies: [answer(contract("", question("Is there anything else I can help you with?", "other_questions"))), tool("finish_session", { reason: "finished" })], executeTool: async () => ({ status: interruptedRuntime.requestFinish(closeText) ? "accepted" : "failed" }) });
interruptedRuntime = interrupted.runtime; await start(interrupted, "All done"); await interruptedRuntime.handle(delegate("interrupt-checkpoint"));
await interruptedRuntime.handle(assistant("Is there anything else I can help you with?")); await interruptedRuntime.handle(caller("No")); await interruptedRuntime.handle(delegate("interrupt-close"));
await interruptedRuntime.handle(assistant("Thanks for calling.")); interruptedRuntime.notePlayback(Buffer.alloc(160, 0));
await interruptedRuntime.handle(caller("Actually, one more question")); interruptedRuntime.checkFinish(true, Date.now() + 20000);
assert.equal(interrupted.finishes.length, 0, "caller interruption cancels deferred closing");
assert.match(interrupted.sent.at(-1).content, /caller has spoken again/);

const noisy = harness(); await start(noisy, "[noise]"); await noisy.runtime.handle(delegate("noise")); assert.equal(noisy.requests.length, 0); assert.equal(noisy.runtime.taskRevision, 0);
await noisy.runtime.handle({ type: "session.output_audio.delta", delta: Buffer.alloc(160, 255).toString("base64") }); assert.equal(noisy.logs.some(x => x.milestone === "live_audio_received"), false);
await noisy.runtime.handle({ type: "session.closed", usage: { seconds: 1 } }); assert.equal(noisy.closed(), true); assert.deepEqual(noisy.finishes, ["openai_live_provider_closed"]);
await noisy.runtime.handle(caller("after disconnect")); assert.equal(noisy.runtime.taskRevision, 0);
for (const h of all) { if (h.runtime.closed) continue; const done = h.runtime.close(); await h.runtime.handle({ type: "session.closed", usage: { seconds: 3 } }); await done; assert.equal(h.closed(), true); }
console.log("Live offline acceptance passed: prepared WebSocket/medium/store:false/recovery; split prompts; atomic handoffs; fact and scheduling fixtures; spelling; corrections/backchannels; no replay; target-bound consent; failures; closing/playback; noise/disconnect; latency milestones.");
