// Operator-side client. Stores credentials/continuations only in the private
// temporary run directory; evidence contains no keys or continuation tokens.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2){assert.ok(args[i]?.startsWith('--')&&args[i+1],'arguments require --name value');opts[args[i].slice(2)]=args[i+1];}
assert.ok(opts.root&&opts.url&&opts.case&&opts.action,'required: --root --url --case --action');
assert.ok(!opts['vercel-cli']&&!opts['bypass-file']&&!process.env.VC_CLI,'Use only deployment-specific temporary share access; vercel curl can create a project-wide bypass.');
assert.match(opts.case,/^[a-zA-Z0-9_-]{1,100}$/);
const url=new URL('/api/acceptance',opts.url);
assert.equal(url.protocol,'https:');assert.match(url.hostname,/\.vercel\.app$/);
const token=fs.readFileSync(path.join(opts.root,'bearer-token'),'utf8').trim();
const stateFile=path.join(opts.root,`${opts.case}.json`);
const evidenceFile=path.join(opts.root,'evidence.ndjson');
const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
if(opts['share-file']){
  const accessUrl=new URL(url);accessUrl.searchParams.set('_vercel_share',fs.readFileSync(opts['share-file'],'utf8').trim());
  const access=await fetch(accessUrl,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  const cookies=access.headers.getSetCookie().map(c=>c.split(';',1)[0]);
  assert.ok(cookies.length,`Temporary deployment share link did not establish access (HTTP ${access.status}).`);
  headers.cookie=cookies.join('; ');
}
let last=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
async function request(action,fields={}){
  const body={action,...(last?.continuation?{continuation:last.continuation}:{}),...fields};
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(240000)});
  const raw=await response.text(),status=response.status;
  let result;
  try{result=JSON.parse(raw);}catch{throw Error(`Probe returned non-JSON HTTP ${status}; check deployment protection.`);}
  if(result.continuation){last=result;fs.writeFileSync(stateFile,JSON.stringify(result,null,2),{mode:0o600});}
  const {continuation,...evidence}=result;
  fs.appendFileSync(evidenceFile,JSON.stringify({at:new Date().toISOString(),case:opts.case,action,fields,status,...evidence})+'\n',{mode:0o600});
  assert.ok(status>=200&&status<300,`HTTP ${status}: ${JSON.stringify(evidence)}`);
  return evidence;
}
const fields={};
for(const k of ['source','target','month'])if(opts[k]!==undefined)fields[k]=Number(opts[k]);
for(const k of ['calendar','recovery','enrollment','kind','timing','scheduleVariant','methodStrategy','scheduleWhen','invoiceKind','rescheduleMode','scheduleMethodStrategy','metadataContract','checkoutMode'])if(opts[k]!==undefined)fields[k]=opts[k];
if(opts.cancel!==undefined){assert.ok(['true','false'].includes(opts.cancel));fields.cancel=opts.cancel==='true';}
let result;
if(opts.action==='poll'){
  for(let i=0;i<12;i++){
    result=await request('inspect');if(result.ready)break;
    await new Promise(resolve=>setTimeout(resolve,4000));
  }
  assert.ok(result.ready,'Test clock did not become ready within bounded poll; resume poll later.');
}else result=await request(opts.action,fields);
console.log(JSON.stringify(result,(key,value)=>/url$/i.test(key)&&typeof value==='string'?'[stored in private fixture file]':value,2));
