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
import { bootstrapFixtureSchema, applyRemediationMigrations, migrationBody } from './lib/schema-migrations.mjs';

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
  assert.deepEqual(await applyRemediationMigrations(pool), REQUIRED_SCHEMA_MIGRATIONS);
  assert.deepEqual(await applyRemediationMigrations(pool), []);
  await ensureTables(fresh());
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
  console.log('Runtime schema regressions passed: actual config and cached marketing paths, runtime-wide DDL scan, read-only probes, per-pool concurrent cache, fail-closed tables/columns/triggers/receipts, retry after repair, explicit bootstrap, atomic migration receipts, idempotent reviewed deployment.');
} finally {
  await cleanup();
}
