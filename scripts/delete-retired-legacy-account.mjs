import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {deleteRetiredLegacyAccount} from './lib/delete-retired-legacy-account.mjs';
const [path,pin]=process.argv.slice(2);if(!path||!pin)throw Error('usage: node scripts/delete-retired-legacy-account.mjs /private/reviewed-bundle.json sha256');
const bundle=JSON.parse(await readFile(path,'utf8')),currentRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw Error('clean_reviewed_checkout_required');
execFileSync('git',['ls-files','--error-unmatch','scripts/delete-retired-legacy-account.mjs','scripts/lib/delete-retired-legacy-account.mjs'],{stdio:'pipe'});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:12000});
try{console.log(JSON.stringify(await deleteRetiredLegacyAccount(pool,{bundle,bundleSha256:pin,currentRevision,databaseUrl:process.env.DATABASE_URL,execute:process.env.EVERYCALL_DELETE_RETIRED_ACCOUNT==='daved'})));}finally{await pool.end();}
