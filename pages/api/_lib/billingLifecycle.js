import { recordBillingLifecycleEvent } from "./billing.js";
import { refreshTenantCouponState, syncTenantCouponSubscriptionPricing } from "./billingCoupons.js";
import { finalizeDueBillingPeriods } from "./callBilling.js";
import { getSharedSmsNumber } from "./alerts.js";
import { sendTransactionalEmail } from "./mail.js";
import { sendTelnyxSms, releaseVoiceNumber } from "./telnyx.js";

const SUPPORT_REACTIVATION_MESSAGE = "Open Billing in EveryCall to restart service and reactivate your account.";

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDay(dateLike) {
  const d = new Date(dateLike);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addDays(dateLike, days) {
  const d = new Date(dateLike);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function wasLifecycleEventSentToday(pool, tenantKey, eventType, targetDay) {
  const result = await pool.query(
    `SELECT 1
     FROM billing_lifecycle_events
     WHERE tenant_key = $1
       AND event_type = $2
       AND metadata_json->>'target_day' = $3
     LIMIT 1`,
    [tenantKey, eventType, targetDay]
  );
  return result.rowCount > 0;
}

async function updateChannelHealth(pool, {
  tenantKey,
  channel,
  destination,
  status,
  errorCode = null,
  errorMessage = null
}) {
  const attemptedAt = new Date().toISOString();
  await pool.query(
    `INSERT INTO notification_channel_health (
       tenant_key,
       channel,
       destination,
       status,
       last_attempted_at,
       last_succeeded_at,
       last_failed_at,
       last_error_code,
       last_error_message,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5::timestamptz,
       CASE WHEN $4 = 'functioning' THEN $5::timestamptz ELSE NULL END,
       CASE WHEN $4 = 'non_functioning' THEN $5::timestamptz ELSE NULL END,
       $6, $7, NOW()
     )
     ON CONFLICT (tenant_key, channel, destination)
     DO UPDATE SET
       status = EXCLUDED.status,
       last_attempted_at = EXCLUDED.last_attempted_at,
       last_succeeded_at = CASE
         WHEN EXCLUDED.status = 'functioning' THEN EXCLUDED.last_attempted_at
         ELSE notification_channel_health.last_succeeded_at
       END,
       last_failed_at = CASE
         WHEN EXCLUDED.status = 'non_functioning' THEN EXCLUDED.last_attempted_at
         ELSE notification_channel_health.last_failed_at
       END,
       last_error_code = EXCLUDED.last_error_code,
       last_error_message = EXCLUDED.last_error_message,
       updated_at = NOW()`,
    [tenantKey, channel, destination, status, attemptedAt, errorCode, errorMessage]
  );
}

async function getTenantNotificationRecipients(pool, tenantKey) {
  const users = await pool.query(
    `SELECT email, phone_number, sms_opt_in_status
     FROM tenant_users
     WHERE tenant_key = $1
       AND status = 'active'`,
    [tenantKey]
  );
  const emailRecipients = [...new Set(users.rows.map((row) => String(row.email || "").trim().toLowerCase()).filter(Boolean))];
  const smsRecipients = [...new Set(
    users.rows
      .filter((row) => row.sms_opt_in_status === "opted_in")
      .map((row) => String(row.phone_number || "").trim())
      .filter(Boolean)
  )];
  return { emailRecipients, smsRecipients };
}

async function sendEmail(pool, { tenantKey, to, subject, text }) {
  if (!to) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "email",
      destination: "",
      status: "non_functioning",
      errorCode: "missing_destination",
      errorMessage: "Email destination missing"
    });
    return false;
  }
  try {
    await sendTransactionalEmail({ to, subject, text, category: "Billing Lifecycle" });
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "email",
      destination: to,
      status: "functioning"
    });
    return true;
  } catch (err) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "email",
      destination: to,
      status: "non_functioning",
      errorCode: "email_send_failed",
      errorMessage: err?.message || "unknown"
    });
    return false;
  }
}

async function sendSms(pool, { tenantKey, to, text }) {
  if (!to) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "sms",
      destination: "",
      status: "non_functioning",
      errorCode: "missing_destination",
      errorMessage: "SMS destination missing"
    });
    return false;
  }
  const from = await getSharedSmsNumber(pool);
  if (!from) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "sms",
      destination: to,
      status: "non_functioning",
      errorCode: "shared_sms_missing",
      errorMessage: "Shared SMS number is not configured"
    });
    return false;
  }
  try {
    await sendTelnyxSms({ from, to, text });
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "sms",
      destination: to,
      status: "functioning"
    });
    return true;
  } catch (err) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "sms",
      destination: to,
      status: "non_functioning",
      errorCode: "send_failed",
      errorMessage: err?.message || "unknown"
    });
    return false;
  }
}

