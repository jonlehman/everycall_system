import { findAvailableVoiceNumber, getOwnedPhoneNumber, orderVoiceNumber, updatePhoneNumberVoiceSettings } from "./telnyx.js";
import { normalizePhoneNumber } from "./phone.js";

export function truncateText(value, limit = 400) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function centsFromDollars(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
}

export function normalizeCallerIdName(value) {
  return String(value || "")
    .replace(/[^a-z0-9 ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15);
}

export function parseProvisioningError(err) {
  const raw = String(err?.message || err || "unknown_error").trim();
  if (raw.startsWith("telnyx_request_failed:")) {
    const [, status, ...rest] = raw.split(":");
    return {
      errorCode: `telnyx_request_failed_${status || "unknown"}`,
      errorMessage: truncateText(rest.join(":") || "Telnyx request failed.")
    };
  }
  if (raw === "TELNYX_VOICE_CONNECTION_ID missing") {
    return {
      errorCode: "missing_voice_connection_id",
      errorMessage: raw
    };
  }
  if (raw === "TELNYX_API_KEY missing") {
    return {
      errorCode: "missing_telnyx_api_key",
      errorMessage: raw
    };
  }
  return {
    errorCode: truncateText(raw.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase(), 80) || "provisioning_error",
    errorMessage: truncateText(raw)
  };
}

export function getVoiceProvisioningAreaCode(primaryNumber) {
  const normalized = normalizePhoneNumber(primaryNumber || null);
  const digits = String(normalized || "").replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits.slice(-10, -7) : null;
}

export async function provisionTenantVoiceNumber({
  pool,
  tenantKey,
  primaryNumber = null,
  callerIdName = "",
  actor = "system:onboard",
  stage = "number_setup",
  runningStatusDetail = "Searching for an available local voice number.",
  successAuditAction = "onboarding.voice_number_provisioned",
  failureAuditAction = "onboarding.voice_number_provision_failed"
} = {}) {
  const normalizedTenantKey = String(tenantKey || "").trim();
  if (!pool || !normalizedTenantKey) {
    return {
      ok: false,
      errorCode: "missing_fields",
      errorMessage: "Tenant key is required for voice provisioning."
    };
  }

  const tenantResult = await pool.query(
    `SELECT tenant_key, primary_number, telnyx_voice_number, telnyx_voice_number_id
     FROM tenants
     WHERE tenant_key = $1
     LIMIT 1`,
    [normalizedTenantKey]
  );
  if (!tenantResult.rowCount) {
    return {
      ok: false,
      errorCode: "tenant_not_found",
      errorMessage: "Tenant not found."
    };
  }

  const tenant = tenantResult.rows[0];
  const existingPhoneNumber = normalizePhoneNumber(tenant?.telnyx_voice_number);
  if (existingPhoneNumber) {
    return {
      ok: true,
      skipped: true,
      alreadyProvisioned: true,
      phoneNumber: existingPhoneNumber,
      phoneNumberId: String(tenant?.telnyx_voice_number_id || "").trim() || null,
      callerIdApplied: false
    };
  }

  const normalizedCallerIdName = normalizeCallerIdName(callerIdName);
  const runningJob = await pool.query(
    `INSERT INTO provisioning_jobs (tenant_key, stage, status, status_detail, provider, attempted_at, updated_at)
     VALUES ($1, $2, 'running', $3, 'telnyx', NOW(), NOW())
     RETURNING id`,
    [normalizedTenantKey, stage, truncateText(runningStatusDetail) || "Searching for an available local voice number."]
  );
  const jobId = runningJob.rows[0]?.id || null;

  try {
    const areaCode = getVoiceProvisioningAreaCode(primaryNumber || tenant.primary_number);
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
        [normalizedTenantKey]
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
         VALUES ($1, $2, $3, $4)`,
        [normalizedTenantKey, actor, failureAuditAction, "provider=telnyx code=no_available_number"]
      );
      return {
        ok: false,
        errorCode: "voice_number_unavailable",
        errorMessage: "No local voice number was available from Telnyx."
      };
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
        normalizedTenantKey,
        availableNumber.phoneNumber,
        phoneNumberId,
        voiceOrder?.data?.id || null,
        centsFromDollars(availableNumber.monthlyCost),
        centsFromDollars(availableNumber.upfrontCost)
      ]
    );

    let callerIdApplied = false;
    if (phoneNumberId && normalizedCallerIdName) {
      try {
        await updatePhoneNumberVoiceSettings({ phoneNumberId, callerIdName: normalizedCallerIdName });
        callerIdApplied = true;
      } catch (syncErr) {
        await pool.query(
          `INSERT INTO audit_log (tenant_key, actor, action, details)
           VALUES ($1, $2, $3, $4)`,
          [
            normalizedTenantKey,
            actor,
            `${successAuditAction}.caller_id_sync_failed`,
            truncateText(`provider=telnyx message=${syncErr instanceof Error ? syncErr.message : "unknown"}`, 800)
          ]
        );
      }
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
       VALUES ($1, $2, $3, $4)`,
      [
        normalizedTenantKey,
        actor,
        successAuditAction,
        truncateText(
          `provider=telnyx phone=${availableNumber.phoneNumber} phone_number_id=${phoneNumberId || ""} order_id=${voiceOrder?.data?.id || ""} caller_id_applied=${callerIdApplied ? "true" : "false"}`,
          800
        )
      ]
    );

    return {
      ok: true,
      phoneNumber: availableNumber.phoneNumber,
      phoneNumberId,
      orderId: voiceOrder?.data?.id || null,
      callerIdApplied
    };
  } catch (err) {
    const { errorCode, errorMessage } = parseProvisioningError(err);
    await pool.query(
      `UPDATE tenants
       SET telnyx_voice_status = 'failed',
           updated_at = NOW()
       WHERE tenant_key = $1`,
      [normalizedTenantKey]
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
       VALUES ($1, $2, $3, $4)`,
      [normalizedTenantKey, actor, failureAuditAction, truncateText(`provider=telnyx code=${errorCode} message=${errorMessage}`, 800)]
    );
    return {
      ok: false,
      errorCode,
      errorMessage: errorMessage || "Voice number provisioning failed."
    };
  }
}
