import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {authorizeRetiredNumberRelease} from './lib/authorize-retired-number-release.mjs';
const [path,pin,capabilityPath]=process.argv.slice(2),execute=process.env.EVERYCALL_AUTHORIZE_DAVED_NUMBER_RELEASE==='1';
if(!path||!pin||(execute&&(!capabilityPath||fs.existsSync(capabilityPath))))throw Error('reviewed_bundle_pin_and_new_private_capability_path_required');
const currentRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw Error('clean_reviewed_checkout_required');
execFileSync('git',['ls-files','--error-unmatch','scripts/authorize-retired-number-release.mjs','scripts/lib/authorize-retired-number-release.mjs','pages/api/_lib/retiredNumberRelease.js','pages/api/v1/operator/retire-daved-number.js'],{stdio:'pipe'});
const bundle=JSON.parse(fs.readFileSync(path,'utf8')),pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:7000});
try{console.log(JSON.stringify(await authorizeRetiredNumberRelease(pool,{bundle,bundleSha256:pin,databaseUrl:process.env.DATABASE_URL,currentRevision,execute,saveCapability:async value=>fs.writeFileSync(capabilityPath,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600})})));}finally{await pool.end();}
