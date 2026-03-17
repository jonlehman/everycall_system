import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";
import {
  getOwnedPhoneNumber,
  getPhoneNumberDetails,
  updatePhoneNumberRouting
} from "../../../_lib/telnyx.js";
import { normalizePhoneNumber } from "../../../_lib/phone.js";
import { parseProvisioningError, truncateText } from "../../../_lib/voiceProvisioning.js";

class HttpError extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function centsFromDollars(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let jobId = null;
  let tenantKey = "";
  let phoneNumber = "";
  let telnyxPhoneNumber = null;
  let routingUpdated = false;

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    tenantKey = normalizeText(body.tenantKey);
    phoneNumber = normalizePhoneNumber(body.phoneNumber);

    if (!tenantKey || !phoneNumber) {
      throw new HttpError(400, "missing_fields", "Tenant and phone number are required.");
    }

    const connectionId = normalizeText(process.env.TELNYX_VOICE_CONNECTION_ID);
    if (!connectionId) {
      throw new Error("TELNYX_VOICE_CONNECTION_ID missing");
    }

    const tenantResult = await pool.query(
      `SELECT tenant_key, name, telnyx_voice_number
       FROM tenants
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    if (!tenantResult.rowCount) {
      throw new HttpError(404, "tenant_not_found", "Tenant not found.");
    }
    if (normalizeText(tenantResult.rows[0]?.telnyx_voice_number)) {
      throw new HttpError(409, "tenant_already_has_number", "This tenant already has a voice number.");
    }

    const claimedResult = await pool.query(
      `SELECT tenant_key
       FROM tenants
       WHERE telnyx_voice_number = $1
       LIMIT 1`,
      [phoneNumber]
    );
    if (claimedResult.rowCount) {
      throw new HttpError(409, "phone_number_already_claimed", "This number is already assigned to another tenant.");
    }

    const runningJob = await pool.query(
      `INSERT INTO provisioning_jobs (tenant_key, stage, status, status_detail, provider, attempted_at, updated_at)
       VALUES ($1, 'admin_number_assign_existing', 'running', 'Assigning an existing owned voice number.', 'telnyx', NOW(), NOW())
       RETURNING id`,
      [tenantKey]
    );
    jobId = runningJob.rows[0]?.id || null;

    const ownedRecord = await getOwnedPhoneNumber({ phoneNumber });
    if (!ownedRecord?.phoneNumberId) {
      throw new HttpError(404, "phone_number_not_found", "This phone number is no longer present in Telnyx inventory.");
    }

    telnyxPhoneNumber = await getPhoneNumberDetails({ phoneNumberId: ownedRecord.phoneNumberId });
    if (!telnyxPhoneNumber?.phoneNumberId) {
      throw new HttpError(404, "phone_number_not_found", "Could not load live Telnyx details for this phone number.");
    }

    if (normalizePhoneNumber(telnyxPhoneNumber.phoneNumber) !== phoneNumber) {
      throw new HttpError(409, "phone_number_lookup_mismatch", "Live Telnyx data did not match the selected phone number.");
    }

    if (normalizeText(telnyxPhoneNumber.connectionId) !== connectionId) {
      await updatePhoneNumberRouting({
        phoneNumberId: telnyxPhoneNumber.phoneNumberId,
        connectionId
      });
      routingUpdated = true;
      telnyxPhoneNumber = await getPhoneNumberDetails({ phoneNumberId: telnyxPhoneNumber.phoneNumberId });
      if (normalizeText(telnyxPhoneNumber?.connectionId) !== connectionId) {
        throw new HttpError(
          502,
          "phone_number_routing_verification_failed",
          "The number could not be attached to the configured Telnyx voice connection."
        );
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const lockedTenant = await client.query(
        `SELECT tenant_key, name, telnyx_voice_number
         FROM tenants
         WHERE tenant_key = $1
         FOR UPDATE`,
        [tenantKey]
      );
      if (!lockedTenant.rowCount) {
        throw new HttpError(404, "tenant_not_found", "Tenant not found.");
      }
      if (normalizeText(lockedTenant.rows[0]?.telnyx_voice_number)) {
        throw new HttpError(409, "tenant_already_has_number", "This tenant already has a voice number.");
      }

      const lockedConflict = await client.query(
        `SELECT tenant_key
         FROM tenants
         WHERE telnyx_voice_number = $1
         LIMIT 1
         FOR UPDATE`,
        [phoneNumber]
      );
      if (lockedConflict.rowCount) {
        throw new HttpError(409, "phone_number_already_claimed", "This number is already assigned to another tenant.");
      }

      await client.query(
        `UPDATE tenants
         SET telnyx_voice_number = $2,
             telnyx_voice_number_id = $3,
             telnyx_voice_order_id = NULL,
             telnyx_voice_status = 'active',
             telnyx_voice_purchased_at = COALESCE($4, NOW()),
             telnyx_voice_monthly_cost_cents = COALESCE($5, telnyx_voice_monthly_cost_cents),
             telnyx_voice_upfront_cost_cents = COALESCE($6, telnyx_voice_upfront_cost_cents),
             updated_at = NOW()
         WHERE tenant_key = $1`,
        [
          tenantKey,
          phoneNumber,
          telnyxPhoneNumber.phoneNumberId || null,
          telnyxPhoneNumber.purchasedAt || null,
          centsFromDollars(telnyxPhoneNumber.monthlyCost),
          centsFromDollars(telnyxPhoneNumber.upfrontCost)
        ]
      );

      if (jobId) {
        await client.query(
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
          [
            jobId,
            truncateText(
              routingUpdated
                ? `Assigned ${phoneNumber} after updating Telnyx routing.`
                : `Assigned ${phoneNumber}.`
            ),
            telnyxPhoneNumber.phoneNumberId || null
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, $2, 'admin.voice_number_assigned_existing', $3)`,
        [
          tenantKey,
          `admin:${admin.id}`,
          truncateText(
            `provider=telnyx phone=${phoneNumber} phone_number_id=${telnyxPhoneNumber.phoneNumberId || ""} connection_id=${connectionId} routing_updated=${routingUpdated ? "true" : "false"}`,
            800
          )
        ]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return res.status(200).json({
      ok: true,
      tenantKey,
      phoneNumber,
      phoneNumberId: telnyxPhoneNumber.phoneNumberId || null,
      routingUpdated
    });
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const error = err?.error || "admin_phone_number_assign_error";
    const { errorCode, errorMessage } = parseProvisioningError(err);
    const message = err?.message || errorMessage || "Phone number assignment failed.";
    if (jobId) {
      try {
        const pool = getPool();
        if (pool) {
          await pool.query(
            `UPDATE provisioning_jobs
             SET status = 'failed',
                 status_detail = 'Existing voice number assignment failed.',
                 provider = 'telnyx',
                 error_code = $2,
                 error_message = $3,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [
              jobId,
              errorCode,
              truncateText(
                routingUpdated && status === 500
                  ? `${message} Telnyx routing was verified or updated before the database write failed.`
                  : message
              )
            ]
          );
        }
      } catch {
        // Best-effort job update only.
      }
    }
    return res.status(status).json({
      ok: false,
      error,
      message: truncateText(
        routingUpdated && status === 500
          ? `${message} Telnyx routing was already verified or updated, but the tenant assignment did not commit.`
          : message,
        500
      )
    });
  }
}
