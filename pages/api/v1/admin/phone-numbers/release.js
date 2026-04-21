import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";
import { getOwnedPhoneNumber, releaseVoiceNumber } from "../../../_lib/telnyx.js";
import { normalizePhoneNumber } from "../../../_lib/phone.js";
import { parseProvisioningError, truncateText } from "../../../_lib/voiceProvisioning.js";

function normalizeText(value) {
  return String(value || "").trim();
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

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const phoneNumber = normalizePhoneNumber(body.phoneNumber || body.phone_number);
    if (!phoneNumber) {
      return res.status(400).json({
        error: "missing_phone_number",
        message: "A phone number is required."
      });
    }

    const tenantResult = await pool.query(
      `SELECT tenant_key, name
       FROM tenants
       WHERE telnyx_voice_number = $1
       LIMIT 1`,
      [phoneNumber]
    );
    if (tenantResult.rowCount) {
      const tenant = tenantResult.rows[0] || {};
      return res.status(409).json({
        error: "phone_number_assigned",
        message: `This number is still assigned to tenant ${tenant.name || tenant.tenant_key || "unknown"}.`,
        tenantKey: tenant.tenant_key || null
      });
    }

    const ownedRecord = await getOwnedPhoneNumber({ phoneNumber });
    if (!ownedRecord?.phoneNumber) {
      return res.status(404).json({
        error: "phone_number_not_found",
        message: "This phone number is not currently owned in Telnyx."
      });
    }

    try {
      const releaseResult = await releaseVoiceNumber({ phoneNumber });
      await pool.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, $2, 'admin.unassigned_voice_number_released', $3)`,
        [
          null,
          `admin:${admin.id}`,
          truncateText(
            `provider=telnyx phone=${phoneNumber} phone_number_id=${ownedRecord.phoneNumberId || ""} release_job_id=${releaseResult?.data?.id || ""}`,
            800
          )
        ]
      );

      return res.status(200).json({
        ok: true,
        phoneNumber,
        releaseJobId: releaseResult?.data?.id || null
      });
    } catch (err) {
      const { errorCode, errorMessage } = parseProvisioningError(err);
      await pool.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, $2, 'admin.unassigned_voice_number_release_failed', $3)`,
        [
          null,
          `admin:${admin.id}`,
          truncateText(`provider=telnyx phone=${phoneNumber} code=${errorCode} message=${normalizeText(errorMessage)}`, 800)
        ]
      );
      return res.status(500).json({
        error: "admin_unassigned_voice_number_release_error",
        message: errorMessage || "Voice number release failed."
      });
    }
  } catch (err) {
    return res.status(500).json({
      error: "admin_unassigned_voice_number_release_error",
      message: err?.message || "unknown"
    });
  }
}
