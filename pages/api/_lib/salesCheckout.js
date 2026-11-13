import { issueIntakeSalesReference } from './paidIntake.js';
import { hasSalesLiveCheckoutWebhook } from './salesCheckoutReadiness.js';
import { DEFAULT_SALES_SIGNUP_AMOUNT_CENTS, validSalesSignupAmount, formatSalesSignupAmount } from '../../../lib/salesSignupAmount.js';
import { normalizeSalesCheckoutPhone } from '../../../lib/salesCheckoutRecipient.js';
import { resolveSalesContactTarget } from './salesCompanyContacts.js';
import { SALES_TEST_NUMBERS } from './salesPhoneTestMode.js';
import Stripe from 'stripe';
import crypto from 'node:crypto';
import { getStripe } from './stripe.js';
import { getSharedSmsNumber } from './alerts.js';
import { sendTelnyxSms } from './telnyx.js';
import { sendTransactionalEmail } from './mail.js';
import { getSalesCallSession,getSalesProspect,salesError,evaluateSalesCallingWindow } from './salesRepository.js';
import { assertSalesCallAdmin } from './salesCallView.js';
import { SALES_UNSUPPRESSED_SQL, assertSalesProspectOwner, salesTransaction } from './salesDialer.js';

export function getSalesTestStripe(env=process.env) {
 const key=String(env.SALES_STRIPE_TEST_SECRET_KEY||'').trim();
 if(!/^(sk|rk)_test_/.test(key))throw salesError('sales_test_checkout_not_configured','Configure SALES_STRIPE_TEST_SECRET_KEY with a Stripe test key before sending test links.',503);
 return new Stripe(key);
}

// An explicit delivery phone belongs to this checkout, not the saved contact.
// A supplied number ID must still bind to the exact selected contact/company phone.
function checkoutSmsRecipient(target, phone, isTest) {
 if(phone !== undefined) {
  const recipient=normalizeSalesCheckoutPhone(phone);
  if(!recipient)throw salesError('checkout_phone_required','Enter a valid text recipient with country code.');
  if(isTest) {
   if(recipient!==SALES_TEST_NUMBERS.find(number=>number.type==='cell').phoneE164)throw salesError('checkout_recipient_changed','Test checkout uses only the configured test phone.',409);
  } else if(target.numberId&&recipient!==target.phoneE164)throw salesError('contact_number_changed','The selected phone ID does not match the text recipient.',409);
  return recipient;
 }
 if(isTest)return SALES_TEST_NUMBERS.find(number=>number.type==='cell').phoneE164;
 if(target.contactSnapshot.numberType!=='cell')throw salesError('checkout_mobile_required','Enter a mobile number for this contact.',409);
 return target.phoneE164;
}

// Recheck before idempotency receipt lookup too: a stale confirmed UI must not
// replay another mode's receipt or authorize a newly restored customer number.
export async function validateSalesCheckoutRequest(pool,{amountCents,salesCallId=null,prospectId=null,repId,channel,email,phone,contactId,numberId,expectedRowVersion,expectedIsTest,confirmedRecipient,confirmedWithoutCall,env=process.env}) {
 if(amountCents!==undefined&&!validSalesSignupAmount(amountCents))throw salesError('invalid_signup_amount','Enter a signup charge from $1.00 to $999,999.99 with at most two decimal places.');
 const call=salesCallId?assertSalesCallAdmin(await getSalesCallSession(pool,salesCallId),repId):null;
 const id=call?.prospectId||prospectId;
 await assertSalesProspectOwner(pool,id,repId);
 const prospect=await getSalesProspect(pool,id);
 const target=await resolveSalesContactTarget(pool,id,{contactId:contactId||call?.metadata?.contact_id,numberId,expectedRowVersion,allowNoNumber:channel!=='sms'||phone!==undefined});
 if(call?.metadata?.contact_id&&target.contactId!==call.metadata.contact_id)throw salesError('checkout_contact_changed','Use the contact recorded on this call.',409);
 const mode=await pool.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE');
 const isTest=call?Boolean(call.metadata?.phone_test_mode):Boolean(mode.rows[0]?.phone_test_mode);
 if(!call&&confirmedWithoutCall!==true)throw salesError('checkout_confirmation_required','Confirm the signup link recipient.',409);
 if((!call||expectedIsTest!==undefined)&&expectedIsTest!==isTest)throw salesError('checkout_context_changed','Checkout mode changed. Refresh and confirm the recipient again.',409);
 const smsRecipient=channel==='sms'?checkoutSmsRecipient(target,phone,isTest):null;
 if(!call){
  const recipient=channel==='sms'?smsRecipient:String(email||'').trim().toLowerCase();
  if(!recipient||String(confirmedRecipient||'').trim().toLowerCase()!==recipient)throw salesError('checkout_recipient_changed','Checkout recipient changed. Refresh and confirm again.',409);
 }
 return isTest;
}

