// Temporary, standalone provider acceptance probe. NEVER add this handler to the
// application router. The packager deploys it without application code or crons.
import crypto from 'node:crypto';
import Stripe from 'stripe';

export const API_VERSION = '2026-02-25.clover';
export const PRICES = Object.freeze([
  {code:'starter',interval:'month',amount:7450,allowance:25,overage:300},
  {code:'starter',interval:'year',amount:75990,allowance:25,overage:300},
  {code:'growth',interval:'month',amount:12450,allowance:60,overage:200},
  {code:'growth',interval:'year',amount:126990,allowance:60,overage:200},
  {code:'pro',interval:'month',amount:17450,allowance:100,overage:175},
  {code:'pro',interval:'year',amount:177990,allowance:100,overage:175}
]);
const id = x => typeof x === 'string' ? x : x?.id;
const check = (ok, code) => {if (!ok) throw Object.assign(new Error(code), {acceptanceCode:code});};
const iso = n => new Date(n * 1000).toISOString();
const sec = s => Math.floor(new Date(s).getTime()/1000);
const safe = s => typeof s === 'string' && /^[a-zA-Z0-9_.\[\]-]{1,120}$/.test(s) ? s : undefined;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a,b) => {const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);};
function boundary(time, months) {
  const d=new Date(time*1000), m=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months+1,0)).getUTCDate();
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months,Math.min(d.getUTCDate(),m),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds())/1000;
}
function summary(sub) {
  const item=sub.items.data[0];
  return {id:sub.id,livemode:sub.livemode,status:sub.status,price:id(item.price),
    start:iso(item.current_period_start),end:iso(item.current_period_end),anchor:sub.billing_cycle_anchor_config,
    billingCycleAnchor:sub.billing_cycle_anchor?iso(sub.billing_cycle_anchor):null,schedule:id(sub.schedule)||null,
    defaultPaymentMethod:id(sub.default_payment_method)||null,saveDefaultPaymentMethod:sub.payment_settings?.save_default_payment_method||null,cancelAtPeriodEnd:sub.cancel_at_period_end,trialEnd:sub.trial_end?iso(sub.trial_end):null};
}
function invoiceSummary(x) {
  return {id:x.id,livemode:x.livemode,status:x.status,currency:x.currency,total:x.total,amountPaid:x.amount_paid,
    amountDue:x.amount_due,customer:id(x.customer),subscription:id(x.parent?.subscription_details?.subscription)||id(x.subscription)||null,
    subscriptionParentType:x.parent?.type||null,amountRemaining:x.amount_remaining,billingReason:x.billing_reason,created:iso(x.created),
    attemptCount:x.attempt_count,nextPaymentAttempt:x.next_payment_attempt,
    paymentMethod:id(x.default_payment_method),...(x.status==='open'?{hostedInvoiceUrl:x.hosted_invoice_url}:{})};
}

