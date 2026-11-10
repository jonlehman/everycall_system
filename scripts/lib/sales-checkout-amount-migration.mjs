import crypto from 'node:crypto';
import { readMigration, migrationBody } from './schema-migrations.mjs';
import { ensureTables } from '../../pages/api/_lib/db.js';
import { SALES_INTRO_PREDECESSORS, verifySalesIntroEmailSchema, salesIntroTargetFingerprint } from './sales-intro-email-migration.mjs';

export const SALES_AMOUNT_MIGRATION='0061_sales_checkout_amount.sql';
export const SALES_AMOUNT_PREDECESSORS=Object.freeze([...SALES_INTRO_PREDECESSORS,'0060_sales_intro_email.sql']);
export const SALES_AMOUNT_MAX_ROWS=10000;
export const SALES_AMOUNT_MAX_BYTES=16*1024*1024;
export const amountMigrationDigest=sql=>crypto.createHash('sha256').update(sql).digest('hex');
export const salesAmountTargetFingerprint=salesIntroTargetFingerprint;
const compact=value=>String(value).replace(/\s+/g,' ').trim();

export async function verifySalesCheckoutAmountSchema(db,sql) {
  const column=(await db.query(`SELECT a.atttypid='int4'::regtype AS integer,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='sales_checkout_sessions'::regclass AND a.attname='amount_cents' AND NOT a.attisdropped`)).rows[0];
  if(!column?.integer||!column.attnotnull||column.attidentity||column.attgenerated||column.default_value!=='10000')throw Error('amount_migration_column_drift');
  const constraint=(await db.query(`SELECT convalidated,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='sales_checkout_sessions'::regclass AND conname='sales_checkout_amount_range'`)).rows[0];
  if(!constraint?.convalidated||constraint.contype!=='c'||compact(constraint.definition)!=='CHECK (((amount_cents >= 100) AND (amount_cents <= 99999999)))')throw Error('amount_migration_constraint_drift');
  const functions=(await db.query(`SELECT p.oid,p.pronargs,p.prorettype='trigger'::regtype AS trigger_result,p.prosecdef,p.proconfig,p.prosrc,l.lanname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=current_schema() AND p.proname='sales_checkout_amount_immutable'`)).rows;
  const fn=functions[0];
  const expected=sql.match(/FUNCTION sales_checkout_amount_immutable\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/)?.[1];
  if(functions.length!==1||!fn||fn.pronargs!==0||!fn.trigger_result||fn.prosecdef||fn.proconfig!==null||fn.lanname!=='plpgsql'||!expected||compact(fn.prosrc)!==compact(expected))throw Error('amount_migration_function_drift');
  const triggers=(await db.query(`SELECT t.tgrelid='sales_checkout_sessions'::regclass AS correct_table,t.tgfoid,t.tgenabled,t.tgtype,t.tgnargs,t.tgqual,t.tgattr::text AS attributes
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND t.tgname='sales_checkout_amount_immutable_trigger'`)).rows;
  const trigger=triggers[0];
  if(triggers.length!==1||!trigger.correct_table||trigger.tgfoid!==fn.oid||!['O','A'].includes(trigger.tgenabled)||trigger.tgtype!==19||trigger.tgnargs!==0||trigger.tgqual!==null||trigger.attributes!=='')throw Error('amount_migration_trigger_drift');
  const gate=(await db.query(`SELECT a.atttypid='bool'::regtype AS boolean,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='sales_dialer_config'::regclass AND a.attname='custom_signup_amount_enabled' AND NOT a.attisdropped`)).rows[0];
  if(!gate?.boolean||!gate.attnotnull||gate.attidentity||gate.attgenerated||gate.default_value!=='false')throw Error('amount_migration_activation_gate_drift');
  return {activationGateDefault:false,integer:true,notNull:true,legacyDefault:10000,min:100,max:99999999,immutable:true};
}