export async function sendSalesCheckout(pool,{amountCents,salesCallId=null,prospectId=null,confirmedWithoutCall=false,expectedIsTest,confirmedRecipient,repId,channel,email,phone,contactId,numberId,expectedRowVersion,env=process.env,stripe=null,sms=sendTelnyxSms,mail=sendTransactionalEmail}) {
 if(amountCents!==undefined&&!validSalesSignupAmount(amountCents))throw salesError('invalid_signup_amount','Enter a signup charge from $1.00 to $999,999.99 with at most two decimal places.');
 if(!salesCallId&&confirmedWithoutCall!==true)throw salesError('checkout_confirmation_required','Confirm the recipient before sending a signup link without a call.',409);
 if(!salesCallId&&!prospectId)throw salesError('prospect_required','Choose a prospect.');
 const call=salesCallId?assertSalesCallAdmin(await getSalesCallSession(pool,salesCallId),repId):null;
 const targetId=call?.prospectId||prospectId;
 if(call&&prospectId&&call.prospectId!==prospectId)throw salesError('checkout_context_mismatch','The call does not belong to this prospect.',409);
 const origin=new URL(env.APP_BASE_URL||'');if(!['https:','http:'].includes(origin.protocol))throw salesError('sales_app_url_required','Application URL is not configured.',503);
 // Provider readiness is checked outside transactions. An existing reservation
 // always wins the locked recheck below, including one created during lookup.
 let liveStripe = stripe;
 let liveCustomWebhookReady = false;
 const customAmount = amountCents !== undefined && amountCents !== DEFAULT_SALES_SIGNUP_AMOUNT_CENTS;
 if (customAmount) {
  await assertSalesProspectOwner(pool,targetId,repId);
  const mode = await pool.query('SELECT phone_test_mode,custom_signup_amount_enabled FROM sales_dialer_config WHERE id=TRUE');
  const isTest = call ? Boolean(call.metadata?.phone_test_mode) : Boolean(mode.rows[0]?.phone_test_mode);
  const existing = await pool.query('SELECT 1 FROM sales_checkout_sessions WHERE prospect_id=$1 AND is_test=$2 LIMIT 1',[targetId,isTest]);
  if (!isTest && mode.rows[0]?.custom_signup_amount_enabled && !existing.rowCount && (expectedIsTest === undefined || expectedIsTest === isTest)) {
   try {
    liveStripe = stripe || getStripe();
    liveCustomWebhookReady = await hasSalesLiveCheckoutWebhook(liveStripe,env.APP_BASE_URL);
   } catch { /* Return the generic readiness error only if a new reservation is needed. */ }
  }
 }
 // Reserve under the same mode/ownership fences as calls. A standalone checkout
 // is a real prospect payment context; it never creates or relabels a call.
 const reservation=await salesTransaction(pool,async db=>{
  const mode=await db.query('SELECT phone_test_mode,custom_signup_amount_enabled FROM sales_dialer_config WHERE id=TRUE FOR SHARE');
  if(call)await db.query('SELECT sales_call_id FROM sales_call_sessions WHERE sales_call_id=$1 FOR UPDATE',[salesCallId]);
  const owner=await db.query(`SELECT assigned_rep_user_id,${SALES_UNSUPPRESSED_SQL} AS unsuppressed FROM sales_prospects p WHERE prospect_id=$1 FOR UPDATE`,[targetId]);
  if(!owner.rowCount)throw salesError('prospect_not_found','Prospect not found.',404);
  if(Number(owner.rows[0].assigned_rep_user_id)!==Number(repId))throw salesError('prospect_forbidden','This prospect has been reassigned. Refresh your workspace.',403);
  const prospect=await getSalesProspect(db,targetId);
  const isTest=call?Boolean(call.metadata?.phone_test_mode):Boolean(mode.rows[0]?.phone_test_mode);
  if(call&&!isTest&&(mode.rows[0]?.phone_test_mode||prospect.phoneTestMode))throw salesError('sales_phone_test_external_action_blocked','A live call cannot send checkout while phone test mode is active.',409);
  if((!call||expectedIsTest!==undefined)&&expectedIsTest!==isTest)throw salesError('checkout_context_changed','Checkout mode changed. Refresh and confirm again.',409);
  if(isTest)getSalesTestStripe(env); // Validate configured test credentials before reserving or contacting providers.
  if(!isTest&&(call?.paidAt||prospect.status==='paid'||(await db.query('SELECT 1 FROM sales_checkout_sessions WHERE prospect_id=$1 AND paid_at IS NOT NULL LIMIT 1',[targetId])).rowCount))throw salesError('sales_prospect_already_paid','This customer has already paid for setup.',409);
  if(prospect.doNotCall||prospect.suppressed||!owner.rows[0].unsuppressed)throw salesError('prospect_suppressed','This prospect must not be contacted.',409);
  if(!call&&(!prospect.permissionGranted||['removed','not_interested'].includes(prospect.status)))throw salesError('prospect_not_contactable','This prospect is not available for signup delivery.',409);
  const target=await resolveSalesContactTarget(db,targetId,{contactId:contactId||call?.metadata?.contact_id,numberId,expectedRowVersion,allowNoNumber:channel!=='sms'||phone!==undefined});
  if(call?.metadata?.contact_id&&target.contactId!==call.metadata.contact_id)throw salesError('checkout_contact_changed','Use the contact recorded on this call.',409);
  const smsRecipient=channel==='sms'?checkoutSmsRecipient(target,phone,isTest):null;
  const delivery=channel;
  const testEmail=isTest&&delivery==='email'?String(env.SALES_CHECKOUT_TEST_EMAIL||(await db.query('SELECT email FROM admin_users WHERE id=$1',[repId])).rows[0]?.email||'').trim().toLowerCase():'';
  const recipient=isTest
   ?(delivery==='sms'?smsRecipient:testEmail)
   :(delivery==='sms'?smsRecipient:String(email||target.contactSnapshot.email||'').trim().toLowerCase());
  if(isTest&&delivery==='email'&&(!recipient||(email&&String(email).trim().toLowerCase()!==recipient)))throw salesError('sales_test_email_required','Use your account email or configured Sales test email for test checkout.',409);
  if(!call&&String(confirmedRecipient||'').trim().toLowerCase()!==recipient)throw salesError('checkout_recipient_changed','Checkout recipient changed. Refresh and confirm again.',409);
  if(!['sms','email'].includes(channel))throw salesError('invalid_delivery_channel','Choose text or email.');
  if(delivery==='email'&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||prospect.emailSuppressedAt))throw salesError('checkout_email_required','Enter an owner email that has not opted out.');
  if(delivery==='sms'&&(await db.query("SELECT 1 FROM sales_dnc_registry WHERE identity_type='phone' AND identity_value=$1",[recipient])).rowCount)throw salesError('prospect_suppressed','This recipient opted out.',409);
  if(delivery==='sms'&&!evaluateSalesCallingWindow(prospect.timezone).allowed)throw salesError('sms_quiet_hours','Text delivery is unavailable during the prospect’s quiet hours.',409);
  // Preserve a call's existing checkout identity; otherwise reuse the standalone
  // link. Prospect sends reuse an existing link instead of creating another charge.
  const existing=await db.query('SELECT * FROM sales_checkout_sessions WHERE prospect_id=$1 AND is_test=$2 ORDER BY (sales_call_id=$3) DESC NULLS LAST,created_at DESC LIMIT 1 FOR UPDATE',[targetId,isTest,salesCallId]);
  if(!existing.rowCount&&customAmount) {
   if(![100,10000].includes(amountCents))throw salesError('signup_amount_retired','New signup links use $100 or the authorized $1 live test.',409);
   if(isTest)throw salesError('custom_signup_amount_unavailable','New test signup links are fixed at $100.00.',409);
   if(!mode.rows[0]?.custom_signup_amount_enabled)throw salesError('custom_signup_amount_unavailable','The signup charge is currently fixed at $100.00. Refresh before changing it.',409);
   if(!liveCustomWebhookReady)throw salesError('sales_checkout_not_ready','Custom signup checkout is temporarily unavailable. Try again later or use the standard signup charge.',503);
  }
  const row=existing.rows[0]||(await db.query('INSERT INTO sales_checkout_sessions(checkout_id,sales_call_id,prospect_id,rep_user_id,channel,recipient,is_test,activation_status,contact_snapshot,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *',[`sales_checkout_${crypto.randomUUID()}`,salesCallId,targetId,repId,delivery,recipient,isTest,isTest?'test_only':'unpaid',JSON.stringify({...target.contactSnapshot,...(delivery==='sms'?{phoneE164:recipient,numberType:target.numberId?target.contactSnapshot.numberType:'cell'}:{}),email:delivery==='email'?recipient:target.contactSnapshot.email}),amountCents??DEFAULT_SALES_SIGNUP_AMOUNT_CENTS])).rows[0];
  if(amountCents!==undefined&&row.amount_cents!==amountCents)throw salesError('checkout_amount_exists',`This company's checkout is fixed at ${formatSalesSignupAmount(row.amount_cents)}. Use the existing amount and link.`,409);
  if(row.channel!==delivery||row.recipient!==recipient)throw salesError('checkout_delivery_exists',`This company's checkout is reserved for ${row.channel} to ${row.recipient}. Use the existing recipient; changing contacts cannot create another checkout.`,409);
  if(call&&!row.is_test&&['sent','paid','delivered'].includes(row.status))await db.query("UPDATE sales_call_sessions SET link_sent_at=COALESCE(link_sent_at,NOW()),updated_at=NOW() WHERE sales_call_id=$1",[salesCallId]);
  return {row,prospect,delivery,recipient};
 });
 const {row,prospect,delivery,recipient}=reservation;
 if(row.channel!==delivery||row.recipient!==recipient)throw salesError('checkout_delivery_exists',`This company's checkout is reserved for ${row.channel} to ${row.recipient}. Use the existing recipient; changing contacts cannot create another checkout.`,409);
 if(!row.is_test){
  const intakeUrl=await salesTransaction(pool,async db=>{
   await db.query('SELECT checkout_id FROM sales_checkout_sessions WHERE checkout_id=$1 FOR UPDATE',[row.checkout_id]);
   const url=await issueIntakeSalesReference(db,row);
   await db.query("UPDATE sales_checkout_sessions SET checkout_url=$2,status=CASE WHEN status='creating' THEN 'created' ELSE status END WHERE checkout_id=$1",[row.checkout_id,url]);
   return url;
  });
  row.checkout_url=intakeUrl;
  if(row.status==='creating')row.status='created';
 }
 if(row.is_test&&!row.stripe_session_id){
  const client=stripe||(row.is_test?getSalesTestStripe(env):liveStripe||getStripe());
  const session=await client.checkout.sessions.create({mode:'payment',payment_method_types:['card'],line_items:[{price_data:{currency:'usd',unit_amount:row.amount_cents,product_data:{name:row.is_test?'EveryCall TEST setup — no real charge':'EveryCall setup — first month included'}},quantity:1}],client_reference_id:row.checkout_id,metadata:{sales_checkout_id:row.checkout_id,...(row.sales_call_id?{sales_call_id:row.sales_call_id}:{}),sales_prospect_id:row.prospect_id,sales_checkout_test:String(row.is_test)},success_url:`${origin.origin}/sales/checkout-result?status=success`,cancel_url:`${origin.origin}/sales/checkout-result?status=cancelled`,...(delivery==='email'?{customer_email:row.recipient}:{})},{idempotencyKey:row.checkout_id});
  if(row.is_test&&session.livemode!==false)throw salesError('sales_test_checkout_mode_mismatch','Stripe did not return a test checkout. No link was sent.',502);
  if(!row.is_test&&session.livemode!==true)throw salesError('sales_live_checkout_mode_mismatch','Stripe did not return a live checkout. No link was sent.',502);
  if(!session.id||!session.url)throw salesError('checkout_creation_failed','Stripe did not return a checkout link.',502);
  await pool.query("UPDATE sales_checkout_sessions SET stripe_session_id=$2,checkout_url=$3,status=CASE WHEN status='creating' THEN 'created' ELSE status END,updated_at=NOW() WHERE checkout_id=$1 AND stripe_session_id IS NULL",[row.checkout_id,session.id,session.url]);
  // Another request may have completed delivery while this idempotent Stripe
  // create was in flight. Reload without ever moving its delivery state back.
  const refreshed=await pool.query('SELECT * FROM sales_checkout_sessions WHERE checkout_id=$1',[row.checkout_id]);
  Object.assign(row,refreshed.rows[0]);
 }
 if(['sent','paid','delivered','test_complete'].includes(row.status)){
  return {url:row.checkout_url,channel:row.channel,status:row.status,isTest:row.is_test,recipient:row.recipient,amountCents:row.amount_cents,contactSnapshot:row.contact_snapshot,reused:true};
 }
 // Never blindly repeat an uncertain provider send (Mailtrap/Telnyx do not guarantee idempotent sends).
 const claim=await pool.query("UPDATE sales_checkout_sessions SET status='sending',updated_at=NOW() WHERE checkout_id=$1 AND status='created' RETURNING checkout_id",[row.checkout_id]);
 if(!claim.rowCount)throw salesError('checkout_delivery_pending','Delivery is pending verification. Do not resend until its provider status is reconciled.',409);
 let message;
 try {
  const content=`${row.is_test?"TEST ONLY — no real charge. ":""}EveryCall setup is ${formatSalesSignupAmount(row.amount_cents)} and includes your first month. Secure checkout: ${row.checkout_url}`;
  if(delivery==='sms') {
   const from=await getSharedSmsNumber(pool);if(!from)throw salesError('sales_sms_not_configured','The shared SMS sender is not configured.',503);
   message=await sms({from,to:recipient,text:`${content} Reply STOP to opt out.`});
  } else message=await mail({to:recipient,subject:'Your EveryCall setup link',text:content,category:'Sales Checkout',idempotencyKey:row.checkout_id});
 } catch(error){await pool.query("UPDATE sales_checkout_sessions SET status='delivery_uncertain',updated_at=NOW() WHERE checkout_id=$1",[row.checkout_id]);throw error;}
 const messageId=message?.data?.id||message?.id||null;
 await salesTransaction(pool,async db=>{await db.query("UPDATE sales_checkout_sessions SET status=CASE WHEN status='test_complete' THEN status WHEN paid_at IS NULL THEN 'sent' ELSE 'paid' END,provider_message_id=$2,updated_at=NOW() WHERE checkout_id=$1",[row.checkout_id,messageId]);if(!row.is_test)await db.query("UPDATE sales_call_sessions SET link_sent_at=COALESCE(link_sent_at,NOW()),outcome=CASE WHEN paid_at IS NULL THEN 'signup_link_sent' ELSE 'paid' END,updated_at=NOW() WHERE sales_call_id=$1",[salesCallId]);});
 return {url:row.checkout_url,channel:delivery,status:'sent',isTest:row.is_test,recipient:row.recipient,amountCents:row.amount_cents,contactSnapshot:row.contact_snapshot};
}
// Called only after the existing Stripe handler verifies the signature, inside its transaction.
export async function applySalesPaidCheckout(db,event,{testWebhook=false}={}) {
 const session=event.data?.object||{};
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)||!session.metadata?.sales_checkout_id)return false;
 const result=await db.query('SELECT * FROM sales_checkout_sessions WHERE checkout_id=$1 FOR UPDATE',[session.metadata.sales_checkout_id]);const row=result.rows[0];
 if(!row||row.stripe_session_id!==session.id||(row.sales_call_id||null)!==(session.metadata.sales_call_id||null)||row.prospect_id!==session.metadata.sales_prospect_id)throw salesError('sales_checkout_mismatch','Checkout identity did not match.',409);
 if(!validSalesSignupAmount(row.amount_cents)||session.currency!=='usd'||!Number.isSafeInteger(session.amount_total)||session.amount_total!==row.amount_cents||session.mode!=='payment')throw salesError('sales_payment_mismatch','Checkout amount or currency did not match.',409);
 if(Boolean(row.is_test)!==testWebhook)throw salesError('sales_checkout_mode_mismatch','Checkout webhook mode did not match.',409);
 if(row.is_test){
  if(event.livemode!==false||session.livemode!==false||session.metadata.sales_checkout_test!=='true')throw salesError('sales_checkout_mode_mismatch','Expected a Stripe test checkout.',409);
  if(session.payment_status!=='paid')return true;
  await db.query("UPDATE sales_checkout_sessions SET status='test_complete',stripe_event_id=COALESCE(stripe_event_id,$2),updated_at=NOW() WHERE checkout_id=$1",[row.checkout_id,event.id]);
  return true;
 }
 if(event.livemode!==true||session.livemode!==true||session.metadata.sales_checkout_test==='true')throw salesError('sales_checkout_mode_mismatch','A test checkout cannot authorize a customer payment.',409);
 if(session.payment_status!=='paid'||row.paid_at)return true;
 await db.query("UPDATE sales_checkout_sessions SET paid_at=NOW(),status='paid',stripe_event_id=$2,activation_status='queued',updated_at=NOW() WHERE checkout_id=$1",[row.checkout_id,event.id]);
 if(row.sales_call_id)await db.query("UPDATE sales_call_sessions SET paid_at=COALESCE(paid_at,NOW()),outcome='paid',updated_at=NOW() WHERE sales_call_id=$1",[row.sales_call_id]);
 await db.query("UPDATE sales_prospects SET status='paid',last_outcome='paid',last_outcome_at=NOW(),updated_at=NOW() WHERE prospect_id=$1",[row.prospect_id]);
 return true;
}

