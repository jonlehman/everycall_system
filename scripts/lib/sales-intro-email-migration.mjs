import crypto from 'node:crypto';
import { readMigration, migrationBody } from './schema-migrations.mjs';
import { ensureTables } from '../../pages/api/_lib/db.js';

export const SALES_INTRO_MIGRATION='0060_sales_intro_email.sql';
// These are the reviewed explicit-schema baseline and every subsequent receipt.
// This runner does not infer or replay historical migrations covered by baseline.
export const SALES_INTRO_PREDECESSORS=Object.freeze(['0050_live_brief_curation.sql','0051_production_recovery.sql','0052_knowledge_source_integrity.sql','0053_knowledge_governance.sql','0054_call_processing_recovery.sql','0055_explicit_schema_baseline.sql','0056_sales_dialer_v2.sql','0057_sales_phone_test_mode.sql','0058_sales_prospect_checkout.sql','0059_sales_company_contacts.sql']);
export const introMigrationDigest=sql=>crypto.createHash('sha256').update(sql).digest('hex');
export function salesIntroTargetFingerprint(databaseUrl) {
  const target=new URL(databaseUrl);
  if(!['postgres:','postgresql:'].includes(target.protocol)||!target.hostname||!target.pathname||target.pathname==='/')throw Error('invalid_database_target');
  return introMigrationDigest(`${target.hostname}:${target.port||'5432'}${target.pathname}`);
}
const triggers={sales_intro_email_immutable_guard:'sales_intro_email_deliveries',sales_intro_email_mode_guard:'sales_dialer_config',sales_intro_email_company_guard:'sales_prospects',sales_intro_email_contact_guard:'sales_prospect_contacts',sales_intro_email_number_guard:'sales_prospect_contact_numbers'};
const ownedRelations=['sales_intro_email_deliveries','sales_intro_email_deliveries_pkey','sales_intro_email_key_idx','sales_intro_email_unresolved_idx'];
const ownedFunctions=['sales_intro_email_immutable','sales_intro_email_pending_guard'];
const columns=['draft_token','prospect_id','contact_id','rep_user_id','sales_call_id','expected_row_version','recipient_hash','reply_to_hash','requires_email_permission','confirmed_email_permission','request_hash','idempotency_key','status','provider','provider_message_id','created_at','expires_at','attempted_at','completed_at','reconciled_by','reconciled_at','resolution_evidence_ref'];

export async function verifySalesIntroEmailSchema(db) {
  const result=await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sales_intro_email_deliveries'");
  const found=new Set(result.rows.map(row=>row.column_name));
  if(columns.some(column=>!found.has(column)))throw Error('intro_migration_columns_missing');
  const indexes=await db.query(`SELECT c.relname,i.indisvalid,i.indisunique,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='sales_intro_email_deliveries'::regclass`);
  const definitions=new Map(indexes.rows.map(row=>[row.relname,row]));
  for(const name of ['sales_intro_email_deliveries_pkey','sales_intro_email_key_idx','sales_intro_email_unresolved_idx']) {
    const index=definitions.get(name);if(!index?.indisvalid||!index.indisunique)throw Error('intro_migration_indexes_missing');
  }
  if(!/\(prospect_id\).*sending.*uncertain/s.test(definitions.get('sales_intro_email_unresolved_idx').definition)
    || !/\(rep_user_id, idempotency_key\).*idempotency_key IS NOT NULL/s.test(definitions.get('sales_intro_email_key_idx').definition))throw Error('intro_migration_indexes_invalid');
  const fk=await db.query("SELECT convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='sales_intro_email_deliveries'::regclass AND conname='sales_intro_email_contact_company_fk'");
  if(!fk.rows[0]?.convalidated||!/FOREIGN KEY \(prospect_id, contact_id\) REFERENCES sales_prospect_contacts\(prospect_id, contact_id\)/.test(fk.rows[0].definition))throw Error('intro_migration_contact_fk_missing');
  const installed=await db.query(`SELECT t.tgname,t.tgenabled,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND t.tgname=ANY($1::text[])`,[Object.keys(triggers)]);
  if(Object.entries(triggers).some(([name,table])=>!installed.rows.some(row=>row.tgname===name&&row.relname===table&&['O','A'].includes(row.tgenabled))))throw Error('intro_migration_triggers_missing');
  return {table:true,columns:columns.length,indexes:3,triggers:Object.keys(triggers).length,contactCompanyForeignKey:true};
}

