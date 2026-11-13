import {getStripe} from './stripe.js';
import {reconcilePaidInitialCoverage,persistPaidInitialCoverage} from './paidInitialCoverage.js';
import {claimPaidPurchaseWork,finishPaidPurchaseWork,renewPaidPurchaseWork} from './paidPurchaseWork.js';
import crypto from 'node:crypto';
import { intakeTransaction } from './paidIntake.js';
import { STANDARD_BILLING_PLANS } from '../../../lib/standardBillingPlans.js';
import { saveTenantBootstrapProfile } from './tenantBootstrapProfiles.js';
import { saveTenantPromptProfile } from './promptBlueprints.js';
import { saveBusinessCallIntent,saveKnowledgeRuntimeProfile,saveCallOutcomeSchema } from './knowledgeReceptionistConfig.js';
import { inferKnowledgeAssignmentsForIndustry,resolveTenantDomainAssignments,syncCanonicalKnowledgePacks } from './knowledgeReceptionistPacks.js';
import { defaultBusinessIntent,defaultRuntimeProfile,defaultCallOutcomeSchema } from './paidIntakeDefaults.js';
import { loadTenantBusinessHours } from './tenantBusinessHours.js';
import { enqueuePaidIntakeKnowledgeBuild } from './knowledgeReceptionistBuilds.js';
import { provisionPaidVoiceNumber } from './paidNumberProvisioning.js';
import { preparePaidReinstatementNumber } from './paidBillingLifecycle.js';
import { ensureCurrentBillingPeriod } from './callBilling.js';
import { saveSetupInterviewIntent } from './knowledgeReceptionistSetupInterview.js';