export function createAcceptanceHandler(config,{StripeClient=Stripe,env=process.env,now=Date.now}={}) {
  check(/^[a-f0-9]{64}$/.test(config.tokenSha256),'invalid_probe_configuration');
  check(/^[a-zA-Z0-9_-]{8,64}$/.test(config.runId),'invalid_probe_configuration');
  check(Number.isFinite(config.expiresAt),'invalid_probe_configuration');
  check(/^acct_[A-Za-z0-9]+$/.test(config.expectedAccountId||''),'invalid_probe_configuration');
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
    const auth=String(req.headers.authorization||'');
    if(auth.length>160||!auth.startsWith('Bearer ')||!equal(digest(auth.slice(7)),config.tokenSha256))return res.status(401).json({error:'unauthorized'});
    if(now()>config.expiresAt)return res.status(410).json({error:'probe_expired'});
    const key=String(env.SALES_STRIPE_TEST_SECRET_KEY||'').trim();
    if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key))return res.status(503).json({error:'test_key_required'});
    const sign=payload=>crypto.createHmac('sha256',key).update(`everycall-acceptance-v1:${config.runId}:${payload}`).digest('base64url');
    const seal=state=>{const p=Buffer.from(JSON.stringify(state)).toString('base64url');return `${p}.${sign(p)}`;};
    const unseal=value=>{
      check(typeof value==='string'&&value.length<16000,'invalid_continuation');
      const [p,mac,...extra]=value.split('.');
      check(p&&mac&&!extra.length&&equal(mac,sign(p)),'invalid_continuation');
      const state=JSON.parse(Buffer.from(p,'base64url').toString());
      check(state.run===config.runId,'invalid_continuation');return state;
    };
    let state;
    try {
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      check(body&&typeof body==='object'&&!Array.isArray(body),'invalid_request');
      check(JSON.stringify(body).length<=20000,'invalid_request');
      check(['preflight','begin','advance','advance-month','settle','inspect','canonical-base','inspect-lines','usage','recover','cancel','cleanup','checkout','checkout-complete','schedule','bridge-reschedule','portal','retire-catalog'].includes(body.action),'invalid_action');
      check(body.invoiceKind===undefined||body.invoiceKind==='bridge','invalid_invoice_kind');
      if(body.action==='preflight')state={run:config.runId,scenario:'preflight'};
      else if(body.action==='begin'||body.action==='checkout') {
        check(Number.isInteger(body.source)&&body.source>=0&&body.source<6,'invalid_source');
        check(body.target===undefined||(Number.isInteger(body.target)&&body.target>=0&&body.target<6),'invalid_target');
        check(body.calendar===undefined||['leap','ordinary'].includes(body.calendar),'invalid_calendar');
        check(body.recovery===undefined||['decline','sca'].includes(body.recovery),'invalid_recovery');
        check(body.enrollment===undefined||body.enrollment==='trial_anchor','invalid_enrollment');
        check(body.methodStrategy===undefined||['customer_default','subscription_save','customer_seed_and_save'].includes(body.methodStrategy),'invalid_method_strategy');
        check(body.kind===undefined||body.kind==='restart','invalid_kind');
        check(body.timing===undefined||body.timing==='after_payment','invalid_timing');
        check(body.scheduleVariant===undefined||['anniversary_end','anniversary_phase_start','anniversary_automatic','anniversary_paid_bridge'].includes(body.scheduleVariant),'invalid_schedule_variant');
        if(body.scheduleVariant==='anniversary_paid_bridge')check(body.source%2===1&&Number.isInteger(body.target)&&body.target%2===0,'invalid_paid_bridge_pair');
        check(body.scheduleMethodStrategy===undefined||body.scheduleMethodStrategy==='clear_settings','invalid_schedule_method_strategy');
        if(body.scheduleMethodStrategy)check(body.action==='begin'&&Number.isInteger(body.target),'schedule_target_required');
        check(body.checkoutMode===undefined||body.checkoutMode==='reuse_consent','invalid_checkout_mode');
        if(body.checkoutMode)check(body.action==='checkout'&&body.kind===undefined,'invalid_reuse_checkout');
        check(body.metadataContract===undefined||body.metadataContract==='source_keys','invalid_metadata_contract');
        check(body.rescheduleMode===undefined||body.rescheduleMode==='omit_billed_item','invalid_reschedule_mode');
        if(body.rescheduleMode)check(body.scheduleVariant==='anniversary_paid_bridge'&&body.target===0,'invalid_reschedule_pair');
        check(body.scheduleWhen===undefined||['included','past_due'].includes(body.scheduleWhen),'invalid_schedule_when');
        if(body.scheduleWhen==='included')check(body.action==='begin'&&body.enrollment==='trial_anchor'&&body.scheduleVariant==='anniversary_paid_bridge','invalid_included_schedule');
        check(body.action!=='checkout'||(body.target===undefined&&body.recovery===undefined),'invalid_checkout');
        const scenario=[body.action,body.source,body.target??'none',body.calendar||'leap',body.recovery||'none',...(body.enrollment?[body.enrollment]:[]),...(body.kind?[body.kind]:[]),...(body.timing?[body.timing]:[]),...(body.scheduleVariant?[body.scheduleVariant]:[]),...(body.methodStrategy?[body.methodStrategy]:[]),...(body.scheduleWhen?[body.scheduleWhen]:[]),...(body.rescheduleMode?[body.rescheduleMode]:[]),...(body.scheduleMethodStrategy?[body.scheduleMethodStrategy]:[]),...(body.metadataContract?[body.metadataContract]:[]),...(body.checkoutMode?[body.checkoutMode]:[])].join('-');
        state={run:config.runId,scenario,source:body.source,target:body.target,calendar:body.calendar||'leap',recovery:body.recovery,enrollment:body.enrollment,kind:body.kind,timing:body.timing,scheduleVariant:body.scheduleVariant,methodStrategy:body.methodStrategy,scheduleWhen:body.scheduleWhen,rescheduleMode:body.rescheduleMode,scheduleMethodStrategy:body.scheduleMethodStrategy,metadataContract:body.metadataContract,checkoutMode:body.checkoutMode,step:0};
      }else state=unseal(body.continuation);
      const stripe=new StripeClient(key,{apiVersion:API_VERSION,maxNetworkRetries:1,timeout:20000});
      const account=await stripe.accounts.retrieve();
      const expectedAccountId=config.expectedAccountId;
      if(body.action==='preflight'&&account.id!==expectedAccountId)return res.status(200).json({run:config.runId,apiVersion:API_VERSION,accountId:account.id,authorizedAccount:false,safeWebhooks:false,error:'sandbox_account_requires_pin'});
      check(account.id===expectedAccountId,'sandbox_account_mismatch');
      const endpoints=await stripe.webhookEndpoints.list({limit:100});
      check(!endpoints.has_more,'webhook_inventory_incomplete');
      const webhookEvidence=endpoints.data.filter(e=>e.status==='enabled').map(e=>{const u=new URL(e.url);return {id:e.id,livemode:e.livemode,origin:u.origin,path:u.pathname,apiVersion:e.api_version,events:e.enabled_events};});
      const safeWebhooks=webhookEvidence.every(e=>e.livemode===false&&e.origin==='https://app.everycall.io'&&e.path==='/api/v1/stripe/sales-test-webhook');
      if(body.action==='preflight')return res.status(200).json({run:config.runId,apiVersion:API_VERSION,accountId:account.id,safeWebhooks,webhooks:webhookEvidence});
      check(safeWebhooks,'unsafe_test_webhook_destination');
      const idem=label=>({idempotencyKey:`${config.runId}:${state.scenario}:${label}`});
      const metadata={acceptance_run:config.runId,acceptance_scenario:state.scenario,app:'everycall_acceptance'};
      const send=extra=>res.status(200).json({run:config.runId,apiVersion:API_VERSION,scenario:state.scenario,...(state.paidAt?{paidAt:iso(state.paidAt)}:{}),enrollmentVariant:state.enrollment||'original',timing:state.timing||'same_second',continuation:seal(state),...extra});
      const ownCustomer=async()=>{const c=await stripe.customers.retrieve(state.customer);check(!c.deleted&&c.livemode===false&&c.metadata?.acceptance_run===config.runId&&c.metadata?.acceptance_scenario===state.scenario,'fixture_customer_mismatch');return c;};
      const ownSubscription=async()=>{const s=await stripe.subscriptions.retrieve(state.subscription);check(s.livemode===false&&id(s.customer)===state.customer&&s.metadata?.acceptance_run===config.runId,'fixture_subscription_mismatch');return s;};
      const getPrices=async()=>{
        const product=await stripe.products.create({name:`EveryCall disposable acceptance ${config.runId}`,metadata:{acceptance_run:config.runId,app:'everycall_acceptance'}},{idempotencyKey:`${config.runId}:product`});
        check(product.livemode===false,'fixture_mode_mismatch');state.product=product.id;
        state.prices=[];
        for(let i=0;i<PRICES.length;i++){
          const p=PRICES[i], price=await stripe.prices.create({product:product.id,currency:'usd',unit_amount:p.amount,recurring:{interval:p.interval},metadata:{acceptance_run:config.runId}},{idempotencyKey:`${config.runId}:price:${i}`});
          check(price.livemode===false&&price.unit_amount===p.amount&&price.recurring.interval===p.interval,'price_contract_mismatch');state.prices.push(price.id);
        }
      };
      const checkoutParams=setupOnly=>{
        const p=PRICES[state.source],restart=state.kind==='restart',purchaseId=`acceptance_purchase_${config.runId}_${state.scenario}`;
        const checkoutMetadata=state.metadataContract==='source_keys'?{...metadata,paid_purchase_id:purchaseId,paid_intake_id:`acceptance_intake_${config.runId}_${state.scenario}`,plan_code:p.code,billing_interval:p.interval,paid_checkout_generation:'0',...(restart?{tenant_key:`acceptance_tenant_${config.runId}`}:{terms_version:'UPIB-2026-11-12-v1'})}:metadata;
        const message=`I authorize $${(p.amount/100).toFixed(2)} every ${p.interval==='year'?'year':'month'}, starting after ${restart?'the full period paid today':'the first calendar month included in setup'}. ${p.allowance} calls each month; $${(p.overage/100).toFixed(2)} per additional billable call, billed monthly. Cancellation takes effect at paid-term end.`+(restart?' No setup fee or free month. A new phone number requires updated call forwarding.':'');
        return {mode:setupOnly?'setup':'payment',customer:state.customer,payment_method_types:['card'],client_reference_id:purchaseId,metadata:checkoutMetadata,
          success_url:restart?'https://example.invalid/client/account/billing?restart=processing':'https://example.invalid/intake?checkout=success',cancel_url:restart?'https://example.invalid/client/account/billing':'https://example.invalid/intake?checkout=cancel',consent_collection:{terms_of_service:'required'},
          ...(setupOnly?{currency:'usd',setup_intent_data:{metadata:checkoutMetadata}}:{line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:restart?p.amount:10000,product_data:{name:restart?`EveryCall ${p.code} — full new ${p.interval==='year'?'year':'month'}`:'EveryCall setup — selected plan’s first month included'}}}],payment_intent_data:{setup_future_usage:'off_session',metadata:checkoutMetadata},invoice_creation:{enabled:true,invoice_data:{metadata:checkoutMetadata}}}),custom_text:{submit:{message}}};
      };
      const createSubscription=async()=>{
        const p=PRICES[state.source],months=state.kind==='restart'&&p.interval==='year'?12:1;
        const date=new Date(state.paidAt*1000),firstEnd=boundary(state.paidAt,months),end=new Date(firstEnd*1000);
        const params={customer:state.customer,items:[{price:state.prices[state.source],quantity:1}],default_payment_method:state.method,
          billing_mode:{type:'flexible'},billing_cycle_anchor_config:{day_of_month:date.getUTCDate(),hour:date.getUTCHours(),minute:date.getUTCMinutes(),second:date.getUTCSeconds(),...(p.interval==='year'?{month:end.getUTCMonth()+1}:{})},
          proration_behavior:'none',collection_method:'charge_automatically',payment_behavior:'error_if_incomplete',metadata};
        if(state.metadataContract==='source_keys')params.metadata={...metadata,app:'everycall',paid_purchase_id:`acceptance_purchase_${config.runId}_${state.scenario}`,paid_intake_id:`acceptance_intake_${config.runId}_${state.scenario}`,plan_code:p.code,billing_interval:p.interval};
        if(state.enrollment==='trial_anchor')params.trial_end=firstEnd;
        if(['subscription_save','customer_seed_and_save'].includes(state.methodStrategy))params.payment_settings={save_default_payment_method:'on_subscription'};
        if(['customer_default','customer_seed_and_save'].includes(state.methodStrategy)){
          await ownCustomer();
          const pm=await stripe.paymentMethods.retrieve(state.method);check(pm.livemode===false&&id(pm.customer)===state.customer,'saved_method_proof');
          await stripe.customers.update(state.customer,{invoice_settings:{default_payment_method:state.method}},idem('customer-method'));
          if(state.methodStrategy==='customer_default'){delete params.default_payment_method;params.payment_settings={save_default_payment_method:'off'};}
        }
        const sub=await stripe.subscriptions.create(params,idem('subscription'));state.subscription=sub.id;
        check(sub.livemode===false&&sub.status===(state.enrollment==='trial_anchor'?'trialing':'active')&&sub.billing_mode?.type==='flexible','subscription_initial_state');
        check(sub.items.data[0].current_period_end===firstEnd,'first_base_due_boundary');
        if(state.enrollment==='trial_anchor')check(sub.trial_end===firstEnd,'trial_end_boundary');
        if(sub.latest_invoice){const inv=await stripe.invoices.retrieve(id(sub.latest_invoice));check(inv.total===0,'unexpected_initial_base_charge');}
        state.next=firstEnd;return sub;
      };
      if(body.action==='begin'||body.action==='checkout'){
        await getPrices();
        if(body.action==='begin'){
          state.paidAt=sec(`${state.calendar==='leap'?'2028':'2027'}-01-31T12:00:00Z`);
          const clock=await stripe.testHelpers.testClocks.create({frozen_time:state.paidAt+(state.timing==='after_payment'?5:0),name:`${config.runId}:${state.scenario}`},idem('clock'));state.clock=clock.id;
        }
        const customer=await stripe.customers.create({name:`Synthetic EveryCall acceptance ${state.scenario}`,metadata,...(state.clock?{test_clock:state.clock}:{})},idem('customer'));
        check(customer.livemode===false,'fixture_mode_mismatch');state.customer=customer.id;
        if(body.action==='checkout'){
          const params=checkoutParams(false),session=await stripe.checkout.sessions.create(params,idem('checkout'));
          check(session.livemode===false,'fixture_mode_mismatch');state.checkout=session.id;
          return send({checkoutUrl:session.url,checkoutId:session.id,amount:session.amount_total,terms:params.custom_text.submit.message});
        }
        const method=await stripe.paymentMethods.attach('pm_card_visa',{customer:state.customer},idem('method'));state.method=method.id;
        const sub=await createSubscription();
        if(state.recovery){
          const testMethod=state.recovery==='decline'?'pm_card_chargeCustomerFail':'pm_card_authenticationRequired';
          const method=await stripe.paymentMethods.attach(testMethod,{customer:state.customer},idem('failure-method'));state.failureMethod=method.id;
          if(['customer_default','customer_seed_and_save'].includes(state.methodStrategy))await stripe.customers.update(state.customer,{invoice_settings:{default_payment_method:method.id}},idem('failure-customer-method'));
          if(state.methodStrategy!=='customer_default')await stripe.subscriptions.update(sub.id,{default_payment_method:method.id},idem('failure-method-update'));
        }
        return send({subscription:summary(sub),prices:PRICES.map((p,i)=>({...p,id:state.prices[i]})),clock:state.clock});
      }
      if(body.action==='retire-catalog'){
        for(const priceId of state.prices||[]){const price=await stripe.prices.retrieve(priceId);check(price.livemode===false&&price.metadata?.acceptance_run===config.runId,'fixture_price_mismatch');await stripe.prices.update(priceId,{active:false});}
        if(state.product){const product=await stripe.products.retrieve(state.product);check(product.livemode===false&&product.metadata?.acceptance_run===config.runId,'fixture_product_mismatch');await stripe.products.update(state.product,{active:false});}
        return send({catalogRetired:true});
      }
      if(body.action==='cleanup'){
        if(state.customer)await ownCustomer();
        if(state.scheduleVariant==='anniversary_paid_bridge'&&state.schedule){
          const schedule=await stripe.subscriptionSchedules.retrieve(state.schedule);check(schedule.livemode===false&&id(schedule.customer)===state.customer,'fixture_schedule_mismatch');
          const prices=[...new Set(schedule.phases.flatMap(p=>(p.add_invoice_items||[]).map(i=>id(i.price))))];
          for(const priceId of prices){const price=await stripe.prices.retrieve(priceId);check(price.livemode===false&&id(price.product)===state.product&&price.type==='one_time'&&price.unit_amount===PRICES[state.target].amount,'fixture_bridge_price_mismatch');if(price.active)await stripe.prices.update(price.id,{active:false});}
        }
        if(state.portalConfiguration){const c=await stripe.billingPortal.configurations.retrieve(state.portalConfiguration);check(c.livemode===false&&c.metadata?.acceptance_run===config.runId,'fixture_portal_mismatch');await stripe.billingPortal.configurations.update(c.id,{active:false});}
        if(state.clock){const c=await stripe.testHelpers.testClocks.retrieve(state.clock);check(c.name===`${config.runId}:${state.scenario}`,'fixture_clock_mismatch');await stripe.testHelpers.testClocks.del(c.id);}
        else if(state.customer){if(state.subscription)await ownSubscription();await stripe.customers.del(state.customer);}
        return send({cleaned:true});
      }
      await ownCustomer();
      if(body.action==='checkout-complete'){
        check(state.checkout,'checkout_required');
        if(state.consentOnly){
          check(state.checkoutMode==='reuse_consent'&&state.priorPayment,'verified_prior_payment_required');
          const prior=await stripe.paymentIntents.retrieve(state.priorPayment.paymentIntent,{expand:['latest_charge']});
          check(prior.livemode===false&&id(prior.customer)===state.customer&&prior.status==='succeeded'&&prior.amount_received===10000&&prior.latest_charge?.paid&&prior.latest_charge?.captured&&prior.latest_charge.created===state.paidAt,'prior_payment_proof');
          const session=await stripe.checkout.sessions.retrieve(state.checkout);
          check(session.livemode===false&&session.mode==='setup'&&session.status==='complete'&&session.payment_status==='no_payment_required'&&session.consent?.terms_of_service==='accepted'&&id(session.customer)===state.customer&&!session.payment_intent,'setup_checkout_consent_proof');
          const intent=await stripe.setupIntents.retrieve(id(session.setup_intent));
          check(intent.livemode===false&&id(intent.customer)===state.customer&&intent.status==='succeeded'&&intent.usage==='off_session','setup_intent_proof');
          state.method=id(intent.payment_method);const method=await stripe.paymentMethods.retrieve(state.method);check(method.livemode===false&&id(method.customer)===state.customer,'saved_method_proof');
          const sub=await createSubscription();return send({priorPayment:state.priorPayment,checkout:{id:session.id,mode:session.mode,status:session.status,paymentStatus:session.payment_status,consent:session.consent,amount:0,setupIntent:intent.id},subscription:summary(sub)});
        }
        const amount=state.kind==='restart'?PRICES[state.source].amount:10000;
        const s=await stripe.checkout.sessions.retrieve(state.checkout);
        check(s.livemode===false&&s.status==='complete'&&s.payment_status==='paid'&&s.amount_total===amount&&s.currency==='usd'&&s.consent?.terms_of_service==='accepted'&&id(s.customer)===state.customer,'checkout_not_settled_with_consent');
        const pi=await stripe.paymentIntents.retrieve(id(s.payment_intent),{expand:['latest_charge']});
        check(pi.livemode===false&&id(pi.customer)===state.customer&&pi.status==='succeeded'&&pi.amount_received===amount&&pi.setup_future_usage==='off_session'&&pi.latest_charge?.paid&&pi.latest_charge?.captured,'checkout_payment_proof');
        state.method=id(pi.payment_method);state.paidAt=pi.latest_charge.created;
        const pm=await stripe.paymentMethods.retrieve(state.method);check(pm.livemode===false&&id(pm.customer)===state.customer,'saved_method_proof');
        if(state.checkoutMode==='reuse_consent'){
          state.priorPayment={checkout:s.id,paymentIntent:pi.id,amount:pi.amount_received};
          const params=checkoutParams(true),session=await stripe.checkout.sessions.create(params,idem('reuse-consent-checkout'));
          check(session.livemode===false,'fixture_mode_mismatch');state.checkout=session.id;state.consentOnly=true;
          return send({priorPayment:state.priorPayment,checkoutUrl:session.url,checkoutId:session.id,mode:'setup',amount:0,terms:params.custom_text.submit.message});
        }
        const sub=await createSubscription();
        return send({checkout:{id:s.id,status:s.status,paymentStatus:s.payment_status,consent:s.consent,amount:s.amount_total,paymentIntent:pi.id},subscription:summary(sub)});
      }
      const sub=await ownSubscription();
      if(body.action==='schedule'){
        check(state.target!==undefined,'schedule_target_required');
        const inv=sub.latest_invoice?await stripe.invoices.retrieve(id(sub.latest_invoice)):null;
        if(state.scheduleWhen==='included')check(sub.status==='trialing'&&sub.trial_end===boundary(state.paidAt,1)&&sub.items.data[0].current_period_end===sub.trial_end&&inv?.status==='paid'&&inv.total===0,'included_source_term_required');
        else if(state.scheduleWhen==='past_due')check(sub.status==='past_due'&&inv?.status==='open'&&inv.total===PRICES[state.source].amount&&sub.items.data[0].current_period_start>=boundary(state.paidAt,1),'past_due_source_term_required');
        else check(inv?.status==='paid'&&inv.total===PRICES[state.source].amount&&sub.items.data[0].current_period_start>=boundary(state.paidAt,1),'paid_source_term_required');
        const schedule=await stripe.subscriptionSchedules.create({from_subscription:sub.id},idem('schedule'));state.schedule=schedule.id;
        const phase=schedule.phases[0],end=sub.items.data[0].current_period_end;
        const current={start_date:phase.start_date,end_date:end,items:[{price:state.prices[state.source],quantity:1}],proration_behavior:'none',metadata:phase.metadata||{}};
        if(phase.trial_end&&phase.trial_end<=end)current.trial_end=phase.trial_end;
        if(phase.default_payment_method)current.default_payment_method=id(phase.default_payment_method);
        if(phase.collection_method)current.collection_method=phase.collection_method;
        const changeId=`acceptance_change_${config.runId}_${state.scenario}`;
        const future={start_date:end,items:[{price:state.prices[state.target],quantity:1}],duration:{interval:PRICES[state.target].interval,interval_count:1},proration_behavior:'none',metadata:state.metadataContract==='source_keys'?{...sub.metadata,plan_code:PRICES[state.target].code,billing_interval:PRICES[state.target].interval,paid_billing_change_id:changeId}:metadata};
        if(state.scheduleVariant?.startsWith('anniversary_')){
          const start=new Date(end*1000),original=new Date(state.paidAt*1000),months=PRICES[state.target].interval==='year'?12:1;
          const days=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+months+1,0)).getUTCDate();
          future.end_date=Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+months,Math.min(original.getUTCDate(),days),start.getUTCHours(),start.getUTCMinutes(),start.getUTCSeconds())/1000;
          delete future.duration;
          if(state.scheduleVariant==='anniversary_phase_start')future.billing_cycle_anchor='phase_start';
          if(state.scheduleVariant==='anniversary_automatic')future.billing_cycle_anchor='automatic';
          if(state.scheduleVariant==='anniversary_paid_bridge'){
            future.trial_end=future.end_date;
            future.add_invoice_items=[{price_data:{currency:'usd',product:state.product,unit_amount:PRICES[state.target].amount},quantity:1,metadata:state.metadataContract==='source_keys'?{...metadata,app:'everycall',item_type:'paid_base_bridge',paid_billing_change_id:changeId,paid_purchase_id:sub.metadata.paid_purchase_id}:{...metadata,item_type:'synthetic_paid_base_bridge'}}];
          }
        }
        const updateParams={end_behavior:'release',proration_behavior:'none',phases:[current,future]};
        if(state.scheduleMethodStrategy==='clear_settings'){delete current.default_payment_method;updateParams.default_settings={default_payment_method:''};}
        const updated=await stripe.subscriptionSchedules.update(schedule.id,updateParams,idem('schedule-update'));
        check(updated.phases.some(p=>p.start_date===end&&id(p.items[0].price)===state.prices[state.target]),'schedule_target_boundary');
        state.scheduled=true;return send({scheduleId:schedule.id,effectiveAt:iso(end),sourceSubscription:summary(sub),phases:updated.phases.map(p=>({start:iso(p.start_date),end:iso(p.end_date),billingCycleAnchor:p.billing_cycle_anchor,prorationBehavior:p.proration_behavior,trialEnd:p.trial_end?iso(p.trial_end):null,addedInvoiceItems:(p.add_invoice_items||[]).map(i=>({price:id(i.price),quantity:i.quantity}))}))});
      }
      if(body.action==='bridge-reschedule'){
        check(state.scheduleVariant==='anniversary_paid_bridge'&&state.target===0&&state.schedule&&sub.status==='trialing'&&id(sub.schedule)===state.schedule,'active_starter_bridge_required');
        const schedule=await stripe.subscriptionSchedules.retrieve(state.schedule);check(schedule.livemode===false&&id(schedule.customer)===state.customer&&schedule.status==='active','fixture_schedule_mismatch');
        const phase=schedule.phases.find(p=>p.start_date===sub.items.data[0].current_period_start&&p.end_date===sub.items.data[0].current_period_end);check(phase&&phase.trial_end===phase.end_date&&phase.add_invoice_items?.length===1,'bridge_phase_missing');
        const added=phase.add_invoice_items[0],price=await stripe.prices.retrieve(id(added.price));check(price.livemode===false&&id(price.product)===state.product&&price.type==='one_time'&&price.unit_amount===PRICES[0].amount&&added.quantity===1,'fixture_bridge_price_mismatch');
        const before=(await stripe.invoices.list({customer:state.customer,limit:100})).data;check(before.some(i=>i.created===phase.start_date&&i.status==='paid'&&i.total===PRICES[0].amount),'paid_bridge_required');
        const paid=before.find(i=>i.created===phase.start_date&&i.status==='paid'&&i.total===PRICES[0].amount);
        const lines=await stripe.invoices.listLineItems(paid.id,{limit:100});check(!lines.has_more&&lines.data.filter(l=>l.amount>0).length===1&&lines.data.some(l=>l.amount===PRICES[0].amount&&id(l.pricing?.price_details?.price)===price.id&&l.parent?.invoice_item_details?.subscription===sub.id&&l.parent.invoice_item_details.proration===false&&l.period.start===phase.start_date&&l.period.end===phase.end_date&&l.metadata?.acceptance_run===config.runId&&l.metadata?.item_type===(state.metadataContract==='source_keys'?'paid_base_bridge':'synthetic_paid_base_bridge')&&(state.metadataContract!=='source_keys'||l.metadata?.paid_billing_change_id===`acceptance_change_${config.runId}_${state.scenario}`)),'paid_bridge_line_required');
        const current={start_date:phase.start_date,end_date:phase.end_date,trial_end:phase.trial_end,items:[{price:state.prices[0],quantity:1}],add_invoice_items:[{price:price.id,quantity:1,metadata:added.metadata||{}}],metadata:phase.metadata||{},proration_behavior:'none'};
        if(state.rescheduleMode==='omit_billed_item')delete current.add_invoice_items;
        if(phase.default_payment_method)current.default_payment_method=id(phase.default_payment_method);if(phase.collection_method)current.collection_method=phase.collection_method;
        const start=new Date(phase.end_date*1000),original=new Date(state.paidAt*1000),days=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+2,0)).getUTCDate();
        const end=Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,Math.min(original.getUTCDate(),days),start.getUTCHours(),start.getUTCMinutes(),start.getUTCSeconds())/1000;
        const future={start_date:phase.end_date,end_date:end,items:[{price:state.prices[2],quantity:1}],metadata:state.metadataContract==='source_keys'?{...sub.metadata,plan_code:PRICES[2].code,billing_interval:'month',paid_billing_change_id:`acceptance_reschedule_${config.runId}_${state.scenario}`}:metadata,proration_behavior:'none'};
        const updateParams={end_behavior:'release',proration_behavior:'none',phases:[current,future]};
        if(state.scheduleMethodStrategy==='clear_settings'){delete current.default_payment_method;updateParams.default_settings={default_payment_method:''};}
        await stripe.subscriptionSchedules.update(schedule.id,updateParams,idem('bridge-reschedule-growth'));
        const after=(await stripe.invoices.list({customer:state.customer,limit:100})).data;
        check(after.length===before.length&&after.every(i=>before.some(b=>b.id===i.id&&b.total===i.total)),'bridge_reschedule_created_invoice');state.rescheduledTarget=2;
        return send({subscription:summary(await ownSubscription()),nextPrice:state.prices[2],nextAmount:PRICES[2].amount,nextStart:iso(phase.end_date),nextEnd:iso(end),invoices:after.map(invoiceSummary)});
      }
      if(body.action==='portal'){
        const portalConfig=await stripe.billingPortal.configurations.create({business_profile:{headline:'EveryCall synthetic acceptance'},features:{payment_method_update:{enabled:true},invoice_history:{enabled:true}},metadata:{acceptance_run:config.runId}},idem('portal-config'));
        check(portalConfig.livemode===false,'fixture_mode_mismatch');state.portalConfiguration=portalConfig.id;
        const session=await stripe.billingPortal.sessions.create({customer:state.customer,configuration:portalConfig.id,return_url:'https://example.invalid/everycall-acceptance-portal'},idem('portal-session'));
        return send({portalUrl:session.url});
      }
      if(body.action==='canonical-base'){
        check(state.target===undefined&&!state.recovery&&!state.schedule&&!sub.schedule&&sub.status==='active','unchanged_active_fixture_required');
        const invoices=await stripe.invoices.list({customer:state.customer,subscription:sub.id,limit:100});check(!invoices.has_more,'fixture_invoice_inventory_incomplete');
        check(invoices.data.every(i=>i.livemode===false&&id(i.customer)===state.customer&&(id(i.parent?.subscription_details?.subscription)||id(i.subscription))===sub.id),'fixture_invoice_mismatch');
        const line=l=>({id:l.id,amount:l.amount,currency:l.currency,description:l.description,quantity:l.quantity,period:l.period,parent:l.parent,pricing:l.pricing,metadata:l.metadata,proration:l.proration});
        return send({subscription:{id:sub.id,customer:id(sub.customer),livemode:sub.livemode,status:sub.status,metadata:sub.metadata,items:{object:sub.items.object,has_more:sub.items.has_more,data:sub.items.data.map(i=>({id:i.id,quantity:i.quantity,current_period_start:i.current_period_start,current_period_end:i.current_period_end,price:{id:id(i.price),livemode:i.price.livemode,currency:i.price.currency,unit_amount:i.price.unit_amount,product:id(i.price.product),recurring:i.price.recurring}}))},cancel_at_period_end:sub.cancel_at_period_end,cancel_at:sub.cancel_at,canceled_at:sub.canceled_at,ended_at:sub.ended_at,schedule:id(sub.schedule)||null,trial_end:sub.trial_end,billing_mode:sub.billing_mode,billing_cycle_anchor:sub.billing_cycle_anchor,billing_cycle_anchor_config:sub.billing_cycle_anchor_config},invoiceListRequest:{customer:state.customer,subscription:sub.id,limit:100},invoiceList:{object:invoices.object,has_more:invoices.has_more,data:invoices.data.map(i=>({id:i.id,customer:id(i.customer),livemode:i.livemode,status:i.status,currency:i.currency,total:i.total,amount_paid:i.amount_paid,amount_remaining:i.amount_remaining,parent:i.parent,subscription:id(i.subscription),billing_reason:i.billing_reason,created:i.created,lines:i.lines?{object:i.lines.object,has_more:i.lines.has_more,data:i.lines.data.map(line)}:null}))}});
      }
      if(body.action==='inspect-lines'){
        let bridge;
        if(body.invoiceKind==='bridge'){
          check(state.scheduleVariant==='anniversary_paid_bridge'&&state.schedule,'bridge_schedule_required');
          const schedule=await stripe.subscriptionSchedules.retrieve(state.schedule);check(schedule.livemode===false&&id(schedule.customer)===state.customer,'fixture_schedule_mismatch');
          const phase=schedule.phases.find(p=>(p.add_invoice_items||[]).length);check(phase,'bridge_phase_missing');
          const added=[];for(const item of phase.add_invoice_items){const price=await stripe.prices.retrieve(id(item.price));check(price.livemode===false&&id(price.product)===state.product&&price.type==='one_time'&&price.unit_amount===PRICES[state.target].amount,'fixture_bridge_price_mismatch');added.push({price:price.id,product:id(price.product),type:price.type,recurring:price.recurring,unitAmount:price.unit_amount,currency:price.currency,metadata:price.metadata,active:price.active,quantity:item.quantity,metadataOnItem:item.metadata});}
          bridge={schedule:schedule.id,livemode:schedule.livemode,customer:id(schedule.customer),subscription:id(schedule.subscription)||null,releasedSubscription:id(schedule.released_subscription)||null,start:phase.start_date,end:phase.end_date,trialEnd:phase.trial_end,metadata:phase.metadata,items:phase.items.map(i=>({price:id(i.price),quantity:i.quantity})),added};
        }
        const invoices=await stripe.invoices.list({customer:state.customer,limit:100});check(!invoices.has_more,'fixture_invoice_inventory_incomplete');
        const invoice=bridge?invoices.data.find(i=>i.created===bridge.start&&i.total===PRICES[state.target].amount):invoices.data[0];
        check(invoice&&invoice.livemode===false&&id(invoice.customer)===state.customer,'fixture_invoice_mismatch');
        const lines=await stripe.invoices.listLineItems(invoice.id,{limit:100});check(!lines.has_more,'fixture_invoice_lines_incomplete');
        return send({invoice:invoiceSummary(invoice),...(bridge?{bridge}:{}),lines:lines.data.map(l=>({id:l.id,amount:l.amount,currency:l.currency,description:l.description,period:l.period,quantity:l.quantity,metadata:l.metadata,parentType:l.parent?.type,invoiceItemDetails:l.parent?.invoice_item_details,subscriptionItemDetails:l.parent?.subscription_item_details,priceDetails:l.pricing?.price_details,price:id(l.pricing?.price_details?.price)||id(l.price)}))});
      }
      if(body.action==='advance'){
        check(state.clock&&state.step<14,'advance_limit');
        const clock=await stripe.testHelpers.testClocks.retrieve(state.clock);
        check(clock.name===`${config.runId}:${state.scenario}`,'fixture_clock_mismatch');
        check(clock.status==='ready','clock_not_ready');
        const target=state.next+7200;
        check(target>clock.frozen_time,'clock_already_advanced');
        await stripe.testHelpers.testClocks.advance(state.clock,{frozen_time:target},idem(`advance-${state.step}`));
        return send({advancingTo:iso(target)});
      }
      if(body.action==='advance-month'||body.action==='settle'){
        check(state.clock,'clock_required');
        if(body.action==='advance-month')check(Number.isInteger(body.month)&&body.month>=1&&body.month<=14,'invalid_advance_month');
        const clock=await stripe.testHelpers.testClocks.retrieve(state.clock);
        check(clock.name===`${config.runId}:${state.scenario}`&&clock.status==='ready','clock_not_ready');
        const target=body.action==='settle'?state.usageSettleAt:boundary(state.paidAt,body.month)+7200;
        check(Number.isInteger(target)&&target>clock.frozen_time,'clock_already_advanced');
        await stripe.testHelpers.testClocks.advance(state.clock,{frozen_time:target},idem(body.action==='settle'?`settle-${state.usage}`:`month-${body.month}`));
        return send({advancingTo:iso(target)});
      }
      if(body.action==='inspect'){
        if(state.clock){const c=await stripe.testHelpers.testClocks.retrieve(state.clock);if(c.status!=='ready')return send({ready:false,clockStatus:c.status});}
        const invoices=(await stripe.invoices.list({customer:state.customer,limit:100})).data;
        check(invoices.every(x=>x.livemode===false&&id(x.customer)===state.customer),'fixture_invoice_mismatch');
        const item=sub.items.data[0],expected=state.target??state.source;
        if(state.clock){
          const clock=await stripe.testHelpers.testClocks.retrieve(state.clock);
          if(clock.frozen_time>state.next){state.step++;state.next=item.current_period_end;}
        }
        const customer=await ownCustomer();
        let schedulePaymentMethods;
        if(state.schedule){const schedule=await stripe.subscriptionSchedules.retrieve(state.schedule);check(schedule.livemode===false&&id(schedule.customer)===state.customer,'fixture_schedule_mismatch');schedulePaymentMethods={status:schedule.status,defaultPaymentMethod:id(schedule.default_settings?.default_payment_method)||null,defaultSource:id(schedule.default_settings?.default_source)||null,phases:schedule.phases.map(p=>({start:iso(p.start_date),end:iso(p.end_date),defaultPaymentMethod:id(p.default_payment_method)||null}))};}
        return send({ready:true,...(schedulePaymentMethods?{schedulePaymentMethods}:{}),subscription:summary(sub),customerDefaultPaymentMethod:id(customer.invoice_settings?.default_payment_method),invoices:invoices.map(invoiceSummary),expectedPrice:state.prices[expected],expectedBaseAmount:PRICES[expected].amount,step:state.step});
      }
      if(body.action==='usage'){
        check(Number.isInteger(body.month)&&body.month>=0&&body.month<=12,'invalid_usage_month');
        if(state.clock){const clock=await stripe.testHelpers.testClocks.retrieve(state.clock);check(clock.status==='ready'&&clock.frozen_time>=boundary(state.paidAt,body.month+1),'usage_window_not_closed');state.usageSettleAt=clock.frozen_time+7200;}
        const planIndex=state.prices.indexOf(id(sub.items.data[0].price));check(planIndex>=0,'fixture_usage_price_mismatch');
        const method=id(sub.default_payment_method)||id((await ownCustomer()).invoice_settings?.default_payment_method),amount=3*PRICES[planIndex].overage;
        check(method,'usage_method_missing');
        let invoice=await stripe.invoices.create({customer:state.customer,currency:'usd',collection_method:'charge_automatically',default_payment_method:method,auto_advance:false,pending_invoice_items_behavior:'exclude',metadata:{...metadata,item_type:'call_overage'}},idem(`usage-${body.month}`));
        if(invoice.status==='draft'){
          await stripe.invoiceItems.create({customer:state.customer,invoice:invoice.id,amount,currency:'usd',description:'3 synthetic call overages',metadata:{...metadata,item_type:'call_overage'}},idem(`usage-item-${body.month}`));
          invoice=await stripe.invoices.finalizeInvoice(invoice.id,{auto_advance:true},idem(`usage-finalize-${body.month}`));
        }
        state.usage=invoice.id;
        check(invoice.livemode===false&&invoice.total===amount,'usage_invoice_contract');
        return send({invoice:invoiceSummary(invoice),hostedInvoiceUrl:invoice.hosted_invoice_url});
      }
      if(body.action==='recover'){
        check(state.recovery,'recovery_fixture_required');
        await stripe.subscriptions.update(sub.id,{default_payment_method:state.method},idem('recover-method'));
        const invoices=(await stripe.invoices.list({customer:state.customer,status:'open',limit:100})).data;
        const paid=[];
        for(const invoice of invoices){check(invoice.livemode===false&&id(invoice.customer)===state.customer,'fixture_invoice_mismatch');paid.push(invoiceSummary(await stripe.invoices.pay(invoice.id,{payment_method:state.method},idem(`recover-${invoice.id}`))));}
        const after=await ownSubscription();
        check(after.items.data[0].current_period_start===sub.items.data[0].current_period_start&&after.items.data[0].current_period_end===sub.items.data[0].current_period_end,'recovery_moved_anchor');
        return send({subscription:summary(after),paid});
      }
      if(body.action==='cancel'){
        check(typeof body.cancel==='boolean','invalid_cancel');
        if(sub.schedule){const schedule=await stripe.subscriptionSchedules.retrieve(id(sub.schedule));check(schedule.subscription===sub.id,'fixture_schedule_mismatch');if(schedule.status==='active')await stripe.subscriptionSchedules.release(schedule.id,{preserve_cancel_date:true},idem('release-for-cancel'));}
        const updated=await stripe.subscriptions.update(sub.id,{cancel_at_period_end:body.cancel},idem(`cancel-${body.cancel}`));
        check(updated.cancel_at_period_end===body.cancel&&updated.items.data[0].current_period_end===sub.items.data[0].current_period_end,'cancel_moved_term');
        return send({subscription:summary(updated)});
      }
    }catch(error){
      // Never return/log raw SDK errors, credentials, client secrets, or request bodies.
      return res.status(422).json({error:safe(error.acceptanceCode)||'provider_acceptance_failed',providerCode:safe(error.code),providerType:safe(error.type),providerParam:safe(error.param),requestId:safe(error.requestId),...(state?{continuation:seal(state)}:{})});
    }
  };
}
