import crypto from 'node:crypto';
import { readMigration } from './schema-migrations.mjs';
import { SALES_NOTES_PREDECESSORS, verifySalesContactNotesSchema } from './sales-contact-notes-migration.mjs';
import { verifySalesCheckoutAmountSchema, salesAmountTargetFingerprint } from './sales-checkout-amount-migration.mjs';

export const UPIB_MIGRATIONS = Object.freeze(['0063_unified_paid_intake.sql', '0064_paid_billing_lifecycle.sql']);
export const UPIB_PREDECESSORS = Object.freeze(['0049_live_prompt_settings.sql', ...SALES_NOTES_PREDECESSORS, '0062_sales_contact_notes.sql']);
export const upibMigrationDigest = value => crypto.createHash('sha256').update(value).digest('hex');
export const upibTargetFingerprint = salesAmountTargetFingerprint;
export { verifyInstalled as verifyUnifiedPaidBillingInstalled };
const ADDITIONS = {
  tenant_billing_accounts: ['paid_purchase_id', 'usage_anchor_at', 'initial_period_end', 'paid_base_through', 'service_ended_at', 'changed_number_ack_required', 'stripe_subscription_status'],
  billing_periods: ['invoice_attempted_at', 'invoice_payload']
};
const NEW_TABLES = ['paid_intakes', 'paid_purchases', 'paid_intake_sales_references', 'billing_money_reviews', 'paid_intake_release', 'paid_number_orders', 'paid_billing_changes', 'billing_invoice_debts', 'billing_delinquencies', 'billing_reminder_deliveries', 'billing_call_admissions', 'staff_support_sessions', 'paid_number_releases', 'paid_setup_bookings'];
const BASE_TABLES = [...Object.keys(ADDITIONS), 'tenants', 'calls', 'sessions', 'admin_users', 'tenant_users', 'sales_checkout_sessions'];
// Generated from the reviewed native baseline plus existing 0049 and additive SQL.
// All eight base fingerprints match a read-only production catalog comparison. These
// are schema fingerprints, never row/provider data. Changes require fresh review.
const CONTRACTS = /* CONTRACTS_START */ {
  "base": {
    "tenant_billing_accounts": "d5e9aef0055d2f57216986af5a30b015ecc650f771ed4581b7f60bdd669f1877",
    "billing_periods": "47f1e4919c3fdea0fed08c4a73c30ec4aed90cf0b8f4bca37df9089ec7f6f87e",
    "tenants": "a975fd4e9763b186f7fd62d717e4eff68fd3dff67dd72778e5e024ed19c7c5d1",
    "calls": "2765ad87fe1ba3e27c36fbfdca9e2c3d374e4adc52efc45af3fbb53651f82804",
    "sessions": "6b3cf2b4e96395fbd4d0115a108e4f3faaae26e3dcb257df4fac239b79a3abd8",
    "admin_users": "1496dc0b82f64c1c9477d030c37f7121fceccc87bdad1f550b966d8abf46ee74",
    "tenant_users": "5dffa43dbe0baada5ef9319de9a94c4a04ca323125982e9e6e83b5e668922b85",
    "sales_checkout_sessions": "8a7b371ef1f5920857f72d9993f5831ac7f579adf0a6225dde8f2fc79cad6404"
  },
  "installed": {
    "paid_intakes": "71071c74608ef7ce8029704320d2d5939cb87874984ec5828256a1e20a5f8445",
    "paid_purchases": "9a02c63532d8350967f0567485b188e944bcdbf4275993810ed3a8c9132de737",
    "paid_intake_sales_references": "9a8ca8f6ba698fcae0af07736a2d3c967da1f309d0561e84b84aca0926555087",
    "billing_money_reviews": "99f716da886a4d93b07fa16ea7e2d91bb17ea126a581ef19ddb0778256647ba4",
    "paid_intake_release": "becbc16043b3e064adadeebef048b42d94583898e0a0763e5c30ce426b0e8e33",
    "paid_number_orders": "f6fd21c9564095780cc3a7487fe5db6ef1fb9a23d65cb3cdce42f856dc46434a",
    "paid_billing_changes": "dd658b9110b5db567c1b88f198a90114f92eefc744df175e4cc0919c68bfb407",
    "billing_invoice_debts": "080af3c2a64b63983b5919a07a0a323ecd0a5d7b2301e9ed2262a5020c125974",
    "billing_delinquencies": "4f129eec9478604b8e11141659947cbadbbf518d11a629919199285cda5f0238",
    "billing_reminder_deliveries": "7c14ee4c7cfd718dde8401ee12acdd45ac21b4e3b610f96af85c415dc0f182dc",
    "billing_call_admissions": "af15da3a052ac208bdcab08f289101c429df5ca041eb548d070631197fba88f8",
    "staff_support_sessions": "995b3d9e83c0092514a12d86cb4eacebbe18702bca651d46f21bc543637da53e",
    "paid_number_releases": "fc10f78e077aeacc3edd2e2ab9cd4fb19ade74aed4517e43234526ad20ef4d92",
    "paid_setup_bookings": "389141b245be593993a871b911bdbd6a7606c89d9032a98cb79680c571d484f4",
    "tenant_billing_accounts": "9afd065869451a3620e31cf3c0478b2853171b2bb18460b8e501d804763de26e",
    "billing_periods": "e8d52ec5ae95e69419462a8308843ffd361f8e94befc4fd3c882bd15297e2782"
  },
  "sequence": "9c0d51f6d3e7cce1029c665fff3c859986318ef116cef31e736f342cc5042139",
  "ownedRelations": [
    "billing_call_admissions",
    "billing_call_admissions_period_idx",
    "billing_call_admissions_pkey",
    "billing_delinquencies",
    "billing_delinquencies_pkey",
    "billing_invoice_debts",
    "billing_invoice_debts_pkey",
    "billing_invoice_debts_tenant_idx",
    "billing_money_reviews",
    "billing_money_reviews_pkey",
    "billing_reminder_deliveries",
    "billing_reminder_deliveries_pkey",
    "paid_billing_changes",
    "paid_billing_changes_pending",
    "paid_billing_changes_pkey",
    "paid_intake_release",
    "paid_intake_release_pkey",
    "paid_intake_sales_references",
    "paid_intake_sales_references_checkout_id_key",
    "paid_intake_sales_references_pkey",
    "paid_intakes",
    "paid_intakes_owner_idx",
    "paid_intakes_pkey",
    "paid_intakes_session_hash_key",
    "paid_intakes_verification_hash_key",
    "paid_number_orders",
    "paid_number_orders_phone_number_key",
    "paid_number_orders_pkey",
    "paid_number_release_active_idx",
    "paid_number_release_restart_idx",
    "paid_number_releases",
    "paid_number_releases_pkey",
    "paid_number_releases_release_id_seq",
    "paid_purchases",
    "paid_purchases_legacy_checkout_id_key",
    "paid_purchases_legacy_payment_intent_id_key",
    "paid_purchases_pending_restart",
    "paid_purchases_pkey",
    "paid_purchases_setup_intake",
    "paid_purchases_setup_prospect",
    "paid_purchases_setup_tenant",
    "paid_purchases_stripe_invoice_id_key",
    "paid_purchases_stripe_payment_intent_id_key",
    "paid_purchases_stripe_session_id_key",
    "paid_purchases_stripe_subscription_id_key",
    "paid_setup_bookings",
    "paid_setup_bookings_pkey",
    "paid_setup_bookings_tenant_key_key",
    "staff_support_sessions",
    "staff_support_sessions_pkey",
    "tenant_billing_accounts_paid_purchase_id_key"
  ]
} /* CONTRACTS_END */;
const ident = name => `"${String(name).replaceAll('"', '""')}"`;
const fail = suffix => { throw Error(`upib_migration_${suffix}`); };

