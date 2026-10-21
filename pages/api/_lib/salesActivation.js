import crypto from 'node:crypto';
import { salesTransaction } from './salesDialer.js';
import { enqueueSalesPaidKnowledgeBuild } from './knowledgeReceptionistBuilds.js';
import { inferKnowledgeAssignmentsForIndustry,resolveTenantDomainAssignments } from './knowledgeReceptionistPacks.js';
import { saveTenantBootstrapProfile } from './tenantBootstrapProfiles.js';
import { saveTenantPromptProfile } from './promptBlueprints.js';

export async function ensureSalesDemoTenant(pool,prospectId) {
 return salesTransaction(pool,async db=>{
  const result=await db.query('SELECT * FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE',[prospectId]);const prospect=result.rows[0];if(!prospect)throw Error('sales_prospect_not_found');
  if(prospect.tenant_key)return prospect.tenant_key;
  const key=`sales_${crypto.randomUUID().replaceAll('-','')}`;
  await db.query(`INSERT INTO tenants(tenant_key,name,status,industry,service_access_status,app_access_status,billing_status,billing_lock_reason,live_prompt_mode) VALUES($1,$2,'sales_demo',$3,'disabled','disabled','unpaid','sales_payment_required','pending_v20')`,[key,prospect.business_name,prospect.business_category||'service_business']);
  await db.query('UPDATE sales_prospects SET tenant_key=$2 WHERE prospect_id=$1',[prospectId,key]);
  await db.query("INSERT INTO tenant_bootstrap_profiles(tenant_key,website_url,business_category,source_mode) VALUES($1,$2,$3,'website')",[key,prospect.website_url,prospect.business_category||'service_business']);
  return key;
 });
}
export async function processSalesPaidActivations(pool,{limit=2,enqueue=enqueueSalesPaidKnowledgeBuild,savePrompt=saveTenantPromptProfile,resolveAssignments=resolveTenantDomainAssignments}={}) {
 const jobs=await pool.query(`UPDATE sales_checkout_sessions SET activation_status='building',updated_at=NOW() WHERE checkout_id IN (SELECT checkout_id FROM sales_checkout_sessions WHERE paid_at IS NOT NULL AND (activation_status IN ('queued','failed') OR (activation_status='building' AND updated_at<NOW()-interval '15 minutes')) ORDER BY paid_at FOR UPDATE SKIP LOCKED LIMIT $1) RETURNING *`,[limit]);
 const results=[];
 for(const job of jobs.rows){try{
  const key=await ensureSalesDemoTenant(pool,job.prospect_id);const result=await pool.query('SELECT * FROM sales_prospects WHERE prospect_id=$1',[job.prospect_id]);const prospect=result.rows[0];
  await pool.query("UPDATE tenants SET status='setup_pending',billing_status='paid',billing_lock_reason='sales_setup_and_knowledge_review_required',service_access_status='disabled',app_access_status='disabled',updated_at=NOW() WHERE tenant_key=$1",[key]);
  await saveTenantBootstrapProfile(pool,key,{websiteUrl:prospect.website_url,businessCategory:prospect.business_category||'service_business',sourceMode:'website'});
  await savePrompt(pool,key,{business_name:prospect.business_name},{role:'sales',user_id:job.rep_user_id});
  const assignments=await resolveAssignments(pool,key,inferKnowledgeAssignmentsForIndustry(prospect.business_category||'service_business'));
  // Normal compiler, preserved raw captures and authority, and existing publication review.
  await pool.query("UPDATE sales_checkout_sessions SET tenant_key=$2 WHERE checkout_id=$1",[job.checkout_id,key]);
  const build=await enqueue(pool,key,{websiteUrl:prospect.website_url,buildKind:'website_base',assignments,checkoutId:job.checkout_id});
  await pool.query("UPDATE sales_checkout_sessions SET activation_status='awaiting_knowledge_review',tenant_key=$2,activation_error=NULL,updated_at=NOW() WHERE checkout_id=$1",[job.checkout_id,key]);
  results.push({checkoutId:job.checkout_id,tenantKey:key,status:'awaiting_knowledge_review',buildId:build?.build?.build_id||build?.build_id||null});
 }catch(error){await pool.query("UPDATE sales_checkout_sessions SET activation_status='failed',activation_error=$2,updated_at=NOW() WHERE checkout_id=$1",[job.checkout_id,String(error.message||error).slice(0,500)]);results.push({checkoutId:job.checkout_id,status:'failed'});}}
 return {claimedCount:jobs.rowCount,results};
}
