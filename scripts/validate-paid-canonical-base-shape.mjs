import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {reconcilePaidInitialCoverage} from '../pages/api/_lib/paidInitialCoverage.js';
import {applyPaidBillingEvent} from '../pages/api/_lib/paidBillingLifecycle.js';
// Consume the preserved real sandbox response verbatim, changing only livemode
// on cloned provider objects to exercise the production verifier in an isolated DB.
// All provider IDs, amounts, flags, parent/pricing structures and dates stay exact.
const actual=JSON.parse(fs.readFileSync(new URL('../docs/reviews/unified-paid-intake-provider-evidence/canonical-base-provider-shape.json',import.meta.url)));
const sub=structuredClone(actual.subscription),invoices=structuredClone(actual.invoiceList.data);
sub.livemode=true;sub.items.data[0].price.livemode=true;for(const invoice of invoices)invoice.livemode=true;
const first=invoices.find(i=>i.total===7450&&i.lines.data[0].parent.subscription_item_details.proration===true);
assert.ok(first);assert.equal(first.billing_reason,'subscription_cycle');
const start=first.lines.data[0].period.start,end=first.lines.data[0].period.end,key=sub.metadata.paid_purchase_id;
const row={purchase_id:key,plan_code:'starter',billing_interval:'month',stripe_subscription_id:sub.id,stripe_customer_id:sub.customer,stripe_price_id:sub.items.data[0].price.id,usage_anchor_at:actual.paidAt,initial_period_end:new Date(sub.trial_end*1000)};
const stripe={subscriptions:{retrieve:async()=>structuredClone(sub)},invoices:{list:params=>{assert.deepEqual(params,actual.invoiceListRequest);return{async *[Symbol.asyncIterator](){for(const invoice of invoices)yield structuredClone(invoice);}};}}};
const coverage=await reconcilePaidInitialCoverage(row,stripe,{now:new Date((sub.items.data[0].current_period_start+60)*1000)});
assert.equal(coverage.receipts.length,2);assert.equal(coverage.through,sub.items.data[0].current_period_end);
const fixture=await createUpibTestFixture({label:'canonicalshape'}),{pool}=fixture;
try{
 await pool.query("INSERT INTO system_config(id,billing_plans_json,global_emergency_phrase) VALUES(1,$1,'Emergency')",[JSON.stringify([{code:'starter',stripePriceId:row.stripe_price_id}])]);
 await pool.query("INSERT INTO tenants(tenant_key,name,status,plan_code,billing_status,service_access_status,app_access_status) VALUES($1,'fixture','active','starter','active','enabled','enabled')",[key]);
 await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json) VALUES($1,'fixture@example.invalid','{}')",[key]);
 await pool.query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,tenant_key,plan_code,billing_interval,livemode,amount_cents,payment_status,paid_at) VALUES($1,$1,'fixture@example.invalid',$1,'starter','month',TRUE,10000,'paid',$2)",[key,actual.paidAt]);
 await pool.query("INSERT INTO tenant_billing_accounts(tenant_key,paid_purchase_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_interval,monthly_amount_cents,usage_anchor_at,paid_base_through) VALUES($1,$1,$2,$3,$4,'month',7450,$5,to_timestamp($6))",[key,sub.customer,sub.id,row.stripe_price_id,actual.paidAt,start]);
 for(const [name,mutate] of Object.entries({actual:()=>{},wrong_reason:i=>{i.billing_reason='subscription_update';},partial_amount:i=>{i.total--;i.lines.data[0].amount--;},short_window:i=>{i.lines.data[0].period.end--;},foreign_sub:i=>{i.lines.data[0].parent.subscription_item_details.subscription='sub_foreign';},extra_line:i=>{i.lines.data.push({...structuredClone(i.lines.data[0]),amount:0});},negative_line:i=>{i.lines.data.push({...structuredClone(i.lines.data[0]),amount:-100});i.total-=100;},wrong_total:i=>{i.total--;}})){
  const invoice=structuredClone(first);mutate(invoice);
  await pool.query('UPDATE tenant_billing_accounts SET paid_base_through=to_timestamp($2) WHERE tenant_key=$1',[key,start]);
  await applyPaidBillingEvent(pool,{type:'invoice.paid',created:start,data:{object:invoice}},{stripe:{invoices:{retrieve:async()=>invoice}},now:new Date((start+60)*1000),sendEmail:async()=>{throw Error('no_email_expected');}});
  const through=(await pool.query('SELECT paid_base_through FROM tenant_billing_accounts WHERE tenant_key=$1',[key])).rows[0].paid_base_through;
  assert.equal(new Date(through).getTime()/1000,name==='actual'?end:start,name);
  if(name!=='actual'){
   const changed=invoices.map(i=>i.id===first.id?invoice:i);
   await assert.rejects(reconcilePaidInitialCoverage(row,{...stripe,invoices:{list:()=>({async *[Symbol.asyncIterator](){yield* changed;}})}},{now:new Date((sub.items.data[0].current_period_start+60)*1000)}),/paid_initial_coverage_review_required/);
  }
 }
 // Analogous annual full-boundary contract keeps the same canonical shape;
 // this is a synthetic interval adaptation, not a claim of a second provider run.
 const annual=structuredClone(first),annualPrice='price_fixture_annual',annualEnd=Date.parse('2028-02-29T12:00:00Z')/1000;
 annual.total=75990;annual.amount_paid=75990;annual.lines.data[0].amount=75990;annual.lines.data[0].period.end=annualEnd;annual.lines.data[0].pricing.price_details.price=annualPrice;
 await pool.query("UPDATE system_config SET billing_plans_json=$1 WHERE id=1",[JSON.stringify([{code:'starter',stripePriceId:row.stripe_price_id,stripeAnnualPriceId:annualPrice}])]);
 await pool.query("UPDATE tenant_billing_accounts SET billing_interval='year',stripe_price_id=$2,paid_base_through=to_timestamp($3) WHERE tenant_key=$1",[key,annualPrice,start]);
 await applyPaidBillingEvent(pool,{type:'invoice.paid',created:start,data:{object:annual}},{stripe:{invoices:{retrieve:async()=>annual}},now:new Date((start+60)*1000)});
 assert.equal(new Date((await pool.query('SELECT paid_base_through FROM tenant_billing_accounts WHERE tenant_key=$1',[key])).rows[0].paid_base_through).getTime()/1000,annualEnd);
 const annualSub=structuredClone(sub);Object.assign(annualSub.items.data[0],{current_period_start:start,current_period_end:annualEnd});Object.assign(annualSub.items.data[0].price,{id:annualPrice,unit_amount:75990,recurring:{interval:'year',interval_count:1}});
 const annualCoverage=await reconcilePaidInitialCoverage({...row,billing_interval:'year',stripe_price_id:annualPrice},{subscriptions:{retrieve:async()=>annualSub},invoices:{list:()=>({async *[Symbol.asyncIterator](){yield annual;}})}},{now:new Date((start+60)*1000)});
 assert.equal(annualCoverage.through,annualEnd);
 console.log('PASS preserved real canonical list shape: full original-window cycle with proration flag grants exact first term and recovers delayed history; wrong reason/partial amount/short window/foreign subscription/extra or negative lines grant nothing; analogous annual full boundary accepted');
}finally{await fixture.close();}