export async function applySalesIntroEmailMigration(pool, options) {
  const startedAt=performance.now();
  const {databaseUrl,expectedTargetFingerprint,reviewedRevision,currentRevision,expectedMigrationSha256,drainEvidenceReference,salesIngressFenced,salesJobsPaused,providerLegsDrained,onlineAdditive=false,releaseEvidenceReference}=options||{};
  const targetFingerprint=salesIntroTargetFingerprint(databaseUrl);
  if(!expectedTargetFingerprint||expectedTargetFingerprint!==targetFingerprint)throw Error('intro_migration_target_mismatch');
  if(!/^[a-f0-9]{40}$/.test(reviewedRevision||'')||reviewedRevision!==currentRevision)throw Error('intro_migration_reviewed_revision_mismatch');
  if(typeof onlineAdditive!=='boolean')throw Error('intro_migration_online_mode_invalid');
  if(onlineAdditive){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{5,159}$/.test(releaseEvidenceReference||''))throw Error('intro_migration_online_release_evidence_required');
    if(drainEvidenceReference||salesIngressFenced||salesJobsPaused||providerLegsDrained)throw Error('intro_migration_online_drain_attestation_not_applicable');
  }else if(salesIngressFenced!==true||salesJobsPaused!==true||providerLegsDrained!==true||!/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{5,159}$/.test(drainEvidenceReference||''))throw Error('intro_migration_sales_drain_evidence_required');
  const sql=await readMigration(SALES_INTRO_MIGRATION);
  if(!expectedMigrationSha256||introMigrationDigest(sql)!==expectedMigrationSha256)throw Error('intro_migration_reviewed_sql_mismatch');
  const client=await pool.connect();
  let connectionError;
  const observeConnectionError=error=>{connectionError=error;};
  client.on?.('error',observeConnectionError);
  let transactionStartedAt;
  const elapsed=()=>({elapsedMs:Math.round(performance.now()-startedAt),transactionElapsedMs:transactionStartedAt===undefined?0:Math.round(performance.now()-transactionStartedAt)});
  try {
    transactionStartedAt=performance.now();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='3s'");
    if(onlineAdditive){
      // PG17+ enforces an overall transaction deadline, including multiple DDL
      // statements and idle gaps. Never silently substitute a per-query bound.
      const supported=await client.query("SELECT current_setting('transaction_timeout',TRUE) AS timeout");
      if(supported.rows[0]?.timeout==null)throw Error('intro_migration_online_transaction_deadline_unavailable');
      await client.query("SET LOCAL transaction_timeout='10s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    }else{
      await client.query("SET LOCAL statement_timeout='30s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    }
    await client.query('SELECT pg_advisory_xact_lock(1763910417)');
    const receipts=await client.query('SELECT name FROM schema_migrations WHERE name=ANY($1::text[])',[SALES_INTRO_PREDECESSORS]);
    const present=new Set(receipts.rows.map(row=>row.name));
    const missing=SALES_INTRO_PREDECESSORS.filter(name=>!present.has(name));
    if(missing.length)throw Object.assign(Error('intro_migration_predecessor_receipts_missing'),{missing});
    await ensureTables({query:(sql,params)=>client.query(sql,params)});
    // Sales-only0058/0059 are not global readiness requirements; check their
    // physical contract here rather than trusting their receipts alone.
    await client.query(`SELECT p.default_contact_id,p.row_version,c.contact_id,n.number_id,x.is_test,x.contact_snapshot,b.attendee_snapshot,b.provider_payload
      FROM sales_prospects p JOIN sales_prospect_contacts c ON c.prospect_id=p.prospect_id
      JOIN sales_prospect_contact_numbers n ON n.prospect_id=p.prospect_id
      JOIN sales_checkout_sessions x ON x.prospect_id=p.prospect_id
      JOIN sales_setup_bookings b ON FALSE LIMIT 0`);
    const nullable=await client.query("SELECT attnotnull FROM pg_attribute WHERE attrelid='sales_checkout_sessions'::regclass AND attname='sales_call_id' AND NOT attisdropped");
    const previousGuards=await client.query("SELECT tgname FROM pg_trigger WHERE tgrelid IN ('sales_prospect_contacts'::regclass,'sales_prospect_contact_numbers'::regclass,'sales_checkout_sessions'::regclass) AND tgenabled IN ('O','A') AND tgname IN ('sales_company_contacts_guard','sales_company_numbers_guard','sales_checkout_mode_immutable_trigger')");
    if(nullable.rows[0]?.attnotnull!==false||previousGuards.rowCount!==3)throw Error('intro_migration_predecessor_schema_drift');
    const installed=await client.query('SELECT name FROM schema_migrations WHERE name=$1',[SALES_INTRO_MIGRATION]);
    if(installed.rowCount){const physical=await verifySalesIntroEmailSchema(client);await client.query('COMMIT');return {applied:false,migration:SALES_INTRO_MIGRATION,targetFingerprint,reviewedRevision,onlineAdditive,...(onlineAdditive?{releaseEvidenceReference}:{}),physical,...elapsed()};}
    const mode=await client.query('SELECT id FROM sales_dialer_config WHERE id=TRUE FOR UPDATE NOWAIT');
    if(!mode.rowCount)throw Error('intro_migration_sales_config_missing');
    // Mode alone does not fence followup/demo/signup workers. Table locks close
    // their DB race. The approved online exception is only brand-new empty0060;
    // it does not assert that external ingress was paused or provider legs drained.
    // NOWAIT fails instead of deadlocking with an ingress awaiting the mode row.
    await client.query(`LOCK TABLE sales_dialer_config,sales_prospects,sales_prospect_contacts,sales_prospect_contact_numbers,
      sales_call_sessions,sales_call_events,sales_incoming_calls,sales_checkout_sessions,sales_setup_bookings,
      sales_signup_invitations,sales_demo_jobs,sales_followup_jobs,sales_idempotency_keys,schema_migrations IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    if((await client.query('SELECT name FROM schema_migrations WHERE name=$1',[SALES_INTRO_MIGRATION])).rowCount)throw Error('intro_migration_receipt_changed_before_ddl');
    // Migration SQL uses IF NOT EXISTS/CREATE OR REPLACE/DROP TRIGGER. Without
    // a receipt any existing owned object is an unreviewed partial installation,
    // even if it is empty or has an apparently compatible definition. Check all
    // relation kinds, every function overload, and trigger names on any table.
    const collisions=await client.query(`SELECT 'relation' AS kind,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])
      UNION ALL SELECT 'function',p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND p.proname=ANY($2::text[])
      UNION ALL SELECT 'trigger',t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND t.tgname=ANY($3::text[])`,[ownedRelations,ownedFunctions,Object.keys(triggers)]);
    if(collisions.rowCount)throw Object.assign(Error('intro_migration_owned_object_collision'),{collisions:collisions.rows});
    const activity=await client.query(`SELECT
      (SELECT count(*) FROM sales_call_sessions WHERE state NOT IN ('closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled')) AS active_calls,
      (SELECT count(*) FROM sales_call_sessions WHERE state NOT IN ('closed','ended','completed','failed') AND
        (state IN ('preparing_call','ending_demo','ending') OR (ai_state='dialing_standby' AND (conference_id IS NULL OR prospect_call_control_id IS NULL OR ai_telnyx_call_control_id IS NULL)) OR (openai_call_id IS NOT NULL AND ai_state IN ('sip_connected','accepting','accepting_sip_connected','realtime_ready_waiting_sip','ready','joining','live','pausing','paused')))) AS recoverable_calls,
      (SELECT count(*) FROM sales_call_events WHERE processing_status IN ('received','processing','failed')) AS recoverable_events,
      (SELECT count(*) FROM sales_incoming_calls WHERE state IN ('ringing','routing')) AS incoming_calls,
      (SELECT count(*) FROM sales_checkout_sessions WHERE status IN ('creating','created','sending','delivery_uncertain')) AS checkout_deliveries,
      (SELECT count(*) FROM sales_checkout_sessions WHERE paid_at IS NOT NULL AND activation_status IN ('queued','failed','building')) AS paid_activations,
      (SELECT count(*) FROM sales_setup_bookings WHERE status='reserving') AS setup_reservations,
      (SELECT count(*) FROM sales_signup_invitations WHERE status IN ('pending','sending') AND revoked_at IS NULL) AS signup_deliveries,
      (SELECT count(*) FROM sales_demo_jobs WHERE status IN ('queued','leased')) AS demo_jobs,
      (SELECT count(*) FROM sales_followup_jobs WHERE status IN ('queued','leased')) AS followup_jobs,
      (SELECT count(*) FROM sales_idempotency_keys WHERE state='processing') AS mutations`);
    const counts=Object.fromEntries(Object.entries(activity.rows[0]).map(([key,value])=>[key,Number(value)]));
    if(Object.values(counts).some(count=>count!==0))throw Object.assign(Error('intro_migration_sales_work_pending'),{counts});
    await client.query(migrationBody(sql));
    const physical=await verifySalesIntroEmailSchema(client);
    await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[SALES_INTRO_MIGRATION]);
    await client.query('COMMIT');
    return {applied:true,migration:SALES_INTRO_MIGRATION,targetFingerprint,reviewedRevision,migrationSha256:expectedMigrationSha256,onlineAdditive,...(onlineAdditive?{releaseEvidenceReference}:{drainEvidenceReference}),counts,physical,...elapsed()};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});Object.assign(error,elapsed());throw error;}
  finally{client.release(connectionError);client.removeListener?.('error',observeConnectionError);}
}
