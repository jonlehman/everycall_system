// Offline only: execute the exact reviewed probe with a Stripe double and compare
// its emitted requests to frozen requests captured from the application fixtures.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const opts={};for(let i=2;i<process.argv.length;i+=2){assert.ok(process.argv[i].startsWith('--')&&process.argv[i+1]);opts[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(opts.probe&&opts.captures&&opts.out,'Required: --probe FILE --captures DIR --out FILE; optional --source-root DIR');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const {createAcceptanceHandler,PRICES,API_VERSION}=await import(pathToFileURL(path.resolve(opts.probe)));
const prices=PRICES.map(p=>`price_${p.code}_${p.interval}`),run='offline_contract_capture',scenario='financial_request',token='b'.repeat(64),key='sk_test_offlinecapture';
const config={runId:run,tokenSha256:hash(token),expectedAccountId:'acct_fixture',expiresAt:Date.now()+600000};
const owned={acceptance_run:run,acceptance_scenario:scenario,app:'everycall_acceptance'};
function seal(state){const payload=Buffer.from(JSON.stringify(state)).toString('base64url');const mac=crypto.createHmac('sha256',key).update(`everycall-acceptance-v1:${run}:${payload}`).digest('base64url');return `${payload}.${mac}`;}
function normalize(value,at='$',omitted=[]){if(Array.isArray(value))return value.map((x,i)=>normalize(x,`${at}[${i}]`,omitted));if(value&&typeof value==='object'){const out={};for(const name of Object.keys(value).sort()){if(name==='metadata'){omitted.push({path:`${at}.metadata`,sha256:hash(JSON.stringify(value[name]))});continue;}out[name]=normalize(value[name],`${at}.${name}`,omitted);}return out;}return value;}
function selector(code,interval){const n=PRICES.findIndex(p=>p.code===code&&p.interval===interval);assert.ok(n>=0);return n;}
async function captureUsage(row){
 assert.ok(['subscription','customer'].includes(row.methodSource));assert.equal(row.frozenAmount,3*PRICES[0].overage);assert.notEqual(row.frozenAmount,3*row.currentRate);
 const usageScenario=`financial_usage_${row.methodSource}`,metadata={acceptance_run:run,acceptance_scenario:usageScenario,app:'everycall_acceptance'};
 const state={run,scenario:usageScenario,source:0,customer:row.customer,subscription:row.subscription,prices,paidAt:Math.floor(new Date(row.periodStart).getTime()/1000)};
 const calls=[],record=(action,args)=>calls.push({action,args:structuredClone(args)}),created=Math.floor(new Date(row.periodEnd).getTime()/1000);
 class UsageStripeDouble{constructor(){
  this.accounts={retrieve:async()=>({id:config.expectedAccountId})};this.webhookEndpoints={list:async()=>({has_more:false,data:[]})};
  this.customers={retrieve:async()=>({id:state.customer,livemode:false,metadata,invoice_settings:{default_payment_method:row.methodSource==='customer'?row.paymentMethod:'pm_unused_customer'}})};
  this.subscriptions={retrieve:async()=>({id:state.subscription,livemode:false,customer:state.customer,metadata,default_payment_method:row.methodSource==='subscription'?row.paymentMethod:null,items:{data:[{price:prices[0]}]}})};
  this.invoices={create:async(...args)=>{record('invoices.create',args);return{id:row.invoiceId,livemode:false,status:'draft'};},finalizeInvoice:async(...args)=>{record('invoices.finalizeInvoice',args);return{id:row.invoiceId,livemode:false,status:'open',currency:'usd',customer:state.customer,total:row.frozenAmount,amount_paid:0,amount_due:row.frozenAmount,amount_remaining:row.frozenAmount,created,default_payment_method:row.paymentMethod};}};
  this.invoiceItems={create:async(...args)=>{record('invoiceItems.create',args);return{id:'ii_fixture'};}};
 }}
 const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await createAcceptanceHandler(config,{StripeClient:UsageStripeDouble,env:{SALES_STRIPE_TEST_SECRET_KEY:key}})({method:'POST',headers:{authorization:`Bearer ${token}`},body:{action:'usage',month:0,continuation:seal(state)}},response);
 assert.equal(response.code,200,`Usage fixture failed: ${response.body?.error}`);assert.equal(calls.length,3);
 const requestShape=(call,probe)=>{const args=structuredClone(call.action==='invoices.finalizeInvoice'?call.args.slice(0,2):call.args.slice(0,1));if(probe&&call.action==='invoiceItems.create')args[0].description=args[0].description.replace(' synthetic ',' ');return normalize({action:call.action,args});};
 const sourceShape=row.calls.map(c=>requestShape(c,false)),probeShape=calls.map(c=>requestShape(c,true));assert.deepEqual(probeShape,sourceShape,`Usage mechanism/PM/amount/invoice binding differs: ${row.methodSource}`);
 return {kind:'usage',methodSource:row.methodSource,financialRequestSha256:hash(JSON.stringify(sourceShape)),frozenHistoricalAmount:row.frozenAmount,nativeCurrentRate:row.currentRate,periodStart:row.periodStart,periodEnd:row.periodEnd,sourceIdempotencyOptions:row.calls.map(c=>c.args.at(-1)),probeIdempotencyOptions:calls.map(c=>c.args.at(-1)),scope:'Exact invoice mechanism, PM selection, monetary payload and invoice binding. Fixed Starter probe fixture produces900; native source fixture independently proves historical900 despite current Pro175 rate. Probe current-price logic is not historical-rating proof. Only synthetic metadata, usage adjective and distinct test idempotency namespaces differ.'};
}
async function capture(row,kind){
 if(kind==='usage')return captureUsage(row);
 const source=kind==='customer_default'?0:selector(row.plan||row.plan_code||row.sourcePlan,row.interval||row.billing_interval||row.sourceInterval),target=kind==='schedule'?selector(row.targetPlan,row.targetInterval):undefined;
 const expected=row.request,phase=['schedule','reschedule'].includes(kind)?structuredClone(expected.phases[0]):null,paidAt=Math.floor(new Date(row.paidAt||row.usageAnchorAt||'2028-01-31T12:00:00Z').getTime()/1000);
 const state={run,scenario,source,target,paidAt,customer:row.customer||expected.customer||'cus_fixture',subscription:'sub_fixture',checkout:'cs_fixture',prices,method:expected.invoice_settings?.default_payment_method||expected.default_payment_method||'pm_fixture',product:expected.phases?.[1]?.add_invoice_items?.[0]?.price_data?.product||'prod_fixture',kind:row.kind,enrollment:'trial_anchor',methodStrategy:'subscription_save',scheduleVariant:source%2&&target%2===0?'anniversary_paid_bridge':'anniversary_end',...(phase?.trial_end?{scheduleWhen:'included'}:{})};
 if(kind==='reschedule'){state.source=1;state.target=0;state.schedule='sub_sched_fixture';state.scheduleVariant='anniversary_paid_bridge';state.rescheduleMode='omit_billed_item';phase.add_invoice_items=[{price:'price_bridge',quantity:1,metadata:owned}];}
 if(kind==='checkout'){state.metadataContract='source_keys';if(expected.mode==='setup')state.checkoutMode='reuse_consent';}
 if(opts['method-strategy'])state.methodStrategy=opts['method-strategy'];
 if(kind==='customer_default')state.methodStrategy='customer_seed_and_save';
 if(opts['schedule-method-strategy'])state.scheduleMethodStrategy=opts['schedule-method-strategy'];
 const amount=state.kind==='restart'?PRICES[source].amount:10000;
 let emitted,providerOptions;
 const stop=(params,options)=>{emitted=structuredClone(params);providerOptions=options;throw Error('offline_capture_complete');};
 class StripeDouble{
  constructor(){
   this.accounts={retrieve:async()=>({id:config.expectedAccountId})};this.webhookEndpoints={list:async()=>({has_more:false,data:[]})};
   this.customers={retrieve:async()=>({id:state.customer,livemode:false,metadata:owned}),create:async()=>({id:state.customer,livemode:false,metadata:owned}),update:async(customer,params,options)=>{assert.equal(customer,state.customer);if(kind==='customer_default')return stop(params,options);return{id:state.customer,livemode:false,metadata:owned};}};
   this.products={create:async()=>({id:state.product,livemode:false})};
   this.prices={create:async p=>({id:prices[PRICES.findIndex(x=>x.amount===p.unit_amount&&x.interval===p.recurring.interval)],livemode:false,unit_amount:p.unit_amount,recurring:p.recurring}),retrieve:async()=>({id:'price_bridge',livemode:false,product:state.product,type:'one_time',unit_amount:7450})};
   this.paymentMethods={retrieve:async()=>({id:state.method,livemode:false,customer:state.customer})};
   this.checkout={sessions:{create:async params=>stop(params),retrieve:async()=>({id:state.checkout,livemode:false,status:'complete',payment_status:'paid',amount_total:amount,currency:'usd',consent:{terms_of_service:'accepted'},customer:state.customer,payment_intent:'pi_fixture'})}};
   this.paymentIntents={retrieve:async()=>({id:'pi_fixture',livemode:false,customer:state.customer,status:'succeeded',amount_received:amount,setup_future_usage:'off_session',payment_method:state.method,latest_charge:{paid:true,captured:true,created:paidAt}})};
   this.subscriptions={create:async params=>stop(params),retrieve:async()=>({id:state.subscription,livemode:false,customer:state.customer,metadata:owned,status:phase?.trial_end?'trialing':'active',schedule:state.schedule,trial_end:phase?.trial_end,latest_invoice:'in_fixture',items:{data:[{price:kind==='reschedule'?prices[0]:prices[source],quantity:1,current_period_start:phase.start_date,current_period_end:phase.end_date}]}})};
   this.invoices={retrieve:async()=>({status:'paid',total:phase?.trial_end?0:PRICES[source].amount}),list:async()=>({data:[{id:'in_fixture',created:phase.start_date,status:'paid',total:7450}]}),listLineItems:async()=>({has_more:false,data:[{amount:7450,pricing:{price_details:{price:'price_bridge'}},parent:{invoice_item_details:{subscription:state.subscription,proration:false}},period:{start:phase.start_date,end:phase.end_date},metadata:{acceptance_run:run,item_type:'synthetic_paid_base_bridge'}}]})};
   this.subscriptionSchedules={retrieve:async()=>({id:state.schedule,livemode:false,customer:state.customer,status:'active',phases:[structuredClone(phase)]}),create:async()=>({id:'sub_sched_fixture',phases:[structuredClone(phase)]}),update:async(id,params)=>stop(params)};
  }
 }
 const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await createAcceptanceHandler(config,{StripeClient:StripeDouble,env:{SALES_STRIPE_TEST_SECRET_KEY:key}})({method:'POST',headers:{authorization:`Bearer ${token}`},body:kind==='checkout'&&expected.mode==='payment'?{action:'checkout',source,...(row.kind==='restart'?{kind:'restart'}:{}),metadataContract:'source_keys'}:{action:['subscription','checkout','customer_default'].includes(kind)?'checkout-complete':kind==='reschedule'?'bridge-reschedule':'schedule',continuation:seal(state)}},response);
 assert.ok(emitted,`Probe did not emit ${kind}: ${response.body?.error}`);
 const expectedCopy=structuredClone(expected);
 if(kind==='checkout'){for(const request of [expectedCopy,emitted]){assert.equal(request.client_reference_id,request.metadata.paid_purchase_id,'Checkout purchase ownership binding differs');request.client_reference_id='<bound-purchase-id>';for(const field of ['success_url','cancel_url']){const u=new URL(request[field]);assert.equal(u.protocol,'https:');request[field]=`https://fixture.invalid${u.pathname}${u.search}${u.hash}`;}}}
 const expectedMetadata=[],probeMetadata=[],normalizedSource=normalize(expectedCopy,'$',expectedMetadata),normalizedProbe=normalize(emitted,'$',probeMetadata);
 assert.deepEqual(normalizedProbe,normalizedSource,`${kind} financial request mismatch: ${row.plan||row.sourcePlan}/${row.interval||row.sourceInterval} → ${row.targetPlan||row.kind}/${row.targetInterval||row.paidAt}`);
 return {kind,...(kind==='customer_default'?{sourceCustomer:row.customer,sourceIdempotencyOptions:row.options,probeIdempotencyOptions:providerOptions,idempotencyComparison:'Distinct synthetic run/purchase namespaces; literal source frozen key retained, not equated to probe fixture key.'}:{}),plan:row.plan,interval:row.interval,purchaseKind:row.kind,paidAt:row.paidAt,sourcePlan:row.sourcePlan,sourceInterval:row.sourceInterval,targetPlan:row.targetPlan,targetInterval:row.targetInterval,usageAnchorAt:row.usageAnchorAt,financialRequestSha256:hash(JSON.stringify(normalizedSource)),sourceMetadata:expectedMetadata,probeMetadata};
}
const evidence=[],sourceCaptures=[],sourceVersions={};let sourceHashes;
const suites= [['subscription-create-36.json','subscription'],['schedule-update-36.json','schedule'],['schedule-update-included.json','schedule'],['schedule-update-reschedule.json','reschedule'],['checkout-create.json','checkout'],['customer-default-initialization.json','customer_default'],['usage-invoice-create-item-finalize.json','usage']];
for(const[file,kind]of opts.suite==='baseline'?suites.slice(0,3):suites){
 const data=JSON.parse(fs.readFileSync(path.join(opts.captures,file)));assert.equal(data.fixtureOnly,true);sourceHashes=data.sourceSha256;sourceCaptures.push({file,sourceSha256:sourceHashes});for(const[name,version]of Object.entries(sourceHashes)){sourceVersions[name]??=new Set();sourceVersions[name].add(version);}
 if(opts['source-root'])for(const[name,expectedHash]of Object.entries(sourceHashes)){assert.match(name,/^(?:lib\/)?[A-Za-z0-9]+\.js$/);assert.equal(hash(fs.readFileSync(path.join(opts['source-root'],name.includes('/')?name:`pages/api/_lib/${name}`))),expectedHash,`Stale source capture: ${name}`);}
 for(const row of data.requests)evidence.push(await capture(row,kind));
}
let scheduleDelta;
if(opts['baseline-captures']){
 const oldRows=JSON.parse(fs.readFileSync(path.join(opts['baseline-captures'],'schedule-update-36.json'))).requests;
 const newRows=JSON.parse(fs.readFileSync(path.join(opts.captures,'schedule-update-36.json'))).requests;
 const key=r=>[r.sourcePlan,r.sourceInterval,r.targetPlan,r.targetInterval].join(':');
 const changes=[];
 function differences(a,b,at='$'){
  if(JSON.stringify(a)===JSON.stringify(b))return [];
  if((a&&typeof a==='object')||(b&&typeof b==='object'))return [...new Set([...Object.keys(a||{}),...Object.keys(b||{})])].sort().flatMap(k=>differences(a?.[k],b?.[k],`${at}.${k}`));
  return [{path:at,before:a??null,after:b??null}];
 }
 assert.equal(oldRows.length,36);assert.equal(newRows.length,36);
 for(const oldRow of oldRows){const row=newRows.find(r=>key(r)===key(oldRow));assert.ok(row);const diffs=differences(normalize(oldRow.request),normalize(row.request));
  assert.deepEqual(diffs.map(d=>d.path).sort(),['$.default_settings.default_payment_method','$.phases.0.default_payment_method'].sort(),`Unexpected financial contract delta ${key(row)}`);
  assert.equal(diffs.find(d=>d.path==='$.default_settings.default_payment_method').after,'');
  assert.equal(diffs.find(d=>d.path==='$.phases.0.default_payment_method').after,null);
  changes.push({pair:key(row),differences:diffs});
 }
 scheduleDelta={compared:36,allOtherFinancialFieldsIdentical:true,changes};
}
const sourceHashVariants=Object.fromEntries(Object.entries(sourceVersions).map(([name,versions])=>[name,[...versions]]));
const sourceSnapshotConsistent=Object.values(sourceHashVariants).every(versions=>versions.length===1);
let sourceRevision;if(opts['source-root']){assert.equal(execFileSync('git',['-C',opts['source-root'],'status','--porcelain'],{encoding:'utf8'}).trim(),'','Final source worktree must be clean');sourceRevision=execFileSync('git',['-C',opts['source-root'],'rev-parse','HEAD'],{encoding:'utf8'}).trim();}
const result={offlineOnly:true,sourceFreshnessChecked:Boolean(opts['source-root']),sourceSnapshotConsistent,sourceRevision,sourceCaptures,sourceHashVariants,scheduleDelta,providerApiVersion:API_VERSION,probeSha256:hash(fs.readFileSync(opts.probe)),sourceSha256:sourceSnapshotConsistent?Object.fromEntries(Object.entries(sourceHashVariants).map(([name,versions])=>[name,versions[0]])):null,compared:evidence.length,match:true,normalization:'Only metadata objects are excluded from financial comparison. The probe uses synthetic run ownership; source purchase/operation ownership is validated by native application tests. Checkout client-reference IDs are normalized only after verifying their purchase metadata binding; only callback origins are normalized (paths and queries remain exact). Usage invoice/item/finalize calls normalize synthetic ownership metadata and only the synthetic adjective in the line description; financial amounts, payment-method selection, invoice binding and call order remain exact. The native usage fixture separately proves frozen historical rating despite the current plan rate. All other IDs, UTC timestamps, inherited current-phase fields, amounts, periods, consent-independent payment settings and billing flags are compared exactly.',requests:evidence};
fs.writeFileSync(opts.out,JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({offlineOnly:true,match:true,compared:evidence.length,probeSha256:result.probeSha256,out:opts.out}));
