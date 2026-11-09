import bcrypt from "bcryptjs";
import { lockPlatformUserMutations } from "../../_lib/platformUsers.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { revokeTenantCredentials } from "../../_lib/tenantPasswords.js";
import { findAuthToken, revokeAuthTokens } from "../../_lib/authTokens.js";
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
    if (tokenRow.tenant_key) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const user = (await client.query(`SELECT id, email, tenant_key FROM tenant_users WHERE id = $1 AND email = $2 AND tenant_key = $3 FOR UPDATE`, [tokenRow.user_id, tokenRow.email, tokenRow.tenant_key])).rows[0];
        const consumed = user && await client.query(`DELETE FROM auth_tokens WHERE id = $1 AND user_id = $2 AND tenant_key = $3 AND email = $4 AND token_type = 'password_reset' AND used_at IS NULL AND expires_at > NOW() RETURNING id`, [tokenRow.id, user.id, user.tenant_key, user.email]);
        if (!consumed?.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "invalid_token" }); }
        await client.query(`UPDATE tenant_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, user.id]);
        await revokeTenantCredentials(client, user);
        await writeAuditLog(client, { tenantKey: user.tenant_key, actor: `tenant:${user.id}`, action: "auth.password_reset.completed", details: { userId: user.id } });
        await client.query("COMMIT");
        return res.status(200).json({ ok: true });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
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
        const liveToken = await findAuthToken(client, token, { tokenType: "password_reset" });
        if (!liveToken || liveToken.used_at || new Date(liveToken.expires_at).getTime() <= Date.now()) {
          await client.query("ROLLBACK"); return res.status(400).json({ error: "invalid_token" });
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

  } catch (err) {
    return res.status(500).json({ error: "reset_error", message: err?.message || "unknown" });
  }
}
