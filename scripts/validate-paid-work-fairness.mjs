import assert from 'node:assert/strict';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {calendarMonthBoundary} from '../lib/paidBillingCalendar.js';
import {paidSubscriptionParams,purchaseTerms} from '../pages/api/_lib/paidPurchaseContract.js';
import {reconcilePaidPurchases,establishPaidSubscriptions} from '../pages/api/_lib/paidPurchaseEvents.js';
import {processPaidIntakeJobs} from '../pages/api/_lib/paidProvisioning.js';
import {claimPaidPurchaseWork,finishPaidPurchaseWork} from '../pages/api/_lib/paidPurchaseWork.js';

const paidAt=new Date(Math.floor(Date.now()/1000)*1000-60_000);
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const list=rows=>({async *[Symbol.asyncIterator](){for(const row of rows)yield structuredClone(row);}});
async function setup(label){
 const fixture=await createUpibTestFixture({label,migrations:['0049_live_prompt_settings.sql','0063_unified_paid_intake.sql','0064_paid_billing_lifecycle.sql']});
 const {pool}=fixture,rows=new Map(),subscriptions=new Map(),creates=new Map(),sessionReads=new Map();
 async function seed(name,phase,{old=false,uncertain=false}={}){
  const key=`purchase_${name}`,customer=`cus_${name}`,intake=`intake_${name}`;
  const payload={businessName:`Fixture ${name}`,businessCategory:'service_business',website:`https://${name}.fixture.invalid/`,companyDescription:'A fixture service business.',leadPhone:'+15035550000',planCode:'growth',billingInterval:'month',marketingAttribution:{}};
  await pool.query('INSERT INTO paid_intakes(intake_id,owner_email,payload_json,verified_at) VALUES($1,$2,$3::jsonb,NOW())',[intake,`${name}@fixture.invalid`,JSON.stringify(payload)]);
  const row={purchase_id:key,intake_id:intake,owner_email:`${name}@fixture.invalid`,kind:'setup',plan_code:'growth',billing_interval:'month',amount_cents:10000,setup_amount_cents:10000,paid_at:paidAt,stripe_customer_id:customer,stripe_price_id:'price_growth_month'};
  const params=paidSubscriptionParams(row,`pm_${name}`);
  await pool.query(`INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,plan_code,billing_interval,livemode,amount_cents,
   payment_status,provisioning_status,stripe_customer_id,stripe_price_id,stripe_session_id,checkout_started_at,
   consent_accepted_at,consent_terms_json,paid_at,usage_anchor_at,initial_period_end,subscription_params,subscription_started_at,
   recurring_consent_at,stripe_subscription_id,created_at,updated_at)
   VALUES($1,$2,$3,'growth','month',TRUE,10000,$4,$5,$6,'price_growth_month',$7,NOW(),NOW(),$8::jsonb,$9,$9,$10,$11::jsonb,$12,$13,$14,$15,$15)`,
  [key,intake,row.owner_email,phase==='payment'?'pending':'paid',phase==='payment'?'unpaid':phase==='subscription'?'awaiting_subscription':'queued',customer,`cs_${name}`,JSON.stringify(purchaseTerms(row)),phase==='payment'?null:paidAt,calendarMonthBoundary(paidAt,1),phase==='payment'?null:JSON.stringify(params),uncertain?new Date(Date.now()-48*3600000):null,phase==='provisioning'?paidAt:null,phase==='provisioning'?`sub_${name}`:null,new Date(old?'2020-01-01':'2021-01-01')]);
  rows.set(key,{...row,name,params,open:false});return key;
 }
 const stripe={
  checkout:{sessions:{retrieve:async sessionId=>{
   const name=sessionId.slice(3),row=rows.get(`purchase_${name}`);sessionReads.set(name,(sessionReads.get(name)||0)+1);
   if(stripe.beforeSession)await stripe.beforeSession(name);
   return {id:sessionId,livemode:true,mode:'payment',status:row.open?'open':'complete',payment_status:row.open?'unpaid':'paid',customer:row.stripe_customer_id,
    client_reference_id:row.purchase_id,metadata:{paid_purchase_id:row.purchase_id,paid_intake_id:row.intake_id},currency:'usd',amount_total:10000,
    payment_intent:`pi_${name}`,consent:{terms_of_service:'accepted'}};
  }}},
  paymentIntents:{retrieve:async intentId=>{const name=intentId.slice(3),row=rows.get(`purchase_${name}`);return {id:intentId,livemode:true,status:'succeeded',customer:row.stripe_customer_id,currency:'usd',amount_received:10000,metadata:{paid_purchase_id:row.purchase_id},payment_method:`pm_${name}`,latest_charge:{paid:true,captured:true,created:Math.floor(paidAt/1000)}};}},
  paymentMethods:{retrieve:async methodId=>({id:methodId,livemode:true,customer:`cus_${methodId.slice(3)}`})},
  subscriptions:{list:({customer})=>list([...subscriptions.values()].filter(s=>s.customer===customer)),create:async params=>{
   const name=params.metadata.paid_purchase_id.slice('purchase_'.length);creates.set(name,(creates.get(name)||0)+1);
   if(stripe.beforeSubscription)await stripe.beforeSubscription(name);
   const sub={...params,id:`sub_${name}`,status:'active',livemode:true,items:{data:[{price:params.items[0].price,quantity:1,current_period_end:Math.floor(calendarMonthBoundary(paidAt,1)/1000)}]}};
   subscriptions.set(sub.id,sub);return structuredClone(sub);
  },retrieve:async id=>structuredClone(subscriptions.get(id))}
 };
 async function work(phase,options={}){
  if(phase==='payment')return reconcilePaidPurchases(pool,{stripe,limit:1});
  if(phase==='subscription')return establishPaidSubscriptions(pool,{stripe,limit:1});
  return processPaidIntakeJobs(pool,{limit:1,enqueue:async(db,tenantKey,input)=>{
   if(options.failBuild&&input.purchaseId.endsWith('old'))throw Error('permanent_fixture_build_failure');
   return {build_id:`build_${input.purchaseId}`};
  },provision:options.provision||(async()=>({ok:true}))});
 }
 return {...fixture,seed,rows,stripe,creates,sessionReads,work};
}

