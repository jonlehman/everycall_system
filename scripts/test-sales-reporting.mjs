import assert from 'node:assert/strict';
import { createSalesReportFixture, installSalesTelnyxFixture } from './lib/sales-report-fixture.mjs';
import { getSalesReport, getSalesReportDay, salesReportFilters, exportSalesReport, getSalesReportTranscript } from '../pages/api/_lib/salesReporting.js';
import { SALES_REPORT_FIELDS, salesReportCsv } from '../lib/salesReportFields.js';
import handler from '../pages/api/v1/admin/sales/reports.js';
const fixture = await createSalesReportFixture(), { pool, query } = fixture;
const record = (id, extra = {}) => ({ record_type:'call-control', id, connection_id:'fixture-sales-app', telnyx_leg_id:`fixture-leg-${id}`, telnyx_session_id:`fixture-session-${id}`,
  started_at:'2026-11-10T17:00:00Z', finished_at:'2026-11-10T17:00:40Z', direction:'outbound', attempted:1, connected:1, completed:1,
  call_sec:17, billed_sec:60, caller_number:'+12025550100', dest_number:'+12025550199', auth_username:'SECRET_PROVIDER_AUTH', metadata:'SECRET_PROVIDER_DATA', ...extra });
const records = Array.from({length:205}, (_, i) => record(`call-${String(i+1).padStart(3,'0')}`, { connected:i%2, completed:i%2 }));
records.push(record('micro-a',{started_at:'2026-11-10T18:00:00.000001Z'}), record('micro-b',{started_at:'2026-11-10T18:00:00.000002Z'}), record('micro-c',{started_at:'2026-11-10T18:00:00.000003Z', finished_at:null, call_sec:null, billed_sec:null, connected:null, completed:null}),
  record('unmatched',{direction:'inbound',telnyx_session_id:'unmatched-session'}), record('related',{telnyx_session_id:'fixture-session-call-001',connected:0,completed:0,call_sec:0}),
  record('operator',{telnyx_session_id:'operator-session'}));
