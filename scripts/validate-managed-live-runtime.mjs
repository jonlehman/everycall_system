import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ManagedLiveRuntime, buildManagedLiveStart, MANAGED_BACKEND_INSTRUCTIONS } from "../apps/call-gateway/dist/apps/call-gateway/src/managedLiveRuntime.js";
import { LIVE_CALLBACK_QUESTION } from "../apps/call-gateway/dist/apps/call-gateway/src/liveRuntime.js";

let sequence = 0;
const all = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
function harness(overrides = {}) {
  const sent = [], executed = [], audits = [], finishes = [], transcripts = [];
  const tools = ["knowledge_lookup", "lookup_transfer_target", "transfer_call", "data_capture", "finish_session"].map(name => ({ type: "function", name,
    parameters: { type: "object", ...(name === "data_capture" ? { properties: { first_name: { type: "string" }, last_name: { type: "string" }, callback_number: { type: "string" } } } : {}) } }));
  const runtime = new ManagedLiveRuntime({
    tenantKey: "tenant-a", callSid: "call-a", backendModel: "gpt-6-luna", instructions: "TRUSTED COMPANY RULES", tools,
    settleMs: 0, send: event => sent.push(event), isActive: () => true, state: () => ({ captured_fields: {} }),
    executeTool: async (...args) => { executed.push(args); return overrides.executeTool ? overrides.executeTool(...args) : { status: "accepted" }; },
    validateTool: (_name, args) => !args.invalid, transcript: entry => transcripts.push(entry), audio: () => {}, ready: () => {},
    audit: (event, details) => audits.push({ event, ...details }), finish: reason => finishes.push(reason), ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "executeTool"))
  });
  const h = { runtime, sent, executed, audits, finishes, transcripts, tools, clock: 0 };
  all.push(h); return h;
}
async function transcript(h, role, text, options = {}) {
  const start = options.start ?? h.clock; h.clock = Math.max(h.clock + 100, start + 100);
  await h.runtime.handle({ type: `session.${role === "user" ? "input" : "output"}_transcript.delta`, delta: text, start_ms: start, end_ms: start + 90 });
  if (role === "assistant") await pause();
}
async function start(h, callerText) { await h.runtime.handle({ type: "session.started" }); if (callerText) await transcript(h, "user", callerText); }
async function openResponse(h, { delegationId = `d-${++sequence}`, responseId = `r-${++sequence}` } = {}) {
  await h.runtime.handle({ type: "session.delegation.created", delegation: { id: delegationId, target: "responses", response_id: responseId } });
  await nested(h, delegationId, { type: "response.created", response: { id: responseId, status: "in_progress", output: [] } });
  return { delegationId, responseId };
}
async function nested(h, delegationId, event, eventId = `e-${++sequence}`) {
  await h.runtime.handle({ type: "response.event", event_id: eventId, delegation_id: delegationId, event });
}
async function item(h, response, name, args, callId = `f-${++sequence}`) {
  if (name === "knowledge_lookup" && !Object.hasOwn(args, "lookup_intent")) args = { ...args, lookup_intent: {
    purpose: "caller_question", missing_fact: args.query || "Business hours", caller_quote: h.runtime.latestCallerText()
  } };
  await nested(h, response.delegationId, { type: "response.output_item.done", response_id: response.responseId,
    item: { type: "function_call", status: "completed", call_id: callId, name, arguments: JSON.stringify(args) } });
  return callId;
}
async function complete(h, response, status = "completed") {
  await nested(h, response.delegationId, { type: `response.${status}`, response: { id: response.responseId, status, output: [], tools: [], instructions: null } });
}
async function call(h, name, args, callId) {
  const response = await openResponse(h); const id = await item(h, response, name, args, callId); await complete(h, response);
  const output = h.sent.filter(event => event.type === "response.item.create" && event.item.call_id === id).at(-1);
  return output ? JSON.parse(output.item.output) : undefined;
}
async function prepare(h, kind, args = {}) {
  const result = await call(h, "prepare_protected_question", { kind, ...args }); assert.equal(result.status, "accepted", JSON.stringify(result)); return result.exact_question;
}
async function consent(h) {
  await transcript(h, "assistant", await prepare(h, "callback_consent")); await transcript(h, "user", "Yes, please.");
}

