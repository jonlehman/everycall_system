import assert from 'node:assert/strict';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {capturePaidRequests} from './lib/paid-request-capture.mjs';
import {collectPaidUsageInvoice} from '../pages/api/_lib/paidUsageInvoices.js';
const fixture=await createUpibTestFixture({label:'usagecontracts'}),{pool}=fixture,requests=[];
try{
 for(const methodSource of ['subscription','customer']){
  const key=`usage_${methodSource}`,customer=`cus_${key}`,subscription=`sub_${key}`,method=`pm_${methodSource}`,invoiceId=`in_${key}`;
  await pool.query("INSERT INTO tenants(tenant_key,name,status,plan_code) VALUES($1,$1,'active','starter')",[key]);
  await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json,verified_at) VALUES($1,$2,'{}',NOW())",[key,`${key}@fixture.invalid`]);
  await pool.query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,tenant_key,plan_code,billing_interval,livemode,amount_cents,payment_status,paid_at,recurring_consent_at) VALUES($1,$1,$2,$1,'starter','year',TRUE,10000,'paid','2028-01-31','2028-01-31')",[key,`${key}@fixture.invalid`]);
  await pool.query("INSERT INTO tenant_billing_accounts(tenant_key,paid_purchase_id,stripe_customer_id,stripe_subscription_id,billing_interval,monthly_amount_cents,included_call_count,call_overage_rate_cents,usage_anchor_at,paid_base_through) VALUES($1,$1,$2,$3,'year',7450,2,300,'2028-01-31','2029-02-28')",[key,customer,subscription]);
  const period=(await pool.query("INSERT INTO billing_periods(tenant_key,period_start,period_end,status,overage_call_count,overage_amount_cents) VALUES($1,'2028-02-29','2028-03-31','finalized',3,900) RETURNING *",[key])).rows[0];
  // The prior finalized usage is immutable when the current plan/rate changes.
  await pool.query("UPDATE tenant_billing_accounts SET monthly_amount_cents=17450,included_call_count=600,call_overage_rate_cents=175,billing_interval='month' WHERE tenant_key=$1",[key]);
  await pool.query("UPDATE tenants SET plan_code='pro' WHERE tenant_key=$1",[key]);
  const calls=[];let remote,customerReads=0,itemCreated=false;
  const record=(action,args)=>calls.push({action,args:structuredClone(args)});
  const stripe={subscriptions:{retrieve:async id=>{assert.equal(id,subscription);return{id,livemode:true,customer,default_payment_method:methodSource==='subscription'?method:null};}},customers:{retrieve:async id=>{customerReads++;assert.equal(methodSource,'customer');assert.equal(id,customer);return{id,livemode:true,invoice_settings:{default_payment_method:method}};}},invoices:{
   create:async(...args)=>{record('invoices.create',args);const [body]=args;assert.equal(body.default_payment_method,method);remote={id:invoiceId,customer,currency:'usd',livemode:true,status:'draft',total:900,metadata:body.metadata};return remote;},
   retrieve:async id=>{assert.equal(id,invoiceId);return remote;},
   listLineItems:async id=>{assert.equal(id,invoiceId);return{has_more:false,data:[]};},
   finalizeInvoice:async(...args)=>{record('invoices.finalizeInvoice',args);assert.equal(args[0],invoiceId);assert.equal(itemCreated,true);remote.status='open';return remote;}
  },invoiceItems:{create:async(...args)=>{record('invoiceItems.create',args);assert.equal(args[0].invoice,invoiceId);assert.equal(args[0].amount,900);itemCreated=true;return{id:`ii_${key}`};}}};
  const result=await collectPaidUsageInvoice(pool,period.billing_period_id,{stripe,now:new Date('2028-03-31T00:00:01Z')});
  assert.equal(result.total,900);assert.equal(customerReads,methodSource==='customer'?1:0);
  assert.deepEqual(calls.map(c=>c.action),['invoices.create','invoiceItems.create','invoices.finalizeInvoice']);
  const saved=(await pool.query('SELECT * FROM billing_periods WHERE billing_period_id=$1',[period.billing_period_id])).rows[0];
  assert.equal(saved.status,'invoiced');assert.equal(saved.invoice_payload.amount,900);assert.equal(saved.invoice_payload.default_payment_method,method);assert.equal(saved.stripe_invoice_id,invoiceId);
  await collectPaidUsageInvoice(pool,period.billing_period_id,{stripe,now:new Date('2028-04-01')});assert.equal(calls.length,3);
  requests.push({methodSource,customer,subscription,paymentMethod:method,invoiceId,periodId:String(period.billing_period_id),periodStart:new Date(period.period_start).toISOString(),periodEnd:new Date(period.period_end).toISOString(),frozenAmount:900,currentRate:175,calls});
 }
 capturePaidRequests('usage-invoice-create-item-finalize',requests);
 console.log('PASS actual usage collector requests: subscription override/customer fallback, frozen prior-window 900 after plan change, bound item/finalize, no duplicate replay');
}finally{await fixture.close();}
