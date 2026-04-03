import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import {
  buildPricingOverride,
  buildPlanDisplay,
  computeTrialDaysRemaining,
  ensureTenantBillingAccount,
  getSystemBillingConfig,
  requireActiveTenantUser,
  requireTenantOwner,
  resolveEffectiveLeadPricing,
  syncTenantStripeSubscription
} from "../../_lib/billing.js";
import { findCurrentSubscriptionForCustomer, findCurrentSubscriptionForTenantKey, retrieveSubscription } from "../../_lib/stripe.js";
import { computeLeadInvoiceEstimate, resolveBillingWindow } from "../../../../lib/leadBilling.js";

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
    const billingConfig = await getSystemBillingConfig(pool);

    let stripeSubscription = null;
    let stripeSubscriptionSource = "none";
    let stripeLookupError = null;

    try {
      if (row.stripe_subscription_id) {
        stripeSubscription = await retrieveSubscription(row.stripe_subscription_id);
        stripeSubscriptionSource = "stored_subscription_id";
      } else if (row.stripe_customer_id) {
        stripeSubscription = await findCurrentSubscriptionForCustomer(row.stripe_customer_id);
        stripeSubscriptionSource = stripeSubscription ? "customer_lookup" : "customer_lookup_empty";
      }
    } catch (error) {
      stripeLookupError = error?.message || "unknown";
    }

    let tenantSubscription = stripeSubscription;
    if (!tenantSubscription) {
      try {
        tenantSubscription = await findCurrentSubscriptionForTenantKey(tenantKey);
        if (tenantSubscription) {
          stripeSubscriptionSource = "tenant_key_lookup";
        } else if (stripeSubscriptionSource === "none") {
          stripeSubscriptionSource = "tenant_key_lookup_empty";
        }
      } catch (error) {
        stripeLookupError = `${stripeLookupError ? `${stripeLookupError};` : ""}${error?.message || "unknown"}`;
      }
    }

    console.info("billing_summary_stripe_lookup", {
      tenantKey,
      storedStripeCustomerId: row.stripe_customer_id || null,
      storedStripeSubscriptionId: row.stripe_subscription_id || null,
      source: stripeSubscriptionSource,
      foundSubscriptionId: tenantSubscription?.id || null,
      foundSubscriptionStatus: tenantSubscription?.status || null,
      stripeLookupError
    });
    if (tenantSubscription) {
      row = await syncTenantStripeSubscription(pool, tenantKey, row, tenantSubscription, "billing.summary.sync");
    }

    const invoices = row.last_invoice_id ? [{ id: row.last_invoice_id }] : [];
    const billingWindow = resolveBillingWindow({
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end
    });
    const leadPricing = resolveEffectiveLeadPricing(row, billingConfig);
    const [leadSummaryResult, leadRowsResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE c.lead_is_valid = TRUE)::int AS valid_lead_count,
           COUNT(*) FILTER (WHERE c.lead_is_billable = TRUE)::int AS billable_lead_count,
           COUNT(*) FILTER (WHERE c.lead_is_valid = FALSE)::int AS non_lead_count,
           COUNT(*) FILTER (WHERE c.status IN ('new', 'contacted', 'in_progress'))::int AS open_follow_up_count
         FROM calls c
         WHERE c.tenant_key = $1
           AND c.created_at >= $2
           AND c.created_at < $3`,
        [tenantKey, billingWindow.start.toISOString(), billingWindow.end.toISOString()]
      ),
      pool.query(
        `SELECT
           c.call_sid,
           c.created_at,
           c.summary,
           c.status,
           c.lead_outcome_type,
           c.lead_is_valid,
           c.lead_is_billable,
           c.lead_decision_reason,
           d.caller_first_name,
           d.caller_last_name,
           d.callback_number,
           d.service_required
         FROM calls c
         LEFT JOIN call_details d ON d.call_sid = c.call_sid
         WHERE c.tenant_key = $1
           AND c.created_at >= $2
           AND c.created_at < $3
         ORDER BY c.created_at DESC
         LIMIT 25`,
        [tenantKey, billingWindow.start.toISOString(), billingWindow.end.toISOString()]
      )
    ]);
    const leadSummary = leadSummaryResult.rows[0] || {};
    const invoiceEstimate = computeLeadInvoiceEstimate({
      baseAmountCents: buildPlanDisplay(row, billingConfig).monthlyAmountCents,
      billableLeadCount: Number(leadSummary.billable_lead_count || 0)
    }, leadPricing);

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
        plan: buildPlanDisplay(row, billingConfig),
        currentPeriod: {
          label: billingWindow.label,
          start: billingWindow.start.toISOString(),
          end: billingWindow.end.toISOString()
        },
        leadPricing,
        leadUsage: {
          validLeadCount: Number(leadSummary.valid_lead_count || 0),
          billableLeadCount: Number(leadSummary.billable_lead_count || 0),
          nonLeadCount: Number(leadSummary.non_lead_count || 0),
          openFollowUpCount: Number(leadSummary.open_follow_up_count || 0),
          recentCalls: leadRowsResult.rows || []
        },
        invoiceEstimate,
        override: buildPricingOverride(row),
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
