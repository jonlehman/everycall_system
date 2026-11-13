import {PRIVATE_OWNER_ACCOUNT as OWNER,privateOwnerSubscriptionTerm,privateOwnerInvoiceCoverage} from '../../lib/privateOwnerBillingContract.js';
import {verifyPrivateOwnerMigration,PRIVATE_OWNER_MIGRATION} from './private-owner-migration.mjs';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readMigration} from './schema-migrations.mjs';
import {UPIB_MIGRATIONS,upibTargetFingerprint,verifyUnifiedPaidBillingInstalled} from './unified-paid-billing-migrations.mjs';

export const cutoverDigest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=code=>{throw Error(`paid_cutover_${code}`);};
const hash=value=>/^[a-f0-9]{64}$/.test(value||'');
const reference=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._/#-]{5,239}$/.test(value)&&!/^(pending|todo|unknown|placeholder)([:/._-]|$)/i.test(value);
const same=(a,b)=>isDeepStrictEqual(a,b);
const CATALOG=[['starter','prod_UN6NVD4uHUpCCj',7450,75990],['growth','prod_UN6NWjuvvRk0EM',12450,126990],['pro','prod_UN6NJxwcNIj30v',17450,177990]];
const REQUIRED_CHECKS=['setup_only_checkout','calendar_monthly_annual','plan_transitions_36','monthly_usage_invoices_39','cancel_undo','payment_method_sca_recovery','full_paid_restart','unknown_effect_recovery','initial_build_readiness'];
const REQUIRED_EVENTS=['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided','invoice.marked_uncollectible','subscription_schedule.created','subscription_schedule.updated','subscription_schedule.released','subscription_schedule.completed','subscription_schedule.canceled','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.created','refund.updated','refund.failed'];
const PRICE_IDS=['price_1UbERsFgMKdd4EaWacK0Wdkq','price_1UbES9FgMKdd4EaWCvIKBY5i','price_1UbESFFgMKdd4EaWYw7Hd5aK','price_1UbESKFgMKdd4EaWN8rANv77','price_1UbESQFgMKdd4EaWFP3AsKJA','price_1UbESVFgMKdd4EaWwFBq2BnM'];

// Capture only identifiers, fingerprints and required billing associations; no
// customer contacts, URLs, provider payloads or credentials enter release output.
export async function capturePaidCutoverInventory(db){
 const tenants=(await db.query('SELECT tenant_key,md5(to_jsonb(t)::text) AS fingerprint FROM tenants t ORDER BY tenant_key')).rows;
 const accounts=(await db.query('SELECT tenant_key,stripe_customer_id,stripe_subscription_id,stripe_price_id,paid_purchase_id,md5(to_jsonb(b)::text) AS fingerprint FROM tenant_billing_accounts b ORDER BY tenant_key')).rows;
 const checkouts=(await db.query('SELECT checkout_id,stripe_session_id,tenant_key,is_test,amount_cents,(paid_at IS NOT NULL) AS locally_paid,md5(to_jsonb(s)::text) AS fingerprint FROM sales_checkout_sessions s ORDER BY checkout_id')).rows;
 const catalog=(await db.query('SELECT billing_plans_json FROM system_config WHERE id=1')).rows[0]?.billing_plans_json;
 if(!Array.isArray(catalog))fail('catalog_missing');
 return {tenants,accounts,checkouts,catalog};
}

