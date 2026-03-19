import { getPool } from "./db.js";

export const DEFAULT_PLAN_CODE = "growth";
export const DEFAULT_MONTHLY_AMOUNT_CENTS = Number(process.env.DEFAULT_PLAN_MONTHLY_AMOUNT_CENTS || "50000");
export const DEFAULT_STRIPE_PRODUCT_ID = String(process.env.STRIPE_DEFAULT_PRODUCT_ID || "").trim() || null;
export const DEFAULT_TRIAL_DAYS = Number(process.env.DEFAULT_TRIAL_DAYS || "30");

export async function requireActiveTenantUser(session) {
  const pool = getPool();
  if (!pool || !session?.user_id || session.role !== "tenant") {
    return null;
  }
  const result = await pool.query(
    `SELECT id, tenant_key, role, email, name, phone_number, status
     FROM tenant_users
     WHERE id = $1
     LIMIT 1`,
    [session.user_id]
  );
  const user = result.rows[0] || null;
  if (!user || user.status !== "active") {
    return null;
  }
  return user;
}

export async function requireTenantOwner(session) {
  const user = await requireActiveTenantUser(session);
  if (!user || user.role !== "owner") {
    return null;
  }
  return user;
}

export function resolveEffectiveMonthlyAmount(row) {
  const overrideAmount = Number(row?.monthly_amount_override_cents || 0);
  if (overrideAmount > 0) return overrideAmount;
  const baseAmount = Number(row?.monthly_amount_cents || 0);
  if (baseAmount > 0) return baseAmount;
  return DEFAULT_MONTHLY_AMOUNT_CENTS;
}

