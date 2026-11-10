import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { bootstrapFixtureSchema,readMigration } from './lib/schema-migrations.mjs';
import { applySalesIntroEmailMigration,SALES_INTRO_MIGRATION,SALES_INTRO_PREDECESSORS,introMigrationDigest,salesIntroTargetFingerprint } from './lib/sales-intro-email-migration.mjs';

const target=process.env.EVERYCALL_TEST_POSTGRES_URL;
if(target)assert(['127.0.0.1','localhost','[::1]'].includes(new URL(target).hostname),'Use only an isolated loopback fixture.');
const schema=`intro_migration_${crypto.randomBytes(6).toString('hex')}`;
let db,pool,admin;
if(target){admin=new pg.Pool({connectionString:target});await admin.query(`CREATE SCHEMA ${schema}`);pool=new pg.Pool({connectionString:target,options:`-c search_path=${schema},public`});db={exec:sql=>pool.query(sql),close:async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};}
else{db=new PGlite();const query=async(sql,args=[])=>{
  if(!args.length&&sql.includes('CREATE TABLE IF NOT EXISTS sales_intro_email_deliveries')){await db.exec(sql);return {rows:[],rowCount:0};}
  const r=await db.query(sql,args);return {...r,rowCount:r.rows?.length||r.affectedRows||0};
};pool={query,connect:async()=>({query,release(){}})};}
const q=(sql,args=[])=>pool.query(sql,args);
const databaseUrl=target||'postgres://fixture@127.0.0.1:5432/intro_migration';
const options={databaseUrl,expectedTargetFingerprint:salesIntroTargetFingerprint(databaseUrl),reviewedRevision:'a'.repeat(40),currentRevision:'a'.repeat(40),expectedMigrationSha256:introMigrationDigest(await readMigration(SALES_INTRO_MIGRATION)),drainEvidenceReference:'release:0060-fixture',salesIngressFenced:true,salesJobsPaused:true,providerLegsDrained:true};
const online={onlineAdditive:true,releaseEvidenceReference:'release:0060-online-fixture',drainEvidenceReference:undefined,salesIngressFenced:false,salesJobsPaused:false,providerLegsDrained:false};
const apply=(changes={},targetPool=pool)=>applySalesIntroEmailMigration(targetPool,{...options,...changes});
const absent=async()=>assert.equal((await q("SELECT to_regclass('sales_intro_email_deliveries') AS name")).rows[0].name,null);
try {
  await bootstrapFixtureSchema(pool,{executeSql:sql=>db.exec(sql)});
  await db.exec(`DROP TRIGGER sales_intro_email_mode_guard ON sales_dialer_config;
    DROP TRIGGER sales_intro_email_company_guard ON sales_prospects;
    DROP TRIGGER sales_intro_email_contact_guard ON sales_prospect_contacts;
    DROP TRIGGER sales_intro_email_number_guard ON sales_prospect_contact_numbers;
    DROP TABLE sales_intro_email_deliveries;
    DROP FUNCTION sales_intro_email_immutable();DROP FUNCTION sales_intro_email_pending_guard();`);
  await q('DELETE FROM schema_migrations WHERE name=$1',[SALES_INTRO_MIGRATION]);
  await q("INSERT INTO schema_migrations(name) VALUES('0050_live_brief_curation.sql') ON CONFLICT DO NOTHING");
  assert.deepEqual(SALES_INTRO_PREDECESSORS,['0050_live_brief_curation.sql','0051_production_recovery.sql','0052_knowledge_source_integrity.sql','0053_knowledge_governance.sql','0054_call_processing_recovery.sql','0055_explicit_schema_baseline.sql','0056_sales_dialer_v2.sql','0057_sales_phone_test_mode.sql','0058_sales_prospect_checkout.sql','0059_sales_company_contacts.sql']);
  await assert.rejects(apply({expectedTargetFingerprint:'wrong'}),/intro_migration_target_mismatch/);
  await assert.rejects(apply({currentRevision:'b'.repeat(40)}),/intro_migration_reviewed_revision_mismatch/);
  await assert.rejects(apply({expectedMigrationSha256:'wrong'}),/intro_migration_reviewed_sql_mismatch/);
  await assert.rejects(apply({providerLegsDrained:false}),/intro_migration_sales_drain_evidence_required/);
  await assert.rejects(apply({...online,onlineAdditive:'true'}),/intro_migration_online_mode_invalid/);
  await assert.rejects(apply({...online,releaseEvidenceReference:undefined}),/intro_migration_online_release_evidence_required/);
  await assert.rejects(apply({...online,salesIngressFenced:true}),/intro_migration_online_drain_attestation_not_applicable/);
  await q("DELETE FROM schema_migrations WHERE name='0059_sales_company_contacts.sql'");
  await assert.rejects(apply(),e=>e.message==='intro_migration_predecessor_receipts_missing'&&e.missing.includes('0059_sales_company_contacts.sql'));await absent();
  await q("INSERT INTO schema_migrations(name) VALUES('0059_sales_company_contacts.sql')");
  await q('ALTER TABLE sales_checkout_sessions DISABLE TRIGGER sales_checkout_mode_immutable_trigger');
  await assert.rejects(apply(),/intro_migration_predecessor_schema_drift/);await q('ALTER TABLE sales_checkout_sessions ENABLE TRIGGER sales_checkout_mode_immutable_trigger');
  const rep=(await q("INSERT INTO admin_users(username,email,password_hash,role) VALUES('migration-fixture','fixture@example.test','unused','sales') RETURNING id")).rows[0].id;
  await q("INSERT INTO sales_operator_settings(admin_user_id,active) VALUES($1,TRUE)",[rep]);
  await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,permission_granted,assigned_rep_user_id) VALUES('migration-company','fixture','Fixture','+12065550122',TRUE,$1)",[rep]);
  await q("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state) VALUES('migration-call','migration-company',$1,'created')",[rep]);
  await assert.rejects(apply(),e=>e.message==='intro_migration_sales_work_pending'&&e.counts.active_calls===1);await absent();
  await q("UPDATE sales_call_sessions SET state='ended',ended_at=NOW() WHERE sales_call_id='migration-call'");
  await q("INSERT INTO sales_call_events(sales_call_id,provider,event_id,type,processing_status) VALUES('migration-call','fixture','fixture-event','call.ended','failed')");
  await assert.rejects(apply(),e=>e.message==='intro_migration_sales_work_pending'&&e.counts.recoverable_events===1);
  await q("UPDATE sales_call_events SET processing_status='processed'");
  await q("INSERT INTO sales_demo_jobs(sales_demo_job_id,prospect_id,status) VALUES('fixture-job','migration-company','queued')");
  await assert.rejects(apply(),e=>e.message==='intro_migration_sales_work_pending'&&e.counts.demo_jobs===1);
  await q("UPDATE sales_demo_jobs SET status='completed'");
  await q("INSERT INTO sales_checkout_sessions(checkout_id,prospect_id,rep_user_id,channel,recipient,status) VALUES('fixture-checkout','migration-company',$1,'email','fixture@example.test','delivery_uncertain')",[rep]);
  await assert.rejects(apply(),e=>e.message==='intro_migration_sales_work_pending'&&e.counts.checkout_deliveries===1);
  await q("UPDATE sales_checkout_sessions SET status='sent'");
  // Without a receipt, every owned name is a collision, including an empty
  // table, function overload, index/view relation or trigger on another table.
  await q('CREATE TABLE intro_collision_fixture(value INTEGER)');
  const collisionCases=[
    ["CREATE TABLE sales_intro_email_deliveries(marker TEXT)","DROP TABLE sales_intro_email_deliveries",'relation'],
    ["CREATE FUNCTION sales_intro_email_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$","DROP FUNCTION sales_intro_email_immutable()",'function'],
    ["CREATE FUNCTION sales_intro_email_pending_guard(value TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT value $$","DROP FUNCTION sales_intro_email_pending_guard(TEXT)",'function'],
    ['CREATE INDEX sales_intro_email_key_idx ON intro_collision_fixture(value)','DROP INDEX sales_intro_email_key_idx','relation'],
    ['CREATE VIEW sales_intro_email_unresolved_idx AS SELECT 1 AS value','DROP VIEW sales_intro_email_unresolved_idx','relation']
  ];
  for(const [create,drop,kind] of collisionCases){
    await q(create);
    await assert.rejects(apply(online),error=>error.message==='intro_migration_owned_object_collision'&&error.collisions.some(row=>row.kind===kind));
    assert.equal((await q('SELECT 1 FROM schema_migrations WHERE name=$1',[SALES_INTRO_MIGRATION])).rowCount,0);
    await q(drop);await absent();
  }
  await q("CREATE FUNCTION intro_collision_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$");
  await q('CREATE TRIGGER sales_intro_email_company_guard BEFORE INSERT ON intro_collision_fixture FOR EACH ROW EXECUTE FUNCTION intro_collision_trigger_fn()');
  await assert.rejects(apply(online),error=>error.message==='intro_migration_owned_object_collision'&&error.collisions.some(row=>row.kind==='trigger'));
  await q('DROP TABLE intro_collision_fixture');await q('DROP FUNCTION intro_collision_trigger_fn()');await absent();
  if(target){
    const blocker=await pool.connect();
    try {
      await blocker.query('BEGIN');await blocker.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
      // This mode permits the preflight SELECTs and conflicts with the runner's
      // SHARE ROW EXCLUSIVE NOWAIT. The mode row remains independently free.
      await blocker.query('LOCK TABLE sales_demo_jobs IN ROW EXCLUSIVE MODE');
      await assert.rejects(apply(online),error=>error.code==='55P03');
      await absent();assert.equal((await q('SELECT 1 FROM schema_migrations WHERE name=$1',[SALES_INTRO_MIGRATION])).rowCount,0);
      assert.equal((await q("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'sales_intro_email_%'")).rows[0].n,0);
      // Failure must release the earlier mode/advisory locks atomically.
      await blocker.query('SELECT id FROM sales_dialer_config WHERE id=TRUE FOR UPDATE NOWAIT');
    }finally{await blocker.query('ROLLBACK');blocker.release();}
  }
  let rejectedReceipt=false;
  const failingPool={connect:async()=>{
    const client=await pool.connect();return {release:()=>client.release(),query:(sql,args)=>{
      if(sql==='INSERT INTO schema_migrations(name) VALUES($1)'&&args?.[0]===SALES_INTRO_MIGRATION){rejectedReceipt=true;throw Error('fixture_receipt_failure');}
      return client.query(sql,args);
    }};
  }};
  await assert.rejects(apply(online,failingPool),/fixture_receipt_failure/);assert(rejectedReceipt);await absent();
  assert.equal((await q('SELECT 1 FROM schema_migrations WHERE name=$1',[SALES_INTRO_MIGRATION])).rowCount,0);
  if(target){
    // Let the real server enforce its total transaction deadline after all DDL
    // but before the receipt. A killed transaction must leave no partial schema.
    let deadlineError;
    const deadlinePool={connect:async()=>{
      const client=await pool.connect();return {on:client.on.bind(client),removeListener:client.removeListener.bind(client),release:error=>client.release(error),query:async(sql,args)=>{
        if(sql==='INSERT INTO schema_migrations(name) VALUES($1)'&&args?.[0]===SALES_INTRO_MIGRATION)await client.query('SELECT pg_sleep(12)');
        return client.query(sql,args);
      }};
    }};
    await assert.rejects(apply(online,deadlinePool),error=>{deadlineError=error;return /transaction timeout|statement timeout/.test(error.message);});
    assert(deadlineError.transactionElapsedMs>=9000&&deadlineError.transactionElapsedMs<13000,'The online transaction must be bounded near 10 seconds');
    await absent();assert.equal((await q('SELECT 1 FROM schema_migrations WHERE name=$1',[SALES_INTRO_MIGRATION])).rowCount,0);
    assert.equal((await q("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'sales_intro_email_%'")).rows[0].n,0);
  }
  const result=await apply(online);assert.equal(result.applied,true);assert.equal(result.physical.contactCompanyForeignKey,true);
  assert.equal(result.onlineAdditive,true);assert.equal(result.releaseEvidenceReference,online.releaseEvidenceReference);assert(!('drainEvidenceReference' in result));
  assert(result.elapsedMs>=result.transactionElapsedMs);assert(result.transactionElapsedMs<10000);assert.equal(result.counts.active_calls,0);
  // Installed is verification-only: no DDL, receipt insert or active-work gate.
  await q("UPDATE sales_demo_jobs SET status='leased'");
  const verifyOnlyPool={connect:async()=>{const client=await pool.connect();return {release:()=>client.release(),query:(sql,args)=>{
    assert(!/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|LOCK TABLE)\b/i.test(sql),'Installed migration must only verify');return client.query(sql,args);
  }};}};
  assert.equal((await apply(online,verifyOnlyPool)).applied,false);await q("UPDATE sales_demo_jobs SET status='completed'");
  assert.equal((await apply()).applied,false);
  assert.equal((await q('SELECT count(*)::int AS n FROM schema_migrations WHERE name=$1',[SALES_INTRO_MIGRATION])).rows[0].n,1);
  await q('ALTER TABLE sales_intro_email_deliveries DISABLE TRIGGER sales_intro_email_immutable_guard');
  await assert.rejects(apply(),/intro_migration_triggers_missing/);
  await q('ALTER TABLE sales_intro_email_deliveries ENABLE TRIGGER sales_intro_email_immutable_guard');
  console.log(`PASS scoped0060 migration (${target?'native PostgreSQL with NOWAIT refusal and actual 10-second transaction deadline':'PGlite'}): explicit online evidence, all owned-object collisions, target/revision/digest/drain guards, exact predecessor receipts and drift, active/recoverable-work fences, only0060 atomic receipt+DDL, installed verification-only; elapsed=${result.elapsedMs}ms transaction=${result.transactionElapsedMs}ms; no production access.`);
}finally{await db.close();}
