import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { deleteSessionsForPrincipal } from "../../_lib/auth.js";
import { consumeAuthToken, findAuthToken, revokeAuthTokens } from "../../_lib/authTokens.js";
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
      scope: "auth.reset.ip",
      key: clientIp,
      maxHits: 10,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 2 * 60 * 60 * 1000,
      message: "Too many reset attempts. Please try again later."
    });
    if (ipLimit?.limited) return;

    if (!token || !password) {
      return res.status(400).json({ error: "missing_fields" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "password_too_short" });
    }

    const tokenLimit = await enforceRateLimit(res, pool, {
      scope: "auth.reset.token",
      key: token.slice(0, 64),
      maxHits: 8,
      windowMs: 60 * 60 * 1000,
      blockDurationMs: 2 * 60 * 60 * 1000,
      message: "Too many reset attempts. Please try again later."
    });
    if (tokenLimit?.limited) return;

    const tokenRow = await findAuthToken(pool, token, { tokenType: "password_reset" });
    if (!tokenRow) {
      return res.status(400).json({ error: "invalid_token" });
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      await revokeAuthTokens(pool, {
        tokenType: "password_reset",
        userId: tokenRow.user_id,
        email: tokenRow.email,
        tenantKey: tokenRow.tenant_key || null
      });
      return res.status(400).json({ error: "token_expired" });
    }

    const hash = await bcrypt.hash(password, 10);
    let updated = null;
    if (tokenRow.tenant_key) {
      updated = await pool.query(
        `UPDATE tenant_users
         SET password_hash = $1
         WHERE id = $2 AND email = $3 AND tenant_key = $4`,
        [hash, tokenRow.user_id, tokenRow.email, tokenRow.tenant_key]
      );
    } else {
      updated = await pool.query(
        `UPDATE tenant_users
         SET password_hash = $1
         WHERE id = $2 AND email = $3`,
        [hash, tokenRow.user_id, tokenRow.email]
      );
      if (!updated.rowCount) {
        updated = await pool.query(
          `UPDATE admin_users
           SET password_hash = $1
           WHERE id = $2 AND email = $3`,
          [hash, tokenRow.user_id, tokenRow.email]
        );
      }
    }

    if (!updated?.rowCount) {
      return res.status(400).json({ error: "user_not_found" });
    }

    await consumeAuthToken(pool, token, { tokenType: "password_reset" });
    if (tokenRow.tenant_key) {
      await deleteSessionsForPrincipal({
        userId: tokenRow.user_id,
        role: "tenant",
        tenantKey: tokenRow.tenant_key
      });
    } else {
      const tenantUser = await pool.query(
        `SELECT tenant_key
         FROM tenant_users
         WHERE id = $1 AND email = $2
         LIMIT 1`,
        [tokenRow.user_id, tokenRow.email]
      );
      if (tenantUser.rowCount) {
        await deleteSessionsForPrincipal({
          userId: tokenRow.user_id,
          role: "tenant",
          tenantKey: tenantUser.rows[0].tenant_key
        });
      } else {
        await deleteSessionsForPrincipal({
          userId: tokenRow.user_id,
          role: "admin"
        });
      }
    }
    await writeAuditLog(pool, {
      tenantKey: tokenRow.tenant_key || null,
      actor: tokenRow.tenant_key ? `tenant:${tokenRow.user_id}` : `admin:${tokenRow.user_id || "password_reset"}`,
      action: "auth.password_reset.completed",
      details: {
        email: tokenRow.email || null,
        ip: clientIp
      }
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "reset_error", message: err?.message || "unknown" });
  }
}
