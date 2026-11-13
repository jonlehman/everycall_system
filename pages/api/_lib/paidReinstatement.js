import {purchaseTerms,purchaseTermsMessage} from './paidPurchaseContract.js';
import crypto from 'node:crypto';
import { getStripe } from './stripe.js';
import { assertPaidIntakeEnabled,intakeTransaction,intakeError,verifiedPrice } from './paidIntake.js';
import { STANDARD_BILLING_PLANS } from '../../../lib/standardBillingPlans.js';
const id=value=>typeof value==='string'?value:value?.id;

// Owner authorization is performed by the API. This function never restores service.
export async function beginPaidReinstatement(pool,tenantKey,owner,body,{stripe=getStripe()}={}) {
 await assertPaidIntakeEnabled(pool);
 if(body.consentAccepted!==true)throw intakeError('recurring_consent_required',400);
 const plan=STANDARD_BILLING_PLANS.find(p=>p.code===body.planCode),interval=body.billingInterval;
 if(!plan||!['month','year'].includes(interval))throw intakeError('plan_and_interval_required',400);
 const priceId=await verifiedPrice(pool,stripe,plan.code,interval);
 return intakeTransaction(pool,async db=>{
  const tenant=(await db.query('SELECT * FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  const account=(await db.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  if(!tenant||!account?.service_ended_at||!account.stripe_customer_id)throw intakeError('ended_service_required');
  if(account.stripe_subscription_id){
   const old=await stripe.subscriptions.retrieve(account.stripe_subscription_id);
   if(old.livemode!==true||id(old.customer)!==account.stripe_customer_id||!['canceled','incomplete_expired'].includes(old.status))throw intakeError('existing_subscription_use_recovery');
  }
  // Reconcile all provider debts, including a payment whose webhook has not arrived.
  for await(const invoice of stripe.invoices.list({customer:account.stripe_customer_id,limit:100})){
   if(invoice.livemode!==true)throw intakeError('billing_mode_mismatch');
   if(['open','uncollectible'].includes(invoice.status)&&invoice.amount_remaining>0)throw intakeError('outstanding_debt_requires_payment');
  }
  if((await db.query("SELECT 1 FROM billing_invoice_debts WHERE tenant_key=$1 AND status IN('open','uncollectible') AND amount_remaining_cents>0",[tenantKey])).rowCount)throw intakeError('outstanding_debt_reconciliation_required');
  let row=(await db.query("SELECT * FROM paid_purchases WHERE tenant_key=$1 AND kind='restart' AND provisioning_status NOT IN('complete','review') FOR UPDATE",[tenantKey])).rows[0];
  if(row && (row.plan_code!==plan.code||row.billing_interval!==interval))throw intakeError('restart_already_reserved');
  if(row?.payment_status==='paid')return {status:'payment_processing',purchaseId:row.purchase_id};
  if(!row){
   let intake=(await db.query('SELECT * FROM paid_intakes WHERE owner_email=$1',[owner.email.toLowerCase()])).rows[0];
   if(!intake)intake=(await db.query(`INSERT INTO paid_intakes(intake_id,owner_email,payload_json,intended_tenant_key,verified_at)
    VALUES($1,$2,$3::jsonb,$4,NOW()) RETURNING *`,[`intake_${crypto.randomUUID()}`,owner.email.toLowerCase(),JSON.stringify({businessName:tenant.name,businessCategory:tenant.industry||'service_business',leadPhone:'',website:'',loginEmail:owner.email.toLowerCase(),planCode:plan.code,billingInterval:interval}),tenantKey])).rows[0];
   row=(await db.query(`INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,tenant_key,plan_code,billing_interval,livemode,amount_cents,setup_amount_cents,kind,stripe_customer_id,stripe_price_id)
    VALUES($1,$2,$3,$4,$5,$6,TRUE,$7,0,'restart',$8,$9) RETURNING *`,[`purchase_${crypto.randomUUID()}`,intake.intake_id,owner.email.toLowerCase(),tenantKey,plan.code,interval,interval==='year'?plan.annualAmountCents:plan.monthlyAmountCents,account.stripe_customer_id,priceId])).rows[0];
  }
  if(row.stripe_session_id){
   const current=await stripe.checkout.sessions.retrieve(row.stripe_session_id);
   if(current.status==='open'&&current.url)return {checkoutUrl:current.url,purchaseId:row.purchase_id};
   if(current.status==='complete')return {status:'payment_processing',purchaseId:row.purchase_id};
   if(current.status!=='expired'||current.subscription||current.payment_intent||current.payment_status==='paid')throw intakeError('checkout_reconciliation_required');
   row=(await db.query('UPDATE paid_purchases SET stripe_session_id=NULL,checkout_params=NULL,checkout_started_at=NULL,checkout_generation=checkout_generation+1 WHERE purchase_id=$1 RETURNING *',[row.purchase_id])).rows[0];
  }
  if(row.checkout_started_at&&Date.now()-new Date(row.checkout_started_at)>23*3600000)throw intakeError('checkout_uncertainty_requires_reconciliation');
  const origin=new URL(process.env.APP_BASE_URL).origin;
  const metadata={paid_purchase_id:row.purchase_id,paid_intake_id:row.intake_id,tenant_key:tenantKey,plan_code:row.plan_code,billing_interval:row.billing_interval,paid_checkout_generation:String(row.checkout_generation)};
  const terms=row.consent_terms_json||purchaseTerms(row);
  await db.query('UPDATE paid_purchases SET consent_terms_json=$2::jsonb,consent_accepted_at=COALESCE(consent_accepted_at,NOW()) WHERE purchase_id=$1',[row.purchase_id,JSON.stringify(terms)]);
  const params=row.checkout_params||{mode:'payment',customer:account.stripe_customer_id,payment_method_types:['card'],client_reference_id:row.purchase_id,
   line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:row.amount_cents,product_data:{name:`EveryCall ${row.plan_code} — full new ${row.billing_interval==='year'?'year':'month'}`}}}],metadata,
   payment_intent_data:{setup_future_usage:'off_session',metadata},invoice_creation:{enabled:true,invoice_data:{metadata}},consent_collection:{terms_of_service:'required'},
   success_url:`${origin}/client/account/billing?restart=processing`,cancel_url:`${origin}/client/account/billing`,
   custom_text:{submit:{message:purchaseTermsMessage(terms)+' No setup fee or free month. A new phone number requires updated call forwarding.'}}};
  await db.query("UPDATE paid_purchases SET checkout_started_at=COALESCE(checkout_started_at,NOW()),checkout_params=$2::jsonb,payment_status='pending' WHERE purchase_id=$1",[row.purchase_id,JSON.stringify(params)]);
  await db.query('COMMIT');await db.query('BEGIN');
  await db.query('SELECT purchase_id FROM paid_purchases WHERE purchase_id=$1 FOR UPDATE',[row.purchase_id]);
  const checkout=await stripe.checkout.sessions.create(params,{idempotencyKey:`${row.purchase_id}:checkout:${row.checkout_generation}`});
  if(checkout.livemode!==true||!checkout.id||!checkout.url)throw intakeError('checkout_mode_mismatch',502);
  await db.query('UPDATE paid_purchases SET stripe_session_id=$2,checkout_url=$3 WHERE purchase_id=$1',[row.purchase_id,checkout.id,checkout.url]);
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,'billing.restart.checkout',$3)",[tenantKey,`tenant:${owner.id}`,JSON.stringify({purchaseId:row.purchase_id})]);
  return {checkoutUrl:checkout.url,purchaseId:row.purchase_id};
 });
}
