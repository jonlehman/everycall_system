import crypto from 'node:crypto';

export const RETIRED_NUMBER_RELEASE = Object.freeze({
 tenantKey:'daved',numberId:'3059998106570458876',numberSha256:'467db819854f357c979cf3b734256b8a858866396f2a606a6c92b6bfc20c866c',
 customerId:'cus_VLsYWZAeSoe4Dm',subscriptionId:'sub_1ULAo1FgMKdd4EaWvxkS9kRa',actorAdminUserId:1,
 controlNumberId:'2943114023983384517',controlNumberSha256:'81043ba5f23b226f4e2aaedad0416607168269a6abfe1ac8d89bf490aee5e90e',
 tokenType:'operator_daved_number_release_v1',sunset:'2026-11-14T00:00:00.000Z'
});
export const releaseDigest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const C=RETIRED_NUMBER_RELEASE,action='tenant.legacy_number_release.',fail=code=>{throw Error(`retired_number_release_${code}`);};
export function validateRetiredReleaseRuntime(runtime,revision,now=Date.now()){
 const r=runtime?.retirement,at=Date.parse(runtime?.observedAt);
 if(!/^[a-f0-9]{40}$/.test(revision||'')||!Number.isFinite(at)||at>now||now-at>600000
  ||['app','gateway','worker'].some(k=>runtime[k]?.revision!==revision||runtime[k]?.healthy!==true)
  ||r?.oldRevision!=='17195749a3cd70b421db34c2f4f244d9f153b0e3'||r.configuredFunctionMaximumSeconds!==300
  ||r.oldCanonicalIngressRemoved!==true||r.oldWorkerInstancesAbsent!==true
  ||!Number.isFinite(Date.parse(r.canonicalChangedAt))||!Number.isFinite(Date.parse(r.completedAt))
  ||Date.parse(r.completedAt)>at||Date.parse(r.completedAt)-Date.parse(r.canonicalChangedAt)<810000)fail('runtime_retirement');
}
async function transaction(pool,work){const db=await pool.connect();try{await db.query('BEGIN');await db.query("SET LOCAL transaction_timeout='5s'");await db.query("SET LOCAL statement_timeout='3s'");await db.query("SET LOCAL lock_timeout='250ms'");const result=await work(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}}
async function authorize(db,tokenHash,runtimeRevision){
 const token=(await db.query(`SELECT a.*,u.role AS actor_role,NOW() AS server_now FROM auth_tokens a JOIN admin_users u ON u.id=a.user_id
  WHERE a.token_hash=$1 AND a.token_type=$2 AND a.tenant_key=$3 FOR UPDATE OF a`,[tokenHash,C.tokenType,C.tenantKey])).rows[0];
 const now=token&&new Date(token.server_now).getTime();
 if(!token||token.actor_role!=='admin'||Number(token.user_id)!==C.actorAdminUserId||new Date(token.expires_at).getTime()<=now
  ||new Date(token.expires_at).getTime()>new Date(token.created_at).getTime()+15*60000||now>=Date.parse(C.sunset))fail('capability');
 const receipt=(await db.query("SELECT details FROM audit_log WHERE tenant_key=$1 AND actor='admin:1' AND action=$2 AND details::jsonb->>'tokenHash'=$3 ORDER BY id DESC LIMIT 1",[C.tenantKey,action+'authorized',tokenHash])).rows[0];
 let grant;try{grant=JSON.parse(receipt?.details);}catch{fail('grant');}
 if(grant?.tokenId!==Number(token.id)||grant.numberId!==C.numberId||grant.phoneSha256!==C.numberSha256||grant.actorAdminUserId!==1
  ||grant.runtimeRevision!==runtimeRevision||!/^release_daved_[a-f0-9]{32}$/.test(grant.operationId||''))fail('grant');
 // Authorization was issued after complete retirement; expiry bounds continued
 // use. Invocation cannot replace that evidence with request-body assertions.
 validateRetiredReleaseRuntime(grant.runtime,grant.runtimeRevision,new Date(token.created_at).getTime());
 const tenant=(await db.query('SELECT *,md5(to_jsonb(t)::text) AS fingerprint FROM tenants t WHERE tenant_key=$1 FOR UPDATE',[C.tenantKey])).rows[0];
 const account=(await db.query('SELECT stripe_customer_id,stripe_subscription_id,paid_purchase_id FROM tenant_billing_accounts WHERE tenant_key=$1',[C.tenantKey])).rows[0];
 if(!tenant||tenant.telnyx_voice_number_id!==C.numberId||releaseDigest(tenant.telnyx_voice_number||'')!==C.numberSha256
  ||account?.stripe_customer_id!==C.customerId||account.stripe_subscription_id!==C.subscriptionId||account.paid_purchase_id)fail('local_binding');
 if((await db.query('SELECT 1 FROM tenants WHERE tenant_key<>$1 AND (telnyx_voice_number_id=$2 OR telnyx_voice_number=$3)',[C.tenantKey,C.numberId,tenant.telnyx_voice_number])).rowCount)fail('shared_number');
 if((await db.query("SELECT 1 FROM calls WHERE tenant_key=$1 AND status<>'completed' UNION ALL SELECT 1 FROM provisioning_jobs WHERE tenant_key=$1 AND status NOT IN('done','completed','failed') UNION ALL SELECT 1 FROM async_jobs WHERE tenant_key=$1 AND status NOT IN('done','completed','failed','dead_letter')",[C.tenantKey])).rowCount)fail('active_work');
 const prior=(await db.query("SELECT id,action,details FROM audit_log WHERE tenant_key=$1 AND action IN($2,$3) AND details::jsonb->>'numberId'=$4 ORDER BY id DESC LIMIT 1",[C.tenantKey,action+'submitted',action+'reconciled',C.numberId])).rows[0];
 if(token.used_at&&!prior)fail('consumed_without_intent');
 if(!prior&&tenant.fingerprint!==grant.tenantFingerprint)fail('tenant_changed');
 if(!prior&&tenant.telnyx_release_status)fail('prior_release_unknown');
 return {token,grant,tenant,prior};
}

// Fixed resource only. The special capability is not a tenant/admin session and
// cannot select another resource or authorize another application action.
export async function releaseRetiredNumber(pool,{capability,runtimeRevision,fetchImpl=fetch,apiKey=process.env.TELNYX_API_KEY,connectionId=process.env.TELNYX_VOICE_CONNECTION_ID}={}){
 if(!/^[A-Za-z0-9_-]{43}$/.test(capability||''))fail('capability');
 if(!apiKey||!connectionId)fail('runtime_configuration');
 const tokenHash=releaseDigest(capability);
 const initial=await transaction(pool,db=>authorize(db,tokenHash,runtimeRevision));
 const get=async numberId=>{
  const response=await fetchImpl(`https://api.telnyx.com/v2/phone_numbers/${numberId}`,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(response.status===404)return {absent:true};
  if(!response.ok)fail('canonical_read_failed');
  const {data}=await response.json();if(!data||data.id!==numberId||typeof data.phone_number!=='string'||typeof data.connection_id!=='string')fail('canonical_shape');
  return {absent:false,data};
 };
 // Positive control distinguishes authenticated absence from wrong-account or
 // invalid credentials. Creative Dynamic is only read, never mutated.
 const control=await get(C.controlNumberId);
 if(control.absent||releaseDigest(control.data.phone_number)!==C.controlNumberSha256||control.data.connection_id!==connectionId||control.data.status!=='active')fail('canonical_account_control');
 const current=await get(C.numberId);
 if(!current.absent&&(releaseDigest(current.data.phone_number)!==C.numberSha256||current.data.connection_id!==connectionId||current.data.status!=='active'))fail('canonical_ownership');
 if(current.absent&&!initial.prior)fail('absence_without_owned_intent');
 let submitted=false,operationId=initial.grant.operationId;
 if(!initial.prior){
  const claimed=await transaction(pool,async db=>{
   if(!(await db.query('SELECT pg_try_advisory_xact_lock(1763910417) AS locked')).rows[0].locked)fail('busy');
   const fresh=await authorize(db,tokenHash,runtimeRevision);
   if(fresh.prior)return false;
   await db.query('UPDATE auth_tokens SET used_at=NOW() WHERE id=$1',[fresh.token.id]);
   await db.query(`UPDATE tenants SET status='inactive',service_access_status='disabled',telnyx_release_status='operator_submitted',
    telnyx_release_number=telnyx_voice_number,telnyx_release_number_id=telnyx_voice_number_id,telnyx_release_requested_at=NOW()
    WHERE tenant_key=$1`,[C.tenantKey]);
   await db.query('INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,$3,$4)',[C.tenantKey,'admin:1',action+'submitted',JSON.stringify({operationId,numberId:C.numberId,phoneSha256:C.numberSha256,tokenId:Number(fresh.token.id),grantManifestSha256:fresh.grant.manifestSha256,canonicalOwnershipVerified:true,connectionMatched:true})]);
   return true;
  });
  submitted=claimed;
 }
 let absent=current.absent,errorCode=null,providerJobId=null;
 try{
  if(submitted){
   if(Date.now()>=Date.parse(C.sunset)||Date.now()>=new Date(initial.token.expires_at).getTime())fail('operator_window_expired');
   const response=await fetchImpl('https://api.telnyx.com/v2/phone_numbers/jobs/delete_phone_numbers',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({phone_numbers:[current.data.phone_number]}),signal:AbortSignal.timeout(8000)});
   if(!response.ok)fail('provider_submission_uncertain');
   const body=await response.json();if(typeof body?.data?.id==='string')providerJobId=body.data.id;
  }
  if(!current.absent)absent=(await get(C.numberId)).absent;
 }catch{errorCode='provider_release_uncertain';}
 await transaction(pool,async db=>{
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE',[C.tenantKey]);
  const prior=(await db.query("SELECT details FROM audit_log WHERE tenant_key=$1 AND action=$2 AND details::jsonb->>'numberId'=$3 ORDER BY id LIMIT 1",[C.tenantKey,action+'submitted',C.numberId])).rows[0];
  if(!prior)fail('intent_missing');operationId=JSON.parse(prior.details).operationId;
  await db.query('INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,$3,$4)',[C.tenantKey,'admin:1',action+(absent?'reconciled':'pending'),JSON.stringify({operationId,numberId:C.numberId,absent,canonicalReadback:!errorCode,providerJobId,errorCode})]);
  await db.query('UPDATE tenants SET telnyx_release_status=$2,telnyx_release_error=$3 WHERE tenant_key=$1 AND telnyx_voice_number_id=$4',[C.tenantKey,absent?'operator_released':'operator_submitted',errorCode,C.numberId]);
 });
 return {operationId,numberId:C.numberId,absent,canonicalReadback:!errorCode,submittedThisRequest:submitted,errorCode,observedAt:new Date().toISOString()};
}
