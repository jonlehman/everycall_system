import assert from 'node:assert/strict';
import { createSalesReportFixture, seedSalesTimelineFixture } from './lib/sales-report-fixture.mjs';
import { salesReportTimeline, salesTimelineTime } from '../lib/salesReportTimeline.js';
import handler from '../pages/api/v1/admin/sales/reports.js';

const fixture = await createSalesReportFixture();
process.env.DATABASE_URL = 'postgres://report-timeline-fixture';
globalThis.__everycallPool = fixture.pool;
async function request(query = {}, cookie = 'everycall_session=report-admin') {
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'GET', query: { view: 'timeline', ...query }, headers: { cookie } }, res);
  return res;
}
const base = { from: '2026-11-10', to: '2026-11-13', day: '2026-11-10' };
try {
  await fixture.query("SET TIME ZONE 'America/Los_Angeles'");
  for (const cookie of ['', 'everycall_sales_session=report-sales', 'everycall_session=report-sales']) assert.notEqual((await request(base,cookie)).statusCode,200);
  const full = await request(base);
  assert.equal(full.statusCode,200);assert.equal(full.headers['Cache-Control'],'private, no-store');
  assert.equal(full.body.calls.length,205);assert.ok(!JSON.stringify(full.body).includes('SECRET_'));
  assert.deepEqual((await request({...base,cursor:'nonsense',limit:'1'})).body.calls,full.body.calls);
  assert.equal((await request({...base,operator:'1',outcome:'demo_completed',direction:'outbound',state:'closed',search:'Original Contact'})).body.calls.length,102);
  assert.equal((await request({...base,mode:'test'})).body.calls.length,0);
  assert.equal((await request({...base,day:'2026-11-13',mode:'test'})).body.calls[0].id,'test-call');
  assert.equal((await request({...base,day:'2026-11-11',direction:'inbound'})).body.calls[0].id,'micro-a');
  assert.equal((await request({...base,search:'%'})).body.calls.length,0);
  const empty=await request({...base,day:'2026-11-13'});assert.equal(empty.body.calls.length,0);assert.equal(empty.body.day,'2026-11-13');
  for (const day of [['2026-11-10'],'2026-02-30','2026-11-14','not-a-day']) assert.equal((await request({...base,day})).statusCode,400);
  assert.equal((await request({...base,view:['timeline']})).statusCode,400);
  const history=await request({range:'all'});assert.equal(history.body.from,'2023-01-01');assert.equal(history.body.to,'2026-11-12');assert.equal(history.body.day,'2026-11-12');
  assert.equal((await request({range:'all',day:'2023-01-02'})).body.calls.length,0);
  assert.equal((await request({range:'all',search:'absent'})).body.day,null);
  assert.equal((await request({range:'all',search:'absent',day:'2023-01-01'})).statusCode,400);
  await seedSalesTimelineFixture(fixture.query);
  const range={from:'2024-02-01',to:'2024-02-03'};
  const first=(await request({...range,day:'2024-02-01'})).body;
  const chart=salesReportTimeline(first.calls,first,first.prior);
  const alex=chart.lanes.find(lane=>lane.key==='1');
  assert.deepEqual(alex.gaps.map(gap=>[gap.seconds,gap.long]),[[300,true],[150,false]]);
  assert.equal(alex.uncertain,true); // no gap is invented after the unclosed call
  assert.equal(chart.lanes.find(lane=>lane.key==='unassigned').gaps.length,0);
  assert.equal(chart.lanes.find(lane=>lane.key==='3').calls[0].valid,false);
  const second=(await request({...range,day:'2024-02-02'})).body;
  assert.equal(second.calls.length,2);
  const jordan=salesReportTimeline(second.calls,second,second.prior).lanes[0];
  assert.equal(jordan.calls[0].clippedStart,Date.parse('2024-02-02T00:00:00-08:00'));
  assert.deepEqual(jordan.gaps.map(gap=>gap.seconds),[300]);
  assert.ok(second.prior.find(row=>row.operatorId===1).uncertain);
  const singleDay=(await request({from:'2024-02-02',to:'2024-02-02',day:'2024-02-02'})).body;
  assert.equal(singleDay.calls.length,2); // crossing session was created before the applied range
  assert.equal(singleDay.calls[0].id,'timeline-midnight');
  assert.ok(singleDay.prior.find(row=>row.operatorId===1).uncertain); // earlier missing end still suppresses false gaps
  await fixture.query("UPDATE sales_call_sessions SET state='completed', updated_at='2024-02-01T10:06:00-08:00' WHERE sales_call_id='timeline-unknown'");
  const closedBeforeDay=(await request({from:'2024-02-02',to:'2024-02-02'})).body;
  assert.equal(closedBeforeDay.prior.find(row=>row.operatorId===1).uncertain,false); // a persisted closed-state bound clears prior uncertainty without inventing duration
  assert.equal((await request({...range,day:'2024-02-03'})).body.calls.length,0);
  const point={id:'invalid',operatorId:1,operatorName:'Rep',createdAt:'2024-02-01T08:00:00Z',startedAt:'invalid',endedAt:null};
  const invalid=salesReportTimeline([point],first).lanes[0];
  assert.equal(invalid.calls[0].valid,false);assert.equal(invalid.calls[0].startSource,'Created (start not recorded)');assert.equal(invalid.gaps.length,0);
  // Neither yesterday's nor a stale historical ending can invent a leading gap.
  for (const endedAt of ['2024-02-01T07:58:00Z','2024-01-20T20:00:00Z']) {
    const clipped=salesReportTimeline([{...point,id:'valid',startedAt:'2024-02-01T17:07:00Z',endedAt:'2024-02-01T17:09:00Z'}],first,[{operatorId:1,endedAt,uncertain:false}]);
    assert.equal(clipped.lanes[0].gaps.length,0);
    assert.ok(clipped.windowStart > Date.parse(first.dayStart));
  }
  // The database is authoritative for named-zone boundaries, independent of its session timezone.
  await fixture.query("SET TIME ZONE 'Asia/Tokyo'");
  for (const [day,start,end,hours] of [
    ['2026-01-15','2026-01-15T08:00:00Z','2026-01-16T08:00:00Z',24],
    ['2026-07-15','2026-07-15T07:00:00Z','2026-07-16T07:00:00Z',24],
    ['2026-03-08','2026-03-08T08:00:00Z','2026-03-09T07:00:00Z',23],
    ['2026-11-01','2026-11-01T07:00:00Z','2026-11-02T08:00:00Z',25],
  ]) {
    const response=await request({from:day,to:day,day});assert.equal(response.statusCode,200);
    assert.equal(new Date(response.body.dayStart).toISOString(),new Date(start).toISOString());
    assert.equal(new Date(response.body.dayEnd).toISOString(),new Date(end).toISOString());
    assert.equal((Date.parse(response.body.dayEnd)-Date.parse(response.body.dayStart))/3600000,hours);
    assert.equal(response.body.timeZone,'America/Los_Angeles');
  }
  assert.equal(salesTimelineTime('2026-11-01T08:30:00Z'),'2026-11-01 01:30:00.000 PDT');
  assert.equal(salesTimelineTime('2026-11-01T09:30:00Z'),'2026-11-01 01:30:00.000 PST');
  assert.equal(salesTimelineTime('2026-03-08T10:00:00Z',false),'03:00:00 PDT');
  await fixture.query(`INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,created_at,started_at,ended_at) VALUES
    ('pacific-before','fixture-company',2,'closed','2026-07-15T06:59:00Z','2026-07-15T06:59:00Z','2026-07-15T06:59:59Z'),
    ('pacific-midnight','fixture-company',2,'closed','2026-07-15T07:00:00Z','2026-07-15T07:00:00Z','2026-07-15T07:01:00Z'),
    ('pacific-late','fixture-company',2,'closed','2026-07-16T06:50:00Z','2026-07-16T06:50:00Z','2026-07-16T06:55:00Z'),
    ('pacific-next','fixture-company',2,'closed','2026-07-16T07:00:00Z','2026-07-16T07:00:00Z','2026-07-16T07:01:00Z')`);
  const pacificDay=(await request({from:'2026-07-15',to:'2026-07-15',day:'2026-07-15',search:'pacific-'})).body;
  assert.deepEqual(pacificDay.calls.map(call=>call.id),['pacific-midnight','pacific-late']);
  const longGap=salesReportTimeline(pacificDay.calls,pacificDay,pacificDay.prior).lanes[0].gaps;
  assert.equal(longGap.length,1);assert.equal(longGap[0].seconds,23*3600+49*60); // real internal long gaps remain whole
  const pacificHistory=(await request({range:'all',search:'pacific-before'})).body;
  assert.equal(pacificHistory.from,'2026-07-14');assert.equal(pacificHistory.to,'2026-07-14');assert.equal(pacificHistory.day,'2026-07-14');
  await fixture.query(`INSERT INTO sales_call_sessions(sales_call_id,prospect_id,state,created_at)
    SELECT 'day-limit-'||value,'fixture-company','closed','2026-11-13T12:00:00Z'::timestamptz FROM generate_series(1,10001) value`);
  const tooLarge=await request({...base,day:'2026-11-13'});assert.equal(tooLarge.statusCode,400);assert.equal(tooLarge.body.error,'report_day_too_large');
  console.log('PASS daily Sales timeline: actual handler/admin scope, full filtered day, all-time bounds, empty days, Pacific midnight/DST bounds and PST/PDT timestamps, no leading gaps, rep/overlap frontiers, exact 5m and small gaps, unknown timing, 10,000-row refusal');
} finally { await fixture.close(); }
