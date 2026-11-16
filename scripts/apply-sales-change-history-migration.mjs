import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applySalesHistoryMigration } from './lib/sales-change-history-migration.mjs';
if(process.env.EVERYCALL_APPLY_SALES_HISTORY_0066!=='1')throw Error('EVERYCALL_APPLY_SALES_HISTORY_0066=1 is required');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
const cwd=fileURLToPath(new URL('../',import.meta.url));
const currentRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8',cwd}).trim())throw Error('Reviewed tracked files must be committed and unchanged');
execFileSync('git',['ls-files','--error-unmatch','scripts/apply-sales-change-history-migration.mjs','scripts/lib/sales-change-history-migration.mjs','scripts/test-sales-change-history.mjs','migrations/0066_sales_change_history.sql','lib/salesHistoryInventory.js'],{stdio:'pipe',cwd});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:12000});
try{console.log(JSON.stringify(await applySalesHistoryMigration(pool,{
  databaseUrl:process.env.DATABASE_URL,expectedTargetFingerprint:process.env.EVERYCALL_DATABASE_TARGET_SHA256,
  reviewedRevision:process.env.EVERYCALL_REVIEWED_REVISION,currentRevision,
  expectedMigrationSha256:process.env.EVERYCALL_0066_SQL_SHA256,releaseEvidenceReference:process.env.EVERYCALL_0066_RELEASE_EVIDENCE
})));}catch(error){console.error(JSON.stringify({error:error.code||error.message,missing:error.missing}));process.exitCode=1;}
finally{await pool.end();}