export async function upibCatalogContract(db, table, excluded = []) {
  const relation = (await db.query(`SELECT c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,
    EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) AS inherited,
    n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=$1`, [table])).rows[0];
  if (!relation) fail(`missing_relation_${table}`);
  const schema = relation.nspname;
  delete relation.nspname;
  const normalize = value => JSON.parse(JSON.stringify(value).replaceAll(`${schema}.`, '').replaceAll(`\\"${schema}\\".`, ''));
  const columns = (await db.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
    pg_get_expr(d.adbin,d.adrelid) AS default_value,a.attcollation::regcollation::text AS collation
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped AND NOT(a.attname=ANY($2::text[])) ORDER BY a.attname`, [table, excluded])).rows;
  const constraints = (await db.query(`SELECT conname,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE conrelid=$1::regclass AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) AND a.attname=ANY($2::text[])) ORDER BY conname`, [table, excluded])).rows;
  const indexes = (await db.query(`SELECT ci.relname,i.indisvalid,i.indisready,i.indisunique,i.indisprimary,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=$1::regclass
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) AND a.attname=ANY($2::text[])) ORDER BY ci.relname`, [table, excluded])).rows;
  const triggers = (await db.query(`SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal ORDER BY tgname`, [table])).rows;
  return normalize({ relation, columns, constraints, indexes, triggers });
}
const contractHash = contract => upibMigrationDigest(JSON.stringify(contract));
async function checkContract(db, table, expected, excluded = []) {
  if (contractHash(await upibCatalogContract(db, table, excluded)) !== expected) fail(`physical_contract_drift_${table}`);
}
async function verifyFunction(db, sql) {
  const rows = (await db.query(`SELECT p.prosrc,p.prosecdef,p.proconfig,p.provolatile,p.proparallel,p.proisstrict,l.lanname,
    pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_function_result(p.oid) AS result,
    pg_get_expr(p.proargdefaults,0) AS defaults
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=current_schema() AND p.proname='reserve_paid_call'`)).rows;
  const expected = sql.match(/CREATE FUNCTION reserve_paid_call[\s\S]*?AS \$\$([\s\S]*?)\$\$/)?.[1];
  const f = rows[0];
  if (rows.length !== 1 || !expected || f.prosrc !== expected || f.prosecdef || f.proconfig !== null || f.provolatile !== 'v' || f.proparallel !== 'u' || f.proisstrict || f.lanname !== 'plpgsql' || f.arguments !== 'p_tenant text, p_call text, p_now timestamp with time zone' || f.result !== 'TABLE(allowed boolean, reason text, period_id bigint)' || f.defaults !== 'now()') fail('function_drift');
}
async function verifyInstalled(db, sql) {
  for (const table of [...NEW_TABLES, ...Object.keys(ADDITIONS)]) await checkContract(db, table, CONTRACTS.installed[table]);
  const sequence = (await db.query(`SELECT format_type(seqtypid,NULL) AS type,seqstart::text,seqincrement::text,seqmax::text,seqmin::text,seqcache::text,seqcycle
    FROM pg_sequence WHERE seqrelid='paid_number_releases_release_id_seq'::regclass`)).rows[0];
  if (contractHash(sequence) !== CONTRACTS.sequence) fail('sequence_drift');
  await verifyFunction(db, sql);
  const gate = (await db.query('SELECT * FROM paid_intake_release')).rows;
  if (gate.length !== 1 || gate[0].id !== true || gate[0].enabled !== false || gate[0].reviewed_revision !== null || gate[0].inventory_reference !== null || gate[0].enabled_at !== null) fail('release_gate_not_pristine_disabled');
}
async function assertNoOwnedObjects(db) {
  const relations = await db.query(`SELECT relname FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname=ANY($1::text[])`, [CONTRACTS.ownedRelations]);
  if (relations.rowCount) fail('unreceipted_relation');
  if ((await db.query(`SELECT 1 FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname='reserve_paid_call'`)).rowCount) fail('unreceipted_function');
  for (const [table, columns] of Object.entries(ADDITIONS)) {
    if ((await db.query(`SELECT 1 FROM pg_attribute WHERE attrelid=$1::regclass AND NOT attisdropped AND attname=ANY($2::text[])`, [table, columns])).rowCount) fail('unreceipted_column');
  }
}
async function rowSnapshot(db, table, excluded) {
  const size = (await db.query('SELECT pg_total_relation_size($1::regclass)::text AS bytes', [table])).rows[0].bytes;
  if (BigInt(size) > 16777216n) fail('row_snapshot_size_bound');
  if ((await db.query(`SELECT 1 FROM ${ident(table)} LIMIT 10001`)).rowCount > 10000) fail('row_snapshot_count_bound');
  return (await db.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(payload::text,E'\\n' ORDER BY payload::text COLLATE "C"),'')) AS digest FROM (SELECT to_jsonb(t)-$1::text[] AS payload FROM ${ident(table)} t) s`, [excluded])).rows[0];
}

