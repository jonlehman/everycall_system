import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { hasSalesLiveCheckoutWebhook, inspectSalesLiveCheckoutWebhook } from '../pages/api/_lib/salesCheckoutReadiness.js';

const app = 'https://app.example.test';
const enabled = { id: 'we_ready', status: 'enabled', livemode: true, url: `${app}/api/v1/stripe/webhook`, enabled_events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded'] };
let calls = [];
const client = data => ({ webhookEndpoints: { list: async (params, options) => { calls.push({ params, options }); return { data, has_more: false }; } } });
assert.equal(await hasSalesLiveCheckoutWebhook(client([enabled]), app), true);
assert.equal(calls[0].params.limit, 100);
assert.equal(calls[0].options.maxNetworkRetries, 0);
assert(calls[0].options.timeout > 0 && calls[0].options.timeout <= 10000);
for (const changed of [
  { status: 'disabled' }, { livemode: false }, { livemode: undefined },
  { url: 'https://old-deployment.vercel.app/api/v1/stripe/webhook' },
  { url: `${enabled.url}?old=1` }, { url: `${app}/api/v1/stripe/sales-test-webhook` },
  { enabled_events: ['checkout.session.completed'] }, { enabled_events: [] },
]) assert.equal(await hasSalesLiveCheckoutWebhook(client([{ ...enabled, ...changed }]), app), false);
assert.equal(await hasSalesLiveCheckoutWebhook(client([{ ...enabled, enabled_events: ['*'] }]), app), true);
for (const base of ['http://app.example.test', `${app}/subpath`, `${app}?preview=1`, 'https://user:password@app.example.test']) {
  calls = [];assert.equal(await hasSalesLiveCheckoutWebhook(client([enabled]), base), false);assert.equal(calls.length, 0);
}
let pages = 0;
const paged = { webhookEndpoints: { list: async (params, options) => {
  pages++;assert.equal(params.limit, 100);assert.equal(options.maxNetworkRetries, 0);assert(options.timeout <= 10000);
  if (pages > 1) assert.equal(params.starting_after, `we_${pages - 1}`);
  return { data: [{ ...enabled, id: `we_${pages}`, status: pages === 3 ? 'enabled' : 'disabled' }], has_more: true };
} } };
assert.equal(await hasSalesLiveCheckoutWebhook(paged, app), true);assert.equal(pages, 3);
pages = 0;
assert.equal(await hasSalesLiveCheckoutWebhook({ webhookEndpoints: { list: async () => { pages++;return { data: [{ ...enabled, id: `we_${pages}`, status: 'disabled' }], has_more: true }; } } }, app), false);
assert.equal(pages, 3);
assert.equal(await hasSalesLiveCheckoutWebhook({ webhookEndpoints: { list: async () => { throw Error('provider details must stay private'); } } }, app), false);

// Diagnostic output is deliberately limited to fixed classifications and counts.
const completedOnly = { ...enabled, enabled_events: ['checkout.session.completed'] };
let diagnosis = await inspectSalesLiveCheckoutWebhook(client([completedOnly]), app);
assert.equal(diagnosis.ready, false);
assert.equal(diagnosis.reason, 'completion_events_missing');
assert.deepEqual(diagnosis.counts, { scanned: 1, liveEnabled: 1, canonical: 1, canonicalCompleted: 1, canonicalAsync: 0, rewriteAlias: 0, rewriteAliasCompleted: 0, rewriteAliasAsync: 0 });
diagnosis = await inspectSalesLiveCheckoutWebhook(client([{ ...completedOnly, url: `${app}/v1/stripe/webhook` }]), app);
assert.equal(diagnosis.ready, false, 'Instrumentation must not change acceptance of the rewrite alias');
assert.equal(diagnosis.reason, 'canonical_endpoint_missing');
assert.equal(diagnosis.counts.rewriteAliasCompleted, 1);
assert.equal(diagnosis.counts.canonical, 0);
for (const [statusCode, reason] of [[401, 'lookup_unauthorized'], [403, 'lookup_forbidden'], [500, 'lookup_failed']]) {
  diagnosis = await inspectSalesLiveCheckoutWebhook({ webhookEndpoints: { list: async () => { throw Object.assign(Error('SECRET_PROVIDER_DETAIL'), { statusCode, raw: { apiKey: 'SECRET_KEY' } }); } } }, app);
  assert.equal(diagnosis.reason, reason);
  assert(!JSON.stringify(diagnosis).includes('SECRET'));
}
assert.equal((await inspectSalesLiveCheckoutWebhook(client([]), app)).reason, 'no_enabled_live_endpoint');
assert.equal((await inspectSalesLiveCheckoutWebhook(client([enabled]), `${app}/path`)).reason, 'app_url_invalid');
assert.equal((await inspectSalesLiveCheckoutWebhook({ webhookEndpoints: { list: async () => ({ data: null }) } }, app)).reason, 'invalid_provider_response');
diagnosis = await inspectSalesLiveCheckoutWebhook(client([
  { ...completedOnly, url: 'https://app.everycall.io/v1/stripe/webhook' },
  { ...enabled, url: 'https://www.everycall.io/api/v1/stripe/webhook' },
  { ...enabled, url: 'https://SECRET.example/api/v1/stripe/webhook?secret=SECRET' },
]), 'https://everycall.io');
assert.equal(diagnosis.appOrigin, 'public');
assert.deepEqual(diagnosis.knownRoutes, { appRewrite: { count: 1, completed: 1, async: 0 }, wwwApi: { count: 1, completed: 1, async: 1 } });
assert(!JSON.stringify(diagnosis).includes('SECRET'));

// Exercise the real SDK request path, using only an in-memory HTTP transport.
// The request timeout reaches the actual transport; retryable failure is not retried.
let transportCalls = 0;
const sdk = new Stripe('sk_live_fixture', { maxNetworkRetries: 2, timeout: 60000, httpClient: {
  getClientName: () => 'fixture',
  makeRequest: async (_host, _port, path, method, _headers, _data, _protocol, timeout) => {
    transportCalls++;assert.match(path, /^\/v1\/webhook_endpoints\?limit=100$/);assert.equal(method, 'GET');assert(timeout > 0 && timeout <= 10000);
    throw Object.assign(Error('fixture timeout'), { code: 'ETIMEDOUT' });
  },
} });
assert.equal(await hasSalesLiveCheckoutWebhook(sdk, app), false);
assert.equal(transportCalls, 1, 'Per-request maxNetworkRetries:0 overrides the real SDK retry default');
// A real SDK response whose body is delayed past the caller budget must return
// false promptly. Once the body arrives, no additional page may be requested.
let delayedRequests = 0, releaseBody;
const delayedBody = new Promise(resolve => { releaseBody = resolve; });
const delayedSdk = new Stripe('sk_live_fixture', { httpClient: {
  getClientName: () => 'delayed-body-fixture',
  makeRequest: async (_host, _port, _path, _method, _headers, _data, _protocol, timeout) => {
    delayedRequests++;assert(timeout > 0 && timeout <= 25);
    return { getStatusCode: () => 200, getHeaders: () => ({}), getRawResponse: () => ({}), toJSON: async () => delayedBody };
  },
} });
const started = performance.now();
assert.equal(await hasSalesLiveCheckoutWebhook(delayedSdk, app, { budgetMs: 25 }), false);
assert(performance.now() - started < 500, 'Caller must not wait for the response body');
assert.equal(delayedRequests, 1);
releaseBody({ data: [{ ...enabled, status: 'disabled' }], has_more: true });
await new Promise(resolve => setTimeout(resolve, 40));
assert.equal(delayedRequests, 1, 'Expired read must not launch another page');
console.log('PASS live custom-checkout webhook readiness: exact canonical HTTPS URL, enabled/live/events, bounded pagination, fail closed, real Stripe SDK inactivity timeout/zero retries and overall caller deadline for delayed bodies');
