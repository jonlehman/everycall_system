import crypto from "crypto";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess, requireTenantRoles } from "../../_lib/billing.js";
import { sendTelnyxSms } from "../../_lib/telnyx.js";
import { getSharedSmsNumber } from "../../_lib/alerts.js";
import { normalizePhoneNumber } from "../../_lib/phone.js";
import { issueAuthToken, revokeAuthTokens } from "../../_lib/authTokens.js";
import { buildAuditActor, writeAuditLog } from "../../_lib/auditLog.js";
import { sendTransactionalEmail } from "../../_lib/mail.js";
import { sanitizeCallCategorySelection } from "../../../../lib/callCategories.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

const ALLOWED_ROLES = new Set(["admin", "member", "owner", "viewer"]);
const ALLOWED_STATUSES = new Set(["active", "invited", "suspended", "disabled"]);

function resolveAlertCategories(value, enabled) {
  return sanitizeCallCategorySelection(value, { fallbackToAll: Boolean(enabled) });
}

async function findEmailConflict(pool, email, excludedId = null) {
  if (!email) return false;
  const values = excludedId
    ? [email, excludedId]
    : [email];
  const where = excludedId
    ? `email = $1 AND id <> $2`
    : `email = $1`;
  const result = await pool.query(
    `SELECT id
     FROM tenant_users
     WHERE ${where}
     LIMIT 1`,
    values
  );
  return result.rowCount > 0;
}

async function findPhoneConflict(pool, phoneNumber, excludedId = null) {
  if (!phoneNumber) return false;
  const values = excludedId
    ? [phoneNumber, excludedId]
    : [phoneNumber];
  const where = excludedId
    ? `phone_number = $1 AND id <> $2`
    : `phone_number = $1`;
  const result = await pool.query(
    `SELECT id, tenant_key
     FROM tenant_users
     WHERE ${where}
     LIMIT 1`,
    values
  );
  return result.rows[0] || null;
}

async function createInviteToken({ email, tenantKey }) {
  const pool = getPool();
  if (!pool) return crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await revokeAuthTokens(pool, {
    tokenType: "invite",
    email,
    tenantKey
  });
  return issueAuthToken(pool, {
    tokenType: "invite",
    email,
    tenantKey,
    expiresAt
  });
}

async function sendInviteEmail({ tenantKey, name, email, role }) {
  const baseUrl = process.env.APP_BASE_URL || "https://app.everycall.io";

  const subject = `You're invited to EveryCall (${tenantKey})`;
  const token = await createInviteToken({ email, tenantKey });
  const inviteUrl = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`;
  const text = [
    `Hi ${name},`,
    "",
    `You've been invited to join the EveryCall workspace for tenant "${tenantKey}".`,
    `Role: ${role}.`,
    "",
    "Accept your invite here:",
    inviteUrl,
    "",
    "If you have questions, reply to this email."
  ].join("\n");

  await sendTransactionalEmail({ to: email, subject, text, category: "Invite" });
}

