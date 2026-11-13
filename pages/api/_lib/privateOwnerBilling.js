import {PRIVATE_OWNER_ACCOUNT as OWNER,privateOwnerSubscriptionTerm,privateOwnerInvoiceCoverage} from '../../../lib/privateOwnerBillingContract.js';
import {getStripe} from './stripe.js';

export async function isPrivateOwnerBilling(db,tenantKey){
 if(tenantKey!==OWNER.tenantKey)return false;
 if(!(await db.query("SELECT to_regclass(current_schema()||'.private_owner_billing') AS table_name")).rows[0]?.table_name)return false;
 return (await db.query('SELECT 1 FROM private_owner_billing WHERE tenant_key=$1 AND enabled',[tenantKey])).rowCount===1;
}

// Read-only provider reconciliation. Never creates purchases, subscriptions,
// invoices, credits, refunds, schedules, numbers or public catalog bindings.
export async function reconcilePrivateOwnerBilling(pool,{stripe=null,now=new Date(),event=null}={}){
 if(!await isPrivateOwnerBilling(pool,OWNER.tenantKey))return null;
 stripe ||= getStripe();
 const ownsTransaction=typeof pool.release!=='function';
 // Provider reads precede the admission lock. A revision compare below rejects
 // stale concurrent canonical reads without holding up the owner's phone.
 const observed=(await pool.query('SELECT * FROM private_owner_billing WHERE tenant_key=$1 AND enabled',[OWNER.tenantKey])).rows[0];
 if(!observed)return null;
 let db=null;
 try{
  const prior=observed;
  const sub=await stripe.subscriptions.retrieve(OWNER.subscriptionId,{}, {timeout:10000,maxNetworkRetries:0});
  let term;
  try{term=privateOwnerSubscriptionTerm(sub);}catch{
   await pool.query('UPDATE private_owner_billing SET review_required=TRUE,verified_at=NOW(),reconciliation_version=reconciliation_version+1 WHERE tenant_key=$1 AND reconciliation_version=$2',[OWNER.tenantKey,observed.reconciliation_version]);
   return {reviewRequired:true};
  }
  let paid=null,owed=0,firstFailure=null,count=0,unprovenFailure=false;
  for await(const invoice of stripe.invoices.list({customer:OWNER.customerId,subscription:OWNER.subscriptionId,limit:100},{timeout:10000,maxNetworkRetries:0})){
   if(++count>500)throw Error('private_owner_invoice_pagination_review_required');
   const invoiceSub=invoice.subscription||invoice.parent?.subscription_details?.subscription;
   if(invoice.livemode!==true||(invoice.customer?.id||invoice.customer)!==OWNER.customerId||(invoiceSub?.id||invoiceSub)!==OWNER.subscriptionId)throw Error('private_owner_invoice_identity_mismatch');
   if(invoice.status==='paid'&&invoice.lines?.data?.some(line=>Number(line.period?.start)===term.start&&Number(line.period?.end)===term.end))paid=privateOwnerInvoiceCoverage(invoice,term);
   if(['open','uncollectible'].includes(invoice.status)&&Number(invoice.amount_remaining)>0){
    if(invoice.currency!=='usd')throw Error('private_owner_invoice_currency_mismatch');
    owed+=Number(invoice.amount_remaining);
    if(Number(invoice.attempt_count)>0||invoice.status==='uncollectible'){
     if(event?.data?.object?.id===invoice.id&&['invoice.payment_failed','invoice.payment_action_required'].includes(event.type)&&(Number(invoice.attempt_count)===1||prior.first_failed_at)){
      const failure=Number(event.created);
      if(!Number.isSafeInteger(failure)||failure<=0||failure*1000>new Date(now).getTime())throw Error('private_owner_failure_time_missing');
      firstFailure=Math.min(firstFailure??Infinity,failure*1000);
     }else if(!prior.first_failed_at)unprovenFailure=true;
    }
   }
  }
  // An unresolved episode cannot move when another retry/invoice/card arrives.
  if(owed>0&&prior.first_failed_at)firstFailure=Math.min(firstFailure??Infinity,new Date(prior.first_failed_at).getTime());
  const grace=firstFailure===null?null:new Date(firstFailure+5*86400000);
  const paidThrough=paid?new Date(paid.end*1000):prior.paid_through;
  if(new Date(prior.current_period_start).getTime()>term.start*1000)throw Error('private_owner_stale_subscription');
  const ended=['canceled','incomplete_expired'].includes(term.status)?new Date(Number(sub.ended_at||Math.floor(new Date(now).getTime()/1000))*1000):prior.ended_at;
  db=ownsTransaction?await pool.connect():pool;
  if(ownsTransaction){await db.query('BEGIN');await db.query("SET LOCAL transaction_timeout='5s'");await db.query("SET LOCAL lock_timeout='250ms'");}
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE',[OWNER.tenantKey]);
  const current=(await db.query('SELECT reconciliation_version FROM private_owner_billing WHERE tenant_key=$1 AND enabled FOR UPDATE',[OWNER.tenantKey])).rows[0];
  if(!current||String(current.reconciliation_version)!==String(observed.reconciliation_version))throw Error('private_owner_reconciliation_raced');
  await db.query(`UPDATE private_owner_billing SET current_period_start=to_timestamp($2),current_period_end=to_timestamp($3),
   paid_through=GREATEST(paid_through,$4),paid_invoice_id=COALESCE($5,paid_invoice_id),subscription_status=$6,cancel_at_period_end=$7,
   first_failed_at=$8,grace_ends_at=$9,ended_at=$10,amount_owed_cents=$11,review_required=$13,verified_at=$12,reconciliation_version=reconciliation_version+1 WHERE tenant_key=$1`,
   [OWNER.tenantKey,term.start,term.end,paidThrough,paid?.invoiceId||null,term.status,term.cancelAtPeriodEnd,firstFailure===null?null:new Date(firstFailure),grace,ended,owed,now,unprovenFailure&&firstFailure===null]);
  const restricted=(unprovenFailure&&firstFailure===null)||Boolean(ended)||['unpaid','incomplete','incomplete_expired','paused'].includes(term.status)
   ||(term.cancelAtPeriodEnd&&term.end*1000<=new Date(now).getTime())
   ||(owed>0&&grace&&grace<=now)||(new Date(paidThrough)<=now&&!(owed>0&&grace>now));
  // Canonical base terms live in the private ledger. Preserve the owner's
  // existing calendar-month usage periods and 99% coupon snapshots unchanged.
  // Preserve manual status, publication, number and any irreversible release.
  await db.query(`UPDATE tenants SET billing_status=$2,billing_grace_ends_at=$3,
   billing_lock_reason=CASE WHEN billing_lock_reason='private_owner_billing_restricted' AND NOT $4 THEN NULL WHEN $4 AND billing_lock_reason IS NULL THEN 'private_owner_billing_restricted' ELSE billing_lock_reason END
   WHERE tenant_key=$1`,[OWNER.tenantKey,ended?'canceled':owed?'past_due':restricted?'unpaid':'active',grace,restricted]);
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,'system:stripe','billing.private_owner.reconciled',$2)",
   [OWNER.tenantKey,JSON.stringify({eventId:event?.id||null,subscriptionId:OWNER.subscriptionId,invoiceId:paid?.invoiceId||null,periodStart:term.start,periodEnd:term.end,amountOwedCents:owed,restricted})]);
  if(ownsTransaction)await db.query('COMMIT');return {restricted,amountOwedCents:owed,graceEndsAt:grace};
 }catch(error){if(ownsTransaction&&db)await db.query('ROLLBACK').catch(()=>{});throw error;}finally{if(ownsTransaction&&db)db.release();}
}

export async function handlePrivateOwnerBillingEvent(pool,event){
 const object=event.data?.object;
 if(!/^(invoice\.|customer\.subscription\.|subscription_schedule\.)/.test(event.type||'')
  ||(object?.customer?.id||object?.customer)!==OWNER.customerId||!await isPrivateOwnerBilling(pool,OWNER.tenantKey))return false;
 const sub=event.type.startsWith('customer.subscription.')?object.id:object.subscription||object.parent?.subscription_details?.subscription||object.released_subscription;
 if((sub?.id||sub)!==OWNER.subscriptionId)return false;
 await reconcilePrivateOwnerBilling(pool,{event});return true;
}
