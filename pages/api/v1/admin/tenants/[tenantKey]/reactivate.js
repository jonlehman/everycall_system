import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import { recordBillingLifecycleEvent } from "../../../../_lib/billing.js";
import { findAvailableVoiceNumber, orderVoiceNumber } from "../../../../_lib/telnyx.js";

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

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = String(req.query?.tenantKey || "").trim();
    const body = typeof req.body === "object" && req.body ? req.body : {};
    const remainingTrialDays = Number(body.remainingTrialDays || 0);

    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }
    if (!Number.isInteger(remainingTrialDays) || remainingTrialDays <= 0) {
      return res.status(400).json({ error: "invalid_remaining_trial_days" });
    }

    const tenantRow = await pool.query(
      `SELECT tenant_key, billing_status, service_access_status, app_access_status
       FROM tenants
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    if (!tenantRow.rowCount) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    const connectionId = process.env.TELNYX_VOICE_CONNECTION_ID || "";
    const availableNumber = await findAvailableVoiceNumber({});
    if (!availableNumber || !connectionId) {
      return res.status(500).json({ error: "voice_number_unavailable" });
    }
    await orderVoiceNumber({ phoneNumber: availableNumber, connectionId });

    const trialStartedAt = new Date();
    const trialEnd = addDays(remainingTrialDays);

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
           billing_status_updated_at = NOW()
       WHERE tenant_key = $1`,
      [tenantKey, trialStartedAt.toISOString(), trialEnd.toISOString(), availableNumber]
    );

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, 'billing.reactivated', $3)`,
      [tenantKey, `admin:${admin.id}`, `remaining_trial_days=${remainingTrialDays} phone=${availableNumber}`]
    );

    const current = tenantRow.rows[0];
    await recordBillingLifecycleEvent(pool, {
      tenantKey,
      eventType: "billing.reactivated",
      fromBillingStatus: current.billing_status,
      toBillingStatus: "trialing",
      fromServiceAccessStatus: current.service_access_status,
      toServiceAccessStatus: "enabled",
      fromAppAccessStatus: current.app_access_status,
      toAppAccessStatus: "enabled",
      reason: "admin_reactivated_tenant",
      metadata: {
        remainingTrialDays,
        newPhoneNumber: availableNumber
      },
      createdByType: "admin",
      createdById: String(admin.id)
    });

    return res.status(200).json({
      ok: true,
      tenantKey,
      trialEnd: trialEnd.toISOString(),
      phoneNumber: availableNumber
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_reactivate_error", message: err?.message || "unknown" });
  }
}
