import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import {
  buildPlanDisplay,
  ensureTenantBillingAccount,
  getBillingPlanByCode,
  getPlanStripePriceIdForInterval,
  getSystemBillingConfig,
  requireTenantOwner,
  resolveEffectiveBaseAmount,
  resolveEffectiveBillingInterval,
  resolveEffectiveMonthlyAmount,
  syncTenantStripeSubscription
} from "../../_lib/billing.js";
import { computeDiscountedAmountCents, getTenantActiveCouponRedemption } from "../../_lib/billingCoupons.js";
import { createCheckoutSession, findCurrentSubscriptionForCustomer, findCurrentSubscriptionForTenantKey, findOrCreateCustomer, retrieveSubscription } from "../../_lib/stripe.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const owner = await requireTenantOwner(session);
    if (!owner) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = resolveTenantKey(session, getTenantKey(req));
    let row = await ensureTenantBillingAccount(pool, tenantKey);
    if (!row) {
      return res.status(404).json({ error: "tenant_not_found" });
    }
    const billingConfig = await getSystemBillingConfig(pool);

    let existingSubscription = null;
    let checkoutLookupSource = "none";
    let checkoutLookupError = null;

    try {
      existingSubscription = await findCurrentSubscriptionForTenantKey(tenantKey);
      checkoutLookupSource = existingSubscription ? "tenant_key_lookup" : "tenant_key_lookup_empty";
    } catch (error) {
      checkoutLookupError = error?.message || "unknown";
    }

    if (!existingSubscription && row.stripe_subscription_id) {
      try {
        existingSubscription = await retrieveSubscription(row.stripe_subscription_id);
        checkoutLookupSource = existingSubscription ? "stored_subscription_id" : "stored_subscription_id_empty";
      } catch (error) {
        checkoutLookupError = `${checkoutLookupError ? `${checkoutLookupError};` : ""}${error?.message || "unknown"}`;
      }
    }

    console.info("billing_checkout_existing_subscription_lookup", {
      tenantKey,
      storedStripeCustomerId: row.stripe_customer_id || null,
      storedStripeSubscriptionId: row.stripe_subscription_id || null,
      source: checkoutLookupSource,
      foundSubscriptionId: existingSubscription?.id || null,
      foundSubscriptionStatus: existingSubscription?.status || null,
      checkoutLookupError
    });
    if (existingSubscription && ["trialing", "active", "past_due", "unpaid", "incomplete"].includes(String(existingSubscription.status || ""))) {
      row = await syncTenantStripeSubscription(pool, tenantKey, row, existingSubscription, "billing.checkout.sync");
      return res.status(409).json({
        error: "subscription_already_exists",
        message: "Billing is already active for this account.",
        stripeSubscriptionId: existingSubscription.id
      });
    }

    const customer = await findOrCreateCustomer({
      tenantKey,
      stripeCustomerId: row.stripe_customer_id,
      email: owner.email || row.owner_email || undefined,
      name: owner.name || row.owner_name || row.name,
      phone: owner.phone_number || undefined,
      metadata: {
        tenant_key: tenantKey,
        tenant_name: row.name || ""
      }
    });
    const planDisplay = buildPlanDisplay(row, billingConfig);
    const selectedPlan = getBillingPlanByCode(billingConfig.plans, planDisplay.basePlanCode);
    const billingInterval = resolveEffectiveBillingInterval(row);
    const activeCoupon = await getTenantActiveCouponRedemption(pool, tenantKey).catch(() => null);
    const couponMonthlyDiscountPercent = Number(activeCoupon?.monthlyDiscountPercent || 0);
    const baseAmountCents = resolveEffectiveBaseAmount(row, billingConfig);
    const discountedBaseAmountCents = couponMonthlyDiscountPercent > 0
      ? computeDiscountedAmountCents(baseAmountCents, couponMonthlyDiscountPercent)
      : baseAmountCents;
    const standardStripePriceId = (!planDisplay.isCustom && couponMonthlyDiscountPercent <= 0)
      ? (getPlanStripePriceIdForInterval(selectedPlan, billingInterval) || null)
      : null;
    const standardStripeProductId = !planDisplay.isCustom ? (selectedPlan?.stripeProductId || null) : null;

    await pool.query(
      `INSERT INTO tenant_billing_accounts (tenant_key, stripe_customer_id, billing_interval, monthly_amount_cents, stripe_product_id, stripe_price_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tenant_key)
       DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id,
                     billing_interval = EXCLUDED.billing_interval,
                     stripe_product_id = COALESCE(tenant_billing_accounts.stripe_product_id, EXCLUDED.stripe_product_id),
                     stripe_price_id = COALESCE(tenant_billing_accounts.stripe_price_id, EXCLUDED.stripe_price_id),
                     updated_at = NOW()`,
      [
        tenantKey,
        customer.id,
        billingInterval,
        Number(row.monthly_amount_cents || resolveEffectiveMonthlyAmount(row)),
        standardStripeProductId || row.stripe_product_id || null,
        standardStripePriceId || row.stripe_price_id || null
      ]
    );

    const currentCustomerSubscription = await findCurrentSubscriptionForCustomer(customer.id).catch(() => null);
    console.info("billing_checkout_customer_subscription_lookup", {
      tenantKey,
      stripeCustomerId: customer.id,
      foundSubscriptionId: currentCustomerSubscription?.id || null,
      foundSubscriptionStatus: currentCustomerSubscription?.status || null
    });
    if (currentCustomerSubscription && ["trialing", "active", "past_due", "unpaid", "incomplete"].includes(String(currentCustomerSubscription.status || ""))) {
      row = await syncTenantStripeSubscription(pool, tenantKey, row, currentCustomerSubscription, "billing.checkout.sync");
      return res.status(409).json({
        error: "subscription_already_exists",
        message: "Billing is already active for this account.",
        stripeSubscriptionId: currentCustomerSubscription.id
      });
    }

    const trialEnd = row.billing_status === "trialing" && row.trial_end && new Date(row.trial_end).getTime() > Date.now()
      ? row.trial_end
      : null;

    const sessionData = await createCheckoutSession({
      customerId: customer.id,
      customerEmail: customer.email || owner.email || row.owner_email || undefined,
      priceId: standardStripePriceId,
      unitAmount: discountedBaseAmountCents,
      interval: billingInterval,
      productId: standardStripeProductId || row.stripe_product_id || null,
      productName: `${row.name || "EveryCall"} Subscription`,
      trialEnd,
      tenantKey,
      planCode: planDisplay.code,
      metadata: {
        tenant_key: tenantKey,
        actor_user_id: String(session.user_id || ""),
        billing_interval: billingInterval,
        billing_coupon_code: activeCoupon?.code || "",
        billing_coupon_monthly_discount_percent: String(couponMonthlyDiscountPercent || 0)
      }
    });

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, $3, $4)`,
      [tenantKey, `tenant:${session.user_id}`, "billing.checkout.created", `checkout_session=${sessionData.id}`]
    );

    return res.status(200).json({
      ok: true,
      checkoutUrl: sessionData.url,
      checkoutSessionId: sessionData.id
    });
  } catch (err) {
    return res.status(500).json({ error: "billing_checkout_error", message: err?.message || "unknown" });
  }
}
