import {calendarMonthBoundary,monthlyUsageWindow} from '../../../lib/paidBillingCalendar.js';
import {STANDARD_BILLING_PLANS} from '../../../lib/standardBillingPlans.js';
const id=value=>typeof value==='string'?value:value?.id;
const reject=()=>{throw Error('paid_base_invoice_reconciliation_required');};
const linePrice=line=>id(line.price)||id(line.pricing?.price_details?.price);

function checkedBridge(operation,account){
 const b=operation.provider_params?.bridge,plan=STANDARD_BILLING_PLANS.find(p=>p.code===b?.planCode);
 if(!b||b.version!==1||b.operationId!==operation.operation_id||b.customer!==account.stripe_customer_id||b.subscription!==operation.subscription_id||b.subscription!==account.stripe_subscription_id||!operation.schedule_id||b.currency!=='usd'||!plan||b.amount!==plan.monthlyAmountCents||operation.request_json?.billingInterval!=='month'||operation.request_json?.planCode!==plan.code||b.usageAnchorAt!==new Date(account.usage_anchor_at).toISOString())reject();
 const window=monthlyUsageWindow(account.usage_anchor_at,new Date(b.start*1000));
 if(window.start.getTime()!==b.start*1000||window.end.getTime()!==b.end*1000)reject();
 return b;
}

// The immutable local operation, known canonical schedule and generated one-time
// price jointly identify a paid annual-to-monthly transition. Metadata alone is
// never ownership or paid coverage evidence.
export async function verifyPaidBridgeSchedule(stripe,operation,account,schedule=null){
 const bridge=checkedBridge(operation,account);
 const canonical=schedule||await stripe.subscriptionSchedules.retrieve(operation.schedule_id);
 if(canonical.id!==operation.schedule_id||canonical.livemode!==true||id(canonical.customer)!==bridge.customer||id(canonical.subscription||canonical.released_subscription)!==bridge.subscription)reject();
 const phase=canonical.phases?.find(p=>p.start_date===bridge.start&&p.end_date===bridge.end);
 if(!phase||phase.trial_end!==bridge.end||phase.metadata?.paid_billing_change_id!==operation.operation_id||phase.items?.length!==1||id(phase.items[0].price)!==bridge.targetPrice||Number(phase.items[0].quantity)!==1||phase.add_invoice_items?.length!==1||Number(phase.add_invoice_items[0].quantity)!==1||phase.add_invoice_items[0].metadata?.paid_billing_change_id!==operation.operation_id)reject();
 const priceId=id(phase.add_invoice_items[0].price),price=priceId&&await stripe.prices.retrieve(priceId);
 if(!price||price.livemode!==true||price.type!=='one_time'||price.recurring||id(price.product)!==bridge.product||price.currency!=='usd'||price.unit_amount!==bridge.amount)reject();
 if(operation.provider_params.bridgePriceId&&operation.provider_params.bridgePriceId!==price.id)reject();
 return price.id;
}

