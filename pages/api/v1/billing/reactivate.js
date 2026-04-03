import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { ensureTenantBillingAccount, recordBillingLifecycleEvent, requireTenantOwner } from "../../_lib/billing.js";
import { findAvailableVoiceNumber, orderVoiceNumber } from "../../_lib/telnyx.js";

function addDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
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
      return res.status(403).json({ error: "forbidden", message: "Only the account owner can restart service." });
    }

    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || "default"));
    const row = await ensureTenantBillingAccount(pool, tenantKey);
    if (!row) {
      return res.status(404).json({ error: "tenant_not_found" });
    }
    if (row.billing_status !== "deactivated") {
      return res.status(400).json({
        error: "tenant_not_deactivated",
        message: "This account does not need self-serve reactivation."
      });
    }

    const connectionId = String(process.env.TELNYX_VOICE_CONNECTION_ID || "").trim();
    if (!connectionId) {
      return res.status(500).json({ error: "voice_connection_missing", message: "Telnyx voice connection is not configured." });
    }

    const availableNumber = await findAvailableVoiceNumber({});
    if (!availableNumber?.phoneNumber) {
      return res.status(500).json({ error: "voice_number_unavailable", message: "Could not find a replacement Sales Receptionist Number." });
    }

    await orderVoiceNumber({ phoneNumber: availableNumber.phoneNumber, connectionId });

    const recoveryTrialDays = Math.max(1, Number(process.env.SELF_SERVE_REACTIVATION_TRIAL_DAYS || 7));
    const trialStartedAt = new Date();
    const trialEnd = addDays(recoveryTrialDays);

    await pool.query(
      `UPDATE tenants
       SET billing_status = 'trialing',
           service_access_status = 'enabled',
           app_access_status = 'enabled',
           billing_lock_reason = NULL,
           deactivated_at = NULL,
           trial_started_at = $2,
           trial_end = $3,
           post_trial_access_ends_at = NULL,
           telnyx_voice_number = $4,
           telnyx_voice_monthly_cost_cents = $5,
           telnyx_voice_upfront_cost_cents = $6,
           telnyx_voice_purchased_at = NOW(),
           telnyx_voice_status = 'provisioning',
           billing_status_updated_at = NOW()
       WHERE tenant_key = $1`,
      [
        tenantKey,
        trialStartedAt.toISOString(),
        trialEnd.toISOString(),
        availableNumber.phoneNumber,
        Number.isFinite(Number(availableNumber.monthlyCost)) ? Math.round(Number(availableNumber.monthlyCost) * 100) : null,
        Number.isFinite(Number(availableNumber.upfrontCost)) ? Math.round(Number(availableNumber.upfrontCost) * 100) : null
      ]
    );

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, 'billing.self_serve_reactivated', $3)`,
      [tenantKey, `tenant:${session.user_id}`, `recovery_trial_days=${recoveryTrialDays} phone=${availableNumber.phoneNumber}`]
    );

    await recordBillingLifecycleEvent(pool, {
      tenantKey,
      eventType: "billing.self_serve_reactivated",
      fromBillingStatus: row.billing_status,
      toBillingStatus: "trialing",
      fromServiceAccessStatus: row.service_access_status,
      toServiceAccessStatus: "enabled",
      fromAppAccessStatus: row.app_access_status,
      toAppAccessStatus: "enabled",
      reason: "self_serve_reactivated_tenant",
      metadata: {
        recoveryTrialDays,
        newPhoneNumber: availableNumber.phoneNumber
      },
      createdByType: "tenant_owner",
      createdById: String(session.user_id)
    });

    return res.status(200).json({
      ok: true,
      tenantKey,
      trialEnd: trialEnd.toISOString(),
      phoneNumber: availableNumber.phoneNumber,
      message: `Service restarted. A new Sales Receptionist Number has been provisioned and trial access is open until ${trialEnd.toLocaleDateString("en-US")}.`
    });
  } catch (err) {
    return res.status(500).json({ error: "billing_reactivate_error", message: err?.message || "unknown" });
  }
}
