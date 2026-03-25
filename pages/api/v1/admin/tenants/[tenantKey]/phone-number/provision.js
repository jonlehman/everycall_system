import { ensureTables, getPool } from "../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../_lib/auth.js";
import { findAvailableVoiceNumber, getOwnedPhoneNumber, orderVoiceNumber, updatePhoneNumberVoiceSettings } from "../../../../../_lib/telnyx.js";
import { getVoiceProvisioningAreaCode, parseProvisioningError, truncateText } from "../../../../../_lib/voiceProvisioning.js";

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
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const tenantResult = await pool.query(
      `SELECT tenant_key, primary_number, telnyx_voice_number
       FROM tenants
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    if (!tenantResult.rowCount) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    const tenant = tenantResult.rows[0];
    if (tenant.telnyx_voice_number) {
      return res.status(409).json({
        error: "voice_number_exists",
        message: "This tenant already has a provisioned voice number."
      });
    }

    const runningJob = await pool.query(
      `INSERT INTO provisioning_jobs (tenant_key, stage, status, status_detail, provider, attempted_at, updated_at)
       VALUES ($1, 'admin_number_setup', 'running', 'Searching for an available local voice number.', 'telnyx', NOW(), NOW())
       RETURNING id`,
      [tenantKey]
    );
    const jobId = runningJob.rows[0]?.id || null;

    try {
      const areaCode = getVoiceProvisioningAreaCode(tenant.primary_number);
      let availableNumber = await findAvailableVoiceNumber({ areaCode });
      if (!availableNumber) {
        availableNumber = await findAvailableVoiceNumber();
      }
      if (!availableNumber?.phoneNumber) {
        await pool.query(
          `UPDATE tenants
           SET telnyx_voice_status = 'unavailable',
               updated_at = NOW()
           WHERE tenant_key = $1`,
          [tenantKey]
        );
        if (jobId) {
          await pool.query(
            `UPDATE provisioning_jobs
             SET status = 'failed',
                 status_detail = 'No voice number was available to assign.',
                 provider = 'telnyx',
                 error_code = 'no_available_number',
                 error_message = 'No local voice number was available from Telnyx.',
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [jobId]
          );
        }
        await pool.query(
          `INSERT INTO audit_log (tenant_key, actor, action, details)
           VALUES ($1, $2, 'admin.voice_number_provision_failed', $3)`,
          [tenantKey, `admin:${admin.id}`, "provider=telnyx code=no_available_number"]
        );
        return res.status(503).json({
          error: "voice_number_unavailable",
          message: "No local voice number was available to assign."
        });
      }

      const connectionId = process.env.TELNYX_VOICE_CONNECTION_ID || "";
      const voiceOrder = await orderVoiceNumber({ phoneNumber: availableNumber.phoneNumber, connectionId });
      const ownedRecord = await getOwnedPhoneNumber({ phoneNumber: availableNumber.phoneNumber });
      const phoneNumberId = ownedRecord?.phoneNumberId || null;
      await pool.query(
        `UPDATE tenants
         SET telnyx_voice_number = $2,
             telnyx_voice_number_id = $3,
             telnyx_voice_order_id = $4,
             telnyx_voice_monthly_cost_cents = $5,
             telnyx_voice_upfront_cost_cents = $6,
             telnyx_voice_purchased_at = NOW(),
             telnyx_voice_status = 'active',
             updated_at = NOW()
         WHERE tenant_key = $1`,
        [
          tenantKey,
          availableNumber.phoneNumber,
          phoneNumberId,
          voiceOrder?.data?.id || null,
          Number.isFinite(Number(availableNumber.monthlyCost)) ? Math.round(Number(availableNumber.monthlyCost) * 100) : null,
          Number.isFinite(Number(availableNumber.upfrontCost)) ? Math.round(Number(availableNumber.upfrontCost) * 100) : null
        ]
      );
      let callerIdApplied = false;
      try {
        const settingsResult = await pool.query(
          `SELECT caller_id_name
           FROM tenant_settings
           WHERE tenant_key = $1
           LIMIT 1`,
          [tenantKey]
        );
        const callerIdName = String(settingsResult.rows[0]?.caller_id_name || "").trim();
        if (phoneNumberId && callerIdName) {
          await updatePhoneNumberVoiceSettings({ phoneNumberId, callerIdName });
          callerIdApplied = true;
        }
      } catch (syncErr) {
        await pool.query(
          `INSERT INTO audit_log (tenant_key, actor, action, details)
           VALUES ($1, $2, 'admin.voice_number_caller_id_sync_failed', $3)`,
          [
            tenantKey,
            `admin:${admin.id}`,
            truncateText(`provider=telnyx message=${syncErr instanceof Error ? syncErr.message : "unknown"}`, 800)
          ]
        );
      }
      if (jobId) {
        await pool.query(
          `UPDATE provisioning_jobs
           SET status = 'done',
               status_detail = $2,
               provider = 'telnyx',
               provider_reference = $3,
               error_code = NULL,
               error_message = NULL,
               completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [jobId, truncateText(`Provisioned ${availableNumber.phoneNumber}.`), voiceOrder?.data?.id || null]
        );
      }
      await pool.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, $2, 'admin.voice_number_provisioned', $3)`,
        [
          tenantKey,
          `admin:${admin.id}`,
          `provider=telnyx phone=${availableNumber.phoneNumber} phone_number_id=${phoneNumberId || ""} order_id=${voiceOrder?.data?.id || ""} caller_id_applied=${callerIdApplied ? "true" : "false"}`
        ]
      );

      return res.status(200).json({
        ok: true,
        tenantKey,
        phoneNumber: availableNumber.phoneNumber,
        phoneNumberId,
        orderId: voiceOrder?.data?.id || null,
        callerIdApplied
      });
    } catch (err) {
      const { errorCode, errorMessage } = parseProvisioningError(err);
      await pool.query(
        `UPDATE tenants
         SET telnyx_voice_status = 'failed',
             updated_at = NOW()
         WHERE tenant_key = $1`,
        [tenantKey]
      );
      if (jobId) {
        await pool.query(
          `UPDATE provisioning_jobs
           SET status = 'failed',
               status_detail = 'Voice number provisioning failed.',
               provider = 'telnyx',
               error_code = $2,
               error_message = $3,
               completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [jobId, errorCode, errorMessage]
        );
      }
      await pool.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, $2, 'admin.voice_number_provision_failed', $3)`,
        [tenantKey, `admin:${admin.id}`, truncateText(`provider=telnyx code=${errorCode} message=${errorMessage}`, 800)]
      );
      return res.status(500).json({
        error: "admin_voice_number_provision_error",
        message: errorMessage || "Voice number provisioning failed."
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "admin_voice_number_provision_error", message: err?.message || "unknown" });
  }
}
