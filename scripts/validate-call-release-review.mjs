// Regression cases from the independent recovery/call release review. All
// provider effects are offline; SQL is limited to an isolated loopback schema.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import ts from 'typescript';
import { createPostgresSalesGatewayRepository } from '../apps/sales-call-gateway/dist/apps/sales-call-gateway/src/repository.js';
import { createSalesCallOrchestrator } from '../apps/sales-call-gateway/src/salesCallOrchestrator.js';
import { runSessionShutdown } from '../apps/call-gateway/dist/apps/call-gateway/src/sessionShutdown.js';
import { ASYNC_JOB_TYPES, enqueueAsyncJob } from '../lib/asyncJobs.js';
import { normalizeCapturedCallFields } from '../pages/api/_lib/callCapture.js';
import { sanitizeTranscriptText } from '../packages/contracts/dist/callTranscript.js';
const target=process.env.EVERYCALL_TEST_POSTGRES_URL;
assert.ok(target,'Set EVERYCALL_TEST_POSTGRES_URL to an isolated loopback PostgreSQL instance');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(target).hostname));
const schema=`call_review_${crypto.randomBytes(7).toString('hex')}`;
const admin=new pg.Pool({connectionString:target,max:1});
const pool=new pg.Pool({connectionString:target,options:`-c search_path=${schema}`});
const read=p=>fs.readFile(new URL(`../${p}`,import.meta.url),'utf8');
function compile(source,names,deps={}) {
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function(...Object.keys(deps),`${js}\nreturn {${names.join(',')}};`)(...Object.values(deps));
}
const slice=(source,start,end)=>{const from=source.indexOf(start);assert.ok(from>=0,`Missing source marker: ${start}`);const to=source.indexOf(end,from);return source.slice(from,to<0?source.length:to);};
const text=value=>String(value||'');
const asObject=value=>value&&typeof value==='object'?value:{};
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},setHeader(){}});
try {
 await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE admin_users(id BIGSERIAL PRIMARY KEY);
 CREATE TABLE inbound_webhook_events(id BIGSERIAL PRIMARY KEY,provider TEXT,event_type TEXT);`);
 await pool.query(await read('migrations/0032_outbound_sales_demo.sql'));
 await pool.query(await read('migrations/0054_call_processing_recovery.sql'));
 await pool.query(`INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164)
 VALUES('prospect','test','Fixture','+12065550100');
 INSERT INTO sales_call_sessions(sales_call_id,prospect_id,state,operator_call_control_id)
 VALUES('original','prospect','preparing_call','operator');`);
 const repository=createPostgresSalesGatewayRepository(pool);
 const gateway=await read('apps/sales-call-gateway/src/gateway.ts');
 const active=new Set();
 const teardown=createSalesCallOrchestrator({telnyx:{
   hangupCall:async({callControlId})=>active.delete(callControlId),
   endConference:async()=>{active.delete('operator');active.delete('prospect-leg');}
 },openai:{}});
 let unknown=false;
 const orchestrator={endCall:teardown.endCall,beginCall:async()=>{
   active.add('operator');active.add('prospect-leg');active.add('ai-leg');
   const patch={conference_id:'conference',operator_call_control_id:'operator',prospect_call_control_id:'prospect-leg',ai_telnyx_call_control_id:'ai-leg',state:'dialing_prospect'};
   if(unknown)throw Object.assign(Error('dial response lost'),{patch:{...patch,ai_telnyx_call_control_id:null,metadata_json:{preparation_unknown_resources:['ai']}},teardown:[]});
   return {patch};
 }};
 const helpers=compile(slice(gateway,'function guardPreparationRecovery(','function teardownErrorPatch('),['guardPreparationRecovery']);
 const deps={orchestrator,repository,loadRequiredCall:async()=>{throw Error('transient DB failure after provider success');},text,asObject,
   errorPatch:error=>error.patch||{},teardownErrorPatch:()=>({}),now:()=>new Date(),nowIso:()=>new Date().toISOString()};
 const {runCallPreparation}=compile(slice(gateway,'  async function runCallPreparation(','  async function rejectOperatorLeg('),['runCallPreparation'],deps);
 await assert.rejects(runCallPreparation(await repository.getCallContext('original')),/transient DB/);
 let original=await repository.getCallContext('original');
 assert.equal(original.state,'ending');assert.equal(original.aiTelnyxCallControlId,'ai-leg');assert.equal(original.endedAt,null);
 await assert.rejects(pool.query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,state) VALUES('second','prospect','created')"),error=>error.code==='23505');
 assert.equal(active.size,3);
 const {endWholeCall}=compile(slice(gateway,'  async function endWholeCall(','  async function handleAiTelnyxHangup('),['endWholeCall'],{
   ...deps,...helpers,TERMINAL_STATES:new Set(['ended','closed','failed']),clearDemoTimer:()=>{},loadRequiredCall:id=>repository.getCallContext(id)
 });
 await endWholeCall(original);assert.equal(active.size,0);assert.equal((await repository.getCallContext('original')).state,'closed');
 await pool.query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,state,operator_call_control_id) VALUES('second','prospect','preparing_call','operator')");
 unknown=true;
 await assert.rejects(runCallPreparation(await repository.getCallContext('second')),/dial response lost/);
 await endWholeCall(await repository.getCallContext('second'));
 assert.equal((await repository.getCallContext('second')).state,'ending');assert.ok(active.has('ai-leg'));
 await assert.rejects(pool.query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,state) VALUES('third','prospect','created')"),error=>error.code==='23505');
 await repository.patchCall('second',{ai_telnyx_call_control_id:'ai-leg'});
 await endWholeCall(await repository.getCallContext('second'));assert.equal(active.size,0);assert.equal((await repository.getCallContext('second')).state,'closed');
 console.log('PASS actual sales preparation/recovery with real 0054 index: post-provider DB failure and unknown dial retain reservation until confirmed cleanup');

 const server=await read('apps/call-gateway/src/server.ts');
 const usageBody=slice(server,'async function persistCallUsage(','\nfunction resolveBidirectionalPayloadMode(');
 let writes=0,usageFails=1;
 const usagePool={query:async()=>{writes++;if(usageFails-->0)throw Error('DB unavailable');return {rowCount:1};}};
 const {persistCallUsage}=compile(usageBody,['persistCallUsage'],{pool:usagePool,logError:()=>{},emptyUsageTotals:()=>({}),realtimeInputRateMicrosUsd:0,realtimeOutputRateMicrosUsd:0});
 // Partial-turn flush remains best effort; shutdown explicitly requires success.
 await persistCallUsage({live:{},callSid:'flush',tenantKey:'tenant'});assert.equal(writes,1);
 usageFails=1;
 const progress={done:new Set()};const usageStep={usage:()=>persistCallUsage({live:{},callSid:'call',tenantKey:'tenant'},true)};
 assert.equal(await runSessionShutdown(progress,usageStep,()=>{}),false);
 assert.equal(await runSessionShutdown(progress,usageStep,()=>{}),true);
 assert.equal(await runSessionShutdown(progress,usageStep,()=>{}),true);assert.equal(writes,3);
 usageFails=1;
 const realtimeProgress={done:new Set()};const realtimeStep={usage:()=>persistCallUsage({callSid:'realtime',tenantKey:'tenant'},true)};
 assert.equal(await runSessionShutdown(realtimeProgress,realtimeStep,()=>{}),false);
 assert.equal(await runSessionShutdown(realtimeProgress,realtimeStep,()=>{}),true);
 assert.equal(writes,5);


 let timer,summaryRequests=0,summaryFault='http',usageFault=true,transcriptFault=false,hangups=0,socketCloses=0;
 const sessions=new Map();
 const helperPool={query:async sql=>{
   if(sql.startsWith('UPDATE calls')){if(usageFault){usageFault=false;throw Error('usage DB unavailable');}return {rowCount:1};}
   if(transcriptFault){transcriptFault=false;throw Error('transcript DB unavailable');}
   return {rows:[]};
 }};
 const fullBodies=usageBody+slice(server,'async function loadCombinedTranscriptForCall(','\nasync function flushFinalAudioAndEnd(');
 const {endCallSession}=compile(fullBodies,['endCallSession'],{
   pool:helperPool,runSessionShutdown,crypto,WebSocket:{OPEN:1,CONNECTING:0},logError:()=>{},logInfo:()=>{},
   appBaseUrl:'https://offline.test',callSummaryFinalizeToken:'fixture',normalizeOptionalText:value=>value||'',buildTranscriptFromEvents:()=>'',
   fetch:async()=>{summaryRequests++;if(summaryFault==='network'){summaryFault='';throw Error('response lost');}const ok=summaryFault!=='http';summaryFault='';return {ok,status:ok?200:503,text:async()=>''};},
   persistKnowledgeCallState:async()=>{},telnyxCallIsAlive:async()=>true,telnyxCallAction:async()=>{hangups++;},
   streamSessions:sessions,streamIdToCall:new Map(),markCallCompleted:async()=>{},
   setTimeout:callback=>{timer=callback;return {unref(){}};},clearTimeout:()=>{}
 });
 const session={callControlId:'call',callSid:'call',tenantKey:'tenant',live:{close:async()=>{}},openAiWs:{readyState:1,close(){socketCloses++;}}};
 sessions.set('call',session);
 assert.equal(await endCallSession(session,'test',true),false);assert.equal(hangups,1);assert.equal(socketCloses,1);assert.equal(summaryRequests,0);
 timer();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(summaryRequests,1);assert.ok(sessions.has('call'),'HTTP 503 must retain cleanup progress');
 timer();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(summaryRequests,2);assert.equal(sessions.size,0);assert.equal(hangups,1);assert.equal(socketCloses,1);
 await endCallSession(session,'duplicate',true);assert.equal(summaryRequests,2);
 const network={callControlId:'network',callSid:'network',tenantKey:'tenant',live:{close:async()=>{}}};
 summaryFault='network';sessions.set('network',network);
 assert.equal(await endCallSession(network,'test',false),false);timer();await new Promise(resolve=>setImmediate(resolve));assert.equal(sessions.size,0);
 const transcript={callControlId:'transcript',callSid:'transcript',tenantKey:'tenant',live:{close:async()=>{}}};
 transcriptFault=true;sessions.set('transcript',transcript);
 assert.equal(await endCallSession(transcript,'test',false),false);timer();await new Promise(resolve=>setImmediate(resolve));assert.equal(sessions.size,0);
 console.log('PASS actual usage/summary/transcript helpers under automatic shutdown retries: DB errors, HTTP 503, network failure; successful hangup/socket/summary steps remain idempotent');

 // Replay a lost successful summary response through the real API and real job
 // deduplication SQL. No model or provider request is made.
 await pool.query(`CREATE TABLE calls(call_sid TEXT PRIMARY KEY,tenant_key TEXT,status TEXT,summary TEXT,urgency TEXT,disposition TEXT,
 lead_outcome_type TEXT,lead_is_valid BOOLEAN,lead_is_billable BOOLEAN,lead_decision_reason TEXT,lead_duplicate_of_call_sid TEXT);
 CREATE TABLE call_details(call_sid TEXT PRIMARY KEY,extracted_json JSONB,transcript_combined TEXT,caller_first_name TEXT,caller_last_name TEXT,
 callback_number TEXT,caller_email TEXT,service_required TEXT,urgency_level TEXT,address_line1 TEXT,address_line2 TEXT,city TEXT,state TEXT,
 postal_code TEXT,requested_date TEXT,requested_time TEXT,updated_at TIMESTAMPTZ);
 CREATE TABLE async_jobs(id BIGSERIAL PRIMARY KEY,job_type TEXT,tenant_key TEXT,dedupe_key TEXT,payload_json JSONB,max_attempts INTEGER,
 available_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);
 CREATE UNIQUE INDEX jobs_dedupe ON async_jobs(job_type,dedupe_key) WHERE dedupe_key IS NOT NULL;`);
 const apiSource=(await read('pages/api/v1/calls.js')).replace(/^import[\s\S]*?;\n/gm,'').replace('export default ','');
 const {handler}=compile(apiSource,['handler'],{
   crypto,process:{env:{}},getPool:()=>pool,ensureTables:async()=>{},getSession:async()=>null,
   isValidInternalServiceToken:()=>true,INTERNAL_AUTH_PURPOSES:{callSummaryFinalize:'fixture'},normalizeCapturedCallFields,sanitizeTranscriptText,
   evaluateLeadDecision:async()=>({isValidLead:true,isBillableLead:true}),ASYNC_JOB_TYPES,enqueueAsyncJob,
   listIntegrationConnections:async()=>[{id:'integration'}],buildStableEventId:()=> 'stable-event',INTEGRATION_EVENT_TYPES:{callCompleted:'call.completed'}
 });
 const request={method:'POST',headers:{'x-everycall-internal':'fixture'},query:{},body:{action:'summary',callSid:'lost-summary-response',tenantKey:'tenant',extracted:{transcript:'Caller requested a callback.'}}};
 for(let i=0;i<2;i++){const res=response();await handler(request,res);assert.equal(res.statusCode,200);}
 assert.equal((await pool.query('SELECT * FROM calls')).rowCount,1);assert.equal((await pool.query('SELECT * FROM call_details')).rowCount,1);
 assert.equal((await pool.query('SELECT * FROM async_jobs')).rowCount,4);
 console.log('PASS actual summary API replay: one call/detail and one job per billing, notification, integration and transcript effect');

 const configBody=slice(server,'function resolveCallGatewayBaseUrl(','\nconst callGatewayBaseUrl =');
 const {resolveCallGatewayBaseUrl}=compile(configBody,['resolveCallGatewayBaseUrl']);
 assert.equal(resolveCallGatewayBaseUrl({RENDER_EXTERNAL_URL:'https://gateway.onrender.com'}),'https://gateway.onrender.com');
 assert.equal(resolveCallGatewayBaseUrl({CALL_GATEWAY_BASE_URL:'https://override.example/',RENDER_EXTERNAL_URL:'https://gateway.onrender.com'}),'https://override.example');
 assert.throws(()=>resolveCallGatewayBaseUrl({}),/public_url_required/);
 const configInitialization=slice(server,'function resolveCallGatewayBaseUrl(','\nconst openAiKey');
 assert.throws(()=>compile(configInitialization,['callGatewayBaseUrl'],{process:{env:{}}}),/public_url_required/);
 assert.equal(compile(configInitialization,['callGatewayBaseUrl'],{process:{env:{RENDER_EXTERNAL_URL:'https://gateway.onrender.com'}}}).callGatewayBaseUrl,'https://gateway.onrender.com');
 const baseUrl=compile(slice(server,'function buildBaseUrl(','\nfunction toWebSocketUrl('),['buildBaseUrl'],{callGatewayBaseUrl:'https://trusted.example'}).buildBaseUrl;
 assert.equal(baseUrl({get(){throw Error('Untrusted request host read');}}),'https://trusted.example');

 assert.throws(()=>resolveCallGatewayBaseUrl({CALL_GATEWAY_BASE_URL:'https://user:secret@example.com'}),/public_url_invalid/);
 const scanner=slice(server,'let voiceRecoveryRunning = false;','\nconst port =');
 let scheduled,scans=0;const scanned=[];
 const {recoverPendingVoiceWebhooks}=compile(scanner,['recoverPendingVoiceWebhooks'],{
   pool:{},callGatewayBaseUrl:resolveCallGatewayBaseUrl({RENDER_EXTERNAL_URL:'https://gateway.onrender.com'}),
   recoverInboundVoiceWebhooks:async(_pool,handle)=>{scans++;await handle('signed-and-stored');return [];},
   processVerifiedVoiceWebhook:async(raw,url)=>scanned.push({raw,url}),logError:()=>{},
   setInterval:(callback,ms)=>{assert.equal(ms,15000);scheduled=callback;return {unref(){}};}
 });
 scheduled();await new Promise(resolve=>setImmediate(resolve));assert.equal(scans,1);assert.equal(scanned[0].url,'https://gateway.onrender.com');
 await recoverPendingVoiceWebhooks();assert.equal(scans,2);
 const startup=slice(server,'const port = Number(process.env.PORT','\n__no_marker__');
 let starts=0;
 compile(startup,[],{process:{env:{}},server:{listen:(_port,ready)=>ready()},logBidirectionalPayloadModeNormalization:()=>{},logInfo:()=>{},
   voiceRuntime:'live',resolveBidirectionalPayloadMode:()=> 'rtp',rtpPayloadType:0,outboundJitterBufferFrames:13,outboundAudioFrameMs:20,
   preloadActiveBuildAssetsOnStartup:async()=>{},recoverPendingVoiceWebhooks:async()=>{starts++;}});
 assert.equal(starts,1);
 console.log('PASS actual startup and periodic recovery wiring with trusted Render URL, explicit override, and missing/invalid configuration rejection');
} finally {
 await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
}
