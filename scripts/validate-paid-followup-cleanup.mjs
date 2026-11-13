import assert from 'node:assert/strict';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {cleanupPaidProspect} from '../pages/api/_lib/paidProvisioning.js';
import {processSalesFollowupJobs} from '../pages/api/_lib/salesFollowupJobs.js';
const fixture=await createUpibTestFixture({label:'followupcleanup'}),{pool}=fixture;
const originalKey=process.env.SMARTLEAD_API_KEY;
process.env.SMARTLEAD_API_KEY='synthetic-provider-double-only';
try{
 await pool.query("INSERT INTO tenants(tenant_key,name,status) VALUES('paid_review','Paid review','active')");
 await pool.query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,status,contact_email,permission_granted,smartlead_lead_id,smartlead_campaign_id) VALUES('pending_actions','pending_actions','Review','+15035550111','queued','actions@example.test',TRUE,'456','321')");
 const terminals=['do_not_call','signup_completed','not_interested','wrong_number'];
 for(const outcome of [...terminals,'no_answer'])await pool.query('INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,outcome) VALUES($1,$2,$1)',[outcome,'pending_actions']);
 await pool.query("INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,outcome,status,attempts,locked_at,locked_by,provider_result_json) VALUES('unknown','pending_actions','do_not_call','reconciliation_required',1,NOW(),'original_worker',jsonb_build_object('providerId','unknown_456'))");
 const unknownBefore=(await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id='unknown'")).rows[0];
 await cleanupPaidProspect(pool,{tenant_key:'paid_review',prospect_id:'pending_actions',purchase_id:'synthetic_paid'});
 const statuses=(await pool.query('SELECT outcome,status FROM sales_followup_jobs')).rows;
 assert.equal(statuses.find(j=>j.outcome==='no_answer').status,'canceled');
 for(const outcome of terminals)assert.equal(statuses.find(j=>j.outcome===outcome).status,'queued');
 const requests=[];const fetchImpl=async(url,options)=>{requests.push({url:String(url),method:options.method});return new Response(JSON.stringify({ok:true}),{status:200});};
 const done=await processSalesFollowupJobs(pool,{workerId:'terminal_worker',limit:10,fetchImpl});
 assert.equal(done.claimedCount,4);assert(done.results.every(r=>r.ok));assert.equal(requests.length,4);
 assert.equal(requests.filter(r=>/\/leads\/456\/unsubscribe\?/.test(r.url)).length,1);
 assert.equal(requests.filter(r=>/\/campaigns\/321\/leads\/456\/pause\?/.test(r.url)).length,3);
 assert.deepEqual((await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id='unknown'")).rows[0],unknownBefore);
 await processSalesFollowupJobs(pool,{workerId:'replay',limit:10,fetchImpl});assert.equal(requests.length,4);
 console.log('PASS paid conversion cancels only never-attempted outreach; unsubscribe/pause actions complete; unknown provider receipts and no-replay fences remain');
 // Let an old worker claim the outreach job, then convert before it obtains the
 // provider-attempt prospect lock. The stale claim must never send or pretend
 // that a previous unknown attempt was merely suppressed.
 await pool.query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,status,contact_email,permission_granted) VALUES('race','race','Race','+15035550112','queued','race@example.test',TRUE)");
 await pool.query("INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,outcome) VALUES('old_claim','race','no_answer')");
 let claimed,release;const didClaim=new Promise(r=>{claimed=r;}),proceed=new Promise(r=>{release=r;});let connections=0,providerEffects=0;
 const delayedPool={query:pool.query.bind(pool),connect:async()=>{connections++;if(connections===2){claimed();await proceed;}return pool.connect();}};
 const oldWorker=processSalesFollowupJobs(delayedPool,{workerId:'old_worker',route:async()=>{providerEffects++;return{ok:true,routed:true};}});
 await didClaim;await cleanupPaidProspect(pool,{tenant_key:'paid_review',prospect_id:'race',purchase_id:'synthetic_race'});release();await oldWorker;
 const old=(await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id='old_claim'")).rows[0];
 assert.equal(providerEffects,0);assert.equal(old.status,'reconciliation_required');assert.equal(old.attempts,1);assert.equal(old.locked_by,'old_worker');assert(old.locked_at);assert.deepEqual(old.provider_result_json,{});
 await processSalesFollowupJobs(pool,{workerId:'new_worker',route:async()=>{providerEffects++;return{ok:true,routed:true};}});assert.equal(providerEffects,0);
 await pool.query("INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,outcome,status,attempts,provider_result_json) VALUES('legacy_receipt','pending_actions','do_not_call','queued',0,jsonb_build_object('providerId','accepted_legacy'))");
 const receiptBefore=(await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id='legacy_receipt'")).rows[0];
 await processSalesFollowupJobs(pool,{workerId:'receipt_worker',route:async()=>{providerEffects++;return{ok:true,suppressed:true};}});assert.equal(providerEffects,0);
 assert.deepEqual((await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id='legacy_receipt'")).rows[0],receiptBefore);

 console.log('PASS already-claimed worker observes paid conversion before provider I/O and preserves the attempt for reconciliation');
}finally{if(originalKey===undefined)delete process.env.SMARTLEAD_API_KEY;else process.env.SMARTLEAD_API_KEY=originalKey;await fixture.close();}
