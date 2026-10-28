import { assertSalesNotTestCall } from './salesPhoneTestMode.js';
import crypto from 'node:crypto';
import { getStripe } from './stripe.js';
import { getSharedSmsNumber } from './alerts.js';
import { sendTelnyxSms } from './telnyx.js';
import { sendTransactionalEmail } from './mail.js';
import { getSalesCallSession,getSalesProspect,salesError,evaluateSalesCallingWindow } from './salesRepository.js';
import { assertSalesCallAdmin } from './salesCallView.js';
import { salesTransaction } from './salesDialer.js';

export async function sendSalesCheckout(pool,{salesCallId,repId,channel,email,env=process.env,stripe=null,sms=sendTelnyxSms,mail=sendTransactionalEmail}) {
 const call=assertSalesCallAdmin(await getSalesCallSession(pool,salesCallId),repId);const prospect=await getSalesProspect(pool,call.prospectId);
 assertSalesNotTestCall(call,prospect);
 // Payment belongs to the customer; a followup call must not create another setup charge.
 if(call.paidAt||prospect.status==='paid'||(await pool.query('SELECT 1 FROM sales_checkout_sessions WHERE prospect_id=$1 AND paid_at IS NOT NULL LIMIT 1',[call.prospectId])).rowCount)throw salesError('sales_prospect_already_paid','This customer has already paid for setup.',409);
 if(prospect.doNotCall||prospect.suppressed)throw salesError('prospect_suppressed','This prospect must not be contacted.',409);
 const cell=prospect.numbers.find(n=>n.type==='cell');
 const delivery=channel==='sms'&&cell?'sms':'email';const recipient=delivery==='sms'?cell.phoneE164:String(email||prospect.contactEmail||'').trim().toLowerCase();
 if(!['sms','email'].includes(channel))throw salesError('invalid_delivery_channel','Choose text or email.');
 if(delivery==='email'&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||prospect.emailSuppressedAt))throw salesError('checkout_email_required','Enter an owner email that has not opted out.');
 if(delivery==='sms'&&(await pool.query("SELECT 1 FROM sales_dnc_registry WHERE identity_type='phone' AND identity_value=$1",[recipient])).rowCount)throw salesError('prospect_suppressed','This recipient opted out.',409);
 if(delivery==='sms'&&!evaluateSalesCallingWindow(prospect.timezone).allowed)throw salesError('sms_quiet_hours','Text delivery is unavailable during the prospect’s quiet hours.',409);
 const origin=new URL(env.APP_BASE_URL||'');if(!['https:','http:'].includes(origin.protocol))throw salesError('sales_app_url_required','Application URL is not configured.',503);
 const row=await salesTransaction(pool,async db=>{
  const mode=await db.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE FOR SHARE');
  assertSalesNotTestCall(call,{phoneTestMode:mode.rows[0]?.phone_test_mode});
  await db.query('SELECT sales_call_id FROM sales_call_sessions WHERE sales_call_id=$1 FOR UPDATE',[salesCallId]);
  const existing=await db.query('SELECT * FROM sales_checkout_sessions WHERE sales_call_id=$1 FOR UPDATE',[salesCallId]);
  if(existing.rowCount)return existing.rows[0];
  const result=await db.query('INSERT INTO sales_checkout_sessions(checkout_id,sales_call_id,prospect_id,rep_user_id,channel,recipient) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[`sales_checkout_${crypto.randomUUID()}`,salesCallId,call.prospectId,repId,delivery,recipient]);return result.rows[0];
 });
 if(row.channel!==delivery||row.recipient!==recipient)throw salesError('checkout_delivery_exists','A checkout link already exists for a different delivery address. Use the existing link.',409);
 if(!row.stripe_session_id){
  const client=stripe||getStripe();
  const session=await client.checkout.sessions.create({mode:'payment',payment_method_types:['card'],line_items:[{price_data:{currency:'usd',unit_amount:10000,product_data:{name:'EveryCall setup — first month included'}},quantity:1}],client_reference_id:row.checkout_id,metadata:{sales_checkout_id:row.checkout_id,sales_call_id:salesCallId,sales_prospect_id:call.prospectId},success_url:`${origin.origin}/sales/checkout-result?status=success`,cancel_url:`${origin.origin}/sales/checkout-result?status=cancelled`,...(prospect.contactEmail?{customer_email:prospect.contactEmail}:{})},{idempotencyKey:row.checkout_id});
  if(!session.id||!session.url)throw salesError('checkout_creation_failed','Stripe did not return a checkout link.',502);
  await pool.query("UPDATE sales_checkout_sessions SET stripe_session_id=$2,checkout_url=$3,status=CASE WHEN status='creating' THEN 'created' ELSE status END,updated_at=NOW() WHERE checkout_id=$1 AND stripe_session_id IS NULL",[row.checkout_id,session.id,session.url]);
  // Another request may have completed delivery while this idempotent Stripe
  // create was in flight. Reload without ever moving its delivery state back.
  const refreshed=await pool.query('SELECT * FROM sales_checkout_sessions WHERE checkout_id=$1',[row.checkout_id]);
  Object.assign(row,refreshed.rows[0]);
 }
 if(['sent','paid','delivered'].includes(row.status))return {url:row.checkout_url,channel:row.channel,status:row.status};
 // Never blindly repeat an uncertain provider send (Mailtrap/Telnyx do not guarantee idempotent sends).
 const claim=await pool.query("UPDATE sales_checkout_sessions SET status='sending',updated_at=NOW() WHERE checkout_id=$1 AND status='created' RETURNING checkout_id",[row.checkout_id]);
 if(!claim.rowCount)throw salesError('checkout_delivery_pending','Delivery is pending verification. Do not resend until its provider status is reconciled.',409);
 let message;
 try {
  const content=`EveryCall setup is $100 and includes your first month. Secure checkout: ${row.checkout_url}`;
  if(delivery==='sms') {
   const from=await getSharedSmsNumber(pool);if(!from)throw salesError('sales_sms_not_configured','The shared SMS sender is not configured.',503);
   message=await sms({from,to:recipient,text:`${content} Reply STOP to opt out.`});
  } else message=await mail({to:recipient,subject:'Your EveryCall setup link',text:content,category:'Sales Checkout',idempotencyKey:row.checkout_id});
 } catch(error){await pool.query("UPDATE sales_checkout_sessions SET status='delivery_uncertain',updated_at=NOW() WHERE checkout_id=$1",[row.checkout_id]);throw error;}
 const messageId=message?.data?.id||message?.id||null;
 await salesTransaction(pool,async db=>{await db.query("UPDATE sales_checkout_sessions SET status=CASE WHEN paid_at IS NULL THEN 'sent' ELSE 'paid' END,provider_message_id=$2,updated_at=NOW() WHERE checkout_id=$1",[row.checkout_id,messageId]);await db.query("UPDATE sales_call_sessions SET link_sent_at=COALESCE(link_sent_at,NOW()),outcome=CASE WHEN paid_at IS NULL THEN 'signup_link_sent' ELSE 'paid' END,updated_at=NOW() WHERE sales_call_id=$1",[salesCallId]);});
 return {url:row.checkout_url,channel:delivery,status:'sent'};
}
// Called only after the existing Stripe handler verifies the signature, inside its transaction.
export async function applySalesPaidCheckout(db,event) {
 const session=event.data?.object||{};
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)||!session.metadata?.sales_checkout_id)return false;
 if(session.payment_status!=='paid')return true;
 if(session.currency!=='usd'||Number(session.amount_total)!==10000||session.mode!=='payment')throw salesError('sales_payment_mismatch','Checkout amount or currency did not match.',409);
 const result=await db.query('SELECT * FROM sales_checkout_sessions WHERE checkout_id=$1 FOR UPDATE',[session.metadata.sales_checkout_id]);const row=result.rows[0];
 if(!row||row.stripe_session_id!==session.id||row.sales_call_id!==session.metadata.sales_call_id||row.prospect_id!==session.metadata.sales_prospect_id)throw salesError('sales_checkout_mismatch','Checkout identity did not match.',409);
 if(row.paid_at)return true;
 await db.query("UPDATE sales_checkout_sessions SET paid_at=NOW(),status='paid',stripe_event_id=$2,activation_status='queued',updated_at=NOW() WHERE checkout_id=$1",[row.checkout_id,event.id]);
 await db.query("UPDATE sales_call_sessions SET paid_at=COALESCE(paid_at,NOW()),outcome='paid',updated_at=NOW() WHERE sales_call_id=$1",[row.sales_call_id]);
 await db.query("UPDATE sales_prospects SET status='paid',last_outcome='paid',last_outcome_at=NOW(),updated_at=NOW() WHERE prospect_id=$1",[row.prospect_id]);
 return true;
}
