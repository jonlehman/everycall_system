import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {activatePaidIntakeRelease,cutoverDigest} from './lib/paid-intake-release-cutover.mjs';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const file=process.argv[2];
if(!file||!process.env.DATABASE_URL||!process.env.EVERYCALL_CUTOVER_BUNDLE_SHA256)throw Error('Bundle path, DATABASE_URL and independently reviewed EVERYCALL_CUTOVER_BUNDLE_SHA256 required');
const read=path=>{if(fs.statSync(path).size>4*1024*1024)throw Error('cutover_artifact_too_large');return JSON.parse(fs.readFileSync(path,'utf8'));};
const bundle=read(file);
if(cutoverDigest(bundle)!==process.env.EVERYCALL_CUTOVER_BUNDLE_SHA256)throw Error('cutover_bundle_pin_mismatch');
const currentRevision=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
if(currentRevision!==process.env.EVERYCALL_REVIEWED_REVISION)throw Error('Independently reviewed EVERYCALL_REVIEWED_REVISION required');
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd,encoding:'utf8'}).trim())throw Error('Reviewed tracked source must be clean');
execFileSync('git',['ls-files','--error-unmatch','scripts/activate-paid-intake-release.mjs','scripts/lib/paid-intake-release-cutover.mjs','scripts/test-paid-intake-release-cutover.mjs'],{cwd,stdio:'pipe'});
const artifacts=Object.fromEntries(['inventory','provider','runtime','decisions','acceptance'].map(name=>[name,read(bundle.artifactPaths?.[name])]));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:12000});
try{console.log(JSON.stringify(await activatePaidIntakeRelease(pool,{bundle,artifacts,bundleSha256:process.env.EVERYCALL_CUTOVER_BUNDLE_SHA256,currentRevision,databaseUrl:process.env.DATABASE_URL,execute:process.env.EVERYCALL_ACTIVATE_PAID_INTAKE_RELEASE==='1'})));}
catch(error){console.error(JSON.stringify({error:error.code||error.message}));process.exitCode=1;}finally{await pool.end();}
