import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import { normalizePhoneNumber } from "../../../../_lib/phone.js";

const ALLOWED_STATUSES = new Set(["active", "invited", "suspended", "disabled"]);

function actorId(actor, session) {
  if (actor?.id) {
    return `admin:${actor.id}`;
  }
  if (session?.user_id) {
    return `admin:${session.user_id}`;
  }
  return "admin:unknown";
}

async function writeAuditLog(pool, { tenantKey, actor, session, action, details }) {
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [tenantKey, actorId(actor, session), action, JSON.stringify(details || {})]
  );
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

function normalizeText(value) {
  return String(value || "").trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

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

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const name = normalizeText(body.name);
    const email = normalizeText(body.email).toLowerCase();
    const phoneNumber = normalizePhoneNumber(body.phoneNumber);
    const requestedStatus = normalizeText(body.status);

    if (!name || !email) {
      return res.status(400).json({ error: "missing_fields", message: "Name and email are required." });
    }

    const userRes = await pool.query(
      `SELECT id, tenant_key, email, name, phone_number, role, status, sms_opt_in_status
       FROM tenant_users
       WHERE tenant_key = $1
       ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [tenantKey]
    );
    const primaryUser = userRes.rows[0] || null;
    if (!primaryUser) {
      return res.status(404).json({ error: "primary_user_not_found", message: "No tenant user exists for this tenant." });
    }

    const nextStatus = requestedStatus || primaryUser.status || "active";
    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return res.status(400).json({ error: "invalid_status", message: "Invalid user status." });
    }

    if (await findEmailConflict(pool, email, primaryUser.id)) {
      return res.status(409).json({ error: "email_exists", message: "That email address is already in use." });
    }

    const existingPhone = normalizePhoneNumber(primaryUser.phone_number);
    const nextPhone = phoneNumber || "";
    const phoneChanged = existingPhone !== nextPhone;

    await pool.query(
      `UPDATE tenant_users
       SET name = $1,
           email = $2,
           phone_number = $3,
           status = $4,
           sms_opt_in_status = CASE WHEN $5 THEN 'not_requested' ELSE sms_opt_in_status END,
           sms_opt_in_requested_at = CASE WHEN $5 THEN NULL ELSE sms_opt_in_requested_at END,
           sms_opt_in_confirmed_at = CASE WHEN $5 THEN NULL ELSE sms_opt_in_confirmed_at END,
           updated_at = NOW()
       WHERE id = $6`,
      [name, email, phoneNumber || null, nextStatus, phoneChanged, primaryUser.id]
    );

    const changedFields = {};
    if (String(primaryUser.name || "") !== name) {
      changedFields.name = { from: primaryUser.name || null, to: name };
    }
    if (String(primaryUser.email || "") !== email) {
      changedFields.email = { from: primaryUser.email || null, to: email };
    }
    if (String(existingPhone || "") !== String(nextPhone || "")) {
      changedFields.phone_number = { from: existingPhone || null, to: nextPhone || null };
    }
    if (String(primaryUser.status || "") !== String(nextStatus || "")) {
      changedFields.status = { from: primaryUser.status || null, to: nextStatus };
    }

    await writeAuditLog(pool, {
      tenantKey,
      actor: admin,
      session,
      action: "admin.tenant.primary_user_profile_updated",
      details: {
        target_user_id: primaryUser.id,
        target_user_role: primaryUser.role,
        changed_fields: changedFields
      }
    });

    return res.status(200).json({
      ok: true,
      user: {
        id: primaryUser.id,
        tenant_key: tenantKey,
        name,
        email,
        phone_number: phoneNumber || null,
        role: primaryUser.role,
        status: nextStatus,
        sms_opt_in_status: phoneChanged ? "not_requested" : primaryUser.sms_opt_in_status
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_primary_user_profile_error",
      message: err?.message || "unknown"
    });
  }
}
