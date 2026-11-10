import assert from 'node:assert/strict';
import { sendSalesCheckout, applySalesPaidCheckout, validateSalesCheckoutRequest } from '../../pages/api/_lib/salesCheckout.js';
import { createSalesCallSession, updateSalesCallSession, runSalesIdempotentMutation } from '../../pages/api/_lib/salesRepository.js';
import { getSalesRepQueue } from '../../pages/api/_lib/salesDialer.js';
import { setSalesPhoneTestMode } from '../../pages/api/_lib/salesPhoneTestMode.js';

export async function testSalesProspectCheckout(pool,env) {
 const q=(sql,values=[])=>pool.query(sql,values);
 const rejects=(task,code)=>assert.rejects(task,error=>error.code===code);
 await q("ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email TEXT");
 await q("INSERT INTO admin_users(id,email) VALUES(9,'rep@example.test')");
 await q("CREATE TABLE IF NOT EXISTS system_config(id INT PRIMARY KEY,telnyx_sms_number TEXT)");
 await q("INSERT INTO system_config(id,telnyx_sms_number) VALUES(1,'+12065559999') ON CONFLICT(id) DO NOTHING");
 for(let n=0;n<15;n++) {
  await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,numbers_json,permission_granted,assigned_rep_user_id,contact_email,website_url,timezone) VALUES($1,$1,$1,$2,$3,TRUE,9,'customer@example.test','https://checkout-fixture.test','UTC')",[`standalone-${n}`,`+1206555800${n}`,JSON.stringify([{type:'cell',phoneE164:`+1206555800${n}`}])]);
  await q("INSERT INTO sales_demo_profiles(demo_profile_id,prospect_id,status) VALUES($1,$1,'ready')",[`standalone-${n}`]);
 }
 let created=0,sent=0,lastParams,lastMessage;
 const readyWebhook={list:async()=>({data:[{id:'we_live',status:'enabled',livemode:true,url:`${new URL(env.APP_BASE_URL).origin}/api/v1/stripe/webhook?endpoint_tag=fixture`,enabled_events:['checkout.session.completed','checkout.session.async_payment_succeeded']}],has_more:false})};
 const stripe={webhookEndpoints:readyWebhook,checkout:{sessions:{create:async params=>{lastParams=params;return {id:`cs_standalone_${++created}`,url:'https://checkout.stripe.test/fixture',livemode:params.metadata.sales_checkout_test!=='true'};}}}};
 const mail=async message=>{lastMessage=message;sent++;return{id:`mail_${sent}`};};
 const sms=async message=>{lastMessage=message;sent++;return{data:{id:`sms_${sent}`}};};
 const options={prospectId:'standalone-0',repId:9,channel:'email',email:'customer@example.test',confirmedWithoutCall:true,confirmedRecipient:'customer@example.test',expectedIsTest:false,env,stripe,mail,sms};
 for(const amountCents of [0,99,100.1,100000000,'100',null,NaN,Infinity]) {
  await rejects(()=>validateSalesCheckoutRequest(pool,{...options,amountCents}),'invalid_signup_amount');
  await rejects(()=>sendSalesCheckout(pool,{...options,amountCents}),'invalid_signup_amount');
 }
 await rejects(()=>sendSalesCheckout(pool,{...options,confirmedWithoutCall:false}),'checkout_confirmation_required');
 await rejects(()=>sendSalesCheckout(pool,{...options,repId:1}),'prospect_forbidden');
 await rejects(()=>sendSalesCheckout(pool,{...options,confirmedRecipient:'different@example.test'}),'checkout_recipient_changed');
 for(const [type,value] of [['domain','checkout-fixture.test'],['phone','+12065558000']]) {
  await q("INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES($1,$2,'fixture opt out')",[type,value]);
  assert.equal((await q("SELECT do_not_call FROM sales_prospects WHERE prospect_id='standalone-0'")).rows[0].do_not_call,false);
  await rejects(()=>sendSalesCheckout(pool,options),'prospect_suppressed');
  await q('DELETE FROM sales_dnc_registry WHERE identity_type=$1 AND identity_value=$2',[type,value]);
 }
 const beforeCalls=Number((await q('SELECT COUNT(*) AS n FROM sales_call_sessions')).rows[0].n);
 await sendSalesCheckout(pool,options);await sendSalesCheckout(pool,options);
 assert.equal(created,1);assert.equal(sent,1);
 assert.equal(Number((await q('SELECT COUNT(*) AS n FROM sales_call_sessions')).rows[0].n),beforeCalls);
 assert.equal(lastParams.metadata.sales_call_id,undefined);
 assert.equal(lastParams.line_items[0].price_data.unit_amount,10000);
 await rejects(()=>sendSalesCheckout(pool,{...options,amountCents:100}),'checkout_amount_exists');
 const call=await createSalesCallSession(pool,{prospectId:options.prospectId,adminUserId:9});
 await sendSalesCheckout(pool,{...options,salesCallId:call.salesCallId});
 assert.equal(created,1);assert.equal(sent,1,'Later call reuses standalone link');
 await updateSalesCallSession(pool,call.salesCallId,{state:'ended',endedAt:new Date().toISOString()});
 const row=(await q('SELECT * FROM sales_checkout_sessions WHERE prospect_id=$1',[options.prospectId])).rows[0];
 const event={id:'evt_standalone',type:'checkout.session.completed',livemode:true,data:{object:{id:row.stripe_session_id,mode:'payment',currency:'usd',amount_total:10000,payment_status:'paid',livemode:true,metadata:{...lastParams.metadata}}}};
 for(const metadata of [{...event.data.object.metadata,sales_prospect_id:'standalone-1'},{...event.data.object.metadata,sales_call_id:call.salesCallId},{sales_checkout_id:row.checkout_id}])
  await rejects(()=>applySalesPaidCheckout(pool,{...event,data:{object:{...event.data.object,metadata}}}),'sales_checkout_mismatch');
 await applySalesPaidCheckout(pool,event);await applySalesPaidCheckout(pool,event);
 assert.equal((await q('SELECT status FROM sales_prospects WHERE prospect_id=$1',[options.prospectId])).rows[0].status,'paid');
 assert.equal((await q('SELECT paid_at FROM sales_call_sessions WHERE sales_call_id=$1',[call.salesCallId])).rows[0].paid_at,null);
 assert.equal((await getSalesRepQueue(pool,9,{timezone:'UTC',env})).counters.paid,1);
 await rejects(()=>sendSalesCheckout(pool,options),'sales_prospect_already_paid');
 const callA=await createSalesCallSession(pool,{prospectId:'standalone-1',adminUserId:9});
 await sendSalesCheckout(pool,{...options,prospectId:'standalone-1',salesCallId:callA.salesCallId});
 await updateSalesCallSession(pool,callA.salesCallId,{state:'ended',endedAt:new Date().toISOString()});
 await sendSalesCheckout(pool,{...options,prospectId:'standalone-1'});
 const callB=await createSalesCallSession(pool,{prospectId:'standalone-1',adminUserId:9});
 await sendSalesCheckout(pool,{...options,prospectId:'standalone-1',salesCallId:callB.salesCallId});
 assert.equal(created,2);assert.equal(sent,2,'Call A → standalone → call B must reuse the same checkout');
 await updateSalesCallSession(pool,callB.salesCallId,{state:'ended',endedAt:new Date().toISOString()});
 // Editable SMS delivery: normalize before reservation, retain actual recipient/snapshot,
 // enforce selected number binding, and never create a second company checkout.
 const edited={...options,prospectId:'standalone-5',channel:'sms',phone:'(206) 555-0199',confirmedRecipient:'+12065550199'};
 const number=(await q("SELECT number_id FROM sales_prospect_contact_numbers WHERE prospect_id='standalone-5' LIMIT 1")).rows[0].number_id;
 for(const phone of ['', 'not a phone', '+12065550199 ext 1', '+01234567890']) {
  await rejects(()=>validateSalesCheckoutRequest(pool,{...edited,phone}),'checkout_phone_required');
  await rejects(()=>sendSalesCheckout(pool,{...edited,phone}),'checkout_phone_required');
 }
 await rejects(()=>sendSalesCheckout(pool,{...edited,numberId:number}),'contact_number_changed');
 await rejects(()=>sendSalesCheckout(pool,{...edited,contactId:'contact_legacy_standalone-6'}),'contact_unavailable');
 await q("INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone','+12065550199','fixture')");
 await rejects(()=>sendSalesCheckout(pool,edited),'prospect_suppressed');
 await q("DELETE FROM sales_dnc_registry WHERE identity_value='+12065550199'");
 assert.equal(await validateSalesCheckoutRequest(pool,edited),false);
 const beforeEdited={created,sent};
 await sendSalesCheckout(pool,edited);
 assert.equal(lastMessage.to,'+12065550199');
 const editedRow=(await q("SELECT * FROM sales_checkout_sessions WHERE prospect_id='standalone-5'")).rows[0];
 assert.equal(editedRow.recipient,'+12065550199');assert.equal(editedRow.contact_snapshot.phoneE164,'+12065550199');assert.equal(editedRow.contact_snapshot.numberId,null);
 await sendSalesCheckout(pool,edited);
 await rejects(()=>sendSalesCheckout(pool,{...edited,phone:'+12065550198',confirmedRecipient:'+12065550198'}),'checkout_delivery_exists');
 const editedCall=await createSalesCallSession(pool,{prospectId:'standalone-5',adminUserId:9});
 await sendSalesCheckout(pool,{...edited,salesCallId:editedCall.salesCallId});
 await updateSalesCallSession(pool,editedCall.salesCallId,{state:'ended',endedAt:new Date().toISOString()});
 assert.equal(created,beforeEdited.created+1);assert.equal(sent,beforeEdited.sent+1);
 // Explicit mobile destination works even when the contact has no saved cell.
 await q("UPDATE sales_prospect_contact_numbers SET type='shop' WHERE prospect_id='standalone-6'");
 await sendSalesCheckout(pool,{...edited,prospectId:'standalone-6'});
 assert.equal(lastMessage.to,'+12065550199');
 // A failed Stripe create retains the original recipient for a safe retry.
 await assert.rejects(sendSalesCheckout(pool,{...edited,prospectId:'standalone-7',stripe:{checkout:{sessions:{create:async()=>{throw Error('fixture create');}}}}}),/fixture create/);
 await rejects(()=>sendSalesCheckout(pool,{...edited,prospectId:'standalone-7',phone:'+12065550198',confirmedRecipient:'+12065550198'}),'checkout_delivery_exists');
 await sendSalesCheckout(pool,{...edited,prospectId:'standalone-7'});
 assert.equal(lastMessage.to,'+12065550199');
 // Default-off rollout gate blocks custom reservation before any provider call.
 await rejects(()=>sendSalesCheckout(pool,{...options,prospectId:'standalone-9',amountCents:100}),'custom_signup_amount_unavailable');
 assert.equal((await q("SELECT 1 FROM sales_checkout_sessions WHERE prospect_id='standalone-9'")).rowCount,0);
 await q('UPDATE sales_dialer_config SET custom_signup_amount_enabled=TRUE WHERE id=TRUE');
 // An unavailable live endpoint must not reserve a row or create/deliver a checkout.
 const notReady={...options,prospectId:'standalone-14',amountCents:375};
 const providerCounts={created,sent};
 for(const webhookEndpoints of [
  {list:async()=>{throw Error('private provider error');}},
  {list:async()=>({data:[{id:'we_disabled',status:'disabled',livemode:true,url:`${new URL(env.APP_BASE_URL).origin}/api/v1/stripe/webhook`,enabled_events:['*']}],has_more:false})},
  {list:async()=>({data:[{id:'we_pinned',status:'enabled',livemode:true,url:`${new URL(env.APP_BASE_URL).origin}/api/v1/stripe/webhook?%64pL=old`,enabled_events:['*']}],has_more:false})},
 ]) {
  await rejects(()=>sendSalesCheckout(pool,{...notReady,stripe:{...stripe,webhookEndpoints}}),'sales_checkout_not_ready');
  assert.equal((await q("SELECT 1 FROM sales_checkout_sessions WHERE prospect_id='standalone-14'")).rowCount,0);
 }
 assert.equal(created,providerCounts.created);assert.equal(sent,providerCounts.sent);
 // A lookup body that outlives the real ten-second caller deadline cannot
 // reserve a checkout. Its late result is read-only and cannot paginate.
 let lateLookupCount=0,releaseLateLookup;
 const lateLookup=new Promise(resolve=>{releaseLateLookup=resolve;});
 await rejects(()=>sendSalesCheckout(pool,{...notReady,stripe:{...stripe,webhookEndpoints:{list:async()=>{lateLookupCount++;return lateLookup;}}}}),'sales_checkout_not_ready');
 assert.equal((await q("SELECT 1 FROM sales_checkout_sessions WHERE prospect_id='standalone-14'")).rowCount,0);
 assert.equal(created,providerCounts.created);assert.equal(sent,providerCounts.sent);
 releaseLateLookup({data:[{id:'we_late',status:'disabled'}],has_more:true});
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(lateLookupCount,1);

 // A concurrent original reservation created during failed lookup still wins.
 let raced=false;
 const racing={...options,prospectId:'standalone-13',amountCents:265};
 await sendSalesCheckout(pool,{...racing,stripe:{...stripe,webhookEndpoints:{list:async()=>{
  assert.equal(raced,false);raced=true;
  await sendSalesCheckout(pool,racing);
  throw Error('lookup unavailable after another request reserved the same amount');
 }}}});
 assert.equal(created,providerCounts.created+1);assert.equal(sent,providerCounts.sent+1);
 // Exercise the API's real idempotency wrapper: a failed custom request must
 // clear its receipt so the same UI key can submit a different $100 body.
 const fallbackKey='readiness-price-fallback';
 const mutation=(amountCents,client)=>runSalesIdempotentMutation(pool,{adminUserId:9,scope:'sales.prospect.checkout:standalone-14:live',idempotencyKey:fallbackKey,request:{amountCents}},async()=>({status:200,body:await sendSalesCheckout(pool,{...notReady,amountCents,stripe:client})}));
 await rejects(()=>mutation(375,{...stripe,webhookEndpoints:{list:async()=>{throw Error('lookup unavailable');}}}),'sales_checkout_not_ready');
 assert.equal((await q('SELECT 1 FROM sales_idempotency_keys WHERE idempotency_key=$1',[fallbackKey])).rowCount,0);
 let fixedPriceLookups=0;
 const fallback=await mutation(10000,{...stripe,webhookEndpoints:{list:async()=>{fixedPriceLookups++;throw Error('lookup unavailable');}}});
 assert.equal(fallback.status,200);assert.equal(fallback.body.amountCents,10000);
 assert.equal(fixedPriceLookups,0,'Standard $100 flow must not depend on endpoint lookup');
 // Boundary amounts, frozen retries, exact webhook amount and Customer isolation.
 for(const [n,amountCents] of [[9,100],[10,12345],[11,99999999]]) {
  const priced={...options,prospectId:`standalone-${n}`,amountCents};
  const result=await sendSalesCheckout(pool,priced);
  assert.equal(result.amountCents,amountCents);
  assert.equal(lastParams.line_items[0].price_data.unit_amount,amountCents);
  assert.match(lastMessage.text,new RegExp((amountCents/100).toLocaleString('en-US',{minimumFractionDigits:2}).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const reserved=(await q('SELECT * FROM sales_checkout_sessions WHERE prospect_id=$1',[priced.prospectId])).rows[0];
  await assert.rejects(()=>q('UPDATE sales_checkout_sessions SET amount_cents=10000 WHERE checkout_id=$1',[reserved.checkout_id]),/sales_checkout_amount_immutable/);
  await rejects(()=>sendSalesCheckout(pool,{...priced,amountCents:10000}),'checkout_amount_exists');
  const paid={id:`evt_amount_${n}`,type:'checkout.session.completed',livemode:true,data:{object:{id:reserved.stripe_session_id,mode:'payment',currency:'usd',amount_total:amountCents,payment_status:'paid',livemode:true,metadata:{...lastParams.metadata}}}};
  for(const patch of [{amount_total:10000},{amount_total:String(amountCents)},{currency:'eur'},{mode:'subscription'}])
   await rejects(()=>applySalesPaidCheckout(pool,{...paid,data:{object:{...paid.data.object,...patch}}}),'sales_payment_mismatch');
  await applySalesPaidCheckout(pool,paid);await applySalesPaidCheckout(pool,paid);
  assert.equal((await q('SELECT paid_at FROM sales_checkout_sessions WHERE checkout_id=$1',[reserved.checkout_id])).rows[0].paid_at!==null,true);
 }
 let uncertaintyKey;
 const retryOptions={...options,prospectId:'standalone-12',amountCents:275};
 await assert.rejects(()=>sendSalesCheckout(pool,{...retryOptions,stripe:{webhookEndpoints:readyWebhook,checkout:{sessions:{create:async(params,request)=>{uncertaintyKey=request.idempotencyKey;throw Error('fixture stripe uncertainty');}}}}}),/fixture stripe uncertainty/);
 await rejects(()=>sendSalesCheckout(pool,{...retryOptions,amountCents:300}),'checkout_amount_exists');
 await sendSalesCheckout(pool,{...retryOptions,stripe:{webhookEndpoints:{list:async()=>{throw Error('Existing reservation must skip readiness');}},checkout:{sessions:{create:async(params,request)=>{assert.equal(request.idempotencyKey,uncertaintyKey);assert.equal(params.line_items[0].price_data.unit_amount,275);return {id:'cs_frozen_retry',url:'https://checkout.stripe.test/retry',livemode:true};}}}}});
 // Retire unrelated fixture calls before exercising the real phone-mode fence.
 await q("UPDATE sales_call_sessions SET state='ended',ended_at=COALESCE(ended_at,NOW()) WHERE state NOT IN ('ended','closed','failed','completed')");
 await q("UPDATE sales_incoming_calls SET state='ended'");
 await setSalesPhoneTestMode(pool,true);
 const testEnv={...env,SALES_STRIPE_TEST_SECRET_KEY:'sk_test_fixture'};
 const test={...options,env:testEnv,expectedIsTest:true,email:'rep@example.test',confirmedRecipient:'rep@example.test'};
 await rejects(()=>validateSalesCheckoutRequest(pool,options),'checkout_context_changed');
 await rejects(()=>sendSalesCheckout(pool,{...test,env}),'sales_test_checkout_not_configured');
 await rejects(()=>sendSalesCheckout(pool,{...test,env:{...testEnv,SALES_STRIPE_TEST_SECRET_KEY:'sk_live_wrong'}}),'sales_test_checkout_not_configured');
 await rejects(()=>sendSalesCheckout(pool,{...test,email:'customer@example.test',confirmedRecipient:'customer@example.test'}),'sales_test_email_required');
 await rejects(()=>sendSalesCheckout(pool,{...test,amountCents:199}),'custom_signup_amount_unavailable');
 await sendSalesCheckout(pool,test); // Already paid customer can safely exercise test checkout.
 assert.equal(lastMessage.to,'rep@example.test');assert.match(lastMessage.text,/TEST ONLY/);
 assert.equal(lastParams.metadata.sales_checkout_test,'true');
 const testRow=(await q('SELECT * FROM sales_checkout_sessions WHERE prospect_id=$1 AND is_test',[options.prospectId])).rows[0];
 const testEvent={...event,id:'evt_test_standalone',livemode:false,data:{object:{...event.data.object,id:testRow.stripe_session_id,livemode:false,metadata:{...lastParams.metadata}}}};
 await rejects(()=>applySalesPaidCheckout(pool,testEvent),'sales_checkout_mode_mismatch');
 await rejects(()=>applySalesPaidCheckout(pool,event,{testWebhook:true}),'sales_checkout_mode_mismatch');
 await rejects(()=>applySalesPaidCheckout(pool,{...testEvent,livemode:true},{testWebhook:true}),'sales_checkout_mode_mismatch');
 await applySalesPaidCheckout(pool,testEvent,{testWebhook:true});await applySalesPaidCheckout(pool,testEvent,{testWebhook:true});
 const completed=(await q('SELECT * FROM sales_checkout_sessions WHERE checkout_id=$1',[testRow.checkout_id])).rows[0];
 assert.equal(completed.status,'test_complete');assert.equal(completed.paid_at,null);assert.equal(completed.activation_status,'test_only');assert.equal(completed.tenant_key,null);
 assert.equal((await getSalesRepQueue(pool,9,{timezone:'UTC',env})).counters.paid,4);
 // Historic custom test reservations remain retryable; their frozen webhook amount still applies.
 await q("INSERT INTO sales_checkout_sessions(checkout_id,prospect_id,rep_user_id,channel,recipient,is_test,activation_status,amount_cents,status,stripe_session_id,checkout_url) VALUES('historic_custom_test','standalone-12',9,'email','rep@example.test',TRUE,'test_only',199,'created','cs_historic_test','https://checkout.stripe.test/historic')");
 const historic=await sendSalesCheckout(pool,{...test,prospectId:'standalone-12',amountCents:199});
 assert.equal(historic.amountCents,199);assert.equal(historic.isTest,true);
 const historicEvent={...testEvent,id:'evt_historic_test',data:{object:{...testEvent.data.object,id:'cs_historic_test',amount_total:199,metadata:{sales_checkout_id:'historic_custom_test',sales_prospect_id:'standalone-12',sales_checkout_test:'true'}}}};
 await applySalesPaidCheckout(pool,historicEvent,{testWebhook:true});
 const historicRow=(await q("SELECT status,paid_at,activation_status FROM sales_checkout_sessions WHERE checkout_id='historic_custom_test'")).rows[0];
 assert.equal(historicRow.status,'test_complete');assert.equal(historicRow.paid_at,null);assert.equal(historicRow.activation_status,'test_only');
 await rejects(()=>sendSalesCheckout(pool,{...test,prospectId:'standalone-8',channel:'sms',phone:'+12065550199',confirmedRecipient:'+12065550199'}),'checkout_recipient_changed');
 await sendSalesCheckout(pool,{...test,prospectId:'standalone-8',channel:'sms',phone:'+14256154640',confirmedRecipient:'+14256154640'});
 assert.equal(lastMessage.to,'+14256154640');
 const testCall=await createSalesCallSession(pool,{prospectId:'standalone-2',adminUserId:9});
 await updateSalesCallSession(pool,testCall.salesCallId,{state:'ended',endedAt:new Date().toISOString()});
 await setSalesPhoneTestMode(pool,false);
 await sendSalesCheckout(pool,{...test,prospectId:'standalone-2',salesCallId:testCall.salesCallId,channel:'sms'});
 assert.equal(lastMessage.to,'+14256154640','Historical test call must use fixed test phone after restore');
 assert.equal((await q('SELECT outcome,paid_at FROM sales_call_sessions WHERE sales_call_id=$1',[testCall.salesCallId])).rows[0].outcome,null);
 await rejects(()=>sendSalesCheckout(pool,{...test,prospectId:'standalone-3'}),'checkout_context_changed');
 await rejects(()=>sendSalesCheckout(pool,{...options,prospectId:'standalone-3',channel:'sms',confirmedRecipient:'+14256154640'}),'checkout_recipient_changed');
 await assert.rejects(()=>sendSalesCheckout(pool,{...options,prospectId:'standalone-4',mail:async()=>{throw Error('fixture uncertain');}}),/fixture uncertain/);
 // The provider exception must leave a durable uncertainty fence, never resend.
 assert.equal((await q("SELECT status FROM sales_checkout_sessions WHERE prospect_id='standalone-4'")).rows[0].status,'delivery_uncertain');
 await rejects(()=>sendSalesCheckout(pool,{...options,prospectId:'standalone-4'}),'checkout_delivery_pending');
 await rejects(()=>setSalesPhoneTestMode(pool,true),'sales_test_activity_pending');
 const uncertainSms={...edited,prospectId:'standalone-8'};
 let smsAttempts=0;
 await assert.rejects(sendSalesCheckout(pool,{...uncertainSms,sms:async()=>{smsAttempts++;throw Error('fixture sms uncertain');}}),/fixture sms uncertain/);
 await rejects(()=>sendSalesCheckout(pool,{...uncertainSms,sms:async()=>{smsAttempts++;}}),'checkout_delivery_pending');
 assert.equal(smsAttempts,1);
 console.log('PASS prospect checkout: confirmation/context, no fake calls, cross-context reuse, ownership, nullable verified payment, counters, test credentials/recipients, mode isolation, immutable test calls and uncertain delivery fence');
}
