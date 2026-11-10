import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import prospectCheckout from '../../pages/api/v1/admin/sales/prospects/[prospectId]/checkout.js';
import testWebhook from '../../pages/api/v1/stripe/sales-test-webhook.js';
import { getSalesTestStripe } from '../../pages/api/_lib/salesCheckout.js';

export async function testSalesCheckoutApi({pool,call,salesCookie,repId}) {
 const request=(cookie=salesCookie,body={})=>({method:'POST',query:{prospectId:'contact-ready'},body,headers:{cookie,'idempotency-key':crypto.randomUUID()},socket:{remoteAddress:'127.0.0.1'}});
 assert.equal((await call(prospectCheckout,request('',{}))).statusCode,401);
 const unconfirmed=await call(prospectCheckout,request());
 assert.equal(unconfirmed.statusCode,409);assert.equal(unconfirmed.body.error,'checkout_confirmation_required');
 const stale=await call(prospectCheckout,request(salesCookie,{confirmedWithoutCall:true,expectedIsTest:true,confirmedRecipient:'customer@example.test',channel:'email',email:'customer@example.test'}));
 assert.equal(stale.statusCode,409);assert.equal(stale.body.error,'checkout_context_changed');
 const foreign=request();foreign.query.prospectId='other-contact-ready';
 assert.equal((await call(prospectCheckout,foreign)).statusCode,403);
 process.env.SALES_STRIPE_TEST_SECRET_KEY='sk_test_fixture';
 process.env.SALES_STRIPE_TEST_WEBHOOK_SECRET='whsec_sales_fixture';
 try {
  await pool.query("INSERT INTO sales_checkout_sessions(checkout_id,prospect_id,rep_user_id,channel,recipient,status,is_test,activation_status,stripe_session_id,provider_message_id,amount_cents) VALUES('signed_test_checkout','contact-ready',$1,'email','rep@example.test','sent',TRUE,'test_only','cs_signed_test','mail_fixture',375)",[repId]);
  const event={id:'evt_signed_test',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_signed_test',livemode:false,mode:'payment',currency:'usd',amount_total:375,payment_status:'paid',metadata:{sales_checkout_id:'signed_test_checkout',sales_prospect_id:'contact-ready',sales_checkout_test:'true'}}}};
  const signedRequest=(value,{secret=process.env.SALES_STRIPE_TEST_WEBHOOK_SECRET,tamper=false}={})=>{
   const payload=JSON.stringify(value);
   const signature=getSalesTestStripe().webhooks.generateTestHeaderString({payload,secret});
   return Object.assign(Readable.from([tamper?payload+' ':payload]),{method:'POST',headers:{'stripe-signature':signature}});
  };
  assert.equal((await call(testWebhook,signedRequest(event,{secret:'whsec_wrong'}))).statusCode,400);
  assert.equal((await call(testWebhook,signedRequest(event,{tamper:true}))).statusCode,400);
  assert.equal((await call(testWebhook,signedRequest({...event,livemode:true}))).statusCode,400);
  const wrong={...event,data:{object:{...event.data.object,metadata:{...event.data.object.metadata,sales_prospect_id:'other-contact-ready'}}}};
  assert.equal((await call(testWebhook,signedRequest(wrong))).statusCode,409);
  assert.equal((await call(testWebhook,signedRequest({...event,data:{object:{...event.data.object,amount_total:10000}}}))).statusCode,409);
  assert.equal((await call(testWebhook,signedRequest(event))).statusCode,200);
  assert.equal((await call(testWebhook,signedRequest(event))).statusCode,200);
  const row=(await pool.query("SELECT status,paid_at,activation_status,tenant_key FROM sales_checkout_sessions WHERE checkout_id='signed_test_checkout'")).rows[0];
  assert.equal(row.status,'test_complete');assert.equal(row.paid_at,null);assert.equal(row.activation_status,'test_only');assert.equal(row.tenant_key,null);
  assert.notEqual((await pool.query("SELECT status FROM sales_prospects WHERE prospect_id='contact-ready'")).rows[0].status,'paid');
 } finally {
  delete process.env.SALES_STRIPE_TEST_SECRET_KEY;delete process.env.SALES_STRIPE_TEST_WEBHOOK_SECRET;
 }
 console.log('PASS checkout API authentication/confirmation and signed test webhook identity/mode/replay isolation');
}
