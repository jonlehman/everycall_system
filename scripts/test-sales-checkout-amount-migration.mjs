import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { activateSalesCheckoutAmount,SALES_AMOUNT_ACTIVATION_ACTION } from './lib/sales-checkout-amount-activation.mjs';
import { bootstrapFixtureSchema,readMigration } from './lib/schema-migrations.mjs';
import { applySalesCheckoutAmountMigration,SALES_AMOUNT_MIGRATION,SALES_AMOUNT_PREDECESSORS,amountMigrationDigest,salesAmountTargetFingerprint } from './lib/sales-checkout-amount-migration.mjs';

const target=process.env.EVERYCALL_TEST_POSTGRES_URL;
if(!target)throw Error('EVERYCALL_TEST_POSTGRES_URL must name a disposable native PostgreSQL17+ loopback fixture');
assert(['127.0.0.1','localhost','[::1]'].includes(new URL(target).hostname),'Use only an isolated loopback fixture.');
const schema=`amount_migration_${crypto.randomBytes(6).toString('hex')}`;
const admin=new pg.Pool({connectionString:target});
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString:target,options:`-c search_path=${schema},public`,query_timeout:12000});
const q=(sql,args=[])=>pool.query(sql,args);
const options={databaseUrl:target,expectedTargetFingerprint:salesAmountTargetFingerprint(target),reviewedRevision:'a'.repeat(40),currentRevision:'a'.repeat(40),expectedMigrationSha256:amountMigrationDigest(await readMigration(SALES_AMOUNT_MIGRATION)),releaseEvidenceReference:'release:0061-fixture',legacyPriceEvidenceReference:'evidence:legacy-100-usd-fixture'};
const apply=(changes={},targetPool=pool)=>applySalesCheckoutAmountMigration(targetPool,{...options,...changes});
const absent=async()=>{
  assert.equal((await q("SELECT 1 FROM pg_attribute WHERE attrelid='sales_checkout_sessions'::regclass AND attname='amount_cents' AND NOT attisdropped")).rowCount,0);
  assert.equal((await q("SELECT 1 FROM pg_attribute WHERE attrelid='sales_dialer_config'::regclass AND attname='custom_signup_amount_enabled' AND NOT attisdropped")).rowCount,0);
  assert.equal((await q('SELECT 1 FROM schema_migrations WHERE name=$1',[SALES_AMOUNT_MIGRATION])).rowCount,0);
};
const wrap=handler=>({connect:async()=>{const client=await pool.connect();return {
  on:client.on.bind(client),removeListener:client.removeListener.bind(client),release:error=>client.release(error),query:(sql,args)=>handler(client,sql,args)
};}});
try {
  await bootstrapFixtureSchema(pool);
  await q(`DROP TRIGGER sales_checkout_amount_immutable_trigger ON sales_checkout_sessions;
    DROP FUNCTION sales_checkout_amount_immutable(); ALTER TABLE sales_checkout_sessions DROP COLUMN amount_cents;
    ALTER TABLE sales_dialer_config DROP COLUMN custom_signup_amount_enabled`);
  await q('DELETE FROM schema_migrations WHERE name=$1',[SALES_AMOUNT_MIGRATION]);
  await q("INSERT INTO schema_migrations(name) VALUES('0050_live_brief_curation.sql') ON CONFLICT DO NOTHING");
  assert(SALES_AMOUNT_PREDECESSORS.includes('0060_sales_intro_email.sql'));
  await assert.rejects(apply({expectedTargetFingerprint:'wrong'}),/amount_migration_target_mismatch/);
  await assert.rejects(apply({currentRevision:'b'.repeat(40)}),/amount_migration_reviewed_revision_mismatch/);
  await assert.rejects(apply({expectedMigrationSha256:'wrong'}),/amount_migration_reviewed_sql_mismatch/);
  await assert.rejects(apply({releaseEvidenceReference:undefined}),/releaseEvidenceReference_required/);
  await assert.rejects(apply({legacyPriceEvidenceReference:undefined}),/legacyPriceEvidenceReference_required/);
  await assert.rejects(apply({},wrap((client,sql,args)=>sql.includes("current_setting('transaction_timeout'")?{rows:[{timeout:null}]}:client.query(sql,args))),/transaction_deadline_unavailable/);
  await q("DELETE FROM schema_migrations WHERE name='0060_sales_intro_email.sql'");
  await assert.rejects(apply(),e=>e.message==='amount_migration_predecessor_receipts_missing'&&e.missing.includes('0060_sales_intro_email.sql'));await absent();
  await q("INSERT INTO schema_migrations(name) VALUES('0060_sales_intro_email.sql')");
  await q('ALTER TABLE sales_checkout_sessions DISABLE TRIGGER sales_checkout_mode_immutable_trigger');
  await assert.rejects(apply(),/amount_migration_predecessor_schema_drift/);
  await q('ALTER TABLE sales_checkout_sessions ENABLE TRIGGER sales_checkout_mode_immutable_trigger');
  await q('ALTER TABLE sales_intro_email_deliveries DISABLE TRIGGER sales_intro_email_immutable_guard');
  await assert.rejects(apply(),/intro_migration_triggers_missing/);
  await q('ALTER TABLE sales_intro_email_deliveries ENABLE TRIGGER sales_intro_email_immutable_guard');
  const rep=(await q("INSERT INTO admin_users(username,email,password_hash,role) VALUES('amount-fixture','fixture@example.test','unused','sales') RETURNING id")).rows[0].id;
  await q("INSERT INTO sales_operator_settings(admin_user_id,active) VALUES($1,TRUE)",[rep]);
  await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,permission_granted,assigned_rep_user_id) VALUES('amount-company','fixture','Fixture','+12065550122',TRUE,$1)",[rep]);
  await q("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state) VALUES('amount-call','amount-company',$1,'created')",[rep]);
  await assert.rejects(apply(),e=>e.message==='amount_migration_sales_work_pending'&&e.counts.active_calls===1);await absent();
  await q("UPDATE sales_call_sessions SET state='ended',ended_at=NOW() WHERE sales_call_id='amount-call'");
  await q("INSERT INTO sales_checkout_sessions(checkout_id,prospect_id,rep_user_id,channel,recipient,status) VALUES('legacy-checkout','amount-company',$1,'email','fixture@example.test','delivery_uncertain')",[rep]);
  await assert.rejects(apply(),e=>e.message==='amount_migration_sales_work_pending'&&e.counts.checkout_deliveries===1);
  await q("UPDATE sales_checkout_sessions SET status='sent'");
  await q("INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,outcome) VALUES('pristine-1','amount-company','no_answer'),('pristine-2','amount-company','no_answer')");
  const followupRows=async()=>JSON.stringify((await q('SELECT to_jsonb(j)::text AS row_json FROM sales_followup_jobs j ORDER BY sales_followup_job_id COLLATE "C"')).rows.map(row=>row.row_json));
  const followupBefore=await followupRows();
  await assert.rejects(apply(),e=>e.message==='amount_migration_sales_work_pending'&&e.counts.followup_jobs===2);
  await assert.rejects(apply({pristineFollowupEvidenceReference:''}),/pristine_followup_evidence_invalid/);
  options.pristineFollowupEvidenceReference='release:0061-pristine-followups-fixture';
  // Every field in the narrowly approved pristine predicate must fail closed.
  const invalidFollowups=[
    ["status='leased'","status='queued'"], ["attempts=1",'attempts=0'], ['max_attempts=6','max_attempts=5'],
    ['locked_at=NOW()','locked_at=NULL'], ["locked_by='fixture-worker'",'locked_by=NULL'],
    ['completed_at=NOW()','completed_at=NULL'], ["provider_result_json='{\"sent\":true}'::jsonb", "provider_result_json='{}'::jsonb"],
    ["last_error_code='fixture'",'last_error_code=NULL'], ["last_error_message='fixture'",'last_error_message=NULL'],
    ["outcome='interested'","outcome='no_answer'"], ["status='completed',locked_by='fixture-worker'","status='queued',locked_by=NULL"]
  ];
  for(const [bad,restore] of invalidFollowups){
    await q(`UPDATE sales_followup_jobs SET ${bad} WHERE sales_followup_job_id='pristine-1'`);
    await assert.rejects(apply(),/followup_exception_not_pristine/);
    await q(`UPDATE sales_followup_jobs SET ${restore} WHERE sales_followup_job_id='pristine-1'`);
    assert.equal(await followupRows(),followupBefore);await absent();
  }
  await q("INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,outcome) VALUES('pristine-3','amount-company','no_answer')");
  await assert.rejects(apply(),/followup_exception_not_pristine/);
  await q("DELETE FROM sales_followup_jobs WHERE sales_followup_job_id='pristine-3'");
  await q("UPDATE sales_call_sessions SET state='created' WHERE sales_call_id='amount-call'");
  await assert.rejects(apply(),e=>e.message==='amount_migration_sales_work_pending'&&e.counts.active_calls===1);
  await q("UPDATE sales_call_sessions SET state='ended' WHERE sales_call_id='amount-call'");
  // A same-transaction change simulates an accidental migration-side edit;
  // whole-row comparison must detect it and atomically restore the original.
  await assert.rejects(apply({},wrap(async(client,sql,args)=>{
    const result=await client.query(sql,args);
    if(sql.includes('ADD COLUMN IF NOT EXISTS amount_cents'))await client.query("UPDATE sales_followup_jobs SET updated_at=updated_at+INTERVAL '1 second' WHERE sales_followup_job_id='pristine-1'");
    return result;
  })),/followup_preservation_failed/);
  await absent();assert.equal(await followupRows(),followupBefore);
  await q('CREATE TABLE amount_collision_fixture(value INTEGER)');
  const collisionCases=[
    ['ALTER TABLE sales_dialer_config ADD COLUMN custom_signup_amount_enabled BOOLEAN NOT NULL DEFAULT FALSE','ALTER TABLE sales_dialer_config DROP COLUMN custom_signup_amount_enabled','column'],
    ['ALTER TABLE sales_checkout_sessions ADD COLUMN amount_cents INT NOT NULL DEFAULT 10000','ALTER TABLE sales_checkout_sessions DROP COLUMN amount_cents','column'],
    ['ALTER TABLE amount_collision_fixture ADD CONSTRAINT sales_checkout_amount_range CHECK(value>0)','ALTER TABLE amount_collision_fixture DROP CONSTRAINT sales_checkout_amount_range','constraint'],
    ["CREATE FUNCTION sales_checkout_amount_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$","DROP FUNCTION sales_checkout_amount_immutable()",'function'],
    ["CREATE FUNCTION sales_checkout_amount_immutable(value TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT value $$","DROP FUNCTION sales_checkout_amount_immutable(TEXT)",'function'],
    ["CREATE FUNCTION amount_collision_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER sales_checkout_amount_immutable_trigger BEFORE INSERT ON amount_collision_fixture FOR EACH ROW EXECUTE FUNCTION amount_collision_trigger_fn()",'DROP TRIGGER sales_checkout_amount_immutable_trigger ON amount_collision_fixture; DROP FUNCTION amount_collision_trigger_fn()','trigger']
  ];
  for(const [create,drop,kind] of collisionCases){
    await q(create);await assert.rejects(apply(),e=>e.message==='amount_migration_owned_object_collision'&&e.collisions.some(row=>row.kind===kind));
    await q(drop);await absent();
  }
  // Simulated catalog sizes test hard bounds without making a huge fixture.
  await assert.rejects(apply({},wrap((client,sql,args)=>sql.includes('pg_total_relation_size')?{rows:[{bytes:16777217}]}:client.query(sql,args))),/checkout_size_bound/);
  await assert.rejects(apply({},wrap((client,sql,args)=>sql.includes('LIMIT 10001')?{rows:[{n:10001}]}:client.query(sql,args))),/checkout_row_bound/);
  for(const lockedTable of ['sales_checkout_sessions','sales_dialer_config']) {
  const blocker=await pool.connect();
  try {
    await blocker.query('BEGIN');await blocker.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    // ACCESS SHARE permits all preflight reads and the table write fences;
    // only the explicit checkout ACCESS EXCLUSIVE NOWAIT must refuse it.
    await blocker.query(`LOCK TABLE ${lockedTable} IN ACCESS SHARE MODE`);
    const started=performance.now();await assert.rejects(apply(),e=>e.code==='55P03');assert(performance.now()-started<3000);
    await absent();await blocker.query('SELECT id FROM sales_dialer_config WHERE id=TRUE FOR UPDATE NOWAIT');
  }finally{await blocker.query('ROLLBACK');blocker.release();}
  }
  await assert.rejects(apply({},wrap((client,sql,args)=>{
    if(sql==='INSERT INTO schema_migrations(name) VALUES($1)'&&args?.[0]===SALES_AMOUNT_MIGRATION)throw Error('fixture_receipt_failure');
    return client.query(sql,args);
  })),/fixture_receipt_failure/);await absent();assert.equal(await followupRows(),followupBefore);
  let deadlineError;
  await assert.rejects(apply({},wrap(async(client,sql,args)=>{
    if(sql==='INSERT INTO schema_migrations(name) VALUES($1)'&&args?.[0]===SALES_AMOUNT_MIGRATION){
      // Each statement is shorter than statement_timeout; only the total
      // transaction_timeout can terminate the second query before completion.
      await client.query('SELECT pg_sleep(6)');await client.query('SELECT pg_sleep(6)');
    }
    return client.query(sql,args);
  })),e=>{deadlineError=e;return e.code==='25P04'&&/transaction timeout/.test(e.message);});
  assert(deadlineError.transactionElapsedMs>=9000&&deadlineError.transactionElapsedMs<13000);await absent();
  assert.equal(await followupRows(),followupBefore);
  const workerSource=await readFile(new URL('../pages/api/_lib/salesFollowupJobs.js',import.meta.url),'utf8');
  const actualClaimSql=workerSource.match(/`(WITH claimable AS \([\s\S]*?RETURNING jobs\.\*)`/)?.[1];
  assert(actualClaimSql,'Native contention proof must exercise the actual worker claim UPDATE');
  let claimBlocked=false;
  const result=await apply({},wrap(async(client,sql,args)=>{
    if(sql.includes('ADD COLUMN IF NOT EXISTS amount_cents')){
      const claimant=await pool.connect();
      try {
        await claimant.query('BEGIN');await claimant.query("SET LOCAL lock_timeout='200ms'");
        await assert.rejects(claimant.query(actualClaimSql,[3,'fixture-claim-worker']),e=>e.code==='55P03');
        claimBlocked=true;
      }finally{await claimant.query('ROLLBACK');claimant.release();}
    }
    return client.query(sql,args);
  }));assert(claimBlocked);assert.equal(await followupRows(),followupBefore);
  assert.equal(result.followupPreservation.count,2);
  assert.equal(result.followupPreservation.sha256,amountMigrationDigest(followupBefore));
  assert.equal(result.pristineFollowupEvidenceReference,options.pristineFollowupEvidenceReference);