export default async function handler(req, res) {
  const fail = (status, error, message) => res.status(status).json({ ok: false, error, message });

  try {
    const pool = getPool();
    if (!pool) {
      return fail(500, "database_unavailable", "Database is unavailable.");
    }

    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, getTenantKey(req));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    const requireTeamManager = async () => requireTenantRoles(res, session, ["owner", "admin"], {
      message: "Only account admins and owners can manage team users."
    });
    const audit = async (actorUser, action, details) => writeAuditLog(pool, {
      tenantKey,
      actor: buildAuditActor({ session, tenantUser: actorUser }),
      action,
      details
    });

    if (req.method === "GET") {
      const rows = await pool.query(
        `SELECT id, name, email, role, status, phone_number, sms_opt_in_status, sms_opt_in_requested_at, sms_opt_in_confirmed_at,
                lead_alert_sms_enabled, lead_alert_email_enabled,
                lead_alert_sms_categories_json AS lead_alert_sms_categories,
                lead_alert_email_categories_json AS lead_alert_email_categories
         FROM tenant_users
         WHERE tenant_key = $1
         ORDER BY id ASC`,
        [tenantKey]
      );
      return res.status(200).json({ ok: true, users: rows.rows });
    }

    if (req.method === "POST") {
      const manager = await requireTeamManager();
      if (!manager) return;
      const body = typeof req.body === "object" && req.body ? req.body : {};
      if (body.action === "status") {
        const id = Number(body.id || 0);
        const status = String(body.status || "");
        if (!id || !status) {
          return fail(400, "missing_fields", "User id and status are required.");
        }
        if (!ALLOWED_STATUSES.has(status)) {
          return fail(400, "invalid_status", "Invalid user status.");
        }
        await pool.query(
          `UPDATE tenant_users SET status = $2, updated_at = NOW()
           WHERE tenant_key = $1 AND id = $3`,
          [tenantKey, status, id]
        );
        await audit(manager, "tenant.team_user.status_updated", {
          user_id: id,
          status
        });
        return res.status(200).json({ ok: true });
      }

      if (body.action === "resend") {
        const id = Number(body.id || 0);
        if (!id) {
          return fail(400, "missing_fields", "User id is required.");
        }
        const row = await pool.query(
          `SELECT id, name, email, role, status
           FROM tenant_users
           WHERE tenant_key = $1 AND id = $2
           LIMIT 1`,
          [tenantKey, id]
        );
        if (!row.rowCount) {
          return fail(404, "not_found", "User not found.");
        }
        const user = row.rows[0];
        await sendInviteEmail({ tenantKey, name: user.name, email: user.email, role: user.role });
        await pool.query(
          `UPDATE tenant_users SET status = 'invited', updated_at = NOW()
           WHERE tenant_key = $1 AND id = $2`,
          [tenantKey, id]
        );
        await audit(manager, "tenant.team_user.invite_resent", {
          user_id: id,
          email: user.email,
          role: user.role
        });
        return res.status(200).json({ ok: true });
      }

      if (body.action === "update_phone") {
        const id = Number(body.id || 0);
        const phoneNumber = normalizePhoneNumber(body.phoneNumber);
        if (!id || !phoneNumber) {
          return fail(400, "missing_fields", "User id and valid phone number are required.");
        }
        if (await findPhoneConflict(pool, phoneNumber, id)) {
          return fail(409, "phone_exists", "That phone number is already assigned to another team user.");
        }
        await pool.query(
          `UPDATE tenant_users
           SET phone_number = $2,
               sms_opt_in_status = 'not_requested',
               sms_opt_in_requested_at = NULL,
               sms_opt_in_confirmed_at = NULL,
               updated_at = NOW()
           WHERE tenant_key = $1 AND id = $3`,
          [tenantKey, phoneNumber, id]
        );
        await audit(manager, "tenant.team_user.phone_updated", {
          user_id: id,
          phone_number: phoneNumber
        });
        return res.status(200).json({ ok: true });
      }

      if (body.action === "update_user") {
        const id = Number(body.id || 0);
        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const role = String(body.role || "member");
        const status = String(body.status || "active");
        const phoneNumber = normalizePhoneNumber(body.phoneNumber);
        const leadAlertSmsEnabled = Boolean(body.leadAlertSmsEnabled);
        const leadAlertEmailEnabled = Boolean(body.leadAlertEmailEnabled);
        const leadAlertSmsCategories = resolveAlertCategories(body.leadAlertSmsCategories, leadAlertSmsEnabled);
        const leadAlertEmailCategories = resolveAlertCategories(body.leadAlertEmailCategories, leadAlertEmailEnabled);

        if (!id || !name || !email) {
          return fail(400, "missing_fields", "User id, name, and email are required.");
        }
        if (!ALLOWED_ROLES.has(role)) {
          return fail(400, "invalid_role", "Invalid user role.");
        }
        if (!ALLOWED_STATUSES.has(status)) {
          return fail(400, "invalid_status", "Invalid user status.");
        }

        const existingResult = await pool.query(
          `SELECT id, email, phone_number
           FROM tenant_users
           WHERE tenant_key = $1 AND id = $2
           LIMIT 1`,
          [tenantKey, id]
        );
        if (!existingResult.rowCount) {
          return fail(404, "not_found", "User not found.");
        }

        if (await findEmailConflict(pool, email, id)) {
          return fail(409, "email_exists", "That email address is already in use.");
        }
        if (phoneNumber && await findPhoneConflict(pool, phoneNumber, id)) {
          return fail(409, "phone_exists", "That phone number is already assigned to another team user.");
        }

        const existing = existingResult.rows[0];
        const existingPhone = normalizePhoneNumber(existing.phone_number);
        const nextPhone = phoneNumber || "";
        const phoneChanged = existingPhone !== nextPhone;

        await pool.query(
          `UPDATE tenant_users
           SET name = $3,
               email = $4,
               phone_number = $5,
               role = $6,
               status = $7,
               lead_alert_sms_enabled = $8,
               lead_alert_email_enabled = $9,
               lead_alert_sms_categories_json = $10::jsonb,
               lead_alert_email_categories_json = $11::jsonb,
               sms_opt_in_status = CASE WHEN $12 THEN 'not_requested' ELSE sms_opt_in_status END,
               sms_opt_in_requested_at = CASE WHEN $12 THEN NULL ELSE sms_opt_in_requested_at END,
               sms_opt_in_confirmed_at = CASE WHEN $12 THEN NULL ELSE sms_opt_in_confirmed_at END,
               updated_at = NOW()
           WHERE tenant_key = $1 AND id = $2`,
          [
            tenantKey,
            id,
            name,
            email,
            phoneNumber || null,
            role,
            status,
            leadAlertSmsEnabled,
            leadAlertEmailEnabled,
            JSON.stringify(leadAlertSmsCategories),
            JSON.stringify(leadAlertEmailCategories),
            phoneChanged
          ]
        );
        await audit(manager, "tenant.team_user.updated", {
          user_id: id,
          role,
          status,
          lead_alert_sms_enabled: leadAlertSmsEnabled,
          lead_alert_email_enabled: leadAlertEmailEnabled,
          lead_alert_sms_categories: leadAlertSmsCategories,
          lead_alert_email_categories: leadAlertEmailCategories,
          phone_changed: phoneChanged
        });
        return res.status(200).json({ ok: true });
      }

      if (body.action === "update_lead_alerts") {
        const id = Number(body.id || 0);
        if (!id) {
          return fail(400, "missing_fields", "User id is required.");
        }
        const leadAlertSmsEnabled = Boolean(body.leadAlertSmsEnabled);
        const leadAlertEmailEnabled = Boolean(body.leadAlertEmailEnabled);
        const leadAlertSmsCategories = resolveAlertCategories(body.leadAlertSmsCategories, leadAlertSmsEnabled);
        const leadAlertEmailCategories = resolveAlertCategories(body.leadAlertEmailCategories, leadAlertEmailEnabled);
        await pool.query(
          `UPDATE tenant_users
           SET lead_alert_sms_enabled = $2,
               lead_alert_email_enabled = $3,
               lead_alert_sms_categories_json = $4::jsonb,
               lead_alert_email_categories_json = $5::jsonb,
               updated_at = NOW()
           WHERE tenant_key = $1 AND id = $6`,
          [
            tenantKey,
            leadAlertSmsEnabled,
            leadAlertEmailEnabled,
            JSON.stringify(leadAlertSmsCategories),
            JSON.stringify(leadAlertEmailCategories),
            id
          ]
        );
        await audit(manager, "tenant.team_user.lead_alerts_updated", {
          user_id: id,
          lead_alert_sms_enabled: leadAlertSmsEnabled,
          lead_alert_email_enabled: leadAlertEmailEnabled,
          lead_alert_sms_categories: leadAlertSmsCategories,
          lead_alert_email_categories: leadAlertEmailCategories
        });
        return res.status(200).json({ ok: true });
      }

      if (body.action === "sms_opt_in_request") {
        const id = Number(body.id || 0);
        if (!id) {
          return fail(400, "missing_fields", "User id is required.");
        }
        if (!Boolean(body.consentConfirmed)) {
          return fail(400, "consent_required", "SMS opt-in consent confirmation is required.");
        }
        const row = await pool.query(
          `SELECT id, name, phone_number, sms_opt_in_status
           FROM tenant_users
           WHERE tenant_key = $1 AND id = $2
           LIMIT 1`,
          [tenantKey, id]
        );
        if (!row.rowCount) {
          return fail(404, "not_found", "User not found.");
        }
        const user = row.rows[0];
        if (!user.phone_number) {
          return fail(400, "missing_phone", "User does not have a mobile phone on file.");
        }
        const fromNumber = await getSharedSmsNumber(pool);
        if (!fromNumber) {
          return fail(500, "sms_number_missing", "Shared SMS number is not configured.");
        }
        const text = "EveryCall by Creative Dynamic: Reply YES to confirm SMS new lead alerts. Message frequency may vary. Msg&data rates may apply. Consent is not a condition of purchase. Reply HELP for help. Reply STOP to opt out.";
        const smsResult = await sendTelnyxSms({ from: fromNumber, to: user.phone_number, text });
        const providerMessageId = String(smsResult?.data?.id || smsResult?.id || "").trim() || null;
        await pool.query(
          `UPDATE tenant_users
           SET sms_opt_in_status = 'pending',
               sms_opt_in_requested_at = NOW(),
               sms_opt_in_confirmed_at = NULL,
               updated_at = NOW()
           WHERE tenant_key = $1 AND id = $2`,
          [tenantKey, id]
        );
        await audit(manager, "tenant.team_user.sms_opt_in_requested", {
          user_id: id,
          phone_number: user.phone_number,
          provider_message_id: providerMessageId
        });
        return res.status(200).json({
          ok: true,
          message: providerMessageId
            ? `SMS opt-in request accepted by Telnyx. Message ID: ${providerMessageId}.`
            : "SMS opt-in request accepted by Telnyx.",
          providerMessageId
        });
      }

      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const phoneNumber = normalizePhoneNumber(body.phoneNumber);
      const leadAlertSmsEnabled = Boolean(body.leadAlertSmsEnabled);
      const leadAlertEmailEnabled = Boolean(body.leadAlertEmailEnabled);
      const leadAlertSmsCategories = resolveAlertCategories(body.leadAlertSmsCategories, leadAlertSmsEnabled);
      const leadAlertEmailCategories = resolveAlertCategories(body.leadAlertEmailCategories, leadAlertEmailEnabled);
      if (!name || !email) {
        return fail(400, "missing_fields", "Name and email are required.");
      }
      const role = String(body.role || "member");
      const status = String(body.status || "invited");
      if (!ALLOWED_ROLES.has(role)) {
        return fail(400, "invalid_role", "Invalid user role.");
      }
      if (!ALLOWED_STATUSES.has(status)) {
        return fail(400, "invalid_status", "Invalid user status.");
      }
      if (await findEmailConflict(pool, email)) {
        return fail(409, "email_exists", "That email address is already in use.");
      }
      if (phoneNumber && await findPhoneConflict(pool, phoneNumber)) {
        return fail(409, "phone_exists", "That phone number is already assigned to another team user.");
      }
      await pool.query(
        `INSERT INTO tenant_users (
           tenant_key,
           name,
           email,
           phone_number,
           role,
           status,
           lead_alert_sms_enabled,
           lead_alert_email_enabled,
           lead_alert_sms_categories_json,
           lead_alert_email_categories_json
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
         ON CONFLICT (email)
         DO UPDATE SET tenant_key = EXCLUDED.tenant_key,
                       name = EXCLUDED.name,
                       phone_number = EXCLUDED.phone_number,
                       role = EXCLUDED.role,
                       status = EXCLUDED.status,
                       lead_alert_sms_enabled = EXCLUDED.lead_alert_sms_enabled,
                       lead_alert_email_enabled = EXCLUDED.lead_alert_email_enabled,
                       lead_alert_sms_categories_json = EXCLUDED.lead_alert_sms_categories_json,
                       lead_alert_email_categories_json = EXCLUDED.lead_alert_email_categories_json`,
        [
          tenantKey,
          name,
          email,
          phoneNumber || null,
          role,
          status,
          leadAlertSmsEnabled,
          leadAlertEmailEnabled,
          JSON.stringify(leadAlertSmsCategories),
          JSON.stringify(leadAlertEmailCategories)
        ]
      );
      try {
        await sendInviteEmail({ tenantKey, name, email, role });
      } catch (mailErr) {
        // Email failure should not block user creation.
        console.error("mailtrap_invite_failed", mailErr?.message || mailErr);
      }
      await audit(manager, "tenant.team_user.created", {
        email,
        role,
        status,
        lead_alert_sms_enabled: leadAlertSmsEnabled,
        lead_alert_email_enabled: leadAlertEmailEnabled,
        lead_alert_sms_categories: leadAlertSmsCategories,
        lead_alert_email_categories: leadAlertEmailCategories
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const manager = await requireTeamManager();
      if (!manager) return;
      const id = Number(req.query?.id || 0);
      if (!id) {
        return fail(400, "missing_fields", "User id is required.");
      }
      await pool.query(
        `DELETE FROM tenant_users WHERE tenant_key = $1 AND id = $2`,
        [tenantKey, id]
      );
      await audit(manager, "tenant.team_user.deleted", {
        user_id: id
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return fail(405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    if (err?.code === "23505" && String(err?.constraint || "").includes("tenant_users_phone_number_unique")) {
      return fail(409, "phone_exists", "That phone number is already assigned to another team user.");
    }
    if (err?.code === "23505" && String(err?.constraint || "").includes("tenant_users_email_unique")) {
      return fail(409, "email_exists", "That email address is already in use.");
    }
    return fail(500, "tenant_users_error", err?.message || "unknown");
  }
}
