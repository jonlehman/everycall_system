import {findAvailableVoiceNumber,getOwnedPhoneNumber,orderVoiceNumber,updatePhoneNumberVoiceSettings} from './telnyx.js';
import {getVoiceProvisioningAreaCode,normalizeCallerIdName} from './voiceProvisioning.js';
import {intakeTransaction} from './paidIntake.js';

export async function provisionPaidVoiceNumber({pool,tenantKey,purchaseId,primaryNumber,callerIdName,
 findAvailable=findAvailableVoiceNumber,getOwned=getOwnedPhoneNumber,order=orderVoiceNumber,updateSettings=updatePhoneNumberVoiceSettings}) {
 const claim=await intakeTransaction(pool,async db=>{
  const tenant=(await db.query('SELECT * FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  const purchase=(await db.query("SELECT * FROM paid_purchases WHERE purchase_id=$1 AND tenant_key=$2 AND payment_status='paid' AND livemode=TRUE AND recurring_consent_at IS NOT NULL",[purchaseId,tenantKey])).rows[0];
  if(!purchase||!tenant)throw Error('paid_purchase_required');
  if(tenant.telnyx_release_status)throw Error('voice_number_release_pending');
  if(tenant.telnyx_voice_number)return {existing:true,phoneNumber:tenant.telnyx_voice_number};
  const old=(await db.query('SELECT * FROM paid_number_orders WHERE purchase_id=$1',[purchaseId])).rows[0];
  if(old)return {row:old,submit:false};
  const connectionId=process.env.TELNYX_VOICE_CONNECTION_ID;
  if(!connectionId)throw Error('TELNYX_VOICE_CONNECTION_ID missing');
  const candidate=await findAvailable({areaCode:getVoiceProvisioningAreaCode(primaryNumber)});
  if(!candidate?.phoneNumber)throw Error('voice_number_unavailable');
  if((await db.query('SELECT 1 FROM paid_number_releases WHERE tenant_key=$1 AND phone_number=$2',[tenantKey,candidate.phoneNumber])).rowCount)throw Error('replacement_number_must_differ');
  if(await getOwned({phoneNumber:candidate.phoneNumber}))throw Error('voice_candidate_already_owned');
  const row=(await db.query(`INSERT INTO paid_number_orders(purchase_id,tenant_key,phone_number,connection_id,candidate_json,status)
   VALUES($1,$2,$3,$4,$5::jsonb,'submitted') RETURNING *`,[purchaseId,tenantKey,candidate.phoneNumber,connectionId,JSON.stringify(candidate)])).rows[0];
  return {row,submit:true};
 });
 if(claim.existing)return {ok:true,alreadyProvisioned:true,phoneNumber:claim.phoneNumber};
 const {row}=claim;
 if(claim.submit){
  const result=await order({phoneNumber:row.phone_number,connectionId:row.connection_id});
  await pool.query('UPDATE paid_number_orders SET provider_order_id=$2 WHERE purchase_id=$1',[purchaseId,result?.data?.id||null]);
 }
 // Submitted-but-unconfirmed orders are read-reconciled forever; never place a second order.
 const owned=await getOwned({phoneNumber:row.phone_number});
 if(!owned?.phoneNumberId)throw Error('voice_order_reconciliation_pending');
 if(owned.connectionId!==row.connection_id)throw Error('voice_order_connection_mismatch');
 await intakeTransaction(pool,async db=>{
  const tenant=(await db.query('SELECT * FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  if(tenant.telnyx_release_status||(tenant.telnyx_voice_number&&tenant.telnyx_voice_number!==row.phone_number))throw Error('voice_assignment_conflict');
  await db.query(`UPDATE tenants SET telnyx_voice_number=$2,telnyx_voice_number_id=$3,
   telnyx_voice_order_id=(SELECT provider_order_id FROM paid_number_orders WHERE purchase_id=$4),
   telnyx_voice_status='provisioning',telnyx_voice_purchased_at=$5,
   telnyx_voice_monthly_cost_cents=$6,telnyx_voice_upfront_cost_cents=$7 WHERE tenant_key=$1`,
   [tenantKey,row.phone_number,owned.phoneNumberId,purchaseId,row.submitted_at,Math.round(Number(row.candidate_json.monthlyCost||0)*100),Math.round(Number(row.candidate_json.upfrontCost||0)*100)]);
  await db.query("UPDATE paid_number_orders SET status='assigned',phone_number_id=$2,assigned_at=NOW() WHERE purchase_id=$1",[purchaseId,owned.phoneNumberId]);
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,'system:paid-intake','paid_intake.number_assigned',$2)",[tenantKey,JSON.stringify({purchaseId,phoneNumberId:owned.phoneNumberId})]);
 });
 if(callerIdName)await updateSettings({phoneNumberId:owned.phoneNumberId,callerIdName:normalizeCallerIdName(callerIdName)});
 return {ok:true,phoneNumber:row.phone_number};
}
