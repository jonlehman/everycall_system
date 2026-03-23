import crypto from "crypto";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { MailtrapClient } from "mailtrap";
import { sendTelnyxSms } from "../../_lib/telnyx.js";
import { getSharedSmsNumber } from "../../_lib/alerts.js";
import { normalizePhoneNumber } from "../../_lib/phone.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

const mailtrapToken = process.env.MAILTRAP_TOKEN;
const mailtrapSender = {
  email: process.env.MAILTRAP_SENDER_EMAIL || "hello@demomailtrap.co",
  name: process.env.MAILTRAP_SENDER_NAME || "EveryCall"
};

const mailtrapClient = mailtrapToken ? new MailtrapClient({ token: mailtrapToken }) : null;
const ALLOWED_ROLES = new Set(["admin", "member", "owner", "viewer"]);
const ALLOWED_STATUSES = new Set(["active", "invited", "suspended", "disabled"]);

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

async function createInviteToken({ email, tenantKey }) {
  const token = crypto.randomBytes(24).toString("hex");
  const pool = getPool();
  if (pool) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_tokens (token, token_type, email, tenant_key, expires_at)
       VALUES ($1, 'invite', $2, $3, $4)`,
      [token, email, tenantKey, expiresAt.toISOString()]
    );
  }
  return token;
}

async function sendInviteEmail({ tenantKey, name, email, role }) {
  if (!mailtrapClient) return;
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

  await mailtrapClient.send({
    from: mailtrapSender,
    to: [{ email }],
    subject,
    text,
    category: "Invite"
  });
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

    if (req.method === "GET") {
      const rows = await pool.query(
        `SELECT id, name, email, role, status, phone_number, sms_opt_in_status, sms_opt_in_requested_at, sms_opt_in_confirmed_at,
                lead_alert_sms_enabled, lead_alert_email_enabled
         FROM tenant_users
         WHERE tenant_key = $1
         ORDER BY id ASC`,
        [tenantKey]
      );
      return res.status(200).json({ ok: true, users: rows.rows });
    }

    if (req.method === "POST") {
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
        return res.status(200).json({ ok: true });
      }

      if (body.action === "update_phone") {
        const id = Number(body.id || 0);
        const phoneNumber = normalizePhoneNumber(body.phoneNumber);
        if (!id || !phoneNumber) {
          return fail(400, "missing_fields", "User id and valid phone number are required.");
        }
        await pool.query(
          `UPDATE tenant_users
           SET phone_number = $2, updated_at = NOW()
           WHERE tenant_key = $1 AND id = $3`,
          [tenantKey, phoneNumber, id]
        );
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
               sms_opt_in_status = CASE WHEN $10 THEN 'not_requested' ELSE sms_opt_in_status END,
               sms_opt_in_requested_at = CASE WHEN $10 THEN NULL ELSE sms_opt_in_requested_at END,
               sms_opt_in_confirmed_at = CASE WHEN $10 THEN NULL ELSE sms_opt_in_confirmed_at END,
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
            phoneChanged
          ]
        );
        return res.status(200).json({ ok: true });
      }

      if (body.action === "update_lead_alerts") {
        const id = Number(body.id || 0);
        if (!id) {
          return fail(400, "missing_fields", "User id is required.");
        }
        await pool.query(
          `UPDATE tenant_users
           SET lead_alert_sms_enabled = $2,
               lead_alert_email_enabled = $3,
               updated_at = NOW()
           WHERE tenant_key = $1 AND id = $4`,
          [tenantKey, Boolean(body.leadAlertSmsEnabled), Boolean(body.leadAlertEmailEnabled), id]
        );
        return res.status(200).json({ ok: true });
      }

      if (body.action === "sms_opt_in_request") {
        const id = Number(body.id || 0);
        if (!id) {
          return fail(400, "missing_fields", "User id is required.");
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
        const text = "EveryCall alerts: Reply YES to opt in for new lead text alerts. Reply STOP to opt out.";
        await sendTelnyxSms({ from: fromNumber, to: user.phone_number, text });
        await pool.query(
          `UPDATE tenant_users
           SET sms_opt_in_status = 'pending',
               sms_opt_in_requested_at = NOW(),
               updated_at = NOW()
           WHERE tenant_key = $1 AND id = $2`,
          [tenantKey, id]
        );
        return res.status(200).json({ ok: true });
      }

      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const phoneNumber = normalizePhoneNumber(body.phoneNumber);
      const leadAlertSmsEnabled = Boolean(body.leadAlertSmsEnabled);
      const leadAlertEmailEnabled = Boolean(body.leadAlertEmailEnabled);
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
      await pool.query(
        `INSERT INTO tenant_users (
           tenant_key,
           name,
           email,
           phone_number,
           role,
           status,
           lead_alert_sms_enabled,
           lead_alert_email_enabled
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (email)
         DO UPDATE SET tenant_key = EXCLUDED.tenant_key,
                       name = EXCLUDED.name,
                       phone_number = EXCLUDED.phone_number,
                       role = EXCLUDED.role,
                       status = EXCLUDED.status,
                       lead_alert_sms_enabled = EXCLUDED.lead_alert_sms_enabled,
                       lead_alert_email_enabled = EXCLUDED.lead_alert_email_enabled`,
        [tenantKey, name, email, phoneNumber || null, role, status, leadAlertSmsEnabled, leadAlertEmailEnabled]
      );
      try {
        await sendInviteEmail({ tenantKey, name, email, role });
      } catch (mailErr) {
        // Email failure should not block user creation.
        console.error("mailtrap_invite_failed", mailErr?.message || mailErr);
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const id = Number(req.query?.id || 0);
      if (!id) {
        return fail(400, "missing_fields", "User id is required.");
      }
      await pool.query(
        `DELETE FROM tenant_users WHERE tenant_key = $1 AND id = $2`,
        [tenantKey, id]
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return fail(405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    return fail(500, "tenant_users_error", err?.message || "unknown");
  }
}
