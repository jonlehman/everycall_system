// Builds a disposable function-only deployment. No app, database code, crons,
// existing local environment files, or application secrets are copied.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'everycall-stripe-acceptance-'));
const deployment=path.join(root,'deployment');
fs.mkdirSync(path.join(deployment,'api'),{recursive:true,mode:0o700});
fs.mkdirSync(path.join(deployment,'.vercel'),{mode:0o700});
const token=crypto.randomBytes(32).toString('hex');
const config={expectedAccountId:'acct_1T8P942HodUYhbMc',runId:`upib_${crypto.randomBytes(8).toString('hex')}`,tokenSha256:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:Date.now()+12*3600000};
fs.writeFileSync(path.join(root,'bearer-token'),token,{mode:0o600});
fs.writeFileSync(path.join(root,'run.json'),JSON.stringify(config,null,2),{mode:0o600});
fs.copyFileSync(fileURLToPath(new URL('./lib/stripe-sandbox-acceptance.mjs',import.meta.url)),path.join(deployment,'probe.mjs'));
fs.writeFileSync(path.join(deployment,'api','acceptance.mjs'),`import {createAcceptanceHandler} from '../probe.mjs';\nexport default createAcceptanceHandler(${JSON.stringify(config)});\n`);
fs.writeFileSync(path.join(deployment,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{stripe:'20.4.1'}},null,2));
fs.writeFileSync(path.join(deployment,'vercel.json'),JSON.stringify({version:2,framework:null,installCommand:'npm install --ignore-scripts --no-audit --no-fund',buildCommand:'',functions:{'api/acceptance.mjs':{maxDuration:300}}},null,2));
fs.writeFileSync(path.join(deployment,'.vercel','project.json'),JSON.stringify({projectId:'prj_sG2tAGfy6Jg39jqvJycxX2uvHoTz',orgId:'team_WP1ULmraMrNqHQ7jl64Usg0d',projectName:'everycall_system'},null,2));
console.log(JSON.stringify({root,deployment,runId:config.runId,expiresAt:new Date(config.expiresAt).toISOString(),tokenFile:path.join(root,'bearer-token')},null,2));
