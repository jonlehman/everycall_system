import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { bootstrapFixtureSchema,readMigration } from './lib/schema-migrations.mjs';
import { applySalesContactNotesMigration,SALES_NOTES_MIGRATION,notesMigrationDigest,salesNotesTargetFingerprint } from './lib/sales-contact-notes-migration.mjs';

const target=process.env.EVERYCALL_TEST_POSTGRES_URL;
if(!target||!['127.0.0.1','localhost','[::1]'].includes(new URL(target).hostname))throw Error('Native PostgreSQL loopback fixture required');
const schema=`notes_migration_${crypto.randomBytes(6).toString('hex')}`;
const admin=new pg.Pool({connectionString:target});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString:target,options:`-c search_path=${schema},public`});
const q=(sql,args=[])=>pool.query(sql,args);
const options={databaseUrl:target,expectedTargetFingerprint:salesNotesTargetFingerprint(target),reviewedRevision:'a'.repeat(40),currentRevision:'a'.repeat(40),expectedMigrationSha256:notesMigrationDigest(await readMigration(SALES_NOTES_MIGRATION)),releaseEvidenceReference:'release:0062-fixture'};
const apply=(changes={},fixturePool=pool)=>applySalesContactNotesMigration(fixturePool,{...options,...changes});
const absent=async()=>{assert.equal((await q("SELECT 1 FROM pg_attribute WHERE attrelid='sales_prospect_contacts'::regclass AND attname='notes' AND NOT attisdropped")).rowCount,0);assert.equal((await q('SELECT name FROM schema_migrations WHERE name=$1',[SALES_NOTES_MIGRATION])).rowCount,0);};
try {
  await bootstrapFixtureSchema(pool);
  await q('ALTER TABLE sales_prospect_contacts DROP COLUMN notes');
  await q('DELETE FROM schema_migrations WHERE name=$1',[SALES_NOTES_MIGRATION]);
  await q("INSERT INTO schema_migrations(name) VALUES('0050_live_brief_curation.sql') ON CONFLICT DO NOTHING");
  await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164) VALUES('notes-company','notes-company','Company','+12065550101')");
  const before=(await q("SELECT to_jsonb(c) AS value FROM sales_prospect_contacts c ORDER BY contact_id")).rows;
  const relfilenode=(await q("SELECT relfilenode FROM pg_class WHERE oid='sales_prospect_contacts'::regclass")).rows[0].relfilenode;
  await assert.rejects(apply({expectedTargetFingerprint:'bad'}),/target_mismatch/);
  await assert.rejects(apply({reviewedRevision:'b'.repeat(40)}),/revision_mismatch/);
  await assert.rejects(apply({expectedMigrationSha256:'bad'}),/sql_mismatch/);
  await assert.rejects(apply({releaseEvidenceReference:undefined}),/evidence_required/);
  await q("DELETE FROM schema_migrations WHERE name='0061_sales_checkout_amount.sql'");
  await assert.rejects(apply(),/predecessor_receipts_missing/);await absent();
  await q("INSERT INTO schema_migrations(name) VALUES('0061_sales_checkout_amount.sql')");
  await q("ALTER TABLE sales_prospect_contacts ALTER COLUMN first_name DROP DEFAULT");
  await assert.rejects(apply(),/base_column_drift/);await absent();
  await q("ALTER TABLE sales_prospect_contacts ALTER COLUMN first_name SET DEFAULT ''");
  await q('ALTER TABLE sales_prospect_contacts DROP CONSTRAINT sales_prospect_contacts_prospect_id_fkey');
  await assert.rejects(apply(),/contact_constraint_drift/);await absent();
  await q('ALTER TABLE sales_prospect_contacts ADD CONSTRAINT sales_prospect_contacts_prospect_id_fkey FOREIGN KEY(prospect_id) REFERENCES sales_prospects(prospect_id) ON DELETE CASCADE');
  await q('ALTER TABLE sales_prospect_contacts DISABLE TRIGGER sales_contact_default_valid');
  await assert.rejects(apply(),/contact_guard_drift/);await absent();
  await q('ALTER TABLE sales_prospect_contacts ENABLE TRIGGER sales_contact_default_valid');
  await q("ALTER TABLE sales_prospect_contacts ADD COLUMN notes TEXT DEFAULT ''");
  await assert.rejects(apply(),/unreceipted_column/);
  await q('ALTER TABLE sales_prospect_contacts DROP COLUMN notes');
  const lock=await pool.connect();
  try {
    await lock.query('BEGIN');await lock.query('SELECT 1 FROM sales_prospect_contacts');
    const start=performance.now();await assert.rejects(apply(),error=>error.code==='55P03');assert(performance.now()-start<1500);
    await lock.query('ROLLBACK');await absent();
    await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(1763910417)');
    await assert.rejects(apply(),/notes_migration_busy/);await lock.query('ROLLBACK');
  } finally {await lock.query('ROLLBACK');lock.release();}
  // A failed receipt must roll back the already executed ALTER.
  const wrapped=hook=>({connect:async()=>{const client=await pool.connect();return {query:async(sql,args)=>{await hook(sql,client);return client.query(sql,args);},on:(...a)=>client.on(...a),off:(...a)=>client.off(...a),release:e=>client.release(e)};}});
  await assert.rejects(apply({},wrapped(async sql=>{if(sql.startsWith('INSERT INTO schema_migrations'))throw Error('receipt_fixture_failure');})),/receipt_fixture_failure/);await absent();
  // Verify the database actually enforces the total transaction deadline.
  await assert.rejects(apply({},wrapped(async(sql,client)=>{if(sql.startsWith('INSERT INTO schema_migrations')){assert.equal((await client.query("SELECT 1 FROM pg_attribute WHERE attrelid='sales_prospect_contacts'::regclass AND attname='notes' AND NOT attisdropped")).rowCount,1);await client.query("SET LOCAL statement_timeout='0'");await client.query('SELECT pg_sleep(6)');}})),error=>['25P04','57P01'].includes(error.code)||/terminated|closed/.test(error.message));await absent();
  const result=await apply();assert.equal(result.applied,true);
  assert.equal((await q("SELECT relfilenode FROM pg_class WHERE oid='sales_prospect_contacts'::regclass")).rows[0].relfilenode,relfilenode,'No heap rewrite');
  assert.deepEqual((await q("SELECT to_jsonb(c)-'notes' AS value FROM sales_prospect_contacts c ORDER BY contact_id")).rows,before);
  assert.equal((await q('SELECT notes FROM sales_prospect_contacts')).rows[0].notes,'');
  const memo='  café 📝\n第二行\n'+'long text '.repeat(1200)+'\n  ';
  await q('UPDATE sales_prospect_contacts SET notes=$1',[memo]);
  await q("UPDATE sales_prospect_contacts SET title='Legacy writer'");
  assert.equal((await q('SELECT notes FROM sales_prospect_contacts')).rows[0].notes,memo);
  assert.equal((await apply({},wrapped(async sql=>{if(/^(?:\s|--[^\n]*\n)*(?:ALTER|INSERT|UPDATE|DELETE|CREATE|DROP)\b/i.test(sql))throw Error('installed_run_must_not_mutate');}))).applied,false);
  await q('ALTER TABLE sales_prospect_contacts ALTER COLUMN notes DROP NOT NULL');
  await assert.rejects(apply(),/column_drift/);
  console.log(JSON.stringify({status:'PASS',suite:'scoped0062 native PostgreSQL',checks:'pins, predecessor/base-column/FK/default-guard/collision drift, immediate table/advisory contention refusal, DDL+receipt rollback including actual post-DDL transaction timeout, verification-only installed rerun, no heap rewrite, existing rows preserved, empty default, long Unicode memo, old writer preservation, installed verification/drift',applyMs:result.transactionElapsedMs,productionAccess:false}));
} finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
