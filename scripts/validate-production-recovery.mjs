import { applySalesPaidCheckout } from '../pages/api/_lib/salesCheckout.js';
// Offline regressions: real SQL/migration and handlers, stubbed providers only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
let tail = Promise.resolve();
async function acquire() { const prior = tail; let unlock; tail = new Promise(r => { unlock = r; }); await prior; return unlock; }
async function query(sql, values) { const r = await db.query(sql, values); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }; }
const pool = {
  async query(sql, values) { const unlock = await acquire(); try { return await query(sql, values); } finally { unlock(); } },
  async connect() { const unlock = await acquire(); return { query, release: unlock }; }
};
const load = (file, names, deps = {}) => {
  if (file === 'pages/api/v1/stripe/webhook.js') deps = { applySalesPaidCheckout, ...deps };
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace(/export default /g, '').replace(/export /g, '');
  return new Function(...Object.keys(deps), `${source}\nreturn {${names.join(',')}};`)(...Object.values(deps));
};
const response = () => ({ statusCode: 200, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(body) { this.body = body; return this; } });
await db.exec(`
CREATE TABLE async_jobs(id bigserial PRIMARY KEY,job_type text,tenant_key text,dedupe_key text,payload_json jsonb,status text DEFAULT 'pending',attempts int DEFAULT 0,max_attempts int DEFAULT 5,available_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),locked_at timestamptz,locked_by text,completed_at timestamptz,last_error text);
CREATE UNIQUE INDEX job_dedupe ON async_jobs(job_type,dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE TABLE tenant_users(id bigserial PRIMARY KEY,tenant_key text,email text UNIQUE,status text,password_hash text,updated_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE auth_tokens(id bigserial PRIMARY KEY,token text UNIQUE,token_hash text,token_type text,user_id bigint,email text,tenant_key text,expires_at timestamptz,used_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE billing_events(id bigserial PRIMARY KEY,tenant_key text,stripe_event_id text UNIQUE,event_type text,payload_json jsonb,processed_at timestamptz,status text,error_message text);
CREATE TABLE tenants(tenant_key text PRIMARY KEY,name text,status text,data_region text,plan text,primary_number text,industry text,live_prompt_mode text,plan_code text,billing_status text,service_access_status text,app_access_status text,billing_lock_reason text,telnyx_voice_number text,telnyx_voice_number_id text,telnyx_voice_order_id text,telnyx_voice_status text,post_trial_access_ends_at timestamptz,deactivated_at timestamptz,billing_status_updated_at timestamptz);
CREATE TABLE tenant_billing_accounts(tenant_key text PRIMARY KEY,price_override_cycles_remaining int,stripe_customer_id text,stripe_subscription_id text,billing_interval text,pending_plan_code text,current_period_start timestamptz,current_period_end timestamptz,last_invoice_id text,updated_at timestamptz);
CREATE TABLE audit_log(tenant_key text,actor text,action text,details text);
INSERT INTO tenant_users(tenant_key,email,status,created_at) VALUES('legacy','valid@fixture.test','invited',now()-interval '1 day'),('legacy','replacement@fixture.test','invited',now()),('legacy','active@fixture.test','active',now()-interval '1 day');
INSERT INTO auth_tokens(token,token_type,tenant_key,email,expires_at,created_at) VALUES('legacy_valid','invite','legacy','valid@fixture.test',now()+interval '1 day',now()-interval '1 hour'),('legacy_stale','invite','legacy','replacement@fixture.test',now()+interval '1 day',now()-interval '1 hour'),('legacy_active','invite','legacy','active@fixture.test',now()+interval '1 day',now()-interval '1 hour');
`);
const migration = fs.readFileSync(new URL('../migrations/0051_production_recovery.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration); // additive rerun remains safe
assert.equal((await pool.query("SELECT user_id FROM auth_tokens WHERE token='legacy_valid'")).rows[0].user_id, 1);
assert.equal((await pool.query("SELECT * FROM auth_tokens WHERE token='legacy_stale'")).rowCount, 0);

const jobs = load('lib/asyncJobs.js', ['enqueueAsyncJob','claimAsyncJobs','completeAsyncJob','failAsyncJob','heartbeatAsyncJob','releaseAsyncJob'], { crypto });
const enqueued = await jobs.enqueueAsyncJob(pool, { jobType: 'test', maxAttempts: 2 });
const [first] = await jobs.claimAsyncJobs(pool, { workerId: 'a', limit: 1 });
assert.equal(first.id, enqueued.id);
assert.equal((await jobs.claimAsyncJobs(pool, { workerId: 'b' })).length, 0);
assert.equal(await jobs.heartbeatAsyncJob(pool, first.id, { claimToken: first.claim_token }), true);
assert.equal(await jobs.completeAsyncJob(pool, first.id), false);
await pool.query("UPDATE async_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [first.id]);
assert.equal(await jobs.heartbeatAsyncJob(pool, first.id, { claimToken: first.claim_token }), false);
const [second] = await jobs.claimAsyncJobs(pool, { workerId: 'b' });
assert.notEqual(first.claim_token, second.claim_token);
assert.equal(await jobs.completeAsyncJob(pool, first.id, { claimToken: first.claim_token }), false);
assert.equal(await jobs.failAsyncJob(pool, first.id, { claimToken: first.claim_token, errorMessage: 'stale' }), false);
await assert.rejects(pool.query("UPDATE async_jobs SET status='done',locked_at=NULL,locked_by=NULL WHERE id=$1", [first.id]), /async_job_claim_token_required/);
assert.equal((await pool.query('SELECT status,claim_token FROM async_jobs WHERE id=$1',[first.id])).rows[0].claim_token, second.claim_token);
assert.equal(await jobs.completeAsyncJob(pool, second.id, { claimToken: second.claim_token }), true);
await pool.query("INSERT INTO async_jobs(job_type,status,locked_at,locked_by) VALUES('test','running',now(),'legacy')");
assert.equal((await jobs.claimAsyncJobs(pool,{workerId:'b'})).length,0);
await pool.query("UPDATE async_jobs SET status='done',locked_at=NULL,locked_by=NULL WHERE locked_by='legacy'");
await pool.query("INSERT INTO async_jobs(job_type,status,locked_at,locked_by,attempts) VALUES('test','running',now()-interval '1 hour','legacy',1)");
const [legacyRecovered] = await jobs.claimAsyncJobs(pool,{workerId:'new'});
assert.ok(legacyRecovered.claim_token);
assert.equal(await jobs.releaseAsyncJob(pool,legacyRecovered.id,{claimToken:legacyRecovered.claim_token}),true);
assert.equal((await pool.query('SELECT attempts FROM async_jobs WHERE id=$1',[legacyRecovered.id])).rows[0].attempts,1);
await pool.query("UPDATE async_jobs SET status='running',claim_token='fixture-exhausted',attempts=max_attempts,lease_expires_at=now()-interval '1 second' WHERE id=$1",[legacyRecovered.id]);
await jobs.claimAsyncJobs(pool,{workerId:'new'});
assert.equal((await pool.query('SELECT status FROM async_jobs WHERE id=$1',[legacyRecovered.id])).rows[0].status,'dead_letter');
// A cleared live lease must retain a permanent fence against old SQL writers.
for (const transition of ['release', 'fail', 'complete']) {
  const job=await jobs.enqueueAsyncJob(pool,{jobType:`fence_${transition}`});
  const [claim]=await jobs.claimAsyncJobs(pool,{workerId:'fenced',jobTypes:[`fence_${transition}`]});
  if(transition==='release')await jobs.releaseAsyncJob(pool,job.id,{claimToken:claim.claim_token});
  if(transition==='fail')await jobs.failAsyncJob(pool,job.id,{claimToken:claim.claim_token,errorMessage:'retry'});
  if(transition==='complete')await jobs.completeAsyncJob(pool,job.id,{claimToken:claim.claim_token});
  const before=(await pool.query('SELECT status,claim_token FROM async_jobs WHERE id=$1',[job.id])).rows[0];
  assert.match(before.claim_token,/^retired:/);
  await assert.rejects(pool.query("UPDATE async_jobs SET status='done',locked_at=NULL,locked_by=NULL,completed_at=NOW(),last_error=NULL WHERE id=$1",[job.id]),/async_job_claim_token_required/);
  await assert.rejects(pool.query("UPDATE async_jobs SET status='pending',available_at=NOW()+interval '15 seconds',locked_at=NULL,locked_by=NULL,last_error='old failure' WHERE id=$1",[job.id]),/async_job_claim_token_required/);
  assert.deepEqual((await pool.query('SELECT status,claim_token FROM async_jobs WHERE id=$1',[job.id])).rows[0],before);
}
console.log('PASS async recovery, expiry, legacy fencing/grace, exhaustion, heartbeat and release');

const tokens = await import('../pages/api/_lib/authTokens.js');
let auditFails = false;
const invite = load('pages/api/v1/auth/accept-invite.js',['handler'], {
  bcrypt:{hash: async p => `hash:${p}`},getPool:()=>pool,ensureTables:async()=>{},findAuthToken:tokens.findAuthToken,
  writeAuditLog:async()=>{if(auditFails)throw Error('audit unavailable');},enforceRateLimit:async()=>null,getClientIp:()=> '127.0.0.1'
}).handler;
const accept = async token => { const r=response();await invite({method:'POST',body:{token,password:'password123'}},r);return r; };
async function invitee(email, tenant='a') {await pool.query("INSERT INTO tenant_users(tenant_key,email,status) VALUES($1,$2,'invited')",[tenant,email]);return tokens.issueAuthToken(pool,{tokenType:'invite',email,tenantKey:tenant,expiresAt:new Date(Date.now()+600000)});}
const stale=await invitee('stale@fixture.test');
await pool.query("DELETE FROM tenant_users WHERE email='stale@fixture.test'");
await pool.query("INSERT INTO tenant_users(tenant_key,email,status,password_hash) VALUES('b','stale@fixture.test','active','original')");
assert.equal((await accept(stale)).statusCode,400);
assert.equal((await pool.query("SELECT password_hash FROM tenant_users WHERE email='stale@fixture.test'")).rows[0].password_hash,'original');
const disabled=await invitee('disabled@fixture.test');await pool.query("UPDATE tenant_users SET status='disabled' WHERE email='disabled@fixture.test'");assert.equal((await accept(disabled)).statusCode,400);
const changed=await invitee('change@fixture.test');await pool.query("UPDATE tenant_users SET email='changed@fixture.test' WHERE email='change@fixture.test'");assert.equal((await accept(changed)).statusCode,400);
const old=await invitee('resend@fixture.test');const fresh=await tokens.issueAuthToken(pool,{tokenType:'invite',email:'resend@fixture.test',tenantKey:'a',expiresAt:new Date(Date.now()+600000)});assert.equal((await accept(old)).statusCode,400);
auditFails=true;assert.equal((await accept(fresh)).statusCode,500);assert.equal((await pool.query("SELECT status FROM tenant_users WHERE email='resend@fixture.test'")).rows[0].status,'invited');assert.ok(await tokens.findAuthToken(pool,fresh,{tokenType:'invite'}));
auditFails=false;const concurrent=await Promise.all([accept(fresh),accept(fresh)]);assert.deepEqual(concurrent.map(r=>r.statusCode).sort(),[200,400]);
assert.equal((await accept('legacy_valid')).statusCode,200);
assert.equal((await accept('legacy_active')).statusCode,200);
assert.equal((await pool.query("SELECT status FROM tenant_users WHERE email='active@fixture.test'")).rows[0].status,'active');
await pool.query("INSERT INTO tenant_users(tenant_key,email,status) VALUES('a','setup@fixture.test','active')");
let setupMail;
const inviteMail=load('pages/api/v1/tenant/users.js',['sendInviteEmail'],{
  crypto,getPool:()=>pool,issueAuthToken:tokens.issueAuthToken,
  sendTransactionalEmail:async message=>{setupMail=message;},
}).sendInviteEmail;
await inviteMail({tenantKey:'a',name:'Setup',email:'setup@fixture.test',role:'member',tokenType:'account_setup'});
const setupToken=decodeURIComponent(setupMail.text.match(/token=([^\s]+)/)[1]);
assert.equal((await accept(setupToken)).statusCode,200);
assert.equal((await accept(setupToken)).statusCode,400);
await assert.rejects(tokens.issueAuthToken(pool,{tokenType:'account_setup',email:'setup@fixture.test',tenantKey:'a',expiresAt:new Date(Date.now()+600000)}),/invitee_not_invited/);
await pool.query("INSERT INTO tenant_users(tenant_key,email,status) VALUES('a','setup_disabled@fixture.test','active')");
const setupDisabled=await tokens.issueAuthToken(pool,{tokenType:'account_setup',email:'setup_disabled@fixture.test',tenantKey:'a',expiresAt:new Date(Date.now()+600000)});
await pool.query("UPDATE tenant_users SET status='disabled' WHERE email='setup_disabled@fixture.test'");
assert.equal((await accept(setupDisabled)).statusCode,400);
console.log('PASS invite identity, legacy validity, replacement/disable/email revocation, reinvite, atomic rollback, replay and active no-password setup');

await pool.query("INSERT INTO tenants(tenant_key) VALUES('stripe')");
await pool.query("INSERT INTO tenant_billing_accounts(tenant_key,price_override_cycles_remaining) VALUES('stripe',3)");
let syncFails=true, syncCalls=0;
const stripe=load('pages/api/v1/stripe/webhook.js',['handler'],{
  readRawBody:async req=>req.event,constructWebhookEvent:event=>{if(event.bad)throw Error('bad signature');return event;},retrieveSubscription:async()=>({id:'sub',metadata:{tenant_key:'stripe'},status:'active'}),retrieveSubscriptionSchedule:async()=>{},ensureTables:async()=>{},getPool:()=>pool,
  syncTenantStripeSubscription:async client=>{syncCalls++;await client.query("UPDATE tenant_billing_accounts SET price_override_cycles_remaining=price_override_cycles_remaining-1 WHERE tenant_key='stripe'");if(syncFails)throw Error('transient');},syncTenantStripeSubscriptionSchedule:async()=>{},activatePendingCouponDiscountWindow:async()=>{}
}).handler;
const send=async(event, handler=stripe)=>{const r=response();await handler({method:'POST',headers:{},event},r);return r;};
const event={id:'evt_sub',type:'customer.subscription.updated',data:{object:{id:'sub',metadata:{tenant_key:'stripe'}}}};
assert.equal((await send(event)).statusCode,503);
assert.equal((await pool.query("SELECT status,processed_at FROM billing_events WHERE stripe_event_id='evt_sub'")).rows[0].status,'failed');
assert.equal((await pool.query("SELECT price_override_cycles_remaining FROM tenant_billing_accounts WHERE tenant_key='stripe'")).rows[0].price_override_cycles_remaining,3);
syncFails=false;assert.equal((await send(event)).statusCode,200);assert.equal((await send(event)).body.duplicate,true);assert.equal(syncCalls,2);
const invoice={id:'evt_invoice',type:'invoice.paid',data:{object:{id:'invoice_1',metadata:{tenant_key:'stripe'}}}};
// Fail after the decrement at the final processed marker. Retry must apply once.
let failMarker=true;
const faultPool={...pool,async connect(){const c=await pool.connect();return {...c,async query(sql,params){if(failMarker&&sql.includes("SET status = 'processed'")){failMarker=false;throw Error('final write failed');}return c.query(sql,params);}};}};
const invoiceHandler=load('pages/api/v1/stripe/webhook.js',['handler'],{readRawBody:async req=>req.event,constructWebhookEvent:e=>e,ensureTables:async()=>{},getPool:()=>faultPool}).handler;
assert.equal((await send(invoice,invoiceHandler)).statusCode,503);
assert.equal((await pool.query('SELECT * FROM billing_invoice_effects')).rowCount,0);
assert.equal((await send(invoice,invoiceHandler)).statusCode,200);
assert.equal((await send({...invoice,id:'evt_invoice_duplicate'},invoiceHandler)).statusCode,200);
assert.equal((await pool.query("SELECT price_override_cycles_remaining FROM tenant_billing_accounts WHERE tenant_key='stripe'")).rows[0].price_override_cycles_remaining,1);
assert.equal((await send({bad:true})).statusCode,400);
let timeoutEffects=0;
const timedOut=load('pages/api/v1/stripe/webhook.js',['handler'],{
  readRawBody:async req=>req.event,constructWebhookEvent:e=>e,getPool:()=>pool,ensureTables:async()=>{},
  retrieveSubscription:()=>new Promise(()=>{}),syncTenantStripeSubscription:async()=>{timeoutEffects++;},
  setTimeout:(fn,ms)=>{assert.equal(ms,10000);return setTimeout(fn,5);},clearTimeout
}).handler;
assert.equal((await send({...event,id:'evt_timeout'},timedOut)).statusCode,503);assert.equal(timeoutEffects,0);
assert.equal((await pool.query("SELECT status FROM billing_events WHERE stripe_event_id='evt_timeout'")).rows[0].status,'failed');
console.log('PASS Stripe failure retry, transactional effect rollback, processed replay, per-invoice dedupe, signature status');

const onboard=fs.readFileSync(new URL('../pages/api/v1/tenants/onboard.js',import.meta.url),'utf8');
const start=onboard.indexOf('      for (let attempt = 0; attempt < 50;');const end=onboard.indexOf('\n      await client.query(',start);
const allocate=new Function('client','payload','baseTenantKey',`return (async()=>{let tenantKey;${onboard.slice(start,end)} return tenantKey;})()`);
await pool.query("INSERT INTO tenants(tenant_key) VALUES('acme')");
async function signup(){const c=await pool.connect();try{await c.query('BEGIN');const key=await allocate(c,{businessName:'Acme',businessCategory:'test'},'acme');await c.query('SELECT 1');await c.query('COMMIT');return key;}finally{c.release();}}
assert.deepEqual(await Promise.all([signup(),signup()]),['acme_2','acme_3']);
console.log('PASS onboarding normalized-name collisions retain valid transaction and unique attempts');

await pool.query("INSERT INTO tenants(tenant_key,billing_status,post_trial_access_ends_at,telnyx_voice_number,telnyx_voice_number_id) VALUES('release_fail','trial_expired',now()-interval '2 days','+15555550001','one'),('release_ok','trial_expired',now()-interval '2 days','+15555550002','two'),('already_gone','trial_expired',now()-interval '2 days','+15555550003','three')");
const owned=new Map([['+15555550001','one'],['+15555550002','two']]);let failRelease=true, pendingRelease=false,releaseCalls=0, lookupFails=false;
const lifecycle=load('pages/api/_lib/billingLifecycle.js',['deactivateExpiredPostTrial'],{
  getOwnedPhoneNumber:async({phoneNumber})=>{if(lookupFails)throw Error('provider unavailable');return owned.has(phoneNumber)?{phoneNumberId:owned.get(phoneNumber)}:null;},
  releaseVoiceNumber:async({phoneNumber})=>{releaseCalls++;if(failRelease&&phoneNumber.endsWith('1'))throw Error('provider unavailable');if(!pendingRelease)owned.delete(phoneNumber);},recordBillingLifecycleEvent:async()=>{}
}).deactivateExpiredPostTrial;
assert.equal(await lifecycle(pool,new Date()),2);
let failed=(await pool.query("SELECT * FROM tenants WHERE tenant_key='release_fail'")).rows[0];assert.equal(failed.telnyx_voice_number_id,'one');assert.equal(failed.billing_status,'trial_expired');assert.equal(failed.telnyx_voice_status,'release_failed');
failRelease=false;pendingRelease=true;assert.equal(await lifecycle(pool,new Date()),0);failed=(await pool.query("SELECT * FROM tenants WHERE tenant_key='release_fail'")).rows[0];assert.equal(failed.telnyx_voice_status,'release_pending');assert.equal(failed.telnyx_voice_number_id,'one');
lookupFails=true;assert.equal(await lifecycle(pool,new Date()),0);assert.equal((await pool.query("SELECT telnyx_voice_number_id FROM tenants WHERE tenant_key='release_fail'")).rows[0].telnyx_voice_number_id,'one');
lookupFails=false;pendingRelease=false;assert.equal(await lifecycle(pool,new Date()),1);const calls=releaseCalls;assert.equal(await lifecycle(pool,new Date()),0);assert.equal(releaseCalls,calls);
await pool.query("INSERT INTO tenants(tenant_key,billing_status,post_trial_access_ends_at,telnyx_voice_number,telnyx_voice_number_id,service_access_status,app_access_status) VALUES('paid_during_release','trial_expired',now()-interval '2 days','+15555550004','four','disabled','billing_locked')");
owned.set('+15555550004','four');pendingRelease=true;
assert.equal(await lifecycle(pool,new Date()),0);
assert.equal((await pool.query("SELECT telnyx_release_status FROM tenants WHERE tenant_key='paid_during_release'")).rows[0].telnyx_release_status,'submitted');
// Exercise the actual subscription access update, including its returned audit state.
const billingSource=fs.readFileSync(new URL('../pages/api/_lib/billing.js',import.meta.url),'utf8');
const accessStart=billingSource.indexOf('  const updatedAccess = await pool.query(',billingSource.indexOf('export async function syncTenantStripeSubscription('));
const accessEnd=billingSource.indexOf('\n\n  if (',accessStart);
const activate=new Function('pool','tenantKey','mapped','shouldApplyPlanNow','appliedPlan',`return (async()=>{${billingSource.slice(accessStart,accessEnd)}return mapped;})()`);
const activatePaid=()=>activate(pool,'paid_during_release',{billingStatus:'active',serviceAccessStatus:'enabled',appAccessStatus:'enabled',billingLockReason:null},false,null);
const activated=await activatePaid();assert.equal(activated.serviceAccessStatus,'disabled');assert.equal(activated.billingLockReason,'voice_number_release_pending');
let paid=(await pool.query("SELECT * FROM tenants WHERE tenant_key='paid_during_release'")).rows[0];assert.equal(paid.billing_status,'active');assert.equal(paid.app_access_status,'enabled');assert.equal(paid.service_access_status,'disabled');
// The asynchronous deletion completes after successful payment.
owned.delete('+15555550004');assert.equal(await lifecycle(pool,new Date()),0);
paid=(await pool.query("SELECT * FROM tenants WHERE tenant_key='paid_during_release'")).rows[0];assert.equal(paid.billing_status,'active');assert.equal(paid.telnyx_voice_number,null);assert.equal(paid.telnyx_release_status,'released');assert.equal(paid.service_access_status,'disabled');assert.equal(paid.billing_lock_reason,'voice_number_replacement_required');
assert.equal((await activatePaid()).serviceAccessStatus,'disabled');
// An older activation writer also cannot bypass the persistent deletion guard.
await pool.query("UPDATE tenants SET service_access_status='enabled',billing_lock_reason=NULL WHERE tenant_key='paid_during_release'");
assert.equal((await pool.query("SELECT service_access_status FROM tenants WHERE tenant_key='paid_during_release'")).rows[0].service_access_status,'disabled');
let orders=0;
const reactivate=load('pages/api/v1/billing/reactivate.js',['handler'],{
  getPool:()=>pool,ensureTables:async()=>{},requireSession:async()=>({user_id:1}),requireTenantOwner:async()=>({id:1}),resolveTenantKey:()=>paid.tenant_key,
  ensureTenantBillingAccount:async()=>paid,findAvailableVoiceNumber:async()=>{orders++;throw Error('must not provision');},orderVoiceNumber:async()=>{orders++;}
}).handler;
const recoveryResponse=response();await reactivate({method:'POST',query:{}},recoveryResponse);assert.equal(recoveryResponse.statusCode,409);assert.equal(orders,0);
const alert=load('pages/api/v1/billing/index.js',['buildBillingAlert']).buildBillingAlert({row:paid});assert.match(alert.message,/Contact support to select/);
console.log('PASS post-trial typed SQL, independent cleanup, release retries, async pending, already-gone and lookup failure retention');
await db.close();
console.log('Production recovery offline regressions passed. PGlite serializes sessions; live PostgreSQL lock contention is a separate gate.');
