import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../../_lib/db.js";
import {
  clearSessionCookie,
  createSession,
  deleteSalesSession,
  deleteSession,
  setSalesSessionCookie
} from "../../../_lib/auth.js";
import { writeAuditLog } from "../../../_lib/auditLog.js";
import { enforceRateLimit, getClientIp } from "../../../_lib/rateLimit.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "database_unavailable" });
    await ensureTables(pool);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const ip = getClientIp(req);
    const ipLimit = await enforceRateLimit(res, pool, {
      scope: "auth.sales_login.ip", key: ip, maxHits: 20,
      windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000,
      message: "Too many login attempts. Please try again later."
    });
    if (ipLimit?.limited) return;
    if (!email || !password) return res.status(400).json({ error: "missing_fields" });
    const accountLimit = await enforceRateLimit(res, pool, {
      scope: "auth.sales_login.account", key: email, maxHits: 10,
      windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000,
      message: "Too many login attempts. Please try again later."
    });
    if (accountLimit?.limited) return;
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.password_hash, u.role
       FROM admin_users u
       JOIN sales_operator_settings settings ON settings.admin_user_id = u.id
       WHERE u.email = $1 AND u.role = 'sales'
         AND settings.active = TRUE
       LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    const valid = user?.role === "sales" && user.password_hash
      && await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await writeAuditLog(pool, {
        actor: "anonymous", action: "auth.login.failed",
        details: { role: "sales", email, reason: "invalid_credentials", ip }
      });
      return res.status(401).json({ error: "invalid_credentials" });
    }
    await deleteSalesSession(req);
    await deleteSession(req);
    const sessionId = await createSession({ userId: user.id, tenantKey: null, role: "sales" });
    if (!sessionId) return res.status(500).json({ error: "database_unavailable" });
    await pool.query(`UPDATE admin_users SET last_active_at = NOW() WHERE id = $1`, [user.id]);
    await writeAuditLog(pool, {
      actor: `sales:${user.id}`, action: "auth.login.success",
      details: { role: "sales", email }
    });
    clearSessionCookie(res);
    setSalesSessionCookie(res, sessionId);
    return res.status(200).json({ ok: true, role: "sales" });
  } catch {
    return res.status(500).json({ error: "sales_login_error" });
  }
}
