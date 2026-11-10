// REQ-PIPE-017: actual runtime SQL is read-only; explicit setup owns migrations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import { listKnowledgeOverrides, assertConfigTablesReady } from '../pages/api/_lib/knowledgeReceptionistConfig.js';
import { loadMarketingInsights } from '../pages/api/_lib/marketingInsights.js';
import { ensureTables, SchemaNotReadyError } from '../pages/api/_lib/db.js';
import { REQUIRED_SCHEMA_MIGRATIONS } from '../pages/api/_lib/schemaReadiness.js';
import { bootstrapFixtureSchema, applyRemediationMigrations, migrationBody, REMEDIATION_MIGRATIONS } from './lib/schema-migrations.mjs';

const postgresUrl = process.env.EVERYCALL_TEST_POSTGRES_URL;
let db;
let cleanup;
if (postgresUrl) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(postgresUrl).hostname), 'Only isolated loopback PostgreSQL is allowed');
  const schema = `runtime_schema_qa_${crypto.randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: postgresUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}`);
  db = { query: (sql, params) => admin.query(sql, params), exec: async sql => {
    const result = await admin.query(sql);
    return Array.isArray(result) ? result : [result];
  } };
  cleanup = async () => { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); };
} else {
  db = new PGlite();
  cleanup = () => db.close();
}
const adapt = result => ({ ...result, rowCount: result.rows?.length || result.affectedRows || 0 });
const query = async (sql, params) => adapt(params ? await db.query(sql, params) : (await db.exec(sql)).at(-1));
const pool = { query, connect: async () => ({ query, release() {} }) };
const fresh = () => ({ query });
const notReady = missing => error => error instanceof SchemaNotReadyError && error.statusCode === 503 && error.missing.includes(missing);
try {
  await assert.rejects(ensureTables(fresh()), notReady('tenants.tenant_key'));
  await bootstrapFixtureSchema(pool, { executeSql: sql => db.exec(sql) });
  await assert.rejects(bootstrapFixtureSchema(pool), /requires_empty_schema/);
  assert.equal((await query("SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'tenant_domain_assignments' AND column_name = 'subdomain_id'")).rows[0].is_nullable, 'YES');
  const emitted = [];
  const runtime = { query: (sql, params) => { emitted.push(sql); return query(sql, params); } };
  await Promise.all(Array.from({ length: 12 }, () => ensureTables(runtime)));
  assert.equal(emitted.length, 2, 'concurrent calls share one readiness assertion');
  assert.ok(emitted.every(sql => /^\s*SELECT\b/i.test(sql)), 'runtime may issue only SELECT probes');
  await ensureTables(runtime);
  assert.equal(emitted.length, 2, 'success is cached per pool');

  // Exercise actual imported config functions, including their readiness code.
  const configSql = [];
  const configDb = { query: (sql, params) => { configSql.push(sql); return query(sql, params); } };
  assert.deepEqual(await listKnowledgeOverrides(configDb, 'schema-fixture'), []);
  assert.ok(configSql.length >= 3);
  assert.ok(configSql.every(sql => /^\s*SELECT\b/i.test(sql)), 'config reads must not perform DDL');
  await query('ALTER TABLE uploaded_documents DROP COLUMN content_fingerprint');
  await assert.rejects(assertConfigTablesReady(configDb), /migrations_not_applied/);
  await assert.rejects(ensureTables(fresh()), notReady('uploaded_documents.content_fingerprint'));
  await query('ALTER TABLE uploaded_documents ADD COLUMN content_fingerprint TEXT');
  await query('ALTER TABLE knowledge_runtime_profiles ALTER COLUMN greeting_text SET NOT NULL');
  await assert.rejects(assertConfigTablesReady(configDb), /migrations_not_applied/);
  await query('ALTER TABLE knowledge_runtime_profiles ALTER COLUMN greeting_text DROP NOT NULL');
  await assertConfigTablesReady(configDb);

  // A complete cached marketing request uses its real readiness and cache path.
  // Any provider attempt fails locally; no credentials or paid calls are used.
  const envKeys = Object.keys(process.env).filter(key => /clarity|google_ads/i.test(key));
  const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw Error('schema_test_provider_call_forbidden'); };
  process.env.MICROSOFT_CLARITY_API_TOKEN = 'offline-fixture';
  process.env.GOOGLE_ADS_MCP_TOKEN = 'offline-fixture';
  process.env.GOOGLE_ADS_CUSTOMER_ID = '123';
  try {
    for (const profile of ['sourceCampaign', 'urlCampaignDevice', 'channelUrlCampaign']) {
      await query("INSERT INTO external_analytics_snapshots(cache_key,source,payload_json,expires_at) VALUES ($1,'fixture',$2,NOW()+INTERVAL '1 day')", [`clarity:1:${profile}`, JSON.stringify({ rawMetrics: [] })]);
    }
    await query("INSERT INTO external_analytics_snapshots(cache_key,source,payload_json,expires_at) VALUES ('google_ads:mcp:123:1','fixture',$1,NOW()+INTERVAL '1 day')", [JSON.stringify({ campaigns: [], landingPages: [] })]);
    const marketingSql = [];
    const marketingPool = { query: (sql, params) => { marketingSql.push(sql); return query(sql, params); } };
    const report = await loadMarketingInsights({ pool: marketingPool, days: 1, refresh: false });
    assert.equal(report.ok, true);
    assert.equal(report.cache.googleAds.hit, true);
    assert.equal(fetchCalls, 0);
    assert.ok(marketingSql.some(sql => /FROM external_analytics_snapshots/.test(sql)));
    assert.ok(marketingSql.every(sql => /^\s*SELECT\b/i.test(sql)), 'cached marketing request must issue only SELECT');
    await query('ALTER TABLE external_analytics_snapshots RENAME TO hidden_analytics');
    await assert.rejects(loadMarketingInsights({ pool: fresh(), days: 1 }), notReady('external_analytics_snapshots.cache_key'));
    await query('ALTER TABLE hidden_analytics RENAME TO external_analytics_snapshots');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env).filter(key => /clarity|google_ads/i.test(key))) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }

  // A second pool must independently fail even when another pool was cached.
  await query('ALTER TABLE async_jobs DROP COLUMN lease_expires_at CASCADE');
  const retryPool = fresh();
  await assert.rejects(ensureTables(retryPool), notReady('async_jobs.lease_expires_at'));
  await query('ALTER TABLE async_jobs ADD COLUMN lease_expires_at TIMESTAMPTZ');
  await query("CREATE INDEX async_jobs_running_lease_idx ON async_jobs (lease_expires_at) WHERE status = 'running'");
  await ensureTables(retryPool);
  await query('ALTER TABLE billing_invoice_effects RENAME TO missing_effects');
  await assert.rejects(ensureTables(fresh()), notReady('billing_invoice_effects.invoice_id'));
  await query('ALTER TABLE missing_effects RENAME TO billing_invoice_effects');
  await query('ALTER TABLE tenant_users DISABLE TRIGGER tenant_user_invitation_revocation');
  await assert.rejects(ensureTables(fresh()), notReady('trigger:tenant_user_invitation_revocation'));
  await query('ALTER TABLE tenant_users ENABLE TRIGGER tenant_user_invitation_revocation');
  await query('DELETE FROM schema_migrations WHERE name = $1', [REQUIRED_SCHEMA_MIGRATIONS[0]]);
  await assert.rejects(ensureTables(fresh()), notReady(`migration:${REQUIRED_SCHEMA_MIGRATIONS[0]}`));

  // Historic migrations are deliberately not replayed. Failed receipt insertion
  // rolls back prior wrapped migrations and their DDL in the same transaction.
  await query('DELETE FROM schema_migrations');
  await query("INSERT INTO schema_migrations(name) VALUES ('0050_live_brief_curation.sql')");
  await query('DROP INDEX async_jobs_running_lease_idx');
  const injectedPool = { connect: async () => ({ release() {}, query: async (sql, params) => {
    if (/INSERT INTO schema_migrations/.test(sql) && params?.[0] === REQUIRED_SCHEMA_MIGRATIONS[2]) throw Error('injected_receipt_failure');
    return query(sql, params);
  } }) };
  await assert.rejects(applyRemediationMigrations(injectedPool), /injected_receipt_failure/);
  assert.deepEqual((await query('SELECT name FROM schema_migrations')).rows.map(r => r.name), ['0050_live_brief_curation.sql']);
  assert.equal((await query("SELECT to_regclass('async_jobs_running_lease_idx') AS object")).rows[0].object, null);
  assert.deepEqual(await applyRemediationMigrations(pool), REMEDIATION_MIGRATIONS);
  assert.deepEqual(await applyRemediationMigrations(pool), []);
  await ensureTables(fresh());

  // Upgrade an existing Sales schema with real call-linked checkout history.
  // The Sales-only receipt must not become a global runtime readiness gate.
  const prospectCheckoutMigration = '0058_sales_prospect_checkout.sql';
  assert.deepEqual(REMEDIATION_MIGRATIONS, [...REQUIRED_SCHEMA_MIGRATIONS, prospectCheckoutMigration, '0059_sales_company_contacts.sql', '0060_sales_intro_email.sql']);
  await query('DROP INDEX sales_checkout_prospect_only_idx');
  await query('DROP TRIGGER sales_checkout_mode_immutable_trigger ON sales_checkout_sessions');
  await query('DROP FUNCTION sales_checkout_mode_immutable()');
  await query('ALTER TABLE sales_checkout_sessions DROP CONSTRAINT sales_checkout_test_isolation');
  await query('ALTER TABLE sales_checkout_sessions DROP COLUMN is_test');
  await query('ALTER TABLE sales_checkout_sessions ALTER COLUMN sales_call_id SET NOT NULL');
  await query('DELETE FROM schema_migrations WHERE name = $1', [prospectCheckoutMigration]);
  await ensureTables(fresh());
  const repId = (await query("INSERT INTO admin_users(username,email,role) VALUES('migration-rep','migration-rep@example.test','sales') RETURNING id")).rows[0].id;
  for (const prospect of ['migration-prospect-1', 'migration-prospect-2']) {
    await query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164) VALUES($1,$1,'Migration fixture','+12025550100')", [prospect]);
  }
  for (const call of ['migration-call-1', 'migration-call-2']) {
    await query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state) VALUES($1,'migration-prospect-1',$2,'closed')", [call, repId]);
  }
  const insertLegacyCheckout = (id, callId, prospectId = 'migration-prospect-1') => query(
    "INSERT INTO sales_checkout_sessions(checkout_id,sales_call_id,prospect_id,rep_user_id,channel,recipient) VALUES($1,$2,$3,$4,'email','owner@example.test')",
    [id, callId, prospectId, repId]
  );
  const insertCheckout = (id, callId, prospectId = 'migration-prospect-1', isTest = false) => query(
    "INSERT INTO sales_checkout_sessions(checkout_id,sales_call_id,prospect_id,rep_user_id,channel,recipient,is_test,activation_status) VALUES($1,$2,$3,$4,'email','owner@example.test',$5,CASE WHEN $5 THEN 'test_only' ELSE 'unpaid' END)",
    [id, callId, prospectId, repId, isTest]
  );
  await insertLegacyCheckout('migration-existing', 'migration-call-1');
  const historicalCheckout = (await query("SELECT * FROM sales_checkout_sessions WHERE checkout_id='migration-existing'")).rows[0];
  const checkoutNullable = async () => (await query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sales_checkout_sessions' AND column_name='sales_call_id'")).rows[0].is_nullable;
  const checkoutIndex = async () => (await query("SELECT to_regclass('sales_checkout_prospect_only_idx') AS object")).rows[0].object;
  const failedSalesReceipt = { connect: async () => ({ release() {}, query: async (sql, params) => {
    if (/INSERT INTO schema_migrations/.test(sql) && params?.[0] === prospectCheckoutMigration) throw Error('injected_sales_receipt_failure');
    return query(sql, params);
  } }) };
  await assert.rejects(applyRemediationMigrations(failedSalesReceipt), /injected_sales_receipt_failure/);
  assert.equal(await checkoutNullable(), 'NO', 'failed receipt restores the prior NOT NULL constraint');
  assert.equal(await checkoutIndex(), null, 'failed receipt rolls back the new index');
  assert.equal((await query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sales_checkout_sessions' AND column_name='is_test'")).rows.length, 0, 'failed receipt rolls back test identity');
  assert.equal((await query("SELECT tgname FROM pg_trigger WHERE tgrelid='sales_checkout_sessions'::regclass AND tgname='sales_checkout_mode_immutable_trigger'")).rows.length, 0, 'failed receipt rolls back mode guard');
  assert.equal((await query('SELECT name FROM schema_migrations WHERE name=$1', [prospectCheckoutMigration])).rows.length, 0);
  assert.deepEqual(await applyRemediationMigrations(pool), [prospectCheckoutMigration]);
  assert.equal(await checkoutNullable(), 'YES');
  assert.equal(await checkoutIndex(), 'sales_checkout_prospect_only_idx');
  assert.deepEqual((await query("SELECT * FROM sales_checkout_sessions WHERE checkout_id='migration-existing'")).rows[0], { ...historicalCheckout, is_test: false });
  await insertCheckout('migration-standalone-1', null);
  await insertCheckout('migration-standalone-2', null, 'migration-prospect-2');
  await insertCheckout('migration-standalone-test-1', null, 'migration-prospect-1', true);
  await insertCheckout('migration-standalone-test-2', null, 'migration-prospect-2', true);
  await assert.rejects(insertCheckout('migration-standalone-duplicate', null), error => error.code === '23505');
  await assert.rejects(insertCheckout('migration-standalone-test-duplicate', null, 'migration-prospect-1', true), error => error.code === '23505');
  await assert.rejects(insertCheckout('migration-call-duplicate', 'migration-call-1'), error => error.code === '23505');
  await assert.rejects(insertCheckout('migration-call-mode-duplicate', 'migration-call-1', 'migration-prospect-1', true), error => error.code === '23505');
  for (const [id, isTest] of [['migration-standalone-1', true], ['migration-standalone-test-1', false]]) {
    await assert.rejects(query('UPDATE sales_checkout_sessions SET is_test=$2 WHERE checkout_id=$1', [id, isTest]), error => error.code === 'P5801');
  }
  for (const assignment of ["paid_at=NOW()", "activation_status='queued'", "tenant_key='would-be-customer'"]) {
    await assert.rejects(query(`UPDATE sales_checkout_sessions SET ${assignment} WHERE checkout_id='migration-standalone-test-1'`), error => error.code === '23514');
  }
  await query("UPDATE sales_checkout_sessions SET status='test_complete' WHERE checkout_id='migration-standalone-test-1'");
  assert.deepEqual((await query("SELECT is_test,paid_at,activation_status,tenant_key FROM sales_checkout_sessions WHERE checkout_id='migration-standalone-test-1'")).rows[0], { is_test: true, paid_at: null, activation_status: 'test_only', tenant_key: null });
  await insertCheckout('migration-second-call', 'migration-call-2');
  await assert.rejects(insertCheckout('migration-missing-call', 'missing-call'), error => error.code === '23503');
  assert.equal(Number((await query('SELECT count(*) AS count FROM sales_call_sessions')).rows[0].count), 2, 'standalone checkouts create no synthetic call records');
  assert.deepEqual(await applyRemediationMigrations(pool), []);
  assert.equal((await query('SELECT name FROM schema_migrations WHERE name=$1', [prospectCheckoutMigration])).rows.length, 1);
  assert.equal(migrationBody('-- comment\nBEGIN;\nSELECT 1;\nCOMMIT;').trim(), '-- comment\n\nSELECT 1;');
  assert.throws(() => migrationBody('BEGIN; SELECT 1;'), /wrapper_invalid/);
  const source = await fs.readFile(new URL('../pages/api/_lib/db.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|UPDATE|INSERT|DELETE)\s+(?:TABLE|INDEX|INTO|FROM|tenants|demo_sessions|knowledge_coverage_events)\b/i);
  // Guard the full runtime source surface, not just db.js. Explicit scripts and
  // migration files are outside these request/worker implementation roots.
  async function assertNoRuntimeDdl(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (['dist', 'node_modules', '.next'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await assertNoRuntimeDdl(file);
      else if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name)) {
        const body = await fs.readFile(file, 'utf8');
        assert.doesNotMatch(body, /\b(?:CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TYPE|EXTENSION)|ALTER\s+(?:TABLE|INDEX|TYPE)|DROP\s+(?:TABLE|INDEX|TYPE|EXTENSION))\s+/i, `runtime DDL remains in ${file}`);
      }
    }
  }
  for (const dir of ['apps', 'packages', 'lib', 'pages']) await assertNoRuntimeDdl(new URL(`../${dir}`, import.meta.url).pathname);
  console.log('Runtime schema regressions passed: actual config and cached marketing paths, runtime-wide DDL scan, read-only probes, per-pool concurrent cache, fail-closed tables/columns/triggers/receipts, retry after repair, explicit bootstrap, atomic migration receipts, idempotent reviewed deployment, Sales prospect-only upgrade rollback, immutable test/live isolation and uniqueness with preserved call history.');
} finally {
  await cleanup();
}