export async function getTenantBillingState(pool, tenantKey) {
  const result = await pool.query(
    `SELECT
       t.tenant_key,
       t.name,
       t.plan,
       t.plan_code,
       t.status,
       t.created_at,
       tu.name AS owner_name,
       tu.email AS owner_email,
       t.telnyx_voice_number,
       t.billing_status,
       t.trial_started_at,
       t.trial_end,
       t.post_trial_access_ends_at,
       t.billing_grace_ends_at,
       t.service_access_status,
       t.app_access_status,
       t.deactivated_at,
       t.billing_status_updated_at,
       t.billing_lock_reason,
       b.stripe_customer_id,
       b.stripe_subscription_id,
       b.stripe_product_id,
       b.stripe_price_id,
       b.monthly_amount_cents,
       b.monthly_amount_override_cents,
       b.price_override_reason,
       b.price_override_cycles_remaining,
       b.current_period_start,
       b.current_period_end,
       b.cancel_at_period_end,
       b.canceled_at,
       b.trial_end AS stripe_trial_end,
       b.last_invoice_id,
       b.updated_at AS billing_account_updated_at
     FROM tenants t
     LEFT JOIN tenant_billing_accounts b
       ON b.tenant_key = t.tenant_key
     LEFT JOIN LATERAL (
       SELECT name, email
       FROM tenant_users
       WHERE tenant_key = t.tenant_key
         AND role = 'owner'
       ORDER BY id ASC
       LIMIT 1
     ) tu ON TRUE
     WHERE t.tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return result.rows[0] || null;
}

export async function ensureTenantBillingAccount(pool, tenantKey, values = {}) {
  await pool.query(
    `UPDATE tenants
     SET trial_started_at = COALESCE(trial_started_at, created_at),
         trial_end = COALESCE(trial_end, created_at + ($2::text || ' days')::interval),
         billing_status_updated_at = COALESCE(billing_status_updated_at, NOW()),
         plan_code = COALESCE(plan_code, $3)
     WHERE tenant_key = $1`,
    [tenantKey, String(values.default_trial_days || DEFAULT_TRIAL_DAYS), values.plan_code || DEFAULT_PLAN_CODE]
  );
  await pool.query(
    `INSERT INTO tenant_billing_accounts (
       tenant_key,
       monthly_amount_cents,
       stripe_product_id,
       updated_at
     )
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET
       monthly_amount_cents = COALESCE(tenant_billing_accounts.monthly_amount_cents, EXCLUDED.monthly_amount_cents),
       stripe_product_id = COALESCE(tenant_billing_accounts.stripe_product_id, EXCLUDED.stripe_product_id),
       updated_at = NOW()`,
    [
      tenantKey,
      Number(values.monthly_amount_cents || DEFAULT_MONTHLY_AMOUNT_CENTS),
      values.stripe_product_id || DEFAULT_STRIPE_PRODUCT_ID
    ]
  );
  return getTenantBillingState(pool, tenantKey);
}

export function buildPlanDisplay(row) {
  return {
    code: row?.plan_code || DEFAULT_PLAN_CODE,
    legacyLabel: row?.plan || null,
    monthlyAmountCents: resolveEffectiveMonthlyAmount(row)
  };
}

export function computeTrialDaysRemaining(trialEnd) {
  if (!trialEnd) return null;
  const end = new Date(trialEnd).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function mapStripeSubscriptionToTenantState(subscriptionStatus, currentRow = {}) {
  const currentBillingStatus = String(currentRow?.billing_status || "");
  const currentServiceAccessStatus = String(currentRow?.service_access_status || "enabled");
  const currentAppAccessStatus = String(currentRow?.app_access_status || "enabled");

  if (subscriptionStatus === "trialing") {
    return {
      billingStatus: currentBillingStatus === "trial_expired" ? "trial_expired" : "trialing",
      serviceAccessStatus: "enabled",
      appAccessStatus: currentBillingStatus === "trial_expired" ? "billing_locked" : "enabled",
      billingLockReason: currentBillingStatus === "trial_expired" ? "trial_expired_unpaid" : null
    };
  }

  if (subscriptionStatus === "active") {
    return {
      billingStatus: "active",
      serviceAccessStatus: "enabled",
      appAccessStatus: "enabled",
      billingLockReason: null
    };
  }

  if (subscriptionStatus === "past_due") {
    return {
      billingStatus: "past_due",
      serviceAccessStatus: currentServiceAccessStatus || "enabled",
      appAccessStatus: currentAppAccessStatus || "enabled",
      billingLockReason: null
    };
  }

  if (subscriptionStatus === "unpaid") {
    return {
      billingStatus: "unpaid",
      serviceAccessStatus: "restricted",
      appAccessStatus: currentAppAccessStatus || "enabled",
      billingLockReason: null
    };
  }

  if (subscriptionStatus === "canceled" || subscriptionStatus === "incomplete_expired") {
    return {
      billingStatus: subscriptionStatus === "canceled" ? "canceled" : "incomplete_expired",
      serviceAccessStatus: "disabled",
      appAccessStatus: "billing_locked",
      billingLockReason: subscriptionStatus === "canceled" ? "subscription_canceled" : "subscription_incomplete_expired"
    };
  }

  if (subscriptionStatus === "incomplete") {
    return {
      billingStatus: "incomplete",
      serviceAccessStatus: "disabled",
      appAccessStatus: "billing_locked",
      billingLockReason: "subscription_incomplete"
    };
  }

  return {
    billingStatus: currentBillingStatus || "trialing",
    serviceAccessStatus: currentServiceAccessStatus,
    appAccessStatus: currentAppAccessStatus,
    billingLockReason: currentRow?.billing_lock_reason || null
  };
}

export async function syncTenantStripeSubscription(pool, tenantKey, currentRow, subscription, eventType = "stripe.sync") {
  if (!tenantKey || !subscription?.id) {
    return currentRow;
  }

  const item = subscription?.items?.data?.[0] || {};
  const mapped = mapStripeSubscriptionToTenantState(subscription.status, currentRow);

  await pool.query(
    `INSERT INTO tenant_billing_accounts (
       tenant_key,
       stripe_customer_id,
       stripe_subscription_id,
       stripe_product_id,
       stripe_price_id,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       canceled_at,
       trial_end,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, to_timestamp(NULLIF($6, 0)), to_timestamp(NULLIF($7, 0)), $8, $9, $10, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_product_id = EXCLUDED.stripe_product_id,
       stripe_price_id = EXCLUDED.stripe_price_id,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       canceled_at = EXCLUDED.canceled_at,
       trial_end = EXCLUDED.trial_end,
       updated_at = NOW()`,
    [
      tenantKey,
      subscription.customer ? String(subscription.customer) : null,
      subscription.id || null,
      item.price?.product ? String(item.price.product) : null,
      item.price?.id || null,
      subscription.current_period_start || 0,
      subscription.current_period_end || 0,
      Boolean(subscription.cancel_at_period_end),
      subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null
    ]
  );

  await pool.query(
    `UPDATE tenants
     SET billing_status = $2,
         service_access_status = $3,
         app_access_status = $4,
         billing_lock_reason = $5,
         billing_status_updated_at = NOW()
     WHERE tenant_key = $1`,
    [
      tenantKey,
      mapped.billingStatus,
      mapped.serviceAccessStatus,
      mapped.appAccessStatus,
      mapped.billingLockReason
    ]
  );

  if (
    currentRow?.billing_status !== mapped.billingStatus ||
    currentRow?.service_access_status !== mapped.serviceAccessStatus ||
    currentRow?.app_access_status !== mapped.appAccessStatus ||
    String(currentRow?.billing_lock_reason || "") !== String(mapped.billingLockReason || "")
  ) {
    await recordBillingLifecycleEvent(pool, {
      tenantKey,
      eventType,
      fromBillingStatus: currentRow?.billing_status || null,
      toBillingStatus: mapped.billingStatus,
      fromServiceAccessStatus: currentRow?.service_access_status || null,
      toServiceAccessStatus: mapped.serviceAccessStatus,
      fromAppAccessStatus: currentRow?.app_access_status || null,
      toAppAccessStatus: mapped.appAccessStatus,
      reason: `stripe_subscription_${subscription.status}`,
      metadata: {
        stripeSubscriptionId: subscription.id
      },
      createdByType: "stripe_sync",
      createdById: subscription.id
    });
  }

  return getTenantBillingState(pool, tenantKey);
}

export async function recordBillingLifecycleEvent(pool, {
  tenantKey,
  eventType,
  fromBillingStatus = null,
  toBillingStatus = null,
  fromServiceAccessStatus = null,
  toServiceAccessStatus = null,
  fromAppAccessStatus = null,
  toAppAccessStatus = null,
  reason = null,
  metadata = null,
  createdByType = "system",
  createdById = null
}) {
  await pool.query(
    `INSERT INTO billing_lifecycle_events (
       tenant_key,
       event_type,
       from_billing_status,
       to_billing_status,
       from_service_access_status,
       to_service_access_status,
       from_app_access_status,
       to_app_access_status,
       reason,
       metadata_json,
       created_by_type,
       created_by_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
    [
      tenantKey,
      eventType,
      fromBillingStatus,
      toBillingStatus,
      fromServiceAccessStatus,
      toServiceAccessStatus,
      fromAppAccessStatus,
      toAppAccessStatus,
      reason,
      metadata ? JSON.stringify(metadata) : null,
      createdByType,
      createdById
    ]
  );
}

export async function requireTenantBillingAccess(res, pool, session, tenantKey, options = {}) {
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  if (session.role === "admin") {
    return { allowed: true, reason: null };
  }

  const state = await getTenantBillingState(pool, tenantKey);
  if (!state) {
    res.status(404).json({ error: "tenant_not_found" });
    return null;
  }

  const allowBillingLocked = options.allowBillingLocked === true;
  const allowDeactivated = options.allowDeactivated === true;

  if (state.billing_status === "deactivated" && !allowDeactivated) {
    res.status(403).json({
      error: "account_deactivated",
      message: "Please email support@everycall.io to reactivate your account."
    });
    return null;
  }

  if (state.app_access_status === "billing_locked" && !allowBillingLocked) {
    res.status(402).json({
      error: "billing_locked",
      message: "Billing is required to access this area.",
      billingStatus: state.billing_status
    });
    return null;
  }

  return { allowed: true, reason: null, state };
}

export async function getAdminBillingReport(pool) {
  const rows = await pool.query(
    `SELECT
       t.tenant_key,
       t.name,
       t.billing_status,
       t.service_access_status,
       t.app_access_status,
       t.trial_end,
       t.post_trial_access_ends_at,
       t.telnyx_voice_number,
       nh_email.status AS email_status,
       nh_email.last_error_message AS email_error,
       nh_sms.status AS sms_status,
       nh_sms.last_error_message AS sms_error
     FROM tenants t
     LEFT JOIN LATERAL (
       SELECT status, last_error_message
       FROM notification_channel_health
       WHERE tenant_key = t.tenant_key AND channel = 'email'
       ORDER BY updated_at DESC
       LIMIT 1
     ) nh_email ON TRUE
     LEFT JOIN LATERAL (
       SELECT status, last_error_message
       FROM notification_channel_health
       WHERE tenant_key = t.tenant_key AND channel = 'sms'
       ORDER BY updated_at DESC
       LIMIT 1
     ) nh_sms ON TRUE
     WHERE
       (t.billing_status = 'trialing' AND t.trial_end IS NOT NULL AND t.trial_end <= NOW() + interval '7 days')
       OR
       (t.billing_status = 'trial_expired' AND t.post_trial_access_ends_at IS NOT NULL AND t.post_trial_access_ends_at <= NOW() + interval '7 days')
     ORDER BY COALESCE(t.trial_end, t.post_trial_access_ends_at) ASC`
  );
  return rows.rows;
}
