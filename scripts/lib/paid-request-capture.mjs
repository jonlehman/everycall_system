import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// Optional synthetic fixture evidence. Never used by production code.
export function capturePaidRequests(name,requests){
 const directory=process.env.EVERYCALL_UPIB_REQUEST_CAPTURE_DIR;if(!directory)return;
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const sources=['paidIntake.js','paidReinstatement.js','paidPurchaseContract.js','paidPurchaseEvents.js','paidBillingChanges.js','paidBaseInvoice.js','paidUsageInvoices.js','callBilling.js'];
 const sourceSha256=Object.fromEntries(sources.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(new URL(`../../pages/api/_lib/${file}`,import.meta.url))).digest('hex')]));
 sourceSha256['lib/paidBillingCalendar.js']=crypto.createHash('sha256').update(fs.readFileSync(new URL('../../lib/paidBillingCalendar.js',import.meta.url))).digest('hex');
 fs.writeFileSync(path.join(directory,`${name}.json`),JSON.stringify({fixtureOnly:true,sourceSha256,requests},null,2)+'\n',{mode:0o600});
}
