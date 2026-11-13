import assert from 'node:assert/strict';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {convertPaidIntake,processPaidIntakeJobs} from '../pages/api/_lib/paidProvisioning.js';
import {reconcilePaidPurchases,establishPaidSubscriptions} from '../pages/api/_lib/paidPurchaseEvents.js';
import {paidSubscriptionParams,purchaseTerms} from '../pages/api/_lib/paidPurchaseContract.js';
const fixture=await createUpibTestFixture({label:'initialcoverage',migrations:['0049_live_prompt_settings.sql','0063_unified_paid_intake.sql','0064_paid_billing_lifecycle.sql']}),{pool}=fixture;
const sec=s=>Date.parse(s)/1000,now=new Date('2028-05-05T12:00:00Z'),anchor='2028-01-31T12:00:00Z',initial='2028-02-29T12:00:00Z';
let providerWrites=0;
async function seed(name,interval='month'){
 const payload={businessName:name,businessCategory:'service_business',website:'',companyDescription:'Synthetic fixture business.',leadPhone:'',planCode:'starter',billingInterval:interval,marketingAttribution:{}};
 await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json,verified_at) VALUES($1,$2,$3::jsonb,NOW())",[name,`${name}@fixture.invalid`,JSON.stringify(payload)]);
 await pool.query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,kind,plan_code,billing_interval,livemode,amount_cents,setup_amount_cents,payment_status,provisioning_status,stripe_customer_id,stripe_subscription_id,stripe_price_id,paid_at,usage_anchor_at,initial_period_end,recurring_consent_at) VALUES($1,$1,$2,'setup','starter',$3,TRUE,10000,10000,'paid','queued',$4,$5,$6,$7,$7,$8,NOW())",[name,`${name}@fixture.invalid`,interval,`cus_${name}`,`sub_${name}`,`price_${interval}`,anchor,initial]);
 const periods=interval==='year'?[[initial,'2029-02-28T12:00:00Z']]:[[initial,'2028-03-31T12:00:00Z'],['2028-03-31T12:00:00Z','2028-04-30T12:00:00Z'],['2028-04-30T12:00:00Z','2028-05-31T12:00:00Z']];
 const amount=interval==='year'?75990:7450;
 const invoices=periods.map(([a,b],i)=>({id:`in_${name}_${i}`,livemode:true,customer:`cus_${name}`,parent:{subscription_details:{subscription:`sub_${name}`}},currency:'usd',status:'paid',amount_remaining:0,amount_paid:interval==='year'?0:amount,total:amount,lines:{has_more:false,data:[{amount,currency:'usd',quantity:1,pricing:{price_details:{price:`price_${interval}`}},parent:{type:'subscription_item_details',subscription_item_details:{subscription:`sub_${name}`,proration:false}},period:{start:sec(a),end:sec(b)}}]}}));
 const current=periods.at(-1),sub={id:`sub_${name}`,customer:`cus_${name}`,livemode:true,status:'active',metadata:{paid_purchase_id:name},items:{data:[{quantity:1,price:{id:`price_${interval}`,currency:'usd',unit_amount:amount,recurring:{interval,interval_count:1}},current_period_start:sec(current[0]),current_period_end:sec(current[1])}]}};
 const stripe={subscriptions:{retrieve:async()=>structuredClone(sub),create:async()=>{providerWrites++;throw Error('unexpected_write');}},customers:{update:async()=>{providerWrites++;throw Error('unexpected_write');}},invoices:{list:()=>({async *[Symbol.asyncIterator](){for(const invoice of invoices)yield structuredClone(invoice);}})}};
 return {name,interval,invoices,sub,stripe,current};
}
const counts=async()=>({tenants:(await pool.query('SELECT count(*)::int n FROM tenants')).rows[0].n,accounts:(await pool.query('SELECT count(*)::int n FROM tenant_billing_accounts')).rows[0].n,builds:(await pool.query('SELECT count(*)::int n FROM knowledge_builds')).rows[0].n,numbers:(await pool.query('SELECT count(*)::int n FROM paid_number_orders')).rows[0].n});
try{
 for(const interval of ['month','year']){
  const f=await seed(`late_${interval}`,interval);f.invoices.reverse();f.invoices.push(structuredClone(f.invoices[0]));
  const result=await convertPaidIntake(pool,f.name,{stripe:f.stripe,now});
  const account=(await pool.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1',[result.tenant_key])).rows[0];
  assert.equal(new Date(account.usage_anchor_at).toISOString(),new Date(anchor).toISOString());assert.equal(new Date(account.initial_period_end).toISOString(),new Date(initial).toISOString());
  assert.equal(new Date(account.current_period_start).getTime()/1000,sec(f.current[0]));assert.equal(new Date(account.paid_base_through).getTime()/1000,sec(f.current[1]));assert.equal(account.stripe_subscription_status,'active');
  const before=JSON.stringify((await pool.query('SELECT to_jsonb(b) AS row FROM tenant_billing_accounts b WHERE tenant_key=$1',[result.tenant_key])).rows);
  await convertPaidIntake(pool,f.name,{stripe:{subscriptions:{retrieve:async()=>{throw Error('already_bound_retry_must_not_reinitialize');}}},now});
  assert.equal(JSON.stringify((await pool.query('SELECT to_jsonb(b) AS row FROM tenant_billing_accounts b WHERE tenant_key=$1',[result.tenant_key])).rows),before);
  assert.equal((await pool.query("SELECT 1 FROM audit_log WHERE tenant_key=$1 AND action='paid_intake.missed_renewals.reconciled'",[result.tenant_key])).rowCount,1);
 }
 console.log('PASS monthly and annual delayed first binding recovers complete paid canonical renewals despite out-of-order/duplicate inventory; anchors/history retained and retry has one audit');
 for(const [name,mutate] of Object.entries({before_anchor:f=>{f.invoices[0].lines.data[0].period={start:sec('2027-12-31T12:00:00Z'),end:sec('2028-01-31T12:00:00Z')};},gap:f=>f.invoices.splice(0,1),foreign:f=>{f.invoices[0].customer='cus_other';},zero:f=>{f.invoices[0].total=0;f.invoices[0].lines.data[0].amount=0;},debt:f=>{f.invoices[0].status='open';f.invoices[0].amount_remaining=7450;},wrong_price:f=>{f.invoices[0].lines.data[0].pricing.price_details.price='price_other';},proration:f=>{f.invoices[0].lines.data[0].parent.subscription_item_details.proration=true;},incomplete:f=>{f.invoices[0].lines.has_more=true;},schedule:f=>{f.sub.schedule='sched_unsupported';},unavailable:f=>{f.stripe.subscriptions.retrieve=async()=>{throw Error('provider_unavailable');};}})){
  const f=await seed(`reject_${name}`);mutate(f);const before=await counts();const purchase=(await pool.query('SELECT paid_at,usage_anchor_at,initial_period_end,amount_cents FROM paid_purchases WHERE purchase_id=$1',[f.name])).rows[0];
  await assert.rejects(convertPaidIntake(pool,f.name,{stripe:f.stripe,now}),/paid_initial_coverage_review_required|provider_unavailable/);
  assert.deepEqual(await counts(),before);assert.deepEqual((await pool.query('SELECT paid_at,usage_anchor_at,initial_period_end,amount_cents FROM paid_purchases WHERE purchase_id=$1',[f.name])).rows[0],purchase);
 }
 assert.equal(providerWrites,0);console.log('PASS gap/foreign/zero/debt/wrong-price/proration/incomplete/unsupported/unavailable histories refuse before tenant/account/build/number effects; no provider writes or new period');
 await pool.query("UPDATE paid_purchases SET provisioning_status='complete'");
 const workerGap=await seed('worker_gap');workerGap.invoices.shift();let buildCalls=0,numberCalls=0;
 const effects={enqueue:async()=>{buildCalls++;throw Error('must_not_build');},provision:async()=>{numberCalls++;throw Error('must_not_order_number');}};
 await processPaidIntakeJobs(pool,{stripe:workerGap.stripe,now,...effects});
 const reviewed=(await pool.query("SELECT provisioning_status,last_error,lease_until,paid_at,amount_cents FROM paid_purchases WHERE purchase_id='worker_gap'")).rows[0];
 assert.equal(reviewed.provisioning_status,'provisioning_review');assert.equal(reviewed.last_error,'paid_initial_coverage_review_required');assert.equal(reviewed.lease_until,null);assert.equal(new Date(reviewed.paid_at).getTime(),Date.parse(anchor));assert.equal(reviewed.amount_cents,10000);
 assert.equal((await processPaidIntakeJobs(pool,{stripe:workerGap.stripe,now,...effects})).results.length,0);
 const workerDown=await seed('worker_down');workerDown.stripe.subscriptions.retrieve=async()=>{throw Error('provider_unavailable');};await processPaidIntakeJobs(pool,{stripe:workerDown.stripe,now,...effects});
 const retrying=(await pool.query("SELECT provisioning_status,last_error,lease_until>NOW() AS delayed FROM paid_purchases WHERE purchase_id='worker_down'")).rows[0];assert.equal(retrying.provisioning_status,'failed');assert.equal(retrying.last_error,'provider_unavailable');assert.equal(retrying.delayed,true);assert.equal(buildCalls,0);assert.equal(numberCalls,0);
 console.log('PASS real provisioning worker classifies unsupported paid history as visible review without reclaim; transient provider outage retains bounded retry and no build/number effects');
 // Consent after an original historical paid month expired cannot create an
 // arrears charge, reset the anniversary, seed a card or provision service.
 const expired=new Date(Date.now()-70*86400000),name='expired_consent';
 await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json,verified_at) VALUES($1,'expired@fixture.invalid','{}',NOW())",[name]);
 const terms=purchaseTerms({kind:'setup',plan_code:'starter',billing_interval:'month',amount_cents:0,setup_amount_cents:100});
 await pool.query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,plan_code,billing_interval,livemode,amount_cents,setup_amount_cents,payment_status,provisioning_status,stripe_customer_id,stripe_session_id,legacy_checkout_id,legacy_payment_intent_id,paid_at,consent_accepted_at,consent_terms_json) VALUES($1,$1,'expired@fixture.invalid','starter','month',TRUE,0,100,'pending','unpaid','cus_expired','cs_expired','legacy_expired','pi_expired',$2,NOW(),$3::jsonb)",[name,expired,JSON.stringify(terms)]);
 const metadata={paid_purchase_id:name,paid_intake_id:name};
 const expiredStripe={checkout:{sessions:{retrieve:async()=>({id:'cs_expired',livemode:true,mode:'setup',status:'complete',client_reference_id:name,customer:'cus_expired',metadata,consent:{terms_of_service:'accepted'},setup_intent:'seti_expired'})}},setupIntents:{retrieve:async()=>({id:'seti_expired',livemode:true,status:'succeeded',customer:'cus_expired',metadata,payment_method:'pm_expired'})},paymentIntents:{retrieve:async()=>({id:'pi_expired',livemode:true,status:'succeeded',amount_received:100,currency:'usd',latest_charge:{paid:true,created:Math.floor(expired/1000)}})},paymentMethods:{retrieve:async()=>({id:'pm_expired',livemode:true,customer:'cus_expired'})},customers:{retrieve:async()=>{throw Error('expired_term_must_not_seed_or_retrieve_customer');}},subscriptions:{create:async()=>{providerWrites++;throw Error('unexpected_write');}}};
 const beforeExpired=await counts();await reconcilePaidPurchases(pool,{stripe:expiredStripe});
 const held=(await pool.query('SELECT payment_status,provisioning_status,last_error,paid_at,amount_cents,setup_amount_cents,subscription_params FROM paid_purchases WHERE purchase_id=$1',[name])).rows[0];assert.equal(held.provisioning_status,'payment_review');assert.equal(held.last_error,'purchase_term_reconciliation_required');assert.equal(held.amount_cents,0);assert.equal(held.setup_amount_cents,100);assert.equal(new Date(held.paid_at).getTime(),expired.getTime());assert.equal(held.subscription_params,null);assert.deepEqual(await counts(),beforeExpired);assert.equal(providerWrites,0);
 console.log('PASS expired historical setup consent retains original $1/date, enters actionable payment review and makes no new default/subscription/tenant/build/number effect');
}finally{await fixture.close();}
