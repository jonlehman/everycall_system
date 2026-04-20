import { ensureTables, getPool } from "../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../_lib/auth.js";
import { ensureTenantBillingAccount, recordBillingLifecycleEvent } from "../../../../../_lib/billing.js";
import {
  findCurrentSubscriptionForCustomer,
  findCurrentSubscriptionForTenantKey,
  retrieveSubscription,
  updateSubscriptionTrialEnd
} from "../../../../../_lib/stripe.js";
import { findAvailableVoiceNumber, orderVoiceNumber } from "../../../../../_lib/telnyx.js";

const DEMO_EXTENSION_STATUSES = new Set(["trialing", "trial_expired", "deactivated"]);
const CURRENT_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "unpaid", "incomplete"]);

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function toTimestamp(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function findCurrentStripeSubscription(row, tenantKey) {
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

  if (!subscription) return null;
  const normalizedStatus = String(subscription.status || "").trim().toLowerCase();
  if (!CURRENT_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
    return null;
  }
  return subscription;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const pool = getPool();
  if (!pool) {
    return res.status(500).json({ error: "database_unavailable" });
  }

  let provisionedNumber = null;

  try {
    await ensureTables(pool);

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = String(req.query?.tenantKey || "").trim();
    const body = typeof req.body === "object" && req.body ? req.body : {};
    const additionalDays = normalizePositiveInteger(body.additionalDays);

    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }
    if (!additionalDays) {
      return res.status(400).json({ error: "invalid_additional_days", message: "Enter a whole number of demo days to add." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const current = await ensureTenantBillingAccount(client, tenantKey);
      if (!current) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "tenant_not_found" });
      }

      const currentStatus = String(current.billing_status || "").trim().toLowerCase();
      if (!DEMO_EXTENSION_STATUSES.has(currentStatus)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "demo_extension_not_allowed",
          message: "Demo extension is only available for trialing, trial-expired, or deactivated tenants."
        });
      }

      let subscription = await findCurrentStripeSubscription(current, tenantKey);
      const subscriptionStatus = String(subscription?.status || "").trim().toLowerCase();
      if (subscription && subscriptionStatus !== "trialing") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "paid_subscription_exists",
          message: "This tenant already has a non-trial Stripe subscription. Extend billing directly instead of extending the demo."
        });
      }

      if (currentStatus === "deactivated" && !current.telnyx_voice_number) {
        const connectionId = String(process.env.TELNYX_VOICE_CONNECTION_ID || "").trim();
        if (!connectionId) {
          await client.query("ROLLBACK");
          return res.status(500).json({
            error: "voice_connection_missing",
            message: "Telnyx voice connection is not configured."
          });
        }
        const availableNumber = await findAvailableVoiceNumber({});
        if (!availableNumber?.phoneNumber) {
          await client.query("ROLLBACK");
          return res.status(500).json({
            error: "voice_number_unavailable",
            message: "Could not find a replacement Sales Receptionist Number."
          });
        }
        await orderVoiceNumber({ phoneNumber: availableNumber.phoneNumber, connectionId });
        provisionedNumber = availableNumber;
      }

      const now = new Date();
      const nowMs = now.getTime();
      const currentTrialEndMs = toTimestamp(current.trial_end);
      const stripeTrialEndMs = Number(subscription?.trial_end || 0) > 0
        ? Number(subscription.trial_end) * 1000
        : 0;
      const anchorMs = Math.max(nowMs, currentTrialEndMs, stripeTrialEndMs);
      const nextTrialEnd = addDays(new Date(anchorMs), additionalDays);
      const reopenFromExpiredState = currentStatus !== "trialing" || currentTrialEndMs <= nowMs;
      const nextTrialStartedAt = reopenFromExpiredState
        ? now.toISOString()
        : (current.trial_started_at || now.toISOString());

      if (subscriptionStatus === "trialing") {
        subscription = await updateSubscriptionTrialEnd(subscription.id, nextTrialEnd.toISOString());
        await client.query(
          `UPDATE tenant_billing_accounts
           SET stripe_customer_id = COALESCE($2, stripe_customer_id),
               stripe_subscription_id = COALESCE($3, stripe_subscription_id),
               trial_end = $4,
               current_period_start = COALESCE(to_timestamp(NULLIF($5, 0)), current_period_start),
               current_period_end = COALESCE(to_timestamp(NULLIF($6, 0)), current_period_end),
               cancel_at_period_end = $7,
               canceled_at = $8,
               updated_at = NOW()
           WHERE tenant_key = $1`,
          [
            tenantKey,
            subscription.customer ? String(subscription.customer) : null,
            subscription.id || null,
            subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : nextTrialEnd.toISOString(),
            Number(subscription.current_period_start || 0),
            Number(subscription.current_period_end || 0),
            Boolean(subscription.cancel_at_period_end),
            subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null
          ]
        );
      }

      await client.query(
        `UPDATE tenants
         SET trial_started_at = $2,
             trial_end = $3,
             billing_status = 'trialing',
             service_access_status = 'enabled',
             app_access_status = 'enabled',
             billing_lock_reason = NULL,
             post_trial_access_ends_at = NULL,
             billing_grace_ends_at = NULL,
             deactivated_at = NULL,
             telnyx_voice_number = COALESCE($4, telnyx_voice_number),
             telnyx_voice_monthly_cost_cents = COALESCE($5, telnyx_voice_monthly_cost_cents),
             telnyx_voice_upfront_cost_cents = COALESCE($6, telnyx_voice_upfront_cost_cents),
             telnyx_voice_purchased_at = CASE WHEN $4 IS NULL THEN telnyx_voice_purchased_at ELSE NOW() END,
             telnyx_voice_status = CASE WHEN $4 IS NULL THEN telnyx_voice_status ELSE 'provisioning' END,
             billing_status_updated_at = NOW()
         WHERE tenant_key = $1`,
        [
          tenantKey,
          nextTrialStartedAt,
          nextTrialEnd.toISOString(),
          provisionedNumber?.phoneNumber || null,
          Number.isFinite(Number(provisionedNumber?.monthlyCost)) ? Math.round(Number(provisionedNumber.monthlyCost) * 100) : null,
          Number.isFinite(Number(provisionedNumber?.upfrontCost)) ? Math.round(Number(provisionedNumber.upfrontCost) * 100) : null
        ]
      );

      await client.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, $2, 'billing.demo.extended', $3)`,
        [
          tenantKey,
          `admin:${admin.id}`,
          `additional_days=${additionalDays} previous_trial_end=${current.trial_end || ""} next_trial_end=${nextTrialEnd.toISOString()} provisioned_phone=${provisionedNumber?.phoneNumber || ""} stripe_trial_extended=${subscriptionStatus === "trialing"}`
        ]
      );

      await recordBillingLifecycleEvent(client, {
        tenantKey,
        eventType: "billing.demo.extended",
        fromBillingStatus: current.billing_status || null,
        toBillingStatus: "trialing",
        fromServiceAccessStatus: current.service_access_status || null,
        toServiceAccessStatus: "enabled",
        fromAppAccessStatus: current.app_access_status || null,
        toAppAccessStatus: "enabled",
        reason: reopenFromExpiredState ? "trial_reopened_by_admin" : "trial_extended_by_admin",
        metadata: {
          additionalDays,
          previousTrialEnd: current.trial_end || null,
          nextTrialEnd: nextTrialEnd.toISOString(),
          stripeTrialExtended: subscriptionStatus === "trialing",
          provisionedPhoneNumber: provisionedNumber?.phoneNumber || null
        },
        createdByType: "admin",
        createdById: String(admin.id)
      });

      await client.query("COMMIT");

      return res.status(200).json({
        ok: true,
        tenantKey,
        trialStartedAt: nextTrialStartedAt,
        trialEnd: nextTrialEnd.toISOString(),
        provisionedPhoneNumber: provisionedNumber?.phoneNumber || null,
        message: reopenFromExpiredState
          ? `Demo reopened through ${nextTrialEnd.toLocaleDateString("en-US")}.`
          : `Demo extended through ${nextTrialEnd.toLocaleDateString("en-US")}.`
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({
      error: "admin_tenant_extend_demo_error",
      message: err?.message || "unknown"
    });
  }
}
