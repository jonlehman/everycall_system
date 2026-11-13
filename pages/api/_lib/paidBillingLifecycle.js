import {paidBaseCoverageEnd} from './paidBaseInvoice.js';
import { getStripe } from './stripe.js';
import { sendTransactionalEmail } from './mail.js';
import { reconcilePaidNumberRelease } from './paidNumberRelease.js';
export { preparePaidReinstatementNumber } from './paidNumberRelease.js';

const DAY = 86400000;
const unpaidStatuses = ['open', 'uncollectible'];
const id = value => typeof value === 'string' ? value : value?.id;

export function paidBillingRestriction(account, episode, debts, now = new Date()) {
  const at = new Date(now).getTime();
  const owed = debts.filter(d => unpaidStatuses.includes(d.status) && Number(d.amount_remaining_cents) > 0);
  if (account.service_ended_at || (account.cancel_at_period_end && new Date(account.current_period_end).getTime() <= at)) return 'ended';
  if (owed.length && episode?.grace_ends_at && new Date(episode.grace_ends_at).getTime() > at) return 'grace';
  const prepaid = new Date(account.paid_base_through).getTime() > at;
  if (owed.length) return account.billing_interval === 'year' && prepaid && owed.every(d => d.kind === 'overage') ? 'included_only' : 'suspended';
  return prepaid ? 'normal' : 'suspended';
}

async function syncLocked(db, account, now) {
  const debts = (await db.query('SELECT * FROM billing_invoice_debts WHERE tenant_key=$1', [account.tenant_key])).rows;
  let episode = (await db.query('SELECT * FROM billing_delinquencies WHERE tenant_key=$1', [account.tenant_key])).rows[0];
  const owed = debts.filter(d => unpaidStatuses.includes(d.status) && Number(d.amount_remaining_cents) > 0);
  if (owed.length) {
    const first = new Date(Math.min(...owed.map(d => new Date(d.failed_at || now).getTime()), ...(episode?.first_failed_at ? [new Date(episode.first_failed_at).getTime()] : [])));
    await db.query(`INSERT INTO billing_delinquencies(tenant_key,first_failed_at,grace_ends_at)
      VALUES($1,$2,$3) ON CONFLICT(tenant_key) DO UPDATE SET first_failed_at=EXCLUDED.first_failed_at,grace_ends_at=EXCLUDED.grace_ends_at`,
    [account.tenant_key, first.toISOString(), new Date(first.getTime()+5*DAY).toISOString()]);
    episode = (await db.query('SELECT * FROM billing_delinquencies WHERE tenant_key=$1', [account.tenant_key])).rows[0];
  }
  const restriction = paidBillingRestriction(account, episode, debts, now);
  const suspended = restriction === 'suspended' || restriction === 'ended';
  // A paid annual overage restriction must never start number retention/release.
  const overdueStart = owed.length && episode?.grace_ends_at;
  const annualOverageEnd = account.billing_interval==='year' && owed.length && owed.every(d=>d.kind==='overage') && account.paid_base_through;
  const suspensionAt = suspended ? (episode?.full_suspended_at
    || (restriction==='ended' ? account.service_ended_at || account.current_period_end : null)
    || (overdueStart && annualOverageEnd ? new Date(Math.max(new Date(overdueStart).getTime(),new Date(annualOverageEnd).getTime())).toISOString() : overdueStart)
    || account.paid_base_through || now) : null;
  await db.query(`INSERT INTO billing_delinquencies(tenant_key,restriction,full_suspended_at,number_release_at)
    VALUES($1,$2,$3,$4) ON CONFLICT(tenant_key) DO UPDATE SET restriction=$2,
    first_failed_at=CASE WHEN $5 THEN billing_delinquencies.first_failed_at ELSE NULL END,
    grace_ends_at=CASE WHEN $5 THEN billing_delinquencies.grace_ends_at ELSE NULL END,
    full_suspended_at=$3,number_release_at=$4,updated_at=NOW()`,
  [account.tenant_key, restriction, suspensionAt, suspensionAt ? new Date(new Date(suspensionAt).getTime()+30*DAY).toISOString() : null, owed.length > 0]);
  const releaseBlocked = Boolean(account.telnyx_release_status);
  await db.query(`UPDATE tenants SET billing_status=$2,service_access_status=$3,app_access_status='enabled',
    billing_grace_ends_at=$4,billing_lock_reason=$5,billing_status_updated_at=NOW() WHERE tenant_key=$1`,
  [account.tenant_key, restriction==='ended'?'canceled':owed.length?'past_due':suspended?'unpaid':'active',
    suspended || releaseBlocked || account.tenant_status!=='active' ? 'disabled':'enabled', owed.length ? episode?.grace_ends_at : null,
    releaseBlocked?'voice_number_release_pending':restriction==='normal'?null:restriction]);
  return { restriction, amountOwedCents: owed.reduce((sum,d)=>sum+Number(d.amount_remaining_cents),0),
    graceEndsAt: owed.length ? episode?.grace_ends_at : null,
    numberReleaseAt: suspensionAt ? new Date(new Date(suspensionAt).getTime()+30*DAY).toISOString() : null };
}