export async function convertPaidIntake(pool,purchaseId,{leaseToken=null,stripe=null,now=new Date()}={}) {
 return intakeTransaction(pool,async db=>{
  const row=(await db.query(`SELECT p.*,i.payload_json,i.verified_at FROM paid_purchases p JOIN paid_intakes i USING(intake_id)
   WHERE p.purchase_id=$1 FOR UPDATE OF p`,[purchaseId])).rows[0];
  if(leaseToken&&row?.lease_token!==leaseToken)throw Error('paid_purchase_lease_lost');
  if(!row||row.payment_status!=='paid'||!row.livemode||!row.recurring_consent_at||!row.verified_at)throw Error('verified_purchase_required');
  const priorInitialization=row.tenant_key?(await db.query("SELECT 1 FROM audit_log WHERE tenant_key=$1 AND action='paid_intake.initialized' AND details::jsonb->>'purchaseId'=$2",[row.tenant_key,purchaseId])).rowCount:0;
  const priorBinding=row.tenant_key?(await db.query('SELECT 1 FROM tenant_billing_accounts WHERE tenant_key=$1 AND paid_purchase_id=$2',[row.tenant_key,purchaseId])).rowCount:0;
  const recovered=!priorInitialization&&!priorBinding&&new Date(row.initial_period_end).getTime()<=new Date(now).getTime()
   ?await reconcilePaidInitialCoverage(row,stripe||getStripe(),{now}):null;
  const payload=row.payload_json,key=row.tenant_key||`paid_${crypto.randomUUID().replaceAll('-','')}`;
  const existing=(await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE',[key])).rows[0];
  if(!existing)await db.query(`INSERT INTO tenants(tenant_key,name,status,industry,plan,plan_code,billing_status,service_access_status,app_access_status,billing_lock_reason,live_prompt_mode)
   VALUES($1,$2,'setup_pending',$3,$4,$4,'active','disabled','enabled','setup_and_knowledge_review_required','pending_v20')`,[key,payload.businessName,payload.businessCategory,row.plan_code]);
  const owners=(await db.query("SELECT id,email FROM tenant_users WHERE tenant_key=$1 AND role='owner' FOR UPDATE",[key])).rows;
  if(owners.some(o=>o.email.toLowerCase()!==row.owner_email))throw Error('conversion_owner_mismatch');
  const other=(await db.query('SELECT id FROM tenant_users WHERE lower(email)=$1 AND tenant_key<>$2',[row.owner_email,key])).rows;
  if(other.length)throw Error('conversion_owner_conflict');
  const owner=owners[0]||(await db.query(`INSERT INTO tenant_users(tenant_key,name,email,role,status,lead_alert_email_enabled)
   VALUES($1,$2,$3,'owner','active',TRUE) RETURNING id`,[key,payload.businessName,row.owner_email])).rows[0];
  if(row.kind==='restart'){
   const plan=STANDARD_BILLING_PLANS.find(p=>p.code===row.plan_code);
   const initialized=await db.query(`UPDATE tenant_billing_accounts SET paid_purchase_id=$2,stripe_subscription_id=$3,stripe_price_id=$4,
    billing_interval=$5,monthly_amount_cents=$6,included_call_count=$7,call_overage_rate_cents=$8,usage_anchor_at=$9,
    initial_period_end=NULL,paid_base_through=$10,current_period_start=$9,current_period_end=$10,
    stripe_subscription_status=NULL,monthly_amount_override_cents=NULL,lead_rate_override_cents=NULL,call_overage_rate_override_cents=NULL,active_coupon_redemption_id=NULL,coupon_trial_ends_at=NULL,coupon_discount_starts_at=NULL,coupon_discount_ends_at=NULL,cancel_at_period_end=FALSE,canceled_at=NULL,
    pending_plan_code=NULL,pending_billing_interval=NULL,pending_plan_effective_at=NULL
    WHERE tenant_key=$1 AND paid_purchase_id IS DISTINCT FROM $2 RETURNING tenant_key`,
    [key,purchaseId,row.stripe_subscription_id,row.stripe_price_id,row.billing_interval,plan.monthlyAmountCents,plan.includedCallCount,plan.callOverageRateCents,row.usage_anchor_at,row.initial_period_end]);
   if(recovered)await persistPaidInitialCoverage(db,key,purchaseId,recovered);
   if(initialized.rowCount)await db.query("UPDATE tenants SET plan_code=$2,billing_status='active',app_access_status='enabled',service_access_status='disabled',billing_lock_reason='new_number_forwarding_required' WHERE tenant_key=$1",[key,row.plan_code]);
   return {...row,tenant_key:key,payload,ownerId:owner.id};
  }
  const alreadyInitialized=(await db.query("SELECT 1 FROM audit_log WHERE tenant_key=$1 AND action='paid_intake.initialized'",[key])).rowCount;
  if(alreadyInitialized)return {...row,tenant_key:key,payload,ownerId:owner.id};
  const actor={role:'tenant',user_id:owner.id},plan=STANDARD_BILLING_PLANS.find(p=>p.code===row.plan_code);
  await db.query('UPDATE paid_purchases SET tenant_key=$2 WHERE purchase_id=$1',[purchaseId,key]);
  await db.query(`INSERT INTO tenant_billing_accounts(tenant_key,paid_purchase_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,
   billing_interval,monthly_amount_cents,included_call_count,call_overage_rate_cents,usage_anchor_at,initial_period_end,paid_base_through,current_period_start,current_period_end,stripe_subscription_status)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$10,$11,NULL)
   ON CONFLICT(tenant_key) DO UPDATE SET paid_purchase_id=EXCLUDED.paid_purchase_id,stripe_customer_id=EXCLUDED.stripe_customer_id,
    stripe_subscription_id=EXCLUDED.stripe_subscription_id,stripe_price_id=EXCLUDED.stripe_price_id,billing_interval=EXCLUDED.billing_interval,
    monthly_amount_cents=EXCLUDED.monthly_amount_cents,included_call_count=EXCLUDED.included_call_count,call_overage_rate_cents=EXCLUDED.call_overage_rate_cents,
    usage_anchor_at=EXCLUDED.usage_anchor_at,initial_period_end=EXCLUDED.initial_period_end,paid_base_through=EXCLUDED.paid_base_through,
    current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,
    stripe_subscription_status=CASE WHEN tenant_billing_accounts.stripe_subscription_id=EXCLUDED.stripe_subscription_id THEN tenant_billing_accounts.stripe_subscription_status ELSE NULL END,
    monthly_amount_override_cents=NULL,lead_rate_override_cents=NULL,call_overage_rate_override_cents=NULL,active_coupon_redemption_id=NULL,coupon_trial_ends_at=NULL,coupon_discount_starts_at=NULL,coupon_discount_ends_at=NULL`,
    [key,purchaseId,row.stripe_customer_id,row.stripe_subscription_id,row.stripe_price_id,row.billing_interval,plan.monthlyAmountCents,plan.includedCallCount,plan.callOverageRateCents,row.usage_anchor_at,row.initial_period_end]);
  if(recovered)await persistPaidInitialCoverage(db,key,purchaseId,recovered);
  // Only bootstrap once. A worker retry must never overwrite subsequent owner edits.
  const initialized=(await db.query("SELECT 1 FROM audit_log WHERE tenant_key=$1 AND action='paid_intake.initialized'",[key])).rowCount;
  if(!initialized){
   await syncCanonicalKnowledgePacks(db);
   await db.query("INSERT INTO tenant_live_prompt_settings(tenant_key,mode) VALUES($1,'pending_v20') ON CONFLICT(tenant_key) DO NOTHING",[key]);
   await db.query("INSERT INTO tenant_settings(tenant_key,timezone,notes) VALUES($1,'America/Los_Angeles',$2) ON CONFLICT(tenant_key) DO NOTHING",[key,payload.companyDescription]);
   await db.query("INSERT INTO routing_rules(tenant_key,primary_queue,emergency_behavior,after_hours_behavior,business_hours) VALUES($1,'Dispatch Team','handoff_or_emergency_redirect','capture_and_callback','Mon-Fri 7:00 AM - 8:00 PM') ON CONFLICT(tenant_key) DO NOTHING",[key]);
   await loadTenantBusinessHours(db,key);
   if(!(await db.query('SELECT 1 FROM tenant_bootstrap_profiles WHERE tenant_key=$1',[key])).rowCount)await saveTenantBootstrapProfile(db,key,{websiteUrl:payload.website,companyDescription:payload.companyDescription,businessCategory:payload.businessCategory,sourceMode:payload.website?'website':'setup_interview',marketingAttribution:payload.marketingAttribution});
   const assignments=await resolveTenantDomainAssignments(db,key,inferKnowledgeAssignmentsForIndustry(payload.businessCategory));
   if(!(await db.query('SELECT 1 FROM tenant_prompt_profiles WHERE tenant_key=$1',[key])).rowCount)await saveTenantPromptProfile(db,key,{business_name:payload.businessName,company_description:payload.companyDescription},actor);
   if(!(await db.query('SELECT 1 FROM business_call_intents WHERE tenant_key=$1',[key])).rowCount)await saveBusinessCallIntent(db,key,defaultBusinessIntent(payload),actor);
   if(!(await db.query('SELECT 1 FROM knowledge_runtime_profiles WHERE tenant_key=$1',[key])).rowCount)await saveKnowledgeRuntimeProfile(db,key,defaultRuntimeProfile(payload),actor);
   if(!(await db.query('SELECT 1 FROM call_outcome_schemas WHERE tenant_key=$1',[key])).rowCount)await saveCallOutcomeSchema(db,key,defaultCallOutcomeSchema(payload,assignments),actor);
   if(!payload.website)await saveSetupInterviewIntent(db,key,{status:'approved_live',primaryGoal:`Confirm business facts for ${payload.businessName}.`,requiredCaptureCategories:['business_overview','services','hours','service_area','handoff_paths']});
   await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,'paid_intake.initialized',$3)",[key,`tenant:${owner.id}`,JSON.stringify({purchaseId})]);
  }
  await db.query("UPDATE tenants SET status='setup_pending',plan_code=$2,billing_status='active',app_access_status='enabled',trial_end=NULL,trial_started_at=NULL WHERE tenant_key=$1",[key,row.plan_code]);
  if(row.prospect_id)await db.query("UPDATE sales_prospects SET tenant_key=$2,status='paid',last_outcome='paid',updated_at=NOW() WHERE prospect_id=$1",[row.prospect_id,key]);
  return {...row,tenant_key:key,payload,ownerId:owner.id};
 });
}
export async function processPaidIntakeJobs(pool,{limit=2,enqueue=enqueuePaidIntakeKnowledgeBuild,provision=provisionPaidVoiceNumber,prepareRestart=preparePaidReinstatementNumber,stripe=null,now=new Date()}={}) {
 const jobs=await claimPaidPurchaseWork(pool,'provisioning',{limit}),lease=jobs.token;
 const results=[];
 for(const job of jobs.rows){try{
  const row=await convertPaidIntake(pool,job.purchase_id,{leaseToken:lease,stripe,now});
  let buildId=row.build_id;
  await renewPaidPurchaseWork(pool,row.purchase_id,lease);
  if(row.kind!=='restart'&&row.payload.website&&!buildId){
   const assignments=await resolveTenantDomainAssignments(pool,row.tenant_key,inferKnowledgeAssignmentsForIndustry(row.payload.businessCategory));
   const build=await enqueue(pool,row.tenant_key,{purchaseId:row.purchase_id,websiteUrl:row.payload.website,assignments});
   buildId=build?.build?.build_id||build?.build_id;
   if(!buildId)throw Error('initial_build_identity_missing');
   await pool.query('UPDATE paid_purchases SET build_id=$2 WHERE purchase_id=$1 AND lease_token=$3',[row.purchase_id,buildId,lease]);
  }
  await renewPaidPurchaseWork(pool,row.purchase_id,lease);
  if(row.kind==='restart')await prepareRestart(pool,row.tenant_key,row.purchase_id);
  const voice=await provision({pool,purchaseId:row.purchase_id,tenantKey:row.tenant_key,primaryNumber:row.payload.leadPhone,callerIdName:row.payload.businessName,
   actor:`tenant:${row.ownerId}`,stage:'number_setup',runningStatusDetail:'Preparing your paid account’s voice number.',
   successAuditAction:'paid_intake.number_provisioned',failureAuditAction:'paid_intake.number_failed'});
  if(voice?.ok===false)throw Error('voice_provisioning_pending');
  if(row.kind==='restart')await pool.query('UPDATE tenant_billing_accounts SET service_ended_at=NULL WHERE tenant_key=$1 AND paid_purchase_id=$2',[row.tenant_key,row.purchase_id]);
  await ensureCurrentBillingPeriod(pool,row.tenant_key);
  await cleanupPaidProspect(pool,row);
  await pool.query("UPDATE paid_purchases SET provisioning_status=CASE WHEN kind='restart' THEN 'complete' ELSE 'awaiting_knowledge_review' END,last_error=NULL,lease_until=NULL,lease_token=NULL,updated_at=NOW() WHERE purchase_id=$1 AND lease_token=$2",[row.purchase_id,lease]);
  results.push({purchaseId:row.purchase_id,status:'awaiting_knowledge_review'});
 }catch(e){await finishPaidPurchaseWork(pool,'provisioning',job.purchase_id,lease,{error:e});results.push({purchaseId:job.purchase_id,status:'failed'});}}
 return {claimedCount:jobs.rowCount,results};
}
export async function cleanupPaidProspect(pool,row) {
 if(!row.prospect_id)return;
 // Preserve provider uncertainty and immutable delivery snapshots. Only unsent work is canceled.
 await intakeTransaction(pool,async db=>{
  await db.query("UPDATE sales_prospects SET status='paid',last_outcome='paid',updated_at=NOW() WHERE prospect_id=$1",[row.prospect_id]);
  await db.query("UPDATE paid_intake_sales_references SET revoked_at=COALESCE(revoked_at,NOW()) WHERE checkout_id IN(SELECT checkout_id FROM sales_checkout_sessions WHERE prospect_id=$1)",[row.prospect_id]);
  await db.query("UPDATE sales_signup_invitations SET status='revoked',revoked_at=COALESCE(revoked_at,NOW()),updated_at=NOW() WHERE prospect_id=$1 AND revoked_at IS NULL",[row.prospect_id]);
  await db.query("UPDATE sales_demo_jobs SET status='canceled',updated_at=NOW() WHERE prospect_id=$1 AND status IN('queued','retry') AND locked_at IS NULL",[row.prospect_id]);
  await db.query("UPDATE sales_demo_profiles SET status='archived',updated_at=NOW() WHERE prospect_id=$1",[row.prospect_id]);
  await db.query("UPDATE sales_followup_jobs SET status='canceled',updated_at=NOW() WHERE prospect_id=$1 AND status IN('queued','retry') AND attempts=0 AND provider_result_json='{}'::jsonb AND locked_at IS NULL AND outcome NOT IN ('do_not_call','signup_completed','not_interested','wrong_number')",[row.prospect_id]);
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,'system:paid-intake','paid_intake.prospect_archived',$2)",[row.tenant_key,JSON.stringify({purchaseId:row.purchase_id,prospectId:row.prospect_id})]);
 });
}
