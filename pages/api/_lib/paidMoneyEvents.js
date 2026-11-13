import {getStripe} from './stripe.js';

const MONEY_EVENTS=new Set(['charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.created','refund.updated','refund.failed']);
const id=value=>typeof value==='string'?value:value?.id||null;
const fail=()=>{throw Error('money_review_identity_mismatch');};

// The Stripe account also serves unrelated businesses. Resolve ownership before
// either webhook receipts or review rows may persist a financial payload.
export async function resolvePaidMoneyEventScope(db,event,{stripe}={}) {
 if(!MONEY_EVENTS.has(event.type))return null;
 if(event.livemode!==true)throw Error('money_review_mode_mismatch');
 stripe||=getStripe();
 const original=event.data?.object||{};
 if(!original.id)fail();
 const canonical=event.type==='charge.refunded'?await stripe.charges.retrieve(original.id)
  :event.type.startsWith('refund.')?await stripe.refunds.retrieve(original.id):await stripe.disputes.retrieve(original.id);
 if(!canonical||canonical.id!==original.id)fail();
 if(canonical.livemode===false)fail();
 let charge=event.type==='charge.refunded'?canonical:null;
 if(!charge&&id(canonical.charge))charge=await stripe.charges.retrieve(id(canonical.charge));
 if(!charge&&id(canonical.payment_intent)){
  const payment=await stripe.paymentIntents.retrieve(id(canonical.payment_intent));
  if(payment?.id!==id(canonical.payment_intent)||payment.livemode!==true)fail();
  if(id(payment.latest_charge))charge=await stripe.charges.retrieve(id(payment.latest_charge));
 }
 if(!charge?.id||charge.livemode!==true)fail();
 if(id(canonical.charge)&&id(canonical.charge)!==charge.id)fail();
 const paymentId=id(charge.payment_intent),customerId=id(charge.customer);
 if(id(canonical.payment_intent)&&id(canonical.payment_intent)!==paymentId)fail();
 if(id(original.charge)&&id(original.charge)!==charge.id)fail();
 if(id(original.payment_intent)&&id(original.payment_intent)!==paymentId)fail();
 if(id(original.customer)&&id(original.customer)!==customerId)fail();
 const purchases=(await db.query(`SELECT purchase_id,tenant_key,intake_id,stripe_customer_id,stripe_payment_intent_id,legacy_payment_intent_id
  FROM paid_purchases WHERE livemode=TRUE AND
  (($1::text IS NOT NULL AND (stripe_payment_intent_id=$1 OR legacy_payment_intent_id=$1))
   OR ($2::text IS NOT NULL AND stripe_customer_id=$2))`,[paymentId,customerId])).rows;
 const exact=purchases.filter(p=>paymentId&&(p.stripe_payment_intent_id===paymentId||p.legacy_payment_intent_id===paymentId));
 if(exact.length>1)fail();
 // A reused historical setup payment can predate the new recurring customer.
 // The modern payment binding, however, must agree with its frozen customer.
 if(exact.some(p=>p.stripe_payment_intent_id===paymentId&&p.stripe_customer_id&&p.stripe_customer_id!==customerId))fail();
 const accounts=customerId?(await db.query('SELECT tenant_key FROM tenant_billing_accounts WHERE stripe_customer_id=$1',[customerId])).rows:[];
 let legacy=[];
 if(!purchases.length&&!accounts.length&&paymentId){
  // Old Sales setup payments may have no Customer or local PaymentIntent yet.
  // Match the actual provider Session to its frozen local ID, never metadata.
  const existing=(await db.query('SELECT 1 FROM sales_checkout_sessions WHERE is_test=FALSE AND stripe_session_id IS NOT NULL LIMIT 1')).rowCount;
  if(existing){
   const sessions=await stripe.checkout.sessions.list({payment_intent:paymentId,limit:100});
   if(!Array.isArray(sessions.data)||sessions.has_more)throw Error('money_review_checkout_reconciliation_required');
   for(const session of sessions.data){
    const row=(await db.query('SELECT tenant_key,amount_cents FROM sales_checkout_sessions WHERE stripe_session_id=$1 AND is_test=FALSE',[session.id])).rows[0];
    if(!row)continue;
    if(session.livemode!==true||session.mode!=='payment'||session.payment_status!=='paid'||id(session.payment_intent)!==paymentId
     ||session.currency!=='usd'||session.amount_total!==row.amount_cents||id(session.customer)!==customerId)fail();
    legacy.push(row);
   }
   if(legacy.length>1)fail();
  }
 }
 const matches=[...purchases,...accounts,...legacy];
 const tenants=new Set(matches.map(row=>row.tenant_key).filter(Boolean));
 const unconverted=new Set(purchases.filter(row=>!row.tenant_key).map(row=>row.intake_id));
 if(tenants.size>1||unconverted.size>1||(unconverted.size&&tenants.size))fail();
 return {matched:matches.length>0,tenantKey:[...tenants][0]||null};
}
