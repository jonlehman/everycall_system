const REQUIRED_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
const LOOKUP_BUDGET_MS = 10000;
const MAX_PAGES = 3;
const KNOWN_ORIGINS = new Map([
  ['https://app.everycall.io', 'app'],
  ['https://everycall.io', 'public'],
  ['https://www.everycall.io', 'www'],
]);

// Read on the exact Stripe client used to create this checkout, outside database
// locks and without caching. SDK timeouts bound socket inactivity; the separate
// caller deadline also covers slow response bodies. A late read has no mutation
// authority and cannot start another page after its deadline expires.
export async function inspectSalesLiveCheckoutWebhook(stripe, appBaseUrl, { budgetMs = LOOKUP_BUDGET_MS } = {}) {
  let timer;
  let expired = false;
  let appOrigin = 'invalid';
  const counts = { scanned: 0, liveEnabled: 0, canonical: 0, canonicalCompleted: 0, canonicalAsync: 0, rewriteAlias: 0, rewriteAliasCompleted: 0, rewriteAliasAsync: 0 };
  const knownRoutes = {};
  const report = reason => ({ ready: reason === 'ready', reason, appOrigin, counts: { ...counts }, knownRoutes: structuredClone(knownRoutes) });
  try {
    const origin = new URL(appBaseUrl);
    appOrigin = KNOWN_ORIGINS.get(origin.origin) || 'other';
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return report('app_url_invalid');
    const expectedUrl = `${origin.origin}/api/v1/stripe/webhook`;
    const rewriteAliasUrl = `${origin.origin}/v1/stripe/webhook`;
    const budget = Number.isInteger(budgetMs) && budgetMs > 0 ? Math.min(budgetMs, LOOKUP_BUDGET_MS) : LOOKUP_BUDGET_MS;
    const deadline = performance.now() + budget;
    const lookup = async () => {
      try {
        let startingAfter;
        for (let page = 0; page < MAX_PAGES; page++) {
          const timeout = Math.floor(deadline - performance.now());
          if (expired || timeout < 1) return report('lookup_timeout');
          const result = await stripe.webhookEndpoints.list(
            { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
            { timeout, maxNetworkRetries: 0 },
          );
          if (expired || performance.now() >= deadline) return report('lookup_timeout');
          if (!Array.isArray(result?.data)) return report('invalid_provider_response');
          for (const endpoint of result.data) {
            counts.scanned++;
            if (endpoint?.status !== 'enabled' || endpoint.livemode !== true) continue;
            counts.liveEnabled++;
            const events = Array.isArray(endpoint.enabled_events) ? endpoint.enabled_events : [];
            const completed = events.includes('*') || events.includes(REQUIRED_EVENTS[0]);
            const asyncSucceeded = events.includes('*') || events.includes(REQUIRED_EVENTS[1]);
            for (const [knownOrigin, label] of KNOWN_ORIGINS) {
              for (const [path, routeLabel] of [['/api/v1/stripe/webhook', 'Api'], ['/v1/stripe/webhook', 'Rewrite']]) {
                if (endpoint.url !== `${knownOrigin}${path}`) continue;
                const key = `${label}${routeLabel}`;
                const entry = knownRoutes[key] ||= { count: 0, completed: 0, async: 0 };
                entry.count++;entry.completed += Number(completed);entry.async += Number(asyncSucceeded);
              }
            }
            const route = endpoint.url === expectedUrl ? 'canonical' : endpoint.url === rewriteAliasUrl ? 'rewriteAlias' : null;
            if (!route) continue;
            counts[route]++;
            if (completed) counts[`${route}Completed`]++;
            if (asyncSucceeded) counts[`${route}Async`]++;
            // Diagnostics recognize the existing rewrite; acceptance remains unchanged.
            if (route === 'canonical' && completed && asyncSucceeded) return report('ready');
          }
          if (result.has_more !== true) return report(!counts.liveEnabled ? 'no_enabled_live_endpoint' : !counts.canonical ? 'canonical_endpoint_missing' : 'completion_events_missing');
          const next = result.data.at(-1)?.id;
          if (!next || next === startingAfter) return report('invalid_pagination');
          startingAfter = next;
        }
      } catch (error) {
        // Never return provider messages, URLs, IDs, response bodies or credentials.
        return report(error?.statusCode === 403 ? 'lookup_forbidden' : error?.statusCode === 401 ? 'lookup_unauthorized' : 'lookup_failed');
      }
      return report('pagination_limit');
    };
    const timedOut = new Promise(resolve => {
      timer = setTimeout(() => { expired = true; resolve(report('lookup_timeout')); }, budget);
    });
    return await Promise.race([lookup(), timedOut]);
  } catch {
    return report('app_url_invalid');
  } finally {
    clearTimeout(timer);
  }
}

export async function hasSalesLiveCheckoutWebhook(stripe, appBaseUrl, options) {
  return (await inspectSalesLiveCheckoutWebhook(stripe, appBaseUrl, options)).ready;
}
