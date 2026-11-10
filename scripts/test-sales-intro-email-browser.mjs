import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(join(tmpdir(), 'sales-intro-ui-'));
await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Modal from './app/admin/sales/SalesIntroEmailModal';function App(){const [open,setOpen]=useState(false),[identity,setIdentity]=useState('p:c:');return <><button onClick={()=>setOpen(true)}>Open</button><button onClick={()=>setIdentity('p:other:')}>Change</button>{open&&<Modal prospectId="p" contactId="c" currentIdentity={identity} onClose={()=>setOpen(false)}/>}</>}createRoot(document.getElementById('root')).render(<App/>);`, loader:'jsx', resolveDir:resolve('.') }, bundle:true, outdir:dir, entryNames:'fixture', jsx:'automatic', loader:{'.module.css':'local-css'} });
await writeFile(join(dir,'index.html'), '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
let sends = [], result = 'sent';
const server = createServer(async (req,res) => {
  if (!req.url.startsWith('/api/')) { try { res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':req.url.endsWith('.css')?'text/css':'text/html'); res.end(await readFile(join(dir,req.url === '/' ? 'index.html' : req.url.slice(1)))); } catch {res.statusCode=404;res.end();} return; }
  let body=''; for await (const chunk of req) body+=chunk;
  res.setHeader('Content-Type','application/json');
  if (req.url.endsWith('/draft')) return res.end(JSON.stringify({draft:{draftToken:'token',contactId:'c',recipient:'person@example.test',replyTo:'rep@example.test',subject:'Hi Pat',text:'Hello Pat\nRam',requiresEmailPermissionConfirmation:true}}));
  sends.push({body:JSON.parse(body),key:req.headers['idempotency-key']});
  if(result === 'invalid') {res.statusCode=400;return res.end(JSON.stringify({error:'invalid',message:'Fix the message.'}));}
  if(result === 'pending') {res.statusCode=409;return res.end(JSON.stringify({error:'intro_email_delivery_pending',message:'Ask an administrator.'}));}
  res.end(JSON.stringify({delivery:{status:'sent',contactId:'c'}}));
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const page = await browser.newPage({viewport:{width:390,height:650}});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByText('Open').click();
  const dialog=page.getByRole('dialog'); await dialog.getByText('person@example.test').waitFor();
  assert.equal(await dialog.getByText('rep@example.test').count(),1);
  assert.equal(await dialog.getByLabel('Subject').inputValue(),'Hi Pat');
  assert.match(await dialog.getByLabel('Message').inputValue(),/Hello Pat\nRam/);
  await page.keyboard.press('Escape'); assert.equal(sends.length,0); assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Open');
  await page.getByText('Open').click(); await dialog.getByLabel('Subject').fill('Edited'); await dialog.getByLabel('Message').fill('Edited body'); await dialog.getByRole('checkbox').check();
  result='invalid'; await dialog.getByRole('button',{name:'Send',exact:true}).click(); await dialog.getByText('Fix the message.').waitFor(); assert.equal(await dialog.getByLabel('Subject').inputValue(),'Edited');
  result='pending'; await dialog.getByRole('button',{name:'Send',exact:true}).click(); await dialog.getByText(/Delivery status is uncertain/).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Send',exact:true}).isDisabled(),true); assert.match(await dialog.getByRole('button',{name:'Send',exact:true}).getAttribute('aria-describedby'), /intro-disabled-reason/); assert.match(await dialog.locator('#intro-disabled-reason').textContent(), /Editing and sending are disabled/); await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});
  assert.equal(sends.length,2); assert.equal(sends[0].body.subject,'Edited'); assert.equal(sends[0].key,sends[1].key);
  await page.getByText('Open').click(); await dialog.getByLabel('Subject').waitFor(); await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Change').click()); await dialog.waitFor({state:'detached'}); assert.equal(sends.length,2);
  console.log('Sales introduction email browser checks passed.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
