import fs from 'node:fs';
const [capabilityPath,receiptPath]=process.argv.slice(2);
if(!capabilityPath||!receiptPath||fs.existsSync(receiptPath))throw Error('private_capability_and_new_receipt_path_required');
const stat=fs.statSync(capabilityPath);if((stat.mode&0o077)!==0)throw Error('capability_file_must_be_private');
const credential=JSON.parse(fs.readFileSync(capabilityPath,'utf8'));
const route='https://app.everycall.io/api/v1/operator/retire-daved-number';
if(credential.route!==route||!/^[A-Za-z0-9_-]{43}$/.test(credential.capability||'')||Date.parse(credential.expiresAt)<=Date.now())throw Error('invalid_or_expired_capability');
// Fixed HTTPS origin, header-only capability, no redirects or transport retries.
// Persist intent locally before HTTP. A timeout never authorizes a fresh effect;
// the server's resource fence makes later calls canonical reconciliation only.
fs.writeFileSync(receiptPath,JSON.stringify({state:'request_prepared',operationId:credential.operationId,observedAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
try{
 const response=await fetch(route,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${credential.capability}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(50000)});
 const body=await response.json();
 const receipt={state:response.ok?'response_received':'reconciliation_required',httpStatus:response.status,operationId:credential.operationId,observedAt:new Date().toISOString(),result:body};
 fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({receiptPath,httpStatus:response.status,absent:body?.absent===true,canonicalReadback:body?.canonicalReadback===true}));
 if(!response.ok)process.exitCode=1;
}catch{fs.writeFileSync(receiptPath,JSON.stringify({state:'request_outcome_unknown',operationId:credential.operationId,observedAt:new Date().toISOString(),nextAction:'canonical_reconciliation_only'})+'\n',{mode:0o600});console.error(JSON.stringify({receiptPath,state:'request_outcome_unknown'}));process.exitCode=1;}
