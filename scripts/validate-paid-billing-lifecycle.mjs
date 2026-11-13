import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncTenantStripeSubscription,syncTenantStripeSubscriptionSchedule } from '../pages/api/_lib/billing.js';
import { createUpibTestFixture } from './lib/upib-test-fixture.mjs';
import { calendarMonthBoundary,monthlyUsageWindow } from '../lib/paidBillingCalendar.js';
import { applyPaidBillingEvent,syncPaidBillingEntitlement,sendPaidBillingReminders } from '../pages/api/_lib/paidBillingLifecycle.js';
import { collectPaidUsageInvoice } from '../pages/api/_lib/paidUsageInvoices.js';
import { reconcilePaidNumberRelease,preparePaidReinstatementNumber } from '../pages/api/_lib/paidNumberRelease.js';
import { createSupportSession,resolveSupportSession,endSupportSession } from '../pages/api/_lib/supportSessions.js';
import { syncPaidSubscription } from '../pages/api/_lib/paidSubscriptionSync.js';
import { getPaidBillingReadModel,paidUsageInvoiceEstimate } from '../pages/api/_lib/paidBillingReadModel.js';
import { paidSetupAvailability,bookPaidSetup } from '../pages/api/_lib/paidSetupBookings.js';
import { rateBillingPeriod,createBillingPeriodAdjustment,setManualCallBillingExclusion } from '../pages/api/_lib/callBilling.js';

