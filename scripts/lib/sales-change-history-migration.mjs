import { readMigration } from './schema-migrations.mjs';
import { SALES_NOTES_PREDECESSORS,notesMigrationDigest,salesNotesTargetFingerprint } from './sales-contact-notes-migration.mjs';
import { SALES_HISTORY_INVENTORY } from '../../lib/salesHistoryInventory.js';

export const SALES_HISTORY_MIGRATION='0066_sales_change_history.sql';
export const historyMigrationDigest=notesMigrationDigest;
export const salesHistoryTargetFingerprint=salesNotesTargetFingerprint;
const tables=Object.keys(SALES_HISTORY_INVENTORY);
const predecessors=[...SALES_NOTES_PREDECESSORS,'0062_sales_contact_notes.sql'];
const compact=value=>String(value).replace(/\s+/g,' ').trim();
const functionNames=['sales_capture_field_changes','sales_change_history_immutable'];

export async function verifySalesHistorySchema(db,sql) {
  sql ||= await readMigration(SALES_HISTORY_MIGRATION);
  const functions=(await db.query(`SELECT p.proname,p.pronargs,p.prorettype='trigger'::regtype AS trigger_result,p.prosecdef,p.proconfig,p.prosrc,l.lanname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=current_schema() AND p.proname=ANY($1::text[])`,[functionNames])).rows;
  if(functions.length!==functionNames.length)throw Error('history_function_drift');
  for(const name of functionNames){
    const fn=functions.find(f=>f.proname===name),expected=sql.match(new RegExp(`FUNCTION ${name}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$`))?.[1];
    if(!fn||fn.pronargs!==0||!fn.trigger_result||fn.prosecdef||fn.proconfig!==null||fn.lanname!=='plpgsql'||!expected||compact(fn.prosrc)!==compact(expected))throw Error('history_function_drift');
  }
  const actual=(await db.query(`SELECT t.tgname,c.relname,t.tgenabled,t.tgtype,t.tgfoid::regproc::text AS function,t.tgnargs,encode(t.tgargs,'escape') AS args,t.tgqual,t.tgattr::text AS attrs
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND (t.tgname LIKE 'sales_history_%' OR t.tgname LIKE 'sales_change_history_%')`)).rows;
  const expected=tables.map(table=>({name:`sales_history_${table}`,table,type:29,fn:'sales_capture_field_changes',args:[SALES_HISTORY_INVENTORY[table].entityType,SALES_HISTORY_INVENTORY[table].idColumn,SALES_HISTORY_INVENTORY[table].fields.join(' ')]}));
  expected.push(...[
    ['sales_change_history_immutable_row','sales_change_history',31],['sales_change_history_immutable_truncate','sales_change_history',34],
    ['sales_change_history_capture_immutable','sales_change_history_capture',31],['sales_change_history_capture_truncate','sales_change_history_capture',34]
  ].map(([name,table,type])=>({name,table,type,fn:'sales_change_history_immutable',args:[]})));
  if(actual.length!==expected.length)throw Error('history_trigger_drift');
  for(const item of expected){
    const row=actual.find(t=>t.tgname===item.name);
    if(!row||row.relname!==item.table||!['O','A'].includes(row.tgenabled)||row.tgtype!==item.type||row.function.split('.').at(-1)!==item.fn||row.tgnargs!==item.args.length||row.args!==item.args.map(v=>`${v}\\000`).join('')||row.tgqual!==null||row.attrs!=='')throw Error('history_trigger_drift');
  }
  const columns=(await db.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='sales_change_history'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
  const shape={event_id:['bigint',true],occurred_at:['timestamp with time zone',true],transaction_id:['text',true],request_id:['text',false],actor_kind:['text',true],actor_id:['text',false],actor_name:['text',true],actor_role:['text',true],entity_type:['text',true],entity_id:['text',true],prospect_id:['text',false],company_name:['text',false],contact_id:['text',false],sales_call_id:['text',false],number_id:['text',false],field_path:['text',true],action:['text',true],old_present:['boolean',true],new_present:['boolean',true],old_value:['jsonb',false],new_value:['jsonb',false]};
  if(columns.length!==Object.keys(shape).length||columns.some(c=>JSON.stringify([c.type,c.attnotnull])!==JSON.stringify(shape[c.attname])))throw Error('history_column_drift');
  if(columns[0].attidentity!=='a'||columns[1].default_value!=='clock_timestamp()')throw Error('history_identity_clock_drift');
  const fks=(await db.query("SELECT 1 FROM pg_constraint WHERE conrelid='sales_change_history'::regclass AND contype='f'")).rowCount;
  if(fks)throw Error('history_retention_fk_drift');
  const indexes=(await db.query(`SELECT c.relname,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid='sales_change_history'::regclass`)).rows;
  for(const [name,keys] of [['sales_change_history_time_idx','(occurred_at DESC, event_id DESC)'],['sales_change_history_company_idx','(prospect_id, occurred_at DESC, event_id DESC)'],['sales_change_history_actor_idx','(actor_id, occurred_at DESC, event_id DESC)']])if(!indexes.some(i=>i.relname===name&&i.indisvalid&&i.indisready&&i.definition.endsWith(keys)))throw Error('history_index_drift');
  const capture=(await db.query('SELECT started_at FROM sales_change_history_capture WHERE id=TRUE')).rows;
  if(capture.length!==1)throw Error('history_capture_marker_drift');
  return {tables:tables.length,triggers:expected.length,startedAt:capture[0].started_at,appendOnly:true};
}

export async function applySalesHistoryMigration(pool,options={}) {
  const {databaseUrl,expectedTargetFingerprint,reviewedRevision,currentRevision,expectedMigrationSha256,releaseEvidenceReference}=options;
  const targetFingerprint=salesHistoryTargetFingerprint(databaseUrl);
  if(!expectedTargetFingerprint||targetFingerprint!==expectedTargetFingerprint)throw Error('history_target_mismatch');
  if(!/^[a-f0-9]{40}$/.test(reviewedRevision||'')||reviewedRevision!==currentRevision)throw Error('history_revision_mismatch');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{5,159}$/.test(releaseEvidenceReference||''))throw Error('history_release_evidence_required');
  const sql=await readMigration(SALES_HISTORY_MIGRATION);
  if(historyMigrationDigest(sql)!==expectedMigrationSha256)throw Error('history_sql_mismatch');
  const client=await pool.connect();let connectionError;
  const observe=error=>{connectionError=error;};client.on?.('error',observe);
  try {
    await client.query('BEGIN');
    if((await client.query("SELECT current_setting('transaction_timeout',TRUE) AS timeout")).rows[0]?.timeout==null)throw Error('history_transaction_deadline_unavailable');
    await client.query("SET LOCAL transaction_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='8s'");
    await client.query("SET LOCAL lock_timeout='250ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='8s'");
    if(!(await client.query('SELECT pg_try_advisory_xact_lock(1763910417) AS locked')).rows[0].locked)throw Error('history_migration_busy');
    await client.query('LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    // CREATE TRIGGER is metadata-only; fence every writer before capture becomes
    // visible together. Never wait, disable guards, drain jobs or replay old DDL.
    await client.query(`LOCK TABLE ${tables.join(',')} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    const present=new Set((await client.query('SELECT name FROM schema_migrations WHERE name=ANY($1::text[])',[predecessors])).rows.map(r=>r.name));
    const missing=predecessors.filter(name=>!present.has(name));
    if(missing.length)throw Object.assign(Error('history_predecessors_missing'),{missing});
    for(const table of tables){
      const row=(await client.query(`SELECT c.relkind,c.relispartition,EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) AS inherited
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=$1`,[table])).rows[0];
      if(!row||row.relkind!=='r'||row.relispartition||row.inherited)throw Error('history_source_relation_drift');
      const columns=new Set((await client.query('SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped',[table])).rows.map(r=>r.attname));
      if(![SALES_HISTORY_INVENTORY[table].idColumn,...SALES_HISTORY_INVENTORY[table].fields.map(f=>f.split('.')[0])].every(c=>columns.has(c)))throw Error('history_source_column_drift');
    }
    const installed=(await client.query('SELECT name FROM schema_migrations WHERE name=$1',[SALES_HISTORY_MIGRATION])).rowCount>0;
    if(!installed){
      const collision=await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname LIKE 'sales_change_history%'
        UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname=ANY($1::text[])
        UNION ALL SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND (t.tgname LIKE 'sales_history_%' OR t.tgname LIKE 'sales_change_history_%')`,[functionNames]);
      if(collision.rowCount)throw Error('history_unreceipted_objects');
      await client.query(sql);
    }
    const physical=await verifySalesHistorySchema(client,sql);
    if(!installed)await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[SALES_HISTORY_MIGRATION]);
    await client.query('COMMIT');
    return {applied:!installed,migration:SALES_HISTORY_MIGRATION,targetFingerprint,reviewedRevision,releaseEvidenceReference,physical};
  } catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.off?.('error',observe);client.release(connectionError);}
}
