import {STANDARD_BILLING_PLANS} from '../../../lib/standardBillingPlans.js';
import {calendarMonthBoundary} from '../../../lib/paidBillingCalendar.js';
import {intakeError} from './paidIntake.js';
export const PURCHASE_TERMS_VERSION='UPIB-2026-11-12-v1';
export function purchaseTerms(row){
 const plan=STANDARD_BILLING_PLANS.find(p=>p.code===row.plan_code);
 return {version:PURCHASE_TERMS_VERSION,planCode:row.plan_code,billingInterval:row.billing_interval,currency:'usd',
  amountDueCents:row.amount_cents,setupAmountCents:row.setup_amount_cents,
  recurringAmountCents:row.billing_interval==='year'?plan.annualAmountCents:plan.monthlyAmountCents,
  includedCallsPerMonth:plan.includedCallCount,callOverageRateCents:plan.callOverageRateCents,overageCollectionInterval:'month',
  firstBaseDue:row.kind==='restart'?'one_full_paid_term_after_payment':'one_calendar_month_after_setup_payment',
  cancellation:'current_paid_term_end',anniversary:'original_payment_utc_calendar_anniversary',kind:row.kind};
}
export function purchaseTermsMessage(terms){
 return `I authorize $${(terms.recurringAmountCents/100).toFixed(2)} every ${terms.billingInterval==='year'?'year':'month'}, starting after ${terms.kind==='restart'?'the full period paid today':'the first calendar month included in setup'}. ${terms.includedCallsPerMonth} calls each month; $${(terms.callOverageRateCents/100).toFixed(2)} per additional billable call, billed monthly. Cancellation takes effect at paid-term end.`;
}
// The committed timestamp fences customer creation even if the process dies before
// persisting the provider response. No new key after Stripe's retention window.
export async function ensurePurchaseCustomer(db,row,stripe){
 if(row.stripe_customer_id)return row;
 await db.query('UPDATE paid_purchases SET customer_started_at=COALESCE(customer_started_at,NOW()) WHERE purchase_id=$1',[row.purchase_id]);
 await db.query('COMMIT');await db.query('BEGIN');
 row=(await db.query('SELECT * FROM paid_purchases WHERE purchase_id=$1 FOR UPDATE',[row.purchase_id])).rows[0];
 if(row.stripe_customer_id)return row;
 let customer;
 if(Date.now()-new Date(row.customer_started_at)>23*3600000){
  const candidates=[];let count=0;
  for await(const c of stripe.customers.list({email:row.owner_email,limit:100})){if(++count>500)throw intakeError('customer_reconciliation_required');if(c.metadata?.paid_purchase_id===row.purchase_id)candidates.push(c);}
  if(candidates.length!==1)throw intakeError('customer_reconciliation_required');customer=candidates[0];
 }else customer=await stripe.customers.create({email:row.owner_email,metadata:{paid_purchase_id:row.purchase_id,app:'everycall'}},{idempotencyKey:`${row.purchase_id}:customer`});
 if(customer.livemode!==true||!customer.id||customer.metadata?.paid_purchase_id!==row.purchase_id)throw intakeError('customer_identity_mismatch');
 return (await db.query('UPDATE paid_purchases SET stripe_customer_id=$2 WHERE purchase_id=$1 RETURNING *',[row.purchase_id,customer.id])).rows[0];
}
export function paidSubscriptionParams(row,paymentMethod){
 const paidAt=new Date(row.paid_at),months=row.kind==='restart'&&row.billing_interval==='year'?12:1;
 const end=calendarMonthBoundary(paidAt,months);
 const anchor={day_of_month:paidAt.getUTCDate(),hour:paidAt.getUTCHours(),minute:paidAt.getUTCMinutes(),second:paidAt.getUTCSeconds(),...(row.billing_interval==='year'?{month:end.getUTCMonth()+1}:{})};
 return {customer:row.stripe_customer_id,items:[{price:row.stripe_price_id,quantity:1}],default_payment_method:paymentMethod,
  // Stripe's trial field defers collection for a period already paid through
  // Checkout. Anchor configuration alone can charge again in the payment second.
  // This is never an unpaid product trial or an entitlement source.
  billing_mode:{type:'flexible'},trial_end:Math.floor(end.getTime()/1000),billing_cycle_anchor_config:anchor,proration_behavior:'none',collection_method:'charge_automatically',payment_behavior:'error_if_incomplete',
  metadata:{app:'everycall',paid_purchase_id:row.purchase_id,paid_intake_id:row.intake_id,plan_code:row.plan_code,billing_interval:row.billing_interval,...(row.tenant_key?{tenant_key:row.tenant_key}:{})}};
}
