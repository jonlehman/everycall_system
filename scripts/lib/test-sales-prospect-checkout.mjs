import assert from 'node:assert/strict';
import { sendSalesCheckout, applySalesPaidCheckout, validateSalesCheckoutRequest } from '../../pages/api/_lib/salesCheckout.js';
import { createSalesCallSession, updateSalesCallSession } from '../../pages/api/_lib/salesRepository.js';
import { getSalesRepQueue } from '../../pages/api/_lib/salesDialer.js';
import { setSalesPhoneTestMode } from '../../pages/api/_lib/salesPhoneTestMode.js';

export async function testSalesProspectCheckout(pool,env) {
 const q=(sql,values=[])=>pool.query(sql,values);
 const rejects=(task,code)=>assert.rejects(task,error=>error.code===code);
 await q("ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email TEXT");
 await q("INSERT INTO admin_users(id,email) VALUES(9,'rep@example.test')");
 await q("CREATE TABLE IF NOT EXISTS system_config(id INT PRIMARY KEY,telnyx_sms_number TEXT)");
 await q("INSERT INTO system_config(id,telnyx_sms_number) VALUES(1,'+12065559999') ON CONFLICT(id) DO NOTHING");
 for(let n=0;n<6;n++) {
  await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,numbers_json,permission_granted,assigned_rep_user_id,contact_email,website_url,timezone) VALUES($1,$1,$1,$2,$3,TRUE,9,'customer@example.test','https://checkout-fixture.test','UTC')",[`standalone-${n}`,`+1206555800${n}`,JSON.stringify([{type:'cell',phoneE164:`+1206555800${n}`}])]);
  await q("INSERT INTO sales_demo_profiles(demo_profile_id,prospect_id,status) VALUES($1,$1,'ready')",[`standalone-${n}`]);
 }
 let created=0,sent=0,lastParams,lastMessage;
 const stripe={checkout:{sessions:{create:async params=>{lastParams=params;return {id:`cs_standalone_${++created}`,url:'https://checkout.stripe.test/fixture',livemode:params.metadata.sales_checkout_test!=='true'};}}}};
 const mail=async message=>{lastMessage=message;sent++;return{id:`mail_${sent}`};};
 const sms=async message=>{lastMessage=message;sent++;return{data:{id:`sms_${sent}`}};};
 const options={prospectId:'standalone-0',repId:9,channel:'email',email:'customer@example.test',confirmedWithoutCall:true,confirmedRecipient:'customer@example.test',expectedIsTest:false,env,stripe,mail,sms};
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
 assert.equal((await getSalesRepQueue(pool,9,{timezone:'UTC',env})).counters.paid,1);
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
 console.log('PASS prospect checkout: confirmation/context, no fake calls, cross-context reuse, ownership, nullable verified payment, counters, test credentials/recipients, mode isolation, immutable test calls and uncertain delivery fence');
}
