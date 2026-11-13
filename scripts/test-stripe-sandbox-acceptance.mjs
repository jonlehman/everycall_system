import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createAcceptanceHandler} from './lib/stripe-sandbox-acceptance.mjs';

const token='a'.repeat(64),now=Date.now(),config={expectedAccountId:'acct_16FSzlFgMKdd4EaW',runId:'acceptance_test',expiresAt:now+1000,tokenSha256:crypto.createHash('sha256').update(token).digest('hex')};
assert.throws(()=>createAcceptanceHandler({...config,expectedAccountId:undefined}),/invalid_probe_configuration/);
let constructors=0,accountReads=0;
class FakeStripe {constructor(){constructors++;this.accounts={retrieve:async()=>{accountReads++;return{id:'wrong_account'};}};}}
async function call({auth=`Bearer ${token}`,method='POST',body={action:'begin',source:0},key='sk_test_fake',time=now,StripeClient=FakeStripe}={}) {
  const response={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  await createAcceptanceHandler(config,{StripeClient,env:{SALES_STRIPE_TEST_SECRET_KEY:key},now:()=>time})({method,headers:{authorization:auth},body},response);
  return response;
}
assert.equal((await call({method:'GET'})).statusCode,405);
assert.equal((await call({auth:'Bearer incorrect'})).statusCode,401);
assert.equal((await call({time:now+2000})).statusCode,410);
assert.equal((await call({key:'sk_live_fake'})).statusCode,503);
assert.equal((await call({key:''})).statusCode,503);
assert.equal((await call({body:{action:'arbitrary'}})).body.error,'invalid_action');
assert.equal((await call({body:{action:'begin',source:100}})).body.error,'invalid_source');
assert.equal((await call({body:{action:'begin',source:0,enrollment:'arbitrary'}})).body.error,'invalid_enrollment');
assert.equal((await call({body:{action:'begin',source:0,timing:'arbitrary'}})).body.error,'invalid_timing');
assert.equal((await call({body:{action:'begin',source:0,kind:'arbitrary'}})).body.error,'invalid_kind');
assert.equal((await call({body:{action:'begin',source:0,scheduleVariant:'arbitrary'}})).body.error,'invalid_schedule_variant');
assert.equal((await call({body:{action:'begin',source:0,target:2,scheduleVariant:'anniversary_paid_bridge'}})).body.error,'invalid_paid_bridge_pair');
assert.equal((await call({body:{action:'cleanup',continuation:'forged.signature'}})).body.error,'invalid_continuation');
assert.equal((await call({body:{action:'begin',source:0,methodStrategy:'arbitrary'}})).body.error,'invalid_method_strategy');
assert.equal((await call({body:{action:'begin',source:0,scheduleWhen:'arbitrary'}})).body.error,'invalid_schedule_when');
assert.equal((await call({body:{action:'begin',source:0,scheduleWhen:'included'}})).body.error,'invalid_included_schedule');
assert.equal((await call({body:{action:'inspect-lines',invoiceKind:'arbitrary'}})).body.error,'invalid_invoice_kind');
assert.equal((await call({body:{action:'begin',source:0,rescheduleMode:'arbitrary'}})).body.error,'invalid_reschedule_mode');
assert.equal((await call({body:{action:'begin',source:0,rescheduleMode:'omit_billed_item'}})).body.error,'invalid_reschedule_pair');
assert.equal((await call({body:{action:'begin',source:0,scheduleMethodStrategy:'arbitrary'}})).body.error,'invalid_schedule_method_strategy');
assert.equal((await call({body:{action:'begin',source:0,metadataContract:'arbitrary'}})).body.error,'invalid_metadata_contract');
assert.equal((await call({body:{action:'checkout',source:0,checkoutMode:'arbitrary'}})).body.error,'invalid_checkout_mode');
assert.equal((await call({body:{action:'begin',source:0,checkoutMode:'reuse_consent'}})).body.error,'invalid_reuse_checkout');
assert.equal(constructors,0,'all request and environment guards must precede provider construction');
const denied=await call();
assert.equal(denied.body.error,'sandbox_account_mismatch');
assert.equal(accountReads,1);
const otherSandbox=await call({body:{action:'preflight'}});
assert.equal(otherSandbox.body.error,'sandbox_account_requires_pin');
assert.equal(otherSandbox.body.authorizedAccount,false);
assert.equal(otherSandbox.body.accountId,'wrong_account');
assert.ok(denied.body.continuation,'partial fixture state remains recoverable');
assert.equal(denied.headers['Cache-Control'],'no-store');
assert.ok(!JSON.stringify(denied.body).includes('sk_test_fake'),'response cannot contain the Stripe key');
assert.ok(!JSON.stringify(denied.body).includes(token),'response cannot contain the bearer token');
assert.equal((await call({body:{action:'cleanup',continuation:denied.body.continuation.replace(/.$/,'X')}})).body.error,'invalid_continuation');
class UnsafeWebhookStripe {
  constructor(){this.accounts={retrieve:async()=>({id:'acct_16FSzlFgMKdd4EaW'})};this.webhookEndpoints={list:async()=>({has_more:false,data:[{id:'we_synthetic',livemode:false,status:'enabled',url:'https://app.everycall.io/api/v1/stripe/webhook?secret=do_not_disclose',enabled_events:['*']}]})};}
}
assert.equal((await call({StripeClient:UnsafeWebhookStripe})).body.error,'unsafe_test_webhook_destination');
const inventory=await call({StripeClient:UnsafeWebhookStripe,body:{action:'preflight'}});
assert.equal(inventory.body.safeWebhooks,false);
assert.ok(!JSON.stringify(inventory.body).includes('do_not_disclose'),'webhook URL queries cannot enter evidence');
class SafeWebhookStripe extends UnsafeWebhookStripe {
  constructor(){super();this.webhookEndpoints={list:async()=>({has_more:false,data:[{id:'we_synthetic',livemode:false,status:'enabled',url:'https://app.everycall.io/api/v1/stripe/sales-test-webhook',enabled_events:['*']}]})};}
}
assert.equal((await call({StripeClient:SafeWebhookStripe,body:{action:'preflight'}})).body.safeWebhooks,true);
console.log('Stripe acceptance probe security guards passed (no provider calls).');
