import assert from 'node:assert/strict';
import {capturePaidRequests} from './lib/paid-request-capture.mjs';
import crypto from 'node:crypto';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {createIntakeDraft,verifyIntakeOwner,beginPaidCheckout,intakeTransaction,getIntakeQuote,createIntakeQuote,issueIntakeSalesReference,resolveIntakeSalesReference} from '../pages/api/_lib/paidIntake.js';
import {applyPaidPurchaseEvent,reconcilePaidPurchases,establishPaidSubscriptions} from '../pages/api/_lib/paidPurchaseEvents.js';
import {convertPaidIntake,processPaidIntakeJobs} from '../pages/api/_lib/paidProvisioning.js';
import {provisionPaidVoiceNumber} from '../pages/api/_lib/paidNumberProvisioning.js';
import {changePaidSubscription} from '../pages/api/_lib/paidBillingChanges.js';
import {syncPaidSubscription} from '../pages/api/_lib/paidSubscriptionSync.js';
import {beginPaidReinstatement} from '../pages/api/_lib/paidReinstatement.js';
import {getSalesProspect} from '../pages/api/_lib/salesRepository.js';
import {processSalesFollowupJobs} from '../pages/api/_lib/salesFollowupJobs.js';
import {STANDARD_BILLING_PLANS} from '../lib/standardBillingPlans.js';
import {calendarMonthBoundary} from '../lib/paidBillingCalendar.js';
process.env.APP_BASE_URL='https://fixture.everycall.invalid';
process.env.TELNYX_VOICE_CONNECTION_ID='fixture_connection';
const fixture=await createUpibTestFixture({label:'intake',migrations:['0049_live_prompt_settings.sql','0063_unified_paid_intake.sql','0064_paid_billing_lifecycle.sql']}),{pool}=fixture;
let cases=0;
const check=()=>{cases++;};
try {
 const baseCounts=(await pool.query('SELECT COUNT(*)::int count FROM tenants')).rows[0].count;
 await pool.query('UPDATE paid_intake_release SET enabled=TRUE');
 const plans=STANDARD_BILLING_PLANS.map(p=>({...p,stripeProductId:`prod_${p.code}`,stripePriceId:`price_${p.code}_month`,stripeAnnualPriceId:`price_${p.code}_year`}));
 await pool.query(`INSERT INTO system_config(id,global_emergency_phrase,billing_plans_json) VALUES(1,'Fixture emergency phrase',$1::jsonb) ON CONFLICT(id) DO UPDATE SET billing_plans_json=$1::jsonb`,[JSON.stringify(plans)]);
 const setupIntents=new Map(),intents=new Map(),methods=new Map(),customers=new Map(),sessions=new Map(),subscriptions=new Map(),invoices=new Map(),schedules=new Map(),effects=new Map();let sequence=0,creates=0,updates=0,failCheckout=false,failSubscription=false;
 const list=map=>({async *[Symbol.asyncIterator](){for(const value of map.values())yield structuredClone(value);}});
 const stripe={
  customers:{retrieve:async id=>structuredClone(customers.get(id)),update:async(id,params)=>{Object.assign(customers.get(id),params);return structuredClone(customers.get(id));},create:async(params)=>{const prior=[...customers.values()].find(c=>c.metadata.paid_purchase_id===params.metadata.paid_purchase_id);if(prior)return prior;const c={...params,id:`cus_${++sequence}`,livemode:true};customers.set(c.id,c);return structuredClone(c);},list:()=>list(customers)},
  setupIntents:{retrieve:async id=>structuredClone(setupIntents.get(id))},
  paymentIntents:{retrieve:async id=>structuredClone(intents.get(id))},paymentMethods:{retrieve:async id=>structuredClone(methods.get(id))},
  prices:{retrieve:async priceId=>{const match=/^price_(starter|growth|pro)_(month|year)$/.exec(priceId);assert.ok(match);const p=plans.find(p=>p.code===match[1]);return {id:priceId,product:p.stripeProductId,active:true,livemode:true,currency:'usd',unit_amount:match[2]==='year'?p.annualAmountCents:p.monthlyAmountCents,recurring:{interval:match[2],interval_count:1}};}},
  checkout:{sessions:{create:async(params,options)=>{creates++;if(effects.has(options.idempotencyKey)){assert.deepEqual(params,effects.get(options.idempotencyKey).params);return effects.get(options.idempotencyKey).session;}
   const session={id:`cs_${++sequence}`,url:`https://checkout.stripe.invalid/${sequence}`,livemode:true,status:'open',mode:params.mode,metadata:params.metadata,client_reference_id:params.client_reference_id,currency:'usd',amount_total:params.line_items?.[0]?.price_data.unit_amount??null,payment_status:'unpaid',customer:params.customer||`cus_${sequence}`,expires_at:Math.floor(Date.now()/1000)+86400};
   sessions.set(session.id,session);effects.set(options.idempotencyKey,{params:structuredClone(params),session});if(failCheckout){failCheckout=false;throw Error('provider_timeout_after_accept');}return session;},retrieve:async sessionId=>structuredClone(sessions.get(sessionId)),list:()=>list(sessions)}},
  subscriptions:{create:async(params,options)=>{
   assert.equal(params.proration_behavior,'none');assert(Number.isInteger(params.trial_end));
   const existing=[...subscriptions.values()].find(x=>x.metadata.paid_purchase_id===params.metadata.paid_purchase_id);if(existing)return existing;
   const sub={...params,id:`sub_${++sequence}`,livemode:true,status:'trialing',latest_invoice:{id:`in_initial_${sequence}`,livemode:true,customer:params.customer,status:'paid',total:0,amount_due:0,amount_paid:0},items:{data:[{...params.items[0],current_period_start:Math.floor(Date.now()/1000),current_period_end:params.trial_end}]}};
   subscriptions.set(sub.id,sub);if(failSubscription){failSubscription=false;throw Error('subscription_timeout_after_accept');}return structuredClone(sub);
  },list:()=>list(subscriptions),retrieve:async subId=>structuredClone(subscriptions.get(subId)),update:async(subId,params)=>{updates++;const sub=subscriptions.get(subId);Object.assign(sub,params);return structuredClone(sub);}},
  invoices:{retrieve:async invoiceId=>structuredClone(invoices.get(invoiceId)),list:()=>({async *[Symbol.asyncIterator](){}})},
  subscriptionSchedules:{create:async({from_subscription})=>{const sub=subscriptions.get(from_subscription),item=sub.items.data[0];const schedule={id:`sched_${++sequence}`,status:'active',subscription:sub.id,phases:[{start_date:item.current_period_start,end_date:item.current_period_end,trial_end:sub.trial_end,items:[{price:item.price,quantity:1}]}]};sub.schedule=schedule.id;schedules.set(schedule.id,schedule);return structuredClone(schedule);},retrieve:async scheduleId=>structuredClone(schedules.get(scheduleId)),update:async(scheduleId,params)=>{const schedule=schedules.get(scheduleId);Object.assign(schedule,params);return structuredClone(schedule);},release:async scheduleId=>{const schedule=schedules.get(scheduleId);schedule.status='released';subscriptions.get(schedule.subscription).schedule=null;return schedule;}}
 };
 const payload={loginEmail:'owner@fixture.invalid',businessName:'Fixture Business',website:'https://fixture.invalid',planCode:'growth',billingInterval:'month',leadPhone:'+15035550101',consentAccepted:true};
 let mail;
 await createIntakeDraft(pool,payload,{sendEmail:async input=>{mail=input;}});
 assert.equal((await pool.query('SELECT COUNT(*)::int count FROM tenants')).rows[0].count,baseCounts);check();
 const raw=/verify=([a-f0-9]+)/.exec(mail.text)[1];
 const {row:intake}=await verifyIntakeOwner(pool,raw);
 await assert.rejects(()=>verifyIntakeOwner(pool,raw),/verification_expired/);check();
 payload.quoteToken=(await createIntakeQuote(pool,intake,payload,{stripe})).quote.token;
 const customersBefore=customers.size;
 await assert.rejects(()=>beginPaidCheckout(pool,intake,{...payload,website:'https://edited.fixture.invalid'},{stripe}),/payment_quote_changed_refresh_required/);assert.equal(customers.size,customersBefore);check();
 failCheckout=true;
 await assert.rejects(()=>beginPaidCheckout(pool,intake,payload,{stripe}),/provider_timeout_after_accept/);
 assert.equal((await pool.query('SELECT COUNT(*)::int count FROM paid_purchases')).rows[0].count,1);
 const checkouts=await Promise.all(Array.from({length:4},()=>beginPaidCheckout(pool,intake,payload,{stripe})));
 assert.equal(new Set(checkouts.map(c=>c.purchaseId)).size,1);assert.equal(effects.size,1);check();
 const purchase=(await pool.query('SELECT * FROM paid_purchases')).rows[0];
 const checkout=sessions.get(purchase.stripe_session_id),paidAt=new Date(Math.floor(Date.now()/1000)*1000-120000);
 const intent={id:'pi_setup',livemode:true,status:'succeeded',amount_received:10000,currency:'usd',customer:checkout.customer,metadata:checkout.metadata,payment_method:'pm_setup',latest_charge:{paid:true,captured:true,created:Math.floor(paidAt/1000)}};
 intents.set(intent.id,intent);methods.set('pm_setup',{id:'pm_setup',customer:checkout.customer,livemode:true});
 Object.assign(checkout,{status:'complete',payment_status:'paid',payment_intent:intent.id,invoice:null,consent:{terms_of_service:'accepted'}});
 const event={id:'evt_setup',livemode:true,type:'checkout.session.completed',data:{object:checkout}};
 await assert.rejects(()=>intakeTransaction(pool,db=>applyPaidPurchaseEvent(db,{...event,livemode:false},{stripe})),/purchase_payment_mismatch/);check();
 checkout.amount_total=1;
 await assert.rejects(()=>intakeTransaction(pool,db=>applyPaidPurchaseEvent(db,event,{stripe})),/purchase_payment_mismatch/);checkout.amount_total=10000;check();
 failSubscription=true;
 await reconcilePaidPurchases(pool,{stripe});
 assert.equal((await pool.query('SELECT recurring_consent_at FROM paid_purchases')).rows[0].recurring_consent_at,null);
 assert.equal(subscriptions.size,1);
 await pool.query("UPDATE paid_purchases SET lease_until=NOW()-interval '1 second' WHERE payment_status='paid' AND recurring_consent_at IS NULL"); // Advance the bounded retry delay after the simulated timeout.
 await establishPaidSubscriptions(pool,{stripe});assert.equal(subscriptions.size,1);
 const sub=[...subscriptions.values()][0];
 const paid=(await pool.query('SELECT * FROM paid_purchases')).rows[0];assert.equal(paid.payment_status,'paid');assert.equal(new Date(paid.usage_anchor_at).getTime(),paidAt.getTime());assert.equal(new Date(paid.initial_period_end).getTime(),calendarMonthBoundary(paidAt,1).getTime());
 await intakeTransaction(pool,db=>applyPaidPurchaseEvent(db,event,{stripe}));assert.equal(updates,0);check();
 const converted=await convertPaidIntake(pool,paid.purchase_id);
 const paidState=(await pool.query('SELECT t.billing_status,t.trial_end,b.stripe_subscription_status FROM tenants t JOIN tenant_billing_accounts b USING(tenant_key) WHERE t.tenant_key=$1',[converted.tenant_key])).rows[0];
 assert.deepEqual(paidState,{billing_status:'active',trial_end:null,stripe_subscription_status:null});
 const canonicalDeferred=structuredClone(sub);canonicalDeferred.items.data[0].price=await stripe.prices.retrieve(paid.stripe_price_id);
 await syncPaidSubscription(pool,converted.tenant_key,canonicalDeferred,{plans});
 assert.equal((await pool.query('SELECT billing_status FROM tenants WHERE tenant_key=$1',[converted.tenant_key])).rows[0].billing_status,'active');
 const repeated=await convertPaidIntake(pool,paid.purchase_id);assert.equal(converted.tenant_key,repeated.tenant_key);assert.equal((await pool.query('SELECT COUNT(*)::int count FROM tenants')).rows[0].count,baseCounts+1);check();
 assert.equal((await pool.query('SELECT stripe_subscription_status FROM tenant_billing_accounts WHERE tenant_key=$1',[converted.tenant_key])).rows[0].stripe_subscription_status,'trialing');
 const another={...payload,loginEmail:'unrelated@fixture.invalid'};let otherMail;
 await createIntakeDraft(pool,another,{sendEmail:async m=>{otherMail=m;}});
 const other=await verifyIntakeOwner(pool,/verify=([a-f0-9]+)/.exec(otherMail.text)[1]);
 another.quoteToken=(await createIntakeQuote(pool,other.row,another,{stripe})).quote.token;
 await assert.rejects(()=>beginPaidCheckout(pool,other.row,another,{stripe}),/identity_review_required/);check();
 const newToken=crypto.randomBytes(32).toString('hex');
 await pool.query("UPDATE paid_intakes SET verification_hash=$2,verification_expires_at=NOW()+interval '30 minutes' WHERE intake_id=$1",[intake.intake_id,crypto.createHash('sha256').update(newToken).digest('hex')]);
 await assert.rejects(()=>verifyIntakeOwner(pool,newToken),/existing_owner_login_required/);
 await verifyIntakeOwner(pool,newToken,{session:{role:'tenant',user_id:converted.ownerId,tenant_key:converted.tenant_key}});check();
 let buildCalls=0,provisionCalls=0;
 const enqueue=async(db,key,input)=>{buildCalls++;await db.query('UPDATE paid_purchases SET build_id=$2 WHERE purchase_id=$1',[input.purchaseId,'fixture_build']);throw Error('crash_after_build_commit');};
 await processPaidIntakeJobs(pool,{enqueue,provision:async()=>{provisionCalls++;return {ok:true};}});
 await pool.query("UPDATE paid_purchases SET lease_until=NOW()-interval '1 second' WHERE provisioning_status='failed'"); // Simulate the worker retry time.
 await processPaidIntakeJobs(pool,{enqueue,provision:async()=>{provisionCalls++;return {ok:true};}});
 assert.equal(buildCalls,1);assert.equal(provisionCalls,1);assert.equal((await pool.query('SELECT provisioning_status FROM paid_purchases')).rows[0].provisioning_status,'awaiting_knowledge_review');check();
 let ordered=0,owned=null;
 const numberInput={pool,tenantKey:converted.tenant_key,purchaseId:paid.purchase_id,findAvailable:async()=>({phoneNumber:'+15035550999',monthlyCost:1,upfrontCost:1}),getOwned:async()=>owned,order:async()=>{ordered++;owned={phoneNumberId:'pn_fixture',connectionId:'fixture_connection'};throw Error('order_timeout_after_accept');},updateSettings:async()=>{}};
 await assert.rejects(()=>provisionPaidVoiceNumber(numberInput),/order_timeout_after_accept/);
 await provisionPaidVoiceNumber(numberInput);assert.equal(ordered,1);check();
 const current=(await pool.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1',[converted.tenant_key])).rows[0];
 for(const plan of plans)for(const billingInterval of ['month','year']){
  await changePaidSubscription(pool,converted.tenant_key,'tenant:fixture',{action:'plan',planCode:plan.code,billingInterval},{stripe});
  const phase=schedules.get(sub.schedule).phases[1];assert.equal(phase.start_date,Math.floor(calendarMonthBoundary(paidAt,1)/1000));assert.equal(phase.items[0].price,`price_${plan.code}_${billingInterval}`);
 }check();
 await changePaidSubscription(pool,converted.tenant_key,'tenant:fixture',{action:'cancel',cancelAtPeriodEnd:true},{stripe});assert.equal(sub.cancel_at_period_end,true);
 await changePaidSubscription(pool,converted.tenant_key,'tenant:fixture',{action:'cancel',cancelAtPeriodEnd:false},{stripe});assert.equal(sub.cancel_at_period_end,false);check();
 await assert.rejects(()=>beginPaidReinstatement(pool,converted.tenant_key,{id:converted.ownerId,email:payload.loginEmail},{planCode:'pro',billingInterval:'year',consentAccepted:true},{stripe}),/ended_service_required/);check();
 await pool.query('UPDATE tenant_billing_accounts SET service_ended_at=NOW() WHERE tenant_key=$1',[converted.tenant_key]);sub.status='canceled';
 const restart=await beginPaidReinstatement(pool,converted.tenant_key,{id:converted.ownerId,email:payload.loginEmail},{planCode:'pro',billingInterval:'year',consentAccepted:true},{stripe});
 const restartRow=(await pool.query("SELECT * FROM paid_purchases WHERE kind='restart'")).rows[0];assert.equal(restartRow.amount_cents,177990);assert.equal(restartRow.setup_amount_cents,0);assert.equal(restartRow.checkout_params.subscription_data,undefined);assert.equal(restartRow.checkout_params.line_items.length,1);check();
 const restartSession=sessions.get(restartRow.stripe_session_id);
 const restartAt=new Date(Math.floor(Date.now()/1000)*1000);
 intents.set('pi_restart',{...intent,id:'pi_restart',amount_received:177990,metadata:restartSession.metadata,latest_charge:{paid:true,captured:true,created:Math.floor(restartAt/1000)}});
 Object.assign(restartSession,{status:'complete',payment_status:'paid',payment_intent:'pi_restart',invoice:null,consent:{terms_of_service:'accepted'}});
 await reconcilePaidPurchases(pool,{stripe});
 assert.equal((await pool.query("SELECT payment_status FROM paid_purchases WHERE kind='restart'")).rows[0].payment_status,'paid');
 const restartJobs=await processPaidIntakeJobs(pool,{enqueue:async()=>{throw Error('restart_must_not_rebuild');},prepareRestart:async(db,key)=>{await db.query('UPDATE tenants SET telnyx_voice_number=NULL WHERE tenant_key=$1',[key]);},provision:async({pool:db,tenantKey:key})=>{await db.query("UPDATE tenants SET telnyx_voice_number='+15035550888' WHERE tenant_key=$1",[key]);return {ok:true};}});
 assert.equal(restartJobs.results[0].status,'awaiting_knowledge_review');
 const restarted=(await pool.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1',[converted.tenant_key])).rows[0];
 assert.equal(restarted.stripe_subscription_status,null);
 assert.equal(restarted.initial_period_end,null);assert.equal(restarted.service_ended_at,null);assert.equal(new Date(restarted.paid_base_through).getTime(),calendarMonthBoundary(restartAt,12).getTime());check();
 // A delayed setup/restart retry must not roll back a later paid renewal or plan.
 await pool.query("UPDATE tenant_billing_accounts SET billing_interval='month',stripe_price_id='price_growth_month',monthly_amount_cents=12450,current_period_start=$2,current_period_end=$3,paid_base_through=$3 WHERE tenant_key=$1",[converted.tenant_key,calendarMonthBoundary(restartAt,12),calendarMonthBoundary(restartAt,13)]);
 await pool.query("UPDATE tenants SET status='active',plan='growth',plan_code='growth',service_access_status='enabled',billing_lock_reason=NULL WHERE tenant_key=$1",[converted.tenant_key]);
 const beforeDelayed={account:(await pool.query('SELECT to_jsonb(b) AS row FROM tenant_billing_accounts b WHERE tenant_key=$1',[converted.tenant_key])).rows[0].row,tenant:(await pool.query('SELECT to_jsonb(t) AS row FROM tenants t WHERE tenant_key=$1',[converted.tenant_key])).rows[0].row};
 await convertPaidIntake(pool,restartRow.purchase_id);await convertPaidIntake(pool,paid.purchase_id);
 assert.deepEqual((await pool.query('SELECT to_jsonb(b) AS row FROM tenant_billing_accounts b WHERE tenant_key=$1',[converted.tenant_key])).rows[0].row,beforeDelayed.account);
 assert.deepEqual((await pool.query('SELECT to_jsonb(t) AS row FROM tenants t WHERE tenant_key=$1',[converted.tenant_key])).rows[0].row,beforeDelayed.tenant);check();
 await intakeTransaction(pool,db=>applyPaidPurchaseEvent(db,{id:'evt_refund',livemode:true,type:'charge.refunded',data:{object:{id:'ch_setup',payment_intent:'pi_setup',amount_refunded:50}}},{stripe:{...stripe,charges:{retrieve:async()=>({id:'ch_setup',livemode:true,payment_intent:'pi_setup',customer:checkout.customer,amount_refunded:50})}}}));
 assert.equal((await pool.query('SELECT review_status FROM billing_money_reviews')).rows[0].review_status,'pending');assert.equal((await pool.query('SELECT payment_status FROM paid_purchases WHERE purchase_id=$1',[paid.purchase_id])).rows[0].payment_status,'paid');check();

 await pool.query("INSERT INTO admin_users(id,username,email,role) VALUES(110,'sales_fixture','sales@fixture.invalid','sales')");
 await pool.query("INSERT INTO tenants(tenant_key,name,status,live_prompt_mode,service_access_status,app_access_status,billing_status) VALUES('legacy_tenant','Legacy Business','sales_demo','pending_v20','disabled','disabled','unpaid')");
 await pool.query("INSERT INTO tenant_bootstrap_profiles(tenant_key,website_url,company_description,business_category,source_mode) VALUES('legacy_tenant','https://legacy.fixture.invalid','Preserve owner correction.','service_business','website')");
 await pool.query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,website_url,phone_e164,status,assigned_rep_user_id,permission_granted) VALUES('legacy_prospect','legacy_source','Legacy Business','https://legacy.fixture.invalid','+15035550777','paid',110,TRUE)");
 await pool.query("INSERT INTO sales_checkout_sessions(checkout_id,prospect_id,rep_user_id,channel,recipient,status,paid_at,stripe_session_id,stripe_event_id,activation_status,amount_cents,contact_snapshot) VALUES('legacy_one','legacy_prospect',110,'email','legacy@fixture.invalid','paid',NOW(),'cs_legacy','evt_legacy','queued',100,jsonb_build_object('email','legacy@fixture.invalid'))");
 await pool.query("UPDATE sales_prospects SET tenant_key='legacy_tenant' WHERE prospect_id='legacy_prospect'");
 const oldPaidAt=new Date(Math.floor(Date.now()/1000)*1000-2*86400000);
 intents.set('pi_legacy',{...intent,id:'pi_legacy',amount_received:100,latest_charge:{paid:true,captured:true,created:Math.floor(oldPaidAt/1000)}});
 sessions.set('cs_legacy',{id:'cs_legacy',mode:'payment',livemode:true,payment_status:'paid',status:'complete',amount_total:100,currency:'usd',metadata:{sales_checkout_id:'legacy_one'},payment_intent:'pi_legacy'});
 const oldRef=await intakeTransaction(pool,db=>issueIntakeSalesReference(db,{checkout_id:'legacy_one'}));
 await pool.query('UPDATE sales_checkout_sessions SET checkout_url=$2 WHERE checkout_id=$1',['legacy_one',oldRef]);
 await pool.query("UPDATE paid_intake_sales_references SET expires_at=NOW()-interval '1 day' WHERE checkout_id='legacy_one'");
 const newRef=await intakeTransaction(pool,db=>issueIntakeSalesReference(db,{checkout_id:'legacy_one'}));
 assert.notEqual(oldRef,newRef);await assert.rejects(()=>resolveIntakeSalesReference(pool,new URL(oldRef).searchParams.get('salesRef')),/intake_reference_expired/);check();
 const legacyPayload={...payload,loginEmail:'legacy@fixture.invalid',businessName:'Legacy Business',website:'https://legacy.fixture.invalid',salesRef:new URL(newRef).searchParams.get('salesRef')};let legacyMail;
 await createIntakeDraft(pool,legacyPayload,{sendEmail:async m=>{legacyMail=m;}});
 const legacyIntake=(await verifyIntakeOwner(pool,/verify=([a-f0-9]+)/.exec(legacyMail.text)[1])).row;
 const quote=await getIntakeQuote(pool,legacyIntake,{stripe});assert.equal(quote.amountDueNowCents,0);assert.equal(quote.isLiveTest,true);assert.equal(quote.requiresRecurringConsent,true);check();
 await assert.rejects(()=>beginPaidCheckout(pool,legacyIntake,{...legacyPayload,consentAccepted:false},{stripe}),/recurring_consent_required/);
 const oldChargeCreated=intents.get('pi_legacy').latest_charge.created;
 intents.get('pi_legacy').latest_charge.created=Math.floor(Date.now()/1000)-70*86400;
 legacyPayload.quoteToken=(await createIntakeQuote(pool,legacyIntake,legacyPayload,{stripe})).quote.token;
 const beforeExpired={customers:customers.size,checkouts:creates,subscriptions:subscriptions.size,purchases:(await pool.query('SELECT count(*)::int n FROM paid_purchases')).rows[0].n,legacy:(await pool.query("SELECT to_jsonb(s) AS row FROM sales_checkout_sessions s WHERE checkout_id='legacy_one'")).rows[0].row};
 await assert.rejects(beginPaidCheckout(pool,legacyIntake,legacyPayload,{stripe}),/historical_purchase_term_review_required/);
 assert.equal(customers.size,beforeExpired.customers);assert.equal(creates,beforeExpired.checkouts);assert.equal(subscriptions.size,beforeExpired.subscriptions);assert.equal((await pool.query('SELECT count(*)::int n FROM paid_purchases')).rows[0].n,beforeExpired.purchases);assert.deepEqual((await pool.query("SELECT to_jsonb(s) AS row FROM sales_checkout_sessions s WHERE checkout_id='legacy_one'")).rows[0].row,beforeExpired.legacy);
 intents.get('pi_legacy').latest_charge.created=oldChargeCreated;check();
 legacyPayload.quoteToken=(await createIntakeQuote(pool,legacyIntake,legacyPayload,{stripe})).quote.token;
 const legacyCheckout=await beginPaidCheckout(pool,legacyIntake,{...legacyPayload,marketingAttribution:{source:'forged'}},{stripe});
 const legacyPurchase=(await pool.query('SELECT * FROM paid_purchases WHERE purchase_id=$1',[legacyCheckout.purchaseId])).rows[0];
 assert.equal(legacyPurchase.amount_cents,0);assert.equal(legacyPurchase.setup_amount_cents,100);assert.equal(legacyPurchase.checkout_params.mode,'setup');assert.equal(legacyPurchase.checkout_params.line_items,undefined);
 assert.equal((await pool.query('SELECT payload_json FROM paid_intakes WHERE intake_id=$1',[legacyIntake.intake_id])).rows[0].payload_json.marketingAttribution.source,'sales');check();
 const legacySession=sessions.get(legacyPurchase.stripe_session_id);setupIntents.set('seti_legacy',{id:'seti_legacy',status:'succeeded',livemode:true,customer:legacySession.customer,metadata:legacySession.metadata,payment_method:'pm_legacy'});
 methods.set('pm_legacy',{id:'pm_legacy',customer:legacySession.customer,livemode:true});Object.assign(legacySession,{status:'complete',payment_status:'no_payment_required',setup_intent:'seti_legacy',consent:{terms_of_service:'accepted'}});
 await reconcilePaidPurchases(pool,{stripe});
 const legacyComplete=(await pool.query('SELECT * FROM paid_purchases WHERE purchase_id=$1',[legacyPurchase.purchase_id])).rows[0];
 assert.ok(legacyComplete.recurring_consent_at);assert.equal(new Date(legacyComplete.paid_at).getTime(),oldPaidAt.getTime());assert.equal(legacyComplete.setup_amount_cents,100);check();


 await pool.query("INSERT INTO sales_demo_profiles(demo_profile_id,prospect_id,status,demo_bundle_json,scrape_pages_json) VALUES('legacy_demo','legacy_prospect','ready',jsonb_build_object('summary','Original paid support context'),jsonb_build_array(jsonb_build_object('text','Immutable source')))");
 await pool.query("INSERT INTO sales_signup_invitations(invitation_id,prospect_id,token_hash,creation_idempotency_hash,creation_request_hash,delivery_email,expires_at) VALUES('old_invite','legacy_prospect','old_token_hash','old_create_hash','old_request_hash','legacy@fixture.invalid',NOW()+interval '1 day')");
 await pool.query("INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,outcome,status,attempts,provider_result_json,locked_at) VALUES('unsent','legacy_prospect','no_answer','queued',0,'{}',NULL),('retry_unknown','legacy_prospect','no_answer','queued',1,'{}',NULL),('uncertain','legacy_prospect','no_answer','delivery_uncertain',1,jsonb_build_object('providerId','maybe_sent'),NULL),('inflight','legacy_prospect','no_answer','leased',1,'{}',NOW())");
 const beforeHistory=(await pool.query("SELECT stripe_session_id,amount_cents,contact_snapshot FROM sales_checkout_sessions WHERE checkout_id='legacy_one'")).rows[0];
 const preservedJobs=(await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id<>'unsent' ORDER BY sales_followup_job_id")).rows;
 const conversion=await processPaidIntakeJobs(pool,{enqueue:async(db,key,input)=>{await db.query('UPDATE paid_purchases SET build_id=$2 WHERE purchase_id=$1',[input.purchaseId,'legacy_build']);return {build_id:'legacy_build'};},provision:async()=>({ok:true})});
 assert.equal(conversion.results[0].status,'awaiting_knowledge_review',JSON.stringify((await pool.query('SELECT last_error FROM paid_purchases WHERE purchase_id=$1',[legacyPurchase.purchase_id])).rows));
 assert.equal((await pool.query('SELECT tenant_key FROM paid_purchases WHERE purchase_id=$1',[legacyPurchase.purchase_id])).rows[0].tenant_key,'legacy_tenant');
 assert.equal((await pool.query("SELECT company_description FROM tenant_bootstrap_profiles WHERE tenant_key='legacy_tenant'")).rows[0].company_description,'Preserve owner correction.');
 assert.ok((await pool.query("SELECT revoked_at FROM sales_signup_invitations WHERE invitation_id='old_invite'")).rows[0].revoked_at);
 assert.equal((await pool.query("SELECT status FROM sales_followup_jobs WHERE sales_followup_job_id='unsent'")).rows[0].status,'canceled');
 const archived=(await pool.query("SELECT * FROM sales_demo_profiles WHERE prospect_id='legacy_prospect'")).rows[0];assert.equal(archived.status,'archived');assert.equal(archived.scrape_pages_json[0].text,'Immutable source');
 assert.equal((await getSalesProspect(pool,'legacy_prospect')).demo.status,'ready','Archived staff-only context supports paid callbacks');
 await processSalesFollowupJobs(pool,{workerId:'fixture_cleanup',route:async()=>{throw Error('paid_cleanup_must_not_replay');}});
 assert.deepEqual((await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id<>'unsent' ORDER BY sales_followup_job_id")).rows,preservedJobs);
 assert.deepEqual((await pool.query("SELECT stripe_session_id,amount_cents,contact_snapshot FROM sales_checkout_sessions WHERE checkout_id='legacy_one'")).rows[0],beforeHistory);check();
 await pool.query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,website_url,phone_e164,status,assigned_rep_user_id,permission_granted) VALUES('race_prospect','race_source','Race Business','https://race.fixture.invalid','+15035550666','queued',110,TRUE)");
 await pool.query("INSERT INTO sales_prospect_contacts(contact_id,prospect_id,email) VALUES('race_a','race_prospect','racea@fixture.invalid'),('race_b','race_prospect','raceb@fixture.invalid')");
 const race=[];
 for(const email of ['racea@fixture.invalid','raceb@fixture.invalid']){
  const input={...payload,loginEmail:email,businessName:'Race Business',website:'https://race.fixture.invalid'};let delivered;
  await createIntakeDraft(pool,input,{sendEmail:async m=>{delivered=m;}});
  const verified=(await verifyIntakeOwner(pool,/verify=([a-f0-9]+)/.exec(delivered.text)[1])).row;
  input.quoteToken=(await createIntakeQuote(pool,verified,input,{stripe})).quote.token;race.push({input,verified});
 }
 const beforeRace=customers.size;
 const races=await Promise.allSettled(race.map(({input,verified})=>beginPaidCheckout(pool,verified,input,{stripe})));
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(customers.size,beforeRace+1);
 assert.match(races.find(r=>r.status==='rejected').reason.message,/prospect_purchase_owner_recovery_required/);
 assert.equal((await pool.query("SELECT COUNT(*)::int n FROM paid_purchases WHERE prospect_id='race_prospect'")).rows[0].n,1);check();

 await pool.query("INSERT INTO sales_followup_jobs(sales_followup_job_id,prospect_id,outcome) VALUES('worker_race','race_prospect','no_answer')");
 let accepted,releaseProvider;const acceptedPromise=new Promise(resolve=>{accepted=resolve;});const finishProvider=new Promise(resolve=>{releaseProvider=resolve;});let providerAttempts=0;
 const racingWorker=processSalesFollowupJobs(pool,{workerId:'race_worker',route:async()=>{providerAttempts++;accepted();await finishProvider;throw Error('provider_timeout_after_accept');}});
 await acceptedPromise;let conversionFinished=false;
 const markPaid=pool.query("UPDATE sales_prospects SET status='paid' WHERE prospect_id='race_prospect'").then(()=>{conversionFinished=true;});
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(conversionFinished,false,'Conversion must wait for the provider attempt lock');releaseProvider();await racingWorker;await markPaid;
 const uncertainJob=(await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id='worker_race'")).rows[0];assert.equal(uncertainJob.status,'reconciliation_required');assert.equal(uncertainJob.attempts,1);assert.ok(uncertainJob.locked_at);assert.equal(uncertainJob.locked_by,'race_worker');
 await processSalesFollowupJobs(pool,{workerId:'new_worker',route:async()=>{providerAttempts++;return {ok:true,routed:true};}});assert.equal(providerAttempts,1);check();
 await pool.query("UPDATE sales_followup_jobs SET locked_at=NOW()-interval '1 hour' WHERE sales_followup_job_id='inflight'");
 await processSalesFollowupJobs(pool,{workerId:'stale_worker',route:async()=>{throw Error('stale_provider_replay');}});
 const stale=(await pool.query("SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id='inflight'")).rows[0];assert.equal(stale.status,'reconciliation_required');assert.ok(stale.locked_at);assert.equal(stale.attempts,1);check();
 // Capture a genuine full-month restart request too; no payment or provider
 // effect occurs beyond the bounded synthetic Checkout double.
 const lastAccount=(await pool.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1',[converted.tenant_key])).rows[0];subscriptions.get(lastAccount.stripe_subscription_id).status='canceled';
 await pool.query('UPDATE tenant_billing_accounts SET service_ended_at=NOW() WHERE tenant_key=$1',[converted.tenant_key]);
 const monthlyRestart=await beginPaidReinstatement(pool,converted.tenant_key,{id:converted.ownerId,email:payload.loginEmail},{planCode:'starter',billingInterval:'month',consentAccepted:true},{stripe});
 const monthlyRequest=(await pool.query('SELECT amount_cents,checkout_params FROM paid_purchases WHERE purchase_id=$1',[monthlyRestart.purchaseId])).rows[0];assert.equal(monthlyRequest.amount_cents,7450);assert.equal(monthlyRequest.checkout_params.line_items[0].price_data.unit_amount,7450);check();
 capturePaidRequests('checkout-create',(await pool.query('SELECT kind,plan_code,billing_interval,amount_cents,setup_amount_cents,checkout_params AS request FROM paid_purchases WHERE checkout_params IS NOT NULL ORDER BY purchase_id')).rows);
 console.log(`paid intake native PostgreSQL: ${cases} scenarios passed`);
} finally {await fixture.close();}