export async function applySalesCheckoutAmountMigration(pool, options) {
  const startedAt=performance.now();
  const {databaseUrl,expectedTargetFingerprint,reviewedRevision,currentRevision,expectedMigrationSha256,releaseEvidenceReference,legacyPriceEvidenceReference}=options||{};
  const targetFingerprint=salesAmountTargetFingerprint(databaseUrl);
  if(!expectedTargetFingerprint||expectedTargetFingerprint!==targetFingerprint)throw Error('amount_migration_target_mismatch');
  if(!/^[a-f0-9]{40}$/.test(reviewedRevision||'')||reviewedRevision!==currentRevision)throw Error('amount_migration_reviewed_revision_mismatch');
  for(const [name,value] of Object.entries({releaseEvidenceReference,legacyPriceEvidenceReference})) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{5,159}$/.test(value||''))throw Error(`amount_migration_${name}_required`);
  }
  const sql=await readMigration(SALES_AMOUNT_MIGRATION);
  if(!expectedMigrationSha256||amountMigrationDigest(sql)!==expectedMigrationSha256)throw Error('amount_migration_reviewed_sql_mismatch');
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
    // No fallback to statement-only deadlines: the server must bound the whole transaction.
    const supported=await client.query("SELECT current_setting('transaction_timeout',TRUE) AS timeout");
    if(supported.rows[0]?.timeout==null)throw Error('amount_migration_transaction_deadline_unavailable');
    await client.query("SET LOCAL transaction_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    await client.query('SELECT pg_advisory_xact_lock(1763910417)');
    const receipts=await client.query('SELECT name FROM schema_migrations WHERE name=ANY($1::text[])',[SALES_AMOUNT_PREDECESSORS]);
    const present=new Set(receipts.rows.map(row=>row.name));
    const missing=SALES_AMOUNT_PREDECESSORS.filter(name=>!present.has(name));
    if(missing.length)throw Object.assign(Error('amount_migration_predecessor_receipts_missing'),{missing});
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
    if(nullable.rows[0]?.attnotnull!==false||previousGuards.rowCount!==3)throw Error('amount_migration_predecessor_schema_drift');
    await verifySalesIntroEmailSchema(client);
    const installed=await client.query('SELECT name FROM schema_migrations WHERE name=$1',[SALES_AMOUNT_MIGRATION]);
    if(installed.rowCount){const physical=await verifySalesCheckoutAmountSchema(client,sql);await client.query('COMMIT');return {applied:false,migration:SALES_AMOUNT_MIGRATION,targetFingerprint,reviewedRevision,releaseEvidenceReference,legacyPriceEvidenceReference,physical,...elapsed()};}
    const mode=await client.query('SELECT id FROM sales_dialer_config WHERE id=TRUE FOR UPDATE NOWAIT');
    if(!mode.rowCount)throw Error('amount_migration_sales_config_missing');
    // Preserve application lock order. NOWAIT avoids waiting on a request
    // already holding a table lock while it waits for the mode row.
    await client.query(`LOCK TABLE sales_dialer_config,sales_prospects,sales_prospect_contacts,sales_prospect_contact_numbers,
      sales_call_sessions,sales_call_events,sales_incoming_calls,sales_checkout_sessions,sales_setup_bookings,
      sales_signup_invitations,sales_demo_jobs,sales_followup_jobs,sales_idempotency_keys,sales_intro_email_deliveries,schema_migrations IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    await client.query('LOCK TABLE sales_dialer_config,sales_checkout_sessions IN ACCESS EXCLUSIVE MODE NOWAIT');
    if((await client.query('SELECT name FROM schema_migrations WHERE name=$1',[SALES_AMOUNT_MIGRATION])).rowCount)throw Error('amount_migration_receipt_changed_before_ddl');
    const collisions=await client.query(`SELECT 'column' AS kind,a.attname AS name FROM pg_attribute a
      WHERE ((a.attrelid='sales_checkout_sessions'::regclass AND a.attname='amount_cents')
        OR (a.attrelid='sales_dialer_config'::regclass AND a.attname='custom_signup_amount_enabled')) AND NOT a.attisdropped
      UNION ALL SELECT 'constraint',c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname=current_schema() AND c.conname='sales_checkout_amount_range'
      UNION ALL SELECT 'function',p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND p.proname='sales_checkout_amount_immutable'
      UNION ALL SELECT 'trigger',t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND t.tgname='sales_checkout_amount_immutable_trigger'`);
    if(collisions.rowCount)throw Object.assign(Error('amount_migration_owned_object_collision'),{collisions:collisions.rows});
    const relations=await client.query(`SELECT c.relname,c.relkind,EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inherited
      FROM pg_class c WHERE c.oid IN ('sales_checkout_sessions'::regclass,'sales_dialer_config'::regclass)`);
    if(relations.rows.some(row=>row.relkind!=='r'||row.inherited))throw Error('amount_migration_relation_shape_drift');
    const bytes=Number((await client.query("SELECT pg_total_relation_size('sales_checkout_sessions') AS bytes")).rows[0].bytes);
    if(bytes>SALES_AMOUNT_MAX_BYTES)throw Error('amount_migration_checkout_size_bound');
    const rows=Number((await client.query(`SELECT count(*) AS n FROM (SELECT 1 FROM sales_checkout_sessions LIMIT ${SALES_AMOUNT_MAX_ROWS+1}) bounded`)).rows[0].n);
    if(rows>SALES_AMOUNT_MAX_ROWS)throw Error('amount_migration_checkout_row_bound');
    const scanEvidence={rows,bytes,maxRows:SALES_AMOUNT_MAX_ROWS,maxBytes:SALES_AMOUNT_MAX_BYTES};
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
      (SELECT count(*) FROM sales_idempotency_keys WHERE state='processing') AS mutations,
      (SELECT count(*) FROM sales_intro_email_deliveries WHERE status IN ('sending','uncertain')) AS intro_deliveries`);
    const counts=Object.fromEntries(Object.entries(activity.rows[0]).map(([key,value])=>[key,Number(value)]));
    if(Object.values(counts).some(count=>count!==0))throw Object.assign(Error('amount_migration_sales_work_pending'),{counts});
    await client.query(migrationBody(sql));
    const physical=await verifySalesCheckoutAmountSchema(client,sql);
    const gate=await client.query('SELECT custom_signup_amount_enabled FROM sales_dialer_config WHERE id=TRUE');
    if(gate.rows[0]?.custom_signup_amount_enabled!==false)throw Error('amount_migration_new_gate_not_disabled');
    await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[SALES_AMOUNT_MIGRATION]);
    await client.query('COMMIT');
    return {applied:true,migration:SALES_AMOUNT_MIGRATION,targetFingerprint,reviewedRevision,migrationSha256:expectedMigrationSha256,releaseEvidenceReference,legacyPriceEvidenceReference,scanEvidence,counts,physical,...elapsed()};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});Object.assign(error,elapsed());throw error;}
  finally{client.release(connectionError);client.removeListener?.('error',observeConnectionError);}
}
