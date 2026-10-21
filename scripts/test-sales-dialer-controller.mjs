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
let requests = [],
  calls = {},
  currentId = "",
  showIncoming = false,
  incomingUnknown = false,
  includeSecondIncoming = false,
  showSecondIncoming = false,
  showReturnItem = false,
  returnNeedsWebsite = true,
  deferredDemo = null;
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
  requests.push({ path: path.pathname, method: req.method, data });
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
  if (path.pathname.endsWith("/prospects"))
    return send({ prospects: [matched] });
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
        prospect: incomingUnknown ? null : matched,
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
    calls[currentId] = activeCall(currentId, prospect.id);
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
  await acceptedRow
    .getByLabel("Website", { exact: true })
    .fill("https://caller-one.example.com");
  await acceptedRow
    .getByRole("button", { name: "Add as new prospect" })
    .click();
  await page
    .getByRole("heading", { name: "Matched Business", exact: true })
    .waitFor();
  const createRequest = requests.find((r) => r.data.action === "create");
  assert.equal(createRequest.data.incomingId, "ring-1");
  assert.equal(createRequest.data.websiteUrl, "https://caller-one.example.com");
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
  await page
    .getByLabel("Website for return call +15035550177", { exact: true })
    .fill("https://returned.example");
  await page
    .getByRole("button", { name: "Add website & prepare", exact: true })
    .click();
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
