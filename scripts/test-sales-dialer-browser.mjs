import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const playwrightPath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(playwrightPath);
const dir = await mkdtemp(join(tmpdir(), "everycall-dialer-browser-"));
const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import DialerScreen from './app/admin/sales/DialerScreen.jsx';
const defaults={opener:'Hi, is this {first_name}? {rep_name} with EveryCall — I’ll be quick. When someone calls {business_name} after five and nobody picks up, what happens to that call?',if_interested:'I can show you in about two minutes. I’ll put our receptionist on the line — talk to her like a customer would.',if_voicemail:'Hi {first_name}, {rep_name} with EveryCall. I’m calling about what happens to your calls after five. Call me back at this number.',talk_discovery:'When someone calls after five and nobody picks up, what happens to that call? Let them answer. Then: Who picks up when you are on a job?',objections:[{title:'We already have an answering service',response:'Then you know what a message costs you. She answers the question instead of taking a message. Two minutes — let her show you.'},{title:'I don’t want a robot talking to my customers',response:'Fair. Talk to her for a minute and tell me if your customers would mind.'}],no_time:'When’s better — tomorrow after one? Set it with Call back while they’re still on the line.',gatekeeper:'Is {first_name} around? When are they usually in? Note the name and the time.',while_you_listen:'Listen for the questions that matter to them.',exit_line:'That’s her. Want me to hop back on? — then End demo.',close:'That’s what your callers get, nights and weekends included. Two quick things to get you going: I’ll text you a link to put a card down — a hundred dollars to start, and that covers your first month — and let’s grab fifteen minutes with Jon to get your line forwarded. What’s the best cell to text?',close_decline:'Jon can take it at the start of your setup call.'};
const prospect={id:'fixture-1',businessName:'Cedar Home Services',contactName:'Mira Chen',contactRole:'Owner',eligible:true,demoStatus:'ready',website:'https://example.com',metro:'Portland metro',city:'Portland',region:'Northwest Oregon',afterHoursClass:'Unknown',postedHours:'Mon-Fri 9-5 (list research)',callOpenerHook:'Ask how evening calls reach the team.',researchNotes:'Imported research note, separate from call history.',pitchFlags:['No after-hours coverage listed'],attemptCount:1,conversationCount:0,numbers:[{phoneE164:'+15035550122',label:'Cell',type:'cell'},{phoneE164:'+15035550121',label:'Shop',type:'shop',lastNote:'Lee screens'}],coreFacts:[{category:'hours',label:'Hours',sentence:'Monday through Friday, 7 AM to 5 PM.'},{category:'service_area',label:'Service area',sentence:'Portland metro and Vancouver, Washington.'},{category:'services',label:'Services',sentence:'Repairs, water heaters, drain cleaning and repipes.'},{category:'after_hours',label:'After hours',sentence:'After-hours callers can leave a message.'}],history:[{id:'prior',startedAt:'2026-10-18T14:10:00Z',outcome:'voicemail',outcomeNotes:'Lee answers the main line and screens.'}],bestTime:'After 1 PM — owner is in the field mornings',email:'mira@example.com'};
function App(){const initial=new URLSearchParams(location.search).get('state')||'READY';const [phase,setPhase]=useState(initial),[note,setNote]=useState(''),[muted,setMuted]=useState(initial==='DEMO'),[outcome,setOutcome]=useState(''),[callbackAt,setCallbackAt]=useState(''),[dncReason,setDnc]=useState('');const call=phase==='READY'?null:{id:'fixture-call',terminal:phase==='WRAPUP',prospectConnected:phase!=='DIALING',aiReady:true,aiLive:phase==='DEMO',startedAt:'2026-10-20T12:00:00Z',connectedAt:'2026-10-20T12:00:00Z',endedAt:phase==='WRAPUP'?'2026-10-20T12:09:14Z':null,demoStartedAt:'2026-10-20T12:02:51Z',demoDurationSeconds:232,dialedNumber:'+15035550122',transcriptStatus:'processing'};let incoming=initial.startsWith('INCOMING')?[{incomingId:'fixture-inbound',phoneE164:'+15035550199',businessName:initial==='INCOMING_MATCHED'?'Pine Drain Services':'',contactName:initial==='INCOMING_MATCHED'?'Tara, owner':'',prospectId:initial==='INCOMING_MATCHED'?'fixture-other':null,canTake:initial!=='INCOMING_MIDCALL',context:'Returning your call — you left a voicemail Oct 16.'}]:[];const actualCall=initial==='INCOMING_MIDCALL'?{...call,id:'midcall',terminal:false,prospectConnected:true}:initial.startsWith('INCOMING')?null:call;return <DialerScreen queue={{readyCount:10,counters:{dials:23,conversations:5,demos:2,paid:1},operator:{name:'Jon L.'},config:{setupCallOwner:'Jon'},scripts:defaults,upcoming:[{businessName:'Next Business'}]}} prospect={prospect} call={actualCall} softphoneState='ready' microphoneState='live' muted={muted} note={note} outcome={outcome} callbackAt={callbackAt} dncReason={dncReason} now={Date.parse('2026-10-20T12:03:42Z')} onNote={setNote} onOutcome={setOutcome} onCallback={v=>{setCallbackAt(v);setOutcome('callback_requested')}} onDncReason={v=>{setDnc(v);setOutcome('do_not_call')}} onCall={()=>setPhase('TALK')} onAction={action=>{setPhase(action==='start_demo'?'DEMO':action==='end_demo'?'TALK':'WRAPUP');setMuted(action==='start_demo')}} onMute={()=>setMuted(!muted)} onSkip={()=>{window.fixtureSkipped=true}} onRemove={()=>{window.fixtureRemoved=true}} onSave={()=>{window.fixtureSaved={outcome,note,callbackAt,dncReason};setPhase('READY')}} onCheckout={()=>setOutcome('signup_link_sent')} onBook={details=>{window.fixtureBooking=details}} availability={{slots:[{start:'2026-10-21T17:00:00Z',end:'2026-10-21T17:15:00Z',label:'Tomorrow 10:00'},{start:'2026-10-21T20:30:00Z',end:'2026-10-21T20:45:00Z',label:'Tomorrow 1:30'}]}} onMoreSlots={()=>{window.fixtureMore=true}} incoming={incoming} onIncoming={(item,action)=>{window.fixtureIncoming=action}} onSearch={()=>{}} searchResults={[]} onSignOut={()=>{}}/>};createRoot(document.getElementById('root')).render(<App/>);`;
await build({
  stdin: { contents: fixture, loader: "jsx", resolveDir: resolve(".") },
  bundle: true,
  write: true,
  outdir: dir,
  entryNames: "fixture",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".module.css": "local-css" },
});
const appCss = await readFile("public/assets/app.css", "utf8");
await writeFile(
  join(dir, "index.html"),
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>' +
    appCss +
    ' body{margin:0}button,input,textarea{font-family:inherit}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
);
const server = createServer(async (req, res) => {
  const name = req.url.split("?")[0];
  try {
    res.setHeader(
      "Content-Type",
      name.endsWith(".js")
        ? "application/javascript"
        : name.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(
      await readFile(join(dir, name === "/" ? "index.html" : name.slice(1))),
    );
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  for (const width of [1280, 1440, 900, 390])
    for (const state of [
      "READY",
      "DIALING",
      "TALK",
      "DEMO",
      "WRAPUP",
      "INCOMING_MATCHED",
      "INCOMING_UNKNOWN",
      "INCOMING_MIDCALL",
    ]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        "http://127.0.0.1:" + server.address().port + "/?state=" + state,
      );
      await page.waitForSelector("[data-phase]");
      assert.equal(await page.getByText('Ask how evening calls reach the team.', { exact: true }).isVisible(), true);
      const research = page.locator('details').filter({ has: page.locator('summary', { hasText: 'List research' }) });
      await research.locator('summary').click();
      assert.equal(await research.getByText('Mon-Fri 9-5 (list research)', { exact: true }).isVisible(), true);
      assert.equal(await research.getByText('Imported research note, separate from call history.', { exact: true }).isVisible(), true);
      const expandedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(expandedWidth <= width);
      await research.locator('summary').click();
      const metrics = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
        footer: document.querySelector("footer").getBoundingClientRect().bottom,
        aside: document.querySelector("aside").getBoundingClientRect(),
        main: document.querySelector("main").getBoundingClientRect(),
      }));
      assert.ok(
        metrics.width <= width,
        JSON.stringify({ width, state, metrics }),
      );
      if (width >= 1280)
        assert.ok(
          metrics.height <= 800,
          JSON.stringify({ width, state, metrics }),
        );
      assert.ok(
        metrics.footer <= 801,
        JSON.stringify({ width, state, metrics }),
      );
      if (width <= 900)
        assert.ok(
          metrics.main.top >= metrics.aside.bottom - 1,
          JSON.stringify({ width, state, metrics }),
        );
      assert.equal(
        await page.getByText("Paid — set by Stripe", { exact: true }).count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Paid — set by Stripe" })
          .count(),
        0,
      );
      if (state === "READY")
        assert.equal(
          await page
            .getByRole("button", { name: "No answer", exact: true })
            .isDisabled(),
          true,
        );
      if (state === "INCOMING_MIDCALL")
        assert.equal(
          await page
            .getByRole("button", { name: "Take call", exact: true })
            .count(),
          0,
        );
      if (width === 1280)
        await page.screenshot({
          path: join(dir, state.toLowerCase() + ".png"),
        });
    }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("http://127.0.0.1:" + server.address().port + "/?state=TALK");
  await page
    .getByLabel("Notes — carry into the wrap-up", { exact: true })
    .fill("Owner wants after-hours coverage.");
  await page
    .getByRole("button", {
      name: "Start demo — hand to the AI Receptionist",
      exact: true,
    })
    .click();
  await page.getByText(/your mic is muted/).waitFor();
  assert.equal(
    await page
      .getByLabel("Notes — carry into the wrap-up", { exact: true })
      .inputValue(),
    "Owner wants after-hours coverage.",
  );
  await page.getByRole("button", { name: "Unmute me", exact: true }).click();
  await page.getByRole("button", { name: "Mute me", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "End demo — put me back on", exact: true })
    .click();
  await page.getByRole("button", { name: "Mute", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Save & next →", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "End call", exact: true }).click();
  assert.equal(
    await page.getByLabel("Note for next time").inputValue(),
    "Owner wants after-hours coverage.",
  );
  await page.getByRole("button", { name: "Call back ▾", exact: true }).click();
  await page.getByLabel("Callback date and time").fill("2026-10-23T14:30");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Save & next →", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.fixtureSaved)).note,
    "Owner wants after-hours coverage.",
  );
  assert.equal(
    (await page.evaluate(() => window.fixtureSaved)).outcome,
    "callback_requested",
  );
  await page.goto(
    "http://127.0.0.1:" + server.address().port + "/?state=WRAPUP",
  );
  await page.getByRole("button", { name: "Send link", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Link sent", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("button", { name: "Tomorrow 10:00", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Book Tomorrow 10:00", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.fixtureBooking)).email,
    "mira@example.com",
  );
  await page
    .getByRole("button", { name: "Do not call ▾", exact: true })
    .click();
  await page.getByRole("button", { name: "Bad number", exact: true }).click();
  await page
    .getByRole("button", { name: "Save & next →", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.fixtureSaved)).dncReason,
    "bad_number",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      states: 8,
      viewports: 4,
      screenshots: dir,
      checks: [
        "viewport scroll",
        "responsive stacking",
        "fixed footer",
        "paid display only",
        "incoming mid-call gate",
        "demo mute toggles",
        "persistent notes",
        "callback picker",
        "DNC reason",
        "checkout outcome",
        "booking action",
      ],
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