const fixture=await createUpibTestFixture({label:'billing'}),{pool}=fixture;
const iso=x=>new Date(x).toISOString();
const at=new Date('2028-02-10T12:00:00Z');
process.env.APP_BASE_URL='https://app.example.test';
async function seed(key,{interval='year',anchor='2028-01-31T12:00:00Z',through='2029-02-28T12:00:00Z',quota=2}={}){
 await pool.query("INSERT INTO tenants(tenant_key,name,status,plan,plan_code,billing_status,service_access_status,app_access_status) VALUES($1,$1,'active','starter','starter','active','enabled','enabled')",[key]);
 await pool.query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json,verified_at) VALUES($1,$2,'{}',NOW())",[key,`${key}@example.test`]);
 await pool.query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,tenant_key,plan_code,billing_interval,livemode,amount_cents,payment_status,paid_at,recurring_consent_at) VALUES($1,$1,$2,$1,'starter',$3,TRUE,10000,'paid',$4,$4)",[key,`${key}@example.test`,interval,anchor]);
 await pool.query(`INSERT INTO tenant_billing_accounts(tenant_key,paid_purchase_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_interval,monthly_amount_cents,included_call_count,call_overage_rate_cents,usage_anchor_at,paid_base_through,current_period_start,current_period_end)
 VALUES($1,$1,$2,$3,'price_starter',$4,7450,$5,300,$6,$7,$6,$7)`,[key,`cus_${key}`,`sub_${key}`,interval,quota,anchor,through]);
 await pool.query("INSERT INTO tenant_users(tenant_key,name,email,role,status) VALUES($1,$1,$2,'owner','active')",[key,`${key}@example.test`]);
}
async function call(key,id,created=at){await pool.query("INSERT INTO calls(call_sid,tenant_key,status,created_at) VALUES($1,$2,'in_progress',$3)",[id,key,created]);}
async function reserve(key,id,now=at){return(await pool.query('SELECT * FROM reserve_paid_call($1,$2,$3)',[key,id,now])).rows[0];}
async function fail(key,id,{kind='base',amount=7450,now=at,periodId=null}={}){
 const invoice={id,customer:`cus_${key}`,subscription:`sub_${key}`,currency:'usd',livemode:true,status:'open',amount_remaining:amount,total:amount,metadata:kind==='overage'?{item_type:'call_overage',tenant_key:key,billing_period_id:String(periodId)}:{}};
 await applyPaidBillingEvent(pool,{type:'invoice.payment_failed',created:Math.floor(now.getTime()/1000),data:{object:invoice}},{stripe:{invoices:{retrieve:async()=>invoice}},now,sendEmail:async()=>({id:'mail'})});return invoice;
}
try{
 assert.equal(iso(calendarMonthBoundary('2028-01-31T12:34:56Z',1)),'2028-02-29T12:34:56.000Z');
 assert.equal(iso(calendarMonthBoundary('2028-01-31T12:34:56Z',2)),'2028-03-31T12:34:56.000Z');
 assert.equal(iso(calendarMonthBoundary('2028-02-29T12:00:00Z',12)),'2029-02-28T12:00:00.000Z');
 assert.equal(iso(monthlyUsageWindow('2027-01-31','2027-03-29').start),'2027-02-28T00:00:00.000Z');
 await seed('annual');await call('annual','invoice_anchor');const admitted=await reserve('annual','invoice_anchor');
 await pool.query("UPDATE calls SET status='completed' WHERE call_sid='invoice_anchor'");
 await pool.query("UPDATE billing_call_admissions SET status='nonbillable' WHERE call_sid='invoice_anchor'");
 await pool.query("UPDATE billing_periods SET invoice_payload=jsonb_build_object('amount',600) WHERE billing_period_id=$1",[admitted.period_id]);
 const invoice=await fail('annual','in_overage',{kind:'overage',amount:600,periodId:admitted.period_id});
 const late=new Date('2028-02-16T12:00:00Z');
 assert.equal((await syncPaidBillingEntitlement(pool,'annual',{now:late})).restriction,'included_only');
 const ep=(await pool.query("SELECT * FROM billing_delinquencies WHERE tenant_key='annual'")).rows[0];
 assert.equal(iso(ep.grace_ends_at),'2028-02-15T12:00:00.000Z');assert.equal(ep.number_release_at,null);
 // Real overlapping clients serialize reservations on the tenant row.
 await Promise.all(Array.from({length:8},(_,i)=>call('annual',`race_${i}`,late)));
 const gate=await pool.connect();await gate.query('BEGIN');await gate.query("SELECT tenant_key FROM tenants WHERE tenant_key='annual' FOR UPDATE");
 let finished=0;const requests=Array.from({length:8},(_,i)=>reserve('annual',`race_${i}`,late).then(r=>{finished++;return r;}));
 await new Promise(resolve=>setTimeout(resolve,50));assert.equal(finished,0);await gate.query('COMMIT');gate.release();
 const admittedRace=await Promise.all(requests);assert.equal(admittedRace.filter(r=>r.allowed).length,2);
 assert.equal((await reserve('annual','race_0',late)).allowed,admittedRace[0].allowed);
 const accepted=admittedRace.findIndex(r=>r.allowed);
 await pool.query("UPDATE calls SET status='completed' WHERE call_sid=$1",[`race_${accepted}`]);
 // Completed never-answered calls release capacity on admission without waiting for the post-call worker.
 await call('annual','replacement',late);assert.equal((await reserve('annual','replacement',late)).allowed,true);
 const rollover=new Date('2028-02-29T12:00:00Z');await call('annual','reset',rollover);const reset=await reserve('annual','reset',rollover);assert.equal(reset.allowed,true);
 const next=(await pool.query('SELECT * FROM billing_periods WHERE billing_period_id=$1',[reset.period_id])).rows[0];assert.equal(iso(next.period_start),iso(rollover));assert.equal(iso(next.period_end),'2028-03-31T12:00:00.000Z');
 const before=(await pool.query("SELECT usage_anchor_at,paid_base_through,stripe_subscription_id FROM tenant_billing_accounts WHERE tenant_key='annual'")).rows[0];
 invoice.status='paid';invoice.amount_remaining=0;
 await applyPaidBillingEvent(pool,{type:'invoice.payment_failed',created:1,data:{object:invoice}},{stripe:{invoices:{retrieve:async()=>invoice}},now:late,sendEmail:async()=>{throw Error('stale paid failure must not email');}});
 assert.equal((await syncPaidBillingEntitlement(pool,'annual',{now:late})).restriction,'normal');
 assert.deepEqual((await pool.query("SELECT usage_anchor_at,paid_base_through,stripe_subscription_id FROM tenant_billing_accounts WHERE tenant_key='annual'")).rows[0],before);
 console.log('PASS calendar anniversaries, real admission contention, nonbillable reconciliation, annual monthly reset, stale failure settlement');
 await seed('sca',{interval:'month',through:at});
 const scaInvoice={id:'in_sca',customer:'cus_sca',subscription:'sub_sca',livemode:true,currency:'usd',status:'open',amount_remaining:7450,total:7450};
 const scaEvent={type:'invoice.payment_action_required',created:at.getTime()/1000,data:{object:scaInvoice}},scaStripe={invoices:{retrieve:async()=>scaInvoice}};
 await applyPaidBillingEvent(pool,scaEvent,{stripe:scaStripe,now:at,sendEmail:async()=>({id:'sca_mail'})});
 assert.equal((await syncPaidBillingEntitlement(pool,'sca',{now:new Date(at.getTime()+86400000)})).restriction,'grace');
 scaInvoice.status='paid';scaInvoice.amount_remaining=0;scaInvoice.amount_paid=7450;scaInvoice.lines={data:[{type:'subscription',amount:7450,period:{end:calendarMonthBoundary(at,1).getTime()/1000}}]};
 await applyPaidBillingEvent(pool,{...scaEvent,type:'invoice.paid'},{stripe:scaStripe,now:at});
 await applyPaidBillingEvent(pool,scaEvent,{stripe:scaStripe,now:at,sendEmail:async()=>{throw Error('no stale SCA reminder');}});
 const scaState=await syncPaidBillingEntitlement(pool,'sca',{now:at});assert.equal(scaState.restriction,'normal');assert.equal(scaState.graceEndsAt,null);
 console.log('PASS first authentication-required invoice starts fixed grace; paid and stale SCA reconcile without restarted debt');

 await seed('monthly',{interval:'month',through:'2028-02-10T12:00:00Z'});
 await fail('monthly','in_base');await fail('monthly','in_second',{now:new Date('2028-02-13T12:00:00Z'),amount:100});
 const suspended=await syncPaidBillingEntitlement(pool,'monthly',{now:late});assert.equal(suspended.restriction,'suspended');assert.equal(iso(suspended.graceEndsAt),'2028-02-15T12:00:00.000Z');assert.equal(iso(suspended.numberReleaseAt),'2028-03-16T12:00:00.000Z');
 const emails=[];await sendPaidBillingReminders(pool,'monthly',{now:late,sendEmail:async m=>emails.push(m)});await sendPaidBillingReminders(pool,'monthly',{now:late,sendEmail:async m=>emails.push(m)});
 assert.equal(emails.length,1);assert.match(emails[0].text,/\$75.50/);assert.match(emails[0].text,/2028-02-15/);assert.match(emails[0].text,/account\/billing\?tenantKey=monthly/);assert.match(emails[0].text,/suspended/);
 await sendPaidBillingReminders(pool,'monthly',{now:new Date('2028-03-11T12:00:00Z'),sendEmail:async m=>emails.push(m)});assert.match(emails.at(-1).subject,/release warning/);
 await call('monthly','blocked',late);assert.equal((await reserve('monthly','blocked',late)).allowed,false);
 const accountRead=(await pool.query("SELECT * FROM tenant_billing_accounts WHERE tenant_key='monthly'")).rows[0];
 const read=await getPaidBillingReadModel(pool,accountRead,{now:late});assert.equal(read.restriction,'suspended');assert.equal(read.amountOwedCents,7550);assert.equal(read.monthlyOverageBilling,true);
 const prepaidEstimate=paidUsageInvoiceEstimate({current_period_end:'2029-02-28'}, {baseAmountCents:75990},{overageAmountCents:600},'2028-03-31');assert.equal(prepaidEstimate.totalEstimatedInvoiceCents,600);
 assert.equal(paidUsageInvoiceEstimate({current_period_end:'2029-02-28'},{baseAmountCents:75990},{overageAmountCents:600},'2029-02-28').totalEstimatedInvoiceCents,76590);
 console.log('PASS fixed five-day grace, additional failures, current debt and owner recovery link, daily dedupe, 30-day hold/5-day warning, separate annual API read model');
 await seed('annual_expiry',{through:'2028-03-31T12:00:00Z'});
 await pool.query("INSERT INTO billing_invoice_debts(stripe_invoice_id,tenant_key,kind,amount_remaining_cents,status,failed_at) VALUES('in_old_overage','annual_expiry','overage',600,'open','2028-02-10T12:00:00Z')");
 assert.equal((await syncPaidBillingEntitlement(pool,'annual_expiry',{now:late})).restriction,'included_only');
 const endedPrepaid=await syncPaidBillingEntitlement(pool,'annual_expiry',{now:new Date('2028-04-01T12:00:00Z')});assert.equal(endedPrepaid.restriction,'suspended');assert.equal(iso(endedPrepaid.numberReleaseAt),'2028-04-30T12:00:00.000Z');
 console.log('PASS old annual overage debt starts full suspension hold at prepaid end, never the earlier overage grace');

 // Provider deletion is submitted once even after a timeout, and never raced by restart.
 await pool.query("UPDATE tenants SET telnyx_voice_number='+12065550101',telnyx_voice_number_id='pn_old' WHERE tenant_key='monthly'");
 let deletes=0,owned=true;const releaseOptions={now:new Date('2028-03-17T12:00:00Z'),getOwned:async()=>owned?{phoneNumberId:'pn_old'}:null,release:async()=>{deletes++;throw Error('timeout');}};
 assert.equal((await reconcilePaidNumberRelease(pool,'monthly',releaseOptions)).released,false);await reconcilePaidNumberRelease(pool,'monthly',releaseOptions);assert.equal(deletes,1);
 assert.equal((await pool.query("SELECT service_access_status,app_access_status FROM tenants WHERE tenant_key='monthly'")).rows[0].app_access_status,'enabled');
 await pool.query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,tenant_key,plan_code,billing_interval,livemode,amount_cents,kind,payment_status,paid_at,recurring_consent_at) VALUES('restart','monthly','monthly@example.test','monthly','starter','month',TRUE,7450,'restart','paid',NOW(),NOW())");
 await assert.rejects(preparePaidReinstatementNumber(pool,'monthly','restart',releaseOptions),/outstanding_debt/);
 await pool.query("UPDATE billing_invoice_debts SET status='paid',amount_remaining_cents=0 WHERE tenant_key='monthly'");
 await assert.rejects(preparePaidReinstatementNumber(pool,'monthly','restart',releaseOptions),/paid_number_release_pending/);
 owned=false;assert.equal((await preparePaidReinstatementNumber(pool,'monthly','restart',releaseOptions)).ready,true);
 await pool.query("UPDATE tenants SET telnyx_voice_number='+12065550102',telnyx_voice_number_id='pn_new' WHERE tenant_key='monthly'");
 await preparePaidReinstatementNumber(pool,'monthly','restart',releaseOptions);assert.equal(deletes,1);assert.equal((await pool.query("SELECT telnyx_voice_number FROM tenants WHERE tenant_key='monthly'")).rows[0].telnyx_voice_number,'+12065550102');
 console.log('PASS irreversible deletion uncertainty, retained login, paid/debt restart fence, restart retries preserve replacement and release history');
 // Invoice double keeps its provider state through an application crash.
 const period=(await pool.query("INSERT INTO billing_periods(tenant_key,period_start,period_end,status,overage_call_count,overage_amount_cents) VALUES('annual','2027-11-30','2027-12-31','finalized',3,900) RETURNING *")).rows[0];
 let creates=0,items=0,finalizes=0,crash=true;let remote=null;
 const stripe={subscriptions:{retrieve:async()=>({livemode:true,customer:'cus_annual',default_payment_method:'pm_saved'})},customers:{retrieve:async()=>{throw Error('customer has no default; subscription method must be used');}},invoices:{create:async params=>{assert.equal(params.default_payment_method,'pm_saved');creates++;remote||={id:'in_usage',customer:params.customer,currency:'usd',livemode:true,total:900,status:'draft',metadata:params.metadata};return remote;},retrieve:async()=>remote,listLineItems:async()=>({data:items?[{amount:900,metadata:{item_type:'call_overage',billing_period_id:String(period.billing_period_id)}}]:[],has_more:false}),finalizeInvoice:async()=>{finalizes++;remote.status='open';return remote;}},invoiceItems:{create:async params=>{assert.equal(params.invoice,'in_usage');items++;if(crash){crash=false;throw Error('crash after provider item accepted');}return{id:'ii_usage'};}}};
 await assert.rejects(collectPaidUsageInvoice(pool,period.billing_period_id,{stripe,now:at}),/crash/);
 await Promise.all([collectPaidUsageInvoice(pool,period.billing_period_id,{stripe,now:late}),collectPaidUsageInvoice(pool,period.billing_period_id,{stripe,now:late})]);
 assert.equal(creates,1);assert.equal(items,1);assert.equal(finalizes,1);
 assert.equal((await pool.query('SELECT status FROM billing_periods WHERE billing_period_id=$1',[period.billing_period_id])).rows[0].status,'invoiced');
 const uncertain=(await pool.query("INSERT INTO billing_periods(tenant_key,period_start,period_end,status,overage_call_count,overage_amount_cents,invoice_attempted_at,invoice_payload) VALUES('annual','2027-10-31','2027-11-30','finalized',1,300,'2027-12-01',jsonb_build_object('customer','cus_annual','amount',300)) RETURNING *")).rows[0];
 await assert.rejects(collectPaidUsageInvoice(pool,uncertain.billing_period_id,{stripe,now:at}),/requires_reconciliation/);assert.equal(creates,1);
 console.log('PASS bound monthly invoice, concurrent retry, crash-after-item reconciliation, expired unknown effect fence');
 await assert.rejects(createBillingPeriodAdjustment(pool,{tenantKey:'annual',billingPeriodId:period.billing_period_id,adjustmentType:'credit',description:'Manual review request',amountCents:300}),/paid_adjustments_manual_review_required/);
 assert.equal(Number((await pool.query('SELECT count(*) AS n FROM billing_period_adjustments WHERE billing_period_id=$1',[period.billing_period_id])).rows[0].n),0);
 const adjustmentPeriod=(await pool.query("INSERT INTO billing_periods(tenant_key,period_start,period_end,status,overage_call_count,overage_amount_cents) VALUES('annual','2027-09-30','2027-10-31','finalized',1,300) RETURNING *")).rows[0];
 await pool.query("INSERT INTO billing_period_adjustments(billing_period_id,adjustment_type,description,amount_cents) VALUES($1,'credit','Historical uncollected credit',300)",[adjustmentPeriod.billing_period_id]);
 await assert.rejects(collectPaidUsageInvoice(pool,adjustmentPeriod.billing_period_id,{stripe,now:at}),/paid_adjustments_manual_review_required/);assert.equal(creates,1);
 console.log('PASS paid adjustment writes fail closed and historical uncollected credit blocks collection instead of overcharging');

 await pool.query("INSERT INTO admin_users(id,username,email,role) VALUES(900,'support','staff@example.test','admin'),(901,'rep','rep@example.test','sales')");
 await pool.query("INSERT INTO sessions(id,user_id,role,expires_at) VALUES('staff',900,'admin','2030-01-01'),('otherstaff',900,'admin','2030-01-01'),('rep',901,'sales','2030-01-01')");
 const staffSession={id:'staff',role:'admin'};const support=await createSupportSession(pool,{staffSession,tenantKey:'annual',now:at});
 assert.equal((await resolveSupportSession(pool,{supportId:support.id,staffSession,now:at,requestedTenantKey:'annual'})).support_session.readOnly,true);
 assert.equal(await resolveSupportSession(pool,{supportId:support.id,staffSession,now:at,requestedTenantKey:'monthly'}),null);
 assert.equal(await resolveSupportSession(pool,{supportId:support.id,staffSession:{id:'otherstaff',role:'admin'},now:at}),null);
 assert.equal(await resolveSupportSession(pool,{supportId:support.id,staffSession,now:at,method:'POST'}),null);
 assert.equal(await resolveSupportSession(pool,{supportId:support.id,staffSession,now:new Date(at.getTime()+31*60000)}),null);
 await assert.rejects(createSupportSession(pool,{staffSession:{id:'rep',role:'admin'},tenantKey:'annual',now:at}),/forbidden/);
 await endSupportSession(pool,{supportId:support.id,staffSession});assert.equal(await resolveSupportSession(pool,{supportId:support.id,staffSession,now:at}),null);
 assert.equal(Number((await pool.query("SELECT count(*) AS n FROM audit_log WHERE actor='admin:900' AND action LIKE 'support.session.%'")).rows[0].n),3);
 console.log('PASS staff-bound, tenant-scoped, expiring, read-only, revocable actor-audited support session');
 await seed('change',{interval:'month',anchor:'2028-01-31T12:00:00Z',through:'2028-02-29T12:00:00Z'});
 const config={plans:[{code:'growth',stripePriceId:'price_growth'}]};
 const sub={id:'sub_change',customer:'cus_change',livemode:true,status:'active',items:{data:[{quantity:1,current_period_start:1835438400,current_period_end:1838116800,price:{id:'price_growth',product:'prod_growth',currency:'usd',unit_amount:12450,recurring:{interval:'month'}}}]}};
 sub.items.data[0].current_period_start=new Date('2028-02-29T12:00:00Z').getTime()/1000;sub.items.data[0].current_period_end=new Date('2028-03-31T12:00:00Z').getTime()/1000;
 const early=structuredClone(sub);early.items.data[0].current_period_start=new Date('2028-02-20T12:00:00Z').getTime()/1000;await assert.rejects(syncPaidSubscription(pool,'change',early,config),/before_term_end/);
 await syncPaidSubscription(pool,'change',sub,config);assert.equal((await pool.query("SELECT plan_code FROM tenants WHERE tenant_key='change'")).rows[0].plan_code,'growth');
 assert.equal((await pool.query("SELECT included_call_count FROM billing_periods WHERE tenant_key='change'")).rows[0].included_call_count,60);
 console.log('PASS configured price validation and deferred next-term plan snapshot');
 // Execute the actual webhook handler around the real subscription sync and a
 // native transaction client; a final receipt failure must roll back its dates.
 await pool.query("INSERT INTO system_config(id,billing_plans_json,global_emergency_phrase) VALUES(1,$1,'Emergency') ON CONFLICT(id) DO UPDATE SET billing_plans_json=EXCLUDED.billing_plans_json",[JSON.stringify([{code:'growth',stripePriceId:'price_growth'}])]);
 const webhookSource=fs.readFileSync(new URL('../pages/api/v1/stripe/webhook.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/export default /g,'').replace(/export /g,'');
 const priorStart=(await pool.query("SELECT current_period_start FROM tenant_billing_accounts WHERE tenant_key='change'")).rows[0].current_period_start;
 const renewed=structuredClone(sub);renewed.items.data[0].current_period_start=new Date('2028-03-31T12:00:00Z').getTime()/1000;renewed.items.data[0].current_period_end=new Date('2028-04-30T12:00:00Z').getTime()/1000;
 let failReceipt=true;const webhookPool={query:pool.query.bind(pool),connect:async()=>{const client=await pool.connect();return {release:()=>client.release(),query:async(sql,args)=>{if(failReceipt&&sql.includes("SET status = 'processed'")){failReceipt=false;throw Error('receipt fault');}return client.query(sql,args);}};}};
 const deps={applyPaidPurchaseEvent:async()=>false,applyPaidBillingEvent:async()=>false,syncPaidBillingEntitlement,applySalesPaidCheckout:async()=>false,readRawBody:async req=>req.event,constructWebhookEvent:e=>e,retrieveSubscription:async()=>renewed,retrieveSubscriptionSchedule:async()=>null,ensureTables:async()=>{},getPool:()=>webhookPool,syncTenantStripeSubscription,syncTenantStripeSubscriptionSchedule:async()=>{},activatePendingCouponDiscountWindow:async()=>{}};
 const webhook=new Function(...Object.keys(deps),webhookSource+';return handler;')(...Object.values(deps));
 const webhookEvent={id:'evt_native_subscription',type:'customer.subscription.updated',data:{object:{id:'sub_change',customer:'cus_change',metadata:{tenant_key:'change'}}}};
 async function sendWebhook(){const response={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};await webhook({method:'POST',headers:{},event:webhookEvent},response);return response;}
 assert.equal((await sendWebhook()).statusCode,503);assert.equal(iso((await pool.query("SELECT current_period_start FROM tenant_billing_accounts WHERE tenant_key='change'")).rows[0].current_period_start),iso(priorStart));
 const nativeReply=await sendWebhook();if(nativeReply.statusCode!==200)console.error((await pool.query("SELECT error_message FROM billing_events WHERE stripe_event_id='evt_native_subscription'")).rows);assert.equal(nativeReply.statusCode,200);assert.equal((await sendWebhook()).body.duplicate,true);
 assert.equal(iso((await pool.query("SELECT current_period_start FROM tenant_billing_accounts WHERE tenant_key='change'")).rows[0].current_period_start),'2028-03-31T12:00:00.000Z');
 console.log('PASS actual subscription webhook with native transaction client, final-receipt rollback, retry and duplicate');
 const oldSchedule={id:'sched_old',customer:'cus_change',livemode:true,status:'released',released_subscription:'sub_old',phases:[]};
 await syncTenantStripeSubscriptionSchedule(pool,'change',{},oldSchedule);
 await syncTenantStripeSubscription(pool,'change',{}, {...renewed,id:'sub_old',status:'canceled'});
 const afterHistory=(await pool.query("SELECT stripe_subscription_id,service_ended_at FROM tenant_billing_accounts WHERE tenant_key='change'")).rows[0];assert.equal(afterHistory.stripe_subscription_id,'sub_change');assert.equal(afterHistory.service_ended_at,null);
 console.log('PASS historical schedule and cancellation cannot replace or end the current paid subscription');
 await seed('transition',{interval:'month',through:'2028-02-29T12:00:00Z'});
 await pool.query("UPDATE tenant_billing_accounts SET pending_plan_code='growth',pending_billing_interval='month',pending_plan_effective_at='2028-02-29T12:00:00Z' WHERE tenant_key='transition'");
 const boundary=new Date('2028-02-29T12:00:00Z');await call('transition','boundary_pending',boundary);
 await pool.query("INSERT INTO billing_periods(tenant_key,period_start,period_end,plan_code,included_call_count,call_overage_rate_cents) VALUES('transition','2028-02-29T12:00:00Z','2028-03-31T12:00:00Z','starter',25,300)");
 const transitionSub=structuredClone(sub);transitionSub.id='sub_transition';transitionSub.customer='cus_transition';
 const lock=await pool.connect();await lock.query('BEGIN');await lock.query("SELECT tenant_key FROM tenants WHERE tenant_key='transition' FOR UPDATE");
 const attempted=reserve('transition','boundary_pending',boundary);await new Promise(r=>setTimeout(r,30));
 const reconcile=syncPaidSubscription(pool,'transition',transitionSub,config);await new Promise(r=>setTimeout(r,30));await lock.query('COMMIT');lock.release();
 assert.equal((await attempted).reason,'plan_transition_reconciliation_required');await reconcile;
 const paidRenewal={id:'in_transition',customer:'cus_transition',subscription:'sub_transition',livemode:true,currency:'usd',status:'paid',total:12450,amount_paid:12450,amount_remaining:0,lines:{data:[{amount:12450,type:'subscription',period:{end:transitionSub.items.data[0].current_period_end}}]}};
 await applyPaidBillingEvent(pool,{type:'invoice.paid',data:{object:paidRenewal}},{now:boundary,stripe:{invoices:{retrieve:async()=>paidRenewal}}});
 await call('transition','boundary_after',boundary);assert.equal((await reserve('transition','boundary_after',boundary)).allowed,true);
 const transitionPeriod=(await pool.query("SELECT plan_code,included_call_count,call_overage_rate_cents FROM billing_periods WHERE tenant_key='transition'")).rows[0];assert.deepEqual(transitionPeriod,{plan_code:'growth',included_call_count:60,call_overage_rate_cents:200});
 console.log('PASS native overlapping renewal/admission holds before answer until canonical plan and paid base reconcile');


 // Actual rater refuses to rewrite an already closed window and waits for calls.
 await rateBillingPeriod(pool,period.billing_period_id);assert.equal((await pool.query('SELECT overage_amount_cents FROM billing_periods WHERE billing_period_id=$1',[period.billing_period_id])).rows[0].overage_amount_cents,900);
 assert.equal((await rateBillingPeriod(pool,next.billing_period_id,{finalize:true})).pendingCalls,true);
 console.log('PASS frozen closed-period rating and in-flight call finalization fence');
 await seed('allmonths',{anchor:'2026-01-31T12:00:00Z',through:'2027-02-28T12:00:00Z',quota:1});
 const billable=(await pool.query("SELECT billing_call_type_id FROM billing_call_types WHERE code='answered_handled'")).rows[0].billing_call_type_id;
 const invoices=new Map();let monthlyCreates=0,monthlyItems=0;
 const monthlyStripe={subscriptions:{retrieve:async()=>({livemode:true,customer:'cus_allmonths',default_payment_method:'pm_monthly'})},invoices:{create:async(p,o)=>{monthlyCreates++;const invoice={...p,id:'monthly_'+p.metadata.billing_period_id,livemode:true,status:'draft',total:0,lines:[]};invoices.set(invoice.id,invoice);return invoice;},retrieve:async id=>invoices.get(id),listLineItems:async id=>({data:invoices.get(id).lines,has_more:false}),finalizeInvoice:async id=>{const i=invoices.get(id);i.status='open';return i;}},invoiceItems:{create:async p=>{monthlyItems++;const invoice=invoices.get(p.invoice);invoice.lines.push({amount:p.amount,metadata:p.metadata});invoice.total+=p.amount;return {id:'item_'+p.invoice};}}};
 for(let month=0;month<13;month++){
  const start=calendarMonthBoundary('2026-01-31T12:00:00Z',month),end=calendarMonthBoundary('2026-01-31T12:00:00Z',month+1);
  const p=(await pool.query("INSERT INTO billing_periods(tenant_key,period_start,period_end,plan_code,included_call_count,call_overage_rate_cents) VALUES('allmonths',$1,$2,'starter',1,300) RETURNING *",[start,end])).rows[0];
  for(let n=0;n<2;n++)await pool.query("INSERT INTO calls(call_sid,tenant_key,status,created_at,billing_call_type_id) VALUES($1,'allmonths','completed',$2,$3)",[`month_${month}_${n}`,new Date(start.getTime()+1000+n),billable]);
  const rated=await rateBillingPeriod(pool,p.billing_period_id,{finalize:true});assert.equal(rated.overageAmountCents,300);
  await collectPaidUsageInvoice(pool,p.billing_period_id,{stripe:monthlyStripe,now:end});
  await collectPaidUsageInvoice(pool,p.billing_period_id,{stripe:monthlyStripe,now:end});
 }
 assert.equal(monthlyCreates,13);assert.equal(monthlyItems,13);
 const firstClosed=(await pool.query("SELECT billing_period_id FROM billing_periods WHERE tenant_key='allmonths' ORDER BY period_start LIMIT 1")).rows[0];await assert.rejects(setManualCallBillingExclusion(pool,{tenantKey:'allmonths',callSid:'month_0_0',billingPeriodId:firstClosed.billing_period_id}),/paid_closed_period_manual_review_required/);
 await pool.query("UPDATE tenant_billing_accounts SET call_overage_rate_cents=175 WHERE tenant_key='allmonths'");
 const closed=(await pool.query("SELECT * FROM billing_periods WHERE tenant_key='allmonths' ORDER BY period_start LIMIT 1")).rows[0];
 await rateBillingPeriod(pool,closed.billing_period_id,{finalize:true});assert.equal((await pool.query('SELECT overage_amount_cents FROM billing_periods WHERE billing_period_id=$1',[closed.billing_period_id])).rows[0].overage_amount_cents,300);
 assert.equal(Number((await pool.query("SELECT count(DISTINCT a.call_sid) AS n FROM billing_period_call_assignments a JOIN billing_periods p USING(billing_period_id) WHERE p.tenant_key='allmonths'")).rows[0].n),26);
 console.log('PASS initial included month plus all 12 annual monthly invoices, once-only collection, actual call assignments and frozen rates');
 await pool.query("INSERT INTO tenants(tenant_key,name,status,billing_status,service_access_status) VALUES('legacy_trial','Legacy test','active','trialing','enabled')");
 assert.equal((await reserve('legacy_trial','legacy',at)).allowed,true);
 await pool.query('UPDATE paid_intake_release SET enabled=TRUE');assert.equal((await reserve('legacy_trial','legacy',at)).allowed,false);
 await pool.query('UPDATE paid_intake_release SET enabled=FALSE');
 console.log('PASS disabled cutover preserves legacy behavior; enabled cutover denies unmapped trial service');
 await seed('book_unpaid');await pool.query("UPDATE paid_purchases SET payment_status='unpaid' WHERE purchase_id='book_unpaid'");
 const ownerId=key=>pool.query('SELECT id FROM tenant_users WHERE tenant_key=$1',[key]).then(r=>r.rows[0].id);
 const env={SETUP_CALL_OWNER:'calendar@example.test',FULL_BUILD_LEAD_MINUTES:'30',SETUP_CALL_TIMEZONE:'UTC',SALES_GRAPH_TENANT_ID:'stub',SALES_GRAPH_CLIENT_ID:'stub',SALES_GRAPH_CLIENT_SECRET:'stub'};
 let bookings=0;const graph=async(path)=>path.includes('getSchedule')?{value:[{availabilityView:'0'.repeat(672)}]}:{id:`event_${++bookings}`};
 const common={env,graph,now:at.getTime()};
 await assert.rejects(paidSetupAvailability(pool,{...common,tenantKey:'book_unpaid',ownerId:await ownerId('book_unpaid')}),/setup_payment_required/);
 await assert.rejects(paidSetupAvailability(pool,{...common,tenantKey:'annual',ownerId:await ownerId('monthly')}),/setup_payment_required/);
 const slots=await paidSetupAvailability(pool,{...common,tenantKey:'annual',ownerId:await ownerId('annual')});assert(slots.slots.length);
 const slot=slots.slots[0];
 const concurrent=await Promise.allSettled(['annual','monthly'].map(async key=>bookPaidSetup(pool,{...common,tenantKey:key,ownerId:await ownerId(key),start:slot.start,end:slot.end})));
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(bookings,1);
 const winner=concurrent[0].status==='fulfilled'?'annual':'monthly';
 await bookPaidSetup(pool,{...common,tenantKey:winner,ownerId:await ownerId(winner),start:slot.start,end:slot.end});assert.equal(bookings,1);
 await seed('book_uncertain');const uncertainSlots=await paidSetupAvailability(pool,{...common,tenantKey:'book_uncertain',ownerId:await ownerId('book_uncertain')});
 let attempts=0;const uncertainGraph=async path=>{if(path.includes('getSchedule'))return graph(path);attempts++;throw Error('response lost');};
 const bookingArgs={...common,graph:uncertainGraph,tenantKey:'book_uncertain',ownerId:await ownerId('book_uncertain'),start:uncertainSlots.slots[0].start,end:uncertainSlots.slots[0].end};
 assert.equal((await bookPaidSetup(pool,bookingArgs)).status,'uncertain');assert.equal((await bookPaidSetup(pool,bookingArgs)).status,'uncertain');assert.equal(attempts,1);
 assert.equal(Number((await pool.query("SELECT count(*) AS n FROM paid_setup_bookings WHERE tenant_key='book_unpaid'")).rows[0].n),0);
 console.log('PASS real paid booking owner/payment gate, overlapping shared-calendar reservation, duplicate request and ambiguous provider no-resend');

}finally{await fixture.close();}
