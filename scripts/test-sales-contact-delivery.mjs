import assert from 'node:assert/strict';
import { createUpibTestFixture } from './lib/upib-test-fixture.mjs';
import { resolveIntakeSalesReference } from '../pages/api/_lib/paidIntake.js';
import { setSalesPhoneTestMode } from '../pages/api/_lib/salesPhoneTestMode.js';
import { getSalesProspect, createSalesCallSession, updateSalesCallSession } from '../pages/api/_lib/salesRepository.js';
import { sendSalesCheckout, getSalesCheckoutContext, applySalesPaidCheckout } from '../pages/api/_lib/salesCheckout.js';
import { bookSalesSetup } from '../pages/api/_lib/salesCalendar.js';
import { buildSalesCallView } from '../pages/api/_lib/salesCallView.js';
import { salesIncomingAction } from '../pages/api/_lib/salesIncoming.js';
import { createSalesInboundService } from '../apps/sales-call-gateway/src/salesInbound.js';
import { initialCompanyContactId, companyContactTarget } from '../app/admin/sales/dialerState.mjs';
const fixture=await createUpibTestFixture({label:'contactdelivery'});
const {pool}=fixture;
const q=(sql,values=[])=>pool.query(sql,values);
const env={APP_BASE_URL:'https://example.test',SETUP_CALL_OWNER:'owner@example.test',FULL_BUILD_LEAD_MINUTES:'360',SETUP_CALL_TIMEZONE:'UTC',SETUP_CALL_START_HOUR:'0',SETUP_CALL_END_HOUR:'24',SALES_GRAPH_TENANT_ID:'test',SALES_GRAPH_CLIENT_ID:'test',SALES_GRAPH_CLIENT_SECRET:'test',SALES_TELNYX_CALLER_ID:'+12065559999',SALES_TELNYX_CALL_CONTROL_APP_ID:'test-app'};
process.env.SALES_CALL_WINDOW_START_LOCAL='00:00';process.env.SALES_CALL_WINDOW_END_LOCAL='00:00';process.env.SALES_CALL_MISSING_TIMEZONE_POLICY='allow';
try {
 await q("INSERT INTO admin_users(id,username,email,role) VALUES(1,'rep1','rep@example.test','sales'),(2,'rep2','rep2@example.test','sales')");
 await q('UPDATE paid_intake_release SET enabled=TRUE');
 process.env.APP_BASE_URL=env.APP_BASE_URL;
 for(const id of ['company','foreign']) {
  await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,contact_name,contact_email,numbers_json,permission_granted,assigned_rep_user_id,timezone) VALUES($1,$1,$1,'+12065550100','Original Person','original@example.test',$2::jsonb,TRUE,1,'UTC')",[id,JSON.stringify([{type:'cell',phoneE164:'+12065550100'}])]);
  await q("INSERT INTO sales_demo_profiles(demo_profile_id,prospect_id,status) VALUES($1,$1,'ready')",[id]);
 }
 await q("INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name,last_name,email) VALUES('second','company','Second','Person','second@example.test')");
 await q("UPDATE sales_prospect_contacts SET notes='Private memo never copied into providers or snapshots' WHERE contact_id='second'");
 await q("INSERT INTO sales_prospect_contact_numbers(number_id,prospect_id,contact_id,phone_e164,type,label) VALUES('second-cell','company','second','+12065550101','cell','Personal cell'),('shared','company',NULL,'+12065550102','shop','Office')");
 const company=await getSalesProspect(pool,'company');
 assert.equal(initialCompanyContactId(company),company.defaultContactId);
 assert.equal(initialCompanyContactId({...company,callbackTarget:{requiresSelection:true}}),'');
 assert.deepEqual(companyContactTarget(company,'second').numbers.map(n=>n.id),['second-cell','shared']);
 assert.equal(companyContactTarget(company,'archived').contact,null);
 let charges=0,messages=[];
 const stripe={checkout:{sessions:{create:async()=>({id:`cs_${++charges}`,url:'https://checkout.test/frozen',livemode:true})}}};
 const mail=async message=>{messages.push(message);return {id:'sent'};};
 const delivery={prospectId:'company',repId:1,channel:'email',contactId:'second',email:'second@example.test',expectedRowVersion:company.rowVersion,confirmedWithoutCall:true,confirmedRecipient:'second@example.test',expectedIsTest:false,env,stripe,mail};
 await assert.rejects(sendSalesCheckout(pool,{...delivery,contactId:'contact_legacy_foreign'}),e=>e.code==='contact_unavailable');
 const result=await sendSalesCheckout(pool,delivery);
 assert.equal(result.recipient,'second@example.test');assert.equal(messages[0].to,'second@example.test');
 const frozen=await getSalesCheckoutContext(pool,{prospectId:'company',repId:1});assert.equal(frozen.contactSnapshot.contactId,'second');assert(!Object.hasOwn(frozen.contactSnapshot,'notes'));assert(!JSON.stringify(messages).includes('Private memo'));
 await assert.rejects(sendSalesCheckout(pool,{...delivery,contactId:company.defaultContactId,email:'original@example.test',confirmedRecipient:'original@example.test'}),e=>e.code==='checkout_delivery_exists');
 assert.equal(charges,0,'Live Sales sends shared intake and must not create a direct Checkout');assert.equal(messages.length,1);
 const liveUrl=new URL(result.url);assert.equal(liveUrl.origin,'https://example.test');assert.equal(liveUrl.pathname,'/intake');assert(liveUrl.searchParams.get('salesRef'));
 const scoped=await resolveIntakeSalesReference(pool,liveUrl.searchParams.get('salesRef'));assert.equal(scoped.prospect_id,'company');assert.equal(scoped.contact_snapshot.contactId,'second');assert.equal(scoped.stripe_session_id,null);
 const resent=await sendSalesCheckout(pool,delivery);assert.equal(resent.url,result.url);assert.equal(messages.length,1);assert.equal(charges,0);
 await assert.rejects(resolveIntakeSalesReference(pool,'forged-reference'),/intake_reference_expired/);
 assert.equal(Number((await q('SELECT COUNT(*) AS n FROM tenants')).rows[0].n),0);
 assert.equal(Number((await q('SELECT COUNT(*) AS n FROM paid_purchases')).rows[0].n),0);
 // A possibly sent scoped link retains the original recipient and delivery fence.
 const foreign=await getSalesProspect(pool,'foreign');let uncertainSends=0;
 const uncertainDelivery={...delivery,prospectId:'foreign',contactId:foreign.defaultContactId,email:'original@example.test',confirmedRecipient:'original@example.test',expectedRowVersion:foreign.rowVersion,mail:async()=>{uncertainSends++;throw Error('provider response lost');}};
 await assert.rejects(sendSalesCheckout(pool,uncertainDelivery),/provider response lost/);
 const pending=(await q("SELECT checkout_url,recipient,status FROM sales_checkout_sessions WHERE prospect_id='foreign'")).rows[0];assert.equal(pending.status,'delivery_uncertain');assert.equal(pending.recipient,'original@example.test');
 await assert.rejects(sendSalesCheckout(pool,uncertainDelivery),e=>e.code==='checkout_delivery_pending');assert.equal(uncertainSends,1);
 assert.equal((await q("SELECT checkout_url FROM sales_checkout_sessions WHERE prospect_id='foreign'")).rows[0].checkout_url,pending.checkout_url);

 const call=await createSalesCallSession(pool,{prospectId:'company',adminUserId:1,contactId:'second',numberId:'shared',expectedRowVersion:company.rowVersion,idempotencyKey:'reservation',metadata:{prospect_number:'+12065550102',business_name:'Frozen Business'}});
 assert.equal(call.metadata.contact_snapshot.displayName,'Second Person');assert(!Object.hasOwn(call.metadata.contact_snapshot,'notes'));
 const replay=await createSalesCallSession(pool,{prospectId:'company',adminUserId:1,contactId:'second',numberId:'shared',expectedRowVersion:company.rowVersion,idempotencyKey:'reservation',metadata:{prospect_number:'+12065550102'}});assert.equal(replay.salesCallId,call.salesCallId);
 await assert.rejects(createSalesCallSession(pool,{prospectId:'company',adminUserId:1,contactId:company.defaultContactId,numberId:'shared',idempotencyKey:'reservation'}));
 await updateSalesCallSession(pool,call.salesCallId,{state:'ended',endedAt:new Date().toISOString()});
 const now=Date.parse('2026-11-09T00:00:00Z');const start='2026-11-10T10:00:00Z',end='2026-11-10T10:15:00Z';let events=[];
 const graph=async(path,body)=>{if(path.endsWith('getSchedule'))return {value:[{availabilityView:'0'.repeat(7*96)}]};events.push(structuredClone(body));if(events.length===1)throw Error('mock uncertain provider');return {id:'event_frozen'};};
 const booking={salesCallId:call.salesCallId,repId:1,start,end,email:'second@example.test',contactId:'second',env,graph,now};
 await assert.rejects(bookSalesSetup(pool,booking),/mock uncertain/);
 await q("UPDATE sales_prospects SET business_name='Changed Business' WHERE prospect_id='company'");
 await assert.rejects(bookSalesSetup(pool,{...booking,contactId:'contact_legacy_foreign'}),e=>e.code==='sales_booking_exists');
 await bookSalesSetup(pool,booking);assert.deepEqual(events[1],events[0]);assert.equal(events[0].attendees[0].emailAddress.name,'Second Person');assert.match(events[0].body.content,/12065550101/);
 assert(!JSON.stringify(events).includes('Private memo'));assert(!Object.hasOwn((await q("SELECT attendee_snapshot FROM sales_setup_bookings LIMIT 1")).rows[0].attendee_snapshot,'notes'));
 const view=await buildSalesCallView(pool,call);assert.equal(view.contactName,'Second Person');assert.equal(view.businessName,'Frozen Business');
 const legacy=await buildSalesCallView(pool,{...call,metadata:{},dialedNumber:'+12065550103'});assert.equal(legacy.contactName,'Contact not recorded');assert.equal(legacy.dialedNumber,'+12065550103');
 await q("INSERT INTO sales_operator_settings(admin_user_id,caller_id_number,active) VALUES(2,'+12065558888',TRUE)");
 const inbound=createSalesInboundService({pool,env,telnyx:{answerCall:async()=>{},hangupCall:async()=>{}}});
 for(const [index,phone] of ['+12065550100','+12065550101','+12065550102'].entries())await inbound.handleEvent({type:'call.initiated',payload:{call_control_id:`in-${index}`,direction:'incoming',connection_id:'test-app',from:phone,to:'+12065558888'}});
 const rows=(await q("SELECT * FROM sales_incoming_calls ORDER BY provider_call_control_id")).rows;
 assert.equal(rows[0].prospect_id,null);assert.equal(Number(rows[0].rep_user_id),2);assert.equal(rows[0].contact_snapshot,null);
 assert.equal(rows[1].prospect_id,'company');assert.equal(rows[1].contact_snapshot.contactId,'second');assert.equal(rows[2].contact_snapshot,null);
 await assert.rejects(salesIncomingAction(pool,{incomingId:rows[1].incoming_id,repId:1,action:'match',prospectId:'foreign',env}),e=>e.code==='incoming_identity_bound');
 assert.equal((await q('SELECT prospect_id FROM sales_incoming_calls WHERE incoming_id=$1',[rows[1].incoming_id])).rows[0].prospect_id,'company');
 await q("UPDATE sales_prospects SET assigned_rep_user_id=2 WHERE prospect_id='company'");
 await assert.rejects(createSalesCallSession(pool,{prospectId:'company',adminUserId:1,contactId:'second',numberId:'shared',idempotencyKey:'reservation'}),e=>e.code==='prospect_forbidden');
 await assert.rejects(getSalesCheckoutContext(pool,{prospectId:'company',repId:1}),e=>e.code==='prospect_forbidden');
 console.log('PASS selected contact reservation/replay, scoped live intake without charge/tenant, frozen recipient/uncertain send, immutable booking retry, historic snapshots and inbound ambiguity');
} finally {await fixture.close();}

