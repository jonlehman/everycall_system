import {claimPaidPurchaseWork,finishPaidPurchaseWork} from './paidPurchaseWork.js';
import {getStripe} from './stripe.js';
import {intakeError,intakeTransaction} from './paidIntake.js';
import {paidSubscriptionParams,PURCHASE_TERMS_VERSION} from './paidPurchaseContract.js';
import {calendarMonthBoundary} from '../../../lib/paidBillingCalendar.js';
const id=value=>typeof value==='string'?value:value?.id;

export async function applyPaidPurchaseEvent(db,event,{stripe=getStripe()}={}) {
 const object=event.data?.object||{};
 if(['charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.created','refund.updated','refund.failed'].includes(event.type)) {
  if(event.livemode!==true)throw intakeError('money_review_mode_mismatch');
  const charge=object.charge?await stripe.charges.retrieve(id(object.charge)):object;
  const customerId=id(object.customer)||id(charge.customer)||null;
  await db.query(`INSERT INTO billing_money_reviews(stripe_event_id,event_type,stripe_object_id,tenant_key,payload_json)
   VALUES($1,$2,$3,COALESCE((SELECT tenant_key FROM paid_purchases WHERE stripe_payment_intent_id=$4 OR legacy_payment_intent_id=$4 LIMIT 1),(SELECT tenant_key FROM tenant_billing_accounts WHERE stripe_customer_id=$6 LIMIT 1)),$5::jsonb)
   ON CONFLICT(stripe_event_id) DO NOTHING`,[event.id,event.type,object.id,id(object.payment_intent)||id(charge.payment_intent)||null,JSON.stringify(object),customerId]);
  return true;
 }
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)||!object.metadata?.paid_purchase_id)return false;
 const row=(await db.query('SELECT * FROM paid_purchases WHERE purchase_id=$1 FOR UPDATE',[object.metadata.paid_purchase_id])).rows[0];
 if(!row)throw intakeError('purchase_not_found');
 const session=await stripe.checkout.sessions.retrieve(object.id);
 if(event.livemode!==true||session.livemode!==true||!row.livemode||session.mode!==(row.amount_cents>0?'payment':'setup')
  ||session.client_reference_id!==row.purchase_id||session.metadata?.paid_purchase_id!==row.purchase_id||session.metadata?.paid_intake_id!==row.intake_id
  ||(row.amount_cents>0&&(session.currency!=='usd'||session.amount_total!==row.amount_cents))
  ||id(session.customer)!==row.stripe_customer_id||(row.stripe_session_id&&row.stripe_session_id!==session.id))throw intakeError('purchase_payment_mismatch');
 if(session.status!=='complete')return true;
 if(!row.consent_accepted_at||row.consent_terms_json?.version!==PURCHASE_TERMS_VERSION||session.consent?.terms_of_service!=='accepted')throw intakeError('recurring_consent_required');
 if(row.payment_status==='paid')return true;
 let paidAt,paymentMethod,paymentIntent;
 if(row.amount_cents>0){
  if(session.payment_status!=='paid')return true;
  const intent=await stripe.paymentIntents.retrieve(id(session.payment_intent),{expand:['latest_charge']});
  if(intent.livemode!==true||intent.status!=='succeeded'||intent.amount_received!==row.amount_cents||intent.currency!=='usd'
   ||id(intent.customer)!==row.stripe_customer_id||intent.metadata?.paid_purchase_id!==row.purchase_id||!intent.latest_charge?.paid||!intent.latest_charge?.captured||!intent.latest_charge.created)throw intakeError('purchase_payment_intent_mismatch');
  paidAt=new Date(intent.latest_charge.created*1000);paymentMethod=id(intent.payment_method);paymentIntent=intent.id;
 }else{
  if(!row.legacy_checkout_id||!row.legacy_payment_intent_id||!row.paid_at)throw intakeError('verified_legacy_purchase_required');
  const intent=await stripe.setupIntents.retrieve(id(session.setup_intent));
  if(intent.livemode!==true||intent.status!=='succeeded'||id(intent.customer)!==row.stripe_customer_id||intent.metadata?.paid_purchase_id!==row.purchase_id)throw intakeError('purchase_setup_intent_mismatch');
  const legacy=await stripe.paymentIntents.retrieve(row.legacy_payment_intent_id,{expand:['latest_charge']});
  if(legacy.livemode!==true||legacy.status!=='succeeded'||legacy.amount_received!==row.setup_amount_cents||legacy.currency!=='usd'||!legacy.latest_charge?.paid)throw intakeError('verified_legacy_purchase_required');
  paidAt=new Date(row.paid_at);paymentMethod=id(intent.payment_method);paymentIntent=null;
 }
 const method=paymentMethod?await stripe.paymentMethods.retrieve(paymentMethod):null;
 if(!method||method.livemode!==true||id(method.customer)!==row.stripe_customer_id)throw intakeError('purchase_payment_method_mismatch');
 const end=calendarMonthBoundary(paidAt,row.kind==='restart'&&row.billing_interval==='year'?12:1);
 if(end.getTime()<=Date.now())throw intakeError('purchase_term_reconciliation_required');
 const params=paidSubscriptionParams({...row,paid_at:paidAt},paymentMethod);
 // Webhook commits payment and exact future subscription params, but does no
 // provider creation inside its transaction. Recovery worker owns that effect.
 await db.query(`UPDATE paid_purchases SET payment_status='paid',provisioning_status='awaiting_subscription',stripe_session_id=$2,
  stripe_invoice_id=$3,stripe_payment_intent_id=$4,verified_event_id=$5,paid_at=$6,usage_anchor_at=$6,initial_period_end=$7,
  subscription_params=$8::jsonb,updated_at=NOW() WHERE purchase_id=$1`,
  [row.purchase_id,session.id,id(session.invoice)||null,paymentIntent,event.id,paidAt,end,JSON.stringify(params)]);
 return true;
}

