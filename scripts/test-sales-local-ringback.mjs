import assert from "node:assert/strict";
import { createLocalRingback } from "../app/admin/sales/localRingback.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
const dialing = { id: "a", state: "dialing_prospect", prospectConnected: false, terminal: false };
function fixture({ deferred = false, fail = false } = {}) {
  const contexts = [], timers = new Map();
  let clock = 0, sequence = 0;
  const ringback = createLocalRingback({
    setTimer(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    createContext() {
      const context = {
        state: "suspended", currentTime: 0, destination: {}, nodes: [], pulses: [],
        resume() {
          context.resumed = true;
          return new Promise((resolve, reject) => {
            context.release = () => { context.state = "running"; resolve(); };
            if (fail) reject(new Error("Autoplay denied"));
            else if (!deferred) context.release();
          });
        },
        close() { context.closed = true; context.state = "closed"; },
        createGain() {
          const node = { gain: { setValueAtTime: (value, time) => context.pulses.push([value, time]), linearRampToValueAtTime: (value, time) => context.pulses.push([value, time]) }, connect(target) { assert.equal(target, context.destination); }, disconnect() { node.disconnected = true; } };
          context.gain = node;
          return node;
        },
        createOscillator() {
          const node = { frequency: {}, connect(target) { assert.equal(target, context.gain); }, start() { node.started = true; }, stop() { node.stopped = true; }, disconnect() { node.disconnected = true; } };
          context.nodes.push(node); return node;
        },
      };
      contexts.push(context); return context;
    },
  });
  return { ringback, contexts, timers, tick(duration) {
    const end = clock + duration;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      clock = next[1].at; contexts.forEach(context => { context.currentTime = clock / 1000; });
      timers.delete(next[0]); next[1].fn();
    }
    clock = end;
  } };
}
const setup = async (options) => {
  const f = fixture(options), token = f.ringback.prepare();
  assert.equal(f.contexts[0].resumed, true, "resume happens synchronously in gesture");
  f.ringback.bind(token, "a"); await flush(); return f;
};
const f = await setup();
f.ringback.update({ ...dialing, state: "connecting_browser" });
assert.equal(f.contexts[0].nodes.length, 0, "reservation/operator preparation is silent");
f.ringback.update(dialing);
assert.deepEqual(f.contexts[0].nodes.map(node => node.frequency.value), [440, 480]);
assert.deepEqual(f.contexts[0].pulses, [[0, 0], [0, 0], [0.06, 0.015], [0.06, 1.985], [0, 2]]);
for (let i = 0; i < 5; i++) { f.tick(1500); f.ringback.update(dialing); }
assert.equal(f.contexts[0].nodes.length, 2, "polls never duplicate tones");
assert.ok(f.contexts[0].pulses.some(([value, time]) => value === 0 && time === 6), "six-second cadence");
f.ringback.update({ ...dialing, prospectConnected: true });
assert.ok(f.contexts[0].nodes.every(node => node.stopped && node.disconnected));
assert.equal(f.timers.size, 0);
f.ringback.update(dialing);
assert.equal(f.contexts[0].nodes.length, 2, "stale dialing cannot restart after answer");

for (const update of [{ terminal: true }, { providerError: "busy" }, { state: "failed" }, { state: "no_answer" }, { state: "ending" }, { state: "ai_live", aiLive: true }, { connectedAt: "answered" }, { id: "other" }]) {
  const test = await setup(); test.ringback.update(dialing); test.ringback.update({ ...dialing, ...update });
  assert.ok(test.contexts[0].closed, JSON.stringify(update));
}
for (const cancelBeforeBind of [true, false]) {
  const test = fixture({ deferred: true }); const token = test.ringback.prepare();
  if (!cancelBeforeBind) { test.ringback.bind(token, "a"); test.ringback.update(dialing); }
  test.ringback.stop(); test.ringback.bind(token, "a"); test.ringback.update(dialing);
  test.contexts[0].release(); await flush();
  assert.equal(test.contexts[0].nodes.length, 0, "late resume/bind after teardown stays quiet");
}
const overlap = await setup({ deferred: true });
overlap.ringback.update(dialing);
const replacement = overlap.ringback.prepare(); overlap.ringback.bind(replacement, "b");
overlap.contexts[0].release(); await flush();
assert.equal(overlap.contexts[0].nodes.length, 0);
overlap.ringback.update({ ...dialing, id: "b" }); overlap.contexts[1].release(); await flush();
assert.equal(overlap.contexts[1].nodes.length, 2); overlap.ringback.stop();
const denied = await setup({ fail: true }); denied.ringback.update(dialing);
assert.equal(denied.contexts[0].nodes.length, 0);
const unavailable = createLocalRingback({ createContext: () => null }); unavailable.prepare(); unavailable.update(dialing);
const stalled = await setup(); stalled.ringback.update(dialing); stalled.tick(6000);
assert.ok(stalled.contexts[0].closed, "stalled polls stop audio without changing call");
const timeout = await setup(); timeout.ringback.update(dialing);
for (let i = 0; i < 60; i++) { timeout.tick(1500); timeout.ringback.update(dialing); }
assert.ok(timeout.contexts[0].closed, "absolute audio-only timeout");
console.log("Local ringback: gesture resume, speaker-only routing, cadence, authority, deduplication, failures, cancellation/resume races and timeouts passed.");