export async function applyUnifiedPaidBillingMigrations(pool, options = {}) {
  const { databaseUrl, expectedTargetFingerprint, reviewedRevision, currentRevision, expectedMigrationSha256, releaseEvidenceReference, inventoryEvidenceReference, execute } = options;
  if (execute !== true) fail('explicit_execution_required');
  const targetFingerprint = upibTargetFingerprint(databaseUrl);
  if (!expectedTargetFingerprint || expectedTargetFingerprint !== targetFingerprint) fail('target_mismatch');
  if (!/^[a-f0-9]{40}$/.test(reviewedRevision || '') || reviewedRevision !== currentRevision) fail('reviewed_revision_mismatch');
  for (const value of [releaseEvidenceReference, inventoryEvidenceReference]) if (!/^[a-zA-Z0-9][a-zA-Z0-9:._/#-]{5,239}$/.test(value || '') || /^(?:none|pending|todo|unknown|placeholder)(?:[:/._-]|$)/i.test(value)) fail('concrete_evidence_required');
  const sql = await Promise.all(UPIB_MIGRATIONS.map(readMigration));
  for (let i = 0; i < sql.length; i++) if (upibMigrationDigest(sql[i]) !== expectedMigrationSha256?.[UPIB_MIGRATIONS[i]]) fail('reviewed_sql_mismatch');
  const client = await pool.connect();
  let connectionError;
  const observe = error => { connectionError = error; };
  client.on?.('error', observe);
  const started = performance.now();
  try {
    await client.query('BEGIN');
    if ((await client.query("SELECT current_setting('transaction_timeout',TRUE) AS timeout")).rows[0]?.timeout == null) fail('transaction_deadline_unavailable');
    await client.query("SET LOCAL transaction_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='250ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
    if (!(await client.query('SELECT pg_try_advisory_xact_lock(1763910417) AS locked')).rows[0].locked) fail('busy');
    await client.query('LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    await client.query('LOCK TABLE tenant_billing_accounts,billing_periods IN ACCESS EXCLUSIVE MODE NOWAIT');
    // Foreign-key targets and catalog contract tables remain stable during DDL.
    await client.query('LOCK TABLE tenants,calls,sessions,admin_users,tenant_users,sales_checkout_sessions,sales_prospect_contacts,sales_dialer_config IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    const receipts = new Set((await client.query('SELECT name FROM schema_migrations WHERE name=ANY($1::text[])', [[...UPIB_PREDECESSORS, ...UPIB_MIGRATIONS]])).rows.map(r => r.name));
    const missing = UPIB_PREDECESSORS.filter(name => !receipts.has(name));
    if (missing.length) throw Object.assign(Error('upib_migration_predecessor_receipts_missing'), { missing });
    for (const table of BASE_TABLES) await checkContract(client, table, CONTRACTS.base[table], ADDITIONS[table] || []);
    await verifySalesContactNotesSchema(client);
    await verifySalesCheckoutAmountSchema(client, await readMigration('0061_sales_checkout_amount.sql'));
    const installed = UPIB_MIGRATIONS.filter(name => receipts.has(name));
    if (installed.length && installed.length !== UPIB_MIGRATIONS.length) fail('partial_receipts');
    if (installed.length) {
      await client.query(`LOCK TABLE ${NEW_TABLES.map(ident).join(',')} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
      await verifyInstalled(client, sql[1]);
      await client.query('COMMIT');
      return { applied: false, migrations: UPIB_MIGRATIONS, targetFingerprint, reviewedRevision, releaseEvidenceReference, inventoryEvidenceReference, gateEnabled: false };
    }
    await assertNoOwnedObjects(client);
    const snapshots = {};
    for (const [table, excluded] of Object.entries(ADDITIONS)) snapshots[table] = await rowSnapshot(client, table, excluded);
    for (const statement of sql) await client.query(statement);
    await verifyInstalled(client, sql[1]);
    for (const [table, excluded] of Object.entries(ADDITIONS)) if (JSON.stringify(snapshots[table]) !== JSON.stringify(await rowSnapshot(client, table, excluded))) fail('existing_payload_changed');
    for (const name of UPIB_MIGRATIONS) await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    await client.query('COMMIT');
    return { applied: true, migrations: UPIB_MIGRATIONS, targetFingerprint, reviewedRevision, releaseEvidenceReference, inventoryEvidenceReference, gateEnabled: false, transactionElapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.off?.('error', observe);
    client.release(connectionError);
  }
}
