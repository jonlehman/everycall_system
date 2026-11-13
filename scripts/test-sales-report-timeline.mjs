import assert from 'node:assert/strict';
import { createSalesReportFixture, installSalesTelnyxFixture } from './lib/sales-report-fixture.mjs';
import { salesReportTimeline, salesTimelineTime } from '../lib/salesReportTimeline.js';
import { fetchSalesTelnyxRecords, getSalesTelnyxRecords } from '../pages/api/_lib/salesTelnyxRecords.js';
import handler from '../pages/api/v1/admin/sales/reports.js';
const bounds = { dayStart:'2026-11-10T08:00:00Z',dayEnd:'2026-11-11T08:00:00Z' };
const record = (id,extra={}) => ({ record_type:'call-control',id,telnyx_leg_id:`leg-${id}`,telnyx_session_id:`session-${id}`,connection_id:'sales-app',started_at:'2026-11-10T17:00:00Z',finished_at:'2026-11-10T17:01:00Z',direction:'outbound',cli:'SECRET_PHONE',...extra });
function mock(records,alter) { let calls=0;return async(url,options)=>{
  calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.equal(new URL(url).origin,'https://api.telnyx.com');
  const p=new URL(url).searchParams,page=Number(p.get('page[number]'));let matches=records.filter(r=>Date.parse(r.started_at)<Date.parse(p.get('filter[started_at][lt]')) && (p.has('filter[started_at][gte]') ? Date.parse(r.started_at)>=Date.parse(p.get('filter[started_at][gte]')) : Date.parse(r.finished_at)>Date.parse(p.get('filter[finished_at][gt]'))));
  const body={data:matches.slice((page-1)*50,page*50),meta:{total_pages:Math.ceil(matches.length/50),total_results:matches.length,page_number:page,page_size:50}};
  return alter?.(body,page,calls) || Response.json(body);
};}
const load = (records,options={}) => fetchSalesTelnyxRecords({...bounds,env:{SALES_TELNYX_API_KEY:'fake',SALES_TELNYX_CALL_CONTROL_APP_ID:'sales-app'},now:()=>Date.parse('2026-11-15T12:00:00Z'),fetchImpl:mock(records),...options});
const records=Array.from({length:105},(_,i)=>record(String(i)));
const paginated=await load(records);assert.equal(paginated.status,'available');assert.equal(paginated.pagesRead,4);assert.equal(paginated.records.length,105);assert.ok(!JSON.stringify(paginated).includes('SECRET'));
assert.equal((await load([])).status,'available');assert.equal((await load([])).paginationComplete,true);
assert.equal((await load([],{env:{}})).reason,'credential_unavailable');
assert.equal((await load([],{env:{SALES_TELNYX_API_KEY:'fake'}})).reason,'sales_connection_unconfigured');
const scoped=await load([record('good'),record('other',{connection_id:'not-sales'})]);assert.equal(scoped.records.length,1);assert.equal(scoped.excludedConnectionRecords,1);assert.equal(scoped.paginationComplete,true);
assert.equal((await load(records,{maxPages:1})).reason,'page_limit');
for (const [status,reason] of [[429,'rate_limited'],[401,'access_denied'],[503,'provider_error']]) assert.equal((await load(records,{fetchImpl:mock(records,(_,p)=>p===2?new Response('{}',{status}):null)})).reason,reason);
assert.equal((await load(records,{fetchImpl:mock(records,(b,p)=>p===2?Response.json({...b,data:records.slice(0,50)}):null)})).reason,'repeated_page');
assert.equal((await load(records,{fetchImpl:mock(records,(b,p)=>p===2?Response.json({...b,meta:{...b.meta,total_results:106}}):null)})).reason,'changing_results');
assert.equal((await load(records,{fetchImpl:async()=>{throw Object.assign(Error(),{name:'TimeoutError'});}})).reason,'timeout');
assert.equal((await load(records,{fetchImpl:async()=>Response.json({data:[],meta:{}})})).reason,'invalid_pagination');
assert.equal((await load([record('bad',{record_type:'messaging'})])).reason,'invalid_record');
assert.equal((await load([record('dup'),record('dup')])).reason,'duplicate_records');
assert.equal((await load([record('dup'),record('dup',{finished_at:'2026-11-10T18:00:00Z'})])).reason,'conflicting_records');
const crossing=await load([record('cross',{started_at:'2026-11-10T07:55:00Z',finished_at:'2026-11-10T08:05:00Z'}),record('midnight',{started_at:bounds.dayStart}),record('next',{started_at:bounds.dayEnd})]);assert.deepEqual(crossing.records.map(r=>r.id),['midnight','cross']);
// Cache is isolated by the configured application, including the same day/key.
const savedFetch=globalThis.fetch, savedKey=process.env.SALES_TELNYX_API_KEY, savedApp=process.env.SALES_TELNYX_CALL_CONTROL_APP_ID;
try {
 process.env.SALES_TELNYX_API_KEY='cache-fixture-only';process.env.SALES_TELNYX_CALL_CONTROL_APP_ID='app-a';globalThis.fetch=mock([record('a',{connection_id:'app-a'})]);
 assert.equal((await getSalesTelnyxRecords(bounds)).records[0].id,'a');
 process.env.SALES_TELNYX_CALL_CONTROL_APP_ID='app-b';globalThis.fetch=mock([record('b',{connection_id:'app-b'})]);
 assert.equal((await getSalesTelnyxRecords(bounds)).records[0].id,'b');
} finally { globalThis.fetch=savedFetch;for(const [key,value] of [['SALES_TELNYX_API_KEY',savedKey],['SALES_TELNYX_CALL_CONTROL_APP_ID',savedApp]]) { if(value===undefined)delete process.env[key];else process.env[key]=value; } }
const fixture=await createSalesReportFixture();const providerFixture=await installSalesTelnyxFixture(fixture);
process.env.DATABASE_URL='postgres://report-timeline-fixture';globalThis.__everycallPool=fixture.pool;
async function request(query={},cookie='everycall_session=report-admin'){
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{contract:'telnyx-v1',view:'timeline',...query},headers:{cookie}},res);return res;
}
const base={from:'2026-11-10',to:'2026-11-13',day:'2026-11-10'};
try {
 await fixture.query("SET TIME ZONE 'Asia/Tokyo'");
 for(const cookie of ['','everycall_sales_session=report-sales','everycall_session=report-sales'])assert.notEqual((await request(base,cookie)).statusCode,200);
 const full=await request(base);assert.equal(full.statusCode,200);assert.equal(full.headers['Cache-Control'],'private, no-store');assert.equal(full.body.calls.length,205);assert.equal(full.body.coverage.source,'telnyx');assert.ok(!JSON.stringify(full.body).includes('SECRET'));
 assert.equal((await request({...base,cursor:'nonsense'})).statusCode,400);
 assert.equal((await request({...base,operator:'1',direction:'outbound'})).body.calls.length,102);
 assert.equal((await request({...base,mode:'test'})).statusCode,400);
 for(const day of [['2026-11-10'],'2026-02-30','2026-11-14','not-a-day'])assert.equal((await request({...base,day})).statusCode,400);
 assert.equal((await request({...base,view:['timeline']})).statusCode,400);
 assert.equal((await request({...base,day:'2026-11-13'})).body.calls.length,1);
 assert.equal((await request({range:'all'})).statusCode,400);
 for(const [day,start,end,hours] of [['2026-01-15','2026-01-15T08:00:00Z','2026-01-16T08:00:00Z',24],['2026-07-15','2026-07-15T07:00:00Z','2026-07-16T07:00:00Z',24],['2026-03-08','2026-03-08T08:00:00Z','2026-03-09T07:00:00Z',23],['2026-11-01','2026-11-01T07:00:00Z','2026-11-02T08:00:00Z',25]]){
 const r=await request({from:day,to:day,day});assert.equal(r.statusCode,200);assert.equal(new Date(r.body.dayStart).toISOString(),new Date(start).toISOString());assert.equal((Date.parse(r.body.dayEnd)-Date.parse(r.body.dayStart))/3600000,hours);assert.equal(new Date(r.body.dayEnd).toISOString(),new Date(end).toISOString());}
 assert.equal(salesTimelineTime('2026-11-01T08:30:00Z'),'2026-11-01 01:30:00.000 PDT');assert.equal(salesTimelineTime('2026-11-01T09:30:00Z'),'2026-11-01 01:30:00.000 PST');
 const original=globalThis.fetch;globalThis.fetch=mock([record('different',{connection_id:'fixture-sales-app',telnyx_leg_id:'fixture-leg-call-001',telnyx_session_id:'fixture-session-call-001',started_at:'2026-11-10T19:00:00Z',finished_at:'2026-11-10T19:00:30Z'})]);process.env.SALES_TELNYX_API_KEY='independent-provider-clock';
 const independent=(await request(base)).body;assert.equal(independent.calls[0].startedAt,'2026-11-10T19:00:00.000000000Z');assert.equal(independent.coverage.gapsAvailable,false);assert.ok(independent.prior.every(r=>r.uncertain));
 globalThis.fetch=original;await providerFixture.fail();const failedResponse=await request(base);assert.equal(failedResponse.statusCode,503);assert.equal(failedResponse.body.error,'telnyx_records_unavailable');assert.ok(!('calls' in failedResponse.body));
} finally {providerFixture.restore();await fixture.close();}
// Interval math uses provider times, overlap frontier and no leading/trailing fill.
const c=(id,start,end,extra={})=>({id,operatorId:1,operatorName:'Rep',source:'telnyx',startedAt:`2026-11-10T${start}Z`,endedAt:end?`2026-11-10T${end}Z`:null,...extra});
const bars=[c('a','17:00:00','17:10:00'),c('nested','17:01:00','17:02:00'),c('b','17:15:00','17:16:00'),c('c','17:18:30','17:20:00')];
const chart=salesReportTimeline(bars,{...bounds,coverage:{gapsAvailable:true}},[{operatorId:1,endedAt:'2026-11-10T07:00:00Z'}]);assert.deepEqual(chart.lanes[0].gaps.map(g=>g.seconds),[300,150]);assert.ok(chart.windowStart>Date.parse(bounds.dayStart));
assert.equal(salesReportTimeline(bars,{...bounds,coverage:{gapsAvailable:false}}).lanes[0].gaps.length,0);
assert.equal(salesReportTimeline(bars.map(x=>({...x,operatorId:null})),bounds).lanes[0].gaps.length,0);
assert.equal(salesReportTimeline([c('unknown','17:00:00',null),...bars],bounds).lanes[0].gaps.length,0);
console.log('PASS provider adapter and timeline: bounded provider pagination/failures, exact identity/role joins, related-leg and missing coverage, provider-only times, admin/no-store,205 records, filters, Pacific/DST, interval frontiers, no fallback.');
