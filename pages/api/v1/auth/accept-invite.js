import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { consumeAuthToken, findAuthToken } from "../../_lib/authTokens.js";
import { writeAuditLog } from "../../_lib/auditLog.js";
import { enforceRateLimit, getClientIp } from "../../_lib/rateLimit.js";

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
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    const clientIp = getClientIp(req);

    const ipLimit = await enforceRateLimit(res, pool, {
      scope: "auth.accept_invite.ip",
      key: clientIp,
      maxHits: 10,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 2 * 60 * 60 * 1000,
      message: "Too many invite attempts. Please try again later."
    });
    if (ipLimit?.limited) return;

    if (!token || !password) {
      return res.status(400).json({ error: "missing_fields" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "password_too_short" });
    }

    const tokenLimit = await enforceRateLimit(res, pool, {
      scope: "auth.accept_invite.token",
      key: token.slice(0, 64),
      maxHits: 8,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 2 * 60 * 60 * 1000,
      message: "Too many invite attempts. Please try again later."
    });
    if (tokenLimit?.limited) return;

    const tokenRow = await findAuthToken(pool, token, { tokenType: "invite" });
    if (!tokenRow) {
      return res.status(400).json({ error: "invalid_token" });
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "token_expired" });
    }

    const userRow = await pool.query(
      `SELECT id, status FROM tenant_users WHERE email = $1 LIMIT 1`,
      [tokenRow.email]
    );
    if (!userRow.rowCount) {
      return res.status(404).json({ error: "user_not_found" });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE tenant_users
       SET password_hash = $1,
           status = 'active',
           updated_at = NOW()
       WHERE id = $2`,
      [hash, userRow.rows[0].id]
    );

    await consumeAuthToken(pool, token, { tokenType: "invite" });
    await writeAuditLog(pool, {
      tenantKey: tokenRow.tenant_key || null,
      actor: `tenant:${userRow.rows[0].id}`,
      action: "auth.invite.accepted",
      details: {
        email: tokenRow.email || null,
        ip: clientIp
      }
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "invite_accept_error", message: err?.message || "unknown" });
  }
}