const config = buildManagedLiveStart("LIVE SPEECH", "marin", { backendModel: "gpt-6-luna", reasoningEffort: "none", instructions: "BUSINESS RULES", tools: harness().tools });
assert.equal(config.session.delegation.type, "responses");
assert.equal(config.session.delegation.responses.model, "gpt-6-luna");
assert.equal(config.session.delegation.responses.reasoning.effort, "none");
assert.equal(config.session.delegation.responses.parallel_tool_calls, false);
assert.equal(config.session.delegation.responses.tool_choice, "auto");
assert.equal(config.session.store, false);
assert.deepEqual(config.session.audio.format, { type: "audio/pcmu", rate: 8000 });
assert.ok(config.session.delegation.responses.instructions.endsWith(MANAGED_BACKEND_INSTRUCTIONS));
assert.equal("text" in config.session.delegation.responses, false, "managed mode must not send the client JSON handoff");
assert.equal(config.session.delegation.responses.tools.filter(tool => tool.name === "prepare_protected_question").length, 1);
const lookupSchema = config.session.delegation.responses.tools.find(tool => tool.name === "knowledge_lookup").parameters.properties.lookup_intent;
assert.ok(lookupSchema.required.includes("caller_quote")); assert.equal("caller_turn_id" in lookupSchema.properties, false);
assert.throws(() => buildManagedLiveStart("", "marin", { backendModel: "", instructions: "", tools: [] }));
// The server must trust only the managed runtime's already-bound affirmative,
// rather than re-parsing and rejecting natural forms such as "Absolutely".
const gatewaySource = readFileSync(new URL("../apps/call-gateway/src/server.ts", import.meta.url), "utf8");
assert.match(gatewaySource, /noteCallerTransferConfirmation\(session,\s*live\.callerConfirmationAfter\(lookupRevision,\s*candidate\.targetId\),\s*true\)/);

// Completed item events, not argument fragments or lifecycle output arrays, authorize execution.
const protocol = harness(); await start(protocol, "What are your hours?");
const response = await openResponse(protocol);
await nested(protocol, response.delegationId, { type: "response.function_call_arguments.done", response_id: response.responseId, call_id: "call-hours", name: "knowledge_lookup", arguments: '{"query":"hours"}' });
assert.equal(protocol.executed.length, 0);
await item(protocol, response, "knowledge_lookup", { query: "hours" }, "call-hours");
await item(protocol, response, "knowledge_lookup", { query: "hours" }, "call-hours");
assert.equal(protocol.executed.length, 0, "wait for complete batch before executing");
await complete(protocol, response); await complete(protocol, response);
assert.equal(protocol.executed.length, 1);
assert.deepEqual(protocol.sent.slice(-2).map(event => event.type), ["response.item.create", "response.create"]);
const repeated = await call(protocol, "knowledge_lookup", { query: "hours" }, "call-hours");
assert.equal(protocol.executed.length, 1, "duplicate call ID replays result, not execution");
assert.equal(repeated.action_status, "completed");
assert.ok(protocol.sent.filter(event => event.type === "response.create").every(event => Object.keys(event).sort().join() === "event_id,type"));
assert.deepEqual(JSON.parse(protocol.executed[0][2]), { query: "What are your hours?" }, "gateway binds actual caller query and strips lookup metadata");

// Live forwards output-item events without response_id; the outer delegation maps them.
const noResponseId = harness(); await start(noResponseId, "I need a repair.");
const mapped = await openResponse(noResponseId);
await nested(noResponseId, mapped.delegationId, { type: "response.output_item.done", item: { type: "function_call", call_id: "mapped-call", name: "data_capture", arguments: '{"service_request":"repair"}' } });
await complete(noResponseId, mapped);
assert.equal(noResponseId.executed.length, 1, "project-only capture requires no contact consent");
const following = await openResponse(noResponseId, { delegationId: mapped.delegationId });
await nested(noResponseId, following.delegationId, { type: "response.output_item.done", item: { type: "function_call", call_id: "follow-call", name: "data_capture", arguments: '{"service_request":"window repair"}' } });
await complete(noResponseId, following);
assert.equal(noResponseId.executed.length, 2, "follow-on response updates the active mapping");

const parallel = harness(); await start(parallel, "Do something.");
const batch = await openResponse(parallel);
await item(parallel, batch, "knowledge_lookup", { query: "hours" }); await item(parallel, batch, "data_capture", { first_name: "Ada" });
await complete(parallel, batch);
assert.equal(parallel.executed.length, 0);
assert.deepEqual(parallel.sent.slice(-3).map(event => event.type), ["response.item.create", "response.item.create", "response.create"]);

