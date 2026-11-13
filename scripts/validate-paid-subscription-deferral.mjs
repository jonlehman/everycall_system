import assert from 'node:assert/strict';
import {capturePaidRequests} from './lib/paid-request-capture.mjs';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {paidSubscriptionParams,purchaseTerms} from '../pages/api/_lib/paidPurchaseContract.js';
import {establishPaidSubscriptions} from '../pages/api/_lib/paidPurchaseEvents.js';
import {calendarMonthBoundary} from '../lib/paidBillingCalendar.js';
import {STANDARD_BILLING_PLANS} from '../lib/standardBillingPlans.js';

const fixture=await createUpibTestFixture({label:'paiddeferral'}),{pool}=fixture;
const rows=new Map(),subscriptions=new Map(),creates=new Map(),faults=new Map();
const stripe={customers:{retrieve:async customer=>({id:customer,livemode:true,invoice_settings:{default_payment_method:`pm_${[...rows.values()].find(r=>r.stripe_customer_id===customer).purchase_id}`}})},subscriptions:{create:async(params)=>{
 const row=rows.get(params.metadata.paid_purchase_id);assert(row);creates.set(row.purchase_id,(creates.get(row.purchase_id)||0)+1);
 // The provider proof found same-second anchor-only creation charged immediately.
 // The local double therefore requires explicit deferral, never assumes a free gap.
 assert.equal(params.trial_end,row.end);assert.equal(params.default_payment_method,`pm_${row.purchase_id}`);
 const sub={...structuredClone(params),id:`sub_${row.purchase_id}`,livemode:true,status:'trialing',
  items:{data:[{price:params.items[0].price,quantity:1,current_period_start:Math.floor(new Date(row.paid_at)/1000),current_period_end:row.end}]},
  latest_invoice:{id:`in_${row.purchase_id}`,livemode:true,customer:row.stripe_customer_id,status:'paid',amount_due:0,amount_paid:0,total:0}};
 faults.get(row.purchase_id)?.(sub);subscriptions.set(sub.id,sub);return structuredClone(sub);
 },retrieve:async id=>structuredClone(subscriptions.get(id)),list:({customer})=>({async *[Symbol.asyncIterator](){for(const sub of subscriptions.values())if(sub.customer===customer)yield structuredClone(sub);}})}};
