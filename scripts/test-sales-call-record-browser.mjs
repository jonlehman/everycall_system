import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url),
  { build } = require("esbuild"),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const dir = await mkdtemp(join(tmpdir(), "everycall-call-record-"));
await build({
  stdin: {
    contents:
      "import React from 'react';import{createRoot}from'react-dom/client';import CallRecord from './app/sales/calls/[salesCallId]/CallRecord.jsx';createRoot(document.getElementById('root')).render(<CallRecord salesCallId={new URLSearchParams(location.search).get('id')||'owned-call'}/>);",
    loader: "jsx",
    resolveDir: resolve("."),
  },
  bundle: true,
  outdir: dir,
  entryNames: "fixture",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "no-webrtc-on-record-page",
      setup(api) {
        api.onLoad({ filter: /telnyxBrowserClient|@telnyx/ }, () => {
          throw new Error(
            "Call record must not import or initialize browser calling.",
          );
        });
      },
    },
  ],
});
await writeFile(
  join(dir, "index.html"),
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
);
let ready = false,
  requests = [];
const call = {
  salesCallId: "owned-call",
  businessName: "Owned Business",
  contactName: "Known Contact",
  state: "ended",
  startedAt: "2026-10-20T12:00:00Z",
  connectedAt: "2026-10-20T12:00:10Z",
  endedAt: "2026-10-20T12:09:14Z",
  dialedNumber: "+15035550101",
  outcome: "callback_requested",
  outcomeNotes: "Owner asked for a callback.",
  liveNotes: "Question about after-hours coverage.",
  transcriptStatus: "processing",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (url.pathname.startsWith("/api/")) {
    requests.push({ method: req.method, path: url.pathname });
    res.setHeader("Content-Type", "application/json");
    if (url.pathname.endsWith("/foreign-call")) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: "sales_call_forbidden" }));
      return;
    }
    res.end(
      JSON.stringify({
        call: {
          ...call,
          ...(ready
            ? {
                transcriptStatus: "ready",
                transcript: [
                  { role: "caller", text: "Please call me tomorrow." },
                  { role: "assistant", text: "I can pass that along." },
                ],
                recordingUrl: "https://example.com/recording.mp3",
              }
            : {}),
        },
      }),
    );
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      url.pathname.endsWith(".js") ? "application/javascript" : "text/html",
    );
    res.end(
      await readFile(
        join(dir, url.pathname === "/" ? "index.html" : url.pathname.slice(1)),
      ),
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(8000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page
    .getByRole("heading", { name: "Owned Business", exact: true })
    .waitFor();
  await page
    .getByText("Owner asked for a callback.", { exact: true })
    .waitFor();
  await page
    .getByText("Question about after-hours coverage.", { exact: true })
    .waitFor();
  await page
    .getByText("Transcript — processing. This page updates when it arrives.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.getByRole("button").count(), 0);
  assert.equal(
    await page
      .getByRole("link", { name: "Back to calling", exact: true })
      .getAttribute("href"),
    "/sales",
  );
  ready = true;
  await page.getByText(/caller: Please call me tomorrow/).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Open recording ↗", exact: true })
      .getAttribute("href"),
    "https://example.com/recording.mp3",
  );
  assert.ok(
    requests.every(
      (request) =>
        request.method === "GET" &&
        request.path === "/api/v1/admin/sales/calls/owned-call",
    ),
  );
  await page.setViewportSize({ width: 390, height: 800 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/?id=foreign-call`);
  await page
    .getByRole("alert")
    .filter({ hasText: "This call record is not available to your account." })
    .waitFor();
  assert.equal(
    await page
      .getByText("Owner asked for a callback.", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Open recording ↗", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "read-only GET requests",
        "no WebRTC imports",
        "business/contact/notes",
        "async transcript and recording",
        "mobile width",
        "forbidden record hides private content",
      ],
      fixture: dir,
    }),
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
