import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as voiceControl from "../apps/call-gateway/dist/apps/call-gateway/src/voiceRuntimeControl.js";

// Exercise the actual gateway pump without booting its server, DB, or providers.
// Pipe an older server source with --stdin to verify that regressions are caught.
const serverPath = "apps/call-gateway/src/server.ts";
const source = readFileSync(process.argv.includes("--stdin") ? 0 : serverPath, "utf8");
const ast = ts.createSourceFile(serverPath, source, ts.ScriptTarget.Latest, true);
const names = ["logInfo", "createAudioPumpTrace", "ensureAudioPumpTrace", "closeAudioUnderrun",
  "enqueueOutputPcm", "hasBufferedFramesReady", "logLiveAudioDeliveryGap", "pumpAvailableOutputFrames", "startOutputPump"];
const declarations = names.map(name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node && name === "logLiveAudioDeliveryGap" && process.argv.includes("--stdin")) return "";
  assert.ok(node, `Missing production function ${name}`);
  return node.getText(ast);
}).join("\n");
const logAllowlist = ast.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(decl => decl.name.getText(ast) === "PRODUCTION_INFO_LOG_ALLOWLIST"));
assert.ok(logAllowlist, "Missing production log allowlist");
const js = ts.transpileModule(logAllowlist.getText(ast) + "\n" + declarations,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness({ live = true, bufferFrames = 13, responseId = null } = {}) {
  let now = 0, nextTimerId = 1;
  const timers = new Map(), sent = [], logs = [];
  const session = {
    outputQueue: [], outputBuffer: Buffer.alloc(0), currentResponseId: responseId,
    ...(live ? { live: { notePlayback() {} } } : {})
  };
  const context = vm.createContext({
    Buffer, performance: { now: () => now }, outboundAudioFrameMs: 20,
    outboundJitterBufferFrames: bufferFrames, liveOutputIdleGraceMs: 40, ...voiceControl,
    process: { env: { NODE_ENV: "production" } }, verboseGatewayLogging: false,
    baseLogInfo: (event, details) => logs.push({ event, ...details }),
    setInterval: (callback, interval) => {
      const id = nextTimerId++;
      timers.set(id, { callback, interval, at: now + interval });
      return id;
    },
    clearInterval: id => timers.delete(id),
    sendTelnyxMedia: (_ws, _streamId, base64) => sent.push({ at: now, bytes: Buffer.from(base64, "base64") }),
    logAudioPumpTraceSummary() {}, noteAssistantResponsePlaybackDrained() {}
  });
  vm.runInContext(js, context);
  function advance(to) {
    for (;;) {
      const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > to) break;
      now = due[1].at;
      due[1].at += due[1].interval;
      due[1].callback();
    }
    now = to;
  }
  return {
    session, sent, logs, advance,
    enqueue: bytes => context.enqueueOutputPcm(session, bytes),
    frames: count => context.enqueueOutputPcm(session, Buffer.alloc(count * 160, 42)),
    // Simulate an event-loop stall by jumping directly to a late pump callback.
    pumpAt: at => { now = at; return context.pumpAvailableOutputFrames(session, at); }
  };
}

