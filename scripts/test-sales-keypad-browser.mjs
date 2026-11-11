import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_MODULE || "esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const dir = await mkdtemp(join(tmpdir(), "everycall-keypad-browser-"));
await build({
  stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Keypad from './app/admin/sales/InCallKeypad.jsx';
    window.keys=[];window.pending=[];window.hold=false;window.fail=false;
    function App(){const [enabled,setEnabled]=useState(true),[callId,setCallId]=useState('first');window.setEnabled=setEnabled;window.setCallId=setCallId;
      return <main><textarea aria-label="Call notes"/><Keypad key={callId} enabled={enabled} onSendDigit={async digit=>{window.keys.push({callId,digit});if(window.hold)await new Promise((resolve,reject)=>window.pending.push({resolve,reject}));if(window.fail)throw Error('fixture failure');}}/></main>};createRoot(document.getElementById('root')).render(<App/>);`, loader: "jsx", resolveDir: resolve(".") },
  bundle: true, outdir: dir, entryNames: "fixture", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, loader: { ".module.css": "local-css" }
});
await writeFile(join(dir, "index.html"), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
const server = createServer(async (req, res) => {
  const file = req.url === "/" ? "index.html" : req.url.slice(1);
  res.setHeader("Content-Type", file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html");
  try { res.end(await readFile(join(dir, file))); } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const toggle = page.getByRole("button", { name: "Keypad", exact: true });
  const keypad = page.getByRole("region", { name: "In-call keypad" });
  await page.keyboard.type("123");
  assert.equal(await page.evaluate(() => window.keys.length), 0);
  await toggle.click();
  assert.equal(await keypad.getByRole("button").count(), 13);
  for (const digit of "123456789*0#") {
    await keypad.getByRole("button", { name: digit === "*" ? "Star (*)" : digit === "#" ? "Pound (#)" : digit, exact: true }).click();
  }
  await page.waitForFunction(() => window.keys.length === 12);
  assert.equal(await page.evaluate(() => window.keys.map(key => key.digit).join("")), "123456789*0#");
  await page.getByRole("textbox", { name: "Call notes" }).fill("123*#");
  assert.equal(await page.evaluate(() => window.keys.length), 12, "Notes never send keys");
  await keypad.getByRole("button", { name: "1", exact: true }).focus();
  await page.keyboard.press("Control+2");
  await page.keyboard.press("Alt+3");
  assert.equal(await page.evaluate(() => window.keys.length), 12);
  await page.evaluate(() => { window.hold = true; });
  await page.keyboard.type("456");
  await page.waitForFunction(() => window.pending.length === 1);
  assert.equal(await page.evaluate(() => window.keys.length), 13, "Only one provider command can be pending");
  await page.evaluate(() => window.pending.shift().resolve());
  await page.waitForFunction(() => window.keys.length === 14);
  await page.evaluate(() => window.pending.shift().resolve());
  await page.waitForFunction(() => window.keys.length === 15);
  await page.evaluate(() => { window.hold = false; window.pending.shift().resolve(); });
  await keypad.getByRole("status").filter({ hasText: "Sent 6" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.keys.slice(-3).map(key => key.digit)), ["4", "5", "6"]);
  await page.keyboard.press("Escape");
  assert.equal(await keypad.count(), 0);
  assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
  await page.keyboard.type("789");
  assert.equal(await page.evaluate(() => window.keys.length), 15);
  await toggle.click();
  await page.evaluate(() => { window.hold = true; });
  await page.keyboard.type("123");
  await page.waitForFunction(() => window.pending.length === 1);
  await page.evaluate(() => window.pending.shift().reject(Error("provider failure")));
  await keypad.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.keys.length), 16, "A failed key cancels remaining queued keys");
  await page.evaluate(() => { window.hold = false; });
  await keypad.getByRole("button", { name: "0", exact: true }).click();
  await keypad.getByRole("status").filter({ hasText: "Sent 0" }).waitFor();
  assert.equal(await keypad.getByRole("alert").count(), 0);
  await page.evaluate(() => { window.hold = true; });
  await page.keyboard.type("789");
  await page.waitForFunction(() => window.pending.length === 1);
  await page.evaluate(() => window.setEnabled(false));
  await keypad.waitFor({ state: "detached" });
  assert.equal(await toggle.isDisabled(), true);
  await page.evaluate(() => { window.pending.shift().resolve(); window.hold = false; window.setEnabled(true); window.setCallId("second"); });
  await page.waitForTimeout(50);
  assert.equal(await keypad.count(), 0);
  assert.equal(await page.evaluate(() => window.keys.length), 18, "Disconnect cancels queued digits and clears the keypad for a new call");
  await toggle.click();
  await keypad.getByRole("button", { name: "2", exact: true }).click();
  await keypad.getByRole("status").filter({ hasText: "Sent 2" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.keys.at(-1)), { callId: "second", digit: "2" });
  for (const width of [390, 900, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await keypad.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 800, `Keypad fits ${width}px viewport`);
  }
  console.log("Sales keypad browser checks passed (12 keys, keyboard scope, serial order, error/reset/call changes, responsive bounds).");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
