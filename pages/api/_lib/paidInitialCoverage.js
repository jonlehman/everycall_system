import {calendarMonthBoundary,monthlyUsageWindow} from '../../../lib/paidBillingCalendar.js';
import {STANDARD_BILLING_PLANS} from '../../../lib/standardBillingPlans.js';
const id=value=>typeof value==='string'?value:value?.id;
const review=()=>{throw Error('paid_initial_coverage_review_required');};

// A delayed first bind may have missed canonical renewal webhooks. Recover only
// complete, all-paid, unchanged-plan history; never invent grace, arrears or a term.
export async function reconcilePaidInitialCoverage(row,stripe,{now=new Date()}={}){
 const sub=await stripe.subscriptions.retrieve(row.stripe_subscription_id),item=sub.items?.data?.[0],plan=STANDARD_BILLING_PLANS.find(p=>p.code===row.plan_code);
 const start=Number(item?.current_period_start||sub.current_period_start),end=Number(item?.current_period_end||sub.current_period_end);
 const expected=row.billing_interval==='year'?plan?.annualAmountCents:plan?.monthlyAmountCents;
 if(!plan||sub.livemode!==true||sub.id!==row.stripe_subscription_id||id(sub.customer)!==row.stripe_customer_id||sub.metadata?.paid_purchase_id!==row.purchase_id||sub.status!=='active'||sub.schedule||sub.cancel_at_period_end||sub.items?.data?.length!==1||sub.items?.has_more||Number(item.quantity)!==1||id(item.price)!==row.stripe_price_id||item.price?.currency!=='usd'||item.price?.unit_amount!==expected||item.price?.recurring?.interval!==row.billing_interval||item.price?.recurring?.interval_count!==1||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start*1000>new Date(now).getTime()||end*1000<=new Date(now).getTime())review();
 const receipts=[],seen=new Map();let count=0;
 for await(const invoice of stripe.invoices.list({customer:row.stripe_customer_id,subscription:sub.id,limit:100})){
  if(++count>500)review();
  if(typeof invoice.id!=='string'||!invoice.id.startsWith('in_')||invoice.livemode!==true||id(invoice.customer)!==row.stripe_customer_id||id(invoice.subscription||invoice.parent?.subscription_details?.subscription)!==sub.id||invoice.currency!=='usd'||invoice.status!=='paid'||Number(invoice.amount_remaining)!==0||invoice.lines?.has_more||!Array.isArray(invoice.lines?.data))review();
  const lines=invoice.lines.data;
  if(lines.every(l=>Number(l.amount)===0)&&Number(invoice.total)===0)continue;
  if(lines.length!==1||Number(invoice.total)!==expected)review();
  const line=lines[0],a=Number(line.period?.start),b=Number(line.period?.end),parent=line.parent?.subscription_item_details;
  if(Number(line.amount)!==expected||line.currency!=='usd'||Number(line.quantity)!==1||(line.parent?.type!=='subscription_item_details'&&line.type!=='subscription')||id(line.price||line.pricing?.price_details?.price)!==row.stripe_price_id||(id(line.subscription||parent?.subscription)&&id(line.subscription||parent?.subscription)!==sub.id)||((line.proration===true||parent?.proration===true)&&(invoice.billing_reason!=='subscription_cycle'||id(line.subscription||parent?.subscription)!==sub.id))||!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<=0||b<=a)review();
  let window;try{window=monthlyUsageWindow(row.usage_anchor_at,new Date(a*1000));}catch{review();}
  if(window.start.getTime()!==a*1000||calendarMonthBoundary(row.usage_anchor_at,window.index+(row.billing_interval==='year'?12:1)).getTime()!==b*1000)review();
  const prior=seen.get(invoice.id);if(prior){if(prior.start!==a||prior.end!==b||prior.amount!==expected)review();continue;}
  const receipt={id:invoice.id,start:a,end:b,amount:expected,hostedInvoiceUrl:invoice.hosted_invoice_url||null};seen.set(invoice.id,receipt);receipts.push(receipt);
 }
 let through=Math.floor(new Date(row.initial_period_end).getTime()/1000);
 for(const receipt of receipts.sort((a,b)=>a.start-b.start||a.end-b.end)){
  if(receipt.start>through)review();through=Math.max(through,receipt.end);
 }
 if(through!==end||!receipts.some(r=>r.start===start&&r.end===end))review();
 return {subscriptionId:sub.id,start,end,through,receipts};
}

export async function persistPaidInitialCoverage(db,tenantKey,purchaseId,coverage){
 await db.query("UPDATE tenant_billing_accounts SET current_period_start=to_timestamp($2),current_period_end=to_timestamp($3),paid_base_through=to_timestamp($4),stripe_subscription_status='active' WHERE tenant_key=$1 AND paid_purchase_id=$5",[tenantKey,coverage.start,coverage.end,coverage.through,purchaseId]);
 for(const receipt of coverage.receipts){
  const saved=await db.query(`INSERT INTO billing_invoice_debts(stripe_invoice_id,tenant_key,kind,amount_remaining_cents,status,hosted_invoice_url,provider_updated_at)
   VALUES($1,$2,'base',0,'paid',$3,NOW()) ON CONFLICT(stripe_invoice_id) DO UPDATE SET status='paid',amount_remaining_cents=0,provider_updated_at=NOW()
   WHERE billing_invoice_debts.tenant_key=EXCLUDED.tenant_key AND billing_invoice_debts.kind='base' RETURNING stripe_invoice_id`,[receipt.id,tenantKey,receipt.hostedInvoiceUrl]);
  if(saved.rowCount!==1)review();
 }
 await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,'system:billing','paid_intake.missed_renewals.reconciled',$2)",[tenantKey,JSON.stringify({purchaseId,subscriptionId:coverage.subscriptionId,currentStart:coverage.start,currentEnd:coverage.end,paidThrough:coverage.through,receipts:coverage.receipts.map(({id,start,end,amount})=>({id,start,end,amount}))})]);
}
