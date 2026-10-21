import { applySalesPaidCheckout } from '../pages/api/_lib/salesCheckout.js';
// Real PostgreSQL concurrency checks. This runner accepts loopback targets only
// and creates/drops its own random schema; it never uses DATABASE_URL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';

const target = process.env.EVERYCALL_TEST_POSTGRES_URL;
assert.ok(target, 'Set EVERYCALL_TEST_POSTGRES_URL to an isolated loopback PostgreSQL instance');
const url = new URL(target);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only loopback test databases are allowed');
const schema = `everycall_qa_${crypto.randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString: target, max: 1 });
const pool = new pg.Pool({ connectionString: target, max: 16, options: `-c search_path=${schema}` });
const read = path => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');
function load(source, names, deps = {}) {
  const body = source.replace(/^import[\s\S]*?;\n/gm, '').replace(/export default /g, '').replace(/export /g, '');
  return new Function(...Object.keys(deps), `${body}\nreturn {${names.join(',')}};`)(...Object.values(deps));
}
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
let releaseProvider;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  // Use the existing recovery fixture's actual baseline, avoiding a second
  // hand-maintained schema contract. No application data is copied.
  const fixture = await read('scripts/validate-production-recovery.mjs');
  const seed = fixture.match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(seed, 'Recovery fixture baseline must be present');
  await pool.query(seed[1]);
  await pool.query(await read('migrations/0051_production_recovery.sql'));
  await pool.query(await read('migrations/0051_production_recovery.sql'));
  const jobs = load(await read('lib/asyncJobs.js'), ['enqueueAsyncJob', 'claimAsyncJobs', 'completeAsyncJob', 'failAsyncJob', 'releaseAsyncJob'], { crypto });
  for (let i = 0; i < 16; i++) await jobs.enqueueAsyncJob(pool, { jobType: 'qa', dedupeKey: String(i) });
  const claims = (await Promise.all(Array.from({ length: 8 }, (_, i) => jobs.claimAsyncJobs(pool, { workerId: `qa-${i}`, limit: 2 })))).flat();
  assert.equal(claims.length, 16);
  assert.equal(new Set(claims.map(row => row.id)).size, 16, 'Simultaneous workers must receive disjoint jobs');
  const first = claims[0];
  await pool.query("UPDATE async_jobs SET lease_expires_at = NOW()-INTERVAL '1 second' WHERE id=$1", [first.id]);
  const [reclaimed] = await jobs.claimAsyncJobs(pool, { workerId: 'replacement', limit: 1 });
  assert.equal(reclaimed.id, first.id);
  assert.notEqual(reclaimed.claim_token, first.claim_token);
  assert.equal(await jobs.completeAsyncJob(pool, first.id, { claimToken: first.claim_token }), false);
  await assert.rejects(pool.query("UPDATE async_jobs SET status='done' WHERE id=$1", [first.id]), /async_job_claim_token_required/);
  assert.equal(await jobs.completeAsyncJob(pool, reclaimed.id, { claimToken: reclaimed.claim_token }), true);
  await assert.rejects(pool.query("UPDATE async_jobs SET status='pending',last_error='stale failure' WHERE id=$1", [first.id]), /async_job_claim_token_required/);
  const failed = claims[1];
  assert.equal(await jobs.failAsyncJob(pool, failed.id, { claimToken: failed.claim_token, errorMessage: 'retry' }), true);
  await assert.rejects(pool.query("UPDATE async_jobs SET status='done' WHERE id=$1", [failed.id]), /async_job_claim_token_required/);
  assert.equal((await pool.query('SELECT status FROM async_jobs WHERE id=$1', [failed.id])).rows[0].status, 'pending');
  const released = claims[2];
  assert.equal(await jobs.releaseAsyncJob(pool, released.id, { claimToken: released.claim_token }), true);
  await assert.rejects(pool.query("UPDATE async_jobs SET status='done' WHERE id=$1", [released.id]), /async_job_claim_token_required/);
  console.log('PASS separate-connection job claims, expired recovery and persistent stale-owner fencing');

  await pool.query("INSERT INTO tenants(tenant_key) VALUES('stripe')");
  await pool.query("INSERT INTO tenant_billing_accounts(tenant_key,price_override_cycles_remaining) VALUES('stripe',3)");
  let providerStarted;
  const started = new Promise(resolve => { providerStarted = resolve; });
  const provider = new Promise(resolve => { releaseProvider = resolve; });
  let effects = 0;
  const stripe = load(await read('pages/api/v1/stripe/webhook.js'), ['handler'], {
    applySalesPaidCheckout,
    readRawBody: async req => req.event, constructWebhookEvent: event => event,
    ensureTables: async () => {}, getPool: () => pool,
    retrieveSubscription: async () => { providerStarted(); await provider; return { id: 'sub', metadata: { tenant_key: 'stripe' }, status: 'active' }; },
    retrieveSubscriptionSchedule: async () => null,
    syncTenantStripeSubscription: async db => { effects++; await db.query("UPDATE tenant_billing_accounts SET price_override_cycles_remaining=price_override_cycles_remaining-1 WHERE tenant_key='stripe'"); },
    syncTenantStripeSubscriptionSchedule: async () => {}, activatePendingCouponDiscountWindow: async () => {}
  }).handler;
  const send = async event => { const res = response(); await stripe({ method: 'POST', headers: {}, event }, res); return res; };
  const event = { id: 'evt_contended', type: 'customer.subscription.updated', data: { object: { id: 'sub', metadata: { tenant_key: 'stripe' } } } };
  const initial = send(event);
  await started;
  let timer;
  const competing = await Promise.race([
    send(event),
    new Promise((_, reject) => { timer = setTimeout(() => { releaseProvider(); reject(Error('Competing Stripe delivery blocked before retry response')); }, 4000); })
  ]).finally(() => clearTimeout(timer));
  assert.equal(competing.statusCode, 503, 'An active processor must cause a retry, not duplicate success');
  releaseProvider();
  assert.equal((await initial).statusCode, 200);
  assert.equal((await send(event)).body.duplicate, true);
  assert.equal(effects, 1);
  const invoice = { id: 'evt_invoice_a', type: 'invoice.paid', data: { object: { id: 'invoice_1', metadata: { tenant_key: 'stripe' } } } };
  const deliveries = await Promise.all([send(invoice), send({ ...invoice, id: 'evt_invoice_b' })]);
  assert.ok(deliveries.every(res => res.statusCode === 200));
  assert.equal((await pool.query("SELECT price_override_cycles_remaining FROM tenant_billing_accounts WHERE tenant_key='stripe'")).rows[0].price_override_cycles_remaining, 1);
  console.log('PASS real Stripe NOWAIT contention, processed replay and simultaneous invoice deduplication');

  await pool.query(`CREATE TABLE uploaded_documents(document_id TEXT PRIMARY KEY);
    CREATE TABLE source_intake_items(item_id TEXT PRIMARY KEY);
    CREATE TABLE knowledge_builds(build_id TEXT PRIMARY KEY,tenant_key TEXT,build_kind TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO tenants(tenant_key) VALUES('allocation'),('abort');`);
  await pool.query(await read('migrations/0052_knowledge_source_integrity.sql'));
  const source = await read('pages/api/_lib/knowledgeReceptionistBuilds.js');
  const start = source.indexOf('async function assertBuildRateLimit(');
  const end = source.indexOf('\nfunction sameNormalizedIdArray', start);
  assert.ok(start > 0 && end > start);
  const { assertBuildRateLimit } = load(source.slice(start, end), ['assertBuildRateLimit'], { normalizeText: value => String(value || '').trim() });
  async function allocate(tenantKey, buildId, abort = false) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assertBuildRateLimit(client, tenantKey, { buildKind: 'website_base', buildId });
      if (abort) throw Error('forced_abort');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  const allocations = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => allocate('allocation', `build-${i}`)));
  assert.equal(allocations.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(allocations.filter(result => result.status === 'rejected').every(result => result.reason.message === 'knowledge_build_rate_limited'));
  await assert.rejects(allocate('abort', 'aborted', true), /forced_abort/);
  await allocate('abort', 'retry');
  console.log('PASS concurrent daily allocations and transaction rollback without consuming capacity');
} finally {
  releaseProvider?.();
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
