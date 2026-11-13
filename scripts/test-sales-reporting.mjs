import assert from 'node:assert/strict';
import { createSalesReportFixture } from './lib/sales-report-fixture.mjs';
import { getSalesReport, salesReportFilters, exportSalesReport, getSalesReportTranscript } from '../pages/api/_lib/salesReporting.js';
import { SALES_REPORT_FIELDS, salesReportCsv } from '../lib/salesReportFields.js';
import handler from '../pages/api/v1/admin/sales/reports.js';

const fixture = await createSalesReportFixture();
const { pool, query } = fixture;
process.env.DATABASE_URL = 'postgres://report-fixture';
globalThis.__everycallPool = pool;
const filters = { from:'2026-11-10',to:'2026-11-13' };
async function request(params={},cookie='everycall_session=report-admin',method='GET') {
  const response={statusCode:200,headers:{},setHeader(key,value){this.headers[key]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};
  await handler({method,headers:{cookie},query:params},response);return response;
}
try {
  const today = salesReportFilters({}, new Date('2026-11-13T05:00:00Z'));
  assert.equal(today.from,'2026-10-15');assert.equal(today.to,'2026-11-13');
  for (const bad of [{from:'2026-02-30'},{from:'2025-01-01',to:'2026-11-13'},{range:'bad'},{operator:['1']},{operator:'0'},{operator:'1;DROP TABLE x'},{mode:'yes'},{direction:'sideways'},{state:'a b'},{outcome:['no_answer']},{search:'x'.repeat(121)}]) assert.throws(()=>salesReportFilters(bad));
  for (const bad of [{limit:'101'},{limit:['2']},{cursor:'bad'}]) await assert.rejects(getSalesReport(pool,{...filters,...bad}));
  await query("SET TIME ZONE 'America/Los_Angeles'");
  const report=await getSalesReport(pool,filters);
  assert.equal(report.totals.sessions,209);assert.equal(report.recent.length,100);assert.equal(report.totals.connected,103);assert.equal(report.totals.demosStarted,51);
  assert.equal(report.summary.reduce((sum,row)=>sum+row.sessions,0),209);
  assert.equal(report.activity.reduce((sum,row)=>sum+row.sessions,0),209);
  assert.equal(report.activity[0].date,'2026-11-10');assert.equal(report.outcomes.reduce((sum,row)=>sum+row.count,0),209);
  assert.equal(report.durations.averageConnectedSeconds,120);assert.equal(report.durations.connectedCount,102);assert.equal(report.durations.demoCount,51);
  assert.equal(report.durations.averageDemoSeconds,60);assert.equal(report.durations.oneToThree,102);
  assert.equal(report.recent.find(row=>row.id==='in-progress').connectedSeconds,null);
  assert.equal(report.recent.find(row=>row.id==='micro-c').sessionSeconds,null);
  assert.equal(report.recent.find(row=>row.id==='micro-c').hasRecording,true);
  assert.ok(!JSON.stringify(report).includes('SECRET_'));
  assert.deepEqual(Object.keys(report.recent[0]).sort(),SALES_REPORT_FIELDS.flatMap(([,fields])=>fields.map(([key])=>key)).sort());
  assert.equal(report.recent.find(row=>row.id.startsWith('call-')).contactName,'Original Contact');
  const ids=[];let cursor='';
  do {const page=await getSalesReport(pool,{...filters,limit:'37',cursor});ids.push(...page.recent.map(row=>row.id));cursor=page.nextCursor;assert.equal(page.totals.sessions,209);}while(cursor);
  assert.equal(new Set(ids).size,209);assert.equal(ids.length,209);
  assert.deepEqual(ids.slice(0,4),['in-progress','micro-c','micro-b','micro-a']);
  // Exact microsecond boundaries and same-time ID ties across individual pages.
  const micros=[];cursor='';
  for(let i=0;i<4;i++){const page=await getSalesReport(pool,{...filters,limit:'1',cursor});micros.push(page.recent[0].id);cursor=page.nextCursor;}
  assert.deepEqual(micros,ids.slice(0,4));
  await assert.rejects(getSalesReport(pool,{...filters,operator:'1',cursor:report.nextCursor}),/Refresh/);
  const inbound=await getSalesReport(pool,{...filters,direction:'inbound'});
  assert.equal(inbound.totals.sessions,1);assert.equal(inbound.recent[0].id,'micro-a');assert.equal(inbound.recent[0].direction,'inbound');assert.equal(inbound.recent[0].dialedNumber,null);assert.equal(inbound.recent[0].callerNumber,'+12025550199');assert.equal(inbound.recent[0].prospectNumber,'+12025550199');
  assert.equal((await getSalesReport(pool,{...filters,direction:'outbound'})).totals.sessions,208);
  const inboundCsv=await exportSalesReport(pool,{...filters,direction:'inbound'});assert.ok(inboundCsv.includes('inbound'));assert.ok(inboundCsv.includes('+12025550199'));assert.ok(!inboundCsv.includes('call-001'));
  assert.equal((await getSalesReport(pool,{...filters,mode:'test'})).totals.sessions,1);
  assert.equal((await getSalesReport(pool,{...filters,mode:'all'})).totals.sessions,210);
  assert.equal((await getSalesReport(pool,{range:'all'})).totals.sessions,211);
  const history=await getSalesReport(pool,{from:'2023-01-01',to:'2023-01-01'});assert.equal(history.recent[0].id,'old-call');
  assert.equal((await getSalesReport(pool,{...filters,operator:'1',outcome:'demo_completed'})).totals.sessions,102);
  assert.equal((await getSalesReport(pool,{...filters,state:'prospect_connected'})).totals.sessions,1);
  assert.equal((await getSalesReport(pool,{...filters,operator:'unassigned'})).totals.sessions,4);
  assert.equal((await getSalesReport(pool,{...filters,search:'Original Contact'})).totals.sessions,205);
  assert.equal((await getSalesReport(pool,{...filters,search:'%'})).totals.sessions,0);
  const empty=await getSalesReport(pool,{...filters,search:'absent'});assert.equal(empty.recent.length,0);assert.equal(empty.nextCursor,null);assert.equal(empty.durations.averageConnectedSeconds,null);
  const transcript=await getSalesReportTranscript(pool,'micro-c');assert.equal(transcript.transcript.length,3);assert.equal(transcript.transcript[2].role,null);assert.ok(!JSON.stringify(transcript).includes('SECRET_'));assert.match(transcript.transcript[0].text,/<script>/);
  await assert.rejects(getSalesReportTranscript(pool,'missing'),/not found/);
  const csv=await exportSalesReport(pool,filters);assert.equal(csv.split('\r\n').length,211);assert.match(csv,/' =HYPERLINK\(""bad/);assert.match(csv,/Notes ""quoted"", second line/);assert.ok(!csv.includes('SECRET_'));assert.ok(csv.includes('call-001'));
  const formula=salesReportCsv([{id:'\t@SUM(1)',businessName:'\n=2+2',operatorName:'+12025550111',liveNotes:'safe\ntext'}]);assert.ok(formula.includes("'\t@SUM(1)"));assert.ok(formula.includes("'\n=2+2"));assert.ok(formula.includes("'+12025550111"));
  for(const params of [filters,{...filters,format:'csv'},{callId:'micro-c'}]) {
    for(const [cookie,status] of [['',401],['everycall_sales_session=report-sales',403],['everycall_session=report-sales',401],['everycall_sales_session=report-sales; everycall_session=report-admin',403]]) assert.equal((await request(params,cookie)).statusCode,status);
    const allowed=await request(params);assert.equal(allowed.statusCode,200);assert.equal(allowed.headers['Cache-Control'],'private, no-store');
  }
  const csvResponse=await request({...filters,format:'csv'});assert.equal(csvResponse.headers['Content-Type'],'text/csv; charset=utf-8');assert.match(csvResponse.headers['Content-Disposition'],/attachment/);
  assert.equal((await request({},undefined,'POST')).statusCode,405);
  assert.equal((await request({callId:['micro-c']})).statusCode,400);
  await query(`INSERT INTO sales_call_sessions(sales_call_id,prospect_id,state,created_at)
    SELECT 'export-'||value,'fixture-company','closed','2026-11-10T12:00:00Z'::timestamptz FROM generate_series(1,2001) value`);
  const tooLarge=await request({...filters,format:'csv'});assert.equal(tooLarge.statusCode,400);assert.equal(tooLarge.body.error,'report_export_too_large');
  console.log('PASS Sales reporting: admin boundaries, full aggregates, safe fields/transcripts, UTC, stable pagination, filters, duration nulls, and bounded CSV');
} finally { await fixture.close(); }
