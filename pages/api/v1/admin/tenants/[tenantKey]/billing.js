import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import {
  buildAdminPricingState,
  buildPlanDisplay,
  buildPricingOverride,
  computeTrialDaysRemaining,
  ensureTenantBillingAccount,
  getSystemBillingConfig
} from "../../../../_lib/billing.js";
import { syncCurrentBillingPeriod } from "../../../../_lib/callBilling.js";

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

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = String(req.query?.tenantKey || "").trim();
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const row = await ensureTenantBillingAccount(pool, tenantKey);
    if (!row) {
      return res.status(404).json({ error: "tenant_not_found" });
    }
    const billingConfig = await getSystemBillingConfig(pool);
    const plan = buildPlanDisplay(row, billingConfig);
    const pricing = buildAdminPricingState(row, billingConfig);
    const currentBillingPeriod = await syncCurrentBillingPeriod(pool, tenantKey).catch(() => null);

    const lifecycle = await pool.query(
      `SELECT event_type, from_billing_status, to_billing_status, reason, created_by_type, created_at
       FROM billing_lifecycle_events
       WHERE tenant_key = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [tenantKey]
    );

    const webhooks = await pool.query(
      `SELECT stripe_event_id, event_type, status, error_message, processed_at
       FROM billing_events
       WHERE tenant_key = $1 OR tenant_key IS NULL
       ORDER BY processed_at DESC NULLS LAST, id DESC
       LIMIT 20`,
      [tenantKey]
    );

    const channelHealth = await pool.query(
      `SELECT channel, destination, status, last_attempted_at, last_succeeded_at, last_failed_at, last_error_code, last_error_message
       FROM notification_channel_health
       WHERE tenant_key = $1
       ORDER BY updated_at DESC`,
      [tenantKey]
    );

    const smsFailovers = await pool.query(
      `SELECT destination, provider_event_id, provider_message_id, reason, created_at
       FROM sms_failover_events
       WHERE tenant_key = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [tenantKey]
    );

    return res.status(200).json({
      ok: true,
      tenantKey,
      billing: {
        status: row.billing_status,
        serviceAccessStatus: row.service_access_status,
        appAccessStatus: row.app_access_status,
        lockReason: row.billing_lock_reason || null,
        trialStartedAt: row.trial_started_at,
        trialEnd: row.trial_end,
        trialDaysRemaining: computeTrialDaysRemaining(row.trial_end),
        postTrialAccessEndsAt: row.post_trial_access_ends_at,
        billingGraceEndsAt: row.billing_grace_ends_at,
        deactivatedAt: row.deactivated_at,
        stripeCustomerId: row.stripe_customer_id || null,
        stripeSubscriptionId: row.stripe_subscription_id || null,
        stripeProductId: row.stripe_product_id || null,
        stripePriceId: row.stripe_price_id || null,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        canceledAt: row.canceled_at,
        stripeSubscriptionDisplayId: pricing.subscriptionDisplayId,
        plan,
        pricing,
        override: buildPricingOverride(row),
        currentBillingPeriod
      },
      pricingCatalog: {
        defaultTrialDays: pricing.defaultTrialDays,
        plans: pricing.availablePlans
      },
      channelHealth: channelHealth.rows,
      smsFailovers: smsFailovers.rows,
      lifecycleEvents: lifecycle.rows,
      webhookEvents: webhooks.rows
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_tenant_billing_error", message: err?.message || "unknown" });
  }
}