export async function establishPaidSubscriptions(pool,{stripe=getStripe(),limit=10}={}){
 const claim=await claimPaidPurchaseWork(pool,'subscription',{limit}),candidates=claim.rows;
 for(const candidate of candidates){try{
  const reservation=await intakeTransaction(pool,async db=>{
   const row=(await db.query('SELECT * FROM paid_purchases WHERE purchase_id=$1 FOR UPDATE',[candidate.purchase_id])).rows[0];
   if(row.recurring_consent_at||row.lease_token!==claim.token)return null;
   const first=!row.subscription_started_at;
   await db.query('UPDATE paid_purchases SET subscription_started_at=COALESCE(subscription_started_at,NOW()) WHERE purchase_id=$1',[row.purchase_id]);
   return {row,first};
  });
  if(!reservation)continue;
  await intakeTransaction(pool,async db=>{
   const row=(await db.query('SELECT * FROM paid_purchases WHERE purchase_id=$1 FOR UPDATE',[candidate.purchase_id])).rows[0];
   if(row.recurring_consent_at||row.lease_token!==claim.token)return;
   let subscription;
   if(!reservation.first){
    const matches=[];let count=0;
    for await(const sub of stripe.subscriptions.list({customer:row.stripe_customer_id,status:'all',limit:100})){
     if(++count>500)throw intakeError('subscription_reconciliation_required');
     if(sub.metadata?.paid_purchase_id===row.purchase_id)matches.push(sub);
    }
    if(matches.length>1)throw intakeError('duplicate_subscription_review_required');
    subscription=matches[0];
   }
   if(!subscription){
    if(Date.now()-new Date(row.subscription_started_at)>23*3600000)throw intakeError('subscription_uncertainty_requires_reconciliation');
    if(new Date(row.initial_period_end).getTime()<=Date.now())throw intakeError('purchase_term_reconciliation_required');
    subscription=await stripe.subscriptions.create(row.subscription_params,{idempotencyKey:`${row.purchase_id}:subscription`});
   }
   const canonical=await stripe.subscriptions.retrieve(subscription.id,{expand:['latest_invoice']});
   const item=canonical.items?.data?.[0],end=item?.current_period_end||canonical.current_period_end;
   const expected=row.subscription_params.billing_cycle_anchor_config;
   if(canonical.livemode!==true||canonical.billing_mode?.type!=='flexible'||canonical.status!=='active'||id(canonical.customer)!==row.stripe_customer_id||canonical.metadata?.paid_purchase_id!==row.purchase_id
    ||canonical.items?.data?.length!==1||id(item.price)!==row.stripe_price_id||Number(item.quantity)!==1||canonical.items?.has_more
    ||id(canonical.default_payment_method)!==row.subscription_params.default_payment_method
    ||['day_of_month','month','hour','minute','second'].some(k=>expected[k]!==undefined&&canonical.billing_cycle_anchor_config?.[k]!==expected[k])
    ||end!==Math.floor(new Date(row.initial_period_end).getTime()/1000))throw intakeError('purchase_subscription_mismatch');
   const invoice=canonical.latest_invoice?typeof canonical.latest_invoice==='object'?canonical.latest_invoice:await stripe.invoices.retrieve(canonical.latest_invoice):null;
   if(invoice&&(invoice.amount_due!==0||invoice.amount_paid!==0))throw intakeError('unexpected_initial_base_invoice');
   await db.query("UPDATE paid_purchases SET stripe_subscription_id=$2,recurring_consent_at=consent_accepted_at,provisioning_status='queued',last_error=NULL,updated_at=NOW() WHERE purchase_id=$1",[row.purchase_id,canonical.id]);
  });
  await finishPaidPurchaseWork(pool,'subscription',candidate.purchase_id,claim.token);
 }catch(error){await finishPaidPurchaseWork(pool,'subscription',candidate.purchase_id,claim.token,{error});}}
 return {checked:candidates.length};
}

export async function reconcilePaidPurchases(pool,{stripe=getStripe(),limit=10}={}) {
 const claim=await claimPaidPurchaseWork(pool,'payment',{limit}),rows=claim.rows;
 for(const row of rows){try{
  let session;
  if(row.stripe_session_id)session=await stripe.checkout.sessions.retrieve(row.stripe_session_id);
  else if(row.stripe_customer_id&&row.checkout_started_at){
   const matches=[];let count=0;
   for await(const current of stripe.checkout.sessions.list({customer:row.stripe_customer_id,limit:100})){
    if(++count>500)throw intakeError('checkout_reconciliation_required');
    if(current.metadata?.paid_purchase_id===row.purchase_id&&current.metadata?.paid_checkout_generation===String(row.checkout_generation))matches.push(current);
   }
   if(matches.length>1)throw intakeError('duplicate_checkout_review_required');session=matches[0];
   if(session)await pool.query('UPDATE paid_purchases SET stripe_session_id=$2,checkout_url=$3 WHERE purchase_id=$1 AND stripe_session_id IS NULL AND lease_token=$4',[row.purchase_id,session.id,session.url,claim.token]);
  }
  if(session?.status==='complete')await intakeTransaction(pool,db=>applyPaidPurchaseEvent(db,{id:`reconcile:${session.id}`,livemode:session.livemode,type:'checkout.session.completed',data:{object:session}},{stripe}));
  await finishPaidPurchaseWork(pool,'payment',row.purchase_id,claim.token,{poll:true});
 }catch(error){await finishPaidPurchaseWork(pool,'payment',row.purchase_id,claim.token,{error});}}
 await establishPaidSubscriptions(pool,{stripe,limit});
 return {checked:rows.length};
}
