import { monthlyUsageWindow } from '../../../lib/paidBillingCalendar.js';
import { STANDARD_BILLING_PLANS } from '../../../lib/standardBillingPlans.js';

// Only server-retrieved subscriptions with allowlisted current prices can change
// the new paid account's plan. Future phase metadata is never current authority.
export async function syncPaidSubscription(pool,tenantKey,subscription,billingConfig){
 const item=subscription.items?.data?.[0];
 if(subscription.items?.data?.length!==1||subscription.items?.has_more||Number(item?.quantity||1)!==1)throw Error('paid_subscription_items_invalid');
 const start=Number(subscription.current_period_start||item?.current_period_start);
 const end=Number(subscription.current_period_end||item?.current_period_end||subscription.trial_end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<=0||end<=start)throw Error('subscription_period_missing');
 const price=item.price;
 const interval=price?.recurring?.interval;
 const configured=(billingConfig.plans||[]).find(p=>price?.id===(interval==='year'?(p.stripeAnnualPriceId||p.stripe_annual_price_id):(p.stripePriceId||p.stripe_price_id)));
 const plan=STANDARD_BILLING_PLANS.find(p=>p.code===configured?.code);
 if(!plan||!['month','year'].includes(interval)||price.currency!=='usd'||Number(price.unit_amount)!==(interval==='year'?plan.annualAmountCents:plan.monthlyAmountCents))throw Error('paid_subscription_price_mismatch');
 // Webhooks supply their already-locked transaction client. Do not reconnect,
 // commit, or release it; the event receipt and effects must commit together.
 const ownsTransaction=typeof pool.release!=='function';
 const db=ownsTransaction?await pool.connect():pool;
 try{
  if(ownsTransaction)await db.query('BEGIN');
  const tenant=(await db.query('SELECT * FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  const account=(await db.query('SELECT * FROM tenant_billing_accounts WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  if(!account?.paid_purchase_id||subscription.id!==account.stripe_subscription_id||String(subscription.customer?.id||subscription.customer)!==account.stripe_customer_id||subscription.livemode!==true)throw Error('paid_subscription_identity_mismatch');
  const changed=tenant.plan_code!==plan.code||account.billing_interval!==interval||account.stripe_price_id!==price.id;
  const priorEnd=new Date(account.current_period_end).getTime();
  if(changed&&start*1000<priorEnd)throw Error('paid_plan_change_before_term_end');
  if(new Date(account.current_period_start).getTime()>start*1000)throw Error('paid_subscription_stale_period');
  if(changed){
   const window=monthlyUsageWindow(account.usage_anchor_at,new Date(start*1000));
   if(window.start.getTime()!==start*1000)throw Error('paid_plan_change_usage_boundary_mismatch');
   const existing=(await db.query('SELECT * FROM billing_periods WHERE tenant_key=$1 AND period_start=$2 FOR UPDATE',[tenantKey,window.start])).rows[0];
   if(existing&&(existing.status!=='open'||(await db.query(`SELECT 1 FROM calls c LEFT JOIN billing_call_admissions a USING(call_sid)
    LEFT JOIN billing_call_types ct ON ct.billing_call_type_id=c.billing_call_type_id
    WHERE c.tenant_key=$1 AND c.created_at>=$2 AND c.created_at<$3
    AND (a.status IN ('reserved','billable') OR c.answered_at IS NOT NULL OR ct.counts_toward_usage=TRUE) LIMIT 1`,[tenantKey,window.start,window.end])).rowCount))throw Error('paid_plan_change_used_window_requires_review');
   await db.query(`INSERT INTO billing_periods(tenant_key,period_start,period_end,source,plan_code,monthly_amount_cents,included_call_count,call_overage_rate_cents,stripe_subscription_id)
    VALUES($1,$2,$3,'stripe',$4,$5,$6,$7,$8) ON CONFLICT(tenant_key,period_start,period_end) DO UPDATE SET plan_code=$4,monthly_amount_cents=$5,included_call_count=$6,call_overage_rate_cents=$7`,[tenantKey,window.start,window.end,plan.code,plan.monthlyAmountCents,plan.includedCallCount,plan.callOverageRateCents,subscription.id]);
   await db.query('UPDATE tenants SET plan_code=$2,plan=$2 WHERE tenant_key=$1',[tenantKey,plan.code]);
   await db.query(`UPDATE tenant_billing_accounts SET stripe_price_id=$2,stripe_product_id=$3,billing_interval=$4,monthly_amount_cents=$5,included_call_count=$6,call_overage_rate_cents=$7,call_overage_rate_override_cents=NULL,
    pending_plan_code=NULL,pending_billing_interval=NULL,pending_plan_effective_at=NULL WHERE tenant_key=$1`,[tenantKey,price.id,price.product?.id||price.product,interval,plan.monthlyAmountCents,plan.includedCallCount,plan.callOverageRateCents]);
   await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,'system:stripe','billing.paid_plan.term_applied',$2)",[tenantKey,JSON.stringify({subscriptionId:subscription.id,planCode:plan.code,interval,start})]);
  }
  if(account.pending_plan_code===plan.code && (account.pending_billing_interval||account.billing_interval)===interval
   && account.pending_plan_effective_at && start*1000>=new Date(account.pending_plan_effective_at).getTime()) {
   await db.query('UPDATE tenant_billing_accounts SET pending_plan_code=NULL,pending_billing_interval=NULL,pending_plan_effective_at=NULL WHERE tenant_key=$1',[tenantKey]);
  }
  await db.query(`UPDATE tenant_billing_accounts SET current_period_start=to_timestamp($2),current_period_end=to_timestamp($3),cancel_at_period_end=$4,
   canceled_at=CASE WHEN $5::bigint IS NULL THEN canceled_at ELSE to_timestamp($5) END,stripe_subscription_status=$6,
   service_ended_at=CASE WHEN $6 IN('canceled','incomplete_expired') THEN COALESCE(service_ended_at,to_timestamp(COALESCE($7::bigint,$3))) ELSE service_ended_at END,updated_at=NOW() WHERE tenant_key=$1`,
   [tenantKey,start,end,Boolean(subscription.cancel_at_period_end),subscription.canceled_at||null,subscription.status,subscription.ended_at||null]);
  if(ownsTransaction)await db.query('COMMIT');
 }catch(error){if(ownsTransaction)await db.query('ROLLBACK');throw error;}finally{if(ownsTransaction)db.release();}
}

export async function handlePaidSubscriptionSchedule(pool,tenantKey,schedule){
 const ownsTransaction=typeof pool.release!=='function',db=ownsTransaction?await pool.connect():pool;
 try{
  if(ownsTransaction)await db.query('BEGIN');
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey]);
  const account=(await db.query(`SELECT b.*,p.livemode AS purchase_livemode,p.stripe_subscription_id AS purchase_subscription_id
   FROM tenant_billing_accounts b LEFT JOIN paid_purchases p ON p.purchase_id=b.paid_purchase_id WHERE b.tenant_key=$1`,[tenantKey])).rows[0];
  if(account?.paid_purchase_id){
   const customer=typeof schedule.customer==='string'?schedule.customer:schedule.customer?.id;
   const sub=schedule.subscription||schedule.released_subscription,subscription=typeof sub==='string'?sub:sub?.id;
   if(schedule.livemode!==true||customer!==account.stripe_customer_id)throw Error('paid_schedule_identity_mismatch');
   // A historical schedule can arrive after a paid restart. It never gets to
   // rebind the account or its pending selection. Current pending changes come
   // from the audited operation ledger; canonical subscription events apply them.
   if(subscription===account.stripe_subscription_id && (account.purchase_livemode!==true||subscription!==account.purchase_subscription_id))throw Error('paid_schedule_purchase_mismatch');
  }
  if(ownsTransaction)await db.query('COMMIT');
  return Boolean(account?.paid_purchase_id);
 }catch(error){if(ownsTransaction)await db.query('ROLLBACK');throw error;}finally{if(ownsTransaction)db.release();}
}
