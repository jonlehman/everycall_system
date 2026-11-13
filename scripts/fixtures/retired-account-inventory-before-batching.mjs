// Frozen pre-batching inventory oracle from reviewed b748a9b. Test only.
export const RETIRED_ACCOUNT=Object.freeze({tenantKey:'daved',customerId:'cus_VLsYWZAeSoe4Dm',subscriptionId:'sub_1ULAo1FgMKdd4EaWvxkS9kRa',phoneNumberId:'3059998106570458876'});
const PURGE=new Set(['auth_tokens','sessions','tenant_users','tenant_settings','tenant_prompt_profiles','tenant_prompt_section_overrides','tenant_live_prompt_settings','tenant_bootstrap_profiles','tenant_business_hours','tenant_domain_assignments','tenant_active_knowledge_builds','tenant_caller_faq_confirmations','business_call_intents','call_outcome_schemas','knowledge_runtime_profiles','knowledge_readiness_states','knowledge_readiness_reviews','knowledge_builds','knowledge_build_source_artifacts','knowledge_build_source_summaries','knowledge_build_analysis_batches','knowledge_build_fact_vectors','knowledge_build_card_vectors','knowledge_build_cards','knowledge_build_facts','knowledge_build_subtopics','knowledge_build_topics','knowledge_guardrails','knowledge_overrides','knowledge_change_requests','knowledge_core_fact_pin_changes','knowledge_core_fact_prompt_sections','knowledge_core_fact_refresh_state','knowledge_governance_policies','knowledge_coverage_events','source_chunks','source_segments','source_refs','source_intake_sessions','source_intake_items','source_intake_persistence_batches','uploaded_documents','setup_interview_summary_blocks','setup_interview_sessions','setup_interview_intents','routing_rules','onboarding_intake','notification_channel_health','provisioning_jobs','async_jobs','dispatch_queue','incidents','runtime_bundles','kb_audio_cache','kb_block','kb_candidates','kb_catalog_revisions','kb_correction_proposals','kb_flag_email_deliveries','kb_mutation_idempotency','kb_pricing_safety_artifacts','kb_selection','kb_selection_flags','kb_selection_history','kb_selection_state','kb_suppressions','kb_tenant_facts','kb_tenant_notices','live_brief_blocks','live_brief_builds','live_brief_slot_audit','tenants']);
const fail=code=>{throw Error(`legacy_deletion_${code}`);};
const quote=name=>{if(!/^[a-z][a-z0-9_]*$/.test(name))fail('table_name');return `"${name}"`;};
async function scopedTables(db){return (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname=current_schema() AND c.relkind='r' AND a.attname='tenant_key' AND NOT a.attisdropped ORDER BY c.relname`)).rows.map(r=>r.relname);}
export async function captureRetiredAccountInventory(db){
 const tenant=(await db.query('SELECT tenant_key,telnyx_voice_number_id,md5(to_jsonb(t)::text) AS fingerprint FROM tenants t WHERE tenant_key=$1',[RETIRED_ACCOUNT.tenantKey])).rows[0]||null;
 const account=(await db.query('SELECT tenant_key,stripe_customer_id,stripe_subscription_id,stripe_price_id,paid_purchase_id,md5(to_jsonb(b)::text) AS fingerprint FROM tenant_billing_accounts b WHERE tenant_key=$1',[RETIRED_ACCOUNT.tenantKey])).rows[0]||null;
 const names=await scopedTables(db);
 const tables=(await db.query(names.map(table=>`SELECT '${table}' AS "table",count(*)::integer AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS fingerprint FROM ${quote(table)} t WHERE tenant_key=$1`).join(' UNION ALL '),[RETIRED_ACCOUNT.tenantKey])).rows;
 const foreignKeys=(await db.query(`SELECT c.conname,ch.relname AS child,pa.relname AS parent,c.confdeltype,
 ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord)::text[] AS child_columns,
 ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord)::text[] AS parent_columns,
 pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class ch ON ch.oid=c.conrelid JOIN pg_class pa ON pa.oid=c.confrelid
 WHERE n.nspname=current_schema() AND c.contype='f' ORDER BY c.conname,ch.relname`)).rows;
 const dependencies=[];
 for(const fk of foreignKeys.filter(f=>tables.some(t=>t.table===f.parent&&t.count>0)&&PURGE.has(f.parent))){
  const scopedChild=tables.some(t=>t.table===fk.child);
  const join=fk.child_columns.map((col,i)=>`c.${quote(col)}=p.${quote(fk.parent_columns[i])}`).join(' AND ');
  const row=(await db.query(`SELECT count(*)::integer AS count FROM ${quote(fk.child)} c JOIN ${quote(fk.parent)} p ON ${join} WHERE p.tenant_key=$1 ${scopedChild?'AND c.tenant_key IS DISTINCT FROM $1':''}`,[RETIRED_ACCOUNT.tenantKey])).rows[0];
  dependencies.push({constraint:fk.conname,child:fk.child,parent:fk.parent,indirect:!scopedChild,count:row.count});
 }

 const sharing=(await db.query(`SELECT
 (SELECT count(*)::integer FROM tenant_users u JOIN tenant_users other ON lower(other.email)=lower(u.email) AND other.tenant_key<>u.tenant_key WHERE u.tenant_key=$1) AS tenant_users,
 (SELECT count(*)::integer FROM tenant_users u JOIN admin_users a ON lower(a.email)=lower(u.email) WHERE u.tenant_key=$1) AS admins,
 (SELECT count(*)::integer FROM tenants WHERE tenant_key<>$1 AND telnyx_voice_number_id=$2) AS phone,
 (SELECT count(*)::integer FROM tenant_billing_accounts WHERE tenant_key<>$1 AND (stripe_customer_id=$3 OR stripe_subscription_id=$4)) AS billing,
 (SELECT count(*)::integer FROM auth_tokens a JOIN tenant_users u ON (a.user_id=u.id OR lower(a.email)=lower(u.email)) WHERE u.tenant_key=$1 AND a.tenant_key IS DISTINCT FROM $1 AND a.used_at IS NULL AND a.expires_at>NOW()) AS unscoped_auth_tokens,
 (SELECT count(*)::integer FROM sessions s JOIN tenant_users u ON s.user_id=u.id WHERE u.tenant_key=$1 AND s.tenant_key IS DISTINCT FROM $1 AND s.role NOT IN('admin','sales') AND s.expires_at>NOW()) AS unscoped_tenant_sessions`,[RETIRED_ACCOUNT.tenantKey,RETIRED_ACCOUNT.phoneNumberId,RETIRED_ACCOUNT.customerId,RETIRED_ACCOUNT.subscriptionId])).rows[0];
 return {tenant,account,tables,foreignKeys,dependencies,sharing};
}
