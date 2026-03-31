import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { createSession, setSessionCookie } from "../../_lib/auth.js";
import { writeAuditLog } from "../../_lib/auditLog.js";
import { enforceRateLimit, getClientIp } from "../../_lib/rateLimit.js";

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

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const email = normalizeText(body.email).toLowerCase();
    const password = String(body.password || "");
    const role = normalizeText(body.role || "client");
    const clientIp = getClientIp(req);

    const ipLimit = await enforceRateLimit(res, pool, {
      scope: "auth.login.ip",
      key: clientIp,
      maxHits: 20,
      windowMs: 15 * 60 * 1000,
      blockDurationMs: 30 * 60 * 1000,
      message: "Too many login attempts. Please try again later."
    });
    if (ipLimit?.limited) return;

    if (!email || !password) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const accountLimit = await enforceRateLimit(res, pool, {
      scope: "auth.login.account",
      key: `${role}:${email}`,
      maxHits: 10,
      windowMs: 15 * 60 * 1000,
      blockDurationMs: 30 * 60 * 1000,
      message: "Too many login attempts. Please try again later."
    });
    if (accountLimit?.limited) return;

    if (role === "admin") {
      const row = await pool.query(
        `SELECT id, email, password_hash, role
         FROM admin_users
         WHERE email = $1
         LIMIT 1`,
        [email]
      );

      if (!row.rowCount) {
        const bootstrapEmail = normalizeText(process.env.ADMIN_BOOTSTRAP_EMAIL).toLowerCase();
        const bootstrapPassword = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || "");
        const adminCount = await pool.query(`SELECT COUNT(*)::int AS count FROM admin_users`);
        const bootstrapAllowed = Number(adminCount.rows?.[0]?.count || 0) === 0;
        if (bootstrapAllowed && bootstrapEmail && bootstrapPassword && email === bootstrapEmail && password === bootstrapPassword) {
          const hash = await bcrypt.hash(password, 10);
          const inserted = await pool.query(
            `INSERT INTO admin_users (username, email, password_hash, role)
             VALUES ($1, $2, $3, 'admin')
             RETURNING id, email, role`,
            [email.split("@")[0] || "admin", email, hash]
          );
          const user = inserted.rows[0];
          const sessionId = await createSession({ userId: user.id, tenantKey: null, role: "admin" });
          if (sessionId) setSessionCookie(res, sessionId);
          await writeAuditLog(pool, {
            tenantKey: null,
            actor: `admin:${user.id}`,
            action: "auth.login.success",
            details: { role: "admin", bootstrap: true, email }
          });
          return res.status(200).json({ ok: true, role: "admin" });
        }
        await writeAuditLog(pool, {
          tenantKey: null,
          actor: "anonymous",
          action: "auth.login.failed",
          details: { role: "admin", email, reason: "invalid_credentials", ip: clientIp }
        });
        return res.status(401).json({ error: "invalid_credentials" });
      }

      const user = row.rows[0];
      if (!user.password_hash) {
        await writeAuditLog(pool, {
          tenantKey: null,
          actor: `admin:${user.id}`,
          action: "auth.login.failed",
          details: { role: "admin", email, reason: "password_not_set", ip: clientIp }
        });
        return res.status(401).json({ error: "password_not_set" });
      }
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        await writeAuditLog(pool, {
          tenantKey: null,
          actor: `admin:${user.id}`,
          action: "auth.login.failed",
          details: { role: "admin", email, reason: "invalid_credentials", ip: clientIp }
        });
        return res.status(401).json({ error: "invalid_credentials" });
      }
      const sessionId = await createSession({ userId: user.id, tenantKey: null, role: "admin" });
      if (sessionId) setSessionCookie(res, sessionId);
      await pool.query(
        `UPDATE admin_users
         SET last_active_at = NOW()
         WHERE id = $1`,
        [user.id]
      );
      await writeAuditLog(pool, {
        tenantKey: null,
        actor: `admin:${user.id}`,
        action: "auth.login.success",
        details: { role: "admin", email }
      });
      return res.status(200).json({ ok: true, role: "admin" });
    }

    const row = await pool.query(
      `SELECT id, tenant_key, email, password_hash, status
       FROM tenant_users
       WHERE email = $1
       LIMIT 1`,
      [email]
    );
    if (!row.rowCount) {
      await writeAuditLog(pool, {
        tenantKey: null,
        actor: "anonymous",
        action: "auth.login.failed",
        details: { role: "tenant", email, reason: "invalid_credentials", ip: clientIp }
      });
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const user = row.rows[0];
    if (user.status !== "active") {
      await writeAuditLog(pool, {
        tenantKey: user.tenant_key || null,
        actor: `tenant:${user.id}`,
        action: "auth.login.failed",
        details: { role: "tenant", email, reason: "inactive_user", ip: clientIp }
      });
      return res.status(403).json({ error: "inactive_user" });
    }
    if (!user.password_hash) {
      await writeAuditLog(pool, {
        tenantKey: user.tenant_key || null,
        actor: `tenant:${user.id}`,
        action: "auth.login.failed",
        details: { role: "tenant", email, reason: "password_not_set", ip: clientIp }
      });
      return res.status(401).json({ error: "password_not_set" });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await writeAuditLog(pool, {
        tenantKey: user.tenant_key || null,
        actor: `tenant:${user.id}`,
        action: "auth.login.failed",
        details: { role: "tenant", email, reason: "invalid_credentials", ip: clientIp }
      });
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const sessionId = await createSession({ userId: user.id, tenantKey: user.tenant_key, role: "tenant" });
    if (sessionId) setSessionCookie(res, sessionId);
    await writeAuditLog(pool, {
      tenantKey: user.tenant_key || null,
      actor: `tenant:${user.id}`,
      action: "auth.login.success",
      details: { role: "tenant", email }
    });
    return res.status(200).json({ ok: true, role: "tenant", tenantKey: user.tenant_key });
  } catch (err) {
    return res.status(500).json({ error: "auth_login_error", message: err?.message || "unknown" });
  }
}