const malformed = harness(); await start(malformed, "What are your hours?");
assert.equal((await call(malformed, "delete_all", {})).reason, "unauthorized_tool");
assert.equal((await call(malformed, "knowledge_lookup", { invalid: true })).reason, "unauthorized_tool");
assert.equal(malformed.executed.length, 0);
await nested(malformed, "unknown", { type: "response.created", response: { id: "rogue" } });
assert.ok(malformed.audits.some(entry => entry.reason === "unknown_delegation"));
assert.equal((await call(malformed, "knowledge_lookup", { query: "hours", lookup_intent: { purpose: "caller_question", missing_fact: "hours", caller_quote: "Does the company sell secrets?" } })).reason, "lookup_caller_quote_binding");
assert.equal((await call(malformed, "knowledge_lookup", { query: "hours", lookup_intent: null })).reason, "conversation_lookup_intent_required");

const spelling = harness(); await start(spelling, "I need help."); await consent(spelling);
await transcript(spelling, "user", "My name is Jon. My last name is L E H "); await transcript(spelling, "user", "M A N.");
assert.equal((await call(spelling, "data_capture", { first_name: "Jon", last_name: "Lehman" })).action_status, "completed", "spelled surname fragments stay valid");
assert.equal((await call(spelling, "data_capture", { first_name: "on" })).reason, "protected_action_not_authorized", "partial-word substring is not name evidence");

// An unregistered spoken question or a yes before a prepared question is heard grants no consent.
const unauthorized = harness(); await start(unauthorized, "I need a repair.");
await transcript(unauthorized, "assistant", LIVE_CALLBACK_QUESTION); await transcript(unauthorized, "user", "Yes.");
assert.equal((await call(unauthorized, "data_capture", { first_name: "Ada" })).reason, "protected_action_not_authorized");
await prepare(unauthorized, "callback_consent"); await transcript(unauthorized, "user", "Yes.");
assert.equal((await call(unauthorized, "data_capture", { first_name: "Ada" })).reason, "protected_action_not_authorized");
assert.equal(unauthorized.executed.length, 0);

// Exact question, answer timing, caller spelling, and phone readback are separately bound.
const capture = harness(); await start(capture, "I need a repair."); await consent(capture);
await transcript(capture, "user", "My name is Ada Lovelace. My number is 509 555 0123.");
assert.equal((await call(capture, "data_capture", { first_name: "Ada", callback_number: "5095550123" })).reason, "protected_action_not_authorized");
const phoneQuestion = await prepare(capture, "phone_confirmation", { contact_field: "callback_number", value: "5095550123" });
await transcript(capture, "assistant", phoneQuestion); await transcript(capture, "user", "Yes.");
assert.equal((await call(capture, "data_capture", { first_name: "Invented", callback_number: "5095550123" })).reason, "protected_action_not_authorized");
assert.equal((await call(capture, "data_capture", { first_name: "Ada", last_name: "Lovelace", callback_number: "5095550123" })).action_status, "completed");
assert.equal(capture.executed.length, 1);
await call(capture, "data_capture", { callback_number: "5095550123", last_name: "Lovelace", first_name: "Ada" });
assert.equal(capture.executed.length, 1, "new function ID and reordered args cannot repeat a committed action");
await transcript(capture, "user", "Actually, don't call me.");
assert.equal((await call(capture, "data_capture", { first_name: "Ada" })).reason, "protected_action_not_authorized");

// A yes prefix cannot confirm the old number when that same answer corrects it.
for (const correction of ["Yes, actually the last four are 4321.", "Yes, but it ends in 4321.", "Yes, 5095554321."]) {
  const correctedPhone = harness(); await start(correctedPhone, "I need help."); await consent(correctedPhone);
  await transcript(correctedPhone, "user", "My number is 5095550123.");
  await transcript(correctedPhone, "assistant", await prepare(correctedPhone, "phone_confirmation", { contact_field: "callback_number", value: "5095550123" }));
  await transcript(correctedPhone, "user", correction);
  assert.equal((await call(correctedPhone, "data_capture", { callback_number: "5095550123" })).reason, "protected_action_not_authorized");
  assert.equal(correctedPhone.executed.length, 0);
  await transcript(correctedPhone, "user", "The full number is 5095554321.");
  await transcript(correctedPhone, "assistant", await prepare(correctedPhone, "phone_confirmation", { contact_field: "callback_number", value: "5095554321" }));
  await transcript(correctedPhone, "user", "Yes, that's correct.");
  assert.equal((await call(correctedPhone, "data_capture", { callback_number: "5095554321" })).action_status, "completed");
  await transcript(correctedPhone, "user", "The last four are 9876.");
  assert.equal((await call(correctedPhone, "data_capture", { callback_number: "5095554321" })).reason, "protected_action_not_authorized", "later partial-digit corrections also invalidate confirmation");
}

