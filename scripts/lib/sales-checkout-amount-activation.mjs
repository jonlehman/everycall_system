import { readMigration } from './schema-migrations.mjs';
import { writeAuditLog } from '../../pages/api/_lib/auditLog.js';
import { SALES_AMOUNT_MIGRATION,SALES_AMOUNT_PREDECESSORS,amountMigrationDigest,salesAmountTargetFingerprint,verifySalesCheckoutAmountSchema } from './sales-checkout-amount-migration.mjs';
import { verifySalesIntroEmailSchema } from './sales-intro-email-migration.mjs';

export const SALES_AMOUNT_RETIREMENT_SECONDS=810;
export const SALES_AMOUNT_ACTIVATION_ACTION='sales.checkout.custom_amount_enabled';
// Trusted release operation only; there is deliberately no HTTP importer.
// Deployment/alias verification is an operator attestation referenced here;
// PostgreSQL independently enforces the elapsed retirement interval.
export async function activateSalesCheckoutAmount(pool,options={}) {
  const {databaseUrl,expectedTargetFingerprint,reviewedRevision,currentRevision,expectedMigrationSha256,releaseEvidenceReference,deploymentId,cutoverAt,adminUserId,apply=false}=options;
  const targetFingerprint=salesAmountTargetFingerprint(databaseUrl);
  if(targetFingerprint!==expectedTargetFingerprint)throw Error('amount_activation_target_mismatch');
  if(!/^[a-f0-9]{40}$/.test(reviewedRevision||'')||reviewedRevision!==currentRevision)throw Error('amount_activation_reviewed_revision_mismatch');
  const sql=await readMigration(SALES_AMOUNT_MIGRATION);
  if(amountMigrationDigest(sql)!==expectedMigrationSha256)throw Error('amount_activation_reviewed_sql_mismatch');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{5,159}$/.test(releaseEvidenceReference||''))throw Error('amount_activation_release_evidence_required');
  if(!/^dpl_[A-Za-z0-9]{6,100}$/.test(deploymentId||''))throw Error('amount_activation_deployment_required');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(cutoverAt||'')||!Number.isFinite(Date.parse(cutoverAt)))throw Error('amount_activation_utc_cutover_required');
  if(!/^[1-9][0-9]*$/.test(String(adminUserId||'')))throw Error('amount_activation_admin_required');
  if(typeof apply!=='boolean')throw Error('amount_activation_apply_invalid');
  const client=await pool.connect();let connectionError;
  const listener=error=>{connectionError=error;};client.on?.('error',listener);
  try {
    await client.query(apply?'BEGIN':'BEGIN READ ONLY');
    await client.query("SET LOCAL lock_timeout='3s'");
    if((await client.query("SELECT current_setting('transaction_timeout',TRUE) AS timeout")).rows[0]?.timeout==null)throw Error('amount_activation_transaction_deadline_unavailable');
    await client.query("SET LOCAL transaction_timeout='10s'");await client.query("SET LOCAL statement_timeout='10s'");await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    if(apply)await client.query('SELECT pg_advisory_xact_lock(1763910417)');
    const names=[...SALES_AMOUNT_PREDECESSORS,SALES_AMOUNT_MIGRATION];
    const receipts=await client.query('SELECT name FROM schema_migrations WHERE name=ANY($1::text[])',[names]);
    if(names.some(name=>!receipts.rows.some(row=>row.name===name)))throw Error('amount_activation_receipts_missing');
    const gate=(await client.query(`SELECT custom_signup_amount_enabled FROM sales_dialer_config WHERE id=TRUE${apply?' FOR UPDATE NOWAIT':''}`)).rows[0];
    if(!gate)throw Error('amount_activation_config_missing');
    const actor=(await client.query(`SELECT role FROM admin_users WHERE id=$1${apply?' FOR SHARE NOWAIT':''}`,[adminUserId])).rows[0];
    if(actor?.role!=='admin')throw Error('amount_activation_admin_required');
    await verifySalesIntroEmailSchema(client);await verifySalesCheckoutAmountSchema(client,sql);
    const clock=(await client.query('SELECT clock_timestamp() AS server_now,EXTRACT(EPOCH FROM clock_timestamp()-$1::timestamptz) AS elapsed_seconds',[cutoverAt])).rows[0];
    const elapsedSeconds=Number(clock.elapsed_seconds);
    if(elapsedSeconds<SALES_AMOUNT_RETIREMENT_SECONDS)throw Error('amount_activation_old_invocations_not_retired');
    const evidence={adminUserId:String(adminUserId),migration:SALES_AMOUNT_MIGRATION,migrationSha256:expectedMigrationSha256,targetFingerprint,reviewedRevision,releaseEvidenceReference,deploymentId,cutoverAt,retirementSeconds:SALES_AMOUNT_RETIREMENT_SECONDS,serverVerifiedAt:new Date(clock.server_now).toISOString(),elapsedSeconds};
    if(gate.custom_signup_amount_enabled){
      const history=await client.query("SELECT id,details FROM audit_log WHERE action=$1 ORDER BY id DESC LIMIT 1",[SALES_AMOUNT_ACTIVATION_ACTION]);
      let previous;try{previous=JSON.parse(history.rows[0]?.details||'null');}catch{}
      if(previous?.targetFingerprint!==targetFingerprint||previous?.migrationSha256!==expectedMigrationSha256)throw Error('amount_activation_existing_gate_without_evidence');
      await client.query('COMMIT');return {activated:false,alreadyEnabled:true,auditId:history.rows[0].id,evidence:previous};
    }
    if(!apply){await client.query('COMMIT');return {activated:false,ready:true,evidence};}
    await client.query('UPDATE sales_dialer_config SET custom_signup_amount_enabled=TRUE WHERE id=TRUE');
    await writeAuditLog(client,{actor:`admin:${adminUserId}`,action:SALES_AMOUNT_ACTIVATION_ACTION,details:evidence});
    const audit=await client.query('SELECT id FROM audit_log WHERE actor=$1 AND action=$2 AND details=$3 ORDER BY id DESC LIMIT 1',[`admin:${adminUserId}`,SALES_AMOUNT_ACTIVATION_ACTION,JSON.stringify(evidence)]);
    if(!audit.rowCount)throw Error('amount_activation_audit_missing');
    await client.query('COMMIT');return {activated:true,auditId:audit.rows[0].id,evidence};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release(connectionError);client.removeListener?.('error',listener);}
}