const tests = [
  ["Live primes at configured threshold without a response ID", () => {
    const h = harness();
    h.frames(12);
    h.advance(50);
    assert.equal(h.sent.length, 0, "12 frames must not bypass the 13-frame buffer");
    h.frames(1);
    h.advance(55);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].at, 55);
  }],
  ["5ms polling sends frames only on 20ms deadlines", () => {
    const h = harness({ bufferFrames: 1 });
    h.frames(10);
    h.advance(180);
    assert.deepEqual(h.sent.map(x => x.at), [0, 20, 40, 60, 80, 100, 120, 140, 160, 180]);
  }],
  ["Live short utterance flushes after a bounded buffering wait", () => {
    const h = harness();
    h.frames(2);
    h.advance(255);
    assert.equal(h.sent.length, 0);
    h.advance(280);
    assert.deepEqual(h.sent.map(x => x.at), [260, 280]);
    assert.equal(h.session.outputQueue.length, 0);
  }],
  ["Live timely next batch keeps continuity at the final frame deadline", () => {
    const h = harness();
    h.frames(13);
    h.advance(260);
    h.frames(10);
    h.advance(450);
    assert.equal(h.sent.length, 23);
    assert.ok(h.sent.every((x, i) => !i || x.at - h.sent[i - 1].at <= 25));
    assert.ok(!h.logs.some(x => x.stage === "idle"));
  }],
  ["Live arrival inside idle grace resumes without full rebuffer", () => {
    const h = harness();
    h.frames(13);
    h.advance(290);
    Object.assign(h.session, { liveLastAudioArrivalGapMs: 290, liveLastAudioReceivedAtMs: 290,
      liveLastAudioChunkMs: 200, telnyxWs: { bufferedAmount: 320, readyState: 1 }, telnyxStreamId: "test-stream" });
    h.frames(10);
    h.advance(295);
    assert.equal(h.sent[13].at, 295);
    const resumed = h.logs.find(x => x.stage === "resumed");
    assert.equal(resumed.outputGapMs, 35);
    assert.equal(resumed.rebufferWaitMs, 0);
    assert.equal(resumed.sourceArrivalGapMs, 290);
    assert.equal(resumed.sourceChunkAgeMs, 5);
    assert.equal(resumed.sourceChunkAudioMs, 200);
    assert.equal(resumed.telnyxBufferedBytes, 320);
    assert.ok(!["audio", "payload", "text", "tenantKey"].some(key => key in resumed));
    assert.ok(!h.logs.some(x => x.stage === "idle"));
  }],
  ["Live re-primes after starvation instead of forwarding one frame immediately", () => {
    const h = harness({ bufferFrames: 3 });
    h.frames(3);
    h.advance(120);
    h.frames(1);
    h.advance(175);
    assert.equal(h.sent.length, 3);
    h.advance(180);
    assert.equal(h.sent[3].at, 180);
    assert.ok(h.logs.some(x => x.stage === "idle"));
    const resumed = h.logs.find(x => x.stage === "resumed");
    assert.equal(resumed.outputGapMs, 120);
    assert.equal(resumed.rebufferWaitMs, 60);
  }],
  ["Live retains next deadline across drain and restart with a one-frame buffer", () => {
    const h = harness({ bufferFrames: 1 });
    h.frames(1);
    h.advance(5);
    h.frames(1);
    h.advance(15);
    assert.equal(h.sent.length, 1);
    h.advance(20);
    assert.deepEqual(h.sent.map(x => x.at), [0, 20]);
  }],
  ["Burst jitter preserves byte order and continuous playback", () => {
    const h = harness();
    const bytes = Buffer.from(Array.from({ length: 50 * 160 }, (_, i) => i % 251));
    for (const [at, start, end] of [[0, 0, 1600], [100, 1600, 3200], [380, 3200, 4800], [600, 4800, 6400], [800, 6400, 8000]]) {
      h.advance(at);
      h.enqueue(bytes.subarray(start, end));
    }
    h.advance(1200);
    assert.equal(h.sent.length, 50);
    assert.deepEqual(Buffer.concat(h.sent.map(x => x.bytes)), bytes);
    assert.ok(h.sent.every((x, i) => !i || x.at - h.sent[i - 1].at === 20));
  }],
  ["Arbitrary PCMU chunk boundaries preserve every byte", () => {
    const h = harness({ bufferFrames: 1 });
    const bytes = Buffer.from(Array.from({ length: 480 }, (_, i) => i % 256));
    for (const [start, end] of [[0, 79], [79, 245], [245, 480]]) h.enqueue(bytes.subarray(start, end));
    h.advance(100);
    assert.deepEqual(Buffer.concat(h.sent.map(x => x.bytes)), bytes);
    assert.equal(h.session.outputBuffer.length, 0);
  }],
  ["Late timer catches up only due frames, capped at eight", () => {
    const h = harness({ bufferFrames: 1 });
    h.frames(20);
    assert.equal(h.pumpAt(55), 2);
    assert.equal(h.pumpAt(59), 0);
    assert.equal(h.pumpAt(60), 1);
    assert.equal(h.pumpAt(1000), 8);
    assert.ok(h.logs.some(x => x.stage === "scheduler_late" && x.timerLateMs >= 40));
  }],
  ["Realtime active responses retain threshold and completion flush", () => {
    const h = harness({ live: false, responseId: "response-1" });
    h.frames(2);
    h.advance(300);
    assert.equal(h.sent.length, 0, "Realtime must still wait for threshold or response done");
    h.session.currentResponseId = null;
    h.frames(0); // Realtime response.done calls startOutputPump for queued audio.
    h.advance(320);
    assert.deepEqual(h.sent.map(x => x.at), [300, 320]);
  }],
  ["Realtime active response re-primes after draining", () => {
    const h = harness({ live: false, responseId: "response-1", bufferFrames: 3 });
    h.frames(3);
    h.advance(60);
    h.frames(2);
    h.advance(100);
    assert.equal(h.sent.length, 3);
    h.frames(1);
    h.advance(145);
    assert.deepEqual(h.sent.map(x => x.at), [0, 20, 40, 105, 125, 145]);
  }]
];

for (const [name, run] of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL ${name}: ${error.message.split("\n")[0]}`); }
}
