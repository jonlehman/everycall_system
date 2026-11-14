import assert from 'node:assert/strict';
import { createSalesReportFixture, installSalesTelnyxFixture } from './lib/sales-report-fixture.mjs';
import { getSalesReport, getSalesReportDay, exportSalesReport } from '../pages/api/_lib/salesReporting.js';
import handler from '../pages/api/v1/sales/reports.js';
import adminHandler from '../pages/api/v1/admin/sales/reports.js';
const fixture = await createSalesReportFixture(), { pool, query } = fixture;
const provider = await installSalesTelnyxFixture(fixture);
process.env.DATABASE_URL = 'postgres://self-report-fixture'; globalThis.__everycallPool = pool;
const filters = { contract: 'telnyx-v1', from: '2026-11-10', to: '2026-11-13' };
const cookies = { a: 'everycall_sales_session=report-sales', b: 'everycall_sales_session=report-sales-b', admin: 'everycall_session=report-admin', empty: 'everycall_sales_session=report-empty' };
async function request(params = {}, cookie = cookies.a, route = handler, method = 'GET') {
  const res = { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; } };
  await route({ method, headers: { cookie, 'x-user-id': '2', 'x-admin-id': '2' }, body: { admin_user_id: 2, operator: '2' }, query: { ...filters, ...params } }, res);
  if (route===handler || res.statusCode===200) assert.equal(res.headers['Cache-Control'], 'private, no-store');
  return res;
}
const serialized = response => typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
function privateResponse(response, forbidden) {
  const text = serialized(response);
  for (const marker of forbidden) assert.ok(!text.includes(marker), `Private marker leaked: ${marker}`);
  if (response.body?.coverage) for (const key of ['pagesRead','providerRecords','excludedOperatorAiRecords','excludedConnectionRecords','unmatchedRecords','ambiguousRecords','connectionId']) assert.ok(!(key in response.body.coverage), `Global coverage leaked: ${key}`);
}
try {
  for (const actorId of [null, undefined, '', '1', 0, -1, NaN, [], {}]) for (const service of [getSalesReport, getSalesReportDay, exportSalesReport]) await assert.rejects(service(pool,filters,{actorId}), /Report access unavailable/);
  await query("INSERT INTO admin_users(id,username,email,password_hash,role) VALUES(4,'empty','empty@example.test','fixture','sales')");
  await query('INSERT INTO sales_operator_settings(admin_user_id,display_name) VALUES(4,$1)', ['Empty Rep']);
  await query("INSERT INTO sessions(id,user_id,role,expires_at) VALUES ('report-sales-b',2,'sales',NOW()+interval '1 day'),('report-empty',4,'sales',NOW()+interval '1 day'),('report-expired',1,'sales',NOW()-interval '1 day'),('report-tenant',1,'tenant',NOW()+interval '1 day')");
  await query("UPDATE sales_operator_settings SET display_name='OTHER_REP_CANARY' WHERE admin_user_id=2");
  await query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,timezone,permission_granted) VALUES('private-b','private-b','OTHER_BUSINESS_CANARY','+12025550999','UTC',TRUE)");
  await query("ALTER TABLE sales_call_sessions DISABLE TRIGGER USER");
  await query("UPDATE sales_call_sessions SET prospect_id='private-b' WHERE admin_user_id=2");
  await query("UPDATE sales_call_sessions SET admin_user_id=3 WHERE sales_call_id='micro-a'");
  await query("ALTER TABLE sales_call_sessions ENABLE TRIGGER USER");
  const hidden = ['OTHER_REP_CANARY','OTHER_BUSINESS_CANARY','call-001','fixture-leg-call-001','fixture-session-call-001','micro-c','fixture-session-in-progress','test-call','SECRET_'];
  const initial = await request({ limit: '1' }); assert.equal(initial.statusCode,200); assert.equal(initial.body.totals.records,102); assert.deepEqual(initial.body.reps,[{id:1,name:'Alex Sales'}]);
  privateResponse(initial, hidden);
  for (const params of [{}, {view:'timeline',day:'2026-11-10'}, {format:'csv'}]) {
    for (const forged of [{operator:'2'}, {operator:'unassigned'}, {operator:'3',user_id:'2',admin_user_id:'2',prospectId:'private-b'}]) {
      const result = await request({...params,...forged}); assert.equal(result.statusCode,200); privateResponse(result,hidden);
      if (result.body?.recent) assert.ok(result.body.recent.every(row=>row.operatorId===1));
      if (result.body?.calls) assert.ok(result.body.calls.every(row=>row.operatorId===1));
    }
    for (const operator of [['2'], {id:2}, '0']) assert.equal((await request({...params,operator})).statusCode,400);
    for (const cookie of ['', 'everycall_session=report-sales', 'everycall_sales_session=report-expired', 'everycall_session=report-tenant', 'everycall_sales_session=report-tenant']) assert.equal((await request(params,cookie)).statusCode,cookie==='everycall_session=report-tenant'?403:401);
    assert.equal((await request(params,cookies.a,adminHandler)).statusCode,403);
    const empty = await request(params,cookies.empty); assert.equal(empty.statusCode,200); privateResponse(empty,[...hidden,'Alex Sales','call-002','fixture-sales-app']);
    if (empty.body?.totals) {assert.equal(empty.body.totals.records,0);assert.deepEqual(empty.body.reps,[]);assert.deepEqual(empty.body.summary,[]);}
    if (empty.body?.calls) assert.deepEqual(empty.body.calls,[]);
  }
  const second = await request({limit:'1'}, cookies.b), admin = await request({limit:'1'},cookies.admin,adminHandler);
  assert.equal(second.body.totals.records,103); assert.equal(admin.body.totals.records,210);
  const adminSelf=await request({},cookies.admin);assert.equal(adminSelf.body.totals.records,1);assert.equal(adminSelf.body.recent[0].operatorId,3);assert.equal(adminSelf.body.recent[0].id,'micro-a');privateResponse(adminSelf,['Alex Sales','OTHER_REP_CANARY','call-001','call-002']);
  assert.notEqual(initial.body.snapshot,second.body.snapshot); assert.notEqual(initial.body.snapshot,admin.body.snapshot);
  for (const source of [second,admin]) for (const params of [{cursor:source.body.nextCursor},{snapshot:source.body.snapshot,view:'timeline'},{snapshot:source.body.snapshot,format:'csv'}]) {const denied=await request(params);assert.equal(denied.statusCode,409);privateResponse(denied,hidden);}
  let cursor = '', ids = []; do {const page=await request({limit:'37',cursor});privateResponse(page,hidden);ids.push(...page.body.recent.map(row=>row.id));cursor=page.body.nextCursor;} while(cursor);
  assert.equal(ids.length,102);assert.equal(new Set(ids).size,102);
  assert.equal((await request({callId:'call-001'})).statusCode,400);
  assert.equal((await request({contract:undefined})).statusCode,400);
  assert.equal((await request({},cookies.a,handler,'POST')).statusCode,405);
  // Current prospect assignment never transfers historical calls.
  await query("UPDATE sales_prospects SET assigned_rep_user_id=2 WHERE prospect_id='fixture-company'");
  assert.equal((await request({limit:'1'})).body.snapshot, initial.body.snapshot);
  // Other actors' labels/provider activity cannot change own fingerprint.
  await query("UPDATE sales_operator_settings SET display_name='OTHER_REP_CHANGED' WHERE admin_user_id=2");
  await query("UPDATE sales_call_sessions SET started_at='2026-11-10T19:00:00Z' WHERE sales_call_id='call-001'");
  await provider.refresh();
  assert.equal((await request({limit:'1'})).body.snapshot,initial.body.snapshot);
  // Exact leg collision excludes ambiguous records from both actors.
  await query("UPDATE sales_call_sessions SET prospect_leg_id='fixture-leg-call-002' WHERE sales_call_id='call-001'");
  const ambiguous=await request();assert.equal(ambiguous.body.totals.records,101);privateResponse(ambiguous,[...hidden,'call-002']);
  await provider.refresh();
  await query('UPDATE sales_operator_settings SET active=FALSE WHERE admin_user_id=1');
  for(const params of [{},{view:'timeline'},{format:'csv'}]) assert.equal((await request(params)).statusCode,401);
  await query('UPDATE sales_operator_settings SET active=TRUE WHERE admin_user_id=1');
  const originalQuery=pool.query;pool.query=async (sql,params)=>{if (/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql)) throw Error('Reporting must not mutate');return originalQuery(sql,params);};
  for(const params of [{},{view:'timeline'},{format:'csv'}]) assert.equal((await request(params)).statusCode,200);
  pool.query=originalQuery;
  await provider.setRecords(Array.from({length:2001},(_,i)=>({record_type:'call-control',id:`bounded-${i}`,connection_id:'fixture-sales-app',telnyx_leg_id:`bounded-leg-${i}`,telnyx_session_id:'fixture-session-call-002',started_at:'2026-11-10T17:00:00Z',finished_at:'2026-11-10T17:01:00Z',direction:'outbound',attempted:1,connected:1,completed:1,call_sec:60,billed_sec:60})));
  for(const params of [{},{view:'timeline'},{format:'csv'}]) {const result=await request(params);assert.equal(result.statusCode,503);privateResponse(result,[...hidden,'page_limit','2001','bounded-']);assert.ok(!result.body.totals);}
  await provider.fail(); for(const params of [{},{view:'timeline'},{format:'csv'}]) {const result=await request(params);assert.equal(result.statusCode,503);privateResponse(result,[...hidden,'page_limit']);assert.ok(!result.body.totals);}
  console.log('PASS Sales self report: real auth/handler/provider/PGlite; actor-only JSON/day/CSV, complete pagination, malicious filters and copied snapshots, empty/admin/Sales/tenant/expired/disabled, historical ownership, ambiguity, no global metadata or unrelated-activity fingerprints, read-only and unavailable source');
} finally {provider.restore();await fixture.close();}
