import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createUpibTestFixture } from './lib/upib-test-fixture.mjs';

const fixture = await createUpibTestFixture({ label: 'http' });
const database = new URL(fixture.databaseUrl);
database.searchParams.set('options', `-c search_path=${fixture.schema},public`);
const port = Number(process.env.UPIB_HTTP_TEST_PORT || 3318);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
const root = fileURLToPath(new URL('../', import.meta.url));
const log = createWriteStream('/tmp/everycall-upib-http-test.log');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: database.href, NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_offline_no_provider_access' },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.pipe(log);
child.stderr.pipe(log);
const base = `http://127.0.0.1:${port}`;
const request = (path, options = {}) => fetch(base + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(5000) });
try {
  const deadline = Date.now() + 15000;
  while (true) {
    try {
      const response = await request('/intake');
      assert.equal(response.status, 200);
      break;
    } catch (error) {
      if (Date.now() >= deadline || child.exitCode !== null) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  const me = await request('/api/v1/auth/me');
  assert.equal(me.status, 200);
  assert.equal((await me.json()).authenticated, false);
  const privatePage = await request('/client/account/billing');
  assert.equal(privatePage.status, 307);
  assert.ok(new URL(privatePage.headers.get('location'), base).pathname.startsWith('/login'));
  const onboard = await request('/api/v1/tenants/onboard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: 'Forged purchase', payment_status: 'paid', tenant_key: 'another-owner' })
  });
  assert.equal(onboard.status, 410);
  assert.equal((await onboard.json()).redirectUrl, '/intake');
  const draft = await request('/api/v1/intake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: 'Closed release', loginEmail: 'owner@example.test', planCode: 'growth', billingInterval: 'year' })
  });
  assert.equal(draft.status, 503, 'A closed release cannot send verification or create purchase authority');
  for (const table of ['tenants', 'paid_intakes', 'paid_purchases']) {
    assert.equal(Number((await fixture.pool.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count), 0);
  }
  console.log('UPIB HTTP: built public intake, real auth boundary, private-page redirect, forged legacy payment refusal and disabled release with zero account/purchase effects passed.');
} finally {
  if (child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
  }
  log.end();
  await fixture.close();
}
