import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD_BILLING_PLANS } from '../lib/standardBillingPlans.js';
const websiteRoot = resolve(process.env.WEBSITE_ROOT || fileURLToPath(new URL('../../everycall_website/', import.meta.url)));
const files = (await readdir(websiteRoot)).filter((name) => /\.(html|js)$/.test(name));
const stale = /\$(?:49\.50|99\.50|149\.50|504\.90|1,?014\.90|1,?524\.90)|free\s+(?:30.day\s+)?trial|no.credit.card|activate billing|calendly\.com\/jonlehman\/everycall-setup/i;
for (const file of files) {
  const source = await readFile(resolve(websiteRoot, file), 'utf8');
  assert.equal(stale.test(source), false, `${file}: stale public price, unpaid offer or prepayment appointment link`);
  for (const href of source.matchAll(/href="([^"]*app\.everycall\.io[^"#]*)"/g)) {
    assert.ok(/^https:\/\/app\.everycall\.io\/(?:intake|login)(?:[/?]|$)/.test(href[1]), `${file}: obsolete signup destination ${href[1]}`);
  }
}
for (const file of ['index.html', 'pricing.html', 'fencing-contractors.html', 'plumbing-contractors.html', 'window-door-companies.html']) {
  const source = await readFile(resolve(websiteRoot, file), 'utf8');
  for (const disclosure of ['$100', 'first calendar month', '25', '60', '100', '$3.00', '$2.00', '$1.75', 'billed monthly']) assert.ok(source.includes(disclosure), `${file}: missing ${disclosure}`);
}
assert.deepEqual(STANDARD_BILLING_PLANS.map(p => [p.monthlyAmountCents,p.annualAmountCents,p.includedCallCount,p.callOverageRateCents]), [[7450,75990,25,300],[12450,126990,60,200],[17450,177990,100,175]]);
const pricing = await readFile(resolve(websiteRoot,'pricing.html'),'utf8');
for (const plan of STANDARD_BILLING_PLANS) {
  assert.ok(pricing.includes(`data-plan-interest="${plan.code}"`));
  for (const amount of [plan.monthlyAmountCents, plan.annualAmountCents]) assert.ok(pricing.includes((amount/100).toLocaleString('en-US',{style:'currency',currency:'USD'})));
}
const demo = await readFile(resolve(websiteRoot,'demo-home.js'),'utf8');
assert.ok(demo.includes("url.searchParams.set('website', state.websiteUrl)"));
assert.ok(demo.includes("url.searchParams.set('business_name', state.preview.businessName)"));
console.log(`Paid marketing: ${files.length} public HTML/JS files have current offers and links; main offer disclosures and all six prices agree with the app.`);
