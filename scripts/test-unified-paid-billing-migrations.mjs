import assert from 'node:assert/strict';
import { createUpibTestFixture } from './lib/upib-test-fixture.mjs';
import { readMigration } from './lib/schema-migrations.mjs';
import { applyUnifiedPaidBillingMigrations, UPIB_MIGRATIONS, upibMigrationDigest, upibTargetFingerprint } from './lib/unified-paid-billing-migrations.mjs';

const target = process.env.EVERYCALL_TEST_POSTGRES_URL;
const fixture = await createUpibTestFixture({ databaseUrl: target, label: 'migration', migrations: [] });
const { pool } = fixture;
const q = (sql, args = []) => pool.query(sql, args);
const options = {
  execute: true, databaseUrl: target, expectedTargetFingerprint: upibTargetFingerprint(target),
  reviewedRevision: 'a'.repeat(40), currentRevision: 'a'.repeat(40),
  expectedMigrationSha256: Object.fromEntries(await Promise.all(UPIB_MIGRATIONS.map(async name => [name, upibMigrationDigest(await readMigration(name))]))),
  releaseEvidenceReference: 'release:upib-native-reviewed-fixture', inventoryEvidenceReference: 'inventory:upib-native-synthetic-accounts'
};
const apply = (changes = {}, usePool = pool) => applyUnifiedPaidBillingMigrations(usePool, { ...options, ...changes });
const wrapped = hook => ({ connect: async () => {
  const client = await pool.connect();
  return { query: async (sql, args) => { await hook(sql, client, args); return client.query(sql, args); }, on: (...a) => client.on(...a), off: (...a) => client.off(...a), release: e => client.release(e) };
} });
const absent = async () => {
  assert.equal((await q("SELECT 1 FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname='paid_intakes'")).rowCount, 0);
  assert.equal((await q('SELECT 1 FROM schema_migrations WHERE name=ANY($1::text[])', [UPIB_MIGRATIONS])).rowCount, 0);
  assert.equal((await q("SELECT 1 FROM pg_attribute WHERE attrelid='tenant_billing_accounts'::regclass AND attname='paid_purchase_id' AND NOT attisdropped")).rowCount, 0);
  assert.equal((await q("SELECT 1 FROM pg_attribute WHERE attrelid='billing_periods'::regclass AND attname='invoice_payload' AND NOT attisdropped")).rowCount, 0);
};
try {
  // Production carries the reviewed Live-mode expansion omitted by the reduced fixture.
  await q(await readMigration('0049_live_prompt_settings.sql'));
  await q("INSERT INTO schema_migrations(name) VALUES('0049_live_prompt_settings.sql')");
  await q("INSERT INTO schema_migrations(name) VALUES('0050_live_brief_curation.sql') ON CONFLICT DO NOTHING");
  await q("INSERT INTO tenants(tenant_key,name,telnyx_voice_number_id) VALUES('migration-owner','Synthetic','provider-retained')");
  await q("INSERT INTO tenant_billing_accounts(tenant_key,stripe_customer_id,stripe_subscription_id,stripe_price_id,last_invoice_id) VALUES('migration-owner','cus_keep','sub_keep','price_keep','in_keep')");
  await q("INSERT INTO billing_periods(tenant_key,period_start,period_end,stripe_subscription_id,stripe_invoice_id,stripe_invoice_item_id) VALUES('migration-owner','2026-01-01','2026-02-01','sub_keep','in_keep','ii_keep')");
  const accounts = (await q('SELECT to_jsonb(t) AS payload FROM tenant_billing_accounts t')).rows;
  const periods = (await q('SELECT to_jsonb(t) AS payload FROM billing_periods t')).rows;
  const heaps = (await q("SELECT relname,relfilenode FROM pg_class WHERE oid IN ('tenant_billing_accounts'::regclass,'billing_periods'::regclass) ORDER BY relname")).rows;
  for (const changes of [{execute: false}, {expectedTargetFingerprint: 'bad'}, {reviewedRevision: 'b'.repeat(40)}, {expectedMigrationSha256: {}}, {releaseEvidenceReference: ''}, {inventoryEvidenceReference: 'pending'}]) await assert.rejects(apply(changes), /upib_migration_/);
  await q("DELETE FROM schema_migrations WHERE name='0062_sales_contact_notes.sql'");
  await assert.rejects(apply(), /predecessor_receipts_missing/); await absent();
  await q("INSERT INTO schema_migrations(name) VALUES('0062_sales_contact_notes.sql')");
  await q('ALTER TABLE tenants DROP CONSTRAINT tenants_live_prompt_mode_check');
  await assert.rejects(apply(), /physical_contract_drift_tenants/); await absent();
  await q("ALTER TABLE tenants ADD CONSTRAINT tenants_live_prompt_mode_check CHECK(live_prompt_mode IN ('legacy','pending_v20','v20_1'))");
  await q('ALTER TABLE tenant_billing_accounts ALTER COLUMN billing_interval DROP DEFAULT');
  await assert.rejects(apply(), /physical_contract_drift/); await absent();
  await q("ALTER TABLE tenant_billing_accounts ALTER COLUMN billing_interval SET DEFAULT 'month'");
  await q('CREATE TABLE paid_intakes(intake_id TEXT)');
  await assert.rejects(apply(), /unreceipted_relation/); await q('DROP TABLE paid_intakes');
  await q('CREATE INDEX paid_purchases_setup_intake ON tenants(name)');
  await assert.rejects(apply(), /physical_contract_drift|unreceipted_relation/); await q('DROP INDEX paid_purchases_setup_intake');
  await q('CREATE FUNCTION reserve_paid_call() RETURNS INTEGER LANGUAGE SQL AS $$ SELECT 1 $$');
  await assert.rejects(apply(), /unreceipted_function/); await q('DROP FUNCTION reserve_paid_call()');
  await q('ALTER TABLE tenant_billing_accounts ADD COLUMN paid_base_through TIMESTAMPTZ');
  await assert.rejects(apply(), /unreceipted_column/); await q('ALTER TABLE tenant_billing_accounts DROP COLUMN paid_base_through');
  const lock = await pool.connect();
  try {
    for (const table of ['tenant_billing_accounts', 'billing_periods', 'schema_migrations']) {
      await lock.query('BEGIN');
      await lock.query(`LOCK TABLE ${table} IN ROW EXCLUSIVE MODE`);
      const start = performance.now(); await assert.rejects(apply(), e => e.code === '55P03');
      assert(performance.now() - start < 1500); await lock.query('ROLLBACK'); await absent();
    }
    await lock.query('BEGIN'); await lock.query('SELECT pg_advisory_xact_lock(1763910417)');
    await assert.rejects(apply(), /upib_migration_busy/); await lock.query('ROLLBACK');
  } finally { await lock.query('ROLLBACK'); lock.release(); }
  await assert.rejects(apply({}, wrapped(async (sql, client) => {
    if (sql === 'SELECT * FROM paid_intake_release') await client.query("UPDATE tenant_billing_accounts SET stripe_customer_id='cus_corrupt'");
  })), /existing_payload_changed/); await absent();
  assert.deepEqual((await q('SELECT to_jsonb(t) AS payload FROM tenant_billing_accounts t')).rows, accounts);
  // Both additive migrations and the first receipt roll back if the second fails.
  await assert.rejects(apply({}, wrapped(async (sql, client, args) => {
    if (sql.startsWith('INSERT INTO schema_migrations') && args[0] === UPIB_MIGRATIONS[1]) throw Error('fixture_receipt_failure');
  })), /fixture_receipt_failure/); await absent();
  // PostgreSQL, not a JavaScript stopwatch, terminates an over-budget transaction.
  await assert.rejects(apply({}, wrapped(async (sql, client) => {
    if (sql.startsWith('INSERT INTO schema_migrations')) {
      assert.equal((await client.query("SELECT 1 FROM paid_intake_release WHERE enabled=FALSE")).rowCount, 1);
      await client.query("SET LOCAL statement_timeout='0'"); await client.query('SELECT pg_sleep(11)');
    }
  })), e => ['25P04','57P01'].includes(e.code) || /terminated|closed/.test(e.message)); await absent();
  const result = await apply(); assert.equal(result.applied, true); assert.equal(result.gateEnabled, false);
  const newAccountColumns = ['paid_purchase_id','usage_anchor_at','initial_period_end','paid_base_through','service_ended_at','changed_number_ack_required','stripe_subscription_status'];
  assert.deepEqual((await q('SELECT to_jsonb(t)-$1::text[] AS payload FROM tenant_billing_accounts t', [newAccountColumns])).rows, accounts);
  assert.deepEqual((await q("SELECT to_jsonb(t)-ARRAY['invoice_attempted_at','invoice_payload'] AS payload FROM billing_periods t")).rows, periods);
  assert.deepEqual((await q("SELECT relname,relfilenode FROM pg_class WHERE oid IN ('tenant_billing_accounts'::regclass,'billing_periods'::regclass) ORDER BY relname")).rows, heaps);
  assert.equal((await apply({}, wrapped(async sql => { if (/^(?:\s|--[^\n]*\n)*(?:ALTER|INSERT|UPDATE|DELETE|CREATE|DROP)\b/i.test(sql)) throw Error('installed_must_not_mutate'); }))).applied, false);
  await q('ALTER TABLE paid_purchases ALTER COLUMN owner_email DROP NOT NULL');
  await assert.rejects(apply(), /physical_contract_drift_paid_purchases/);
  await q('ALTER TABLE paid_purchases ALTER COLUMN owner_email SET NOT NULL');
  await q('UPDATE paid_intake_release SET enabled=TRUE'); await assert.rejects(apply(), /release_gate_not_pristine_disabled/);
  await q('UPDATE paid_intake_release SET enabled=FALSE');
  await q('CREATE OR REPLACE FUNCTION reserve_paid_call() RETURNS INTEGER LANGUAGE SQL AS $$ SELECT 1 $$');
  await assert.rejects(apply(), /function_drift/); await q('DROP FUNCTION reserve_paid_call()');
  await q('DELETE FROM schema_migrations WHERE name=$1', [UPIB_MIGRATIONS[1]]);
  await assert.rejects(apply(), /partial_receipts/);
  console.log(JSON.stringify({status:'PASS',suite:'UPIB scoped migrations native PostgreSQL',checks:'exact pins and evidence; predecessor/base/owned-schema drift; orphan columns/tables/indexes/function overloads; NOWAIT/advisory contention; atomic two-DDL/two-receipt rollback; real transaction timeout; row/provider association preservation; no heap rewrite; installed verify-only; disabled gate; partial receipt rejection',applyMs:result.transactionElapsedMs,productionAccess:false}));
} finally { await fixture.close(); }
