import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { generateSalesCompanyBrief, companyBriefEvidence, serializeCompanyBrief, SALES_COMPANY_BRIEF_VERSION } from "../pages/api/_lib/salesCompanyBrief.js";
import { prepareSalesCompanyBrief } from "../pages/api/_lib/salesRepository.js";
import { salesCoreFacts } from "../pages/api/_lib/salesCoreFacts.js";
import { callOpenAiJsonModel } from "@everycall/contracts";
import { z } from "zod";
import { companyBriefFailureMessage, companyBriefRequestFailure, normalizeCompanyBrief } from "../lib/salesCompanyBriefDiagnostics.js";

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

const secret = "sk-fixture-secret private-source private-claim user-password";
const assertPrivate = (value) => {
  const json = JSON.stringify(value);
  for (const fragment of secret.split(" ")) assert.ok(!json.includes(fragment), `diagnostic leaked ${fragment}`);
};
const failed = async (error) => generateSalesCompanyBrief(pages, { callModel: async () => { throw error; } });
for (const [error, expected] of [
  [new DOMException(secret, "AbortError"), "model_timeout"],
  [new Error(`openai_json_model_failed:429:${secret}`), "provider_rate_limited"],
  [new Error(`openai_json_model_failed:401:${secret}`), "provider_auth_error"],
  [new Error(`openai_json_model_failed:503:${secret}`), "provider_http_error"],
  [new Error("openai_api_key_missing"), "provider_not_configured"],
  [new TypeError("fetch failed"), "provider_network_error"],
  [new Error(`openai_json_model_refusal:${secret}`), "provider_refusal"],
  [new Error(`openai_json_model_incomplete:${secret}`), "provider_incomplete"],
  [new Error(`openai_json_model_empty_output:${secret}`), "model_empty_output"],
  [new SyntaxError(secret), "invalid_json"],
  [new Error(secret), "unexpected_error"],
]) {
  const result = await failed(error);
  assert.equal(result.diagnostic.code, expected);
  assert.match(result.attemptRef, /^cb_[a-f0-9]{32}$/);
  assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
  assertPrivate(result);
  assertPrivate(serializeCompanyBrief(result));
}
const httpFailure = await failed(new Error(`openai_json_model_failed:400:${JSON.stringify({ error: { message: secret, code: "unsupported_parameter", param: "temperature" } })}`));
assert.deepEqual(httpFailure.diagnostic.details, { httpStatus: 400, providerCode: "unsupported_parameter", providerParam: "temperature" });
assertPrivate(httpFailure);
const arbitraryProvider = await failed(new Error(`openai_json_model_failed:400:${JSON.stringify({ error: { code: secret, param: secret } })}`));
assert.deepEqual(arbitraryProvider.diagnostic.details, { httpStatus: 400 });
const generatedContentFailure = async (parsed) => generateSalesCompanyBrief(pages, { callModel: async () => ({ parsed }) });
const invalidSchema = await generatedContentFailure({ ...content, services: [{ ...content.services[0], text: null }] });
assert.equal(invalidSchema.diagnostic.code, "schema_invalid");
assert.deepEqual(invalidSchema.diagnostic.details.issues, [{ code: "invalid_type", path: "services.0.text" }]);
const unsupported = await generatedContentFailure({ ...content, standOut: [claim(secret, secret)] });
assert.deepEqual(unsupported.diagnostic, { code: "unsupported_quote", stage: "grounding", details: { claimIndex: 0 } });
assertPrivate(unsupported);
const tooLong = await generatedContentFailure({ ...content, standOut: [claim("word ".repeat(101).trim(), lines[0])] });
assert.equal(tooLong.diagnostic.code, "invalid_word_count");
assert.ok(tooLong.diagnostic.details.wordCount > 100);
const duplicate = await generatedContentFailure({ ...content, services: content.services.map(() => content.services[0]) });
assert.equal(duplicate.diagnostic.code, "duplicate_services");
assert.deepEqual(duplicate.diagnostic.details, { serviceCount: 3, uniqueServiceCount: 1 });
const insufficient = await generatedContentFailure({ ...content, services: [] });
assert.equal(insufficient.diagnostic.code, "insufficient_website_evidence");
assert.equal(insufficient.diagnostic.details.serviceCount, 0);
const hostile = { version: SALES_COMPANY_BRIEF_VERSION, status: "unavailable", reason: secret, attemptRef: secret,
  generatedAt: secret, message: secret, diagnostic: { code: "constructor", stage: secret, message: secret,
    details: { httpStatus: secret, wordCount: -1, providerCode: secret, providerParam: secret, rawResponse: secret,
      issues: [{ code: secret, path: secret, message: secret }] } } };
