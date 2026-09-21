import assert from "node:assert/strict";
import { LiveRuntime, buildLiveStart, resolveVoiceRuntime, liveAppend, pcmuHasSpeech } from "../apps/call-gateway/dist/apps/call-gateway/src/liveRuntime.js";

// Offline contract tests only. Every backend request is intercepted below.
assert.equal(resolveVoiceRuntime(undefined), "realtime");
assert.equal(resolveVoiceRuntime("live"), "live");
assert.throws(() => resolveVoiceRuntime("gpt-live-1"), /invalid_voice_runtime/);
const start = buildLiveStart("trusted rules", "marin");
assert.equal(start.type, "session.start");
assert.equal(start.session.model, "gpt-live-1");
assert.deepEqual(start.session.audio.format, { type: "audio/pcmu", rate: 8000 });
assert.deepEqual(start.session.delegation, { type: "client" });
assert.equal(start.session.store, false);
assert.equal("tools" in start.session, false);
assert.equal("turn_detection" in start.session, false);
const chunks = liveAppend("commentary", "界🙂".repeat(400), "delegation");
assert.ok(chunks.every(x => Buffer.byteLength(x.content) <= 480 && x.delegation_id === "delegation"));
assert.equal(chunks.map(x => x.content).join(""), "界🙂".repeat(400));
assert.equal(pcmuHasSpeech(Buffer.alloc(160, 255)), false);
assert.equal(pcmuHasSpeech(Buffer.alloc(160, 0)), true);

const answer = text => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 10, output_tokens: 5 } });
const tool = (id = "tool1", name = "data_capture") => ({ status: "completed", output: [{ type: "function_call", call_id: id, name, arguments: '{"first_name":"Ada"}' }] });
function harness(overrides = {}) {
  const sent = [], calls = [], logs = [], transcripts = [], finishes = [], requests = [];
  let fetchIndex = 0;
  const replies = overrides.replies || [answer("Verified answer")];
  const runtime = new LiveRuntime({
    tenantKey: overrides.tenantKey || "tenant-a", callSid: "call-a", apiKey: "server-secret", safetyIdentifier: "hashed-subject",
    backendModel: "configured-backend", instructions: "Trusted business rules", tools: [{ type: "function", name: "data_capture", parameters: { type: "object" } }],
    send: event => sent.push(event), isActive: () => true,
    executeTool: async (...args) => { calls.push(args); return { status: "accepted" }; },
    validateTool: () => true, state: () => ({ captured_fields: {} }),
    transcript: entry => transcripts.push(entry), audio: bytes => { assert.equal(bytes.length, 160); }, ready: () => {},
    finish: reason => finishes.push(reason), audit: (event, details) => logs.push({ event, ...details }),
    fetch: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => replies[fetchIndex++] || answer("Done") };
    }, ...overrides
  });
  return { runtime, sent, calls, logs, transcripts, finishes, requests };
}
const started = { type: "session.started", session: { id: "live-session" } };
const delegate = id => ({ type: "session.delegation.created", event_id: `event-${id}`, offset_ms: 100, delegation: { id, type: "delegation", target: "client" } });
const caller = (delta, id = "caller1") => ({ type: "session.input_transcript.delta", event_id: id, delta, start_ms: 1, end_ms: 100 });

const h = harness({ replies: [tool(), answer("What is your callback number?")] });
h.runtime.input("before-ready");
assert.equal(h.sent.length, 0);
await h.runtime.handle(started);
h.runtime.input(Buffer.alloc(160, 255).toString("base64"));
assert.equal(h.sent[0].type, "session.input_audio.append");
await h.runtime.handle(caller("My name is"));
await h.runtime.handle(caller(" Ada", "caller2"));
await h.runtime.handle(delegate("d1"));
await h.runtime.handle(delegate("d1"));
assert.equal(h.calls.length, 1, "duplicate delegation cannot repeat capture");
assert.equal(h.requests.length, 2);
assert.equal(h.requests[0].input.at(-1).content, "My name is Ada", "preserve transcript fragments exactly");
assert.equal(h.requests[0].store, false);
assert.equal(h.requests[0].safety_identifier, "hashed-subject");
assert.equal(h.requests[0].parallel_tool_calls, false);
assert.equal(h.sent.at(-1).delegation_id, "d1");
assert.ok(!JSON.stringify(h.sent).includes("server-secret"));
assert.ok(!h.sent.some(x => x.type === "response.create"));
await h.runtime.handle({ type: "session.output_audio.delta", delta: Buffer.alloc(160, 255).toString("base64") });
assert.equal(h.runtime.requestFinish("Thanks for calling. Have a good one."), true);
await h.runtime.handle({ type: "session.instructions.appended", client_event_id: h.sent.at(-1).event_id });
h.runtime.checkFinish(true);
assert.equal(h.finishes.length, 0, "append acknowledgement is not audio completion");
await h.runtime.handle({ type: "session.output_transcript.delta", delta: "Thanks for calling. Have a good one.", start_ms: 300, end_ms: 500 });
h.runtime.notePlayback(Buffer.alloc(160, 0));
h.runtime.checkFinish(false, Date.now() + 2000);
assert.equal(h.finishes.length, 0, "queued playback blocks close");
h.runtime.checkFinish(true, Date.now() + 2000);
assert.deepEqual(h.finishes, ["assistant_finish_session"]);

// A correction arriving while reasoning is in flight suppresses old tool execution.
let release;
const stale = harness({ fetch: async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => tool() }); }) });
await stale.runtime.handle(started);
await stale.runtime.handle(caller("Ada"));
const pending = stale.runtime.handle(delegate("stale"));
await new Promise(resolve => setImmediate(resolve));
await stale.runtime.handle(caller("Actually Grace", "correction"));
release();
await pending;
assert.equal(stale.calls.length, 0);
assert.ok(!stale.sent.some(x => x.type === "session.commentary.append"));