const overlap = harness(); await start(overlap, "I need help.");
await transcript(overlap, "assistant", await prepare(overlap, "callback_consent"));
await transcript(overlap, "user", "Yes.", { start: 0 });
assert.equal((await call(overlap, "data_capture", { first_name: "Ada" })).reason, "protected_action_not_authorized", "overlapping answer cannot consent to a question not yet finished");

const unrelated = harness(); await start(unrelated, "I need help.");
await transcript(unrelated, "assistant", await prepare(unrelated, "callback_consent"));
await transcript(unrelated, "assistant", "Do you have a window?"); await transcript(unrelated, "user", "Yes.");
assert.equal((await call(unrelated, "data_capture", { first_name: "Ada" })).reason, "protected_action_not_authorized");

for (const interveningTurn of ["Do you have a window", "I can help with that"]) {
  const withoutPunctuation = harness(); await start(withoutPunctuation, "I need help.");
  await transcript(withoutPunctuation, "assistant", await prepare(withoutPunctuation, "callback_consent"));
  await transcript(withoutPunctuation, "assistant", interveningTurn); await transcript(withoutPunctuation, "user", "Yes");
  assert.equal((await call(withoutPunctuation, "data_capture", { callback_number: "5095550123" })).reason, "protected_action_not_authorized");
  assert.equal((await call(withoutPunctuation, "prepare_protected_question", { kind: "contact", contact_field: "first_name" })).reason, "question_not_authorized");
  assert.equal(withoutPunctuation.executed.length, 0);
}

const currentNames = {};
const nameCorrection = harness({ state: () => ({ captured_fields: currentNames }), executeTool: async (_name, _id, args) => {
  Object.assign(currentNames, JSON.parse(args)); return { status: "accepted" };
} });
await start(nameCorrection, "I need help."); await consent(nameCorrection); await transcript(nameCorrection, "user", "My name is Alice.");
assert.equal((await call(nameCorrection, "data_capture", { first_name: "Alice" })).action_status, "completed");
await transcript(nameCorrection, "user", "Actually my name is Bob, not Alice.");
assert.equal((await call(nameCorrection, "data_capture", { first_name: "Alice" })).reason, "protected_action_not_authorized", "negated historical name cannot be recaptured even before Bob is saved");
assert.equal((await call(nameCorrection, "data_capture", { first_name: "Bob" })).action_status, "completed");
assert.equal((await call(nameCorrection, "data_capture", { first_name: "Alice" })).reason, "protected_action_not_authorized");
assert.equal(currentNames.first_name, "Bob"); assert.equal(nameCorrection.executed.length, 2);
await transcript(nameCorrection, "user", "Actually, my name is Alice after all.");
assert.equal((await call(nameCorrection, "data_capture", { first_name: "Alice" })).action_status, "completed", "new explicit caller evidence permits a genuine name reversion");
assert.equal(currentNames.first_name, "Alice"); assert.equal(nameCorrection.executed.length, 3);

for (const initiallyCaptured of [false, true]) {
  const shortNameValues = {};
  const shortCorrection = harness({ state: () => ({ captured_fields: shortNameValues }), executeTool: async (_name, _id, args) => {
    Object.assign(shortNameValues, JSON.parse(args)); return { status: "accepted" };
  } });
  await start(shortCorrection, "I need help."); await consent(shortCorrection);
  await transcript(shortCorrection, "user", "My name is Alice.");
  if (initiallyCaptured) await call(shortCorrection, "data_capture", { first_name: "Alice" });
  await transcript(shortCorrection, "assistant", "What is your first name?");
  await transcript(shortCorrection, "user", "Actually, Bob.");
  assert.equal((await call(shortCorrection, "data_capture", { first_name: "Alice" })).reason, "protected_action_not_authorized", "short correction answering a name prompt supersedes historical Alice");
  assert.equal((await call(shortCorrection, "data_capture", { first_name: "Bob" })).action_status, "completed");
  assert.equal(shortNameValues.first_name, "Bob");
  assert.equal((await call(shortCorrection, "data_capture", { first_name: "Alice" })).reason, "protected_action_not_authorized");
  await transcript(shortCorrection, "assistant", "What is your first name");
  await transcript(shortCorrection, "user", "Actually, Alice.");
  assert.equal((await call(shortCorrection, "data_capture", { first_name: "Alice" })).action_status, "completed", "a new short answer can explicitly revert the name without question punctuation");
  assert.equal(shortNameValues.first_name, "Alice");
}