export async function getSalesCheckoutContext(pool,{prospectId,salesCallId,repId}) {
 return salesTransaction(pool,async db=>{
 await db.query('SELECT id FROM sales_dialer_config WHERE id=TRUE FOR SHARE');
 await db.query('SELECT prospect_id FROM sales_prospects WHERE prospect_id=$1 FOR SHARE',[prospectId]);
 const call=salesCallId?assertSalesCallAdmin(await getSalesCallSession(db,salesCallId),repId):null;
 if(call&&call.prospectId!==prospectId)throw salesError('checkout_context_mismatch','Call does not belong to this company.',409);
 await assertSalesProspectOwner(db,prospectId,repId);
 const mode=await db.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE');
 const isTest=call?Boolean(call.metadata?.phone_test_mode):Boolean(mode.rows[0]?.phone_test_mode);
 const result=await db.query('SELECT channel,recipient,status,checkout_url,is_test,contact_snapshot,amount_cents FROM sales_checkout_sessions WHERE prospect_id=$1 AND is_test=$2 ORDER BY created_at DESC LIMIT 1',[prospectId,isTest]);
 const row=result.rows[0];
 return row?{channel:row.channel,recipient:row.recipient,status:row.status,url:row.checkout_url,isTest:row.is_test,amountCents:row.amount_cents,contactSnapshot:row.contact_snapshot}:null;
 });
}