function validateEvidence(bundle,artifacts,now){
 const {inventory,provider,runtime,decisions,acceptance}=artifacts;
 const fresh=value=>{const at=Date.parse(value);return Number.isFinite(at)&&at<=now&&now-at<=10*60*1000;};
 for(const [name,value] of Object.entries({inventory,provider,runtime}))if(!fresh(value.observedAt))fail(`${name}_evidence_stale`);
 if(inventory.phase!=='post_migration_post_retirement')fail('inventory_phase');
 if(decisions.explicitlyChosen!==true||!['retain_billing_disable_legacy_service','preserve_private_owner_delete_retired_account'].includes(decisions.choice)||!reference(decisions.ownerDecisionReference)||!decisions.ownerDecisionQuote?.trim())fail('explicit_owner_decision_required');
 if(acceptance.reviewedRevision!==bundle.reviewedRevision||acceptance.testLivemode!==false||!reference(acceptance.independentReviewReference))fail('acceptance_review_required');
 for(const check of REQUIRED_CHECKS)if(acceptance.checks?.[check]?.status!=='passed'||!reference(acceptance.checks[check].evidenceReference))fail(`acceptance_${check}`);
 for(const component of ['app','gateway','worker']){
  const deployment=runtime[component];
  if(deployment?.revision!==bundle.reviewedRevision||deployment.healthy!==true||!reference(deployment.evidenceReference))fail(`runtime_${component}`);
 }
 const site=runtime.website;
 if(!/^[a-f0-9]{40}$/.test(bundle.reviewedWebsiteRevision||'')||site?.revision!==bundle.reviewedWebsiteRevision||site.production!==true||site.healthy!==true||site.canonicalOrigin!=='https://www.everycall.io'||!Array.isArray(site.origins)||site.origins.length!==2||['https://everycall.io','https://www.everycall.io'].some(origin=>!site.origins.some(proof=>proof.origin===origin&&proof.revision===bundle.reviewedWebsiteRevision&&proof.healthy===true&&proof.disclosuresVerified===true&&reference(proof.evidenceReference)))||site.disclosuresVerified!==true||!reference(site.evidenceReference))fail('canonical_website');
 if(runtime.app.canonicalOrigin!=='https://app.everycall.io'||runtime.app.production!==true)fail('canonical_app');
 const retirement=runtime.retirement,switched=Date.parse(retirement?.canonicalChangedAt),retired=Date.parse(retirement?.completedAt);
 if(!Number.isFinite(switched)||!Number.isFinite(retired)||retired>now||retired-switched<810000||Date.parse(inventory.observedAt)<retired||Date.parse(provider.observedAt)<retired
  ||retirement.oldRevision!=='17195749a3cd70b421db34c2f4f244d9f153b0e3'||retirement.configuredFunctionMaximumSeconds!==300||!reference(retirement.durationEvidenceReference)
  ||retirement.oldCanonicalIngressRemoved!==true||retirement.oldWorkerInstancesAbsent!==true)fail('old_creators_not_retired');
 if(provider.stripeContext!=='acct_16FSzlFgMKdd4EaW'||provider.livemode!==true||provider.unknownEffects!==0)fail('provider_identity_or_uncertainty');
 if(provider.openCheckouts?.everycallOpenCount!==0||provider.openCheckouts?.unclassifiedPotentialEverycallCount!==0||provider.openCheckouts?.hasMore!==false)fail('open_checkout_reconciliation');
 const prices=provider.prices;if(!Array.isArray(prices)||prices.length!==6||new Set(prices.map(p=>p.id)).size!==6||PRICE_IDS.some(id=>!prices.some(p=>p.id===id)))fail('six_prices_required');
 const bindings=CATALOG.map(([code,product,month,year])=>{
  const pair={code,stripeProductId:product};
  for(const [interval,amount,field] of [['month',month,'stripePriceId'],['year',year,'stripeAnnualPriceId']]){
   const found=prices.filter(p=>p.lookup_key===`everycall_upib_20261112_live_${code}_${interval}`);
   if(found.length!==1)fail('price_lookup_identity');const p=found[0];
   if(!/^price_[a-zA-Z0-9]+$/.test(p.id)||p.active!==true||p.livemode!==true||p.currency!=='usd'||p.unit_amount!==amount||p.product!==product
    ||p.recurring?.interval!==interval||p.recurring?.interval_count!==1||p.recurring?.usage_type!=='licensed'||p.metadata?.app!=='everycall'||p.metadata?.environment!=='live')fail('price_contract');
   pair[field]=p.id;
  }return pair;
 });
 const portal=provider.portal,f=portal?.features;
 if(portal?.id!=='bpc_1TOPabFgMKdd4EaWds7cfGmz'||portal.active!==true||portal.livemode!==true||portal.is_default!==false||portal.metadata?.app!=='everycall'||portal.metadata?.environment!=='live'
  ||f?.subscription_update?.enabled!==false||f.subscription_cancel?.enabled!==true||f.subscription_cancel?.mode!=='at_period_end'||f.subscription_cancel?.proration_behavior!=='none'||f.payment_method_update?.enabled!==true||f.invoice_history?.enabled!==true)fail('portal_contract');
 const allowed=f.subscription_update.products;
 if(!Array.isArray(allowed)||allowed.length!==3||bindings.some(b=>{const p=allowed.find(v=>v.product===b.stripeProductId);return !p||!same([...p.prices].sort(),[b.stripePriceId,b.stripeAnnualPriceId].sort());}))fail('portal_allowlist');
 const webhook=provider.webhook;
 if(webhook?.id!=='we_1TOQPjFgMKdd4EaWTv57cXtZ'||webhook.status!=='enabled'||webhook.api_version!=='2026-02-25.clover'||webhook.livemode!==true
  ||!hash(webhook.urlSha256)||webhook.urlSha256!==bundle.originalWebhookUrlSha256||!reference(webhook.signingConfigurationEvidenceReference)
  ||!Array.isArray(webhook.enabled_events)||REQUIRED_EVENTS.some(e=>!webhook.enabled_events.includes(e))||!Array.isArray(bundle.originalWebhookEvents)||bundle.originalWebhookEvents.some(e=>!webhook.enabled_events.includes(e)))fail('webhook_contract');
 if(!reference(provider.canonicalReadbackEvidenceReference))fail('provider_readback_reference');
 const snapshot=inventory.snapshot;
 if(!snapshot||!Array.isArray(snapshot.tenants)||!Array.isArray(snapshot.accounts)||!Array.isArray(snapshot.checkouts))fail('inventory_shape');
 const mixed=decisions.choice==='preserve_private_owner_delete_retired_account';
 const legacy=snapshot.accounts.filter(a=>a.stripe_subscription_id&&!a.paid_purchase_id);
 const actions=decisions.subscriptionActions;
 if(!Array.isArray(actions)||actions.length!==legacy.length||new Set(actions.map(a=>a.tenant_key)).size!==actions.length)fail('legacy_decision_coverage');
 for(const row of legacy){
  const action=actions.find(a=>a.tenant_key===row.tenant_key),canonical=provider.legacySubscriptions?.find(s=>s.id===row.stripe_subscription_id);
  if(!action||action.stripe_subscription_id!==row.stripe_subscription_id)fail('legacy_decision_mismatch');
  if(mixed){
   if(row.tenant_key===OWNER.tenantKey){if(action.service!=='preserved_private_owner'||action.providerBilling!=='unchanged_private_price')fail('private_owner_decision');}
   else if(row.tenant_key==='daved'){if(action.service!=='account_deleted'||action.providerBilling!=='canceled_collection_stopped'||!hash(action.deletionBundleSha256)||canonical?.status!=='canceled'||snapshot.tenants.some(t=>t.tenant_key==='daved'))fail('deleted_account_decision');}
   else fail('unmapped_mixed_legacy');
  }else if(action.service!=='disabled'||action.providerBilling!=='unchanged')fail('legacy_decision_mismatch');
  if(!canonical||canonical.livemode!==true||canonical.customer!==row.stripe_customer_id||canonical.priceId!==row.stripe_price_id)fail('legacy_subscription_readback');
 }
 const dispositions=inventory.tenantDispositions;
 if(!Array.isArray(dispositions)||dispositions.length!==snapshot.tenants.length||new Set(dispositions.map(t=>t.tenant_key)).size!==dispositions.length
  ||snapshot.tenants.some(t=>!dispositions.some(d=>d.tenant_key===t.tenant_key&&['retain_no_entitlement','preserve_paid_setup_owner_consent','legacy_subscription_manual_inactive','private_owner_service_preserved'].includes(d.action))))fail('tenant_mapping_incomplete');
 if(!mixed&&legacy.some(a=>dispositions.find(d=>d.tenant_key===a.tenant_key)?.action!=='legacy_subscription_manual_inactive'))fail('legacy_tenant_mapping');
 if(mixed&&(legacy.length!==2||dispositions.find(d=>d.tenant_key===OWNER.tenantKey)?.action!=='private_owner_service_preserved'))fail('mixed_tenant_mapping');
 for(const row of snapshot.checkouts.filter(s=>!s.is_test&&s.stripe_session_id)){
  const proof=provider.legacyCheckouts?.find(s=>s.sessionId===row.stripe_session_id);
  if(!proof||proof.livemode!==true||proof.mode!=='payment'||proof.currency!=='usd'||proof.amountCents!==row.amount_cents||proof.checkoutId!==row.checkout_id)fail('legacy_checkout_readback');
  if(row.locally_paid){if(proof.status!=='complete'||proof.paymentStatus!=='paid'||proof.paymentIntentStatus!=='succeeded'||proof.amountReceived!==row.amount_cents||proof.chargePaid!==true||proof.chargeCaptured!==true)fail('legacy_paid_setup');}
  else if(proof.status!=='expired'||proof.paymentStatus!=='unpaid'||proof.paymentIntentId||proof.subscriptionId)fail('legacy_unpaid_checkout');
 }
 if(snapshot.catalog.length!==3||new Set(snapshot.catalog.map(p=>p.code)).size!==3||snapshot.catalog.some(p=>!bindings.some(b=>b.code===p.code)))fail('catalog_shape');
 let owner=null;
 if(mixed){
  const proof=provider.privateOwner;
  const term=privateOwnerSubscriptionTerm(proof?.subscription),coverage=privateOwnerInvoiceCoverage(proof?.invoice,term);
  const invoices=proof.invoiceInventory;
  if(invoices?.hasMore!==false||!Array.isArray(invoices.data)||!invoices.data.some(i=>i.id===coverage.invoiceId)
   ||invoices.data.some(i=>i.livemode!==true||i.customer!==OWNER.customerId||i.subscription!==OWNER.subscriptionId||!['paid','void'].includes(i.status)||Number(i.amount_remaining)!==0)
   ||proof.pendingInvoiceItems?.hasMore!==false||proof.pendingInvoiceItems.count!==0)fail('private_owner_unresolved_billing_inventory');
  if(term.status!=='active'||term.start*1000>now||term.end*1000<=now||proof.phoneNumberId!=='2943114023983384517'||proof.carrierReady!==true||!reference(proof.carrierEvidenceReference)||!reference(proof.activeBuildId))fail('private_owner_paid_readiness');
  owner={...coverage,term,phoneNumberId:proof.phoneNumberId,activeBuildId:proof.activeBuildId};
 }
 return {bindings:snapshot.catalog.map(p=>({...p,...bindings.find(b=>b.code===p.code)})),legacyKeys:mixed?[]:legacy.map(a=>a.tenant_key),owner};
}