const transferTarget = { target_id: "alice", name: "Alice", extension: "101" };
const transfer = harness({ executeTool: async name => name === "lookup_transfer_target"
  ? { status: "match", query: "Alice", target: transferTarget, matches: [transferTarget], requires_confirmation: true, next_step: "ask_for_confirmation_before_transfer" }
  : { status: "accepted" } });
await start(transfer, "Can I speak to Alice?"); await call(transfer, "lookup_transfer_target", { query: "Alice" });
assert.equal((await call(transfer, "transfer_call", { target_id: "alice" })).reason, "protected_action_not_authorized");
await transcript(transfer, "assistant", await prepare(transfer, "transfer_confirmation", { target_id: "alice" }));
await transcript(transfer, "user", "Yes.");
assert.equal((await call(transfer, "transfer_call", { target_id: "bob" })).reason, "protected_action_not_authorized");
assert.equal((await call(transfer, "transfer_call", { target_id: "alice" })).action_status, "completed");

const transferFixture = args => {
  const target = JSON.parse(args).query === "Bob" ? { target_id: "bob", name: "Bob", extension: "102" } : transferTarget;
  return { status: "match", target, matches: [target], requires_confirmation: true };
};
const switchedQuestion = harness({ executeTool: async (name, _id, args) => name === "lookup_transfer_target" ? transferFixture(args) : { status: "accepted" } });
await start(switchedQuestion, "I need help."); await prepare(switchedQuestion, "callback_consent");
await transcript(switchedQuestion, "user", "Actually, can you transfer me to Alice instead?");
await call(switchedQuestion, "lookup_transfer_target", { query: "Alice" });
const switchedText = await prepare(switchedQuestion, "transfer_confirmation", { target_id: "alice" });
assert.equal(switchedText, "Would you like me to transfer you to Alice?", "unspoken callback question cannot block the new workflow");
await transcript(switchedQuestion, "assistant", switchedText);
await transcript(switchedQuestion, "user", "Yes, actually transfer me to Bob.");
assert.equal((await call(switchedQuestion, "transfer_call", { target_id: "alice" })).reason, "protected_action_not_authorized");
await call(switchedQuestion, "lookup_transfer_target", { query: "Bob" });
await transcript(switchedQuestion, "assistant", await prepare(switchedQuestion, "transfer_confirmation", { target_id: "bob" }));
await transcript(switchedQuestion, "user", "Yes, please.");
assert.equal((await call(switchedQuestion, "transfer_call", { target_id: "bob" })).action_status, "completed");
assert.equal(switchedQuestion.executed.filter(([name]) => name === "transfer_call").length, 1);

for (const affirmative of ["Yeah, that'd be helpful", "Yes, that would be great", "Absolutely"]) {
  const naturalCallback = harness(); await start(naturalCallback, "I need help.");
  await transcript(naturalCallback, "assistant", await prepare(naturalCallback, "callback_consent")); await transcript(naturalCallback, "user", affirmative);
  assert.equal((await call(naturalCallback, "prepare_protected_question", { kind: "contact", contact_field: "first_name" })).status, "accepted", affirmative);
  const naturalTransfer = harness({ executeTool: async (name, _id, args) => name === "lookup_transfer_target" ? transferFixture(args) : { status: "accepted" } });
  await start(naturalTransfer, "Could I speak to Alice?"); await call(naturalTransfer, "lookup_transfer_target", { query: "Alice" });
  await transcript(naturalTransfer, "assistant", await prepare(naturalTransfer, "transfer_confirmation", { target_id: "alice" })); await transcript(naturalTransfer, "user", affirmative);
  assert.equal((await call(naturalTransfer, "transfer_call", { target_id: "alice" })).action_status, "completed", affirmative);
}

