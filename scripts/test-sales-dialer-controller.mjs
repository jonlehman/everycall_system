import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const dir = await mkdtemp(join(tmpdir(), "everycall-real-dialer-controller-"));
const fixture =
  "import React from 'react';import{createRoot}from'react-dom/client';import CallerWorkspace from './app/admin/sales/CallerWorkspace.jsx';createRoot(document.getElementById('root')).render(<CallerWorkspace/>);";
// Replace only the provider boundary at bundle time. The production controller,
// queue hook, fetchSalesJson, normalizers, and screen all execute unmodified.
const telnyxMock = `export async function connectTelnyxBrowserClient({onState,remoteElement}){window.providerAudio=remoteElement;onState('ready');window.providerEvents=[];return {isReady:()=>true,placeCall:()=>{window.providerEvents.push('place')},hangup:async()=>{window.providerEvents.push('hangup')},disconnect:async()=>{},setMuted:value=>{window.providerEvents.push(value?'mute':'unmute');return value},hasIncomingCall:()=>false};}`;
await build({
  stdin: { contents: fixture, loader: "jsx", resolveDir: resolve(".") },
  bundle: true,
  outdir: dir,
  entryNames: "fixture",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".module.css": "local-css" },
  plugins: [
    {
      name: "telnyx-test-boundary",
      setup(api) {
        api.onLoad({ filter: /telnyxBrowserClient\.js$/ }, () => ({
          contents: telnyxMock,
          loader: "js",
        }));
      },
    },
  ],
});
await writeFile(
  join(dir, "index.html"),
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
);
const prospect = {
  id: "old-prospect",
  businessName: "Original Business",
  contactName: "Original Owner",
  demoStatus: "ready",
  eligible: true,
  phone: "+15035550101",
  numbers: [{ phoneE164: "+15035550101", label: "Cell", type: "cell" }],
  coreFacts: [
    {
      label: "Hours",
      category: "hours",
      sentence: "Only original business fact.",
    },
  ],
};
const matched = {
  ...prospect,
  id: "matched-prospect",
  businessName: "Matched Business",
  contactName: "Incoming Owner",
  coreFacts: [
    {
      label: "Hours",
      category: "hours",
      sentence: "Only matched business fact.",
    },
  ],
};
const notPrepped = { ...prospect, id: "not-prepped", businessName: "Awaiting Prep", demoStatus: "not_prepared", eligible: false, preparationEligible: true, website: "https://example.com" };
const paidContact = { ...prospect, id: "paid-contact", businessName: "Paid Business", status: "paid" };
const dncContact = { ...prospect, id: "dnc-contact", businessName: "Do Not Call Business", doNotCall: true };
const removedContact = { ...prospect, id: "removed-contact", businessName: "Removed Business", status: "removed" };
let requests = [],
  calls = {},
  currentId = "",
  showIncoming = false,
  incomingUnknown = false,
  includeSecondIncoming = false,
  showSecondIncoming = false,
  showReturnItem = false,
  returnNeedsWebsite = true,
  deferredDemo = null, rejectAdd = false, rejectCallback = false, rejectRestore = false;
