import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { buildPlanDisplay, computeTrialDaysRemaining, ensureTenantBillingAccount, requireActiveTenantUser, requireTenantOwner, syncTenantStripeSubscription } from "../../_lib/billing.js";
import { findCurrentSubscriptionForCustomer, findCurrentSubscriptionForTenantKey, retrieveSubscription } from "../../_lib/stripe.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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
    const activeUser = session.role === "tenant" ? await requireActiveTenantUser(session) : null;
    if (session.role === "tenant" && !activeUser) {
      return res.status(403).json({ error: "forbidden" });
    }
    const owner = session.role === "tenant" ? await requireTenantOwner(session) : null;

    const tenantKey = resolveTenantKey(session, getTenantKey(req));
    let row = await ensureTenantBillingAccount(pool, tenantKey);
    if (!row) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    const stripeSubscription = row.stripe_subscription_id
      ? await retrieveSubscription(row.stripe_subscription_id).catch(() => null)
      : await findCurrentSubscriptionForCustomer(row.stripe_customer_id).catch(() => null);
    const tenantSubscription = stripeSubscription || await findCurrentSubscriptionForTenantKey(tenantKey).catch(() => null);
    if (tenantSubscription) {
      row = await syncTenantStripeSubscription(pool, tenantKey, row, tenantSubscription, "billing.summary.sync");
    }

    const invoices = row.last_invoice_id ? [{ id: row.last_invoice_id }] : [];

    return res.status(200).json({
      ok: true,
      tenantKey,
      billing: {
        status: row.billing_status,
        serviceAccessStatus: row.service_access_status,
        appAccessStatus: row.app_access_status,
        lockReason: row.billing_lock_reason || null,
        stripeCustomerId: row.stripe_customer_id || null,
        stripeSubscriptionId: row.stripe_subscription_id || null,
        trialStartedAt: row.trial_started_at,
        trialEnd: row.trial_end,
        trialDaysRemaining: computeTrialDaysRemaining(row.trial_end),
        postTrialAccessEndsAt: row.post_trial_access_ends_at,
        billingGraceEndsAt: row.billing_grace_ends_at,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        canceledAt: row.canceled_at,
        plan: buildPlanDisplay(row),
        override: row.monthly_amount_override_cents
          ? {
              amountCents: Number(row.monthly_amount_override_cents),
              reason: row.price_override_reason || null,
              cyclesRemaining: row.price_override_cycles_remaining
            }
          : null,
        invoices
      },
      viewer: {
        role: session.role,
        canManage: Boolean(owner),
        userRole: activeUser?.role || null
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "billing_summary_error", message: err?.message || "unknown" });
  }
}