// Known gateway precommit cancellation is failed/stale, not an uncertain transfer.
for (const staleError of ["stale_live_tool", "stale_live_transfer"]) {
  let releaseTransfer, transferReady, committedTargets = [];
  const transferRace = harness({ executeTool: async (name, _id, args, mayCommit) => {
    if (name === "lookup_transfer_target") return transferFixture(args);
    const target = JSON.parse(args).target_id;
    if (target === "alice") { transferReady = true; await new Promise(resolve => { releaseTransfer = resolve; }); }
    if (!mayCommit()) throw new Error(staleError);
    committedTargets.push(target); return { status: "accepted" };
  } });
  await start(transferRace, "Can you transfer me to Alice?"); await call(transferRace, "lookup_transfer_target", { query: "Alice" });
  await transcript(transferRace, "assistant", await prepare(transferRace, "transfer_confirmation", { target_id: "alice" })); await transcript(transferRace, "user", "Yes.");
  const pendingTransfer = call(transferRace, "transfer_call", { target_id: "alice" });
  while (!transferReady) await pause();
  await transcript(transferRace, "user", "Actually, transfer me to Bob instead."); releaseTransfer();
  const cancelled = await pendingTransfer;
  assert.equal(cancelled.action_status, "failed"); assert.equal(cancelled.result.status, "stale"); assert.deepEqual(committedTargets, []);
  await call(transferRace, "lookup_transfer_target", { query: "Bob" });
  await transcript(transferRace, "assistant", await prepare(transferRace, "transfer_confirmation", { target_id: "bob" })); await transcript(transferRace, "user", "Yes.");
  assert.equal((await call(transferRace, "transfer_call", { target_id: "bob" })).action_status, "completed"); assert.deepEqual(committedTargets, ["bob"]);
}

const uncertainTransfer = harness({ executeTool: async (name, _id, args) => {
  if (name === "lookup_transfer_target") return transferFixture(args);
  throw new Error("stale_live_transfer_after_commit");
} });
await start(uncertainTransfer, "Could I speak to Alice?"); await call(uncertainTransfer, "lookup_transfer_target", { query: "Alice" });
await transcript(uncertainTransfer, "assistant", await prepare(uncertainTransfer, "transfer_confirmation", { target_id: "alice" })); await transcript(uncertainTransfer, "user", "Yes.");
assert.equal((await call(uncertainTransfer, "transfer_call", { target_id: "alice" })).action_status, "unknown", "only exact precommit errors are safe to classify as failed");
await transcript(uncertainTransfer, "user", "Actually, try Bob."); await call(uncertainTransfer, "lookup_transfer_target", { query: "Bob" });
await transcript(uncertainTransfer, "assistant", await prepare(uncertainTransfer, "transfer_confirmation", { target_id: "bob" })); await transcript(uncertainTransfer, "user", "Yes.");
assert.equal((await call(uncertainTransfer, "transfer_call", { target_id: "bob" })).action_status, "unknown");
assert.equal(uncertainTransfer.executed.filter(([name]) => name === "transfer_call").length, 1);

// A first name retained in call state cannot revive consent or override allowed fields.
const revoked = harness({ state: () => ({ captured_fields: { first_name: "Ada" } }) });
await start(revoked, "I need help.");
assert.equal((await call(revoked, "prepare_protected_question", { kind: "contact", contact_field: "last_name" })).reason, "question_not_authorized");
await consent(revoked);
await transcript(revoked, "user", "Don't call me. My number used to be 5095550123.");
assert.equal((await call(revoked, "prepare_protected_question", { kind: "contact", contact_field: "last_name" })).reason, "question_not_authorized");
assert.equal((await call(revoked, "prepare_protected_question", { kind: "phone_confirmation", contact_field: "callback_number", value: "5095550123" })).reason, "question_not_authorized");

