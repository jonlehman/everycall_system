import { ensureTables, getPool } from "../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../_lib/auth.js";
import {
  buildAdminPricingState,
  buildPlanDisplay,
  buildPricingOverride,
  ensureTenantBillingAccount,
  getSystemBillingConfig,
  recordBillingLifecycleEvent,
  syncTenantStripeSubscription
} from "../../../../../_lib/billing.js";
import {
  findCurrentSubscriptionForCustomer,
  findCurrentSubscriptionForTenantKey,
  retrieveSubscription,
  updateSubscriptionPrice
} from "../../../../../_lib/stripe.js";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "unpaid", "incomplete"]);

function normalizeMoneyCents(value, { allowZero = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount);
  if (rounded < 0) return null;
  if (!allowZero && rounded <= 0) return null;
  return rounded;
}

async function findActiveStripeSubscription(row, tenantKey) {
  let subscription = null;

  if (row?.stripe_subscription_id) {
    try {
      subscription = await retrieveSubscription(row.stripe_subscription_id);
    } catch {
      subscription = null;
    }
  }

  if (!subscription && row?.stripe_customer_id) {
    try {
      subscription = await findCurrentSubscriptionForCustomer(row.stripe_customer_id);
    } catch {
      subscription = null;
    }
  }

  if (!subscription) {
    try {
      subscription = await findCurrentSubscriptionForTenantKey(tenantKey);
    } catch {
      subscription = null;
    }
  }

  if (!subscription || !ACTIVE_SUBSCRIPTION_STATUSES.has(String(subscription.status || "").trim().toLowerCase())) {
    return null;
  }
  return subscription;
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

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin || admin.role !== "super-admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = String(req.query?.tenantKey || "").trim();
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const billingConfig = await getSystemBillingConfig(pool);
    const requestedPlanCode = String(body.planCode || "").trim().toLowerCase();
    const selectedPlan = billingConfig.plans.find((plan) => String(plan.code || "").trim().toLowerCase() === requestedPlanCode);
    const monthlyAmountCents = normalizeMoneyCents(body.monthlyAmountCents);
    const leadRateCents = normalizeMoneyCents(body.leadRateCents, { allowZero: true });

    if (!selectedPlan) {
      return res.status(400).json({ error: "invalid_plan_code" });
    }
    if (monthlyAmountCents === null) {
      return res.status(400).json({ error: "invalid_monthly_amount" });
    }
    if (leadRateCents === null) {
      return res.status(400).json({ error: "invalid_lead_rate" });
    }

    let row = await ensureTenantBillingAccount(pool, tenantKey, { plan_code: selectedPlan.code });
    if (!row) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    const nextIsCustom = monthlyAmountCents !== selectedPlan.monthlyAmountCents
      || leadRateCents !== selectedPlan.leadRateCents;
    const monthlyAmountOverrideCents = nextIsCustom ? monthlyAmountCents : null;
    const leadRateOverrideCents = nextIsCustom ? leadRateCents : null;

    const activeSubscription = await findActiveStripeSubscription(row, tenantKey);
    let syncedRow = row;

    if (activeSubscription) {
      const subscriptionItem = activeSubscription?.items?.data?.[0] || null;
      if (!subscriptionItem?.id) {
        return res.status(500).json({ error: "stripe_subscription_item_missing" });
      }
      const updatedSubscription = await updateSubscriptionPrice({
        subscriptionId: activeSubscription.id,
        subscriptionItemId: subscriptionItem.id,
        unitAmount: monthlyAmountCents,
        productId: row.stripe_product_id || subscriptionItem.price?.product || null,
        productName: `${row.name || "EveryCall"} Subscription`,
        metadata: {
          tenant_key: tenantKey,
          plan_code: nextIsCustom ? "custom" : selectedPlan.code
        }
      });
      syncedRow = await syncTenantStripeSubscription(pool, tenantKey, row, updatedSubscription, "billing.pricing.updated");
    }

    await pool.query(
      `UPDATE tenants
       SET plan_code = $2,
           plan = $3,
           updated_at = NOW()
       WHERE tenant_key = $1`,
      [tenantKey, selectedPlan.code, selectedPlan.label]
    );

    await pool.query(
      `INSERT INTO tenant_billing_accounts (
         tenant_key,
         monthly_amount_cents,
         lead_rate_cents,
         included_lead_count,
         monthly_amount_override_cents,
         lead_rate_override_cents,
         price_override_reason,
         price_override_cycles_remaining,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NOW())
       ON CONFLICT (tenant_key)
       DO UPDATE SET
         monthly_amount_cents = EXCLUDED.monthly_amount_cents,
         lead_rate_cents = EXCLUDED.lead_rate_cents,
         included_lead_count = EXCLUDED.included_lead_count,
         monthly_amount_override_cents = EXCLUDED.monthly_amount_override_cents,
         lead_rate_override_cents = EXCLUDED.lead_rate_override_cents,
         price_override_reason = EXCLUDED.price_override_reason,
         price_override_cycles_remaining = NULL,
         updated_at = NOW()`,
      [
        tenantKey,
        selectedPlan.monthlyAmountCents,
        selectedPlan.leadRateCents,
        selectedPlan.includedCount,
        monthlyAmountOverrideCents,
        leadRateOverrideCents,
        nextIsCustom ? "custom_pricing" : null
      ]
    );

    const updatedRowResult = await ensureTenantBillingAccount(pool, tenantKey, { plan_code: selectedPlan.code });
    const updatedRow = updatedRowResult || syncedRow;
    const plan = buildPlanDisplay(updatedRow, billingConfig);
    const pricing = buildAdminPricingState(updatedRow, billingConfig);
    const override = buildPricingOverride(updatedRow);

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, 'billing.pricing.updated', $3)`,
      [
        tenantKey,
        `admin:${admin.id}`,
        `plan_code=${selectedPlan.code} monthly_amount_cents=${monthlyAmountCents} lead_rate_cents=${leadRateCents} custom=${nextIsCustom}`
      ]
    );

    await recordBillingLifecycleEvent(pool, {
      tenantKey,
      eventType: "billing.pricing.updated",
      reason: nextIsCustom ? "custom_pricing_updated" : "plan_pricing_reset",
      metadata: {
        planCode: selectedPlan.code,
        monthlyAmountCents,
        leadRateCents,
        includedCount: selectedPlan.includedCount,
        custom: nextIsCustom
      },
      createdByType: "admin",
      createdById: String(admin.id)
    });

    return res.status(200).json({
      ok: true,
      tenantKey,
      billing: {
        status: updatedRow.billing_status,
        stripeSubscriptionId: updatedRow.stripe_subscription_id || null,
        stripeSubscriptionDisplayId: pricing.subscriptionDisplayId,
        plan,
        pricing,
        override
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_tenant_pricing_error", message: err?.message || "unknown" });
  }
}
