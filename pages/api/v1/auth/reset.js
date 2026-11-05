import bcrypt from "bcryptjs";
import { lockPlatformUserMutations } from "../../_lib/platformUsers.js";
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
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await lockPlatformUserMutations(client);
        const currentToken = await findAuthToken(client, token, { tokenType: "password_reset" });
        if (!currentToken || currentToken.used_at || new Date(currentToken.expires_at).getTime() <= Date.now()
          || String(currentToken.user_id) !== String(tokenRow.user_id) || currentToken.email !== tokenRow.email || currentToken.tenant_key) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "invalid_token" });
        }
        const platform = await client.query(`SELECT id, role FROM admin_users WHERE id = $1 AND email = $2 FOR UPDATE`, [tokenRow.user_id, tokenRow.email]);
        const tenant = await client.query(`SELECT id, tenant_key FROM tenant_users WHERE id = $1 AND email = $2 FOR UPDATE`, [tokenRow.user_id, tokenRow.email]);
        // Historical unscoped tokens lack a principal kind. Never guess when
        // independently numbered tenant and platform accounts share an identity.
        if (platform.rowCount && tenant.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "invalid_token" });
        }
        const tenantUser = tenant.rows[0];
        const adminUser = platform.rows[0];
        if (!tenantUser && !["admin", "super_admin"].includes(adminUser?.role)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "user_not_found" });
        }
        if (tenantUser) {
          await client.query(`UPDATE tenant_users SET password_hash = $1 WHERE id = $2`, [hash, tenantUser.id]);
          await client.query(`DELETE FROM sessions WHERE user_id = $1 AND role = 'tenant' AND tenant_key = $2`, [tenantUser.id, tenantUser.tenant_key]);
        } else {
          await client.query(`UPDATE admin_users SET password_hash = $1 WHERE id = $2`, [hash, adminUser.id]);
          await client.query(`DELETE FROM sessions WHERE user_id = $1 AND role IN ('admin', 'sales')`, [adminUser.id]);
        }
        await client.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND email = $2 AND tenant_key IS NULL`, [tokenRow.user_id, tokenRow.email]);
        await writeAuditLog(client, { tenantKey: tenantUser?.tenant_key || null, actor: `${tenantUser ? "tenant" : "admin"}:${tokenRow.user_id}`, action: "auth.password_reset.completed", details: { userId: tokenRow.user_id } });
        await client.query("COMMIT");
        return res.status(200).json({ ok: true });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }

    if (!updated?.rowCount) {
      return res.status(400).json({ error: "user_not_found" });
    }

    await consumeAuthToken(pool, token, { tokenType: "password_reset" });
    await deleteSessionsForPrincipal({
      userId: tokenRow.user_id,
      role: "tenant",
      tenantKey: tokenRow.tenant_key
    });
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