async function seed(name,{plan='starter',interval='month',kind='setup',paidAt='2028-01-31T12:34:56Z',legacy=false,fault}={}){
 const standard=STANDARD_BILLING_PLANS.find(p=>p.code===plan);
 const row={purchase_id:name,intake_id:name,owner_email:`${name}@fixture.invalid`,kind,plan_code:plan,billing_interval:interval,paid_at:paidAt,stripe_customer_id:`cus_${name}`,stripe_price_id:`price_${plan}_${interval}`,
  amount_cents:kind==='restart'?(interval==='year'?standard.annualAmountCents:standard.monthlyAmountCents):10000,setup_amount_cents:kind==='restart'?0:10000};
 row.end=Math.floor(calendarMonthBoundary(paidAt,kind==='restart'&&interval==='year'?12:1)/1000);
 const subscription=paidSubscriptionParams(row,`pm_${name}`);if(legacy)delete subscription.trial_end;const params={version:'paid-enrollment-v2',subscription,customerDefault:{mode:'preserve',value:`pm_${name}`}};
 rows.set(name,row);if(fault)faults.set(name,fault);
 await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json,verified_at) VALUES($1,$2,'{}',NOW())",[name,row.owner_email]);
 await pool.query(`INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,plan_code,billing_interval,livemode,amount_cents,setup_amount_cents,kind,payment_status,provisioning_status,stripe_customer_id,stripe_price_id,paid_at,usage_anchor_at,initial_period_end,subscription_params,consent_terms_json,consent_accepted_at)
 VALUES($1,$1,$2,$3,$4,TRUE,$5,$6,$7,'paid','awaiting_subscription',$8,$9,$10,$10,to_timestamp($11),$12::jsonb,$13::jsonb,NOW())`,
 [name,row.owner_email,plan,interval,row.amount_cents,row.setup_amount_cents,kind,row.stripe_customer_id,row.stripe_price_id,paidAt,row.end,JSON.stringify(params),JSON.stringify(purchaseTerms(row))]);
 return params;
}
try{
 let n=0;
 for(const paidAt of ['2027-01-31T12:34:56Z','2028-01-31T12:34:56Z','2028-02-29T12:34:56Z'])for(const plan of STANDARD_BILLING_PLANS)for(const interval of ['month','year'])for(const kind of ['setup','restart']){
  const params=(await seed(`calendar_${n++}`,{plan:plan.code,interval,kind,paidAt})).subscription;
  assert.equal(params.billing_cycle_anchor_config.day_of_month,new Date(paidAt).getUTCDate());
  assert.equal(params.billing_cycle_anchor_config.hour,12);assert.equal(params.billing_cycle_anchor_config.minute,34);assert.equal(params.billing_cycle_anchor_config.second,56);
  assert.equal(params.payment_settings.save_default_payment_method,'on_subscription');assert.equal(params.proration_behavior,'none');assert.equal(params.billing_mode.type,'flexible');
 }
 await establishPaidSubscriptions(pool,{stripe,limit:50});
 const accepted=(await pool.query('SELECT purchase_id,recurring_consent_at,subscription_params FROM paid_purchases')).rows;
 assert.equal(accepted.length,36);assert(accepted.every(p=>p.recurring_consent_at));assert.equal(creates.size,36);
 await establishPaidSubscriptions(pool,{stripe,limit:50});assert.equal([...creates.values()].reduce((a,b)=>a+b,0),36);
 capturePaidRequests('subscription-create-36',accepted.map(p=>({plan:rows.get(p.purchase_id).plan_code,interval:rows.get(p.purchase_id).billing_interval,kind:rows.get(p.purchase_id).kind,paidAt:rows.get(p.purchase_id).paid_at,request:p.subscription_params.subscription})));
 console.log('PASS 36 calendar contracts: all plans, monthly/annual setup/restart, Jan31 nonleap/leap and Feb29, original anniversary, explicit payment method and zero initial invoice');
 const original=await seed('old_frozen',{legacy:true});await establishPaidSubscriptions(pool,{stripe,limit:50});
 const blocked=(await pool.query("SELECT subscription_params,provisioning_status,last_error FROM paid_purchases WHERE purchase_id='old_frozen'")).rows[0];
 assert.equal(creates.get('old_frozen'),undefined);assert.deepEqual(blocked.subscription_params,original);assert.equal(blocked.provisioning_status,'subscription_review');assert.equal(blocked.last_error,'paid_deferral_contract_review_required');
 console.log('PASS old frozen anchor-only request fenced before provider effect without changed params or replacement idempotency key');
 await seed('old_method_policy');await pool.query("UPDATE paid_purchases SET subscription_params=subscription_params #- '{subscription,payment_settings}' WHERE purchase_id='old_method_policy'");await establishPaidSubscriptions(pool,{stripe,limit:50});assert.equal(creates.get('old_method_policy'),undefined);assert.equal((await pool.query("SELECT provisioning_status FROM paid_purchases WHERE purchase_id='old_method_policy'")).rows[0].provisioning_status,'subscription_review');assert.equal((await pool.query("SELECT last_error FROM paid_purchases WHERE purchase_id='old_method_policy'")).rows[0].last_error,'paid_payment_method_contract_review_required');
 const faultsToTest={payment_policy:s=>{s.payment_settings.save_default_payment_method='off';},active:s=>{s.status='active';},wrong_end:s=>{s.items.data[0].current_period_end++;},wrong_trial:s=>{s.trial_end++;},wrong_anchor:s=>{s.billing_cycle_anchor_config.day_of_month=28;},wrong_method:s=>{s.default_payment_method='pm_other';},collected:s=>{s.latest_invoice.total=7450;s.latest_invoice.amount_due=7450;s.latest_invoice.amount_paid=7450;},missing_invoice:s=>{s.latest_invoice=null;},foreign_invoice:s=>{s.latest_invoice.customer='cus_other';}};
 for(const [name,fault] of Object.entries(faultsToTest))await seed(`reject_${name}`,{fault});
 await establishPaidSubscriptions(pool,{stripe,limit:50});
 const rejected=(await pool.query("SELECT recurring_consent_at,stripe_subscription_id,provisioning_status FROM paid_purchases WHERE purchase_id LIKE 'reject_%'")).rows;
 assert.equal(rejected.length,9);assert(rejected.every(p=>p.recurring_consent_at===null&&p.stripe_subscription_id===null&&p.provisioning_status==='subscription_review'));
 console.log('PASS canonical payment-save policy/active/wrong trial/end/anchor/method and missing, charged or foreign initial invoice cannot authorize conversion');
}finally{await fixture.close();}
