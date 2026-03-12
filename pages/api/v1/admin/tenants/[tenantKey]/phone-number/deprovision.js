import { ensureTables, getPool } from "../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../_lib/auth.js";
import { releaseVoiceNumber } from "../../../../../_lib/telnyx.js";
import { parseProvisioningError, truncateText } from "../../../../../_lib/voiceProvisioning.js";

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
      `SELECT tenant_key, telnyx_voice_number
       FROM tenants
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    if (!tenantResult.rowCount) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    const phoneNumber = tenantResult.rows[0]?.telnyx_voice_number || null;
    if (!phoneNumber) {
      return res.status(409).json({
        error: "no_voice_number",
        message: "This tenant does not have a provisioned voice number."
      });
    }

    const runningJob = await pool.query(
      `INSERT INTO provisioning_jobs (tenant_key, stage, status, status_detail, provider, attempted_at, updated_at)
       VALUES ($1, 'admin_number_release', 'running', 'Releasing the current voice number.', 'telnyx', NOW(), NOW())
       RETURNING id`,
      [tenantKey]
    );
    const jobId = runningJob.rows[0]?.id || null;

    try {
      const releaseResult = await releaseVoiceNumber({ phoneNumber });
      await pool.query(
        `UPDATE tenants
         SET telnyx_voice_number = NULL,
             telnyx_voice_number_id = NULL,
             telnyx_voice_order_id = NULL,
             telnyx_voice_status = 'released',
             telnyx_voice_monthly_cost_cents = NULL,
             telnyx_voice_upfront_cost_cents = NULL,
             telnyx_voice_purchased_at = NULL,
             updated_at = NOW()
         WHERE tenant_key = $1`,
        [tenantKey]
      );
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
          [jobId, truncateText(`Released ${phoneNumber}.`), releaseResult?.data?.id || null]
        );
      }
      await pool.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, $2, 'admin.voice_number_deprovisioned', $3)`,
        [tenantKey, `admin:${admin.id}`, `provider=telnyx phone=${phoneNumber} release_job_id=${releaseResult?.data?.id || ""}`]
      );

      return res.status(200).json({
        ok: true,
        tenantKey,
        phoneNumber,
        releaseJobId: releaseResult?.data?.id || null
      });
    } catch (err) {
      const { errorCode, errorMessage } = parseProvisioningError(err);
      if (jobId) {
        await pool.query(
          `UPDATE provisioning_jobs
           SET status = 'failed',
               status_detail = 'Voice number deprovisioning failed.',
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
         VALUES ($1, $2, 'admin.voice_number_deprovision_failed', $3)`,
        [tenantKey, `admin:${admin.id}`, truncateText(`provider=telnyx code=${errorCode} message=${errorMessage}`, 800)]
      );
      return res.status(500).json({
        error: "admin_voice_number_deprovision_error",
        message: errorMessage || "Voice number deprovisioning failed."
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "admin_voice_number_deprovision_error", message: err?.message || "unknown" });
  }
}
