const REQUIRED_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
const LOOKUP_BUDGET_MS = 10000;
const MAX_PAGES = 3;

// Read on the exact Stripe client used to create this checkout, outside database
// locks and without caching. SDK timeouts bound socket inactivity; the separate
// caller deadline also covers slow response bodies. A late read has no mutation
// authority and cannot start another page after its deadline expires.
export async function hasSalesLiveCheckoutWebhook(stripe, appBaseUrl, { budgetMs = LOOKUP_BUDGET_MS } = {}) {
  let timer;
  let expired = false;
  try {
    const origin = new URL(appBaseUrl);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return false;
    const expectedUrl = `${origin.origin}/api/v1/stripe/webhook`;
    const budget = Number.isInteger(budgetMs) && budgetMs > 0 ? Math.min(budgetMs, LOOKUP_BUDGET_MS) : LOOKUP_BUDGET_MS;
    const deadline = performance.now() + budget;
    const lookup = async () => {
      try {
        let startingAfter;
        for (let page = 0; page < MAX_PAGES; page++) {
          const timeout = Math.floor(deadline - performance.now());
          if (expired || timeout < 1) return false;
          const result = await stripe.webhookEndpoints.list(
            { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
            { timeout, maxNetworkRetries: 0 },
          );
          if (expired || performance.now() >= deadline || !Array.isArray(result?.data)) return false;
          if (result.data.some(endpoint => endpoint.status === 'enabled' && endpoint.livemode === true && endpoint.url === expectedUrl && Array.isArray(endpoint.enabled_events) && (endpoint.enabled_events.includes('*') || REQUIRED_EVENTS.every(event => endpoint.enabled_events.includes(event))))) return true;
          if (result.has_more !== true) return false;
          const next = result.data.at(-1)?.id;
          if (!next || next === startingAfter) return false;
          startingAfter = next;
        }
      } catch { /* Missing permissions, lookup failures and timeouts fail closed. */ }
      return false;
    };
    const timedOut = new Promise(resolve => {
      timer = setTimeout(() => { expired = true; resolve(false); }, budget);
    });
    return await Promise.race([lookup(), timedOut]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