// A replacement delegation runs after an already-submitted action settles.
let finishAction;
let running = 0, peak = 0;
const concurrent = harness({ replies: [tool("one"), tool("two"), answer("Done")], executeTool: async () => {
  running++; peak = Math.max(peak, running);
  await new Promise(resolve => { finishAction = resolve; });
  running--; return { status: "accepted" };
} });
await concurrent.runtime.handle(started);
const first = concurrent.runtime.handle(delegate("first"));
await new Promise(resolve => setImmediate(resolve));
const second = concurrent.runtime.handle(delegate("second"));
finishAction();
await new Promise(resolve => setImmediate(resolve));
finishAction();
await Promise.all([first, second]);
assert.equal(peak, 1);
assert.ok(!concurrent.sent.some(x => x.type === "session.commentary.append" && x.delegation_id === "first"));

// A delayed preflight belonging to the old task must not borrow the new task's
// authority (e.g. a transfer-target lookup returning after a caller correction).
let releasePreflight;
const permits = [];
const permitRace = harness({ replies: [tool("old"), answer("New request")], executeTool: async (_name, _id, _args, mayCommit) => {
  permits.push(mayCommit());
  await new Promise(resolve => { releasePreflight = resolve; });
  permits.push(mayCommit());
  if (!mayCommit()) throw new Error("stale_live_transfer");
  return { status: "accepted" };
} });
await permitRace.runtime.handle(started);
const oldTask = permitRace.runtime.handle(delegate("old-task"));
await new Promise(resolve => setImmediate(resolve));
await permitRace.runtime.handle(caller("Do not transfer", "cancel-transfer"));
const newTask = permitRace.runtime.handle(delegate("new-task"));
releasePreflight();
await Promise.all([oldTask, newTask]);
assert.deepEqual(permits, [true, false]);

let finishStaleAction;
const staleAction = harness({ replies: [tool()], executeTool: async () => {
  await new Promise(resolve => { finishStaleAction = resolve; });
  return { status: "accepted" };
} });
await staleAction.runtime.handle(started);
const staleActionTask = staleAction.runtime.handle(delegate("stale-action"));
await new Promise(resolve => setImmediate(resolve));
await staleAction.runtime.handle(caller("Correction", "during-action"));
finishStaleAction();
await staleActionTask;
assert.equal(staleAction.sent.filter(x => x.type === "session.thinking.append").length, 1, "stale action asks for renewed delegation once");
assert.equal(staleAction.sent.filter(x => x.type === "session.commentary.append").length, 0);

const denied = harness({ replies: [tool("x", "delete_tenant")] });
await denied.runtime.handle(started);
await denied.runtime.handle(delegate("denied"));
assert.equal(denied.calls.length, 0);
assert.ok(denied.logs.some(x => x.event === "openai_live_task_failed"));

const other = harness({ tenantKey: "tenant-b", replies: [tool(), answer("Done")] });
await other.runtime.handle(started);
await other.runtime.handle(delegate("d1"));
assert.notEqual(h.calls[0][1], other.calls[0][1], "idempotency key binds tenant and call");

const closePromise = h.runtime.close();
assert.equal(h.sent.at(-1).type, "session.close");
await h.runtime.handle({ type: "session.closed", usage: { seconds: 12 }, reason: "close_requested" });
await closePromise;
assert.equal(h.runtime.closed, true);
assert.ok(h.logs.some(x => x.event === "openai_live_session_closed" && x.usage.seconds === 12));
await h.runtime.handle(delegate("after-close"));
assert.equal(h.calls.length, 1);

const unexpected = harness();
await unexpected.runtime.handle(started);
await unexpected.runtime.handle({ type: "session.closed", usage: { seconds: 1 }, reason: "expired" });
assert.deepEqual(unexpected.finishes, ["openai_live_provider_closed"]);

const correctedClose = harness();
await correctedClose.runtime.handle(started);
await correctedClose.runtime.handle(delegate("closing"));
correctedClose.runtime.requestFinish("Thanks for calling. Have a good one.");
await correctedClose.runtime.handle(caller("One more question", "reopen"));
correctedClose.runtime.checkFinish(true, Date.now() + 20000);
assert.equal(correctedClose.finishes.length, 0, "caller correction cancels deferred close");

const confirmation = harness();
await confirmation.runtime.handle(started);
await confirmation.runtime.handle(caller("Please transfer me to Alice", "original-request"));
const lookupRevision = confirmation.runtime.transcriptRevision;
assert.equal(confirmation.runtime.callerConfirmationAfter(lookupRevision), "");
await confirmation.runtime.handle(caller(" please", "same-request-fragment"));
assert.equal(confirmation.runtime.callerConfirmationAfter(lookupRevision), "");
await confirmation.runtime.handle({ type: "session.output_transcript.delta", delta: "Would you like me to transfer you to Alice?", start_ms: 200, end_ms: 400 });
assert.equal(confirmation.runtime.callerConfirmationAfter(lookupRevision), "");
await confirmation.runtime.handle(caller("Yes please", "fresh-confirmation"));
assert.equal(confirmation.runtime.callerConfirmationAfter(lookupRevision), "Yes please");
await confirmation.runtime.handle({ type: "session.output_transcript.delta", delta: "Is your name Ada?", start_ms: 500, end_ms: 600 });
await confirmation.runtime.handle(caller("Yes", "unrelated-yes"));
assert.equal(confirmation.runtime.callerConfirmationAfter(lookupRevision), "", "unrelated question is not transfer consent");

console.log("Live runtime offline contracts passed: selection, PCMU, delegation, tenant binding, duplicate protection, stale suppression, serialized actions, closing, finalization.");
