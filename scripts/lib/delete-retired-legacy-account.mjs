import {isDeepStrictEqual} from 'node:util';
import {cutoverDigest} from './paid-intake-release-cutover.mjs';
import {upibTargetFingerprint} from './unified-paid-billing-migrations.mjs';
export const RETIRED_ACCOUNT=Object.freeze({tenantKey:'daved',customerId:'cus_VLsYWZAeSoe4Dm',subscriptionId:'sub_1ULAo1FgMKdd4EaWvxkS9kRa',phoneNumberId:'3059998106570458876'});
const RETAIN=new Set(['audit_log','kb_purge_audit','tenant_billing_accounts','billing_events','billing_lifecycle_events','billing_periods','billing_coupon_redemptions','billing_invoice_effects','billing_money_reviews','calls','call_events','call_states','call_transcript_analyses','call_answered_questions','call_unanswered_questions','call_alert_links','lead_notification_deliveries','sms_failover_events','support_conversations','support_messages']);
const PURGE=new Set(['auth_tokens','sessions','tenant_users','tenant_settings','tenant_prompt_profiles','tenant_prompt_section_overrides','tenant_live_prompt_settings','tenant_bootstrap_profiles','tenant_business_hours','tenant_domain_assignments','tenant_active_knowledge_builds','tenant_caller_faq_confirmations','business_call_intents','call_outcome_schemas','knowledge_runtime_profiles','knowledge_readiness_states','knowledge_readiness_reviews','knowledge_builds','knowledge_build_allocations','knowledge_build_source_artifacts','knowledge_build_source_summaries','knowledge_build_analysis_batches','knowledge_build_fact_vectors','knowledge_build_card_vectors','knowledge_build_cards','knowledge_build_facts','knowledge_build_subtopics','knowledge_build_topics','knowledge_guardrails','knowledge_overrides','knowledge_change_requests','knowledge_core_fact_pin_changes','knowledge_core_fact_prompt_sections','knowledge_core_fact_refresh_state','knowledge_governance_policies','knowledge_coverage_events','source_chunks','source_segments','source_refs','source_intake_sessions','source_intake_items','source_intake_persistence_batches','uploaded_documents','setup_interview_summary_blocks','setup_interview_sessions','setup_interview_intents','routing_rules','onboarding_intake','notification_channel_health','provisioning_jobs','async_jobs','dispatch_queue','incidents','runtime_bundles','kb_audio_cache','kb_block','kb_candidates','kb_catalog_revisions','kb_correction_proposals','kb_flag_email_deliveries','kb_mutation_idempotency','kb_pricing_safety_artifacts','kb_selection','kb_selection_flags','kb_selection_history','kb_selection_state','kb_suppressions','kb_tenant_facts','kb_tenant_notices','live_brief_blocks','live_brief_builds','live_brief_slot_audit','tenants']);
const BLOCK=new Set(['billing_invoice_debts','billing_delinquencies','billing_reminder_deliveries','billing_call_admissions','paid_number_orders','paid_number_releases','paid_setup_bookings','paid_purchases','paid_billing_changes','staff_support_sessions','sales_checkout_sessions','sales_prospects','integration_connections','integration_deliveries']);
const fail=code=>{throw Error(`legacy_deletion_${code}`);};
const quote=name=>{if(!/^[a-z][a-z0-9_]*$/.test(name))fail('table_name');return `"${name}"`;};
async function scopedTables(db){return (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname=current_schema() AND c.relkind='r' AND a.attname='tenant_key' AND NOT a.attisdropped ORDER BY c.relname`)).rows.map(r=>r.relname);}
async function tableFingerprints(db,names){
 if(!names.length)return [];
 return (await db.query(names.map(table=>`SELECT '${table}' AS "table",count(*)::integer AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS fingerprint FROM ${quote(table)} t WHERE tenant_key=$1`).join(' UNION ALL ')+' ORDER BY "table"',[RETIRED_ACCOUNT.tenantKey])).rows;
}
export async function captureRetiredAccountInventory(db){
 const tenant=(await db.query('SELECT tenant_key,telnyx_voice_number_id,md5(to_jsonb(t)::text) AS fingerprint FROM tenants t WHERE tenant_key=$1',[RETIRED_ACCOUNT.tenantKey])).rows[0]||null;
 const account=(await db.query('SELECT tenant_key,stripe_customer_id,stripe_subscription_id,stripe_price_id,paid_purchase_id,md5(to_jsonb(b)::text) AS fingerprint FROM tenant_billing_accounts b WHERE tenant_key=$1',[RETIRED_ACCOUNT.tenantKey])).rows[0]||null;
 const names=await scopedTables(db);
 const tables=await tableFingerprints(db,names);
 const foreignKeys=(await db.query(`SELECT c.conname,ch.relname AS child,pa.relname AS parent,c.confdeltype,
 ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord)::text[] AS child_columns,
 ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord)::text[] AS parent_columns,
 pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class ch ON ch.oid=c.conrelid JOIN pg_class pa ON pa.oid=c.confrelid
 WHERE n.nspname=current_schema() AND c.contype='f' ORDER BY c.conname,ch.relname`)).rows;
 // Keep every former per-FK predicate, but send one statement rather than
 // one network round trip for each dependency. Input order remains canonical.
 const checks=foreignKeys.filter(f=>tables.some(t=>t.table===f.parent&&t.count>0)&&PURGE.has(f.parent));
 const dependencyCounts=checks.length?(await db.query(checks.map((fk,index)=>{
  const scopedChild=tables.some(t=>t.table===fk.child);
  const join=fk.child_columns.map((col,i)=>`c.${quote(col)}=p.${quote(fk.parent_columns[i])}`).join(' AND ');
  return `SELECT ${index} AS ordinal,count(*)::integer AS count FROM ${quote(fk.child)} c JOIN ${quote(fk.parent)} p ON ${join} WHERE p.tenant_key=$1 ${scopedChild?'AND c.tenant_key IS DISTINCT FROM $1':''}`;
 }).join(' UNION ALL ')+' ORDER BY ordinal',[RETIRED_ACCOUNT.tenantKey])).rows:[];
 const dependencies=checks.map((fk,index)=>({constraint:fk.conname,child:fk.child,parent:fk.parent,indirect:!tables.some(t=>t.table===fk.child),count:dependencyCounts[index].count}));

 const sharing=(await db.query(`SELECT
 (SELECT count(*)::integer FROM tenant_users u JOIN tenant_users other ON lower(other.email)=lower(u.email) AND other.tenant_key<>u.tenant_key WHERE u.tenant_key=$1) AS tenant_users,
 (SELECT count(*)::integer FROM tenant_users u JOIN admin_users a ON lower(a.email)=lower(u.email) WHERE u.tenant_key=$1) AS admins,
 (SELECT count(*)::integer FROM tenants WHERE tenant_key<>$1 AND telnyx_voice_number_id=$2) AS phone,
 (SELECT count(*)::integer FROM tenant_billing_accounts WHERE tenant_key<>$1 AND (stripe_customer_id=$3 OR stripe_subscription_id=$4)) AS billing,
 (SELECT count(*)::integer FROM auth_tokens a JOIN tenant_users u ON (a.user_id=u.id OR lower(a.email)=lower(u.email)) WHERE u.tenant_key=$1 AND a.tenant_key IS DISTINCT FROM $1 AND a.used_at IS NULL AND a.expires_at>NOW()) AS unscoped_auth_tokens,
 (SELECT count(*)::integer FROM sessions s JOIN tenant_users u ON s.user_id=u.id WHERE u.tenant_key=$1 AND s.tenant_key IS DISTINCT FROM $1 AND s.role NOT IN('admin','sales') AND s.expires_at>NOW()) AS unscoped_tenant_sessions`,[RETIRED_ACCOUNT.tenantKey,RETIRED_ACCOUNT.phoneNumberId,RETIRED_ACCOUNT.customerId,RETIRED_ACCOUNT.subscriptionId])).rows[0];
 return {tenant,account,tables,foreignKeys,dependencies,sharing};
}
function validateProvider(proof,now){
 const c=RETIRED_ACCOUNT,at=Date.parse(proof?.observedAt);
 if(!Number.isFinite(at)||at>now||now-at>600000||proof.stripeAccount!=='acct_16FSzlFgMKdd4EaW'||proof.livemode!==true||proof.unknownEffects!==0)fail('provider_evidence');
 const s=proof.subscription;
 if(s?.id!==c.subscriptionId||s.customer!==c.customerId||s.status!=='canceled'||s.livemode!==true||s.schedule)fail('subscription_not_stopped');
 if(proof.invoices?.hasMore!==false||!Array.isArray(proof.invoices.data)||proof.invoices.data.some(i=>i.customer!==c.customerId||i.subscription!==c.subscriptionId||i.livemode!==true||(['open','draft','uncollectible'].includes(i.status)&&(i.auto_advance!==false||i.next_payment_attempt!==null))))fail('invoice_collection_not_stopped');
 if(proof.pendingInvoiceItems?.count!==0||proof.pendingInvoiceItems?.hasMore!==false||proof.schedules?.activeCount!==0||proof.schedules?.hasMore!==false)fail('provider_dependents');
 if(proof.number?.id!==c.phoneNumberId||proof.number.absent!==true||proof.number.canonicalReadback!==true||!proof.number.releaseEvidenceReference)fail('number_release_unresolved');
}
export async function deleteRetiredLegacyAccount(pool,{bundle,bundleSha256,currentRevision,databaseUrl,execute=false}={}){
 if(!bundle||cutoverDigest(bundle)!==bundleSha256||!/^[a-f0-9]{64}$/.test(bundleSha256||''))fail('bundle_pin');
 if(!/^[a-f0-9]{40}$/.test(currentRevision||'')||bundle.reviewedRevision!==currentRevision||bundle.targetFingerprint!==upibTargetFingerprint(databaseUrl))fail('target_revision');
 if(!Number.isSafeInteger(bundle.actorAdminUserId)||!bundle.ownerDecisionReference||!bundle.ownerDecisionQuote||!bundle.independentReviewReference)fail('owner_review');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL transaction_timeout='10s'");await db.query("SET LOCAL statement_timeout='5s'");await db.query("SET LOCAL lock_timeout='250ms'");
  if(!(await db.query('SELECT pg_try_advisory_xact_lock(1763910417) AS locked')).rows[0].locked)fail('busy');
  const tables=await scopedTables(db);
  const descendants=(await db.query(`WITH RECURSIVE affected(oid) AS (
   SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])
   UNION SELECT f.conrelid FROM pg_constraint f JOIN affected a ON a.oid=f.confrelid WHERE f.contype='f'
  ) SELECT n.nspname,c.relname FROM affected a JOIN pg_class c ON c.oid=a.oid JOIN pg_namespace n ON n.oid=c.relnamespace ORDER BY n.nspname,c.relname`,[tables])).rows;
  const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
  if(descendants.some(d=>d.nspname!==schema))fail('external_schema_dependency');
  await db.query(`LOCK TABLE ${descendants.map(d=>`${quote(d.nspname)}.${quote(d.relname)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
  if((await db.query('SELECT role FROM admin_users WHERE id=$1 FOR SHARE',[bundle.actorAdminUserId])).rows[0]?.role!=='admin')fail('actor');
  const prior=(await db.query("SELECT 1 FROM audit_log WHERE tenant_key=$1 AND action='tenant.legacy_account.deleted' AND details::jsonb->>'bundleSha256'=$2",[RETIRED_ACCOUNT.tenantKey,bundleSha256])).rowCount;
  if(prior){if((await db.query('SELECT 1 FROM tenants WHERE tenant_key=$1',[RETIRED_ACCOUNT.tenantKey])).rowCount)fail('deleted_identity_reused');await db.query('ROLLBACK');return {deleted:false,alreadyDeleted:true};}
  const now=new Date((await db.query('SELECT NOW() AS now')).rows[0].now).getTime();validateProvider(bundle.provider,now);
  const runtime=bundle.runtime,retirement=runtime?.retirement;
  if(!runtime||['app','gateway','worker'].some(key=>runtime[key]?.revision!==currentRevision||runtime[key]?.healthy!==true)
   ||!Number.isFinite(Date.parse(runtime.observedAt))||Date.parse(runtime.observedAt)>now||now-Date.parse(runtime.observedAt)>600000
   ||retirement?.oldCanonicalIngressRemoved!==true||retirement?.oldWorkerInstancesAbsent!==true
   ||retirement?.oldRevision!=='17195749a3cd70b421db34c2f4f244d9f153b0e3'||retirement?.configuredFunctionMaximumSeconds!==300
   ||!Number.isFinite(Date.parse(retirement?.completedAt))||Date.parse(retirement.completedAt)>Date.parse(runtime.observedAt)
   ||!Number.isFinite(Date.parse(retirement?.canonicalChangedAt))||Date.parse(retirement.completedAt)-Date.parse(retirement.canonicalChangedAt)<810000)fail('runtime_retirement_required');
  const actual=await captureRetiredAccountInventory(db);if(!isDeepStrictEqual(actual,bundle.inventory))fail('inventory_changed');
  if(actual.tenant?.tenant_key!==RETIRED_ACCOUNT.tenantKey||actual.tenant.telnyx_voice_number_id!==RETIRED_ACCOUNT.phoneNumberId
   ||actual.account?.stripe_customer_id!==RETIRED_ACCOUNT.customerId||actual.account.stripe_subscription_id!==RETIRED_ACCOUNT.subscriptionId||actual.account.paid_purchase_id)fail('identity');
  if(Object.values(actual.sharing).some(n=>n!==0))fail('shared_local_identity');
  if(actual.dependencies.some(d=>d.count>0))fail('indirect_or_cross_tenant_dependents');
  for(const fk of actual.foreignKeys)if(RETAIN.has(fk.child)&&PURGE.has(fk.parent)&&fk.confdeltype==='c'&&actual.tables.find(t=>t.table===fk.child)?.count)fail('retained_cascade_dependency');
  for(const row of actual.tables)if(row.count&&(BLOCK.has(row.table)||(!RETAIN.has(row.table)&&!PURGE.has(row.table))))fail(`unresolved_rows_${row.table}`);
  // This reviewed account has no calls. A contrary fact changes retention scope.
  if(actual.tables.find(r=>r.table==='calls')?.count)fail('call_history_requires_review');
  if((await db.query("SELECT 1 FROM async_jobs WHERE tenant_key=$1 AND status NOT IN('done','completed','failed','dead_letter') UNION ALL SELECT 1 FROM provisioning_jobs WHERE tenant_key=$1 AND status NOT IN('done','completed','failed') UNION ALL SELECT 1 FROM knowledge_builds WHERE tenant_key=$1 AND status NOT IN('failed','published','complete','completed')",[RETIRED_ACCOUNT.tenantKey])).rowCount)fail('active_work');
  // 0052 stores the latest rolling build allocation, not a financial ledger.
  // Its tenant FK cascades on account deletion. Retain the entire original row
  // (including timestamp precision and override attribution) in the purge audit.
  const allocation=actual.tables.find(t=>t.table==='knowledge_build_allocations');
  let allocationSnapshot=null;
  if(allocation?.count){
   if(allocation.count!==1||!tables.includes('kb_purge_audit'))fail('allocation_audit_required');
   const saved=(await db.query("SELECT count(*)::integer AS count,COALESCE(jsonb_agg(to_jsonb(a) ORDER BY to_jsonb(a)::text),'[]'::jsonb) AS rows,md5(COALESCE(jsonb_agg(to_jsonb(a) ORDER BY to_jsonb(a)::text)::text,'[]')) AS fingerprint FROM knowledge_build_allocations a WHERE tenant_key=$1",[RETIRED_ACCOUNT.tenantKey])).rows[0];
   if(saved.count!==allocation.count||saved.fingerprint!==allocation.fingerprint)fail('allocation_snapshot_changed');
   allocationSnapshot={table:'knowledge_build_allocations',rowCount:saved.count,fingerprint:saved.fingerprint,rows:saved.rows};
  }
  if(!execute){await db.query('ROLLBACK');return {deleted:false,dryRun:true,tenantKey:RETIRED_ACCOUNT.tenantKey};}
  await db.query("SELECT set_config('app.purge_context','true',true)");await db.query("SELECT set_config('app.request_id',$1,true)",[`legacy-delete:${bundleSha256}`]);
  // Root tenant deletion performs the schema's reviewed knowledge cascades.
  // Non-cascading operational rows are explicitly removed below. No financial,
  // provider, customer, payment method or global staff object is deleted.
  // The fixed tenant literal contains no request input. A single simple-query
  // message executes these statements in their original order inside this same
  // transaction; any statement failure still rolls back the entire deletion.
  const tenantLiteral="'"+RETIRED_ACCOUNT.tenantKey.replaceAll("'","''")+"'";
  const roots=['sessions','auth_tokens','tenant_users','tenants'];
  const purgeTables=[...roots,...tables.filter(t=>PURGE.has(t)&&!roots.includes(t))];
  await db.query(purgeTables.map(table=>`DELETE FROM ${quote(table)} WHERE tenant_key=${tenantLiteral}`).join('; '));
  const retainedBefore=actual.tables.filter(t=>RETAIN.has(t.table));
  const retainedAfter=await tableFingerprints(db,retainedBefore.map(t=>t.table));
  if(!isDeepStrictEqual(retainedAfter,retainedBefore))fail('retained_history_changed');
  if(tables.includes('kb_purge_audit')){
   const audit=(await db.query("INSERT INTO kb_purge_audit(tenant_key,purge_kind,requested_by,request_id,metadata_json) VALUES($1,'tenant_account_deletion',$2,$3,$4::jsonb) RETURNING metadata_json",[RETIRED_ACCOUNT.tenantKey,`admin:${bundle.actorAdminUserId}`,`legacy-delete:${bundleSha256}`,JSON.stringify({bundleSha256,providerEvidenceSha256:cutoverDigest(bundle.provider),financialHistoryRetained:true,knowledgeBuildAllocation:allocationSnapshot})])).rows[0];
   if(allocationSnapshot&&!isDeepStrictEqual(audit?.metadata_json?.knowledgeBuildAllocation,allocationSnapshot))fail('allocation_audit_mismatch');
  }
  await db.query("UPDATE tenant_billing_accounts SET service_ended_at=COALESCE(service_ended_at,NOW()),stripe_subscription_status='canceled',cancel_at_period_end=FALSE,canceled_at=COALESCE(canceled_at,NOW()) WHERE tenant_key=$1",[RETIRED_ACCOUNT.tenantKey]);
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,'tenant.legacy_account.deleted',$3)",[RETIRED_ACCOUNT.tenantKey,`admin:${bundle.actorAdminUserId}`,JSON.stringify({bundleSha256,ownerDecisionReference:bundle.ownerDecisionReference,reviewedRevision:currentRevision,inventorySha256:cutoverDigest(bundle.inventory),providerEvidenceSha256:cutoverDigest(bundle.provider),financialHistoryRetained:true,allocationSnapshotRetained:Boolean(allocationSnapshot)})]);
  await db.query('COMMIT');return {deleted:true,tenantKey:RETIRED_ACCOUNT.tenantKey,bundleSha256};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}