assert(result.applied);assert.equal(result.scanEvidence.rows,1);assert.equal(result.physical.legacyDefault,10000);
  assert.equal((await q('SELECT custom_signup_amount_enabled FROM sales_dialer_config WHERE id=TRUE')).rows[0].custom_signup_amount_enabled,false);
  assert.equal((await q("SELECT amount_cents FROM sales_checkout_sessions WHERE checkout_id='legacy-checkout'")).rows[0].amount_cents,10000);
  const insert=amount=>q("INSERT INTO sales_checkout_sessions(checkout_id,prospect_id,rep_user_id,channel,recipient,status,amount_cents) VALUES($1,'amount-company',$2,'email','fixture@example.test','sent',$3)",['amount-'+amount,rep,amount]);
  // The standalone index allows one live checkout per prospect; use call-bound
  // rows for range checks with distinct test calls.
  await q('UPDATE sales_checkout_sessions SET sales_call_id=$1 WHERE checkout_id=$2',['amount-call','legacy-checkout']);
  await assert.rejects(insert(99),e=>e.code==='23514');await assert.rejects(insert(100000000),e=>e.code==='23514');
  await insert(100);await q("DELETE FROM sales_checkout_sessions WHERE checkout_id='amount-100'");await insert(99999999);
  await assert.rejects(q("UPDATE sales_checkout_sessions SET amount_cents=101 WHERE checkout_id='legacy-checkout'"),e=>e.code==='P6101');
  await q("UPDATE sales_call_sessions SET state='created' WHERE sales_call_id='amount-call'");
  assert.equal((await apply({},wrap((client,sql,args)=>{
    assert(!/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|LOCK TABLE)\b/i.test(sql),'Installed migration verifies without mutation or activity gate');return client.query(sql,args);
  }))).applied,false);
  await q('ALTER TABLE sales_checkout_sessions DISABLE TRIGGER sales_checkout_amount_immutable_trigger');
  await assert.rejects(apply(),/amount_migration_trigger_drift/);
  await q('ALTER TABLE sales_checkout_sessions ENABLE TRIGGER sales_checkout_amount_immutable_trigger');
  await q('ALTER TABLE sales_checkout_sessions ALTER COLUMN amount_cents SET DEFAULT 20000');
  await assert.rejects(apply(),/amount_migration_column_drift/);
  await q('ALTER TABLE sales_checkout_sessions ALTER COLUMN amount_cents SET DEFAULT 10000');
  assert.equal((await q('SELECT count(*)::int AS n FROM schema_migrations WHERE name=$1',[SALES_AMOUNT_MIGRATION])).rows[0].n,1);
  const functionSql=(await q("SELECT pg_get_functiondef('sales_checkout_amount_immutable()'::regprocedure) AS sql")).rows[0].sql;
  await q('CREATE OR REPLACE FUNCTION sales_checkout_amount_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
  await assert.rejects(apply(),/amount_migration_function_drift/);await q(functionSql);
  await q('ALTER TABLE sales_checkout_sessions DROP CONSTRAINT sales_checkout_amount_range');
  await assert.rejects(apply(),/amount_migration_constraint_drift/);
  await q('ALTER TABLE sales_checkout_sessions ADD CONSTRAINT sales_checkout_amount_range CHECK(amount_cents BETWEEN 100 AND 99999999)');
  await q('ALTER TABLE sales_dialer_config ALTER COLUMN custom_signup_amount_enabled SET DEFAULT TRUE');
  await assert.rejects(apply(),/amount_migration_activation_gate_drift/);
  await q('ALTER TABLE sales_dialer_config ALTER COLUMN custom_signup_amount_enabled SET DEFAULT FALSE');
  const adminId=(await q("INSERT INTO admin_users(username,email,role) VALUES('release-admin','release@example.test','admin') RETURNING id")).rows[0].id;
  const cutoverAt=(await q("SELECT clock_timestamp()-INTERVAL '811 seconds' AS t")).rows[0].t.toISOString();
  const activation={...options,deploymentId:'dpl_fixture0061',cutoverAt,adminUserId:adminId};
  const activate=(changes={},targetPool=pool)=>activateSalesCheckoutAmount(targetPool,{...activation,...changes});
  await assert.rejects(activate({adminUserId:rep}),/amount_activation_admin_required/);
  await assert.rejects(activate({cutoverAt:new Date().toISOString(),apply:true}),/old_invocations_not_retired/);
  await assert.rejects(activate({expectedTargetFingerprint:'wrong'}),/target_mismatch/);
  await assert.rejects(activate({currentRevision:'b'.repeat(40)}),/reviewed_revision_mismatch/);
  await assert.rejects(activate({expectedMigrationSha256:'wrong'}),/reviewed_sql_mismatch/);
  await assert.rejects(activate({deploymentId:'unverified'}),/deployment_required/);
  await assert.rejects(activate({releaseEvidenceReference:undefined}),/release_evidence_required/);
  assert.equal((await activate({},wrap((client,sql,args)=>{
    assert(!/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql));return client.query(sql,args);
  }))).ready,true);
  assert.equal((await q('SELECT custom_signup_amount_enabled FROM sales_dialer_config WHERE id=TRUE')).rows[0].custom_signup_amount_enabled,false);
  await assert.rejects(activate({apply:true},wrap((client,sql,args)=>{
    if(sql.includes('INSERT INTO audit_log'))throw Error('fixture_activation_audit_failure');return client.query(sql,args);
  })),/fixture_activation_audit_failure/);
  assert.equal((await q('SELECT custom_signup_amount_enabled FROM sales_dialer_config WHERE id=TRUE')).rows[0].custom_signup_amount_enabled,false);
  const beforeAmounts=await q('SELECT checkout_id,amount_cents FROM sales_checkout_sessions ORDER BY checkout_id');
  const activated=await activate({apply:true});assert.equal(activated.activated,true);assert(activated.auditId);
  assert.deepEqual((await q('SELECT checkout_id,amount_cents FROM sales_checkout_sessions ORDER BY checkout_id')).rows,beforeAmounts.rows);
  assert.equal((await activate({apply:true},wrap((client,sql,args)=>{
    assert(!/\b(INSERT|DELETE|CREATE|ALTER|DROP)\b/i.test(sql));assert(!sql.startsWith('UPDATE '));return client.query(sql,args);
  }))).alreadyEnabled,true);
  assert.equal((await q('SELECT count(*)::int AS n FROM audit_log WHERE action=$1',[SALES_AMOUNT_ACTIVATION_ACTION])).rows[0].n,1);
  assert.equal((await apply()).applied,false); // enabled gate is valid installed schema
  console.log(JSON.stringify({status:'PASS',suite:'scoped0061 native PostgreSQL',server:(await q('SHOW server_version')).rows[0].server_version,checks:'target/revision/digest/evidence/capability; predecessors+0060 physical; owned column/constraint/functions/foreign-table trigger; row/byte bounds; activity; ACCESS EXCLUSIVE NOWAIT; receipt rollback; actual total transaction deadline; legacy10000/min/max/immutable; installed verification-only and drift; explicit pristine max2 exception/nonpristine refusal/actual worker claim blocked/full-row preservation across success and failures; activation read-only plan/admin/target/revision/digest/deployment/810-second guards/audit rollback/idempotence/no amount edits',transactionDeadlineMs:deadlineError.transactionElapsedMs,applyMs:result.transactionElapsedMs,scanEvidence:result.scanEvidence,productionAccess:false}));
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
