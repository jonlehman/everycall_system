import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {applyPrivateOwnerMigration,PRIVATE_OWNER_MIGRATION} from './lib/private-owner-migration.mjs';
const currentRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw Error('clean_reviewed_checkout_required');
execFileSync('git',['ls-files','--error-unmatch',`migrations/${PRIVATE_OWNER_MIGRATION}`,'scripts/lib/private-owner-migration.mjs','scripts/apply-private-owner-migration.mjs'],{stdio:'pipe'});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:12000});
try{console.log(JSON.stringify(await applyPrivateOwnerMigration(pool,{execute:process.env.EVERYCALL_APPLY_PRIVATE_OWNER_BILLING==='1',databaseUrl:process.env.DATABASE_URL,targetFingerprint:process.env.EVERYCALL_DATABASE_TARGET_SHA256,currentRevision,reviewedRevision:process.env.EVERYCALL_REVIEWED_REVISION,sqlSha256:process.env.EVERYCALL_0065_SQL_SHA256,evidenceReference:process.env.EVERYCALL_UPIB_RELEASE_EVIDENCE})));}finally{await pool.end();}
