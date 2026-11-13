import assert from 'node:assert/strict';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {capturePaidRequests} from './lib/paid-request-capture.mjs';
import {freezePaidEnrollment,purchaseTerms,paidSubscriptionParams} from '../pages/api/_lib/paidPurchaseContract.js';
import {establishPaidSubscriptions} from '../pages/api/_lib/paidPurchaseEvents.js';
import {calendarMonthBoundary} from '../lib/paidBillingCalendar.js';
const fixture=await createUpibTestFixture({label:'defaultmethod'}),{pool}=fixture;
const customers=new Map(),subs=new Map(),methods=new Map(),updates=[],creates=[],faults=new Map();
const stripe={customers:{retrieve:async id=>structuredClone(customers.get(id)),update:async(id,params,options)=>{
 updates.push({customer:id,request:structuredClone(params),options:structuredClone(options)});
 Object.assign(customers.get(id),structuredClone(params));if(faults.get(id)==='response_lost'){faults.delete(id);throw Error('customer_response_lost');}return structuredClone(customers.get(id));
}},paymentMethods:{retrieve:async id=>structuredClone(methods.get(id))},subscriptions:{list:({customer})=>({async *[Symbol.asyncIterator](){for(const sub of subs.values())if(sub.customer===customer)yield structuredClone(sub);}}),create:async(params,options)=>{
 creates.push({request:structuredClone(params),options});const sub={...params,id:`sub_${params.metadata.paid_purchase_id}`,livemode:true,status:'trialing',items:{data:[{price:params.items[0].price,quantity:1,current_period_end:params.trial_end}]},latest_invoice:{id:`in_${params.metadata.paid_purchase_id}`,livemode:true,customer:params.customer,status:'paid',total:0,amount_due:0,amount_paid:0}};subs.set(sub.id,sub);return structuredClone(sub);
},retrieve:async id=>structuredClone(subs.get(id))}};
async function seed(name,{kind='setup',dedicated=true,customerDefault=null,exposed=false}={}){
 const paidAt=new Date(Date.now()-60000),method=`pm_${name}`,customer=`cus_${name}`;
 await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json,verified_at) VALUES($1,$2,'{}',NOW())",[name,`${name}@fixture.invalid`]);
 await pool.query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,kind,plan_code,billing_interval,livemode,amount_cents,setup_amount_cents,payment_status,provisioning_status,stripe_customer_id,stripe_price_id,paid_at,usage_anchor_at,initial_period_end,consent_accepted_at,customer_started_at) VALUES($1,$1,$2,$3,'starter','month',TRUE,$4,$5,'paid','awaiting_subscription',$6,'price_starter_month',$7,$7,$8,NOW(),$9)",[name,`${name}@fixture.invalid`,kind,kind==='setup'?10000:7450,kind==='setup'?10000:0,customer,paidAt,calendarMonthBoundary(paidAt,1),dedicated?new Date():null]);
 customers.set(customer,{id:customer,livemode:true,metadata:dedicated?{app:'everycall',paid_purchase_id:name}:{app:'existing'},invoice_settings:{default_payment_method:customerDefault}});
 methods.set(method,{id:method,livemode:true,customer});
 if(exposed){await pool.query('INSERT INTO tenants(tenant_key,name) VALUES($1,$1)',[name]);await pool.query('INSERT INTO tenant_billing_accounts(tenant_key,stripe_customer_id) VALUES($1,$2)',[name,customer]);}
 const row=(await pool.query('SELECT * FROM paid_purchases WHERE purchase_id=$1',[name])).rows[0],contract=await freezePaidEnrollment(pool,row,method,stripe);
 await pool.query('UPDATE paid_purchases SET subscription_params=$2::jsonb,consent_terms_json=$3::jsonb WHERE purchase_id=$1',[name,JSON.stringify(contract),JSON.stringify(purchaseTerms(row))]);
 return {name,customer,method,contract,row};
}
const retry=async name=>pool.query("UPDATE paid_purchases SET lease_until=NOW()-interval '1 second' WHERE purchase_id=$1",[name]);
const work=()=>establishPaidSubscriptions(pool,{stripe,limit:50});
try{
 const fresh=await seed('dedicated');assert.equal(fresh.contract.customerDefault.mode,'seed_null');faults.set(fresh.customer,'response_lost');await work();assert.equal(updates.length,1);assert.equal(creates.length,0);
 const frozen=(await pool.query("SELECT subscription_params,subscription_started_at FROM paid_purchases WHERE purchase_id='dedicated'")).rows[0];assert.deepEqual(frozen.subscription_params,fresh.contract);assert(frozen.subscription_started_at);
 await retry(fresh.name);await work();assert.equal(updates.length,1);assert.equal(creates.length,1);assert.equal(customers.get(fresh.customer).invoice_settings.default_payment_method,fresh.method);
 assert.equal((await pool.query("SELECT provisioning_status FROM paid_purchases WHERE purchase_id='dedicated'")).rows[0].provisioning_status,'queued');
 console.log('PASS exclusive new-customer null initialization is durably frozen before effect; accepted response loss reconciles desired default with no duplicate write');
 const cases=[await seed('preserve_other',{customerDefault:'pm_existing_owner'}),await seed('reused_null',{dedicated:false}),await seed('exposed_null',{exposed:true}),await seed('restart_null',{kind:'restart',dedicated:false})];
 const before=updates.length;await work();assert.equal(updates.length,before);
 for(const c of cases){assert.equal(c.contract.customerDefault.mode,'preserve');assert(subs.has(`sub_${c.name}`));assert.equal(subs.get(`sub_${c.name}`).default_payment_method,c.method);}
 assert.equal(customers.get('cus_preserve_other').invoice_settings.default_payment_method,'pm_existing_owner');assert.equal(customers.get('cus_reused_null').invoice_settings.default_payment_method,null);
 console.log('PASS every nonnull default preserved; reused/exposed/restart null defaults receive no writes while consented explicit-subscription enrollment remains available');
 const preservedChange=await seed('preserved_changed',{customerDefault:'pm_owner_before'});customers.get(preservedChange.customer).invoice_settings.default_payment_method='pm_owner_after';await work();assert.equal(updates.length,before);assert(!subs.has(`sub_${preservedChange.name}`));assert.equal(customers.get(preservedChange.customer).invoice_settings.default_payment_method,'pm_owner_after');
 const changed=await seed('later_owner');faults.set(changed.customer,'response_lost');await work();const writes=updates.length;
 customers.get(changed.customer).invoice_settings.default_payment_method='pm_later_owner_choice';await retry(changed.name);await work();assert.equal(updates.length,writes);assert(!subs.has(`sub_${changed.name}`));
 const held=(await pool.query("SELECT provisioning_status,last_error FROM paid_purchases WHERE purchase_id='later_owner'")).rows[0];assert.equal(held.provisioning_status,'subscription_review');assert.equal(held.last_error,'paid_customer_default_review_required');assert.equal(customers.get(changed.customer).invoice_settings.default_payment_method,'pm_later_owner_choice');
 const expired=await seed('expired_unknown');await pool.query("UPDATE paid_purchases SET subscription_started_at=NOW()-interval '48 hours' WHERE purchase_id=$1",[expired.name]);await work();assert.equal(updates.length,writes);assert(!subs.has(`sub_${expired.name}`));
 const old=await seed('old_envelope');await pool.query('UPDATE paid_purchases SET subscription_params=$2::jsonb WHERE purchase_id=$1',[old.name,JSON.stringify(paidSubscriptionParams(old.row,old.method))]);await work();assert.equal(updates.length,writes);assert(!subs.has(`sub_${old.name}`));
 console.log('PASS later owner default wins over an uncertain seed; expired effects and old frozen envelopes enter review without provider writes');
 capturePaidRequests('customer-default-initialization',updates);
}finally{await fixture.close();}
