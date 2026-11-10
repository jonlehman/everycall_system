import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applySalesCheckoutAmountMigration } from './lib/sales-checkout-amount-migration.mjs';

if(process.env.EVERYCALL_APPLY_SALES_AMOUNT_0061!=='1')throw Error('EVERYCALL_APPLY_SALES_AMOUNT_0061=1 is required');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const currentRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:repositoryRoot}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8',cwd:repositoryRoot}).trim())throw Error('Reviewed tracked files must be committed and unchanged');
execFileSync('git',['ls-files','--error-unmatch','scripts/apply-sales-checkout-amount-migration.mjs','scripts/lib/sales-checkout-amount-migration.mjs','scripts/test-sales-checkout-amount-migration.mjs','migrations/0061_sales_checkout_amount.sql'],{stdio:'pipe',cwd:repositoryRoot});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:12000});
try {
  const result=await applySalesCheckoutAmountMigration(pool,{
    databaseUrl:process.env.DATABASE_URL,expectedTargetFingerprint:process.env.EVERYCALL_DATABASE_TARGET_SHA256,
    reviewedRevision:process.env.EVERYCALL_REVIEWED_REVISION,currentRevision,expectedMigrationSha256:process.env.EVERYCALL_0061_SQL_SHA256,
    releaseEvidenceReference:process.env.EVERYCALL_0061_RELEASE_EVIDENCE,legacyPriceEvidenceReference:process.env.EVERYCALL_0061_LEGACY_PRICE_EVIDENCE
  });
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({error:error.code||error.message,missing:error.missing,counts:error.counts,collisions:error.collisions,elapsedMs:error.elapsedMs,transactionElapsedMs:error.transactionElapsedMs}));process.exitCode=1;}
finally{await pool.end();}
