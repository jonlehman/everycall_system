import assert from 'node:assert/strict';
import {capturePaidRequests} from './lib/paid-request-capture.mjs';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {changePaidSubscription} from '../pages/api/_lib/paidBillingChanges.js';
import {syncPaidSubscription} from '../pages/api/_lib/paidSubscriptionSync.js';
import {applyPaidBillingEvent} from '../pages/api/_lib/paidBillingLifecycle.js';
import {STANDARD_BILLING_PLANS as plans} from '../lib/standardBillingPlans.js';
process.env.APP_BASE_URL='https://app.fixture.invalid';
const fixture=await createUpibTestFixture({label:'basebridge'}),{pool}=fixture;
const prices=new Map(),subs=new Map(),schedules=new Map();let sequence=0,readSchedules=0,failUpdate=false;
const seconds=s=>Date.parse(s)/1000;
const start=seconds('2028-02-29T12:00:00Z'),end=seconds('2028-03-31T12:00:00Z');
const config=plans.map(p=>({...p,stripeProductId:`prod_${p.code}`,stripePriceId:`price_${p.code}_month`,stripeAnnualPriceId:`price_${p.code}_year`}));
for(const p of config)for(const interval of ['month','year']){const id=`price_${p.code}_${interval}`;prices.set(id,{id,product:p.stripeProductId,livemode:true,active:true,type:'recurring',currency:'usd',unit_amount:interval==='year'?p.annualAmountCents:p.monthlyAmountCents,recurring:{interval,interval_count:1}});}
const customerMethods=new Map();
const stripe={customers:{retrieve:async id=>({id,livemode:true,invoice_settings:{default_payment_method:customerMethods.has(id)?customerMethods.get(id):`pm_${id}`}})},paymentMethods:{retrieve:async id=>({id,livemode:true,customer:id.slice(3)})},prices:{retrieve:async id=>structuredClone(prices.get(id))},subscriptions:{retrieve:async id=>structuredClone(subs.get(id)),update:async(id,params)=>{Object.assign(subs.get(id),params);return structuredClone(subs.get(id));}},subscriptionSchedules:{
 create:async({from_subscription})=>{const sub=subs.get(from_subscription),item=sub.items.data[0],schedule={id:`sched_${++sequence}`,livemode:true,customer:sub.customer,subscription:sub.id,status:'active',phases:[{start_date:item.current_period_start,end_date:item.current_period_end,items:[{price:item.price,quantity:1}],metadata:{},collection_method:'charge_automatically',default_payment_method:`pm_${from_subscription}`,...(sub.trial_end?{trial_end:sub.trial_end}:{})}]};schedules.set(schedule.id,schedule);sub.schedule=schedule.id;return structuredClone(schedule);},
 retrieve:async id=>{readSchedules++;return structuredClone(schedules.get(id));},release:async(id)=>{const s=schedules.get(id);s.released_subscription=s.subscription;subs.get(s.subscription).schedule=null;s.subscription=null;s.status='released';return structuredClone(s);},update:async(id,params,options)=>{updates.push({id,params:structuredClone(params),options:structuredClone(options)});const s=schedules.get(id);Object.assign(s,structuredClone(params));for(const p of s.phases)for(const add of p.add_invoice_items||[]){if(add.price_data){const pid=`price_bridge_${id}`;prices.set(pid,{id:pid,livemode:true,type:'one_time',recurring:null,...add.price_data});add.price=pid;delete add.price_data;}}if(failUpdate){failUpdate=false;throw Error('accepted_update_timeout');}return structuredClone(s);}
}};
async function seed(key,source,interval){
 await pool.query("INSERT INTO tenants(tenant_key,name,status,plan,plan_code,billing_status,service_access_status,app_access_status) VALUES($1,$1,'active',$2,$2,'active','enabled','enabled')",[key,source.code]);
 await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json) VALUES($1,$2,'{}')",[key,`${key}@fixture.invalid`]);
 await pool.query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,tenant_key,plan_code,billing_interval,livemode,amount_cents,payment_status,paid_at,recurring_consent_at) VALUES($1,$1,$2,$1,$3,$4,TRUE,10000,'paid','2027-01-31T12:00:00Z',NOW())",[key,`${key}@fixture.invalid`,source.code,interval]);
 await pool.query("INSERT INTO tenant_billing_accounts(tenant_key,paid_purchase_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_interval,monthly_amount_cents,included_call_count,call_overage_rate_cents,usage_anchor_at,paid_base_through,current_period_start,current_period_end) VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,'2027-01-31T12:00:00Z',to_timestamp($9),to_timestamp($10),to_timestamp($9))",[key,`cus_${key}`,`sub_${key}`,`price_${source.code}_${interval}`,interval,source.monthlyAmountCents,source.includedCallCount,source.callOverageRateCents,start,interval==='year'?seconds('2027-02-28T12:00:00Z'):seconds('2028-01-31T12:00:00Z')]);
 subs.set(`sub_${key}`,{id:`sub_${key}`,customer:`cus_${key}`,livemode:true,status:'active',items:{data:[{price:prices.get(`price_${source.code}_${interval}`),quantity:1,current_period_start:interval==='year'?seconds('2027-02-28T12:00:00Z'):seconds('2028-01-31T12:00:00Z'),current_period_end:start}]},metadata:{paid_purchase_id:key}});
}
let chosen,cancelChosen;const captured=[],updates=[];
try{
 await pool.query("INSERT INTO system_config(id,global_emergency_phrase,billing_plans_json) VALUES(1,'fixture',$1::jsonb)",[JSON.stringify(config)]);
 let n=0,bridges=0;
 for(const source of plans)for(const interval of ['month','year'])for(const target of plans)for(const targetInterval of ['month','year']){
  const key=`bridge_${n++}`;await seed(key,source,interval);
  await changePaidSubscription(pool,key,'tenant:fixture',{action:'plan',planCode:target.code,billingInterval:targetInterval},{stripe});
  const op=(await pool.query('SELECT * FROM paid_billing_changes WHERE tenant_key=$1',[key])).rows[0],phase=schedules.get(op.schedule_id).phases[1];
  captured.push({sourcePlan:source.code,sourceInterval:interval,targetPlan:target.code,targetInterval,usageAnchorAt:'2027-01-31T12:00:00Z',request:op.provider_params.params});
  assert.equal(phase.start_date,start);assert.equal(phase.end_date,targetInterval==='month'?end:seconds('2029-02-28T12:00:00Z'));assert.equal(phase.duration,undefined);
  if(interval==='year'&&targetInterval==='month'){bridges++;assert.equal(phase.trial_end,end);assert.equal(prices.get(phase.add_invoice_items[0].price).unit_amount,target.monthlyAmountCents);assert.equal(op.provider_params.bridgePriceId,phase.add_invoice_items[0].price);if(!chosen)chosen={key,op,target};else cancelChosen||={key,op,target};}
  else{assert.equal(phase.trial_end,undefined);assert.equal(phase.add_invoice_items,undefined);}
 }
 await seed('included_transition',plans[0],'year');
 await pool.query("UPDATE tenant_billing_accounts SET usage_anchor_at='2028-01-31T12:00:00Z',current_period_start='2028-01-31T12:00:00Z' WHERE tenant_key='included_transition'");
 const includedSub=subs.get('sub_included_transition');includedSub.items.data[0].current_period_start=seconds('2028-01-31T12:00:00Z');includedSub.trial_end=start;includedSub.status='trialing';
 await changePaidSubscription(pool,'included_transition','tenant:fixture',{action:'plan',planCode:'growth',billingInterval:'month'},{stripe});
 const includedOp=(await pool.query("SELECT * FROM paid_billing_changes WHERE tenant_key='included_transition'")).rows[0];
 assert.equal(includedOp.provider_params.params.phases[0].trial_end,start);assert.equal(includedOp.provider_params.params.phases[1].trial_end,end);
 capturePaidRequests('schedule-update-included',[{sourcePlan:'starter',sourceInterval:'year',targetPlan:'growth',targetInterval:'month',usageAnchorAt:'2028-01-31T12:00:00Z',request:includedOp.provider_params.params}]);
 capturePaidRequests('schedule-update-36',captured);
 assert.equal(n,36);assert.equal(bridges,9);console.log('PASS 36 native scheduling contracts: explicit original calendar end, nine fully priced annual-to-monthly paid transitions, immutable operation receipt');
 await seed('timeout_transition',plans[0],'year');failUpdate=true;
 await assert.rejects(changePaidSubscription(pool,'timeout_transition','tenant:fixture',{action:'plan',planCode:'growth',billingInterval:'month'},{stripe}),/accepted_update_timeout/);
 const timeoutOp=(await pool.query("SELECT * FROM paid_billing_changes WHERE tenant_key='timeout_transition'")).rows[0];
 assert.equal(timeoutOp.status,'pending');assert(timeoutOp.provider_params.bridge);assert.equal(timeoutOp.provider_params.bridgePriceId,undefined);
 const pending=(await pool.query("SELECT pending_plan_code,pending_plan_effective_at FROM tenant_billing_accounts WHERE tenant_key='timeout_transition'")).rows[0];assert.equal(pending.pending_plan_code,'growth');assert.equal(new Date(pending.pending_plan_effective_at).getTime()/1000,start);
 await pool.query("INSERT INTO calls(call_sid,tenant_key,status,created_at) VALUES('timeout_boundary','timeout_transition','in_progress',to_timestamp($1))",[start]);
 assert.equal((await pool.query("SELECT * FROM reserve_paid_call('timeout_transition','timeout_boundary',to_timestamp($1))",[start])).rows[0].reason,'plan_transition_reconciliation_required');
 const timeoutSub=subs.get('sub_timeout_transition');timeoutSub.status='trialing';timeoutSub.items.data[0]={price:prices.get('price_growth_month'),quantity:1,current_period_start:start,current_period_end:end};
 await syncPaidSubscription(pool,'timeout_transition',timeoutSub,{plans:config});
 const timeoutBridge=timeoutOp.provider_params.bridge;
 const timeoutInvoice={id:'in_timeout',customer:'cus_timeout_transition',subscription:'sub_timeout_transition',livemode:true,currency:'usd',status:'paid',amount_remaining:0,amount_paid:12450,total:12450,billing_reason:'subscription_update',lines:{data:[{amount:12450,currency:'usd',quantity:1,period:{start,end},metadata:{paid_billing_change_id:timeoutOp.operation_id,item_type:'paid_base_bridge'},parent:{type:'invoice_item_details',invoice_item_details:{subscription:'sub_timeout_transition',proration:false}},pricing:{price_details:{price:`price_bridge_${timeoutOp.schedule_id}`,product:timeoutBridge.product}}}]}};
 await applyPaidBillingEvent(pool,{type:'invoice.paid',data:{object:timeoutInvoice}},{stripe:{...stripe,invoices:{retrieve:async()=>timeoutInvoice}},now:new Date(start*1000)});
 assert.equal((await pool.query("SELECT * FROM reserve_paid_call('timeout_transition','timeout_boundary',to_timestamp($1))",[start])).rows[0].allowed,true);
 console.log('PASS accepted schedule response timeout preserves pre-effect admission fence; canonical subscription/invoice recovery restores correct-plan service');
 for(const variant of ['different','null']){
  const k=`method_${variant}`;await seed(k,plans[0],'month');const methodSub=subs.get(`sub_${k}`);methodSub.default_payment_method=`pm_cus_${k}`;
  customerMethods.set(`cus_${k}`,variant==='null'?null:'pm_existing_owner');
  await assert.rejects(changePaidSubscription(pool,k,'tenant:fixture',{action:'plan',planCode:'growth',billingInterval:'month'},{stripe}),/confirm_payment_method_before_plan_change/);
  assert.equal((await pool.query("SELECT 1 FROM paid_billing_changes WHERE tenant_key=$1 AND status='pending'",[k])).rowCount,0);
  await changePaidSubscription(pool,k,'tenant:fixture',{action:'cancel',cancelAtPeriodEnd:true},{stripe});await changePaidSubscription(pool,k,'tenant:fixture',{action:'cancel',cancelAtPeriodEnd:false},{stripe});
  // Verified owner Portal action selects the customer default and removes the
  // old subscription override; the application does not write either here.
  customerMethods.set(`cus_${k}`,`pm_cus_${k}`);methodSub.default_payment_method=null;
  await changePaidSubscription(pool,k,'tenant:fixture',{action:'plan',planCode:'growth',billingInterval:'month'},{stripe});
  const request=(await pool.query("SELECT provider_params FROM paid_billing_changes WHERE tenant_key=$1 AND action='plan'",[k])).rows[0].provider_params.params;
  assert.deepEqual(request.default_settings,{default_payment_method:''});assert(request.phases.every(p=>!Object.hasOwn(p,'default_payment_method')));
 }
 console.log('PASS null/divergent autopay defaults refuse before reservation, cancel remains usable, explicit Portal alignment permits schedules with no frozen card override');
 const cancelSub=subs.get(`sub_${cancelChosen.key}`),cb=cancelChosen.op.provider_params.bridge;
 cancelSub.status='trialing';cancelSub.trial_end=end;cancelSub.items.data[0]={price:prices.get(cb.targetPrice),quantity:1,current_period_start:start,current_period_end:end};
 await syncPaidSubscription(pool,cancelChosen.key,cancelSub,{plans:config});
 await assert.rejects(changePaidSubscription(pool,cancelChosen.key,'tenant:fixture',{action:'plan',planCode:'pro',billingInterval:'month'},{stripe}),/paid_bridge_settlement_required_before_plan_change/);
 assert.equal((await pool.query("SELECT 1 FROM paid_billing_changes WHERE tenant_key=$1 AND status='pending'",[cancelChosen.key])).rowCount,0);
 await changePaidSubscription(pool,cancelChosen.key,'tenant:fixture',{action:'cancel',cancelAtPeriodEnd:true},{stripe});assert.equal(cancelSub.cancel_at_period_end,true);assert.equal(cancelSub.items.data[0].current_period_end,end);
 await changePaidSubscription(pool,cancelChosen.key,'tenant:fixture',{action:'cancel',cancelAtPeriodEnd:false},{stripe});assert.equal(cancelSub.cancel_at_period_end,false);
 console.log('PASS known-unpaid plan refusal leaves no pending reservation; cancellation and undo remain available without discarding an unknown provider attempt');
 const {key,op,target}=chosen,b=op.provider_params.bridge;
 const base={id:'in_bridge',customer:`cus_${key}`,subscription:`sub_${key}`,parent:{subscription_details:{subscription:`sub_${key}`}},livemode:true,currency:'usd',status:'paid',total:b.amount,amount_paid:b.amount,amount_remaining:0,billing_reason:'subscription_update',lines:{data:[{amount:b.amount,currency:'usd',quantity:1,period:{start,end},metadata:{paid_billing_change_id:op.operation_id,item_type:'paid_base_bridge'},parent:{type:'invoice_item_details',invoice_item_details:{subscription:`sub_${key}`,proration:false}},pricing:{price_details:{price:op.provider_params.bridgePriceId,product:b.product}}},{amount:0,currency:'usd',quantity:1,period:{start,end},parent:{type:'subscription_item_details'},pricing:{price_details:{price:b.targetPrice}}}]}};
 const apply=async invoice=>applyPaidBillingEvent(pool,{type:invoice.status==='paid'?'invoice.paid':'invoice.payment_failed',created:start,data:{object:invoice}},{stripe:{...stripe,invoices:{retrieve:async()=>invoice}},now:new Date(start*1000),sendEmail:async()=>({id:'synthetic'})});
 const through=async()=>new Date((await pool.query('SELECT paid_base_through FROM tenant_billing_accounts WHERE tenant_key=$1',[key])).rows[0].paid_base_through).getTime()/1000;
 for(const [name,mutate] of Object.entries({zero:i=>{i.lines.data[0].amount=0;},negative:i=>{i.lines.data[0].amount=-b.amount;},wrong_price:i=>{i.lines.data[0].pricing.price_details.price='price_foreign';},wrong_product:i=>{i.lines.data[0].pricing.price_details.product='prod_foreign';},wrong_operation:i=>{i.lines.data[0].metadata.paid_billing_change_id='change_foreign';},wrong_subscription:i=>{i.lines.data[0].parent.invoice_item_details.subscription='sub_foreign';},wrong_amount:i=>{i.lines.data[0].amount=1;},wrong_window:i=>{i.lines.data[0].period.end--;},prorated:i=>{i.lines.data[0].parent.invoice_item_details.proration=true;}})){
  const invoice=structuredClone(base);invoice.id=`in_${name}`;mutate(invoice);await apply(invoice);assert.equal(await through(),start,name);
 }
 const failed=structuredClone(base);failed.id='in_failed';failed.status='open';failed.amount_remaining=b.amount;failed.amount_paid=0;await apply(failed);assert.equal(await through(),start);
 const grace=(await pool.query('SELECT grace_ends_at FROM billing_delinquencies WHERE tenant_key=$1',[key])).rows[0].grace_ends_at;
 await apply(failed);assert.equal(new Date((await pool.query('SELECT grace_ends_at FROM billing_delinquencies WHERE tenant_key=$1',[key])).rows[0].grace_ends_at).getTime(),new Date(grace).getTime());
 const paid=structuredClone(base);paid.id='in_failed';paid.amount_paid=0; // fully settled from a legitimate balance credit
 await pool.query("UPDATE paid_billing_changes SET provider_params=provider_params-'bridgePriceId' WHERE operation_id=$1",[op.operation_id]);
 const priorReads=readSchedules;await apply(paid);assert.equal(await through(),end);assert(readSchedules>priorReads);await apply(paid);assert.equal(await through(),end);
 assert.equal((await pool.query("SELECT status FROM billing_invoice_debts WHERE stripe_invoice_id='in_failed'")).rows[0].status,'paid');
 const originalBridgeItems=schedules.get(op.schedule_id).phases[1].add_invoice_items;schedules.get(op.schedule_id).phases[1].add_invoice_items=[];const readsBeforeHistoricalReplay=readSchedules;await apply(paid);assert.equal(readSchedules,readsBeforeHistoricalReplay);assert.equal(await through(),end);schedules.get(op.schedule_id).phases[1].add_invoice_items=originalBridgeItems;

 const bridgeSub=subs.get(`sub_${key}`);bridgeSub.status='trialing';bridgeSub.trial_end=end;bridgeSub.items.data[0]={price:prices.get(b.targetPrice),quantity:1,current_period_start:start,current_period_end:end};
 await syncPaidSubscription(pool,key,bridgeSub,{plans:config});
 stripe.invoices={retrieve:async invoiceId=>{assert.equal(invoiceId,paid.id);return structuredClone(paid);}};
 paid.status='open';await assert.rejects(changePaidSubscription(pool,key,'tenant:fixture',{action:'plan',planCode:'growth',billingInterval:'month'},{stripe}),/paid_bridge_settlement_required_before_plan_change/);paid.status='paid';
 failUpdate=true;await assert.rejects(changePaidSubscription(pool,key,'tenant:fixture',{action:'plan',planCode:'growth',billingInterval:'month'},{stripe}),/accepted_update_timeout/);
 const nextOp=(await pool.query("SELECT * FROM paid_billing_changes WHERE tenant_key=$1 AND status='pending'",[key])).rows[0];
 assert(nextOp);assert.equal(nextOp.provider_params.params.phases[0].add_invoice_items,undefined);assert.equal(nextOp.provider_params.params.phases[0].trial_end,end);
 assert.equal(schedules.get(op.schedule_id).phases[0].add_invoice_items,undefined);
 const readCountBeforeReplay=readSchedules;await apply(paid);assert.equal(readSchedules,readCountBeforeReplay);assert.equal(await through(),end);
 assert.equal((await pool.query('SELECT provider_params FROM paid_billing_changes WHERE operation_id=$1',[op.operation_id])).rows[0].provider_params.bridgeInvoiceId,paid.id);
 const lostRequest=structuredClone(updates.at(-1));await changePaidSubscription(pool,key,'tenant:fixture',{action:'plan',planCode:'growth',billingInterval:'month'},{stripe});assert.deepEqual(updates.at(-1),lostRequest);
 assert.equal((await pool.query('SELECT status FROM paid_billing_changes WHERE operation_id=$1',[nextOp.operation_id])).rows[0].status,'complete');
 assert.equal((await pool.query('SELECT provider_params FROM paid_billing_changes WHERE operation_id=$1',[op.operation_id])).rows[0].provider_params.bridgeInvoiceId,paid.id);
 capturePaidRequests('schedule-update-reschedule',[{sourcePlan:target.code,sourceInterval:'month',targetPlan:'growth',targetInterval:'month',usageAnchorAt:'2027-01-31T12:00:00Z',request:nextOp.provider_params.params}]);
 console.log('PASS unpaid bridge blocks rescheduling; paid bridge omits billed item; accepted response timeout preserves original receipt and historical replay without provider reconstruction');
 console.log('PASS zero/negative/foreign/prorated/unbound lines grant nothing; unpaid bridge retains fixed grace; canonical missing receipt readback and credit-settled positive base grant exact term, replay monotonic');
 // Subscription event ordering is independent: a later canonical plan update
 // cannot change the frozen bridge charge or its paid-through boundary.
 const recurring=structuredClone(base);recurring.id='in_next';recurring.billing_reason='subscription_cycle';recurring.lines.data=[{amount:plans[1].monthlyAmountCents,currency:'usd',quantity:1,period:{start:end,end:seconds('2028-04-30T12:00:00Z')},parent:{type:'subscription_item_details',subscription_item_details:{subscription:`sub_${key}`,proration:false}},pricing:{price_details:{price:'price_growth_month',product:'prod_growth'}}}];
 await apply(recurring);assert.equal(await through(),seconds('2028-04-30T12:00:00Z'));await apply(paid);assert.equal(await through(),seconds('2028-04-30T12:00:00Z'));
 console.log('PASS recognized recurring line resumes full original-month coverage; older paid bridge replay never shortens coverage');
}finally{await fixture.close();}
