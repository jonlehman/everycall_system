import Stripe from "stripe";

let stripeClient = null;

function getRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name}_missing`);
  }
  return value;
}

export function getStripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"));
  }
  return stripeClient;
}

function splitWebhookSecrets(value) {
  return String(value || "")
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getStripeWebhookSecrets() {
  const secrets = [
    ...splitWebhookSecrets(process.env.STRIPE_WEBHOOK_SECRET),
    ...splitWebhookSecrets(process.env.STRIPE_WEBHOOK_SECRET_PREVIOUS)
  ];
  const uniqueSecrets = [...new Set(secrets)];
  if (!uniqueSecrets.length) {
    throw new Error("STRIPE_WEBHOOK_SECRET_missing");
  }
  return uniqueSecrets;
}

export function getStripeWebhookSecret() {
  return getStripeWebhookSecrets()[0];
}

export function getStripeBillingPortalConfigurationId() {
  const value = String(process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID || "").trim();
  return value || null;
}

export function getStripeDefaultCurrency() {
  return String(process.env.STRIPE_CURRENCY || "usd").trim().toLowerCase();
}

export function getStripeSuccessUrl() {
  const baseUrl = String(process.env.APP_BASE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("APP_BASE_URL_missing");
  }
  return `${baseUrl}/client/account/billing?checkout=success`;
}

export function getStripeCancelUrl() {
  const baseUrl = String(process.env.APP_BASE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("APP_BASE_URL_missing");
  }
  return `${baseUrl}/client/account/billing?checkout=cancel`;
}

export function getStripeBillingPortalReturnUrl() {
  const baseUrl = String(process.env.APP_BASE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("APP_BASE_URL_missing");
  }
  return `${baseUrl}/client/account/billing`;
}

export async function findCustomerByTenantKey(tenantKey) {
  if (!tenantKey) return null;
  const stripe = getStripe();
  const customers = await stripe.customers.search({
    query: `metadata['tenant_key']:'${String(tenantKey).replace(/'/g, "\\'")}'`,
    limit: 1
  });
  return customers.data[0] || null;
}

export async function createCustomer({
  tenantKey,
  email,
  name,
  phone,
  metadata = {}
}) {
  const stripe = getStripe();
  return stripe.customers.create({
    email: email || undefined,
    name: name || undefined,
    phone: phone || undefined,
    metadata: {
      tenant_key: tenantKey,
      ...metadata
    }
  });
}

export async function findOrCreateCustomer({
  tenantKey,
  email,
  name,
  phone,
  stripeCustomerId,
  metadata = {}
}) {
  const stripe = getStripe();
  if (stripeCustomerId) {
    return stripe.customers.retrieve(stripeCustomerId);
  }
  const existing = await findCustomerByTenantKey(tenantKey);
  if (existing) return existing;
  return createCustomer({ tenantKey, email, name, phone, metadata });
}

function isCurrentSubscriptionStatus(status) {
  return ["trialing", "active", "past_due", "unpaid", "incomplete"].includes(String(status || ""));
}

export async function retrieveCustomer(customerId, options = {}) {
  if (!customerId) return null;
  const stripe = getStripe();
  return stripe.customers.retrieve(customerId, options);
}

export async function retrieveSubscription(subscriptionId, options = {}) {
  if (!subscriptionId) return null;
  const stripe = getStripe();
  return stripe.subscriptions.retrieve(subscriptionId, options);
}

export async function retrieveSubscriptionSchedule(scheduleId, options = {}) {
  if (!scheduleId) return null;
  const stripe = getStripe();
  return stripe.subscriptionSchedules.retrieve(scheduleId, options);
}

export async function retrieveInvoice(invoiceId, options = {}) {
  if (!invoiceId) return null;
  const stripe = getStripe();
  return stripe.invoices.retrieve(invoiceId, options);
}

export async function findCurrentSubscriptionForCustomer(customerId) {
  if (!customerId) return null;
  const stripe = getStripe();
  const result = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20
  });
  const current = result.data
    .filter((subscription) => isCurrentSubscriptionStatus(subscription.status))
    .sort((a, b) => {
      const aEnd = Number(a.current_period_end || a.trial_end || a.created || 0);
      const bEnd = Number(b.current_period_end || b.trial_end || b.created || 0);
      return bEnd - aEnd;
    })[0];
  return current || null;
}

export async function findCurrentSubscriptionForTenantKey(tenantKey) {
  if (!tenantKey) return null;
  const stripe = getStripe();
  const result = await stripe.subscriptions.search({
    query: `metadata['tenant_key']:'${String(tenantKey).replace(/'/g, "\\'")}'`,
    limit: 20
  });
  const current = result.data
    .filter((subscription) => isCurrentSubscriptionStatus(subscription.status))
    .sort((a, b) => {
      const aEnd = Number(a.current_period_end || a.trial_end || a.created || 0);
      const bEnd = Number(b.current_period_end || b.trial_end || b.created || 0);
      return bEnd - aEnd;
    })[0];
  return current || null;
}

