import { readMigration } from './schema-migrations.mjs';
import { amountMigrationDigest, SALES_AMOUNT_PREDECESSORS, salesAmountTargetFingerprint } from './sales-checkout-amount-migration.mjs';

export const SALES_NOTES_MIGRATION='0062_sales_contact_notes.sql';
export const notesMigrationDigest=amountMigrationDigest;
export const salesNotesTargetFingerprint=salesAmountTargetFingerprint;
export const SALES_NOTES_PREDECESSORS=Object.freeze([...SALES_AMOUNT_PREDECESSORS,'0061_sales_checkout_amount.sql']);

async function verifyContactBaseSchema(db) {
  const expected={contact_id:['text',true,null],prospect_id:['text',true,null],first_name:['text',true,"''::text"],last_name:['text',true,"''::text"],
    email:['text',false,null],title:['text',false,null],decision_maker:['boolean',true,'false'],influencer:['boolean',true,'false'],
    archived_at:['timestamp with time zone',false,null]};
  const columns=(await db.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='sales_prospect_contacts'::regclass AND a.attname=ANY($1::text[]) AND NOT a.attisdropped`,[Object.keys(expected)])).rows;
  if(columns.length!==Object.keys(expected).length||columns.some(c=>c.attidentity||c.attgenerated||JSON.stringify([c.type,c.attnotnull,c.default_value])!==JSON.stringify(expected[c.attname])))throw Error('notes_migration_base_column_drift');
  const constraints=(await db.query(`SELECT conrelid::regclass::text AS relation,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid IN ('sales_prospect_contacts'::regclass,'sales_prospects'::regclass)`)).rows;
  for(const [relation,type,definition,deferred] of [
    ['sales_prospect_contacts','p','PRIMARY KEY (contact_id)',false],
    ['sales_prospect_contacts','u','UNIQUE (prospect_id, contact_id)',false],
    ['sales_prospect_contacts','f','FOREIGN KEY (prospect_id) REFERENCES sales_prospects(prospect_id) ON DELETE CASCADE',false],
    ['sales_prospects','f','FOREIGN KEY (prospect_id, default_contact_id) REFERENCES sales_prospect_contacts(prospect_id, contact_id) DEFERRABLE INITIALLY DEFERRED',true]
  ])if(!constraints.some(c=>c.relation===relation&&c.contype===type&&c.convalidated&&c.condeferrable===deferred&&c.condeferred===deferred&&c.definition===definition))throw Error('notes_migration_contact_constraint_drift');
  const guards=(await db.query(`SELECT tgname,tgenabled,tgdeferrable,tginitdeferred,tgfoid::regproc::text AS function,tgrelid::regclass::text AS relation
    FROM pg_trigger WHERE tgrelid IN ('sales_prospect_contacts'::regclass,'sales_prospects'::regclass)
    AND tgname IN ('sales_company_contacts_guard','sales_contact_default_valid','sales_company_default_valid')`)).rows;
  for(const [name,relation,fn,deferred] of [
    ['sales_company_contacts_guard','sales_prospect_contacts','sales_company_contact_guard',false],
    ['sales_contact_default_valid','sales_prospect_contacts','sales_company_default_guard',true],
    ['sales_company_default_valid','sales_prospects','sales_company_default_guard',true]
  ])if(!guards.some(g=>g.tgname===name&&g.relation===relation&&g.function===fn&&['O','A'].includes(g.tgenabled)&&g.tgdeferrable===deferred&&g.tginitdeferred===deferred))throw Error('notes_migration_contact_guard_drift');
}

export async function verifySalesContactNotesSchema(db) {
  const column=(await db.query(`SELECT a.atttypid='text'::regtype AS text_type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='sales_prospect_contacts'::regclass AND a.attname='notes' AND NOT a.attisdropped`)).rows[0];
  if(!column?.text_type||!column.attnotnull||column.attidentity||column.attgenerated||column.default_value!=="''::text")throw Error('notes_migration_column_drift');
  return {text:true,notNull:true,defaultValue:''};
}

// Online expansion touches only the contact relation and migration receipt.
// Constant-default ADD COLUMN is metadata-only on the required PostgreSQL 17+.
// Old explicit-column writers preserve notes; no provider, queue, pricing or
// gateway state is changed or drained by this procedure.
export async function applySalesContactNotesMigration(pool,options={}) {
  const {databaseUrl,expectedTargetFingerprint,reviewedRevision,currentRevision,expectedMigrationSha256,releaseEvidenceReference}=options;
  const targetFingerprint=salesNotesTargetFingerprint(databaseUrl);
  if(!expectedTargetFingerprint||expectedTargetFingerprint!==targetFingerprint)throw Error('notes_migration_target_mismatch');
  if(!/^[a-f0-9]{40}$/.test(reviewedRevision||'')||reviewedRevision!==currentRevision)throw Error('notes_migration_reviewed_revision_mismatch');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{5,159}$/.test(releaseEvidenceReference||''))throw Error('notes_migration_release_evidence_required');
  const sql=await readMigration(SALES_NOTES_MIGRATION);
  if(notesMigrationDigest(sql)!==expectedMigrationSha256)throw Error('notes_migration_reviewed_sql_mismatch');
  const client=await pool.connect();
  let connectionError;
  const observe=error=>{connectionError=error;};client.on?.('error',observe);
  const started=performance.now();
  try {
    await client.query('BEGIN');
    if((await client.query("SELECT current_setting('transaction_timeout',TRUE) AS timeout")).rows[0]?.timeout==null)throw Error('notes_migration_transaction_deadline_unavailable');
    await client.query("SET LOCAL transaction_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='4s'");
    await client.query("SET LOCAL lock_timeout='250ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='4s'");
    if(!(await client.query('SELECT pg_try_advisory_xact_lock(1763910417) AS locked')).rows[0].locked)throw Error('notes_migration_busy');
    // Fence receipt writes and the sole ALTER target without waiting behind work.
    await client.query('LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    await client.query('LOCK TABLE sales_prospect_contacts IN ACCESS EXCLUSIVE MODE NOWAIT');
    const present=new Set((await client.query('SELECT name FROM schema_migrations WHERE name=ANY($1::text[])',[SALES_NOTES_PREDECESSORS])).rows.map(r=>r.name));
    const missing=SALES_NOTES_PREDECESSORS.filter(name=>!present.has(name));
    if(missing.length)throw Object.assign(Error('notes_migration_predecessor_receipts_missing'),{missing});
    // Verify the local physical contract, not unrelated runtime/job readiness.
    await verifyContactBaseSchema(client);
    const relation=(await client.query("SELECT relkind,relispartition FROM pg_class WHERE oid='sales_prospect_contacts'::regclass")).rows[0];
    const inherited=await client.query("SELECT 1 FROM pg_inherits WHERE inhrelid='sales_prospect_contacts'::regclass OR inhparent='sales_prospect_contacts'::regclass");
    if(relation.relkind!=='r'||relation.relispartition||inherited.rowCount)throw Error('notes_migration_contact_relation_drift');
    const installed=(await client.query('SELECT name FROM schema_migrations WHERE name=$1',[SALES_NOTES_MIGRATION])).rowCount>0;
    if(!installed) {
      if((await client.query("SELECT 1 FROM pg_attribute WHERE attrelid='sales_prospect_contacts'::regclass AND attname='notes' AND NOT attisdropped")).rowCount)throw Error('notes_migration_unreceipted_column');
      await client.query(sql);
    }
    const physical=await verifySalesContactNotesSchema(client);
    if(!installed)await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[SALES_NOTES_MIGRATION]);
    await client.query('COMMIT');
    return {applied:!installed,migration:SALES_NOTES_MIGRATION,targetFingerprint,reviewedRevision,releaseEvidenceReference,physical,transactionElapsedMs:Math.round(performance.now()-started)};
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});throw error;
  } finally {client.off?.('error',observe);client.release(connectionError);}
}
