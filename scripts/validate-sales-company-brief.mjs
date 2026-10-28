import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { generateSalesCompanyBrief, companyBriefEvidence, serializeCompanyBrief, SALES_COMPANY_BRIEF_VERSION } from "../pages/api/_lib/salesCompanyBrief.js";
import { prepareSalesCompanyBrief } from "../pages/api/_lib/salesRepository.js";
import { salesCoreFacts } from "../pages/api/_lib/salesCoreFacts.js";
import { callOpenAiJsonModel } from "@everycall/contracts";
import { z } from "zod";

const url = "https://fixture.example/services";
const lines = [
  "Family owned since 1985, Cedar focuses on residential plumbing and maintains a workshop where customers can see the water heaters and fixtures it installs.",
  "Our services include repairing household leaks and damaged plumbing fixtures; installing replacement water heaters and connecting them to existing household plumbing; and clearing blocked kitchen, bathroom and laundry drains.",
  "Customers contact Cedar for help with leaking fixtures, blocked drains and replacement water heaters in their homes.",
];
const pages = [{ url, title: "Cedar Plumbing", lines, headings: ["Services"] }];
const claim = (text, quote) => ({ text, quote, sourceUrl: url });
const content = {
  standOut: [claim(lines[0], lines[0])],
  services: [
    claim("Repairing household leaks and damaged plumbing fixtures", lines[1]),
    claim("Installing replacement water heaters and connecting them to existing household plumbing", lines[1]),
    claim("Clearing blocked kitchen, bathroom and laundry drains", lines[1]),
  ],
  whyCustomersCall: claim(lines[2], lines[2]),
};
let invocations = 0;
const ready = await generateSalesCompanyBrief(pages, { callModel: async (request) => {
  invocations++;
  assert.equal(request.timeoutMs, 30000);
  assert.equal(request.maxAttempts, 1);
  assert.match(request.system, /untrusted data/);
  assert.deepEqual(JSON.parse(request.user).websiteEvidence, companyBriefEvidence(pages));
  return { parsed: content, model: "fixture-model", responseId: "fixture-response" };
} });
assert.equal(ready.status, "ready");
assert.equal(invocations, 1);
assert.equal(serializeCompanyBrief(ready).services.length, 3);
assert.equal(serializeCompanyBrief({ ...ready, content: { ...content, standOut: [] } }).standOut, "");
assert.equal((await generateSalesCompanyBrief([], { callModel: () => { throw Error("must not call"); } })).reason, "website_evidence_missing");
assert.equal((await generateSalesCompanyBrief(pages, { callModel: async () => { throw Error("provider failed"); } })).status, "unavailable");
assert.equal((await generateSalesCompanyBrief(pages, { callModel: async () => ({ parsed: { ...content, services: content.services.slice(0, 2) } }) })).reason, "insufficient_website_evidence");
assert.equal((await generateSalesCompanyBrief(pages, { callModel: async () => ({ parsed: { ...content, standOut: [claim("Unsupported claim", "not found in source")] } }) })).status, "unavailable");
assert.equal((await generateSalesCompanyBrief(pages, { callModel: async () => ({ parsed: { ...content, services: [content.services[0], content.services[0], content.services[0]] } }) })).status, "unavailable");
assert.equal(serializeCompanyBrief({ version: SALES_COMPANY_BRIEF_VERSION, status: "pending", startedAt: "2000-01-01" }).reason, "generation_interrupted");
assert.equal(serializeCompanyBrief({ version: "old", status: "ready" }).status, "missing");
const original = structuredClone(pages);
companyBriefEvidence(pages);
assert.deepEqual(pages, original);
const legacy = [{ url, title: "Cedar", description: lines[0], headings: [lines[1]], excerpt: lines[2] }];
assert.equal((await generateSalesCompanyBrief(legacy, { callModel: async () => ({ parsed: content }) })).status, "ready");

