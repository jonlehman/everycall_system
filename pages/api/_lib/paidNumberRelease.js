import { getOwnedPhoneNumber, releaseVoiceNumber } from './telnyx.js';

async function transaction(pool, work) {
 const db=await pool.connect();
 try { await db.query('BEGIN'); const value=await work(db); await db.query('COMMIT'); return value; }
 catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

// Persist submission before I/O. A crash/timeout means reconcile only, never
// blindly retry a destructive provider request or race it with a new order.
export async function reconcilePaidNumberRelease(pool,tenantKey,{purchaseId=null,now=new Date(),getOwned=getOwnedPhoneNumber,release=releaseVoiceNumber}={}) {
 const claim=await transaction(pool,async db=>{
  const tenant=(await db.query('SELECT * FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  if(!tenant)throw Error('tenant_not_found');
  const account=(await db.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1',[tenantKey])).rows[0];
  if(!account?.paid_purchase_id)throw Error('paid_account_required');
  if(!purchaseId&&tenant.telnyx_release_status==='released')return null;
  if(purchaseId){
   const paid=(await db.query("SELECT * FROM paid_purchases WHERE purchase_id=$1 AND tenant_key=$2 AND kind='restart' AND payment_status='paid' AND livemode=TRUE AND recurring_consent_at IS NOT NULL",[purchaseId,tenantKey])).rows[0];
   if(!paid)throw Error('verified_restart_required');
   if((await db.query("SELECT 1 FROM billing_invoice_debts WHERE tenant_key=$1 AND status IN ('open','uncollectible') AND amount_remaining_cents>0",[tenantKey])).rowCount)throw Error('outstanding_debt_requires_settlement');
   const prior=(await db.query('SELECT * FROM paid_number_releases WHERE purchase_id=$1',[purchaseId])).rows[0];
   if(prior?.status==='released')return {row:prior,submit:false};
  }else{
   const due=(await db.query("SELECT 1 FROM billing_delinquencies WHERE tenant_key=$1 AND restriction IN ('suspended','ended') AND number_release_at<=$2",[tenantKey,now])).rowCount;
   if(!due&&!tenant.telnyx_release_status)return null;
  }
  let row=(await db.query('SELECT * FROM paid_number_releases WHERE tenant_key=$1 AND reconciled_at IS NULL FOR UPDATE',[tenantKey])).rows[0];
  if(!row){
   // An existing legacy release fence is already uncertain: adopt it, do not send.
   row=(await db.query(`INSERT INTO paid_number_releases(tenant_key,purchase_id,reason,phone_number,phone_number_id,status)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[tenantKey,purchaseId,purchaseId?'reinstatement':'retention',tenant.telnyx_release_number||tenant.telnyx_voice_number,
    tenant.telnyx_release_number_id||tenant.telnyx_voice_number_id,tenant.telnyx_release_status?'uncertain':'prepared'])).rows[0];
  }
  const submit=row.status==='prepared';
  if(submit)await db.query("UPDATE paid_number_releases SET status='submitted',attempted_at=$2 WHERE release_id=$1",[row.release_id,now]);
  await db.query(`UPDATE tenants SET telnyx_release_status='submitted',telnyx_release_number=$2,telnyx_release_number_id=$3,
   telnyx_release_requested_at=COALESCE(telnyx_release_requested_at,$4),telnyx_voice_status='release_pending',
   service_access_status='disabled',app_access_status='enabled',billing_lock_reason='voice_number_release_pending' WHERE tenant_key=$1`,[tenantKey,row.phone_number,row.phone_number_id,now]);
  return {row,submit};
 });
 if(!claim)return {released:false,notDue:true};
 if(claim.row.status==='released')return {released:true,releaseId:claim.row.release_id};
 const {row,submit}=claim;
 let absent=!row.phone_number,jobId=null,errorCode=null;
 try{
  if(row.phone_number){
   const owned=await getOwned({phoneNumber:row.phone_number});
   absent=!owned;
   if(owned&&row.phone_number_id&&String(owned.phoneNumberId)!==String(row.phone_number_id))throw Error('phone_number_ownership_changed');
   if(owned&&submit){const result=await release({phoneNumber:row.phone_number});jobId=result?.data?.id||result?.id||null;absent=!await getOwned({phoneNumber:row.phone_number});}
  }
 }catch(error){errorCode=error.message==='phone_number_ownership_changed'?error.message:'provider_release_uncertain';}
 await transaction(pool,async db=>{
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey]);
  const current=(await db.query('SELECT * FROM paid_number_releases WHERE release_id=$1 FOR UPDATE',[row.release_id])).rows[0];
  if(current.status==='released')return;
  await db.query(`UPDATE paid_number_releases SET status=$2,reconciled_at=CASE WHEN $3::boolean THEN $4::timestamptz ELSE NULL END,
   provider_job_id=COALESCE($5,provider_job_id),last_error=$6 WHERE release_id=$1`,[row.release_id,absent?'released':errorCode?'uncertain':'submitted',absent,now,jobId,errorCode]);
  await db.query(`UPDATE tenants SET telnyx_release_status=$2,telnyx_release_error=$3,
   telnyx_voice_number=CASE WHEN $4 AND telnyx_voice_number IS NOT DISTINCT FROM $5 THEN NULL ELSE telnyx_voice_number END,
   telnyx_voice_number_id=CASE WHEN $4 AND telnyx_voice_number IS NOT DISTINCT FROM $5 THEN NULL ELSE telnyx_voice_number_id END,
   telnyx_voice_order_id=CASE WHEN $4 AND telnyx_voice_number IS NOT DISTINCT FROM $5 THEN NULL ELSE telnyx_voice_order_id END,
   telnyx_voice_status=CASE WHEN $4 THEN 'released' ELSE 'release_pending' END,service_access_status='disabled',app_access_status='enabled',
   billing_lock_reason=CASE WHEN $4 THEN 'voice_number_replacement_required' ELSE 'voice_number_release_pending' END WHERE tenant_key=$1`,[tenantKey,absent?'released':errorCode?'failed':'submitted',errorCode,absent,row.phone_number]);
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,'system:billing',$2,$3)",[tenantKey,absent?'billing.number_release.reconciled':'billing.number_release.pending',JSON.stringify({releaseId:row.release_id,providerJobId:jobId,errorCode})]);
 });
 return {released:absent,releaseId:row.release_id};
}

export async function preparePaidReinstatementNumber(pool,tenantKey,purchaseId,options={}){
 const result=await reconcilePaidNumberRelease(pool,tenantKey,{...options,purchaseId});
 if(!result.released)throw Error('paid_number_release_pending');
 await transaction(pool,async db=>{
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey]);
  const receipt=(await db.query('SELECT * FROM paid_number_releases WHERE release_id=$1',[result.releaseId])).rows[0];
  if(!receipt||receipt.status!=='released')throw Error('paid_number_release_pending');
  // The prior retention release can satisfy this restart. Bind a separate receipt
  // so job retries after assigning the replacement do not delete that new number.
  if(!receipt.purchase_id)await db.query('UPDATE paid_number_releases SET purchase_id=$2 WHERE release_id=$1',[result.releaseId,purchaseId]);
  await db.query(`UPDATE tenants SET telnyx_release_status=NULL,telnyx_release_number=NULL,telnyx_release_number_id=NULL,
   telnyx_release_requested_at=NULL,telnyx_release_error=NULL,telnyx_release_job_id=NULL,
   billing_lock_reason='new_number_forwarding_required',service_access_status='disabled',app_access_status='enabled' WHERE tenant_key=$1`,[tenantKey]);
  await db.query('UPDATE tenant_billing_accounts SET changed_number_ack_required=TRUE WHERE tenant_key=$1',[tenantKey]);
 });
 return {ready:true,newNumberRequired:true};
}
