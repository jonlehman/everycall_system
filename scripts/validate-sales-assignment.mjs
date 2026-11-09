import assert from 'node:assert/strict';
import pg from 'pg';
import { salesTransaction } from '../pages/api/_lib/salesDialer.js';
import { reassignSalesProspects } from '../pages/api/_lib/salesAssignments.js';
import { createSalesCallSession } from '../pages/api/_lib/salesRepository.js';
import { salesIncomingAction } from '../pages/api/_lib/salesIncoming.js';
import detailHandler from '../pages/api/v1/admin/sales/prospects/[prospectId].js';
import notesHandler from '../pages/api/v1/admin/sales/prospects/[prospectId]/notes.js';
import demoHandler from '../pages/api/v1/admin/sales/prospects/[prospectId]/demo.js';
import { PGlite } from '@electric-sql/pglite';
import { bootstrapFixtureSchema } from './lib/schema-migrations.mjs';
import assignHandler from '../pages/api/v1/admin/sales/prospects/assign.js';
import listHandler from '../pages/api/v1/admin/sales/prospects/index.js';
import exportHandler from '../pages/api/v1/admin/sales/prospects/export.js';
import { listSalesManagedProspects } from '../pages/api/_lib/salesAssignments.js';
import { getSalesProspectDetail, recordSalesCallOutcome } from '../pages/api/_lib/salesRepository.js';
import { sendSalesCheckout } from '../pages/api/_lib/salesCheckout.js';
import { bookSalesSetup } from '../pages/api/_lib/salesCalendar.js';

