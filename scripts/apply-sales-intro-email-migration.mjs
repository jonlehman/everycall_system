import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applySalesIntroEmailMigration } from './lib/sales-intro-email-migration.mjs';

if(process.env.EVERYCALL_APPLY_SALES_INTRO_0060!=='1')throw Error('EVERYCALL_APPLY_SALES_INTRO_0060=1 is required');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const currentRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:repositoryRoot}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8',cwd:repositoryRoot}).trim())throw Error('Reviewed tracked files must be committed and unchanged');
execFileSync('git',['ls-files','--error-unmatch','scripts/apply-sales-intro-email-migration.mjs','scripts/lib/sales-intro-email-migration.mjs','migrations/0060_sales_intro_email.sql'],{stdio:'pipe',cwd:repositoryRoot});
const onlineAdditive=process.env.EVERYCALL_0060_ONLINE_ADDITIVE==='1';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:onlineAdditive?12000:35000});
try {
  const result=await applySalesIntroEmailMigration(pool,{
    databaseUrl:process.env.DATABASE_URL,expectedTargetFingerprint:process.env.EVERYCALL_DATABASE_TARGET_SHA256,
    reviewedRevision:process.env.EVERYCALL_REVIEWED_REVISION,currentRevision,expectedMigrationSha256:process.env.EVERYCALL_0060_SQL_SHA256,
    onlineAdditive,releaseEvidenceReference:process.env.EVERYCALL_0060_RELEASE_EVIDENCE,
    drainEvidenceReference:process.env.EVERYCALL_SALES_DRAIN_EVIDENCE,
    salesIngressFenced:process.env.EVERYCALL_SALES_INGRESS_FENCED==='1',salesJobsPaused:process.env.EVERYCALL_SALES_JOBS_PAUSED==='1',providerLegsDrained:process.env.EVERYCALL_SALES_PROVIDER_LEGS_DRAINED==='1'
  });
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({error:error.code||error.message,missing:error.missing,counts:error.counts,collisions:error.collisions,elapsedMs:error.elapsedMs,transactionElapsedMs:error.transactionElapsedMs}));process.exitCode=1;}
finally{await pool.end();}