const provider = await installSalesTelnyxFixture(fixture, records);
await query("UPDATE sales_call_sessions SET operator_session_id='operator-session' WHERE sales_call_id='call-001'");
process.env.DATABASE_URL='postgres://report-fixture'; globalThis.__everycallPool=pool;
const filters={from:'2026-11-10',to:'2026-11-13'};
async function request(params={},cookie='everycall_session=report-admin',method='GET') {
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}};
 await handler({method,headers:{cookie},query:{contract:'telnyx-v1',...params}},res);return res;
}
try {
 const defaults=salesReportFilters({},new Date('2026-11-13T05:00:00Z'));assert.equal(defaults.to,'2026-11-12');assert.equal(defaults.from,'2026-10-14');
 for(const bad of [{from:'2026-02-30'},{from:'2026-01-01',to:'2026-02-01'},{range:'all'},{operator:['1']},{operator:'0'},{mode:'live'},{direction:'sideways'},{state:'closed'},{outcome:'customer'},{search:'x'.repeat(121)}]) assert.throws(()=>salesReportFilters(bad));
 for(const bad of [{limit:'101'},{limit:['2']},{cursor:'bad'},{snapshot:'wrong'}]) await assert.rejects(getSalesReport(pool,{...filters,...bad}));
 await query("SET TIME ZONE 'Asia/Tokyo'");
 const report=await getSalesReport(pool,filters);
 assert.equal(report.totals.records,210);assert.equal(report.totals.uniqueSessions,209);assert.equal(report.totals.connected,105);assert.equal(report.totals.connectedUnknown,1);assert.equal(report.totals.completed,105);
 assert.equal(report.recent.length,100);assert.equal(report.coverage.providerRecords,211);assert.equal(report.coverage.excludedOperatorAiRecords,1);assert.equal(report.coverage.unmatchedRecords,1);
 assert.equal(report.summary.reduce((n,r)=>n+r.records,0),210);assert.equal(report.activity.reduce((n,r)=>n+r.records,0),210);assert.equal(report.statuses.reduce((n,r)=>n+r.count,0),210);
 assert.equal(report.durations.callSecondsCount,209);assert.equal(report.durations.callSecondsTotal,208*17);assert.equal(report.durations.billedSecondsTotal,209*60);
 assert.equal(report.recent[0].id,'micro-c');assert.equal(report.recent[0].elapsedSeconds,null);assert.equal(report.recent[0].callSeconds,null);
 assert.equal(report.activity[0].date,'2026-11-10');assert.ok(!JSON.stringify(report).includes('SECRET_'));
 assert.ok(!JSON.stringify(report).includes('demo_completed'));assert.ok(!('outcomes' in report));
 assert.deepEqual(Object.keys(report.recent[0]).sort(),SALES_REPORT_FIELDS.flatMap(([,f])=>f.map(([k])=>k)).sort());
 const ids=[];let cursor='';do {const page=await getSalesReport(pool,{...filters,limit:'37',cursor});ids.push(...page.recent.map(r=>r.id));cursor=page.nextCursor;assert.equal(page.totals.records,210);assert.equal(page.snapshot,report.snapshot);}while(cursor);
 assert.equal(new Set(ids).size,210);assert.equal(ids.length,210);assert.deepEqual(ids.slice(0,3),['micro-c','micro-b','micro-a']);
 await assert.rejects(getSalesReport(pool,{...filters,operator:'1',cursor:report.nextCursor}),/changed/);
 const inbound=await getSalesReport(pool,{...filters,direction:'inbound'});assert.equal(inbound.totals.records,1);assert.equal(inbound.recent[0].classification,'unmatched_identity');assert.equal(inbound.recent[0].operatorId,null);
 const rep=await getSalesReport(pool,{...filters,operator:'2'});assert.equal(rep.totals.records,104);assert.equal(rep.totals.uniqueSessions,103);
 assert.equal((await getSalesReport(pool,{...filters,status:'attempted_not_connected'})).totals.records,104);
 assert.equal((await getSalesReport(pool,{...filters,status:'unknown'})).totals.records,1);
 assert.equal((await getSalesReport(pool,{...filters,search:'SECRET_METADATA'})).totals.records,0);
 const empty=await getSalesReport(pool,{...filters,search:'absent'});assert.equal(empty.durations.callSecondsAverage,null);assert.equal(empty.durations.callSecondsTotal,null);
 const csv=await exportSalesReport(pool,{...filters,snapshot:report.snapshot});assert.equal(csv.split('\r\n').length,212);assert.ok(csv.includes('micro-c'));assert.ok(csv.includes('related'));assert.ok(!csv.includes('SECRET'));assert.ok(!csv.includes('Outcome notes'));
 const formula=salesReportCsv([{id:'\t@SUM(1)',businessName:'\n=2+2',operatorName:'+12025550111',callerName:'Quoted "value", line\nnext'}]);assert.ok(formula.includes("'\t@SUM(1)"));assert.ok(formula.includes("'\n=2+2"));assert.ok(formula.includes('Quoted ""value"", line\nnext'));
 await assert.rejects(getSalesReportTranscript(pool,'micro-c'),/do not supply a transcript/);
 for(const params of [filters,{...filters,format:'csv'},{...filters,view:'timeline'},{callId:'micro-c'}]) {
  for(const [cookie,status] of [['',401],['everycall_sales_session=report-sales',403],['everycall_session=report-sales',401],['everycall_sales_session=report-sales; everycall_session=report-admin',403]]) assert.equal((await request(params,cookie)).statusCode,status);
  const allowed=await request(params);assert.equal(allowed.statusCode,params.callId?400:200);assert.equal(allowed.headers['Cache-Control'],'private, no-store');
 }
 assert.equal((await request({},undefined,'POST')).statusCode,405);
 assert.equal((await request({...filters,contract:undefined})).body.error,'report_contract_changed');
 const day=await getSalesReportDay(pool,{...filters,day:'2026-11-10',snapshot:report.snapshot});assert.equal(day.calls.length,210);assert.equal(day.snapshot,report.snapshot);assert.equal(day.coverage.gapsAvailable,false);assert.ok(day.prior.every(r=>r.uncertain));
 assert.equal((await getSalesReportDay(pool,{...filters,day:'2026-11-13'})).calls.length,0);
 for(const [day,hours] of [['2026-03-08',23],['2026-11-01',25]]) {const d=await getSalesReportDay(pool,{from:day,to:day});assert.equal((new Date(d.dayEnd)-new Date(d.dayStart))/3600000,hours);}
 // Internal timing/outcomes cannot affect any provider metric, clock or snapshot.
 await query("UPDATE sales_call_sessions SET started_at='2020-01-01',ended_at='2020-01-03',outcome='paid',live_notes='changed app note' WHERE sales_call_id='call-001'");
 assert.equal((await getSalesReport(pool,filters)).snapshot,report.snapshot);
 await query("UPDATE sales_operator_settings SET display_name='Renamed label' WHERE admin_user_id=1");
 await assert.rejects(exportSalesReport(pool,{...filters,snapshot:report.snapshot}),/changed/);
 await assert.rejects(getSalesReport(pool,{...filters,cursor:report.nextCursor}),/changed/);
 // Duplicate stable identities never attach a record to either rep.
 await query("UPDATE sales_call_sessions SET prospect_leg_id='fixture-leg-call-001' WHERE sales_call_id='call-002'");
 const ambiguous=await getSalesReport(pool,{...filters,search:'call-001'});assert.equal(ambiguous.recent.find(r=>r.id==='call-001').operatorId,null);assert.ok(ambiguous.coverage.ambiguousRecords>=1);
 // Provider update fences every subsequent view; no empty-success fallback on failure.
 await provider.setRecords([record('unknown-completion',{connected:1,completed:null})]);
 const unknownCompletion=await getSalesReport(pool,filters);assert.equal(unknownCompletion.recent[0].status,'unknown');assert.equal(unknownCompletion.totals.connected,1);assert.equal(unknownCompletion.totals.completedUnknown,1);
 const fresh=await getSalesReport(pool,filters);await provider.setRecords([...records,record('added')]);
 await assert.rejects(getSalesReportDay(pool,{...filters,snapshot:fresh.snapshot}),/changed/);
 await provider.setRecords(Array.from({length:2001},(_,i)=>record(`cap-${i}`)));
 const tooLarge=await request({...filters,format:'csv'});assert.equal(tooLarge.statusCode,503);assert.match(tooLarge.body.message,/page_limit/);
 await provider.fail();for(const params of [filters,{...filters,format:'csv'},{...filters,view:'timeline'}]) {const response=await request(params);assert.equal(response.statusCode,503);assert.equal(response.body.error,'telnyx_records_unavailable');assert.ok(!('totals' in response.body));}
 console.log('PASS provider-only reporting: full aggregates, exact enrichment, independent clocks, flags/unknowns, session cardinality, stable snapshots, precision, filters, DST, auth and fail-closed CSV');
} finally {provider.restore();await fixture.close();}