for(const phase of ['payment','subscription','provisioning']){
 const f=await setup(`fair_${phase}`);
 try{
  const old=await f.seed('old',phase,{old:true,uncertain:phase==='subscription'}),fresh=await f.seed('fresh',phase);
  f.rows.get(old).open=true;
  await f.work(phase,{failBuild:true});
  const blocked=(await f.pool.query('SELECT * FROM paid_purchases WHERE purchase_id=$1',[old])).rows[0];
  assert.equal(blocked.payment_status,phase==='payment'?'pending':'paid');
  if(phase==='subscription'){
   assert.equal(blocked.provisioning_status,'subscription_review');assert.match(blocked.last_error,/uncertainty_requires_reconciliation/);
   assert.deepEqual(blocked.subscription_params,f.rows.get(old).params,'Unknown provider request parameters remain immutable');
  }else assert.ok(new Date(blocked.lease_until)>new Date(),'Blocked work must have durable backoff');
  await f.work(phase,{failBuild:true});
  const progressed=(await f.pool.query('SELECT * FROM paid_purchases WHERE purchase_id=$1',[fresh])).rows[0];
  if(phase==='provisioning')assert.equal(progressed.provisioning_status,'awaiting_knowledge_review');
  else assert.ok(progressed.recurring_consent_at,'Fresh paid work must establish its subscription');
  assert.equal((await f.pool.query('SELECT updated_at FROM paid_purchases WHERE purchase_id=$1',[old])).rows[0].updated_at.getTime(),blocked.updated_at.getTime(),'Backoff/review work must not consume the next batch');
  console.log(`PASS ${phase}: limit-one old blocked work cannot starve a fresh purchase`);
 }finally{await f.close();}
}

for(const phase of ['payment','subscription','provisioning']){
 const f=await setup(`overlap_${phase}`),entered=deferred(),finish=deferred();let blockedOnce=false;
 try{
  const old=await f.seed('old',phase,{old:true}),fresh=await f.seed('fresh',phase);
  const calls=new Map();
  const pause=async name=>{if(name==='old'&&!blockedOnce){blockedOnce=true;entered.resolve();await finish.promise;}};
  if(phase==='payment')f.stripe.beforeSession=pause;
  if(phase==='subscription')f.stripe.beforeSubscription=pause;
  const options={provision:async({purchaseId})=>{const name=purchaseId.slice('purchase_'.length);calls.set(name,(calls.get(name)||0)+1);await pause(name);return {ok:true};}};
  const first=f.work(phase,options);await entered.promise;
  await f.work(phase,options);
  const newer=(await f.pool.query('SELECT * FROM paid_purchases WHERE purchase_id=$1',[fresh])).rows[0];
  assert.ok(phase==='provisioning'?newer.provisioning_status==='awaiting_knowledge_review':newer.recurring_consent_at,'Second worker must claim fresh work while first worker is blocked');
  finish.resolve();await first;
  const older=(await f.pool.query('SELECT * FROM paid_purchases WHERE purchase_id=$1',[old])).rows[0];
  assert.ok(phase==='provisioning'?older.provisioning_status==='awaiting_knowledge_review':older.recurring_consent_at);
  for(const name of ['old','fresh'])assert.equal(phase==='provisioning'?calls.get(name):f.creates.get(name),1,'Only one effect per purchase under contention');
  console.log(`PASS ${phase}: overlapping workers claim separate purchases exactly once`);
 }finally{finish.resolve();await f.close();}
}

const f=await setup('crash_rotation');
try{
 const old=await f.seed('old','payment',{old:true}),fresh=await f.seed('fresh','payment');
 const first=await claimPaidPurchaseWork(f.pool,'payment',{limit:1});assert.equal(first.rows[0].purchase_id,old);
 await f.pool.query("UPDATE paid_purchases SET lease_until=NOW()-interval '1 second' WHERE purchase_id=$1",[old]);
 const second=await claimPaidPurchaseWork(f.pool,'payment',{limit:1});assert.equal(second.rows[0].purchase_id,fresh,'Committed last-attempt rotation survives a worker crash');
 const reclaimed=await claimPaidPurchaseWork(f.pool,'payment',{limit:1});assert.equal(reclaimed.rows[0].purchase_id,old);
 await finishPaidPurchaseWork(f.pool,'payment',old,first.token,{error:Error('stale_worker_error')});
 const row=(await f.pool.query('SELECT * FROM paid_purchases WHERE purchase_id=$1',[old])).rows[0];assert.equal(row.lease_token,reclaimed.token);assert.equal(row.last_error,null);
 console.log('PASS crash rotation and stale-worker completion fencing');
}finally{await f.close();}
console.log('Paid work fairness: all seven native PostgreSQL scenarios passed.');