async function lockedAccount(db, tenantKey) {
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE', [tenantKey]);
  return (await db.query(`SELECT b.*,t.telnyx_release_status,t.status AS tenant_status FROM tenant_billing_accounts b JOIN tenants t USING(tenant_key)
    WHERE b.tenant_key=$1 AND b.paid_purchase_id IS NOT NULL`, [tenantKey])).rows[0];
}

export async function syncPaidBillingEntitlement(pool, tenantKey, { now = new Date() } = {}) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const account = await lockedAccount(db, tenantKey);
    const result = account ? await syncLocked(db, account, now) : null;
    await db.query('COMMIT'); return result;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

// Called for verified Stripe invoice webhooks. Retrieve under the same tenant lock
// so an older failure event cannot overwrite a payment processed concurrently.
export async function applyPaidBillingEvent(pool, event, { stripe = getStripe(), now = new Date(), sendEmail = sendTransactionalEmail } = {}) {
  if (!event.type?.startsWith('invoice.')) return false;
  const object = event.data?.object;
  if (!object?.id || !id(object.customer)) return false;
  const candidate = (await pool.query(`SELECT tenant_key FROM tenant_billing_accounts
    WHERE stripe_customer_id=$1 AND paid_purchase_id IS NOT NULL`, [id(object.customer)])).rows[0];
  if (!candidate) return false;
  const db = await pool.connect();
  let state;
  try {
    await db.query('BEGIN');
    const account = await lockedAccount(db, candidate.tenant_key);
    const invoice = await stripe.invoices.retrieve(object.id);
    if (!account || id(invoice.customer)!==account.stripe_customer_id || invoice.currency!=='usd' || invoice.livemode!==true) throw Error('billing_invoice_identity_mismatch');
    const subId=id(invoice.subscription || invoice.parent?.subscription_details?.subscription);
    const kind=invoice.metadata?.item_type==='call_overage'?'overage':'base';
    if (kind==='base' && subId!==account.stripe_subscription_id) { await db.query('COMMIT'); return false; }
    if (kind==='overage') {
      const period=(await db.query('SELECT * FROM billing_periods WHERE billing_period_id=$1 AND tenant_key=$2',[invoice.metadata.billing_period_id,candidate.tenant_key])).rows[0];
      if(!period || !period.invoice_payload || (period.stripe_invoice_id && period.stripe_invoice_id!==invoice.id)
        || Number(invoice.total)!==Number(period.invoice_payload.amount) || invoice.metadata.tenant_key!==candidate.tenant_key) throw Error('billing_overage_invoice_mismatch');
      await db.query('UPDATE billing_periods SET stripe_invoice_id=$2 WHERE billing_period_id=$1',[period.billing_period_id,invoice.id]);
    }
    const amount = ['paid','void'].includes(invoice.status) ? 0 : Math.max(0,Number(invoice.amount_remaining || 0));
    const failed = ['invoice.payment_failed','invoice.payment_action_required','invoice.marked_uncollectible'].includes(event.type);
    const previous=(await db.query('SELECT * FROM billing_invoice_debts WHERE stripe_invoice_id=$1',[invoice.id])).rows[0];
    // Merely creating a payable invoice does not start grace before a failure.
    if (failed || previous || invoice.status==='paid') {
      const eventTime = new Date(Math.min(new Date(now).getTime(), Number(event.created || Math.floor(new Date(now).getTime()/1000))*1000));
      await db.query(`INSERT INTO billing_invoice_debts(stripe_invoice_id,tenant_key,kind,amount_remaining_cents,status,failed_at,hosted_invoice_url,provider_updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(stripe_invoice_id) DO UPDATE SET
        amount_remaining_cents=$4,status=$5,failed_at=COALESCE(billing_invoice_debts.failed_at,$6),hosted_invoice_url=$7,provider_updated_at=$8,updated_at=NOW()`,
      [invoice.id,candidate.tenant_key,kind,amount,invoice.status,failed?eventTime.toISOString():null,invoice.hosted_invoice_url || null,now]);
    }
    if(kind==='base' && invoice.status==='paid') {
      // Settled positive base lines (including balance-credit settlement) prove
      // coverage. A zero recurring deferral line or unrelated one-time item does not.
      const end=await paidBaseCoverageEnd(db,account,invoice,stripe);
      if(end)await db.query(`UPDATE tenant_billing_accounts SET paid_base_through=GREATEST(paid_base_through,$2::timestamptz) WHERE tenant_key=$1`,[candidate.tenant_key,new Date(end*1000).toISOString()]);
    }
    state=await syncLocked(db,await lockedAccount(db,candidate.tenant_key),now);
    await db.query('COMMIT');
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
  if(state.amountOwedCents>0) await sendPaidBillingReminders(pool,candidate.tenant_key,{now,sendEmail});
  return true;
}

export async function sendPaidBillingReminders(pool,tenantKey,{now=new Date(),sendEmail=sendTransactionalEmail}={}) {
  const state=(await pool.query(`SELECT d.*,COALESCE((SELECT SUM(amount_remaining_cents) FROM billing_invoice_debts i
    WHERE i.tenant_key=d.tenant_key AND i.status IN ('open','uncollectible')),0) AS owed
    FROM billing_delinquencies d WHERE d.tenant_key=$1`,[tenantKey])).rows[0];
  if(!state || Number(state.owed)<=0) return 0;
  const base=String(process.env.APP_BASE_URL||'').replace(/\/$/,'');
  if(!/^https:\/\/[^/]+/.test(base)) throw Error('billing_recovery_url_not_configured');
  // Login plus owner authorization protects the recovery action. No bearer token in email.
  const url=`${base}/client/account/billing?tenantKey=${encodeURIComponent(tenantKey)}`;
  const warning=state.number_release_at && new Date(state.number_release_at).getTime()-new Date(now).getTime()<=5*DAY;
  const kind=warning?'number_release':'overdue';
  const description=state.restriction==='included_only'?'Your prepaid included calls remain available each month; additional overage calls are paused.'
    :['suspended','ended'].includes(state.restriction)?'Call answering is suspended. Login, billing and help remain available.'
    :'Call answering remains available until the fixed grace deadline.';
  const text=`Your EveryCall balance is $${(Number(state.owed)/100).toFixed(2)}. The fixed grace deadline is ${new Date(state.grace_ends_at).toISOString()}. ${description}${warning?` Your number is scheduled for release on ${new Date(state.number_release_at).toISOString()}.`:''} Sign in as account owner to review and pay: ${url}. For help: customerservice@everycall.io`;
  const users=(await pool.query("SELECT DISTINCT lower(email) AS email FROM tenant_users WHERE tenant_key=$1 AND status='active' AND role='owner'",[tenantKey])).rows;
  let sent=0;
  for(const user of users) {
    const claim=await pool.query(`INSERT INTO billing_reminder_deliveries(tenant_key,recipient,reminder_kind,target_day)
      VALUES($1,$2,$3,$4::date) ON CONFLICT DO NOTHING RETURNING recipient`,[tenantKey,user.email,kind,new Date(now).toISOString().slice(0,10)]);
    if(!claim.rowCount)continue;
    try {
      await sendEmail({to:user.email,subject:warning?'EveryCall number release warning':'EveryCall payment overdue',text,category:'Billing Lifecycle'});
      await pool.query("UPDATE billing_reminder_deliveries SET status='sent',delivered_at=NOW() WHERE tenant_key=$1 AND recipient=$2 AND reminder_kind=$3 AND target_day=$4::date",[tenantKey,user.email,kind,new Date(now).toISOString().slice(0,10)]);
      sent++;
    } catch(error) {
      // Uncertain delivery stays fenced; never duplicate a recipient/day email.
      await pool.query("UPDATE billing_reminder_deliveries SET status='uncertain' WHERE tenant_key=$1 AND recipient=$2 AND reminder_kind=$3 AND target_day=$4::date",[tenantKey,user.email,kind,new Date(now).toISOString().slice(0,10)]);
    }
  }
  return sent;
}

export async function runPaidBillingLifecycleJobs(pool,{now=new Date(),sendEmail=sendTransactionalEmail,numberReleaseOptions={}}={}) {
  const accounts=(await pool.query('SELECT tenant_key FROM tenant_billing_accounts WHERE paid_purchase_id IS NOT NULL')).rows;
  let reminders=0;
  for(const account of accounts) {
    await syncPaidBillingEntitlement(pool,account.tenant_key,{now});
    reminders+=await sendPaidBillingReminders(pool,account.tenant_key,{now,sendEmail});
    await reconcilePaidNumberRelease(pool,account.tenant_key,{now,...numberReleaseOptions});
  }
  return {accounts:accounts.length,reminders};
}