export async function paidBaseCoverageEnd(db,account,invoice,stripe){
 if(invoice.status!=='paid'||invoice.lines?.has_more) {if(invoice.lines?.has_more)reject();return null;}
 const lines=invoice.lines?.data||[],positive=lines.filter(l=>Number(l.amount)>0);
 if(!positive.length)return null;
 const catalog=(await db.query('SELECT billing_plans_json FROM system_config WHERE id=1')).rows[0]?.billing_plans_json||[];
 const operations=(await db.query("SELECT * FROM paid_billing_changes WHERE tenant_key=$1 AND subscription_id=$2 AND action='plan' ORDER BY started_at DESC LIMIT 501",[account.tenant_key,account.stripe_subscription_id])).rows;
 if(operations.length>500)reject();
 const ends=[];
 for(const line of positive){
  const start=Number(line.period?.start),end=Number(line.period?.end),priceId=linePrice(line);
  if(!priceId||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<=0||end<=start||line.currency!=='usd'||Number(line.quantity)!==1)continue;
  const parent=line.parent?.type,recurring=parent==='subscription_item_details'||line.type==='subscription';
  if(recurring){
   const sub=id(line.subscription||line.parent?.subscription_item_details?.subscription);
   if(sub&&sub!==account.stripe_subscription_id)continue;
   // Stripe can label a full original-calendar renewal as proration after deferral.
   // Only a cycle invoice may use that representation; exact term/price checks follow.
   const flagged=line.proration===true||line.parent?.subscription_item_details?.proration===true;
   if(flagged&&(invoice.billing_reason!=='subscription_cycle'||lines.length!==1||sub!==account.stripe_subscription_id))continue;
   const plan=catalog.find(p=>priceId===(p.stripePriceId||p.stripe_price_id)||priceId===(p.stripeAnnualPriceId||p.stripe_annual_price_id));
   const standard=STANDARD_BILLING_PLANS.find(p=>p.code===plan?.code);if(!standard)continue;
   const annual=priceId===(plan.stripeAnnualPriceId||plan.stripe_annual_price_id);
   const window=monthlyUsageWindow(account.usage_anchor_at,new Date(start*1000));
   if(window.start.getTime()!==start*1000||calendarMonthBoundary(account.usage_anchor_at,window.index+(annual?12:1)).getTime()!==end*1000||Number(line.amount)!==(annual?standard.annualAmountCents:standard.monthlyAmountCents))continue;
   if(flagged&&Number(invoice.total)!==(annual?standard.annualAmountCents:standard.monthlyAmountCents))continue;
   ends.push(end);continue;
  }
  if(parent!=='invoice_item_details'&&line.type!=='invoiceitem')continue;
  const matches=operations.filter(o=>{const b=o.provider_params?.bridge;return b&&o.operation_id===line.metadata?.paid_billing_change_id&&b.start===start&&b.end===end&&b.amount===Number(line.amount);});
  if(!matches.length)continue;if(matches.length!==1)reject();
  const op=matches[0],bridge=checkedBridge(op,account);
  if(invoice.billing_reason!=='subscription_update'||bridge.currency!=='usd'||line.metadata?.paid_billing_change_id!==op.operation_id
   ||line.metadata?.item_type!=='paid_base_bridge'||id(line.parent?.invoice_item_details?.subscription)!==bridge.subscription
   ||line.parent?.invoice_item_details?.proration===true||id(line.pricing?.price_details?.product)!==bridge.product)continue;
  // A timed-out schedule write can have succeeded without its local receipt.
  // Reconcile only the already-known schedule; never create a replacement.
  const canonicalPrice=op.provider_params.bridgePriceId||await verifyPaidBridgeSchedule(stripe,op,account);
  if(priceId!==canonicalPrice)continue;
  if(op.provider_params.bridgeInvoiceId&&op.provider_params.bridgeInvoiceId!==invoice.id)reject();
  const recorded=await db.query("UPDATE paid_billing_changes SET provider_params=provider_params||$2::jsonb WHERE operation_id=$1 AND (provider_params->>'bridgeInvoiceId' IS NULL OR provider_params->>'bridgeInvoiceId'=$3) AND (provider_params->>'bridgePriceId' IS NULL OR provider_params->>'bridgePriceId'=$4) RETURNING operation_id",[op.operation_id,JSON.stringify({bridgePriceId:canonicalPrice,bridgeInvoiceId:invoice.id}),invoice.id,canonicalPrice]);
  if(recorded.rowCount!==1)reject();
  ends.push(bridge.end);
 }
 return ends.length?Math.max(...ends):null;
}

// Re-scheduling a phase by copying its already-invoiced add_invoice_items charges
// those items again on a later invoice. Omit only our proven, fully paid bridge;
// retain its verified immutable receipt before the provider phase is rewritten.
export async function verifyPaidBridgeCanOmitItems(db,account,schedule,phase,stripe){
 const operationId=phase.metadata?.paid_billing_change_id;
 const operation=(await db.query('SELECT * FROM paid_billing_changes WHERE operation_id=$1 AND tenant_key=$2 AND subscription_id=$3',[operationId,account.tenant_key,account.stripe_subscription_id])).rows[0];
 if(!operation?.provider_params?.bridgeInvoiceId||!operation.provider_params.bridgePriceId)throw Object.assign(Error('paid_bridge_settlement_required_before_plan_change'),{status:409});
 const b=checkedBridge(operation,account);
 if(b.start!==phase.start_date||b.end!==phase.end_date||new Date(account.paid_base_through).getTime()<b.end*1000)throw Object.assign(Error('paid_bridge_settlement_required_before_plan_change'),{status:409});
 const price=await verifyPaidBridgeSchedule(stripe,operation,account,schedule);
 if(price!==operation.provider_params.bridgePriceId)reject();
 const invoice=await stripe.invoices.retrieve(operation.provider_params.bridgeInvoiceId);
 if(invoice.id!==operation.provider_params.bridgeInvoiceId||invoice.livemode!==true||id(invoice.customer)!==account.stripe_customer_id||id(invoice.subscription||invoice.parent?.subscription_details?.subscription)!==account.stripe_subscription_id||invoice.currency!=='usd'||invoice.status!=='paid'||Number(invoice.amount_remaining)!==0)throw Object.assign(Error('paid_bridge_settlement_required_before_plan_change'),{status:409});
 if(await paidBaseCoverageEnd(db,account,invoice,stripe)!==b.end)reject();
}
