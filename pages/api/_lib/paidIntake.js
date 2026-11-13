import {purchaseTerms,purchaseTermsMessage,ensurePurchaseCustomer} from './paidPurchaseContract.js';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { getStripe } from './stripe.js';
import { sendTransactionalEmail } from './mail.js';
import { normalizeMarketingAttribution } from '../../../lib/intakeMarketingAttribution.js';
import { STANDARD_BILLING_PLANS } from '../../../lib/standardBillingPlans.js';
import { calendarMonthBoundary } from '../../../lib/paidBillingCalendar.js';
import { getSystemBillingConfig, getPlanStripePriceIdForInterval } from './billing.js';

export const intakeHash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const token = () => crypto.randomBytes(32).toString('hex');
export function intakeError(code, status = 409) { return Object.assign(Error(code), { status }); }
export async function intakeTransaction(pool, work) {
 const db = await pool.connect();
 try { await db.query('BEGIN'); const result = await work(db); await db.query('COMMIT'); return result; }
 catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
export async function assertPaidIntakeEnabled(db) {
 const row = (await db.query('SELECT enabled FROM paid_intake_release WHERE id=TRUE')).rows[0];
 if (!row?.enabled) throw intakeError('paid_intake_release_pending',503);
}
export function normalizeIntake(body) {
 const email = String(body.loginEmail || '').trim().toLowerCase();
 const plan = STANDARD_BILLING_PLANS.find(p => p.code === body.planCode);
 if (!plan || !['month','year'].includes(body.billingInterval)) throw intakeError('plan_and_interval_required',400);
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw intakeError('valid_email_required',400);
 const businessName = String(body.businessName || '').trim().slice(0,200);
 if (!businessName) throw intakeError('business_name_required',400);
 let website = String(body.website || '').trim();
 if (website) {
  try { const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
   if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error();
   url.hash = ''; website = url.href;
  } catch { throw intakeError('valid_website_required',400); }
 }
 return { businessName, loginEmail:email, website, planCode:plan.code, billingInterval:body.billingInterval,
  businessCategory:String(body.businessCategory || 'service_business').slice(0,100),
  leadPhone:String(body.leadPhone || '').slice(0,30), companyDescription:String(body.companyDescription || '').slice(0,4000),
  marketingAttribution:normalizeMarketingAttribution(body.marketingAttribution) };
}
export function intakeCookie(req) {
 const raw = String(req.headers?.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('ec_intake='));
 return raw ? decodeURIComponent(raw.slice('ec_intake='.length)) : '';
}
export function setIntakeCookie(res, raw) {
 res.setHeader('Set-Cookie', `ec_intake=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${process.env.NODE_ENV==='production'?'; Secure':''}`);
}
export async function requireVerifiedIntake(db, req) {
 const raw = intakeCookie(req);
 if (!raw) throw intakeError('owner_verification_required',401);
 const row = (await db.query('SELECT * FROM paid_intakes WHERE session_hash=$1 AND session_expires_at>NOW() AND verified_at IS NOT NULL',[intakeHash(raw)])).rows[0];
 if (!row) throw intakeError('owner_verification_required',401);
 return row;
}
function appOrigin() {
 const url = new URL(process.env.APP_BASE_URL || '');
 if(url.protocol!=='https:' && url.hostname!=='localhost') throw intakeError('app_origin_invalid',503);
 return url.origin;
}
export async function resolveIntakeSalesReference(db, raw) {
 if (!raw) return null;
 const row=(await db.query(`SELECT c.*,p.business_name,p.website_url,p.business_category,p.tenant_key AS prospect_tenant_key
  FROM paid_intake_sales_references r JOIN sales_checkout_sessions c USING(checkout_id)
  JOIN sales_prospects p USING(prospect_id)
  WHERE r.reference_hash=$1 AND r.expires_at>NOW() AND r.revoked_at IS NULL AND c.is_test=FALSE`,[intakeHash(raw)])).rows[0];
 if(!row)throw intakeError('intake_reference_expired',410);
 return row;
}
export async function issueIntakeSalesReference(db, checkout) {
 await assertPaidIntakeEnabled(db);
 const existing=(await db.query('SELECT c.checkout_url,r.reference_hash,r.expires_at,r.revoked_at FROM sales_checkout_sessions c LEFT JOIN paid_intake_sales_references r USING(checkout_id) WHERE c.checkout_id=$1',[checkout.checkout_id])).rows[0];
 if(existing?.revoked_at)return `${appOrigin()}/intake`;
 if(existing?.checkout_url?.startsWith(`${appOrigin()}/intake?`)&&new Date(existing.expires_at)>new Date()&&intakeHash(new URL(existing.checkout_url).searchParams.get('salesRef'))===existing.reference_hash)return existing.checkout_url;
 const raw=token();
 await db.query(`INSERT INTO paid_intake_sales_references(reference_hash,checkout_id,expires_at) VALUES($1,$2,NOW()+interval '14 days')
  ON CONFLICT(checkout_id) DO UPDATE SET reference_hash=EXCLUDED.reference_hash,expires_at=EXCLUDED.expires_at
  WHERE paid_intake_sales_references.revoked_at IS NULL`,[intakeHash(raw),checkout.checkout_id]);
 return `${appOrigin()}/intake?salesRef=${raw}`;
}
export async function createIntakeDraft(pool, body, {sendEmail=sendTransactionalEmail}={}) {
 await assertPaidIntakeEnabled(pool);
 const payload=normalizeIntake(body), raw=token();
 const sales=await resolveIntakeSalesReference(pool,body.salesRef);
 // A link is attribution only. The email verification below is the owner boundary.
 const trustedAttribution=sales?{...payload.marketingAttribution,utm:{...(payload.marketingAttribution.utm||{}),source:'sales'},source:'sales',salesProspectId:sales.prospect_id}:payload.marketingAttribution;
 payload.marketingAttribution=trustedAttribution;
 const row=await intakeTransaction(pool,async db=>{
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`intake:${payload.loginEmail}`]);
  const existing=(await db.query('SELECT * FROM paid_intakes WHERE owner_email=$1 FOR UPDATE',[payload.loginEmail])).rows[0];
  if(existing && Date.now()-new Date(existing.updated_at).getTime()<60000) throw intakeError('verification_recently_sent',429);
  if(existing){
   payload.marketingAttribution=existing.payload_json.marketingAttribution||{};
   // Once Checkout starts, only its authenticated owner may alter the draft.
   const purchase=(await db.query("SELECT purchase_id FROM paid_purchases WHERE intake_id=$1 AND kind='setup'",[existing.intake_id])).rows[0];
   await db.query(`UPDATE paid_intakes SET verification_hash=$2,verification_expires_at=NOW()+interval '30 minutes',
    payload_json=CASE WHEN $4 THEN payload_json ELSE $3::jsonb END,updated_at=NOW() WHERE intake_id=$1`,
    [existing.intake_id,intakeHash(raw),JSON.stringify(payload),Boolean(purchase)]);
   return existing;
  }
  return (await db.query(`INSERT INTO paid_intakes(intake_id,owner_email,payload_json,prospect_id,verification_hash,verification_expires_at)
   VALUES($1,$2,$3::jsonb,$4,$5,NOW()+interval '30 minutes') RETURNING *`,
   [`intake_${crypto.randomUUID()}`,payload.loginEmail,JSON.stringify(payload),sales?.prospect_id||null,intakeHash(raw)])).rows[0];
 });
 await sendEmail({to:payload.loginEmail,subject:'Verify your EveryCall signup',text:`Confirm your email to review your business, plan and payment before continuing: ${appOrigin()}/intake?verify=${raw}\nThis link expires in 30 minutes. No account or charge has been created.`,category:'Owner verification'});
 return {ok:true,intakeId:row.intake_id,verificationRequired:true,message:'Check your email to verify ownership and review your signup.'};
}
export async function verifyIntakeOwner(pool, raw, {session=null}={}) {
 const secret=token();
 const row=await intakeTransaction(pool,async db=>{
  const draft=(await db.query(`SELECT * FROM paid_intakes WHERE verification_hash=$1 AND verification_expires_at>NOW() FOR UPDATE`,[intakeHash(raw)])).rows[0];
  if(!draft)throw intakeError('verification_expired',410);
  const users=(await db.query('SELECT id,tenant_key,role,status FROM tenant_users WHERE lower(email)=$1',[draft.owner_email])).rows;
  if(users.length && !(users.length===1 && session?.role==='tenant' && String(session.user_id)===String(users[0].id) && users[0].role==='owner' && users[0].status==='active' && session.tenant_key===users[0].tenant_key)) {
   throw intakeError('existing_owner_login_required',403);
  }
  return (await db.query(`UPDATE paid_intakes SET verified_at=NOW(),verification_hash=NULL,verification_expires_at=NULL,
   session_hash=$2,session_expires_at=NOW()+interval '1 day',intended_tenant_key=$3,updated_at=NOW()
   WHERE intake_id=$1 RETURNING *`,[draft.intake_id,intakeHash(secret),users[0]?.tenant_key||null])).rows[0];
 });
 return {row,secret};
}
export async function getIntakeStatus(db,intake) {
 const purchase=(await db.query("SELECT purchase_id,payment_status,provisioning_status,tenant_key FROM paid_purchases WHERE intake_id=$1 AND kind='setup'",[intake.intake_id])).rows[0];
 const quote=await getIntakeQuote(db,intake);
 return {ok:true,verified:true,intakeId:intake.intake_id,intake:intake.payload_json,quote,purchase:purchase?{
  purchaseId:purchase.purchase_id,paymentStatus:purchase.payment_status,provisioningStatus:purchase.provisioning_status,tenantKey:purchase.tenant_key}:null};
}
export async function verifiedPrice(db,stripe,planCode,interval) {
 const config=await getSystemBillingConfig(db),plan=config.plans.find(p=>p.code===planCode);
 if(!plan||!['month','year'].includes(interval))throw intakeError('plan_and_interval_required',400);
 const priceId=getPlanStripePriceIdForInterval(plan,interval);
 if(!priceId)throw intakeError('billing_catalog_not_ready',503);
 const price=await stripe.prices.retrieve(priceId);
 const expected=interval==='year'?plan.annualAmountCents:plan.monthlyAmountCents;
 if((typeof price.product==='string'?price.product:price.product?.id)!==plan.stripeProductId||!price.active||price.currency!=='usd'||price.unit_amount!==expected||price.recurring?.interval!==interval||price.recurring?.interval_count!==1||price.livemode!==true)throw intakeError('billing_catalog_mismatch',503);
 return priceId;
}
export async function beginPaidCheckout(pool,intake,body,{stripe=getStripe()}={}) {
 await assertPaidIntakeEnabled(pool);
 if(body.consentAccepted!==true)throw intakeError('recurring_consent_required',400);
 const payload=normalizeIntake({...intake.payload_json,...body,loginEmail:intake.owner_email,marketingAttribution:intake.payload_json.marketingAttribution});
 payload.marketingAttribution=intake.payload_json.marketingAttribution||{};
 if(body.loginEmail && body.loginEmail.toLowerCase().trim()!==intake.owner_email)throw intakeError('owner_email_changed',403);
 const priceId=await verifiedPrice(pool,stripe,payload.planCode,payload.billingInterval);
 // Re-match website after edits; a domain match is never tenant/owner authority.
 return intakeTransaction(pool,async db=>{
  const locked=(await db.query('SELECT * FROM paid_intakes WHERE intake_id=$1 FOR UPDATE',[intake.intake_id])).rows[0];
  await assertCheckoutQuote(db,locked,payload,body.quoteToken,stripe);
  let row=(await db.query("SELECT * FROM paid_purchases WHERE intake_id=$1 AND kind='setup' FOR UPDATE",[intake.intake_id])).rows[0];
  if(row?.payment_status==='paid'&&row.recurring_consent_at)return {status:'payment_processing',purchaseId:row.purchase_id};
  if(row && (row.plan_code!==payload.planCode||row.billing_interval!==payload.billingInterval||!isDeepStrictEqual(withoutQuote(locked.payload_json),payload)))throw intakeError('checkout_already_reserved_review_existing',409);
  if(!row){
   const matches=payload.website?(await db.query('SELECT prospect_id,tenant_key FROM sales_prospects WHERE sales_website_domain(website_url)=sales_website_domain($1)',[payload.website])).rows:[];
   if(matches.length>1 || (locked.prospect_id&&matches[0]&&matches[0].prospect_id!==locked.prospect_id))throw intakeError('identity_review_required',409);
   const tenantMatches=payload.website?(await db.query('SELECT tenant_key FROM tenant_bootstrap_profiles WHERE sales_website_domain(website_url)=sales_website_domain($1)',[payload.website])).rows:[];
   if(tenantMatches.some(t=>t.tenant_key!==locked.intended_tenant_key && !matches.some(p=>p.tenant_key===t.tenant_key)))throw intakeError('identity_review_required',409);
   const matchedProspectId=locked.prospect_id||matches[0]?.prospect_id;
   const prospect=matchedProspectId?(await db.query('SELECT * FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE',[matchedProspectId])).rows[0]:null;
   if(prospect){
    const reserved=(await db.query("SELECT owner_email FROM paid_purchases WHERE prospect_id=$1 AND kind='setup' AND livemode=TRUE",[prospect.prospect_id])).rows[0];
    if(reserved)throw intakeError('prospect_purchase_owner_recovery_required',409);
    const identity=(await db.query(`SELECT 1 FROM sales_prospect_contacts WHERE prospect_id=$1 AND lower(email)=$2 AND archived_at IS NULL UNION SELECT 1 FROM sales_checkout_sessions WHERE prospect_id=$1 AND is_test=FALSE AND (lower(recipient)=$2 OR lower(contact_snapshot->>'email')=$2)`,[prospect.prospect_id,locked.owner_email])).rowCount;
    if(!identity)throw intakeError('prospect_owner_verification_required',403);
   }
   // An unowned provisional demo can only be converted with an owner-bound Sales link/contact.
   let tenantKey=locked.intended_tenant_key;
   if(prospect?.tenant_key && tenantKey!==prospect.tenant_key){
    const owners=(await db.query('SELECT email FROM tenant_users WHERE tenant_key=$1 AND role=\'owner\'',[prospect.tenant_key])).rows;
    const contacts=(await db.query(`SELECT 1 FROM sales_prospect_contacts WHERE prospect_id=$1 AND lower(email)=$2 AND archived_at IS NULL UNION SELECT 1 FROM sales_checkout_sessions WHERE prospect_id=$1 AND is_test=FALSE AND paid_at IS NOT NULL AND (lower(recipient)=$2 OR lower(contact_snapshot->>'email')=$2)`,[prospect.prospect_id,locked.owner_email])).rows;
    if(owners.length || !contacts.length)throw intakeError('identity_review_required',409);
    tenantKey=prospect.tenant_key;
   }
   if(tenantKey){
    const active=(await db.query('SELECT stripe_subscription_id FROM tenant_billing_accounts WHERE tenant_key=$1',[tenantKey])).rows[0];
    if(active?.stripe_subscription_id)throw intakeError('existing_subscription_use_billing',409);
   }
   const legacy=prospect?(await db.query('SELECT * FROM sales_checkout_sessions WHERE prospect_id=$1 AND is_test=FALSE ORDER BY created_at DESC',[prospect.prospect_id])).rows:[];
   let verifiedLegacy=null;
   for(const old of legacy){
    if(!old.stripe_session_id){if(old.checkout_url&&!old.checkout_url.startsWith(`${appOrigin()}/intake?`))throw intakeError('legacy_checkout_reconciliation_required');continue;}
    const canonical=await stripe.checkout.sessions.retrieve(old.stripe_session_id);
    if(canonical.livemode!==true||canonical.metadata?.sales_checkout_id!==old.checkout_id||canonical.amount_total!==old.amount_cents||canonical.currency!=='usd'||canonical.mode!=='payment')throw intakeError('legacy_payment_review_required');
    if(canonical.payment_status==='paid'){
     if(verifiedLegacy)throw intakeError('multiple_purchase_review_required');
     if(old.contact_snapshot?.email?.toLowerCase()!==locked.owner_email && old.recipient?.toLowerCase()!==locked.owner_email)throw intakeError('purchase_owner_review_required',403);
     const intent=canonical.payment_intent?await stripe.paymentIntents.retrieve(typeof canonical.payment_intent==='string'?canonical.payment_intent:canonical.payment_intent.id,{expand:['latest_charge']}):null;
     const charge=intent?.latest_charge;
     if(intent?.status!=='succeeded'||intent.amount_received!==old.amount_cents||intent.currency!=='usd'||intent.livemode!==true||!charge?.paid||!charge.created)throw intakeError('legacy_payment_review_required');
     verifiedLegacy={...old,canonical,paid_at:new Date(charge.created*1000)};
    } else if(canonical.status!=='expired')throw intakeError('legacy_checkout_reconciliation_required');
   }
   const reserved = legacy.find(old => !old.stripe_session_id);
   const setupAmount = reserved?.amount_cents || 10000;
   const amount=verifiedLegacy?0:setupAmount;
   row=(await db.query(`INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,prospect_id,tenant_key,plan_code,billing_interval,livemode,amount_cents,setup_amount_cents,legacy_checkout_id,paid_at,stripe_price_id,legacy_payment_intent_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [`purchase_${crypto.randomUUID()}`,intake.intake_id,intake.owner_email,prospect?.prospect_id||null,tenantKey,payload.planCode,payload.billingInterval,amount,verifiedLegacy?.amount_cents||setupAmount,verifiedLegacy?.checkout_id||null,verifiedLegacy?.paid_at||null,priceId,(typeof verifiedLegacy?.canonical.payment_intent==='string'?verifiedLegacy.canonical.payment_intent:verifiedLegacy?.canonical.payment_intent?.id)||null])).rows[0];
   await db.query('UPDATE paid_intakes SET payload_json=$2::jsonb,prospect_id=$3 WHERE intake_id=$1',[intake.intake_id,JSON.stringify({...payload,_paymentQuote:locked.payload_json._paymentQuote}),prospect?.prospect_id||null]);
  }
  if(row.stripe_session_id){
   const current=await stripe.checkout.sessions.retrieve(row.stripe_session_id);
   if(current.status==='open' && current.url)return {url:current.url,status:'checkout',purchaseId:row.purchase_id};
   if(current.status==='complete')return {status:'payment_processing',purchaseId:row.purchase_id};
   if(current.status!=='expired')throw intakeError('checkout_reconciliation_required');
   // An expired session must not have established a subscription or payment.
   if(current.subscription||current.payment_intent||current.payment_status==='paid')throw intakeError('checkout_reconciliation_required');
   row=(await db.query(`UPDATE paid_purchases SET stripe_session_id=NULL,checkout_params=NULL,checkout_started_at=NULL,
    checkout_generation=checkout_generation+1 WHERE purchase_id=$1 RETURNING *`,[row.purchase_id])).rows[0];
  }
  if(row.checkout_started_at && Date.now()-new Date(row.checkout_started_at).getTime()>23*60*60*1000)throw intakeError('checkout_uncertainty_requires_reconciliation');
  const terms=row.consent_terms_json||purchaseTerms(row);
  await db.query('UPDATE paid_purchases SET consent_terms_json=$2::jsonb,consent_accepted_at=COALESCE(consent_accepted_at,NOW()) WHERE purchase_id=$1',[row.purchase_id,JSON.stringify(terms)]);
  row=await ensurePurchaseCustomer(db,row,stripe);
  const metadata={paid_purchase_id:row.purchase_id,paid_intake_id:row.intake_id,plan_code:row.plan_code,billing_interval:row.billing_interval,terms_version:terms.version,paid_checkout_generation:String(row.checkout_generation)};
  const includedEnd=calendarMonthBoundary(row.paid_at||new Date(),1);
  if(row.legacy_checkout_id && includedEnd.getTime()<=Date.now())throw intakeError('historical_purchase_term_review_required');
  const params=row.checkout_params||{mode:row.amount_cents>0?'payment':'setup',customer:row.stripe_customer_id,payment_method_types:['card'],
   client_reference_id:row.purchase_id,metadata,success_url:`${appOrigin()}/intake?checkout=success`,cancel_url:`${appOrigin()}/intake?checkout=cancel`,
   consent_collection:{terms_of_service:'required'},
   ...(row.amount_cents>0?{line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:row.amount_cents,product_data:{name:'EveryCall setup — selected plan’s first month included'}}}],
    payment_intent_data:{setup_future_usage:'off_session',metadata},invoice_creation:{enabled:true,invoice_data:{metadata}}}:{currency:'usd',setup_intent_data:{metadata}}),
   custom_text:{submit:{message:purchaseTermsMessage(terms)}}};
  // Save exact params before the provider call; retries use the identical key and body.
  await db.query('UPDATE paid_purchases SET checkout_started_at=COALESCE(checkout_started_at,NOW()),checkout_params=$2::jsonb,payment_status=\'pending\' WHERE purchase_id=$1',[row.purchase_id,JSON.stringify(params)]);
  // Commit the reservation before any uncertain provider write. A timeout must retain
  // its exact idempotency key/body; never manufacture a new purchase on retry.
  await db.query('COMMIT');
  await db.query('BEGIN');
  await db.query('SELECT purchase_id FROM paid_purchases WHERE purchase_id=$1 FOR UPDATE',[row.purchase_id]);
  const checkout=await stripe.checkout.sessions.create(params,{idempotencyKey:`${row.purchase_id}:checkout:${row.checkout_generation}`});
  if(checkout.livemode!==true||!checkout.id||!checkout.url)throw intakeError('checkout_mode_mismatch',502);
  await db.query('UPDATE paid_purchases SET stripe_session_id=$2,checkout_url=$3,checkout_expires_at=to_timestamp($4),updated_at=NOW() WHERE purchase_id=$1',[row.purchase_id,checkout.id,checkout.url,checkout.expires_at]);
  return {url:checkout.url,status:'checkout',purchaseId:row.purchase_id};
 });
}

export async function getIntakeQuote(db,intake,{stripe=null}={}) {
 const purchase=(await db.query("SELECT * FROM paid_purchases WHERE intake_id=$1 AND kind='setup'",[intake.intake_id])).rows[0];
 if(purchase)return {amountDueNowCents:purchase.payment_status==='paid'?0:purchase.amount_cents,currency:'usd',kind:purchase.amount_cents===0||purchase.payment_status==='paid'?'consent':'setup',setupAmountCents:purchase.setup_amount_cents,isLiveTest:purchase.setup_amount_cents===100,requiresRecurringConsent:purchase.payment_status!=='paid'&&!purchase.recurring_consent_at,ready:true,reason:null};
 const matches=intake.payload_json.website?(await db.query('SELECT prospect_id FROM sales_prospects WHERE sales_website_domain(website_url)=sales_website_domain($1)',[intake.payload_json.website])).rows:[];
 if(matches.length>1||(intake.prospect_id&&matches[0]&&intake.prospect_id!==matches[0].prospect_id))throw intakeError('identity_review_required');
 const prospects=intake.prospect_id?[{prospect_id:intake.prospect_id}]:matches;
 if(prospects.length>1)throw intakeError('identity_review_required');
 const historical=prospects.length?(await db.query('SELECT * FROM sales_checkout_sessions WHERE prospect_id=$1 AND is_test=FALSE ORDER BY created_at',[prospects[0].prospect_id])).rows:[];
 let amount=10000,paid=null,ready=true;
 for(const old of historical){
  if(old.contact_snapshot?.email?.toLowerCase()!==intake.owner_email&&old.recipient?.toLowerCase()!==intake.owner_email)throw intakeError('purchase_owner_review_required',403);
  amount=old.amount_cents;
  if(!old.stripe_session_id)continue;
  const client=stripe||getStripe();
  const session=await client.checkout.sessions.retrieve(old.stripe_session_id);
  if(session.livemode!==true||session.mode!=='payment'||session.metadata?.sales_checkout_id!==old.checkout_id||session.amount_total!==old.amount_cents||session.currency!=='usd')throw intakeError('legacy_payment_review_required');
  if(session.payment_status==='paid'){
   const payment=await client.paymentIntents.retrieve(typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id);
   if(payment.status!=='succeeded'||payment.livemode!==true||payment.currency!=='usd'||payment.amount_received!==old.amount_cents)throw intakeError('legacy_payment_review_required');
   if(paid)throw intakeError('multiple_purchase_review_required');paid=old;
  }else if(session.status!=='expired')ready=false;
 }
 return {amountDueNowCents:paid?0:amount,currency:'usd',kind:paid?'consent':'setup',setupAmountCents:amount,isLiveTest:amount===100,requiresRecurringConsent:true,ready,reason:ready?null:'legacy_checkout_reconciliation_required'};
}

function withoutQuote(value){const {_paymentQuote,...payload}=value||{};return payload;}
export async function createIntakeQuote(pool,intake,body,{stripe=getStripe()}={}){
 await assertPaidIntakeEnabled(pool);
 const payload=normalizeIntake({...intake.payload_json,...body,loginEmail:intake.owner_email});
 payload.marketingAttribution=intake.payload_json.marketingAttribution||{};
 if(body.loginEmail&&body.loginEmail.toLowerCase().trim()!==intake.owner_email)throw intakeError('owner_email_changed',403);
 return intakeTransaction(pool,async db=>{
  const current=(await db.query('SELECT * FROM paid_intakes WHERE intake_id=$1 FOR UPDATE',[intake.intake_id])).rows[0];
  const purchase=(await db.query("SELECT * FROM paid_purchases WHERE intake_id=$1 AND kind='setup'",[intake.intake_id])).rows[0];
  if(purchase&&!isDeepStrictEqual(withoutQuote(current.payload_json),payload))throw intakeError('checkout_already_reserved_review_existing');
  const quote=await getIntakeQuote(db,{...current,payload_json:payload},{stripe});
  const terms=purchaseTerms({kind:'setup',plan_code:payload.planCode,billing_interval:payload.billingInterval,amount_cents:quote.amountDueNowCents,setup_amount_cents:quote.setupAmountCents});
  const saved={token:token(),expiresAt:new Date(Date.now()+30*60000).toISOString(),payload,quote,terms};
  await db.query('UPDATE paid_intakes SET payload_json=$2::jsonb WHERE intake_id=$1',[intake.intake_id,JSON.stringify({...payload,_paymentQuote:saved})]);
  return {quote:{...quote,token:saved.token,expiresAt:saved.expiresAt,planCode:payload.planCode,billingInterval:payload.billingInterval,terms}};
 });
}
async function assertCheckoutQuote(db,intake,payload,quoteToken,stripe){
 const saved=intake.payload_json?._paymentQuote;
 if(!saved||saved.token!==quoteToken||new Date(saved.expiresAt)<=new Date()||!isDeepStrictEqual(saved.payload,payload))throw intakeError('payment_quote_changed_refresh_required');
 const current=await getIntakeQuote(db,{...intake,payload_json:payload},{stripe});
 if(!current.ready||!isDeepStrictEqual(current,saved.quote))throw intakeError('payment_quote_changed_refresh_required');
 const terms=purchaseTerms({kind:'setup',plan_code:payload.planCode,billing_interval:payload.billingInterval,amount_cents:current.amountDueNowCents,setup_amount_cents:current.setupAmountCents});
 if(!isDeepStrictEqual(terms,saved.terms))throw intakeError('payment_quote_changed_refresh_required');
}