export function buildRecurringPriceData({
  unitAmount,
  productId,
  productName,
  currency,
  interval = "month",
  metadata = {}
}) {
  const normalizedAmount = Number(unitAmount);
  if (!Number.isInteger(normalizedAmount) || normalizedAmount < 0) {
    throw new Error("invalid_unit_amount");
  }

  return {
    currency: (currency || getStripeDefaultCurrency()).toLowerCase(),
    unit_amount: normalizedAmount,
    recurring: {
      interval
    },
    ...(productId
      ? { product: productId }
      : {
          product_data: {
            name: productName || "EveryCall Subscription",
            metadata
          }
        })
  };
}

export async function createCheckoutSession({
  customerId,
  customerEmail,
  priceId,
  unitAmount,
  interval = "month",
  productId,
  productName,
  trialEnd,
  tenantKey,
  planCode,
  currency,
  successUrl,
  cancelUrl,
  metadata = {}
}) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_collection: "always",
    customer: customerId || undefined,
    customer_email: customerId ? undefined : customerEmail || undefined,
    success_url: successUrl || getStripeSuccessUrl(),
    cancel_url: cancelUrl || getStripeCancelUrl(),
    line_items: [
      priceId
        ? {
            quantity: 1,
            price: priceId
          }
        : {
            quantity: 1,
            price_data: buildRecurringPriceData({
              unitAmount,
              productId,
              productName,
              currency,
              interval,
              metadata: {
                tenant_key: tenantKey,
                plan_code: planCode,
                ...metadata
              }
            })
          }
    ],
    subscription_data: {
      ...(trialEnd ? { trial_end: Math.floor(new Date(trialEnd).getTime() / 1000) } : {}),
      metadata: {
        tenant_key: tenantKey,
        plan_code: planCode,
        ...metadata
      }
    },
    metadata: {
      tenant_key: tenantKey,
      plan_code: planCode,
      ...metadata
    }
  });
  return session;
}

export async function createBillingPortalSession({
  customerId,
  returnUrl
}) {
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || getStripeBillingPortalReturnUrl(),
    ...(getStripeBillingPortalConfigurationId()
      ? { configuration: getStripeBillingPortalConfigurationId() }
      : {})
  });
}

export async function cancelSubscription(subscriptionId, { immediate = false } = {}) {
  const stripe = getStripe();
  if (immediate) {
    return stripe.subscriptions.cancel(subscriptionId);
  }
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true
  });
}

export async function reactivateSubscription(subscriptionId) {
  const stripe = getStripe();
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false
  });
}

export async function updateSubscriptionTrialEnd(subscriptionId, trialEnd, { prorationBehavior = "none" } = {}) {
  if (!subscriptionId) {
    throw new Error("subscription_id_required");
  }
  const timestamp = Math.floor(new Date(trialEnd).getTime() / 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error("invalid_trial_end");
  }
  const stripe = getStripe();
  return stripe.subscriptions.update(subscriptionId, {
    trial_end: timestamp,
    proration_behavior: prorationBehavior
  });
}

export async function updateSubscriptionPrice({
  subscriptionId,
  subscriptionItemId,
  priceId,
  unitAmount,
  productId,
  productName,
  currency,
  metadata = {}
}) {
  const stripe = getStripe();
  return stripe.subscriptions.update(subscriptionId, {
    items: [
      priceId
        ? {
            id: subscriptionItemId,
            price: priceId
          }
        : {
            id: subscriptionItemId,
            price_data: buildRecurringPriceData({
              unitAmount,
              productId,
              productName,
              currency,
              metadata
            })
          }
    ],
    ...(Object.keys(metadata || {}).length ? { metadata } : {}),
    proration_behavior: "none"
  });
}

export async function createInvoiceItem({
  customerId,
  subscriptionId = null,
  amountCents,
  currency,
  description,
  metadata = {}
}) {
  if (!customerId) {
    throw new Error("customer_id_required");
  }
  const normalizedAmount = Math.round(Number(amountCents || 0));
  if (!Number.isInteger(normalizedAmount) || normalizedAmount === 0) {
    throw new Error("invalid_invoice_item_amount");
  }
  const stripe = getStripe();
  return stripe.invoiceItems.create({
    customer: customerId,
    ...(subscriptionId ? { subscription: subscriptionId } : {}),
    amount: normalizedAmount,
    currency: (currency || getStripeDefaultCurrency()).toLowerCase(),
    description: description || undefined,
    metadata
  });
}

export function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripe();
  let lastError = null;
  for (const secret of getStripeWebhookSecrets()) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("stripe_webhook_verification_failed");
}