const safe = serializeCompanyBrief(hostile);
assert.equal(safe.reason, "generation_failed");
assert.equal(safe.diagnostic.code, "unexpected_error");
assert.equal(safe.attemptRef, undefined);
assertPrivate(safe);
assertPrivate(normalizeCompanyBrief(hostile));
assertPrivate(companyBriefFailureMessage(hostile));
assert.equal(serializeCompanyBrief({ version: SALES_COMPANY_BRIEF_VERSION, status: "unavailable", reason: "generation_failed" }).diagnostic, undefined);
assert.match(companyBriefFailureMessage({ reason: "generation_failed" }), /try again/);
assert.equal(companyBriefRequestFailure({ status: 401, message: secret }).diagnostic.code, "request_unauthorized");
assert.equal(companyBriefRequestFailure({ status: 403, message: secret }).diagnostic.code, "request_forbidden");
assert.match(companyBriefFailureMessage(companyBriefRequestFailure({ message: secret })), /may still be running/);

const db = new PGlite();
const warnings = [];
const originalWarn = console.warn;
console.warn = (entry) => warnings.push(JSON.parse(entry));
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
  const runnerFailure = await prepareSalesCompanyBrief(pool, "p", { generate: async () => { throw Error(secret); } });
  assert.equal(runnerFailure.status, "unavailable");
  assert.equal(runnerFailure.diagnostic.code, "unexpected_error");
  assert.equal(runnerFailure.diagnostic.stage, "runner");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].event, "sales_company_brief_failed");
  assert.equal(warnings[0].attemptRef, runnerFailure.attemptRef);
  assert.equal(warnings[0].generatedAt, runnerFailure.generatedAt);
  assertPrivate(warnings);
  assert.deepEqual(serializeCompanyBrief((await read()).demo_bundle_json.company_brief), runnerFailure, "diagnostic survives saved-profile reload");
  assert.equal((await read()).status, "ready");
  assert.equal((await prepareSalesCompanyBrief(pool, "p", { generate: async () => ready })).status, "ready");
  await reset();
  const captureWarn = console.warn;
  try {
    console.warn = () => { throw new Error(secret); };
    const loggingFailed = await prepareSalesCompanyBrief(pool, "p", { generate: async () => { throw Error(secret); } });
    assert.equal(loggingFailed.status, "unavailable");
    assert.deepEqual(serializeCompanyBrief((await read()).demo_bundle_json.company_brief), loggingFailed);
  } finally { console.warn = captureWarn; }
  await reset();
  assert.equal((await prepareSalesCompanyBrief(pool, "p", { generate: async () => {
    await db.query("UPDATE sales_demo_profiles SET demo_bundle_json=$1, scrape_pages_json='[]' WHERE prospect_id='p'", [JSON.stringify(bundle)]);
    return ready;
  } })).status, "missing");
  assert.deepEqual((await read()).demo_bundle_json, bundle);
  // A failed old runner cannot overwrite or log over a newer lease winner.
  await db.query("UPDATE sales_demo_profiles SET scrape_pages_json=$1 WHERE prospect_id='p'", [JSON.stringify(legacy)]);
  await reset();
  let releaseOld, enterOld;
  const oldEntered = new Promise((resolve) => { enterOld = resolve; });
  const oldBlocked = new Promise((resolve) => { releaseOld = resolve; });
  const oldRunner = prepareSalesCompanyBrief(pool, "p", { generate: async () => { enterOld(); await oldBlocked; throw Error(secret); } });
  await oldEntered;
  const oldRef = (await read()).demo_bundle_json.company_brief.attemptRef;
  await db.query("UPDATE sales_demo_profiles SET demo_bundle_json=jsonb_set(demo_bundle_json,'{company_brief,startedAt}','\"2000-01-01\"') WHERE prospect_id='p'");
  const winner = await prepareSalesCompanyBrief(pool, "p", { generate: async (saved, options) => generateSalesCompanyBrief(saved, { ...options, callModel: async () => { throw new DOMException(secret, "AbortError"); } }) });
  assert.notEqual(winner.attemptRef, oldRef);
  assert.equal(winner.diagnostic.code, "model_timeout");
  const warningCount = warnings.length;
  releaseOld();
  assert.deepEqual(await oldRunner, winner);
  assert.equal(warnings.length, warningCount, "superseded failure is not logged as the current attempt");
  await reset();
  const changedCapture = await prepareSalesCompanyBrief(pool, "p", { generate: async () => {
    await db.query("UPDATE sales_demo_profiles SET demo_bundle_json=$1, scrape_pages_json='[]' WHERE prospect_id='p'", [JSON.stringify(bundle)]);
    throw Error(secret);
  } });
  assert.equal(changedCapture.status, "missing");
  assert.equal(warnings.length, warningCount, "changed-source failure is not logged as current");
  await db.query("UPDATE sales_prospects SET website_url='https://changed.example' WHERE prospect_id='p'");
  await assert.rejects(() => prepareSalesCompanyBrief(pool, "p"), /Prepare the website demo/);
} finally { console.warn = originalWarn; await db.close(); }
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
console.log("Sales company brief AI, grounding, diagnostics/redaction, persistence, logger failure, leases, retries and source-isolation regressions passed.");
