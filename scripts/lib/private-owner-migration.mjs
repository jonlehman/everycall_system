import {readMigration} from './schema-migrations.mjs';
import {upibCatalogContract,upibMigrationDigest,upibTargetFingerprint,verifyUnifiedPaidBillingInstalled} from './unified-paid-billing-migrations.mjs';
export const PRIVATE_OWNER_MIGRATION='0065_private_owner_billing.sql';
const TABLE_HASH='99c7485a21db7e72a88e3843134c8fb9483f61ba9bbe4b0e2a01276eb9f6c006';
const fail=code=>{throw Error(`private_owner_migration_${code}`);};
export async function verifyPrivateOwnerMigration(db,sql){
 if(upibMigrationDigest(JSON.stringify(await upibCatalogContract(db,'private_owner_billing')))!==TABLE_HASH)fail('table_drift');
 const rows=(await db.query(`SELECT p.prosrc,p.prosecdef,p.proconfig,p.provolatile,p.proparallel,p.proisstrict,l.lanname,
 pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_function_result(p.oid) AS result,pg_get_expr(p.proargdefaults,0) AS defaults
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname=current_schema() AND p.proname='reserve_private_or_paid_call'`)).rows;
 const f=rows[0],expected=sql.match(/AS \$\$([\s\S]*?)\$\$/)?.[1];
 if(rows.length!==1||f.prosrc!==expected||f.prosecdef||f.proconfig!==null||f.provolatile!=='v'||f.proparallel!=='u'||f.proisstrict||f.lanname!=='plpgsql'
 ||f.arguments!=='p_tenant text, p_call text, p_now timestamp with time zone'||f.result!=='TABLE(allowed boolean, reason text, period_id bigint)'||f.defaults!=='now()')fail('function_drift');
}
export async function applyPrivateOwnerMigration(pool,{execute=false,databaseUrl,targetFingerprint,currentRevision,reviewedRevision,sqlSha256,evidenceReference}={}){
 if(targetFingerprint!==upibTargetFingerprint(databaseUrl)||!/^[a-f0-9]{64}$/.test(targetFingerprint||''))fail('target_pin');
 if(!/^[a-f0-9]{40}$/.test(reviewedRevision||'')||currentRevision!==reviewedRevision)fail('revision_pin');
 if(!/^[\w][\w:/#.-]{5,239}$/.test(evidenceReference||''))fail('evidence');
 const sql=await readMigration(PRIVATE_OWNER_MIGRATION);if(upibMigrationDigest(sql)!==sqlSha256)fail('sql_pin');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL transaction_timeout='10s'");await db.query("SET LOCAL statement_timeout='5s'");await db.query("SET LOCAL lock_timeout='250ms'");
  if(!(await db.query('SELECT pg_try_advisory_xact_lock(1763910417) AS locked')).rows[0].locked)fail('busy');
  await db.query('LOCK TABLE schema_migrations,tenants,tenant_billing_accounts,paid_intake_release IN SHARE ROW EXCLUSIVE MODE NOWAIT');
  if((await db.query("SELECT 1 FROM schema_migrations WHERE name IN('0063_unified_paid_intake.sql','0064_paid_billing_lifecycle.sql')")).rowCount!==2)fail('predecessors');
  await verifyUnifiedPaidBillingInstalled(db,await readMigration('0064_paid_billing_lifecycle.sql'));
  if((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1',[PRIVATE_OWNER_MIGRATION])).rowCount){
   await verifyPrivateOwnerMigration(db,sql);await db.query('ROLLBACK');return {applied:false,verified:true};
  }
  if((await db.query('SELECT enabled FROM paid_intake_release WHERE id=TRUE')).rows[0]?.enabled)fail('release_already_enabled');
  if((await db.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN('private_owner_billing','private_owner_billing_pkey') UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='reserve_private_or_paid_call'")).rowCount)fail('owned_object_collision');
  if(!execute){await db.query('ROLLBACK');return {applied:false,dryRun:true};}
  await db.query(sql);await verifyPrivateOwnerMigration(db,sql);
  await db.query('INSERT INTO schema_migrations(name) VALUES($1)',[PRIVATE_OWNER_MIGRATION]);
  await db.query("INSERT INTO audit_log(actor,action,details) VALUES('operator:reviewed-release','billing.private_owner.schema_installed',$1)",[JSON.stringify({reviewedRevision,sqlSha256,targetFingerprint,evidenceReference})]);
  await db.query('COMMIT');return {applied:true,reviewedRevision,sqlSha256,targetFingerprint};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
}