async function sendToAllActiveChannels(pool, tenant, { subject, text, eventType, targetDay }) {
  const recipients = await getTenantNotificationRecipients(pool, tenant.tenant_key);
  for (const email of recipients.emailRecipients) {
    await sendEmail(pool, { tenantKey: tenant.tenant_key, to: email, subject, text });
  }
  for (const phone of recipients.smsRecipients) {
    await sendSms(pool, { tenantKey: tenant.tenant_key, to: phone, text });
  }
  await recordBillingLifecycleEvent(pool, {
    tenantKey: tenant.tenant_key,
    eventType,
    fromBillingStatus: tenant.billing_status,
    toBillingStatus: tenant.billing_status,
    fromServiceAccessStatus: tenant.service_access_status,
    toServiceAccessStatus: tenant.service_access_status,
    fromAppAccessStatus: tenant.app_access_status,
    toAppAccessStatus: tenant.app_access_status,
    reason: eventType,
    metadata: { target_day: targetDay },
    createdByType: "system"
  });
}

async function runTrialReminders(pool, today) {
  const targetDay = isoDay(today);
  const tenants = await pool.query(
    `SELECT tenant_key, name, billing_status, service_access_status, app_access_status, trial_end
     FROM tenants
     WHERE billing_status = 'trialing'
       AND trial_end IS NOT NULL`
  );
  let remindersSent = 0;

  for (const tenant of tenants.rows) {
    const trialDay = isoDay(tenant.trial_end);
    let reminderKey = null;
    if (isoDay(addDays(tenant.trial_end, -5)) === targetDay) reminderKey = "billing.trial_reminder_5d";
    if (isoDay(addDays(tenant.trial_end, -2)) === targetDay) reminderKey = "billing.trial_reminder_2d";
    if (trialDay === targetDay) reminderKey = "billing.trial_reminder_0d";
    if (!reminderKey) continue;
    if (await wasLifecycleEventSentToday(pool, tenant.tenant_key, reminderKey, targetDay)) continue;

    const daysLeft = Math.max(0, Math.ceil((new Date(tenant.trial_end).getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
    const subject = daysLeft > 0
      ? `Your EveryCall trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
      : "Your EveryCall trial ends today";
    const text = daysLeft > 0
      ? `Your EveryCall trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Add your payment method to keep your account active.`
      : "Your EveryCall trial ends today. Add your payment method to keep your account active.";

    await sendToAllActiveChannels(pool, tenant, {
      subject,
      text,
      eventType: reminderKey,
      targetDay
    });
    remindersSent += 1;
  }
  return remindersSent;
}

async function expireTrials(pool, today) {
  const tenants = await pool.query(
    `SELECT tenant_key, billing_status, service_access_status, app_access_status, trial_end
     FROM tenants
     WHERE billing_status = 'trialing'
       AND trial_end IS NOT NULL
       AND trial_end < $1`,
    [today.toISOString()]
  );
  let expired = 0;
  for (const tenant of tenants.rows) {
    await pool.query(
      `UPDATE tenants
       SET billing_status = 'trial_expired',
           service_access_status = 'enabled',
           app_access_status = 'billing_locked',
           billing_lock_reason = 'trial_expired_unpaid',
           post_trial_access_ends_at = COALESCE(post_trial_access_ends_at, trial_end + interval '30 days'),
           billing_status_updated_at = NOW()
       WHERE tenant_key = $1`,
      [tenant.tenant_key]
    );
    await recordBillingLifecycleEvent(pool, {
      tenantKey: tenant.tenant_key,
      eventType: "billing.trial_expired",
      fromBillingStatus: tenant.billing_status,
      toBillingStatus: "trial_expired",
      fromServiceAccessStatus: tenant.service_access_status,
      toServiceAccessStatus: "enabled",
      fromAppAccessStatus: tenant.app_access_status,
      toAppAccessStatus: "billing_locked",
      reason: "trial_end_passed",
      createdByType: "system"
    });
    expired += 1;
  }
  return expired;
}

async function runShutdownWarnings(pool, today) {
  const targetDay = isoDay(today);
  const tenants = await pool.query(
    `SELECT tenant_key, name, billing_status, service_access_status, app_access_status, post_trial_access_ends_at
     FROM tenants
     WHERE billing_status = 'trial_expired'
       AND post_trial_access_ends_at IS NOT NULL`
  );
  let warningsSent = 0;
  for (const tenant of tenants.rows) {
    if (isoDay(addDays(tenant.post_trial_access_ends_at, -5)) !== targetDay) continue;
    const eventType = "billing.post_trial_shutdown_warning_5d";
    if (await wasLifecycleEventSentToday(pool, tenant.tenant_key, eventType, targetDay)) continue;
    const subject = "Your EveryCall number will be disconnected in 5 days";
    const text = "Your EveryCall account is still unpaid. In 5 days, your phone number will be disconnected unless billing is activated.";
    await sendToAllActiveChannels(pool, tenant, { subject, text, eventType, targetDay });
    warningsSent += 1;
  }
  return warningsSent;
}

async function deactivateExpiredPostTrial(pool, today) {
  const tenants = await pool.query(
    `SELECT tenant_key, telnyx_voice_number, billing_status, service_access_status, app_access_status
     FROM tenants
     WHERE billing_status = 'trial_expired'
       AND post_trial_access_ends_at IS NOT NULL
       AND post_trial_access_ends_at < $1`,
    [today.toISOString()]
  );
  let deactivated = 0;
  for (const tenant of tenants.rows) {
    let releaseError = null;
    if (tenant.telnyx_voice_number) {
      try {
        await releaseVoiceNumber({ phoneNumber: tenant.telnyx_voice_number });
      } catch (err) {
        releaseError = err?.message || "unknown";
      }
    }

    await pool.query(
      `UPDATE tenants
       SET billing_status = 'deactivated',
           service_access_status = 'disabled',
           app_access_status = 'billing_locked',
           billing_lock_reason = 'post_trial_shutdown',
           deactivated_at = NOW(),
           telnyx_voice_number = NULL,
           telnyx_voice_number_id = NULL,
           telnyx_voice_order_id = NULL,
           telnyx_voice_status = CASE WHEN $2 IS NULL THEN 'released' ELSE telnyx_voice_status END,
           billing_status_updated_at = NOW()
       WHERE tenant_key = $1`,
      [tenant.tenant_key, releaseError]
    );

    await recordBillingLifecycleEvent(pool, {
      tenantKey: tenant.tenant_key,
      eventType: "billing.post_trial_shutdown_executed",
      fromBillingStatus: tenant.billing_status,
      toBillingStatus: "deactivated",
      fromServiceAccessStatus: tenant.service_access_status,
      toServiceAccessStatus: "disabled",
      fromAppAccessStatus: tenant.app_access_status,
      toAppAccessStatus: "billing_locked",
      reason: releaseError ? "number_release_failed_manual_followup_needed" : "post_trial_window_ended",
      metadata: {
        phone_release_error: releaseError,
        login_message: SUPPORT_REACTIVATION_MESSAGE
      },
      createdByType: "system"
    });

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, $3, $4)`,
      [
        tenant.tenant_key,
        "system",
        "billing.post_trial_shutdown_executed",
        releaseError ? `number_release_error=${releaseError}` : "number_released"
      ]
    );
    deactivated += 1;
  }
  return deactivated;
}

async function runCouponSync(pool) {
  const tenants = await pool.query(
    `SELECT tenant_key
     FROM tenant_billing_accounts
     WHERE active_coupon_redemption_id IS NOT NULL`
  );
  let syncedTenants = 0;
  for (const row of tenants.rows || []) {
    await refreshTenantCouponState(pool, row.tenant_key).catch(() => null);
    await syncTenantCouponSubscriptionPricing(pool, row.tenant_key).catch(() => null);
    syncedTenants += 1;
  }
  return syncedTenants;
}

export async function runBillingLifecycleJobs(pool) {
  const today = startOfTodayUtc();
  const couponSyncTenants = await runCouponSync(pool);
  const billingPeriods = await finalizeDueBillingPeriods(pool);
  const remindersSent = await runTrialReminders(pool, today);
  const trialsExpired = await expireTrials(pool, today);
  const shutdownWarningsSent = await runShutdownWarnings(pool, today);
  const postTrialDeactivated = await deactivateExpiredPostTrial(pool, today);

  return {
    couponSyncTenants,
    billingPeriods,
    remindersSent,
    trialsExpired,
    shutdownWarningsSent,
    postTrialDeactivated
  };
}
