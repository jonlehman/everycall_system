import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const moduleUrl = new URL('../apps/call-gateway/dist/apps/call-gateway/src/processLifecycle.js', import.meta.url).href;

async function check(mode, { code = 143, signal = null, external = false, absentInstance = false } = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { installProcessLifecycleObservability as install } from ${JSON.stringify(moduleUrl)};
    import { closeSync } from 'node:fs';
    const mode = ${JSON.stringify(mode)};
    const handler = () => { process.send('handled'); setTimeout(() => process.exit(23), 150); };
    if (mode === 'existing') process.on('SIGTERM', handler);
    install();
    if (mode === 'duplicate') { install(); install(); }
    if (mode === 'later' || mode === 'removed') process.on('SIGTERM', handler);
    if (mode === 'prepend-once') process.prependOnceListener('SIGTERM', handler);
    if (mode === 'removed') process.removeListener('SIGTERM', handler);
    if (mode === 'sink-closed') closeSync(2);
    await Promise.resolve();
    process.on('exit', () => setTimeout(() => process.send('async-after-exit'), 0));
    setInterval(() => {}, 1000);
    process.send({ ready: true, signalListeners: process.listenerCount('SIGTERM') });
    process.on('message', () => process.exit(7));
  `], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...(absentInstance ? {} : { RENDER_INSTANCE_ID: 'srv-fixture-instance-123' }), SECRET_SENTINEL: 'must-not-be-logged' }
  });
  let stderr = '';
  const messages = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('message', message => messages.push(message));
  const closed = once(child, 'close');
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 4000);
  try {
    const [ready] = await once(child, 'message');
    assert.equal(ready.ready, true, mode);
    assert.equal(ready.signalListeners, mode === 'removed' ? 0 : 1, mode);
    const started = performance.now();
    if (mode === 'normal') child.send('exit');
    else child.kill(mode === 'sigint' ? 'SIGINT' : 'SIGTERM');
    if (external) {
      await delay(60);
      assert.equal(child.exitCode, null, `${mode}: preserve asynchronous owner`);
      assert.equal(child.signalCode, null, mode);
    }
    assert.deepEqual(await closed, [code, signal], mode);
    assert.ok(performance.now() - started < 1500, `${mode}: bounded test process termination`);
    assert.ok(!messages.includes('async-after-exit'), mode);
    assert.equal(messages.includes('handled'), external, mode);
    assert.ok(!stderr.includes('must-not-be-logged'), mode);
    const markers = stderr.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(markers.filter(m => m.message === 'call_gateway_lifecycle_ready').length, 1, mode);
    const exits = markers.filter(m => m.message === 'call_gateway_process_exit');
    const signals = markers.filter(m => m.message === 'call_gateway_sigterm_received');
    if (signal || mode === 'sink-closed') {
      assert.equal(exits.length, 0, mode);
      assert.equal(signals.length, 0, mode);
    } else {
      assert.equal(exits.length, 1, mode);
      assert.equal(exits[0].exitCode, code, mode);
      assert.equal(exits[0].signal, external || mode === 'normal' ? null : 'SIGTERM', mode);
      assert.equal(signals.length, external || mode === 'normal' ? 0 : 1, mode);
      assert.equal(exits[0].terminationMode, external ? 'external_handler' : 'immediate_exit', mode);
    }
    for (const marker of markers) {
      assert.equal(marker.pid, child.pid, mode);
      assert.equal(marker.instanceId, absentInstance ? undefined : 'srv-fixture-instance-123', mode);
      assert.equal(new Date(marker.timestamp).toISOString(), marker.timestamp, mode);
      assert.deepEqual(Object.keys(marker).sort(), [
        'level', 'message', ...(absentInstance ? [] : ['instanceId']), 'pid', 'timestamp', 'signal', 'exitCode', 'terminationMode'
      ].sort(), mode);
    }
    console.log(`PASS call gateway process lifecycle: ${mode}${absentInstance ? ' without Render ID' : ''}`);
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

await check('default');
await check('duplicate');
await check('default', { absentInstance: true });
await check('existing', { code: 23, external: true });
await check('later', { code: 23, external: true });
await check('prepend-once', { code: 23, external: true });
await check('removed', { code: null, signal: 'SIGTERM' });
await check('normal', { code: 7 });
await check('sigint', { code: null, signal: 'SIGINT' });
await check('sink-closed');
