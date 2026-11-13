import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSalesReportFixture } from './lib/sales-report-fixture.mjs';
import reportHandler from '../pages/api/v1/admin/sales/reports.js';
const require=createRequire(import.meta.url);
const {build}=require(process.env.ESBUILD_MODULE || 'esbuild'),{chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright'),postcss=require('postcss'),tailwind=require('tailwindcss');
const dir=await mkdtemp(join(tmpdir(),'everycall-sales-report-browser-'));
await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import SalesReports from './app/admin/sales/SalesReports.jsx';createRoot(document.getElementById('root')).render(<SalesReports/>);",loader:'jsx',resolveDir:resolve('.')},bundle:true,outdir:dir,entryNames:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'no-provider-code',setup(api){api.onLoad({filter:/telnyxBrowserClient|@telnyx/},()=>{throw Error('Report must not initialize calling.');});}}]});
const css=await postcss([tailwind({content:[resolve('app/admin/sales/SalesReports.jsx'),resolve('app/admin/sales/SalesUi.jsx')],theme:{extend:{}},plugins:[]})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
await writeFile(join(dir,'fixture.css'),css.css+'\nbody{font-family:Arial,sans-serif;background:#f8fafc;padding:24px;}');
await writeFile(join(dir,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
const fixture=await createSalesReportFixture();
process.env.DATABASE_URL='postgres://report-browser-fixture';globalThis.__everycallPool=fixture.pool;
let failReport=false;
const requests=[];
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/v1/admin/sales/reports'){
   requests.push(Object.fromEntries(url.searchParams));
   res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res;};res.send=body=>{res.end(body);return res;};
   if(failReport){res.status(503).json({message:'Synthetic report unavailable'});return;}
   req.query=Object.fromEntries(url.searchParams);req.headers.cookie='everycall_session=report-admin';
   await reportHandler(req,res);return;
  }
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','fixture.js','fixture.css'].includes(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(join(dir,file)));
 }catch(error){res.writeHead(500);res.end(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-11-13T18:00:00Z'));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByText('1–100 of 210',{exact:false}).waitFor();
 assert.equal(await page.getByRole('img').count(),4);
 assert.equal(await page.getByRole('button',{name:'Previous page',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByText('101–200 of 210',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByText('201–210 of 210',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Next page',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Previous page',exact:true}).click();await page.getByText('101–200 of 210',{exact:false}).waitFor();
 await page.getByRole('combobox',{name:'Date range',exact:true}).selectOption('all');await page.getByRole('button',{name:'Update report',exact:true}).click();
 await page.getByText('1–100 of 211',{exact:false}).waitFor();await page.getByRole('heading',{name:'Monthly call activity'}).waitFor();assert.equal(await page.getByLabel('From (UTC)',{exact:true}).isDisabled(),true);
 await page.getByRole('combobox',{name:'Call mode',exact:true}).selectOption('test');await page.getByRole('button',{name:'Update report',exact:true}).click();await page.getByText('1–1 of 1',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Show details for/}).count(),1);
 await page.getByRole('combobox',{name:'Call mode',exact:true}).selectOption('live');await page.getByRole('combobox',{name:'Date range',exact:true}).selectOption('dates');
 await page.getByLabel('From (UTC)',{exact:true}).fill('2026-11-10');await page.getByLabel('Through (UTC)',{exact:true}).fill('2026-11-13');await page.getByRole('button',{name:'Update report',exact:true}).click();await page.getByText('1–100 of 209',{exact:false}).waitFor();
 await page.screenshot({path:'/tmp/everycall-sales-report-desktop.png',fullPage:true});
 await page.getByLabel('Search calls',{exact:true}).fill('micro-c');await page.getByRole('button',{name:'Update report',exact:true}).click();await page.getByText('1–1 of 1',{exact:false}).waitFor();
 const detail=page.getByRole('button',{name:/Show details for/});await detail.focus();await page.keyboard.press('Enter');
 await page.getByRole('heading',{name:'Transcript',exact:true}).waitFor();await page.getByText('Hello <script>window.bad=true</script>',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.bad),undefined);assert.equal(await page.locator('img').count(),0);await page.getByText('<img src=x onerror=alert(1)>',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Hide details for/}).getAttribute('aria-expanded'),'true');
 assert.equal(await page.getByText('Provider error code',{exact:true}).count(),1);assert.ok(!(await page.locator('body').innerText()).includes('SECRET_'));
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export filtered calls (CSV)',exact:true}).click();const download=await downloading;const csv=await readFile(await download.path(),'utf8');assert.ok(csv.includes('micro-c'));assert.ok(!csv.includes('call-001'));assert.ok(csv.includes("' =HYPERLINK"));assert.ok(requests.some(request=>request.format==='csv'&&request.search==='micro-c'&&!request.cursor));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/everycall-sales-report-mobile-details.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Report should not overflow the mobile viewport');
 await page.getByLabel('Search calls',{exact:true}).fill('absent');await page.getByRole('button',{name:'Update report',exact:true}).click();await page.getByText('No call sessions match these filters.',{exact:false}).waitFor();
 await page.getByLabel('Search calls',{exact:true}).fill('');await page.getByRole('combobox',{name:'Sales rep',exact:true}).selectOption('1');await page.getByRole('combobox',{name:'Outcome',exact:true}).selectOption('demo_completed');await page.getByRole('button',{name:'Update report',exact:true}).click();await page.getByText('1–100 of 102',{exact:false}).waitFor();
 await page.screenshot({path:'/tmp/everycall-sales-report-mobile.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 failReport=true;await page.getByRole('button',{name:'Update report',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic report unavailable'}).waitFor();assert.equal(await page.getByRole('heading',{name:'All call sessions'}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS Sales report browser: real fixture API, charts, pagination, filters, transcript, safe notes, CSV download, errors and responsive desktop/mobile');
 console.log('Screenshots: /tmp/everycall-sales-report-desktop.png /tmp/everycall-sales-report-mobile.png /tmp/everycall-sales-report-mobile-details.png');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await fixture.close();}