// Capture deduplication follows current values, including A -> B -> A corrections.
const correctedValues = {};
const corrections = harness({ state: () => ({ captured_fields: correctedValues }), executeTool: async (_name, _id, args) => {
  Object.assign(correctedValues, JSON.parse(args)); return { status: "accepted" };
} });
await start(corrections, "I need exterior painting.");
const initialCapture = await call(corrections, "data_capture", { service_request: "exterior painting" });
await transcript(corrections, "user", "Actually, make that interior painting.");
const secondCapture = await call(corrections, "data_capture", { service_request: "interior painting" });
await transcript(corrections, "user", "Sorry, it really is exterior painting.");
const thirdCapture = await call(corrections, "data_capture", { service_request: "exterior painting" });
assert.equal(correctedValues.service_request, "exterior painting"); assert.equal(corrections.executed.length, 3);
assert.equal(new Set([initialCapture.operation_id, secondCapture.operation_id, thirdCapture.operation_id]).size, 3);
await call(corrections, "data_capture", { service_request: "exterior painting" });
assert.equal(corrections.executed.length, 3, "same current value is still deduplicated");

// Preserve only an adjacent, observed business-question clarification chain.
for (const quoteOriginal of [true, false]) {
  const clarification = harness(); await start(clarification, "Do you serve my area?");
  await transcript(clarification, "assistant", "What city are you in?"); await transcript(clarification, "user", "Wenatchee");
  const lookup = await call(clarification, "knowledge_lookup", { query: "area", lookup_intent: { purpose: "caller_question", missing_fact: "Service area", caller_quote: quoteOriginal ? "Do you serve my area?" : "Wenatchee" } });
  assert.equal(lookup.action_status, "completed");
  assert.equal(JSON.parse(clarification.executed[0][2]).query, "Do you serve my area?\nClarification asked: What city are you in?\nCaller clarified: Wenatchee");
  await transcript(clarification, "user", "Forget that. I only wanted to say thanks.");
  assert.equal((await call(clarification, "knowledge_lookup", { query: "area", lookup_intent: { purpose: "caller_question", missing_fact: "Service area", caller_quote: "Do you serve my area?" } })).reason, "lookup_caller_quote_binding");
  assert.equal(clarification.executed.length, 1);
}

// In-flight corrections invalidate the commit callback, and late read results stay private.
let release, commitCheck;
const race = harness({ executeTool: async (_name, _id, _args, mayCommit) => { commitCheck = mayCommit; return new Promise(resolve => { release = resolve; }); } });
await start(race, "What are your hours?");
const running = call(race, "knowledge_lookup", { query: "hours" });
while (!release) await pause();
await transcript(race, "user", "Actually, tell me about service areas.");
assert.equal(commitCheck(), false);
release({ status: "accepted", private_fact: "STALE FACT MUST NOT REACH LIVE" });
const stale = await running; assert.equal(stale.status, "stale");
assert.ok(!JSON.stringify(race.sent).includes("STALE FACT MUST NOT REACH LIVE"));

const unknown = harness({ executeTool: async () => { throw new Error("network_after_commit"); } });
await start(unknown, "I need help."); await consent(unknown); await transcript(unknown, "user", "My name is Ada.");
assert.equal((await call(unknown, "data_capture", { first_name: "Ada" })).action_status, "unknown");
assert.equal((await call(unknown, "data_capture", { first_name: "Ada" })).action_status, "unknown");
assert.equal((await call(unknown, "data_capture", { first_name: "Ada", service_request: "repair" })).action_status, "unknown");
assert.equal(unknown.executed.length, 1);

const timedOut = harness({ responseTimeoutMs: 15, executeTool: async () => new Promise(() => {}) });
await start(timedOut, "I need repair.");
assert.equal((await call(timedOut, "data_capture", { service_request: "repair" })).action_status, "unknown", "timed-out side effect remains unknown");
assert.equal((await call(timedOut, "data_capture", { service_request: "window repair" })).action_status, "unknown");
assert.equal(timedOut.executed.length, 1);

