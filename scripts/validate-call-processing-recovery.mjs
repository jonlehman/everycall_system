// Isolated real PostgreSQL + offline provider faults. Never reads DATABASE_URL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import ts from 'typescript';
import { processInboundVoiceWebhook, recoverInboundVoiceWebhooks } from '../packages/contracts/dist/providerWebhookIdempotency.js';
import { runSessionShutdown } from '../apps/call-gateway/dist/apps/call-gateway/src/sessionShutdown.js';
import { createSalesCallSession, expireUnstartedSalesCalls, getSalesProspect, listSalesProspects, recordSalesCallOutcome, updateSalesCallSession } from '../pages/api/_lib/salesRepository.js';

const target = process.env.EVERYCALL_TEST_POSTGRES_URL;
assert.ok(target, 'Set EVERYCALL_TEST_POSTGRES_URL to an isolated loopback PostgreSQL instance');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(target).hostname));
const schema = `call_recovery_${crypto.randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString: target, max: 1 });
const pool = new pg.Pool({ connectionString: target, max: 12, options: `-c search_path=${schema}` });
const read = file => fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return { promise, resolve }; };
const event = id => ({ eventId: id, eventType: 'call.initiated', rawPayload: `{"id":"${id}"}`, resourceId: `call-${id}` });
function compiled(source, names, deps) {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(deps), `${js}\nreturn {${names.join(',')}};`)(...Object.values(deps));
}
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE admin_users(id BIGSERIAL PRIMARY KEY);
    CREATE TABLE inbound_webhook_events(id BIGSERIAL PRIMARY KEY, provider TEXT NOT NULL, event_id TEXT NOT NULL,
      event_type TEXT, payload_hash TEXT, first_received_at TIMESTAMPTZ DEFAULT NOW(), last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      duplicate_count INTEGER NOT NULL DEFAULT 0, UNIQUE(provider,event_id));`);
  await pool.query(`CREATE TABLE tenants(tenant_key TEXT PRIMARY KEY,service_access_status TEXT,billing_lock_reason TEXT);
    CREATE TABLE tenant_active_knowledge_builds(tenant_key TEXT,active_build_id TEXT);
    CREATE TABLE knowledge_builds(build_id TEXT,tenant_key TEXT,status TEXT);`);
  await pool.query(await read('migrations/0032_outbound_sales_demo.sql'));
  await pool.query(await read('migrations/0054_call_processing_recovery.sql'));
  await pool.query(await read('migrations/0054_call_processing_recovery.sql'));
  await pool.query(await read('migrations/0056_sales_dialer_v2.sql'));

  let attempts=0;
  await assert.rejects(processInboundVoiceWebhook(pool,event('failed'),async () => { attempts++; throw Error('database fault'); }),/database fault/);
  await processInboundVoiceWebhook(pool,event('failed'),async () => { attempts++; });
  await processInboundVoiceWebhook(pool,event('failed'),async () => { attempts++; });
  assert.equal(attempts,2,'Failed work retries; completed redelivery does not run');
  const entered=deferred(), release=deferred();
  const running=processInboundVoiceWebhook(pool,event('busy'),async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  assert.equal(await processInboundVoiceWebhook(pool,event('busy'),async () => assert.fail('Duplicate ran')), 'busy');
  release.resolve(); await running;
  await assert.rejects(processInboundVoiceWebhook(pool,{...event('busy'),rawPayload:'different'},async()=>{}),/payload_conflict/);

  let sends=0;
  const commands=[];
  const rateLimited=ctx=>ctx.command('answer',async id=>{commands.push(id); if (++sends===1) throw Object.assign(Error('429'),{status:429});},async()=>false);
  await assert.rejects(processInboundVoiceWebhook(pool,event('429'),rateLimited));
  await processInboundVoiceWebhook(pool,event('429'),rateLimited);
  assert.equal(sends,2); assert.equal(commands[0],commands[1]);
  let effects=0, observed=false;
  const ambiguous=ctx=>ctx.command('answer',async()=>{effects++; throw Error('response lost');},async()=>observed);
  await assert.rejects(processInboundVoiceWebhook(pool,event('ambiguous'),ambiguous),/response lost/);
  await assert.rejects(processInboundVoiceWebhook(pool,event('ambiguous'),ambiguous),/reconciliation_required/);
  observed=true; await processInboundVoiceWebhook(pool,event('ambiguous'),ambiguous);
  assert.equal(effects,1,'Ambiguous external command must not be replayed');
  const staleEntered=deferred(), staleRelease=deferred();
  const stale=processInboundVoiceWebhook(pool,event('stale'),async ctx=>{staleEntered.resolve();await staleRelease.promise;await ctx.command('answer',async()=>assert.fail('Expired owner sent command'),async()=>false);});
  const staleCheck=assert.rejects(stale,/lease_lost/);
  await staleEntered.promise;
  await pool.query("UPDATE inbound_webhook_events SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE event_id='stale'");
  await processInboundVoiceWebhook(pool,event('stale'),async()=>{});
  staleRelease.resolve(); await staleCheck;
  assert.equal((await pool.query("SELECT processing_status FROM inbound_webhook_events WHERE event_id='stale'")).rows[0].processing_status,'completed');
  let checkpointFault=true, checkpointEffects=0;
  const faultPool={query:async(sql,params)=>{
    if(checkpointFault && /SET checkpoints/.test(sql) && params[3]?.includes('"completed"')) {checkpointFault=false;throw Error('checkpoint write failed');}
    return pool.query(sql,params);
  }};
  const checkpointHandler=ctx=>ctx.command('answer',async()=>{checkpointEffects++;},async()=>true);
  await assert.rejects(processInboundVoiceWebhook(faultPool,event('checkpoint'),checkpointHandler),/checkpoint write failed/);
  await processInboundVoiceWebhook(pool,event('checkpoint'),checkpointHandler);
  assert.equal(checkpointEffects,1,'Successful effect with failed checkpoint must reconcile instead of repeat');
  await assert.rejects(processInboundVoiceWebhook(pool,event('recovery-loop'),async()=>{throw Error('process crashed');}));
  assert.equal((await recoverInboundVoiceWebhooks(pool,async()=>assert.fail('Backoff ignored'))).length,0);
  await pool.query("UPDATE inbound_webhook_events SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE event_id='recovery-loop'");
  let recovered=0;
  const recovery=await recoverInboundVoiceWebhooks(pool,async raw=>{
    assert.equal(raw,event('recovery-loop').rawPayload);recovered++;
    return processInboundVoiceWebhook(pool,event('recovery-loop'),async()=>{});
  });
  assert.equal(recovery[0].status,'fulfilled');assert.equal(recovered,1);
  assert.equal((await pool.query("SELECT raw_payload FROM inbound_webhook_events WHERE event_id='recovery-loop'")).rows[0].raw_payload,null);
  console.log('PASS voice failure/replay, concurrent busy delivery, payload conflict, status-specific retry, ambiguous command reconciliation and expired-owner fencing');

  // Execute the production endCallSession body, with offline persistence/provider dependencies.
  const server=await read('apps/call-gateway/src/server.ts');
  const closeSource=server.slice(server.indexOf('async function endCallSession('),server.indexOf('\nasync function flushFinalAudioAndEnd'));
  let persistFailures=1, hangups=0, hangupFailures=0, socketCloses=0, completed=0;
  const sessions=new Map(), streamIds=new Map();
  const {endCallSession}=compiled(closeSource,['endCallSession'],{
    runSessionShutdown, WebSocket:{OPEN:1,CONNECTING:0},crypto,pool,
    persistCallUsage:async()=>{},persistKnowledgeCallState:async()=>{if(persistFailures-->0)throw Error('db unavailable');},
    finalizeCallSummary:async()=>{},telnyxCallIsAlive:async()=>true,telnyxCallAction:async()=>{hangups++;if(hangupFailures-->0)throw Error('provider unavailable');},
    streamSessions:sessions,streamIdToCall:streamIds,markCallCompleted:async()=>{completed++;},logInfo:()=>{},logError:()=>{}
  });
  const session={callControlId:'cleanup',callSid:'cleanup',tenantKey:'test',knowledgeCallState:{},telnyxStreamId:'stream',
    openAiWs:{readyState:1,close(){socketCloses++;}},telnyxWs:{readyState:1,close(){socketCloses++;}}};
  sessions.set('cleanup',session);streamIds.set('stream','cleanup');
  assert.equal(await endCallSession(session,'test',true),false);
  assert.equal(hangups,1); assert.equal(socketCloses,2);assert.equal(completed,0);
  assert.equal(streamIds.size,0);assert.ok(sessions.has('cleanup'),'Failed persistence remains retryable');
  await Promise.all([endCallSession(session,'duplicate',true),endCallSession(session,'duplicate',true)]);
  assert.equal(hangups,1);assert.equal(socketCloses,2);assert.equal(completed,1);assert.equal(sessions.size,0);
  const failedHangup={callControlId:'hangup-retry',callSid:'hangup-retry',tenantKey:'test'};
  hangupFailures=1;sessions.set('hangup-retry',failedHangup);
  assert.equal(await endCallSession(failedHangup,'test',true),false);assert.equal(hangups,2);
  assert.equal(await endCallSession(failedHangup,'duplicate',true),true);assert.equal(hangups,3);
  assert.equal(sessions.size,0);assert.equal(completed,2,'Hangup retry must not repeat completed persistence');
  console.log('PASS production shutdown persists failure without blocking provider hangup/socket cleanup; duplicate close retries only failed steps');

  // Execute the actual Express handler. A durable-processing failure must produce
  // retryable HTTP 503; signature rejection must precede the claim.
  let handler, verified=true, completeFailure=true;
  const route=server.slice(server.indexOf('async function processVerifiedVoiceWebhook('),server.indexOf('\napp.get("/healthz"'));
  compiled(route,[],{app:{post(_path,_middleware,callback){handler=callback;}},express:{raw:()=>()=>{}},Buffer,
    logInfo:()=>{},logError:()=>{},signatureRequired:true,verifyTelnyx:()=>verified,pool,
    parseTransferLegClientState:()=>null,processInboundVoiceWebhook,streamSessions:new Map(),buildBaseUrl:()=>'https://gateway.example',
    markCallCompleted:async()=>{if(completeFailure)throw Error('write unavailable');},telnyxCallIsAlive:async()=>false
  });
  const send=async(customPayload)=>{const res={statusCode:200,status(code){this.statusCode=code;return this;},send(body){this.body=body;return this;}};
    await handler({body:Buffer.from(JSON.stringify(customPayload || {data:{id:'http-hangup',event_type:'call.hangup',payload:{call_control_id:'http-call'}}})),header:()=>'',path:'/test'},res);return res;};
  verified=false;assert.equal((await send()).statusCode,401);
  assert.equal((await pool.query("SELECT id FROM inbound_webhook_events WHERE event_id='http-hangup'")).rowCount,0);
  verified=true;assert.equal((await send()).statusCode,503);
  completeFailure=false;assert.equal((await send()).statusCode,200);assert.equal((await send()).statusCode,200);
  const oldInitiation={data:{id:'old-initiation',event_type:'call.initiated',payload:{call_control_id:'ended-call'}}};
  await assert.rejects(processInboundVoiceWebhook(pool,{eventId:'old-initiation',eventType:'call.initiated',resourceId:'ended-call',rawPayload:JSON.stringify(oldInitiation)},async()=>{throw Error('crashed before effects');}));
  assert.equal((await send(oldInitiation)).statusCode,200,'Recovered dead call must complete without answer, prompt lookup, or streaming');
  console.log('PASS actual voice route rejects unsigned requests and retries failed hangup persistence before ACK');

  process.env.SALES_CALL_WINDOW_START_LOCAL='00:00';process.env.SALES_CALL_WINDOW_END_LOCAL='00:00';
  await pool.query('INSERT INTO admin_users(id) VALUES(1),(2),(3),(4),(5),(6),(7),(8)');
  await pool.query(`INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,timezone,permission_granted)
    VALUES('prospect','fixture','Fixture','+12065550101','UTC',TRUE);
    INSERT INTO sales_demo_profiles(demo_profile_id,prospect_id,status,expires_at,demo_bundle_json)
    VALUES('demo','prospect','ready',NOW()+INTERVAL '1 day','{}');`);
  const races=await Promise.allSettled(Array.from({length:8},(_,i)=>createSalesCallSession(pool,{prospectId:'prospect',adminUserId:i+1,idempotencyKey:`race-${i}`})));
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  for(const result of races.filter(r=>r.status==='rejected'))assert.ok(['prospect_reserved','prospect_forbidden'].includes(result.reason.code), result.reason.message);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM sales_call_sessions WHERE prospect_id='prospect'")).rows[0].count,1);
  let winner=races.find(r=>r.status==='fulfilled').value;
  const ownerId=winner.adminUserId;
  const otherId=ownerId===8?7:8;
  const replay=await createSalesCallSession(pool,{prospectId:'prospect',adminUserId:winner.adminUserId,idempotencyKey:winner.idempotencyKey});
  assert.equal(replay.salesCallId,winner.salesCallId);
  assert.equal((await listSalesProspects(pool,{eligibleOnly:true})).prospects.length,0);
  assert.equal((await getSalesProspect(pool,'prospect')).activeSalesCallId,winner.salesCallId);
  await updateSalesCallSession(pool,winner.salesCallId,{state:'failed'});
  winner=await createSalesCallSession(pool,{prospectId:'prospect',adminUserId:ownerId});
  await pool.query("UPDATE sales_call_sessions SET created_at=NOW()-INTERVAL '11 minutes' WHERE sales_call_id=$1",[winner.salesCallId]);
  await expireUnstartedSalesCalls(pool,'prospect');
  winner=await createSalesCallSession(pool,{prospectId:'prospect',adminUserId:ownerId});
  await updateSalesCallSession(pool,winner.salesCallId,{state:'preparing_call',operatorCallControlId:'provider-leg'});
  await pool.query("UPDATE sales_call_sessions SET created_at=NOW()-INTERVAL '1 day' WHERE sales_call_id=$1",[winner.salesCallId]);
  await expireUnstartedSalesCalls(pool,'prospect');
  await assert.rejects(createSalesCallSession(pool,{prospectId:'prospect',adminUserId:ownerId}),e=>e.code==='prospect_reserved');
  await assert.rejects(recordSalesCallOutcome(pool,{salesCallId:winner.salesCallId,outcome:'no_answer'}),e=>e.code==='sales_call_end_required');
  await updateSalesCallSession(pool,winner.salesCallId,{state:'ended'});
  const next=await createSalesCallSession(pool,{prospectId:'prospect',adminUserId:ownerId});
  await assert.rejects(recordSalesCallOutcome(pool,{salesCallId:next.salesCallId,outcome:'no_answer'}),e=>e.code==='sales_call_end_required');
  await updateSalesCallSession(pool,next.salesCallId,{state:'ended'});
  await recordSalesCallOutcome(pool,{salesCallId:next.salesCallId,outcome:'no_answer'});
  assert.equal((await getSalesProspect(pool,'prospect')).activeSalesCallId,null);
  // Production action authorization: admins can end an orphaned call, while
  // Sales users and non-recovery actions remain bound to the owning operator.
  const {assertSalesCallAdmin}=await import('../pages/api/_lib/salesCallView.js');
  const {salesError,getSalesCallSession}=await import('../pages/api/_lib/salesRepository.js');
  const stripImports=source=>source.replace(/^import[\s\S]*?;\n/gm,'').replace(/export default /g,'').replace(/export /g,'');
  let context, providerEnds=0; const audit=[];
  const actions=compiled(stripImports(await read('pages/api/v1/admin/sales/calls/[salesCallId]/actions.js')),['handler'],{
    getSalesCallSession,assertSalesCallAdmin,salesError,requireSalesAdmin:async()=>context,salesRequestBody:req=>req.body,
    sendSalesApiError:(res,error)=>res.status(error.status||error.statusCode||500).json({error:error.code}),
    runSalesAdminMutation:async(_req,_context,options,run)=>{audit.push(options.auditDetails);return run();},
    sendSalesCallAction:async id=>{providerEnds++;await updateSalesCallSession(pool,id,{state:'ended'});},
    buildSalesCallView:async(_pool,call)=>call
  }).handler;
  const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},setHeader(){}});
  const actionRequest={method:'POST',query:{salesCallId:winner.salesCallId},body:{action:'end_call'}};
  context={pool,admin:{id:otherId},session:{role:'sales'}};
  let result=response();await actions(actionRequest,result);assert.equal(result.statusCode,403);assert.equal(providerEnds,0);
  context={pool,admin:{id:otherId},session:{role:'admin'}};
  result=response();await actions({...actionRequest,body:{action:'start_demo'}},result);assert.equal(result.statusCode,403);
  result=response();await actions(actionRequest,result);assert.equal(result.statusCode,200);assert.equal(providerEnds,1);assert.equal(audit.at(-1).adminRecovery,true);
  console.log('PASS audited admin-only orphan end_call recovery; cross-operator sales controls and admin non-recovery controls stay denied');

  // Actual manual retry SQL must rotate a retired token and may not supersede
  // running or delivered jobs. Reuse the production fencing trigger verbatim.
  await pool.query(`CREATE TABLE async_jobs(id BIGSERIAL PRIMARY KEY,tenant_key TEXT,job_type TEXT,status TEXT,
    attempts INT DEFAULT 1,available_at TIMESTAMPTZ,locked_at TIMESTAMPTZ,locked_by TEXT,
    completed_at TIMESTAMPTZ,last_error TEXT,updated_at TIMESTAMPTZ,claim_token TEXT,lease_expires_at TIMESTAMPTZ);
    CREATE TABLE audit_log(tenant_key TEXT,actor TEXT,action TEXT,details JSONB);`);
  const recoveryMigration=await read('migrations/0051_production_recovery.sql');
  const fence=recoveryMigration.slice(recoveryMigration.indexOf('CREATE OR REPLACE FUNCTION fence_async_job_legacy_writes()'),recoveryMigration.indexOf('-- Durable deletion intent'));
  await pool.query(fence);
  for(const status of ['dead_letter','running','pending','done'])await pool.query('INSERT INTO async_jobs(status,claim_token) VALUES($1,$2)',[status,'retired:old']);
  const monitor=compiled(stripImports(await read('pages/api/v1/admin/monitoring.js')),['handler'],{
    crypto,ensureTables:async()=>{},getPool:()=>pool,requireSession:async()=>({role:'admin',user_id:8}),getAdminActor:async()=>({id:8})
  }).handler;
  for(const id of [1,2,3,4,999]) {
    const res=response();await monitor({method:'POST',body:{action:'retry_async_job',jobId:id}},res);
    assert.equal(res.statusCode,id===1?200:id===999?404:409);
  }
  const retried=(await pool.query('SELECT * FROM async_jobs WHERE id=1')).rows[0];
  assert.equal(retried.status,'pending');assert.match(retried.claim_token,/^retired:manual:/);assert.notEqual(retried.claim_token,'retired:old');
  assert.equal((await pool.query('SELECT * FROM audit_log')).rowCount,1);
  console.log('PASS production monitoring retry rotates fenced token, audits retry, and rejects running/pending/done jobs');
  console.log('PASS 8-operator real SQL race, idempotent creation, queue reservation visibility, failed/terminal/outcome release, safe browser expiry, ambiguous provider reservation retention');
} finally {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