// The deliberately separate sandbox keeps its fixed test Checkout; it never
// acquires a live intake reference, production purchase, or tenant entitlement.
const sandboxFixture=await createUpibTestFixture({label:'contactdeliverytest'});
try {
 const sandbox=sandboxFixture.pool;
 await sandbox.query("INSERT INTO admin_users(id,username,email,role) VALUES(1,'testrep','rep@example.test','sales')");
 await sandbox.query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,contact_name,contact_email,permission_granted,assigned_rep_user_id,timezone) VALUES('sandbox','sandbox','Sandbox business','+12065550190','Test owner','owner@example.test',TRUE,1,'UTC')");
 await setSalesPhoneTestMode(sandbox,true);
 const prospect=await getSalesProspect(sandbox,'sandbox');let testCreates=0,testMessages=0,params;
 const testEnv={...env,SALES_STRIPE_TEST_SECRET_KEY:'sk_test_fixture_only',SALES_CHECKOUT_TEST_EMAIL:'rep@example.test'};
 const testStripe={checkout:{sessions:{create:async value=>{testCreates++;params=value;return {id:'cs_test_contact',url:'https://checkout.test/sandbox',livemode:false};}}}};
 const request={prospectId:'sandbox',repId:1,channel:'email',contactId:prospect.defaultContactId,email:'rep@example.test',expectedRowVersion:prospect.rowVersion,confirmedWithoutCall:true,confirmedRecipient:'rep@example.test',expectedIsTest:true,env:testEnv,stripe:testStripe,mail:async m=>{testMessages++;assert.equal(m.to,'rep@example.test');assert.match(m.text,/TEST ONLY/);return{id:'sandbox_mail'};}};
 const sent=await sendSalesCheckout(sandbox,request);assert.equal(sent.isTest,true);assert.equal(testCreates,1);assert.equal(params.mode,'payment');assert.equal(params.line_items[0].price_data.unit_amount,10000);
 await sendSalesCheckout(sandbox,request);assert.equal(testCreates,1);assert.equal(testMessages,1);
 const event={id:'evt_test_contact',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_contact',mode:'payment',currency:'usd',amount_total:10000,livemode:false,payment_status:'paid',metadata:params.metadata}}};
 await applySalesPaidCheckout(sandbox,event,{testWebhook:true});
 const ledger=(await sandbox.query("SELECT status,paid_at,activation_status FROM sales_checkout_sessions WHERE prospect_id='sandbox'")).rows[0];assert.equal(ledger.status,'test_complete');assert.equal(ledger.paid_at,null);assert.equal(ledger.activation_status,'test_only');
 for(const table of ['paid_intake_sales_references','paid_purchases','tenants'])assert.equal(Number((await sandbox.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n),0);
 console.log('PASS isolated sandbox keeps $100 payment Checkout and immutable test recipient; test payment grants no live intake/purchase/tenant');
}finally{await sandboxFixture.close();}