// Disposable in-process Postgres only: no local env files, network or providers.
process.env.DATABASE_URL = 'postgres://assignment-fixture';
const native = process.argv.includes('--postgres');
let db, nativePool, nativeAdmin, bootstrapClient, schema;
if (native) {
  const url = process.env.EVERYCALL_TEST_POSTGRES_URL;
  assert(url && ['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname), 'Use an isolated loopback Postgres fixture only.');
  schema = `sales_assignment_${crypto.randomUUID().replaceAll('-','')}`;
  nativeAdmin = new pg.Pool({connectionString:url,max:1});
  await nativeAdmin.query(`CREATE SCHEMA ${schema}`);
  nativePool = new pg.Pool({connectionString:url,max:12,options:`-c search_path=${schema} -c statement_timeout=15000`});
  bootstrapClient = await nativePool.connect();
  db = {exec:sql=>(bootstrapClient || nativePool).query(sql),close:async()=>{if(bootstrapClient)bootstrapClient.release();await nativePool.end();await nativeAdmin.query(`DROP SCHEMA ${schema} CASCADE`);await nativeAdmin.end();}};
} else db = new PGlite();
let failAudit = false, failLock = false, queryHook = null;
const execute = async (connection, sql, values = []) => {
  if (failAudit && sql.includes('INSERT INTO audit_log')) throw Error('fixture audit unavailable');
  if (failLock && sql.includes('FOR UPDATE NOWAIT')) throw Object.assign(Error('fixture locked'), { code: '55P03' });
  const result = await connection.query(sql, values);
  if (queryHook) await queryHook(sql, values, result);
  return { ...result, rowCount: result.rowCount ?? (result.rows?.length || Number(result.affectedRows) || 0) };
};
const query = (sql, values) => execute(native ? bootstrapClient || nativePool : db, sql, values);
const pool = { query, connect: async () => {
  if (!native) return {query,release(){}};
  const client=await nativePool.connect();return {query:(sql,values)=>execute(client,sql,values),release:()=>client.release()};
} };
globalThis.__everycallPool = pool;
const adminCookie = 'everycall_session=admin-token', salesCookie = 'everycall_sales_session=rep-token';
async function request(handler, { cookie = adminCookie, method = 'GET', body = {}, query: params = {}, key = crypto.randomUUID() } = {}) {
  const res = { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
  await handler({ method, body, query: params, headers: { cookie, 'idempotency-key': key } }, res);
  return res;
}
const snapshot = async ids => (await query('SELECT * FROM sales_prospects WHERE prospect_id=ANY($1::text[]) ORDER BY prospect_id', [ids])).rows;
async function bodyFor(ids, targetRepUserId = 2) {
  return { targetRepUserId, prospects: (await snapshot(ids)).map(row => ({ prospectId: row.prospect_id, expectedRowVersion: Number(row.row_version), assignedRepUserId: row.assigned_rep_user_id === null ? null : Number(row.assigned_rep_user_id) })) };
}
const assign = body => request(assignHandler, { method: 'POST', body });
const blocked = code => error => error.code === code;
try {
  await bootstrapFixtureSchema(pool, { executeSql: sql => db.exec(sql) });
  if (bootstrapClient) { bootstrapClient.release(); bootstrapClient=null; }
  await query(`INSERT INTO admin_users(id,username,email,password_hash,role) VALUES
    (1,'first','first@example.test','fixture','sales'),(2,'second','second@example.test','fixture','sales'),
    (3,'inactive','inactive@example.test','fixture','sales'),(4,'admin','admin@example.test','fixture','admin'),
    (5,'unconfigured','unconfigured@example.test','fixture','sales'),(6,'ineligible','ineligible@example.test','fixture','support')`);
  await query(`INSERT INTO sales_operator_settings(admin_user_id,display_name,active) VALUES(1,'First Rep',TRUE),(2,'Second Rep',TRUE),(3,'Inactive',FALSE),(4,'Admin Caller',TRUE),(6,'Not Sales',TRUE)`);
  await query("INSERT INTO sessions(id,user_id,role,expires_at) VALUES('admin-token',4,'admin',NOW()+interval '1 day'),('rep-token',1,'sales',NOW()+interval '1 day')");
  for (const [index, name] of ['Beta', 'Alpha', 'Alpha', '', 'Zulu', 'Gamma'].entries()) {
    await query(`INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,contact_name,contact_email,timezone,assigned_rep_user_id,numbers_json,metadata_json,callback_at)
      VALUES($1,$1,$2,$3,$4,'owner@example.test','America/Los_Angeles',$5,$6::jsonb,$7::jsonb,NOW()+interval '1 day')`,
    [`p${index}`, name, `+1206555010${index}`, index % 2 ? null : 'Sam', index < 2 ? 1 : index < 4 ? 2 : null, JSON.stringify([{phoneE164:`+1206555010${index}`,type:'shop',label:'Shop'}]), JSON.stringify({metro:'Fixture',sourceEvidence:'immutable'})]);
  }
  // Global sorts, empty fields, ties and scope-bound keysets (both directions).
  for (const sort of ['queue', 'business', 'contact', 'status', 'rep', 'updated']) {
    for (const direction of ['asc', 'desc']) {
      const all = await listSalesManagedProspects(pool, { sort, direction });
      let cursor = '', ids = [];
      do {
        const page = await listSalesManagedProspects(pool, { sort, direction, limit: 2, cursor });
        assert.equal(page.total, 6); ids.push(...page.prospects.map(row => row.prospectId)); cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(ids, all.prospects.map(row => row.prospectId)); assert.equal(new Set(ids).size, 6);
    }
  }
  assert.deepEqual((await listSalesManagedProspects(pool, {sort:'business'})).prospects.map(row=>row.prospectId), ['p3','p1','p2','p0','p5','p4']);
  const page = await listSalesManagedProspects(pool,{sort:'business',limit:2});
  await assert.rejects(listSalesManagedProspects(pool,{sort:'business',assignment:'assigned',cursor:page.nextCursor}),blocked('invalid_prospect_cursor'));
  await assert.rejects(listSalesManagedProspects(pool,{sort:'business; DROP TABLE admin_users'}),blocked('invalid_prospect_filter'));
  assert.equal((await listSalesManagedProspects(pool,{assignment:'assigned'})).total,4);
  assert.equal((await listSalesManagedProspects(pool,{assignment:'unassigned'})).total,2);
  assert.equal((await listSalesManagedProspects(pool,{search:'Alpha',assignment:'assigned'})).total,2);
  assert.equal((await listSalesManagedProspects(pool,{search:'absent'})).total,0);
  assert.equal((await listSalesManagedProspects(pool,{search:'absent'})).nextCursor,null);
  const filtered = await request(listHandler,{query:{managementView:'true',assignment:'unassigned',sort:'business'}});
  assert.equal(filtered.body.total,2);assert.deepEqual(filtered.body.prospects.map(row=>row.prospectId),['p5','p4']);
  const exported = await request(exportHandler,{query:{assignment:'assigned',search:'Alpha',sort:'business',direction:'desc'}});
  assert.equal(exported.statusCode,200);assert.equal(exported.body.split('\r\n').length,4);assert.ok(exported.body.indexOf('Second Rep') < exported.body.indexOf('First Rep'));
  assert.equal((await request(exportHandler,{cookie:salesCookie})).statusCode,403);
  const salesList=await request(listHandler,{cookie:salesCookie,query:{managementView:'true',assignment:'unassigned',sort:'rep'}});
  assert.deepEqual(salesList.body.prospects.map(row=>row.prospectId),['p0','p1']);assert.ok(!('assignedRepEmail' in salesList.body.prospects[0]));
  const body = await bodyFor(['p0','p4']);
  assert.equal((await request(assignHandler,{cookie:salesCookie,method:'POST',body})).statusCode,403);
  assert.equal((await request(assignHandler,{cookie:'everycall_session=rep-token',method:'POST',body})).statusCode,401);
  for (const target of [3,5,6,999]) assert.equal((await assign({...body,targetRepUserId:target})).body.error,'invalid_assignment_target');
  assert.equal((await assign({...body,prospects:[body.prospects[0],body.prospects[0]]})).statusCode,400);
  const before = await snapshot(['p0','p4']);
  const key = crypto.randomUUID();
  const result = await request(assignHandler,{method:'POST',body,key});
  assert.equal(result.statusCode,200,JSON.stringify(result.body));assert.equal(result.body.assignedCount,2);
  const after = await snapshot(['p0','p4']);
  for(let i=0;i<before.length;i++) {
    assert.equal(Number(after[i].assigned_rep_user_id),2); assert.equal(after[i].row_version,before[i].row_version+1);
    for(const field of Object.keys(before[i]).filter(key=>!['assigned_rep_user_id','row_version','updated_at'].includes(key))) assert.deepEqual(after[i][field],before[i][field],field);
  }
  assert.equal(await getSalesProspectDetail(pool,'p0',{operatorUserId:1}),null);
  assert.equal((await getSalesProspectDetail(pool,'p0',{operatorUserId:2})).assignedRepUserId,2);
  assert.equal((await request(assignHandler,{method:'POST',body,key})).body.assignedCount,2);
  assert.deepEqual(await snapshot(['p0','p4']),after,'Idempotent replay does not increment versions');
  assert.equal(Number((await query("SELECT count(*) n FROM audit_log WHERE action='sales.prospects.assigned'")).rows[0].n),1);
  assert.equal((await request(assignHandler,{method:'POST',body:{...body,targetRepUserId:4},key})).statusCode,409);
  assert.equal((await assign(body)).body.error,'assignment_selection_stale');
  // Completed automated receptionist calls have no rep wrap-up to save.
  await query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,metadata_json) VALUES('receptionist-history','p4',NULL,'ended','{\"direction\":\"receptionist_fallback\"}'::jsonb)");
  // Active configured admins remain legitimate assignment targets.
  assert.equal((await assign(await bodyFor(['p4'],4))).statusCode,200);
  // Atomic missing/stale/claim-race conflicts: no partial updates.
  const stable=await snapshot(['p1','p5']);let selection=await bodyFor(['p1','p5']);
  assert.equal((await assign({...selection,prospects:[selection.prospects[0],{...selection.prospects[1],prospectId:'missing'}]})).body.error,'assignment_selection_missing');
  assert.deepEqual(await snapshot(['p1','p5']),stable);
  await query("UPDATE sales_prospects SET assigned_rep_user_id=1 WHERE prospect_id='p5'");
  assert.equal((await assign(selection)).body.error,'assignment_selection_stale','Detect automatic claims that did not increment row_version');
  selection=await bodyFor(['p1','p5']);
  await query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,outcome_recorded_at) VALUES('history','p1',1,'ended',NOW())");
  const assertBusy=async()=>{const snapshotBefore=await snapshot(['p1','p5']);assert.equal((await assign(await bodyFor(['p1','p5']))).body.error,'assignment_prospect_busy');assert.deepEqual(await snapshot(['p1','p5']),snapshotBefore);};
  await query("UPDATE sales_call_sessions SET outcome_recorded_at=NULL WHERE sales_call_id='history'"); await assertBusy();
  await query("UPDATE sales_call_sessions SET outcome_recorded_at=NOW(),state='created' WHERE sales_call_id='history'"); await assertBusy();
  await query("UPDATE sales_call_sessions SET state='ended' WHERE sales_call_id='history'");
  await query("INSERT INTO sales_checkout_sessions(checkout_id,sales_call_id,prospect_id,rep_user_id,channel,recipient,status) VALUES('checkout','history','p1',1,'email','owner@example.test','delivery_uncertain')");await assertBusy();
  await query("UPDATE sales_checkout_sessions SET status='paid',paid_at=NOW() WHERE checkout_id='checkout'");await assertBusy();
  await query("DELETE FROM sales_checkout_sessions WHERE checkout_id='checkout'");
  await query("INSERT INTO sales_checkout_sessions(checkout_id,prospect_id,rep_user_id,channel,recipient,status) VALUES('standalone','p1',1,'email','owner@example.test','delivery_uncertain')");await assertBusy();
  await query("DELETE FROM sales_checkout_sessions WHERE checkout_id='standalone'");
  await query("INSERT INTO sales_setup_bookings(booking_id,sales_call_id,rep_user_id,calendar_owner,starts_at,ends_at,attendee_email,paid_at_booking) VALUES('booking','history',1,'calendar@example.test',NOW(),NOW()+interval '15 minutes','owner@example.test',FALSE)");await assertBusy();
  await query("DELETE FROM sales_setup_bookings WHERE booking_id='booking'");
  await query("INSERT INTO sales_incoming_calls(incoming_id,provider_call_control_id,phone_e164,rep_user_id,prospect_id,state) VALUES('incoming','incoming-provider','+12065550101',1,'p1','routing')");await assertBusy();
  await query("DELETE FROM sales_incoming_calls WHERE incoming_id='incoming'");
  await query("INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,sales_call_id,outcome,status) VALUES('followup','p1','history','no_answer','queued')");await assertBusy();
  await query("DELETE FROM sales_followup_jobs WHERE sales_followup_job_id='followup'");
  const rollbackSnapshot=await snapshot(['p1','p5']);
  failAudit=true;assert.equal((await assign(selection)).statusCode,500);failAudit=false;assert.deepEqual(await snapshot(['p1','p5']),rollbackSnapshot,'Audit failure rolls back assignment and receipt');
  failLock=true;assert.equal((await assign(selection)).body.error,'assignment_activity_pending');failLock=false;assert.deepEqual(await snapshot(['p1','p5']),rollbackSnapshot);
  assert.equal((await assign(selection)).statusCode,200);
  await assert.rejects(recordSalesCallOutcome(pool,{salesCallId:'history',outcome:'callback_requested',callbackAt:new Date(Date.now()+86400000).toISOString()}),blocked('prospect_forbidden'));
  let providerCalls=0; const forbiddenProvider=async()=>{providerCalls++;throw Error('Provider must not be called');};
  await assert.rejects(sendSalesCheckout(pool,{salesCallId:'history',repId:1,channel:'email',env:{APP_BASE_URL:'https://fixture.test'},stripe:{checkout:{sessions:{create:forbiddenProvider}}},mail:forbiddenProvider}),blocked('prospect_forbidden'));
  const start=new Date(Math.ceil((Date.now()+86400000)/900000)*900000).toISOString();
  await assert.rejects(bookSalesSetup(pool,{salesCallId:'history',repId:1,start,end:new Date(Date.parse(start)+900000).toISOString(),email:'owner@example.test',env:{FULL_BUILD_LEAD_MINUTES:'60',SETUP_CALL_OWNER:'calendar@example.test',SALES_GRAPH_TENANT_ID:'fixture',SALES_GRAPH_CLIENT_ID:'fixture',SALES_GRAPH_CLIENT_SECRET:'fixture'},graph:forbiddenProvider}),blocked('prospect_forbidden'));
  assert.equal(providerCalls,0);
  // Even a changing list whose per-page total stays under the export limit
  // cannot make export accumulate indefinitely or silently truncate.
  let exportPages=0;
  const exportRow=(await snapshot(['p4']))[0];
  queryHook=async(sql,values,result)=>{
    if(sql.startsWith('WITH matching AS')){
      exportPages++;
      result.rows[0]={total:5000,rows:Array.from({length:251},(_,index)=>({...exportRow,prospect_id:`moving-${index}`,sort_key:exportPages*1000+index}))};
    }
  };
  const movingExport=await request(exportHandler);queryHook=null;
  assert.equal(movingExport.statusCode,409);assert.equal(movingExport.body.error,'export_list_changed');assert.equal(exportPages,20);
  // Native interleavings use real separate connections and row locks. Assignment
  // commits while old rep requests wait after their read-only preflight.
  if (native) {
    process.env.SALES_CALL_WINDOW_START_LOCAL='00:00';process.env.SALES_CALL_WINDOW_END_LOCAL='00:00';
    await query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,permission_granted,timezone,assigned_rep_user_id) VALUES('race','race','Race fixture','+12065550888',TRUE,'UTC',1)");
    await query("INSERT INTO sales_demo_profiles(demo_profile_id,prospect_id,status,demo_bundle_json) VALUES('race-demo','race','ready','{}'::jsonb)");
    await query("INSERT INTO sales_incoming_calls(incoming_id,provider_call_control_id,phone_e164,rep_user_id,state) VALUES('race-incoming','race-provider','+12065550777',1,'receptionist')");
    let reached, resume; const held = new Promise(resolve=>{reached=resolve;}), release = new Promise(resolve=>{resume=resolve;});
    let pauseOnce=true;
    queryHook=async(sql)=>{if(pauseOnce && sql.includes('UPDATE sales_prospects SET assigned_rep_user_id=$2,row_version=row_version+1')){pauseOnce=false;reached();await release;}};
    const assignmentPromise=assign(await bodyFor(['race']));await held;
    const oldWriteSpecs = [
      [detailHandler,{method:'PATCH',body:{businessName:'Stale overwrite'}}],
      [detailHandler,{method:'DELETE'}],
      [notesHandler,{method:'POST',body:{body:'Stale note'}}],
      [demoHandler,{method:'POST',body:{force:true}}]
    ];
    const oldWrites=oldWriteSpecs.map(([handler,options])=>request(handler,{...options,cookie:salesCookie,query:{prospectId:'race'}}));
    const oldMatch=salesIncomingAction(pool,{incomingId:'race-incoming',repId:1,action:'match',prospectId:'race'}).then(()=>null,error=>error);
    const oldCall=createSalesCallSession(pool,{prospectId:'race',adminUserId:1}).then(()=>null,error=>error);
    // Wait until the old operations are actually waiting on a database lock.
    let waiting=0;
    for(let attempt=0;attempt<100;attempt++){
      const waiters=await nativeAdmin.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
      waiting=Number(waiters.rows[0].n);if(waiting>=6)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert(waiting>=6,'Old rep operations must overlap the uncommitted transfer');resume();
    assert.equal((await assignmentPromise).statusCode,200);queryHook=null;
    for(const response of await Promise.all(oldWrites)) assert.equal(response.statusCode,403,JSON.stringify(response.body));
    assert.equal((await oldMatch).code,'prospect_forbidden');assert.equal((await oldCall).code,'prospect_forbidden');
    assert.equal((await snapshot(['race']))[0].business_name,'Race fixture');
    assert.equal((await query("SELECT count(*) n FROM sales_prospect_notes WHERE prospect_id='race'")).rows[0].n,'0');
    assert.equal((await query("SELECT prospect_id FROM sales_incoming_calls WHERE incoming_id='race-incoming'")).rows[0].prospect_id,null);
    // A call reservation holding its shared config lock wins; assignment returns
    // a conflict immediately rather than interrupting or waiting on that call.
    let callReached, callResume; const callHeld=new Promise(resolve=>{callReached=resolve;}),callRelease=new Promise(resolve=>{callResume=resolve;});
    pauseOnce=true;queryHook=async(sql)=>{if(pauseOnce && sql==='SELECT id FROM sales_dialer_config WHERE id=TRUE FOR SHARE'){pauseOnce=false;callReached();await callRelease;}};
    const reservation=createSalesCallSession(pool,{prospectId:'race',adminUserId:2});await callHeld;
    assert.equal((await assign(await bodyFor(['race'],1))).body.error,'assignment_activity_pending');callResume();await reservation;queryHook=null;
    assert.equal((await assign(await bodyFor(['race'],1))).body.error,'assignment_prospect_busy');
    console.log('PASS native Postgres interleavings: assignment versus incoming match, PATCH, DELETE, notes, demo, and both call-reservation orderings.');
  }
  // A trigger reconciliation cannot silently alter DNC/status during ownership.
  await query("INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone','+12065550102','asked_not_to_be_called')");
  const protectedBefore=await snapshot(['p2','p3']);assert.equal((await assign(await bodyFor(['p2','p3'],1))).body.error,'assignment_protected_state_changed');assert.deepEqual(await snapshot(['p2','p3']),protectedBefore);
  console.log('Sales assignment validation passed: admin/RBAC, whole-result sorts/filters/keysets/export, atomic reassignment/conflicts/audit/idempotency, preserved fields, historical ownership and zero provider effects.');
} finally { await db.close(); delete globalThis.__everycallPool; }
