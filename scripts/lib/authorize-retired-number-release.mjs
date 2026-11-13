import crypto from 'node:crypto';
import {RETIRED_NUMBER_RELEASE as C,releaseDigest,validateRetiredReleaseRuntime} from '../../pages/api/_lib/retiredNumberRelease.js';
import {upibTargetFingerprint} from './unified-paid-billing-migrations.mjs';
const fail=code=>{throw Error(`retired_number_grant_${code}`);};
export async function authorizeRetiredNumberRelease(pool,{bundle,bundleSha256,databaseUrl,currentRevision,execute=false,saveCapability=async()=>{throw Error('private_capability_writer_required');}}={}){
 if(!bundle||releaseDigest(bundle)!==bundleSha256||!/^[a-f0-9]{64}$/.test(bundleSha256||'')||bundle.reviewedRevision!==currentRevision||bundle.targetFingerprint!==upibTargetFingerprint(databaseUrl))fail('pins');
 if(bundle.actorAdminUserId!==1||!bundle.ownerDecisionReference||!bundle.ownerDecisionQuote||!bundle.independentReviewReference||!/^[a-f0-9]{64}$/.test(bundle.carrierOwnershipEvidenceSha256||''))fail('authority');
 const closure=bundle.stripeClosure;
 if(closure?.customerId!==C.customerId||closure.subscriptionId!==C.subscriptionId||closure.status!=='canceled'||closure.automaticCollectionStopped!==true||closure.unknownEffects!==0||closure.processingPayments!==0||!/^[a-f0-9]{64}$/.test(closure.evidenceSha256||''))fail('stripe_closure');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL transaction_timeout='5s'");await db.query("SET LOCAL statement_timeout='3s'");await db.query("SET LOCAL lock_timeout='250ms'");
  if(!(await db.query('SELECT pg_try_advisory_xact_lock(1763910417) AS locked')).rows[0].locked)fail('busy');
  const at=new Date((await db.query('SELECT NOW() AS now')).rows[0].now).getTime();
  if(at>=Date.parse(C.sunset))fail('route_expired');validateRetiredReleaseRuntime(bundle.runtime,currentRevision,at);
  if((await db.query('SELECT role FROM admin_users WHERE id=1 FOR SHARE')).rows[0]?.role!=='admin')fail('actor');
  const tenant=(await db.query('SELECT tenant_key,telnyx_voice_number_id,telnyx_voice_number,telnyx_release_status,md5(to_jsonb(t)::text) AS fingerprint FROM tenants t WHERE tenant_key=$1 FOR UPDATE',[C.tenantKey])).rows[0];
  if(!tenant||tenant.telnyx_voice_number_id!==C.numberId||releaseDigest(tenant.telnyx_voice_number||'')!==C.numberSha256||tenant.fingerprint!==bundle.tenantFingerprint)fail('tenant_pin');
  const account=(await db.query('SELECT stripe_customer_id,stripe_subscription_id,paid_purchase_id FROM tenant_billing_accounts WHERE tenant_key=$1',[C.tenantKey])).rows[0];
  if(account?.stripe_customer_id!==C.customerId||account.stripe_subscription_id!==C.subscriptionId||account.paid_purchase_id)fail('account_pin');
  const existing=(await db.query("SELECT details FROM audit_log WHERE tenant_key=$1 AND action='tenant.legacy_number_release.submitted' AND details::jsonb->>'numberId'=$2 ORDER BY id LIMIT 1",[C.tenantKey,C.numberId])).rows[0];
  if(tenant.telnyx_release_status&&!existing)fail('unknown_prior_release');
  if((await db.query('SELECT 1 FROM auth_tokens WHERE token_type=$1 AND tenant_key=$2 AND expires_at>NOW()',[C.tokenType,C.tenantKey])).rowCount)fail('unexpired_capability_exists');
  const operationId=existing?JSON.parse(existing.details).operationId:`release_daved_${crypto.randomBytes(16).toString('hex')}`;
  if(!execute){await db.query('ROLLBACK');return {authorized:false,dryRun:true,resourceId:C.numberId,reconcileOnly:Boolean(existing)};}
  const capability=crypto.randomBytes(32).toString('base64url'),tokenHash=releaseDigest(capability);
  const token=(await db.query(`INSERT INTO auth_tokens(token,token_hash,token_type,user_id,tenant_key,expires_at)
   VALUES($1,$2,$3,1,$4,LEAST(NOW()+INTERVAL '15 minutes',$5::timestamptz)) RETURNING id,expires_at`,[`operator-daved:${tokenHash}`,tokenHash,C.tokenType,C.tenantKey,C.sunset])).rows[0];
  const grant={tokenId:Number(token.id),tokenHash,operationId,actorAdminUserId:1,ownerDecisionReference:bundle.ownerDecisionReference,ownerDecisionQuote:bundle.ownerDecisionQuote,
   independentReviewReference:bundle.independentReviewReference,numberId:C.numberId,phoneSha256:C.numberSha256,tenantFingerprint:tenant.fingerprint,runtimeRevision:currentRevision,
   runtime:bundle.runtime,manifestSha256:bundleSha256,stripeClosureEvidenceSha256:closure.evidenceSha256,carrierOwnershipEvidenceSha256:bundle.carrierOwnershipEvidenceSha256,reconcileOnly:Boolean(existing)};
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,'admin:1','tenant.legacy_number_release.authorized',$2)",[C.tenantKey,JSON.stringify(grant)]);
  await saveCapability({capability,operationId,expiresAt:new Date(token.expires_at).toISOString(),route:'https://app.everycall.io/api/v1/operator/retire-daved-number'});
  await db.query('COMMIT');return {authorized:true,operationId,expiresAt:new Date(token.expires_at).toISOString(),tokenHash,reconcileOnly:Boolean(existing),bundleSha256};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
