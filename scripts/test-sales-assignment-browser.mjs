import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const postcss = require('postcss'), tailwind = require('tailwindcss');
const dir = await mkdtemp(join(tmpdir(), 'everycall-assignment-browser-'));
await build({ stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import ProspectsManager from './app/admin/sales/ProspectsManager.jsx';createRoot(document.getElementById('root')).render(<ProspectsManager/>);", loader:'jsx',resolveDir:resolve('.') },bundle:true,outdir:dir,entryNames:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'no-provider-code',setup(api){api.onLoad({filter:/telnyxBrowserClient|@telnyx/},()=>{throw Error('Admin list must not initialize calling.');});}}] });
const css = await postcss([tailwind({ content:[resolve('app/admin/sales/ProspectsManager.jsx')], theme:{extend:{}},plugins:[] })]).process('@tailwind base; @tailwind components; @tailwind utilities;', {from:undefined});
await writeFile(join(dir,'fixture.css'),css.css+'\nbody{font-family:Arial,sans-serif;background:#f8fafc;padding:24px;}');
await writeFile(join(dir,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
const server=createServer(async(req,res)=>{try{const name=req.url.split('?')[0];const file=name==='/'?'index.html':name.slice(1);if(!['index.html','fixture.js','fixture.css'].includes(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(join(dir,file)));}catch{res.writeHead(500);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const operators=[{id:1,settingsUserId:1,active:true,displayName:'First Rep',email:'first@example.test'},{id:2,settingsUserId:2,active:true,displayName:'Second Rep',email:'second@example.test'},{id:3,settingsUserId:3,active:false,displayName:'Inactive Rep',email:'inactive@example.test'}];
let rows=['Alpha Plumbing','Beta Heating','Gamma Electric','Alpha Roofing','Delta Repairs'].map((businessName,index)=>({prospectId:`p${index}`,businessName,contactName:'Sam Owner',phoneE164:`+1206555010${index}`,status:'queued',rowVersion:1,assignedRepUserId:index%2?null:1,assignedRepName:index%2?null:'First Rep',assignedRepEmail:index%2?null:'first@example.test'}));
let assignmentFailure=false, releaseAssignment=null, delayedList=null, mutation=null, requestCount=0;
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 if(url.pathname.endsWith('/operator-settings'))return json({operators});
 if(url.pathname.endsWith('/assign')){
  mutation={body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']};requestCount++;
  if(assignmentFailure)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Beta Heating: finish its call and refresh. No prospects were reassigned.'})});
  await new Promise(resolve=>{releaseAssignment=resolve;});
  for(const selected of mutation.body.prospects){const row=rows.find(row=>row.prospectId===selected.prospectId);row.assignedRepUserId=2;row.assignedRepName='Second Rep';row.assignedRepEmail='second@example.test';row.rowVersion++;}
  return json({ok:true,assignedCount:mutation.body.prospects.length});
 }
 if(url.pathname.endsWith('/prospects')){
  const params=url.searchParams;let matching=rows.filter(row=>(!params.get('search')||row.businessName.toLowerCase().includes(params.get('search').toLowerCase()))&&(params.get('assignment')!=='assigned'||row.assignedRepUserId!==null)&&(params.get('assignment')!=='unassigned'||row.assignedRepUserId===null));
  if(params.get('sort')==='business')matching.sort((a,b)=>a.businessName.localeCompare(b.businessName)||a.prospectId.localeCompare(b.prospectId));if(params.get('direction')==='desc')matching.reverse();
  const offset=Number(params.get('cursor')||0),body={prospects:matching.slice(offset,offset+2),total:matching.length,nextCursor:offset+2<matching.length?String(offset+2):null};
  if(params.get('search')==='slow'){await new Promise(resolve=>{delayedList=resolve;});body.prospects=[{...rows[0],businessName:'STALE RESPONSE'}];body.total=1;}
  return json(body);
 }
 throw Error(`Unexpected mocked API: ${url.pathname}`);
});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByText('2 of 5 total prospects loaded',{exact:true}).waitFor();
 const submit=page.getByRole('button',{name:'Assign to Rep',exact:true}), all=page.getByRole('checkbox',{name:'Select all visible prospects',exact:true});
 assert.equal(await submit.isDisabled(),true);assert.equal(await page.getByRole('option',{name:/Inactive Rep/}).count(),0);
 await page.getByRole('checkbox',{name:'Select Alpha Plumbing',exact:true}).check();await page.getByText('1 selected',{exact:true}).waitFor();assert.equal(await all.evaluate(node=>node.indeterminate),true);
 await all.check();await page.getByText('2 selected',{exact:true}).waitFor();assert.equal(await submit.isDisabled(),true);
 await page.getByRole('button',{name:'Load more',exact:true}).click();await page.getByText('4 of 5 total prospects loaded',{exact:true}).waitFor();await page.getByText('0 selected',{exact:true}).waitFor();
 await all.check();await page.getByText('4 selected',{exact:true}).waitFor();await page.getByRole('combobox',{name:'Assign to rep',exact:true}).selectOption('2');
 await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Assign to Rep' && !button.disabled));
 assert.equal(await submit.isDisabled(),false);
 await page.screenshot({path:'/tmp/everycall-admin-assignment.png',fullPage:true});
 await submit.click();await page.getByRole('button',{name:'Assigning…'}).waitFor();assert.equal(await all.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).isDisabled(),true);
 assert.equal(mutation.body.prospects.length,4);assert.equal(mutation.body.targetRepUserId,2);assert.equal(mutation.body.prospects[0].expectedRowVersion,1);assert.equal(mutation.body.prospects[0].assignedRepUserId,1);assert.ok(mutation.key);
 releaseAssignment();await page.getByText('4 prospects assigned to Second Rep.',{exact:true}).waitFor();await page.getByText('2 of 5 total prospects loaded',{exact:true}).waitFor();await page.getByText('0 selected',{exact:true}).waitFor();assert.equal(requestCount,1);
 await page.getByRole('button',{name:'Unassigned',exact:true}).click();await page.getByText('No prospects match these filters.',{exact:true}).waitFor();assert.equal(await all.isDisabled(),true);
 await page.getByRole('button',{name:'Assigned',exact:true}).click();await page.getByText('2 of 5 total prospects loaded',{exact:true}).waitFor();
 await all.check();await page.getByRole('combobox',{name:'Sort prospects',exact:true}).selectOption('business');await page.getByText('0 selected',{exact:true}).waitFor();await page.getByText('Alpha Roofing',{exact:true}).waitFor();
 await page.getByRole('combobox',{name:'Sort direction',exact:true}).selectOption('desc');await page.getByText('Gamma Electric',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Search prospects',exact:true}).fill('Alpha');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('2 of 2 total prospects loaded',{exact:true}).waitFor();
 const href=await page.getByRole('link',{name:'Export CSV'}).getAttribute('href');assert.match(href,/assignment=assigned/);assert.match(href,/sort=business/);assert.match(href,/direction=desc/);assert.match(href,/search=Alpha/);
 await all.check();assignmentFailure=true;await submit.click();await page.getByRole('alert').filter({hasText:'finish its call'}).waitFor();await page.getByText('0 selected',{exact:true}).waitFor();assert.equal(await submit.isDisabled(),true);
 // An older search response must never overwrite the newer filtered dataset.
 await page.getByRole('textbox',{name:'Search prospects',exact:true}).fill('slow');await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByText('Loading prospects…',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Search prospects',exact:true}).fill('Alpha');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('2 of 2 total prospects loaded',{exact:true}).waitFor();
 delayedList();await page.waitForTimeout(100);assert.equal(await page.getByText('STALE RESPONSE',{exact:true}).count(),0);
 await all.check();await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('0 selected',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['individual selection','select all loaded only','load-more/filter/sort/refresh selection reset','active operators','assignment body/receipt','in-flight disable','success reload','actionable atomic error','search/export filters','out-of-order response protection','no provider code'],screenshot:'/tmp/everycall-admin-assignment.png',fixture:dir}));
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
