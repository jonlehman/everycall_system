import { ensureTables, getPool } from "../../_lib/db.js";
import { issueAuthToken, revokeAuthTokens } from "../../_lib/authTokens.js";
import { writeAuditLog } from "../../_lib/auditLog.js";
import { enforceRateLimit, getClientIp } from "../../_lib/rateLimit.js";
import { sendTransactionalEmail } from "../../_lib/mail.js";

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

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "tenant");
    const clientIp = getClientIp(req);

    const ipLimit = await enforceRateLimit(res, pool, {
      scope: "auth.request_reset.ip",
      key: clientIp,
      maxHits: 8,
      windowMs: 15 * 60 * 1000,
      blockDurationMs: 60 * 60 * 1000,
      message: "Too many reset attempts. Please try again later."
    });
    if (ipLimit?.limited) return;

    if (!email) {
      return res.status(400).json({ error: "missing_email" });
    }

    const emailLimit = await enforceRateLimit(res, pool, {
      scope: "auth.request_reset.email",
      key: `${role}:${email}`,
      maxHits: 3,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 2 * 60 * 60 * 1000,
      message: "Too many reset attempts. Please try again later."
    });
    if (emailLimit?.limited) return;

    let user = null;
    if (role === "admin") {
      const row = await pool.query(`SELECT id, email FROM admin_users WHERE email = $1 LIMIT 1`, [email]);
      user = row.rows[0] || null;
    } else {
      const row = await pool.query(`SELECT id, email, tenant_key FROM tenant_users WHERE email = $1 LIMIT 1`, [email]);
      user = row.rows[0] || null;
    }

    if (!user) {
      await writeAuditLog(pool, {
        tenantKey: null,
        actor: "anonymous",
        action: "auth.password_reset.requested",
        details: { email, role, delivered: false, reason: "user_not_found", ip: clientIp }
      });
      return res.status(200).json({ ok: true });
    }

    await revokeAuthTokens(pool, {
      tokenType: "password_reset",
      userId: user.id,
      email: user.email,
      tenantKey: user.tenant_key || null
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const token = await issueAuthToken(pool, {
      tokenType: "password_reset",
      userId: user.id,
      email: user.email,
      tenantKey: user.tenant_key || null,
      expiresAt
    });

    let delivered = false;
    let deliveryError = null;
    const baseUrl = process.env.APP_BASE_URL || "https://app.everycall.io";
    const resetUrl = `${baseUrl}/reset?token=${encodeURIComponent(token)}`;
    try {
      await sendTransactionalEmail({
        to: email,
        subject: "Reset your EveryCall password",
        text: `Reset your password using this link:\n${resetUrl}\n\nThis link expires in 1 hour.`,
        category: "Password Reset"
      });
      delivered = true;
    } catch (err) {
      deliveryError = err?.message || "mail_send_failed";
    }

    await writeAuditLog(pool, {
      tenantKey: user.tenant_key || null,
      actor: user.tenant_key ? `tenant:${user.id}` : `admin:${user.id}`,
      action: "auth.password_reset.requested",
      details: {
        email,
        role,
        delivered,
        delivery_error: deliveryError || null,
        ip: clientIp
      }
    });

    return res.status(200).json({
      ok: true,
      message: "If an account exists for that email, a reset link will be sent."
    });
  } catch (err) {
    return res.status(500).json({
      error: "reset_request_error",
      message: "Could not process the reset request."
    });
  }
}