const db = new PGlite();
try {
  await db.exec(`CREATE TABLE sales_prospects(prospect_id TEXT PRIMARY KEY, website_url TEXT);
    CREATE TABLE sales_demo_profiles(prospect_id TEXT PRIMARY KEY, status TEXT, source_website_url TEXT,
      demo_bundle_json JSONB, scrape_pages_json JSONB, updated_at TIMESTAMPTZ DEFAULT NOW());`);
  const facts = [{ category: "hours", label: "Hours", sentence: "Monday to Friday." }];
  const bundle = { core_facts: facts, topServices: ["Original service"], summary: "Receptionist summary" };
  await db.query("INSERT INTO sales_prospects VALUES ('p', $1)", [url]);
  await db.query("INSERT INTO sales_demo_profiles(prospect_id,status,source_website_url,demo_bundle_json,scrape_pages_json) VALUES ('p','ready',$1,$2,$3)", [url, JSON.stringify(bundle), JSON.stringify(legacy)]);
  const pool = { query: (...args) => db.query(...args) };
  const read = async () => (await db.query("SELECT * FROM sales_demo_profiles WHERE prospect_id='p'")).rows[0];
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const generating = prepareSalesCompanyBrief(pool, "p", { generate: async (saved) => {
    assert.deepEqual(saved, legacy); entered(); await blocked; return ready;
  } });
  await started;
  assert.equal((await prepareSalesCompanyBrief(pool, "p", { generate: () => { throw Error("duplicate generation"); } })).status, "pending");
  release();
  assert.equal((await generating).status, "ready");
  const stored = await read();
  assert.deepEqual(stored.scrape_pages_json, legacy);
  const { company_brief, ...unchanged } = stored.demo_bundle_json;
  assert.deepEqual(unchanged, bundle);
  assert.deepEqual(salesCoreFacts(stored.demo_bundle_json), facts);
  assert.equal(stored.status, "ready");
  assert.equal((await prepareSalesCompanyBrief(pool, "p", { generate: () => { throw Error("ready regeneration"); } })).status, "ready");
  const reset = async (brief = {}) => db.query("UPDATE sales_demo_profiles SET demo_bundle_json=$1 WHERE prospect_id='p'", [JSON.stringify({ ...bundle, company_brief: brief })]);
  await reset({ version: SALES_COMPANY_BRIEF_VERSION, status: "pending", startedAt: "2000-01-01" });
  assert.equal((await prepareSalesCompanyBrief(pool, "p", { generate: async () => ready })).status, "ready");
  await reset();
  assert.equal((await prepareSalesCompanyBrief(pool, "p", { generate: async () => { throw Error("failed"); } })).status, "unavailable");
  assert.equal((await read()).status, "ready");
  assert.equal((await prepareSalesCompanyBrief(pool, "p", { generate: async () => ready })).status, "ready");
  await reset();
  assert.equal((await prepareSalesCompanyBrief(pool, "p", { generate: async () => {
    await db.query("UPDATE sales_demo_profiles SET demo_bundle_json=$1, scrape_pages_json='[]' WHERE prospect_id='p'", [JSON.stringify(bundle)]);
    return ready;
  } })).status, "missing");
  assert.deepEqual((await read()).demo_bundle_json, bundle);
  await db.query("UPDATE sales_prospects SET website_url='https://changed.example' WHERE prospect_id='p'");
  await assert.rejects(() => prepareSalesCompanyBrief(pool, "p"), /Prepare the website demo/);
} finally { await db.close(); }
// Exercise actual helper cancellation at both fetch and body-read stages.
const originalFetch = globalThis.fetch;
const request = { apiKey: "fixture-only", model: "fixture-model", system: "test", user: "test", schema: z.object({ ok: z.boolean() }) };
try {
  for (const stage of ["headers", "body"]) {
    let calls = 0;
    globalThis.fetch = async (_url, { signal }) => {
      calls++;
      const pending = () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("fixture_aborted")), { once: true }));
      return stage === "headers" ? pending() : { ok: true, json: pending };
    };
    await assert.rejects(() => callOpenAiJsonModel({ ...request, timeoutMs: 10, maxAttempts: 1 }), /fixture_aborted/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, text: async () => "fixture failure" };
    return { ok: true, json: async () => ({ output_text: '{"ok":true}' }) };
  };
  assert.equal((await callOpenAiJsonModel(request)).parsed.ok, true);
  assert.equal(calls, 2, "existing callers retain default retry behavior");
} finally { globalThis.fetch = originalFetch; }
console.log("Sales company brief AI, grounding, legacy evidence, leases, retries and source-isolation regressions passed.");
