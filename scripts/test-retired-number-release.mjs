import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {upibTargetFingerprint} from './lib/unified-paid-billing-migrations.mjs';
import {findAuthToken} from '../pages/api/_lib/authTokens.js';
const digest=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'retired-release-native-'));
const fakeDave='+15550001111',fakeOwner='+15550002222',revision='a'.repeat(40);
// Only private phone hashes and the fixed operational sunset are substituted in
// the copied module. Authorization/provider/concurrency code remains unchanged.
let source=await fs.readFile(new URL('../pages/api/_lib/retiredNumberRelease.js',import.meta.url),'utf8');
source=source.replace('467db819854f357c979cf3b734256b8a858866396f2a606a6c92b6bfc20c866c',digest(fakeDave)).replace('81043ba5f23b226f4e2aaedad0416607168269a6abfe1ac8d89bf490aee5e90e',digest(fakeOwner)).replace('2026-11-14T00:00:00.000Z',new Date(Date.now()+86400000).toISOString());
await fs.writeFile(`${dir}/runtime.mjs`,source,{mode:0o600});
let grantSource=await fs.readFile(new URL('./lib/authorize-retired-number-release.mjs',import.meta.url),'utf8');
grantSource=grantSource.replace('../../pages/api/_lib/retiredNumberRelease.js',pathToFileURL(`${dir}/runtime.mjs`).href).replace('./unified-paid-billing-migrations.mjs',new URL('./lib/unified-paid-billing-migrations.mjs',import.meta.url).href);
await fs.writeFile(`${dir}/grant.mjs`,grantSource,{mode:0o600});
const {RETIRED_NUMBER_RELEASE:C,releaseRetiredNumber}=await import(pathToFileURL(`${dir}/runtime.mjs`).href);
const {authorizeRetiredNumberRelease}=await import(pathToFileURL(`${dir}/grant.mjs`).href);
const f=await createUpibTestFixture({label:'numberoperator'}),{pool}=f,q=(s,p)=>pool.query(s,p);
let capability,providerPosts=0,providerGets=0,absent=false,mode='pending';
const provider=async(url,options)=>{
 if(options.method==='POST'){providerPosts++;assert.equal(url,'https://api.telnyx.com/v2/phone_numbers/jobs/delete_phone_numbers');assert.deepEqual(JSON.parse(options.body),{phone_numbers:[fakeDave]});if(mode==='timeout')throw Error('synthetic_accepted_timeout');if(mode==='absent')absent=true;return {ok:true,status:200,json:async()=>({data:{id:'job_synthetic'}})};}
 providerGets++;const owner=url.endsWith(C.controlNumberId);if(!owner&&absent)return {ok:false,status:404};
 return {ok:true,status:200,json:async()=>({data:{id:owner?C.controlNumberId:C.numberId,phone_number:owner?fakeOwner:fakeDave,connection_id:'conn_fixture',status:'active'}})};
};
const invoke=()=>releaseRetiredNumber(pool,{capability,runtimeRevision:revision,fetchImpl:provider,apiKey:'synthetic_not_a_key',connectionId:'conn_fixture'});
const bundle=async()=>({reviewedRevision:revision,targetFingerprint:upibTargetFingerprint(f.databaseUrl),actorAdminUserId:1,ownerDecisionReference:'fixture:owner-delete',ownerDecisionQuote:'SYNTHETIC delete this named account',independentReviewReference:'fixture:independent-review',carrierOwnershipEvidenceSha256:'c'.repeat(64),stripeClosure:{customerId:C.customerId,subscriptionId:C.subscriptionId,status:'canceled',automaticCollectionStopped:true,unknownEffects:0,processingPayments:0,evidenceSha256:'b'.repeat(64)},tenantFingerprint:(await q('SELECT md5(to_jsonb(t)::text) AS hash FROM tenants t WHERE tenant_key=$1',[C.tenantKey])).rows[0].hash,runtime:{observedAt:new Date().toISOString(),...Object.fromEntries(['app','gateway','worker'].map(k=>[k,{revision,healthy:true}])),retirement:{oldRevision:'17195749a3cd70b421db34c2f4f244d9f153b0e3',configuredFunctionMaximumSeconds:300,oldCanonicalIngressRemoved:true,oldWorkerInstancesAbsent:true,canonicalChangedAt:new Date(Date.now()-900000).toISOString(),completedAt:new Date(Date.now()-1000).toISOString()}}});
async function grant(execute=true){const b=await bundle();return authorizeRetiredNumberRelease(pool,{bundle:b,bundleSha256:digest(b),databaseUrl:f.databaseUrl,currentRevision:revision,execute,saveCapability:async value=>{capability=value.capability;}});}
try{
 await q("INSERT INTO admin_users(id,username,email,role) VALUES(1,'responsible_operator','operator@fixture.invalid','admin')");
 await q("INSERT INTO tenants(tenant_key,name,status,telnyx_voice_number,telnyx_voice_number_id) VALUES($1,'Retired','active',$2,$3),('creative_dynamic','Owner','active',$4,$5)",[C.tenantKey,fakeDave,C.numberId,fakeOwner,C.controlNumberId]);
 await q('INSERT INTO tenant_billing_accounts(tenant_key,stripe_customer_id,stripe_subscription_id) VALUES($1,$2,$3)',[C.tenantKey,C.customerId,C.subscriptionId]);
 const ownerBefore=(await q("SELECT to_jsonb(t) AS value FROM tenants t WHERE tenant_key='creative_dynamic'")).rows[0].value;
 assert.equal((await grant(false)).dryRun,true);assert.equal((await q('SELECT count(*)::int AS n FROM auth_tokens')).rows[0].n,0);
 let b=await bundle();b.runtime.retirement.completedAt=b.runtime.retirement.canonicalChangedAt;await assert.rejects(authorizeRetiredNumberRelease(pool,{bundle:b,bundleSha256:digest(b),databaseUrl:f.databaseUrl,currentRevision:revision,execute:true}),/runtime_retirement/);
 const issued=await grant();assert.equal(issued.authorized,true);assert.equal((await findAuthToken(pool,capability,{tokenType:'password_reset'})),null);assert.equal((await findAuthToken(pool,capability,{tokenType:'invite'})),null);
 const savedCapability=capability;capability='x'.repeat(43);await assert.rejects(invoke(),/capability/);capability=savedCapability;assert.equal(providerGets,0);
 await assert.rejects(releaseRetiredNumber(pool,{capability,runtimeRevision:'b'.repeat(40),fetchImpl:provider,apiKey:'fake',connectionId:'conn_fixture'}),/grant/);assert.equal(providerPosts,0);
 // Every provider ownership failure leaves the capability unused and submits nothing.
 const badProviders=[
  {target:C.controlNumberId,status:401},
  {target:C.controlNumberId,patch:{phone_number:'+15559999999'}},
  {target:C.controlNumberId,patch:{connection_id:'conn_foreign'}},
  {target:C.numberId,patch:{phone_number:'+15559999999'}},
  {target:C.numberId,patch:{connection_id:'conn_foreign'}},
  {target:C.numberId,status:404}
 ];
 for(const bad of badProviders){
  let posts=0;const guardedProvider=async(url,options)=>{if(options.method==='POST'){posts++;throw Error('unexpected_provider_effect');}const r=await provider(url,options);if(!url.endsWith(bad.target))return r;if(bad.status)return {ok:false,status:bad.status};const payload=await r.json();return {...r,json:async()=>({data:{...payload.data,...bad.patch}})};};
  await assert.rejects(releaseRetiredNumber(pool,{capability,runtimeRevision:revision,fetchImpl:guardedProvider,apiKey:'fake',connectionId:'conn_fixture'}),/canonical_|absence_without_owned_intent/);
  assert.equal(posts,0);assert.equal((await q('SELECT used_at FROM auth_tokens')).rows[0].used_at,null);assert.equal((await q("SELECT 1 FROM audit_log WHERE action='tenant.legacy_number_release.submitted'")).rowCount,0);
 }
 // An audit failure rolls back capability consumption and intent before any provider mutation.
 await q("CREATE FUNCTION reject_release_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='tenant.legacy_number_release.submitted' THEN RAISE EXCEPTION 'fixture_intent_failure'; END IF; RETURN NEW; END $$");await q('CREATE TRIGGER reject_release_intent BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_release_intent()');
 await assert.rejects(invoke(),/fixture_intent_failure/);assert.equal(providerPosts,0);assert.equal((await q('SELECT used_at FROM auth_tokens')).rows[0].used_at,null);
 await q('DROP TRIGGER reject_release_intent ON audit_log');await q('DROP FUNCTION reject_release_intent()');
 mode='timeout';const [uncertain]=await Promise.all([invoke(),invoke()]);assert.equal(uncertain.absent,false);assert.equal(providerPosts,1);
 assert.equal((await invoke()).submittedThisRequest,false);assert.equal(providerPosts,1);
 // A replacement capability is reconcile-only for the exact resource after an uncertain request.
 await q('UPDATE auth_tokens SET expires_at=NOW()-INTERVAL \'1 second\'');await assert.rejects(invoke(),/capability/);assert.equal((await grant()).reconcileOnly,true);
 await invoke();assert.equal(providerPosts,1);
 absent=true;assert.equal((await invoke()).absent,true);assert.equal(providerPosts,1);
 const retained=(await q('SELECT telnyx_voice_number,telnyx_voice_number_id,telnyx_release_status FROM tenants WHERE tenant_key=$1',[C.tenantKey])).rows[0];assert.equal(retained.telnyx_voice_number,fakeDave);assert.equal(retained.telnyx_voice_number_id,C.numberId);assert.equal(retained.telnyx_release_status,'operator_released');
 assert.deepEqual((await q("SELECT to_jsonb(t) AS value FROM tenants t WHERE tenant_key='creative_dynamic'")).rows[0].value,ownerBefore);
 // Canonical HTTP handler cannot release through GET, query/body targets, or missing authorization.
 const route=(await fs.readFile(new URL('../pages/api/v1/operator/retire-daved-number.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'').replace(/export default /g,'').replace(/export /g,'');let routeEffects=0;
 const handler=new Function('getPool','releaseRetiredNumber',route+';return handler;')(()=>pool,async()=>{routeEffects++;return {absent:true};});
 const response=()=>({code:200,setHeader(){},status(c){this.code=c;return this;},json(v){this.value=v;return this;}});
 for(const [req,code] of [[{method:'GET',headers:{}},405],[{method:'POST',headers:{},query:{numberId:'foreign'}},400],[{method:'POST',headers:{},body:{numberId:'foreign'}},400],[{method:'POST',headers:{}},401]]){const res=response();await handler(req,res);assert.equal(res.code,code);}assert.equal(routeEffects,0);
 console.log(JSON.stringify({status:'PASS',suite:'fixed retired-number operator native capability/intent/uncertainty/replacement/HTTP scope',providerDoubleSubmissions:providerPosts,realProviderEffects:0,phoneHashesSubstituted:true}));
}finally{await f.close();await fs.rm(dir,{recursive:true,force:true});}
