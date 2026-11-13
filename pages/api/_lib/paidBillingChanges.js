import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {calendarMonthBoundary,monthlyUsageWindow} from '../../../lib/paidBillingCalendar.js';
import {STANDARD_BILLING_PLANS} from '../../../lib/standardBillingPlans.js';
import {verifyPaidBridgeSchedule,verifyPaidBridgeCanOmitItems} from './paidBaseInvoice.js';
import {getStripe} from './stripe.js';
import {intakeTransaction,intakeError,verifiedPrice} from './paidIntake.js';
const id=value=>typeof value==='string'?value:value?.id;

export async function changePaidSubscription(pool,tenantKey,actor,request,{stripe=getStripe()}={}) {
 const action=request.action;
 if(!['plan','cancel'].includes(action))throw intakeError('invalid_billing_action',400);
 if(action==='cancel'&&typeof request.cancelAtPeriodEnd!=='boolean')throw intakeError('cancellation_choice_required',400);
 const normalized=action==='plan'?{action,planCode:request.planCode,billingInterval:request.billingInterval}:{action,cancelAtPeriodEnd:request.cancelAtPeriodEnd};
 const priceId=action==='plan'?await verifiedPrice(pool,stripe,request.planCode,request.billingInterval):null;
 const op=await intakeTransaction(pool,async db=>{
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey]);
  const account=(await db.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  if(!account?.paid_purchase_id||!account.stripe_subscription_id||account.service_ended_at)throw intakeError('paid_subscription_required');
  let current=(await db.query("SELECT * FROM paid_billing_changes WHERE tenant_key=$1 AND status='pending' FOR UPDATE",[tenantKey])).rows[0];
  if(current&&!isDeepStrictEqual(current.request_json,normalized))throw intakeError('billing_change_reconciliation_pending');
  if(action==='plan'){
   const live=await stripe.subscriptions.retrieve(account.stripe_subscription_id),customer=await stripe.customers.retrieve(account.stripe_customer_id);
   if(live.livemode!==true||id(live.customer)!==account.stripe_customer_id||customer.deleted||customer.livemode!==true||customer.id!==account.stripe_customer_id)throw intakeError('billing_subscription_mismatch');
   const customerMethod=id(customer.invoice_settings?.default_payment_method),effective=id(live.default_payment_method)||customerMethod;
   if(!customerMethod||effective!==customerMethod)throw intakeError('confirm_payment_method_before_plan_change');
   const method=await stripe.paymentMethods.retrieve(customerMethod);
   if(method.livemode!==true||id(method.customer)!==account.stripe_customer_id)throw intakeError('billing_payment_method_mismatch');
  }
  // Refusing a known unpaid bridge is a read-only precondition, not an
  // uncertain provider attempt. Check before reserving an operation so owner
  // cancellation and a different request remain available while debt is owed.
  if(!current&&action==='plan'){
   const live=await stripe.subscriptions.retrieve(account.stripe_subscription_id);
   if(live.livemode!==true||id(live.customer)!==account.stripe_customer_id)throw intakeError('billing_subscription_mismatch');
   if(live.schedule){
    const scheduled=await stripe.subscriptionSchedules.retrieve(id(live.schedule)),item=live.items?.data?.[0];
    const phase=scheduled.phases?.find(p=>p.start_date<=(item?.current_period_start||live.current_period_start)&&p.end_date>=(item?.current_period_end||live.current_period_end||live.trial_end));
    if(phase?.add_invoice_items?.length)await verifyPaidBridgeCanOmitItems(db,account,scheduled,phase,stripe);
   }
  }
  if(!current)current=(await db.query(`INSERT INTO paid_billing_changes(operation_id,tenant_key,subscription_id,action,request_json)
   VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,[`change_${crypto.randomUUID()}`,tenantKey,account.stripe_subscription_id,action,JSON.stringify(normalized)])).rows[0];
  return current;
 });
 return intakeTransaction(pool,async db=>{
  const operation=(await db.query('SELECT * FROM paid_billing_changes WHERE operation_id=$1 FOR UPDATE',[op.operation_id])).rows[0];
  if(operation.status==='complete')return {effectiveAt:operation.provider_params?.effectiveAt||null};
  if(Date.now()-new Date(operation.started_at)>23*3600000)throw intakeError('billing_change_provider_reconciliation_required');
  const account=(await db.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1',[tenantKey])).rows[0];
  const subscription=await stripe.subscriptions.retrieve(operation.subscription_id);
  if(subscription.livemode!==true||id(subscription.customer)!==account.stripe_customer_id||!['active','trialing','past_due'].includes(subscription.status)||subscription.items?.data?.length!==1)throw intakeError('billing_subscription_mismatch');
  const item=subscription.items.data[0],start=item.current_period_start||subscription.current_period_start;
  const end=item.current_period_end||subscription.current_period_end||subscription.trial_end;
  if(!start||!end||end*1000<=Date.now())throw intakeError('billing_term_reconciliation_required');
  if(action==='cancel'){
   // A schedule can override subscription cancellation. Release the schedule first,
   // preserving the current term; its known identity makes a timeout read-reconcilable.
   if(subscription.schedule){
    const schedule=await stripe.subscriptionSchedules.retrieve(id(subscription.schedule));
    if(schedule.status==='active')await stripe.subscriptionSchedules.release(schedule.id,{preserve_cancel_date:true},{idempotencyKey:`${operation.operation_id}:release`});
   }
   const result=await stripe.subscriptions.update(subscription.id,{cancel_at_period_end:request.cancelAtPeriodEnd},{idempotencyKey:operation.operation_id});
   if(Boolean(result.cancel_at_period_end)!==request.cancelAtPeriodEnd)throw intakeError('billing_cancel_reconciliation_required');
   await db.query('UPDATE tenant_billing_accounts SET cancel_at_period_end=$2,pending_plan_code=NULL,pending_billing_interval=NULL,pending_plan_effective_at=NULL WHERE tenant_key=$1',[tenantKey,request.cancelAtPeriodEnd]);
  }else{
   if(operation.provider_params&&operation.provider_params.version!==3)throw intakeError('billing_change_contract_review_required');
   if(subscription.cancel_at_period_end)throw intakeError('remove_scheduled_cancellation_first');
   let schedule=subscription.schedule?await stripe.subscriptionSchedules.retrieve(id(subscription.schedule)):await stripe.subscriptionSchedules.create({from_subscription:subscription.id},{idempotencyKey:`${operation.operation_id}:schedule`});
   if(schedule.status!=='active'||id(schedule.subscription)!==subscription.id)throw intakeError('billing_schedule_mismatch');
   const phase=schedule.phases.find(p=>p.start_date<=start&&p.end_date>=end)||schedule.phases.find(p=>p.start_date<=Date.now()/1000&&p.end_date>Date.now()/1000);
   if(!phase||phase.items.length!==1||id(phase.items[0].price)!==id(item.price))throw intakeError('billing_schedule_phase_mismatch');
   // We own simple fixed-price subscriptions. Do not silently discard external
   // discounts/tax/extra-invoice settings when rebuilding a schedule.
   if(phase.discounts?.length||phase.default_tax_rates?.length||phase.items[0].tax_rates?.length||phase.items[0].discounts?.length)throw intakeError('billing_schedule_manual_review_required');
   if(phase.add_invoice_items?.length)await verifyPaidBridgeCanOmitItems(db,account,schedule,phase,stripe);
   const current={start_date:phase.start_date,end_date:end,items:[{price:id(item.price),quantity:item.quantity||1}],proration_behavior:'none',metadata:phase.metadata||{}};
   if(phase.trial_end&&phase.trial_end<=end)current.trial_end=phase.trial_end;
   if(phase.collection_method)current.collection_method=phase.collection_method;
   const window=monthlyUsageWindow(account.usage_anchor_at,new Date(end*1000));
   if(window.start.getTime()!==end*1000)throw intakeError('billing_anniversary_reconciliation_required');
   const nextEnd=Math.floor(calendarMonthBoundary(account.usage_anchor_at,window.index+(request.billingInterval==='year'?12:1)).getTime()/1000);
   const future={start_date:end,end_date:nextEnd,items:[{price:priceId,quantity:1}],proration_behavior:'none',metadata:{...subscription.metadata,plan_code:request.planCode,billing_interval:request.billingInterval,paid_billing_change_id:operation.operation_id}};
   let bridge;
   if(item.price?.recurring?.interval==='year'&&request.billingInterval==='month'){
    const target=await stripe.prices.retrieve(priceId),plan=STANDARD_BILLING_PLANS.find(p=>p.code===request.planCode);
    if(!plan||target.livemode!==true||target.currency!=='usd'||target.unit_amount!==plan.monthlyAmountCents||target.recurring?.interval!=='month'||target.recurring?.interval_count!==1)throw intakeError('billing_bridge_price_mismatch');
    bridge={version:1,operationId:operation.operation_id,customer:account.stripe_customer_id,subscription:subscription.id,targetPrice:priceId,product:id(target.product),planCode:plan.code,currency:'usd',amount:plan.monthlyAmountCents,start:end,end:nextEnd,usageAnchorAt:new Date(account.usage_anchor_at).toISOString()};
    // This is a fully charged first monthly term, not free service. Stripe's
    // deferral aligns subsequent monthly collection to the original anniversary.
    future.trial_end=nextEnd;
    future.add_invoice_items=[{price_data:{currency:'usd',product:bridge.product,unit_amount:bridge.amount},quantity:1,metadata:{app:'everycall',item_type:'paid_base_bridge',paid_billing_change_id:operation.operation_id,paid_purchase_id:account.paid_purchase_id}}];
   }
   const frozen=operation.provider_params||{version:3,params:{end_behavior:'release',proration_behavior:'none',default_settings:{default_payment_method:''},phases:[current,future]},effectiveAt:new Date(end*1000).toISOString(),...(bridge?{bridge}:{})};
   const params=frozen.params;
   await db.query('UPDATE paid_billing_changes SET schedule_id=$2,provider_params=$3::jsonb WHERE operation_id=$1',[operation.operation_id,schedule.id,JSON.stringify(frozen)]);
   // Admission must be fenced before Stripe can accept a phase change, even if
   // its response is lost across the term boundary. The frozen request is durable.
   await db.query('UPDATE tenant_billing_accounts SET pending_plan_code=$2,pending_billing_interval=$3,pending_plan_effective_at=$4 WHERE tenant_key=$1',[tenantKey,request.planCode,request.billingInterval,frozen.effectiveAt]);
   await db.query('COMMIT');await db.query('BEGIN');
   await db.query('SELECT operation_id FROM paid_billing_changes WHERE operation_id=$1 FOR UPDATE',[operation.operation_id]);
   const updated=await stripe.subscriptionSchedules.update(schedule.id,params,{idempotencyKey:`${operation.operation_id}:update`});
   if(!updated.phases?.some(p=>p.start_date===end&&p.end_date===nextEnd&&id(p.items?.[0]?.price)===priceId))throw intakeError('billing_schedule_verification_required');
   if(frozen.bridge){
    const bridgePriceId=await verifyPaidBridgeSchedule(stripe,{...operation,schedule_id:schedule.id,provider_params:frozen},account,updated);
    await db.query('UPDATE paid_billing_changes SET provider_params=provider_params||$2::jsonb WHERE operation_id=$1',[operation.operation_id,JSON.stringify({bridgePriceId})]);
   }
   await db.query('UPDATE tenant_billing_accounts SET pending_plan_code=$2,pending_billing_interval=$3,pending_plan_effective_at=to_timestamp($4) WHERE tenant_key=$1',[tenantKey,request.planCode,request.billingInterval,end]);
  }
  await db.query("UPDATE paid_billing_changes SET status='complete',completed_at=NOW() WHERE operation_id=$1",[operation.operation_id]);
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,$3,$4)",[tenantKey,actor,`billing.${action}.scheduled`,JSON.stringify({...normalized,operationId:operation.operation_id,effectiveAt:new Date(end*1000).toISOString()})]);
  return {effectiveAt:new Date(end*1000).toISOString()};
 });
}