const activeCall = (id, prospectId) => ({
  id,
  prospectId,
  state: "ai_standby_ready",
  prospectConnected: true,
  aiReady: true,
  aiState: "ready",
  startedAt: new Date().toISOString(),
  connectedAt: new Date().toISOString(),
  webrtc: { callOptions: { destinationNumber: "+15035550999" } },
});
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture");
  if (!path.pathname.startsWith("/api/")) {
    try {
      res.setHeader(
        "Content-Type",
        path.pathname.endsWith(".js")
          ? "application/javascript"
          : path.pathname.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(
        await readFile(
          join(
            dir,
            path.pathname === "/" ? "index.html" : path.pathname.slice(1),
          ),
        ),
      );
    } catch {
      res.statusCode = 404;
      res.end();
    }
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : {};
  requests.push({ path: path.pathname, method: req.method, data, query: Object.fromEntries(path.searchParams) });
  res.setHeader("Content-Type", "application/json");
  const send = (value) => res.end(JSON.stringify(value));
  if (path.pathname.endsWith("/webrtc-token"))
    return send({ token: "fixture-token" });
  if (path.pathname.endsWith("/queue"))
    return send({
      queue: [prospect],
      readyCount: 1,
      returnItems: showReturnItem
        ? [
            {
              incomingId: "return-1",
              phoneE164: "+15035550177",
              businessName: "Unknown return",
              message: "Please call Sam about coverage.",
              needsWebsite: returnNeedsWebsite,
              rowVersion: 4,
              permissionGranted: !returnNeedsWebsite,
              timezone: returnNeedsWebsite ? null : "America/Los_Angeles",
              demoStatus: returnNeedsWebsite ? "not_prepared" : "preparing",
              state: "return_pending",
              canTake: false,
            },
          ]
        : [],
      scripts: { opener: "Hello {first_name}" },
      operator: { name: "Rep" },
      incoming: [
        ...(showIncoming
          ? [
              {
                incomingId: "ring-1",
                phoneE164: "+15035550199",
                prospectId: incomingUnknown ? null : matched.id,
                businessName: incomingUnknown ? "" : matched.businessName,
                canTake: true,
              },
            ]
          : []),
        ...(showSecondIncoming
          ? [
              {
                incomingId: "ring-2",
                phoneE164: "+15035550188",
                prospectId: null,
                businessName: "",
                canTake: false,
              },
            ]
          : []),
      ],
    });
  if (path.pathname.endsWith("/availability")) return send({ slots: [] });
  if (path.pathname.endsWith("/prospects")) {
    if (req.method === "POST") {
      if (rejectAdd) { res.statusCode = 409; return send({ error: "This phone is already in your list." }); }
      return send({ prospect: { ...notPrepped, id: "added", businessName: data.business_name }, preparation: { status: "queued" } });
    }
    let rows = [matched, notPrepped, paidContact, dncContact, removedContact];
    if (path.searchParams.get("contactStatus") === "not_prepped") rows = [notPrepped];
    if (path.searchParams.get("search") === "0142") rows = [matched];
    if (path.searchParams.get("cursor")) rows = [{ ...matched, id: "older", businessName: "Older Business" }];
    return send({ prospects: rows, total: path.searchParams.get("contactStatus") === "not_prepped" || path.searchParams.get("search") ? rows.length : 42, counts: { all: 42, in_queue: 31, not_prepped: 7, removed: 1 }, metros: ["Portland", "Seattle"], nextCursor: path.searchParams.get("cursor") || path.searchParams.get("contactStatus") === "not_prepped" || path.searchParams.get("search") ? null : "activity-next-page" });
  }
  if (path.pathname.endsWith("/callback")) {
    if (rejectCallback) { prospect.rowVersion = 2; res.statusCode = 409; return send({ error: "Contact changed. Review and try again." }); }
    const item = [matched, paidContact].find((contact) => path.pathname.includes(contact.id)) || prospect;
    item.callbackAt = data.callbackAt; item.rowVersion = (item.rowVersion || 1) + 1;
    return send({ prospect: item });
  }
  if (path.pathname.endsWith("/restore")) {
    if (rejectRestore) { res.statusCode = 409; return send({ error: "Contact changed. Review and try again." }); }
    return send({ prospect: { ...removedContact, status: "queued", demoStatus: "not_prepared", eligible: false, preparationEligible: true, website: "https://example.com", rowVersion: 2 } });
  }
  if (path.pathname.endsWith(`/prospects/${prospect.id}`)) return send({ prospect });
  const selectedContact = [matched, notPrepped, paidContact, dncContact, removedContact].find((item) => path.pathname.endsWith(`/prospects/${item.id}`));
  if (selectedContact) return send({ prospect: { ...selectedContact, calls: [] } });
  if (path.pathname.endsWith("/prospects/not-prepped/demo")) return send({ ok: true });
  if (path.pathname.endsWith("/incoming")) {
    if (data.action === "create" && data.incomingId === "return-1") {
      returnNeedsWebsite = false;
      return send({ prospect: matched, preparing: true });
    }
    if (data.action === "take") {
      showIncoming = false;
      showSecondIncoming = includeSecondIncoming;
      currentId = "incoming-call";
      calls[currentId] = activeCall(
        currentId,
        incomingUnknown ? null : matched.id,
      );
      return send({
        call: calls[currentId],
        prospect: incomingUnknown ? (includeSecondIncoming ? { id: "unknown-stub", businessName: "Unknown caller", phone: "+15035550199", rowVersion: 7, permission: false, timezone: null, eligible: false } : null) : matched,
      });
    }
    if (["match", "create"].includes(data.action)) {
      calls["incoming-call"].prospectId = matched.id;
      return send({ call: calls["incoming-call"], prospect: matched });
    }
    return send({ ok: true });
  }
  if (path.pathname.endsWith("/calls") && req.method === "POST") {
    currentId = "outgoing-call";
    calls[currentId] = activeCall(currentId, data.prospectId || prospect.id);
    return send({ call: calls[currentId] });
  }
  const match = path.pathname.match(
    /\/calls\/([^/]+)(?:\/(actions|outcome))?$/,
  );
  if (match) {
    const [, id, action] = match;
    if (action === "actions") {
      if (data.action === "start_demo") {
        deferredDemo = () =>
          send({
            call: {
              ...calls[id],
              state: "ai_live",
              aiState: "live",
              aiLive: true,
            },
          });
        return;
      }
      if (data.action === "end_call") {
        calls[id] = {
          ...calls[id],
          state: "ended",
          terminal: true,
          aiState: "ended",
          endedAt: new Date().toISOString(),
        };
        return send({ call: calls[id] });
      }
    }
    if (action === "outcome")
      return send({ call: { ...calls[id], outcome: data.outcome } });
    if (req.method === "PATCH") {
      calls[id] = { ...calls[id], liveNotes: data.liveNotes };
      return send({ call: calls[id] });
    }
    return send({ call: calls[id] });
  }
  res.statusCode = 404;
  send({ error: "Unexpected fixture request" });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
let context, page;
const reset = async ({
  unknown = false,
  denyMic = false,
  second = false,
} = {}) => {
  await context?.close();
  requests = [];
  calls = {};
  currentId = "";
  showIncoming = false;
  incomingUnknown = unknown;
  includeSecondIncoming = second;
  showSecondIncoming = false;
  deferredDemo = null;
  rejectAdd = false; rejectCallback = false; rejectRestore = false;
  prospect.callbackAt = null; prospect.rowVersion = 1; matched.callbackAt = null; matched.rowVersion = 1;
  showReturnItem = false;
  returnNeedsWebsite = true;
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(
    ({ denyMic }) => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => {
            if (denyMic)
              throw new DOMException("Permission denied", "NotAllowedError");
            const track = new EventTarget();
            track.readyState = "live";
            track.stop = () => {
              track.readyState = "ended";
              track.dispatchEvent(new Event("ended"));
            };
            window.fixtureMicTrack = track;
            return {
              active: true,
              getTracks: () => [track],
              getAudioTracks: () => [track],
            };
          },
        },
      });
    },
    { denyMic },
  );
  page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page
    .getByRole("heading", { name: "Original Business", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /^Call cell/ }).waitFor();
};
const dial = async () => {
  await page.getByRole("button", { name: /^Call cell/ }).click();
  await page.locator('[data-phase="TALK"]').waitFor();
};
const end = async () => {
  await page.getByRole("button", { name: "End call", exact: true }).click();
  await page.locator('[data-phase="WRAPUP"]').waitFor();
};
const waitUntil = async (condition) => {
  const limit = Date.now() + 8000;
  while (!condition()) {
    if (Date.now() > limit)
      throw new Error("Timed out waiting for request evidence");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const incoming = async () => {
  showIncoming = true;
  await page
    .getByRole("button", { name: "Take call", exact: true })
    .waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "Take call", exact: true }).click();
  await page.locator('[data-phase="TALK"]').waitFor();
};
try {
  console.log("controller: contacts browsing preserves the dial queue and readiness gates");
  await reset();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Matched Business", exact: true }).click();
  await page.getByRole("heading", { name: "Matched Business", exact: true }).waitFor();
  await page.waitForTimeout(5200);
  assert.equal(await page.getByRole("heading", { name: "Matched Business", exact: true }).count(), 1, "Queue polling must preserve browsed contact");
  await page.getByRole("button", { name: "Back to queue", exact: true }).click();
  await page.getByRole("heading", { name: "Original Business", exact: true }).waitFor();
  assert.equal(requests.filter((request) => /\/(skip|remove)$/.test(request.path)).length, 0, "Browsing leaves queue order untouched");
  for (const name of ["Do Not Call Business", "Removed Business"]) {
    await page.getByRole("button", { name: "Contacts", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /^Call cell/ }).isDisabled(), true);
    await page.getByRole("button", { name: "Dial", exact: true }).click();
    await page.getByRole("heading", { name: "Original Business", exact: true }).waitFor();
  }
  console.log("controller: paid contact calling and callbacks retain suppression gates");
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Paid Business", exact: true }).click();
  await page.getByRole("heading", { name: "Paid Business", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Call cell/ }).isDisabled(), false);
  assert.equal(await page.getByRole("button", { name: "Remove from list", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "1 week", exact: true }).click();
  await page.getByRole("button", { name: "Set call back", exact: true }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).waitFor();
  assert.ok(requests.some(request => request.path.endsWith(`/prospects/${paidContact.id}/callback`) && request.data.callbackAt));
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByText("Not set", { exact: true }).waitFor();
  assert.equal(paidContact.status, "paid");
  for (const flag of ["doNotCall", "suppressed"]) {
    paidContact[flag] = true; paidContact.eligible = false;
    await page.getByRole("button", { name: "Contacts", exact: true }).click();
    await page.getByRole("button", { name: "Paid Business", exact: true }).click();
    await page.getByRole("heading", { name: "Paid Business", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /^Call cell/ }).isDisabled(), true);
    await page.getByRole("button", { name: "1 week", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Set call back", exact: true }).isDisabled(), true);
    paidContact[flag] = false; paidContact.eligible = true;
  }
  await page.getByRole("button", { name: "Dial", exact: true }).click();
  await page.getByRole("heading", { name: "Original Business", exact: true }).waitFor();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Awaiting Prep", exact: true }).click();
  await page.getByRole("heading", { name: "Awaiting Prep", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Call cell/ }).count(), 0);
  await page.getByRole("button", { name: "Prep now", exact: true }).click();
  await page.getByRole("button", { name: "Preparing…", exact: true }).waitFor();
  assert.ok(requests.some((request) => request.path.endsWith("/prospects/not-prepped/demo") && request.method === "POST"));
  await page.getByRole("button", { name: "Dial", exact: true }).click();
  await page.getByRole("heading", { name: "Original Business", exact: true }).waitFor();
  console.log("controller: contacts global filters, cursor pagination, all-phone search and Add");
  await reset();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "All 42", exact: true }).waitFor();
  assert.equal(await page.getByText("1–5 of 42", { exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("Metro", { exact: true }).locator("option").allTextContents().then((items) => items.includes("Seattle")), true);
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  await page.getByRole("button", { name: "Older Business", exact: true }).waitFor();
  assert.ok(requests.some((request) => request.query.cursor === "activity-next-page"));
  assert.equal(await page.getByText("26–26 of 42", { exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByRole("button", { name: "Matched Business", exact: true }).waitFor();
  await page.getByRole("button", { name: "Not prepped 7", exact: true }).click();
  await page.getByText("1–1 of 1", { exact: true }).waitFor();
  assert.ok(requests.some((request) => request.query.contactStatus === "not_prepped"));
  assert.equal(await page.getByRole("button", { name: "Matched Business", exact: true }).count(), 0);
  await page.getByRole("button", { name: "All 42", exact: true }).click();
  await page.getByLabel("Metro", { exact: true }).selectOption("Seattle");
  await waitUntil(() => requests.some((request) => request.query.metro === "Seattle"));
  await page.getByLabel("Search contacts", { exact: true }).fill("0142");
  await page.getByText("1–1 of 1", { exact: true }).waitFor();
  assert.ok(requests.some((request) => request.query.contactsView === "true" && request.query.search === "0142" && request.query.metro === "Seattle" && !request.query.cursor));
  await page.getByRole("button", { name: "Add prospect", exact: true }).first().click();
  const addForm = page.getByRole("form", { name: "Add prospect", exact: true });
  await addForm.getByLabel("Business", { exact: true }).fill("Shop-only business");
  await addForm.getByLabel("Contact", { exact: true }).fill("Shop Owner");
  await addForm.getByLabel("Phone", { exact: true }).fill("+15035550142");
  await addForm.getByLabel("Phone type", { exact: true }).selectOption("shop");
  await addForm.getByLabel("Website", { exact: true }).fill("https://shop.example.com");
  await addForm.getByLabel("Calling permission", { exact: true }).selectOption("no");
  await addForm.getByLabel("Prospect timezone", { exact: true }).fill("America/Los_Angeles");
  rejectAdd = true;
  await addForm.getByRole("button", { name: "Save prospect", exact: true }).click();
  await addForm.getByRole("alert").waitFor();
  assert.equal(await addForm.getByLabel("Business", { exact: true }).inputValue(), "Shop-only business");
  rejectAdd = false;
  await addForm.getByRole("button", { name: "Save prospect", exact: true }).click();
  await addForm.waitFor({ state: "detached" });
  const added = requests.find((request) => request.path.endsWith("/prospects") && request.method === "POST");
  assert.equal(added.data.contactsView, true);
  assert.equal(added.data.permission, false);
  assert.equal(added.data.numbers[0].type, "shop");
  assert.equal(added.data.timezone, "America/Los_Angeles");
  console.log("controller: READY callback save, Clear and stale conflict refresh");
  await reset();
  await page.getByRole("button", { name: "1 week", exact: true }).click();
  rejectCallback = true;
  await page.getByRole("button", { name: "Set call back", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Contact changed" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Clear", exact: true }).count(), 0);
  rejectCallback = false;
  await page.getByRole("button", { name: "Set call back", exact: true }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).waitFor();
  const callbackSaves = requests.filter((request) => request.path.endsWith("/callback"));
  assert.equal(callbackSaves.at(-1).data.expectedRowVersion, 2);
  assert.ok(callbackSaves.at(-1).data.callbackAt);
  assert.equal(requests.filter((request) => request.path.endsWith("/outcome")).length, 0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByText("Not set", { exact: true }).waitFor();
  assert.equal(requests.filter((request) => request.path.endsWith("/callback")).at(-1).data.callbackAt, null);
  console.log("controller: restoration failure preserves Removed and success respects prep readiness");
  await reset();
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Removed Business", exact: true }).click();
  rejectRestore = true;
  await page.getByRole("button", { name: "Put back in list", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Contact changed" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Call cell/ }).isDisabled(), true);
  rejectRestore = false;
  await page.getByRole("button", { name: "Put back in list", exact: true }).click();
  await page.getByRole("button", { name: "Prep now", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Call cell/ }).count(), 0);
  assert.equal(requests.filter((request) => request.path.endsWith("/restore")).at(-1).data.expectedRowVersion, 1);
  console.log("controller: unprepared callback contact still exposes prep");
  await reset();
  notPrepped.callbackAt = new Date(Date.now() + 86400000).toISOString();
  notPrepped.contactStatus = "callback";
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "Awaiting Prep", exact: true }).click();
  await page.getByRole("button", { name: "Prep now", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Call cell/ }).count(), 0);
  await page.getByRole("button", { name: "Prep now", exact: true }).click();
  await page.getByRole("button", { name: "Preparing…", exact: true }).waitFor();
  notPrepped.callbackAt = null; notPrepped.contactStatus = "";
  console.log("controller: active-call callback remains draft until outcome");
  await reset();
  await dial();
  await page.getByRole("button", { name: "Call back ▾", exact: true }).click();
  await page.getByRole("button", { name: "1 week", exact: true }).click();
  await page.getByRole("button", { name: "Set call back", exact: true }).click();
  assert.equal(requests.filter((request) => request.path.endsWith("/callback")).length, 0);
  await end();
  await page.getByRole("button", { name: "Save & next →", exact: true }).click();
  await waitUntil(() => requests.some((request) => request.path.endsWith("/outcome")));
  const callbackOutcome = requests.find((request) => request.path.endsWith("/outcome"));
  assert.equal(callbackOutcome.data.outcome, "callback_requested");
  assert.ok(callbackOutcome.data.callbackAt);
  console.log("controller: end during settle");
  // Start-demo settle delay: End call must not be silently dropped by run().
  await reset();
  await dial();
  await page
    .getByRole("button", {
      name: "Start demo — hand to the AI Receptionist",
      exact: true,
    })
    .click();
  await end();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(
    requests.filter((r) => r.data.action === "start_demo").length,
    0,
  );
  assert.ok(requests.some((r) => r.data.action === "end_call"));
  assert.ok(
    (await page.evaluate(() => window.providerEvents)).includes("hangup"),
  );
  console.log("controller: end during in-flight demo");
  // Already in-flight demo response: hangup has priority and stale live state is ignored.
  await reset();
  await dial();
  await page
    .getByRole("button", {
      name: "Start demo — hand to the AI Receptionist",
      exact: true,
    })
    .click();
  await waitUntil(() => Boolean(deferredDemo));
  await end();
  deferredDemo();
  await waitUntil(
    () => requests.filter((r) => r.data.action === "end_call").length === 2,
  );
  assert.equal(
    await page.locator("[data-phase]").getAttribute("data-phase"),
    "WRAPUP",
  );
  console.log("controller: preserve wrap-up");
  // Preserve the full previous wrap-up draft around an incoming call; DNC is
  // saved for the original call when that draft is restored.
  await reset();
  await dial();
  await page
    .getByLabel("Notes — carry into the wrap-up", { exact: true })
    .fill("Do not lose original notes.");
  await end();
  await page
    .getByRole("button", { name: "Do not call ▾", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Asked not to be called", exact: true })
    .click();
  await incoming();
  await page
    .getByRole("heading", { name: "Matched Business", exact: true })
    .waitFor();
  await page.getByText(/previous wrap-up draft is preserved/).waitFor();
  await end();
  await page
    .getByRole("button", { name: "Not interested", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save & next →", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Original Business", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Note for next time").inputValue(),
    "Do not lose original notes.",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Do not call ▾", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("button", { name: "Save & next →", exact: true })
    .click();
  await waitUntil(() =>
    requests.some((r) => r.path.endsWith("/outgoing-call/outcome")),
  );
  const oldSave = requests.find((r) =>
    r.path.endsWith("/outgoing-call/outcome"),
  );
  assert.equal(oldSave.data.dncReason, "asked_not_to_be_called");
  assert.equal(oldSave.data.notes, "Do not lose original notes.");
  assert.equal(oldSave.data.outcome, "do_not_call");
  console.log("controller: concurrent unknown incoming identity binding");
  await reset({ unknown: true, second: true });
  await incoming();
  const secondRow = page.locator('[data-incoming-id="ring-2"]');
  await secondRow.waitFor();
  assert.equal(
    await secondRow
      .getByRole("button", { name: "Add as new prospect" })
      .count(),
    0,
  );
  assert.equal(
    await secondRow.getByLabel("Website", { exact: true }).count(),
    0,
  );
  const acceptedRow = page.locator('[data-incoming-id="ring-1"]');
  await acceptedRow.getByRole("button", { name: "Add as new prospect" }).click();
  const incomingForm = acceptedRow.getByRole("form", { name: "Add prospect", exact: true });
  assert.equal(await incomingForm.getByLabel("Phone", { exact: true }).inputValue(), "+15035550199");
  assert.equal(await incomingForm.getByLabel("Phone type", { exact: true }).inputValue(), "other");
  await incomingForm.getByLabel("Business", { exact: true }).fill("Caller business");
  await incomingForm.getByLabel("Contact", { exact: true }).fill("Caller One");
  await incomingForm.getByLabel("Calling permission", { exact: true }).selectOption("no");
  await incomingForm.getByLabel("Prospect timezone", { exact: true }).fill("America/Los_Angeles");
  await incomingForm.getByLabel("Website", { exact: true }).fill("https://caller-one.example.com");
  await incomingForm.getByRole("button", { name: "Save prospect", exact: true }).click();
  await page
    .getByRole("heading", { name: "Matched Business", exact: true })
    .waitFor();
  const createRequest = requests.find((r) => r.data.action === "create");
  assert.equal(createRequest.data.incomingId, "ring-1");
  assert.equal(createRequest.data.websiteUrl, "https://caller-one.example.com");
  assert.equal(createRequest.data.business_name, "Caller business");
  assert.equal(createRequest.data.permission, false);
  assert.equal(createRequest.data.timezone, "America/Los_Angeles");
  assert.equal(createRequest.data.numbers[0].type, "other");
  assert.equal(createRequest.data.expectedRowVersion, 7, "Taken caller creation uses the current stub version");
  console.log("controller: unknown incoming identity");
  // Explicit null prospect must clear prior identity/facts; match stays bound to
  // the accepted incoming id and preserves notes typed before the match.
  await reset({ unknown: true });
  await incoming();
  await page
    .getByRole("heading", { name: "Unknown caller", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByText("Only original business fact.", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Original Business", exact: true })
      .count(),
    0,
  );
  await page
    .getByLabel("Notes — carry into the wrap-up", { exact: true })
    .fill("Unknown caller context.");
  await page.getByLabel("Search prospects").fill("Matched");
  await page
    .getByRole("button", { name: "Matched Business", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Matched Business", exact: true })
    .waitFor();
  assert.equal(
    requests.find((r) => r.data.action === "match").data.incomingId,
    "ring-1",
  );
  assert.equal(
    await page
      .getByLabel("Notes — carry into the wrap-up", { exact: true })
      .inputValue(),
    "Unknown caller context.",
  );
  console.log("controller: provider errors");
  assert.equal(
    await page.evaluate(
      () =>
        window.providerAudio ===
        document.getElementById("sales-console-remote-audio"),
    ),
    true,
  );
  // Provider errors arriving via call polling must be visible without any click.
  await reset();
  await dial();
  calls["outgoing-call"].providerError =
    "Provider conference failed asynchronously.";
  await page
    .getByRole("alert")
    .filter({ hasText: "Provider conference failed asynchronously." })
    .waitFor({ timeout: 5000 });
  console.log("controller: microphone states");
  // Signaling readiness never means microphone capture is live; denied and
  // externally-ended tracks are reflected in the single status pill.
  await reset({ denyMic: true });
  await page
    .getByRole("status")
    .filter({ hasText: "microphone not requested" })
    .waitFor();
  assert.equal(
    await page.getByRole("status").filter({ hasText: "mic live" }).count(),
    0,
  );
  await page.getByRole("button", { name: /^Call cell/ }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "microphone permission denied" })
    .waitFor();
  assert.equal(
    requests.filter((r) => r.path.endsWith("/calls") && r.method === "POST")
      .length,
    0,
  );
  await reset();
  await dial();
  await page.getByRole("status").filter({ hasText: "mic live" }).waitFor();
  await page.evaluate(() => window.fixtureMicTrack.stop());
  await page
    .getByRole("status")
    .filter({ hasText: "microphone ended" })
    .waitFor();
  await end();
  assert.equal(
    await page.getByRole("status").filter({ hasText: "mic live" }).count(),
    0,
  );
  console.log(
    "controller: returned caller preparation remains separate from ready queue",
  );
  await reset();
  showReturnItem = true;
  await page
    .getByText("Please call Sam about coverage.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Take call", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Add website & prepare", exact: true }).click();
  const returnForm = page.getByRole("form", { name: "Add prospect", exact: true });
  assert.equal(await returnForm.getByLabel("Phone", { exact: true }).inputValue(), "+15035550177");
  assert.equal(await returnForm.getByLabel("Business", { exact: true }).inputValue(), "Unknown return");
  assert.equal(await returnForm.getByLabel("Calling permission", { exact: true }).inputValue(), "no");
  await returnForm.getByLabel("Website", { exact: true }).fill("https://returned.example");
  await returnForm.getByLabel("Calling permission", { exact: true }).selectOption("yes");
  await returnForm.getByLabel("Prospect timezone", { exact: true }).fill("America/Los_Angeles");
  await returnForm.getByRole("button", { name: "Save prospect", exact: true }).click();
  await page
    .getByText(
      "The demo is preparing. This return call moves to the top when ready.",
      { exact: true },
    )
    .waitFor();
  const returnRequest = requests.find(
    (request) => request.data.incomingId === "return-1",
  );
  assert.equal(returnRequest.data.action, "create");
  assert.equal(returnRequest.data.websiteUrl, "https://returned.example");
  assert.equal(returnRequest.data.businessName, "Unknown return");
  assert.equal(returnRequest.data.permission, true);
  assert.equal(returnRequest.data.timezone, "America/Los_Angeles");
  assert.equal(returnRequest.data.numbers[0].type, "other");
  assert.equal(returnRequest.data.expectedRowVersion, 4);
  assert.equal(
    await page
      .getByRole("heading", { name: "Original Business", exact: true })
      .count(),
    1,
  );
  console.log(
    JSON.stringify({
      passed: true,
      controller: "real CallerWorkspace",
      checks: [
        "End call during demo settle",
        "End call during in-flight demo",
        "stale demo cannot resurrect call",
        "wrap-up DNC and notes restored and saved",
        "unknown caller clears prior identity/facts",
        "incoming match retains incoming id and notes",
        "second unknown ring cannot modify the accepted incoming call",
        "returned caller message and website preparation stay separate from ready queue",
        "asynchronous provider failure visible",
        "mic not requested/denied/live/ended truthfully reported",
        "Contacts browsing and queue polling preserve queue position",
        "paid calls and callbacks; do-not-call, suppressed, removed and not-prepped contact dial gates",
        "Prep now uses existing demo endpoint",
      ],
      fixture: dir,
    }),
  );
} finally {
  deferredDemo?.();
  await context?.close();
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