export async function activatePaidIntakeRelease(pool,{bundle,artifacts,bundleSha256,currentRevision,databaseUrl,execute=false}={}){
 if(!hash(bundleSha256)||bundleSha256!==cutoverDigest(bundle))fail('bundle_pin');
 if(!/^[a-f0-9]{40}$/.test(bundle.reviewedRevision||'')||bundle.reviewedRevision!==currentRevision)fail('revision_pin');
 if(bundle.historicalInventorySha256!=='1fe0d43fd940394f24f03d1c66ac988860361803b9d36fc51b8e40c9bbd09eb7'||bundle.inactivePriceReceiptsSha256!=='c7933cb1941564557e66699944cc17ec341609100f0dda1b0aaab2f1b1c4acd4')fail('historical_release_evidence_pin');
 if(bundle.targetFingerprint!==upibTargetFingerprint(databaseUrl))fail('target_pin');
 if(!reference(bundle.evidenceReference)||!Number.isInteger(bundle.actorAdminUserId))fail('operator_evidence');
 for(const name of ['inventory','provider','runtime','decisions','acceptance'])if(!hash(bundle.artifactSha256?.[name])||cutoverDigest(artifacts[name])!==bundle.artifactSha256[name])fail(`artifact_pin_${name}`);
 const sql=await Promise.all(UPIB_MIGRATIONS.map(readMigration));
 for(let n=0;n<sql.length;n++)if(cutoverDigest(sql[n])!==bundle.migrationSha256?.[UPIB_MIGRATIONS[n]])fail('migration_pin');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL transaction_timeout='10s'");await db.query("SET LOCAL statement_timeout='5s'");await db.query("SET LOCAL lock_timeout='250ms'");await db.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
  if(!(await db.query('SELECT pg_try_advisory_xact_lock(1763910417) AS locked')).rows[0].locked)fail('busy');
  await db.query('LOCK TABLE tenants,tenant_billing_accounts,sales_checkout_sessions,paid_purchases,paid_intakes,system_config,paid_intake_release IN SHARE ROW EXCLUSIVE MODE NOWAIT');
  const now=new Date((await db.query('SELECT NOW() AS now')).rows[0].now).getTime();
  const desired=validateEvidence(bundle,artifacts,now);
  const actor=(await db.query('SELECT role FROM admin_users WHERE id=$1 FOR SHARE',[bundle.actorAdminUserId])).rows[0];if(actor?.role!=='admin')fail('admin_actor_required');
  const receipts=(await db.query('SELECT name FROM schema_migrations WHERE name=ANY($1::text[])',[UPIB_MIGRATIONS])).rows;if(receipts.length!==2)fail('migration_receipts');
  const gate=(await db.query('SELECT * FROM paid_intake_release WHERE id=TRUE FOR UPDATE')).rows[0];
  if(gate?.enabled){
   const prior=(await db.query("SELECT 1 FROM audit_log WHERE action='billing.paid_intake.release' AND details::jsonb->>'bundleSha256'=$1",[bundleSha256])).rowCount;
   if(gate.reviewed_revision!==currentRevision||gate.inventory_reference!==`sha256:${bundle.artifactSha256.inventory}`||!prior||!same((await capturePaidCutoverInventory(db)).catalog,desired.bindings))fail('different_existing_release');
   await db.query('ROLLBACK');return{applied:false,alreadyEnabled:true,reviewedRevision:currentRevision};
  }
  await verifyUnifiedPaidBillingInstalled(db,sql[1]);
  if(desired.owner){
   if(!(await db.query('SELECT 1 FROM schema_migrations WHERE name=$1',[PRIVATE_OWNER_MIGRATION])).rowCount)fail('private_owner_schema');
   const ownerSql=await readMigration(PRIVATE_OWNER_MIGRATION);if(cutoverDigest(ownerSql)!==bundle.privateOwnerSqlSha256)fail('private_owner_sql_pin');
   await verifyPrivateOwnerMigration(db,ownerSql);
   const deletion=artifacts.decisions.subscriptionActions.find(a=>a.tenant_key==='daved');
   if(!(await db.query("SELECT 1 FROM audit_log WHERE tenant_key='daved' AND action='tenant.legacy_account.deleted' AND details::jsonb->>'bundleSha256'=$1",[deletion.deletionBundleSha256])).rowCount)fail('deleted_account_receipt');
   const live=(await db.query(`SELECT t.status,t.service_access_status,t.telnyx_release_status,t.telnyx_voice_number_id,b.active_build_id,k.status AS build_status
    FROM tenants t JOIN tenant_active_knowledge_builds b USING(tenant_key) JOIN knowledge_builds k ON k.build_id=b.active_build_id AND k.tenant_key=t.tenant_key WHERE t.tenant_key=$1`,[OWNER.tenantKey])).rows[0];
   if(live?.status!=='active'||live.service_access_status!=='enabled'||live.telnyx_release_status||live.telnyx_voice_number_id!==desired.owner.phoneNumberId||live.active_build_id!==desired.owner.activeBuildId||live.build_status!=='published')fail('private_owner_readiness_changed');
  }
  const actual=await capturePaidCutoverInventory(db);if(!same(actual,artifacts.inventory.snapshot))fail('inventory_or_catalog_changed');
  if((await db.query("SELECT 1 FROM paid_purchases WHERE payment_status IN('pending','review') OR (payment_status='paid' AND recurring_consent_at IS NULL) LIMIT 1")).rowCount)fail('purchase_reconciliation_pending');
  if(!execute){await db.query('ROLLBACK');return{applied:false,dryRun:true,reviewedRevision:currentRevision,legacyServiceDisables:desired.legacyKeys.length,gateEnabled:false};}
  await db.query('UPDATE system_config SET billing_plans_json=$1::jsonb WHERE id=1',[JSON.stringify(desired.bindings)]);
  if(desired.legacyKeys.length)await db.query("UPDATE tenants SET status='inactive',service_access_status='disabled',app_access_status='enabled',billing_lock_reason='legacy_cutover_manual_review' WHERE tenant_key=ANY($1::text[])",[desired.legacyKeys]);
  if(desired.owner){
   const o=desired.owner;
   await db.query(`INSERT INTO private_owner_billing(tenant_key,stripe_customer_id,stripe_subscription_id,stripe_price_id,phone_number_id,owner_decision_reference,evidence_sha256,reviewed_revision,enabled,current_period_start,current_period_end,paid_through,paid_invoice_id,subscription_status,cancel_at_period_end)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,to_timestamp($9),to_timestamp($10),to_timestamp($10),$11,'active',$12)`,[OWNER.tenantKey,OWNER.customerId,OWNER.subscriptionId,OWNER.priceId,o.phoneNumberId,artifacts.decisions.ownerDecisionReference,bundle.artifactSha256.provider,currentRevision,o.start,o.end,o.invoiceId,o.term.cancelAtPeriodEnd]);
  }
  await db.query('UPDATE paid_intake_release SET enabled=TRUE,reviewed_revision=$1,inventory_reference=$2,enabled_at=NOW() WHERE id=TRUE AND enabled=FALSE',[currentRevision,`sha256:${bundle.artifactSha256.inventory}`]);
  await db.query("INSERT INTO audit_log(actor,action,details) VALUES($1,'billing.paid_intake.release',$2)",[`admin:${bundle.actorAdminUserId}`,JSON.stringify({bundleSha256,reviewedRevision:currentRevision,targetFingerprint:bundle.targetFingerprint,evidenceReference:bundle.evidenceReference,artifactSha256:bundle.artifactSha256,ownerDecisionReference:artifacts.decisions.ownerDecisionReference,legacyServiceDisables:desired.legacyKeys,providerBillingChanges:false,privateOwnerServicePreserved:Boolean(desired.owner),deletedAccountReceipt:artifacts.decisions.subscriptionActions.find(a=>a.tenant_key==='daved')?.deletionBundleSha256||null})]);
  await db.query('COMMIT');return{applied:true,reviewedRevision:currentRevision,gateEnabled:true,legacyServiceDisables:desired.legacyKeys.length,bundleSha256};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}
