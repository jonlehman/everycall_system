import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {resolvePaidMoneyEventScope} from '../pages/api/_lib/paidMoneyEvents.js';
import {applyPaidPurchaseEvent} from '../pages/api/_lib/paidPurchaseEvents.js';

const fixture=await createUpibTestFixture({label:'moneyscope'}),{pool}=fixture;
const charges=new Map(),refunds=new Map(),disputes=new Map(),payments=new Map(),sessions=new Map();
let providerFailure=false,failReceipt=false,entitlementCalls=0;
const retrieve=map=>async key=>{if(providerFailure)throw Error('stripe_provider_timeout');const value=map.get(key);assert(value,`Missing provider fixture ${key}`);return structuredClone(value);};
const stripe={charges:{retrieve:retrieve(charges)},refunds:{retrieve:retrieve(refunds)},disputes:{retrieve:retrieve(disputes)},paymentIntents:{retrieve:retrieve(payments)},checkout:{sessions:{list:async({payment_intent})=>({data:[...sessions.values()].filter(s=>s.payment_intent===payment_intent),has_more:false})}}};
const source=fs.readFileSync(new URL('../pages/api/v1/stripe/webhook.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/export default /g,'').replace(/export /g,'');
const db={query:pool.query.bind(pool),connect:async()=>{const c=await pool.connect();return {release:()=>c.release(),query:async(sql,args)=>{if(failReceipt&&sql.includes("SET status = 'processed'")){failReceipt=false;throw Error('receipt_fault');}return c.query(sql,args);}};}};
const deps={handlePrivateOwnerBillingEvent:async()=>false,resolvePaidMoneyEventScope:(db,event)=>resolvePaidMoneyEventScope(db,event,{stripe}),applyPaidPurchaseEvent:(db,event,options)=>applyPaidPurchaseEvent(db,event,{...options,stripe}),applyPaidBillingEvent:async()=>false,syncPaidBillingEntitlement:async()=>{entitlementCalls++;throw Error('money_must_not_mutate_entitlement');},applySalesPaidCheckout:async()=>false,readRawBody:async req=>req.event,constructWebhookEvent:event=>event,ensureTables:async()=>{},getPool:()=>db,retrieveSubscription:async()=>{throw Error('unused');},retrieveSubscriptionSchedule:async()=>{throw Error('unused');},syncTenantStripeSubscription:async()=>{throw Error('unused');},syncTenantStripeSubscriptionSchedule:async()=>{throw Error('unused');},activatePendingCouponDiscountWindow:async()=>{throw Error('unused');}};
const handler=new Function(...Object.keys(deps),source+';return handler;')(...Object.values(deps));
async function send(event){const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};await handler({method:'POST',headers:{},event},res);return res;}
const event=(name,type,object)=>({id:`evt_${name}`,livemode:true,type,data:{object}});
async function absent(e){for(const table of ['billing_events','billing_money_reviews'])assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE stripe_event_id=$1`,[e.id])).rowCount,0);}
async function seedPurchase(name,{customer=`cus_${name}`,payment=`pi_${name}`,tenant=null,legacy=null}={}){
 await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json) VALUES($1,$2,'{}')",[name,`${name}@fixture.invalid`]);
 await pool.query(`INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,tenant_key,plan_code,billing_interval,livemode,amount_cents,payment_status,stripe_customer_id,stripe_payment_intent_id,legacy_payment_intent_id)
 VALUES($1,$1,$2,$3,'starter','month',TRUE,10000,'paid',$4,$5,$6)`,[name,`${name}@fixture.invalid`,tenant,customer,payment,legacy]);
}
try{
 await pool.query("INSERT INTO tenants(tenant_key,name,status,plan,plan_code,billing_status,service_access_status,app_access_status) VALUES('legacy_account','Legacy','active','starter','starter','active','enabled','enabled'),('conflict_account','Conflict','active','starter','starter','active','enabled','enabled')");
 await pool.query("INSERT INTO tenant_billing_accounts(tenant_key,stripe_customer_id) VALUES('legacy_account','cus_legacy'),('conflict_account','cus_conflict')");
 await seedPurchase('preconvert');
 await seedPurchase('reused',{customer:'cus_new_consent',payment:'pi_new',legacy:'pi_historical'});
 const before=JSON.stringify((await pool.query('SELECT to_jsonb(t) AS row FROM tenants t ORDER BY tenant_key')).rows);
 charges.set('ch_foreign',{id:'ch_foreign',livemode:true,payment_intent:'pi_foreign',customer:'cus_other_business',metadata:{tenant_key:'legacy_account',paid_purchase_id:'preconvert'}});
 const foreign=event('foreign','charge.refunded',{...charges.get('ch_foreign'),amount_refunded:50,private_business_payload:'foreign-must-not-persist'});
 assert.equal((await send(foreign)).body.ignored,true);await absent(foreign);
 assert.equal(await applyPaidPurchaseEvent(pool,foreign,{stripe}),true);await absent(foreign);
 console.log('PASS shared-account foreign money/forged metadata ignored before either raw event or review persistence');
 charges.set('ch_preconvert',{id:'ch_preconvert',livemode:true,payment_intent:'pi_preconvert',customer:'cus_preconvert',amount_refunded:50});
 const types=['charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.created','refund.updated','refund.failed'];
 for(const [index,type] of types.entries()){
  const object=type==='charge.refunded'?charges.get('ch_preconvert'):{id:`money_${index}`,charge:'ch_preconvert',payment_intent:'pi_preconvert',amount:50};
  (type.startsWith('refund.')?refunds:disputes).set(object.id,object);
  const e=event(`owned_${index}`,type,object);assert.equal((await send(e)).statusCode,200);
  assert.equal((await send(e)).body.duplicate,true);
  const row=(await pool.query('SELECT tenant_key,review_status FROM billing_money_reviews WHERE stripe_event_id=$1',[e.id])).rows[0];assert.deepEqual(row,{tenant_key:null,review_status:'pending'});
 }
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM billing_money_reviews')).rows[0].count,7);
 assert.equal((await pool.query("SELECT payment_status FROM paid_purchases WHERE purchase_id='preconvert'")).rows[0].payment_status,'paid');
 console.log('PASS all seven money types preserve legitimate unconverted purchase, one manual review per event, partial-refund entitlement unchanged');
 charges.set('ch_legacy',{id:'ch_legacy',livemode:true,payment_intent:'pi_renewal',customer:'cus_legacy'});
 const legacy=event('legacy_customer','charge.refunded',charges.get('ch_legacy'));assert.equal((await send(legacy)).statusCode,200);
 assert.equal((await pool.query('SELECT tenant_key FROM billing_money_reviews WHERE stripe_event_id=$1',[legacy.id])).rows[0].tenant_key,'legacy_account');
 charges.set('ch_reused',{id:'ch_reused',livemode:true,payment_intent:'pi_historical',customer:null});
 assert.equal((await send(event('reused','charge.refunded',charges.get('ch_reused')))).statusCode,200);
 refunds.set('re_nocharge',{id:'re_nocharge',payment_intent:'pi_preconvert'});payments.set('pi_preconvert',{id:'pi_preconvert',livemode:true,latest_charge:'ch_preconvert'});
 assert.equal((await send(event('refund_pi_fallback','refund.created',refunds.get('re_nocharge')))).statusCode,200);
 console.log('PASS legacy account customer, historical reused PaymentIntent, and canonical refund-to-payment-to-charge association');
 const mismatch=event('mismatch','refund.created',{id:'re_nocharge',payment_intent:'pi_wrong'});assert.equal((await send(mismatch)).statusCode,503);await absent(mismatch);
 charges.set('ch_conflict',{id:'ch_conflict',livemode:true,payment_intent:'pi_preconvert',customer:'cus_conflict'});
 const conflict=event('conflict','charge.refunded',charges.get('ch_conflict'));assert.equal((await send(conflict)).statusCode,503);await absent(conflict);
 await seedPurchase('other_preconvert',{customer:'cus_preconvert',payment:'pi_other'});
 const ambiguous=event('ambiguous','charge.refunded',charges.get('ch_preconvert'));assert.equal((await send(ambiguous)).statusCode,503);await absent(ambiguous);
 await pool.query("UPDATE paid_purchases SET stripe_customer_id='cus_distinct' WHERE purchase_id='other_preconvert'");
 const timeout=event('timeout','charge.refunded',charges.get('ch_preconvert'));providerFailure=true;assert.equal((await send(timeout)).statusCode,503);await absent(timeout);providerFailure=false;assert.equal((await send(timeout)).statusCode,200);
 const wrongMode=event('wrong_mode','charge.refunded',{id:'ch_test'});charges.set('ch_test',{id:'ch_test',livemode:false,payment_intent:'pi_preconvert',customer:'cus_preconvert'});assert.equal((await send(wrongMode)).statusCode,503);await absent(wrongMode);
 console.log('PASS canonical mismatch, conflicting/ambiguous local identities, provider failure retry and wrong-mode events fail before persistence');
 await pool.query("INSERT INTO admin_users(id,username,email,role) VALUES(901,'money_fixture','money@fixture.invalid','sales')");
 await pool.query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,status,assigned_rep_user_id) VALUES('money_old','money_source','Legacy payment','+15035550111','paid',901)");
 await pool.query("INSERT INTO sales_checkout_sessions(checkout_id,prospect_id,rep_user_id,channel,recipient,status,paid_at,stripe_session_id,amount_cents) VALUES('money_old','money_old',901,'email','old@fixture.invalid','paid',NOW(),'cs_old',100)");
 charges.set('ch_old',{id:'ch_old',livemode:true,payment_intent:'pi_old',customer:null});
 sessions.set('cs_old',{id:'cs_old',livemode:true,mode:'payment',payment_status:'paid',payment_intent:'pi_old',customer:null,currency:'usd',amount_total:100});
 const old=event('legacy_frozen_setup','charge.refunded',charges.get('ch_old'));assert.equal((await send(old)).statusCode,200);
 assert.equal((await pool.query('SELECT tenant_key FROM billing_money_reviews WHERE stripe_event_id=$1',[old.id])).rows[0].tenant_key,null);
 sessions.get('cs_old').amount_total=10000;const wrongAmount=event('legacy_wrong_amount','charge.refunded',charges.get('ch_old'));assert.equal((await send(wrongAmount)).statusCode,503);await absent(wrongAmount);sessions.get('cs_old').amount_total=100;
 assert.equal((await send(event('foreign_after_legacy','charge.refunded',charges.get('ch_foreign')))).body.ignored,true);
 console.log('PASS historical live $1 matched by frozen canonical Session, amount mismatch rejected, unrelated payment still ignored');
 const rollback=event('receipt_rollback','charge.refunded',charges.get('ch_preconvert'));failReceipt=true;assert.equal((await send(rollback)).statusCode,503);
 assert.equal((await pool.query('SELECT 1 FROM billing_money_reviews WHERE stripe_event_id=$1',[rollback.id])).rowCount,0);
 assert.equal((await send(rollback)).statusCode,200);assert.equal((await send(rollback)).body.duplicate,true);
 assert.equal(entitlementCalls,0);assert.equal(JSON.stringify((await pool.query('SELECT to_jsonb(t) AS row FROM tenants t ORDER BY tenant_key')).rows),before);
 console.log('PASS actual webhook final-receipt rollback/retry, deduplication and zero money-triggered entitlement writes');
}finally{await fixture.close();}