const closeText = "Thanks for calling. Have a good one.";
for (const continuingRequest of ["No thanks, I need your address.", "No, what are your hours?", "Nothing else, can you transfer me to Alice?", "No thanks, that's all except I need your address."]) {
  const unfinished = harness(); await start(unfinished, "I need help.");
  await transcript(unfinished, "assistant", await prepare(unfinished, "other_questions")); await transcript(unfinished, "user", continuingRequest);
  assert.equal((await call(unfinished, "finish_session", {})).reason, "protected_action_not_authorized", continuingRequest);
  assert.equal(unfinished.executed.length, 0); assert.equal(unfinished.finishes.length, 0);
}
for (const completeDecline of ["No thanks, that's all.", "No, thank you.", "Nope, I'm all set.", "Nothing else, thanks.", "That's all I need, thank you."]) {
  const completeCall = harness({ executeTool: async () => ({ status: completeCall.runtime.requestFinish(closeText) ? "accepted" : "failed" }) });
  await start(completeCall, "I need help.");
  await transcript(completeCall, "assistant", await prepare(completeCall, "other_questions")); await transcript(completeCall, "user", completeDecline);
  assert.equal((await call(completeCall, "finish_session", {})).action_status, "completed", completeDecline);
}
const closing = harness({ executeTool: async name => ({ status: name === "finish_session" && closing.runtime.requestFinish(closeText) ? "accepted" : "failed" }) });
await start(closing, "No thanks.");
assert.equal((await call(closing, "finish_session", {})).reason, "protected_action_not_authorized");
await transcript(closing, "assistant", await prepare(closing, "other_questions")); await transcript(closing, "user", "No, that's all.");
assert.equal((await call(closing, "finish_session", {})).action_status, "completed");
closing.runtime.checkFinish(true, Date.now() + 2000); assert.equal(closing.finishes.length, 0);
await transcript(closing, "assistant", closeText); closing.runtime.notePlayback(Buffer.alloc(160, 0));
closing.runtime.checkFinish(false, Date.now() + 2000); assert.equal(closing.finishes.length, 0);
closing.runtime.checkFinish(true, Date.now() + 2000); assert.equal(closing.finishes.at(-1), "assistant_finish_session");

const interrupted = harness({ executeTool: async () => ({ status: interrupted.runtime.requestFinish(closeText) ? "accepted" : "failed" }) });
await start(interrupted, "Thanks."); await transcript(interrupted, "assistant", await prepare(interrupted, "other_questions")); await transcript(interrupted, "user", "No.");
await call(interrupted, "finish_session", {}); await transcript(interrupted, "assistant", closeText); interrupted.runtime.notePlayback(Buffer.alloc(160, 0));
await call(interrupted, "finish_session", {});
assert.equal(interrupted.executed.length, 1, "a close in progress cannot be duplicated");
interrupted.runtime.input(Buffer.alloc(160, 0).toString("base64")); interrupted.runtime.checkFinish(true, Date.now() + 2000);
assert.equal(interrupted.finishes.length, 0, "audio interruption cancels pending close before transcript arrives");
await transcript(interrupted, "user", "Wait, I have one more thing.");
await transcript(interrupted, "assistant", "Of course.");
await transcript(interrupted, "user", "That is all now.");
await transcript(interrupted, "assistant", await prepare(interrupted, "other_questions")); await transcript(interrupted, "user", "No.");
assert.equal((await call(interrupted, "finish_session", {})).action_status, "completed");
assert.equal(interrupted.executed.length, 2, "a newly answered checkpoint permits a new close after interruption");
assert.notEqual(interrupted.executed[0][1], interrupted.executed[1][1], "server operation IDs distinguish the two legitimate closing attempts");
await transcript(interrupted, "assistant", closeText); interrupted.runtime.notePlayback(Buffer.alloc(160, 0));
interrupted.runtime.checkFinish(true, Date.now() + 2000); assert.equal(interrupted.finishes.at(-1), "assistant_finish_session");

const greeting = harness({ greeting: "Thank you for calling Acme. How can I help?" }); await start(greeting);
const greetingInstructions = greeting.sent.filter(event => event.type === "session.instructions.append");
for (const event of greetingInstructions) await greeting.runtime.handle({ type: "session.instructions.appended", client_event_id: event.event_id });
assert.equal(greeting.sent.filter(event => event.type === "session.commentary.append").length, 1);
for (const event of greetingInstructions) await greeting.runtime.handle({ type: "session.instructions.appended", client_event_id: event.event_id });
assert.equal(greeting.sent.filter(event => event.type === "session.commentary.append").length, 1);

const failure = harness(); await start(failure, "Help."); const failedResponse = await openResponse(failure);
await item(failure, failedResponse, "knowledge_lookup", { query: "hours" }); await complete(failure, failedResponse, "failed");
assert.equal(failure.executed.length, 0); assert.equal(failure.finishes.at(-1), "openai_live_managed_response_failed");

await Promise.all(all.map(async h => { const promise = h.runtime.close(); await h.runtime.handle({ type: "session.closed", usage: {} }); await promise; }));
console.log("Managed Live runtime: protocol, serial execution, consent, capture, transfer, stale result, idempotency, greeting and audible-close checks passed.");
