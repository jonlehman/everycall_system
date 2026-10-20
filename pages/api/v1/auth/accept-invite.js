import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { findAuthToken } from "../../_lib/authTokens.js";
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

    const tokenRow = await findAuthToken(pool, token, { tokenType: "invite" })
      || await findAuthToken(pool, token, { tokenType: "account_setup" });
    if (!tokenRow) {
      return res.status(400).json({ error: "invalid_token" });
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "token_expired" });
    }

    const hash = await bcrypt.hash(password, 10);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Lock user first, matching invitation issuance and revocation trigger order.
      const user = await client.query(
        `SELECT id FROM tenant_users
         WHERE id = $1 AND tenant_key = $2 AND email = $3
           AND (($4 = 'invite' AND status = 'invited')
             OR ($4 = 'account_setup' AND status = 'active' AND password_hash IS NULL))
         FOR UPDATE`,
        [tokenRow.user_id, tokenRow.tenant_key, tokenRow.email, tokenRow.token_type]
      );
      if (!user.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_token" });
      }
      const consumed = await client.query(
        `DELETE FROM auth_tokens
         WHERE id = $1 AND user_id = $2 AND tenant_key = $3 AND email = $4
           AND token_type = $5 AND used_at IS NULL AND expires_at > NOW()
         RETURNING id`,
        [tokenRow.id, tokenRow.user_id, tokenRow.tenant_key, tokenRow.email, tokenRow.token_type]
      );
      if (!consumed.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_token" });
      }
      await client.query(
        `UPDATE tenant_users SET password_hash = $1, status = 'active', updated_at = NOW()
         WHERE id = $2`, [hash, tokenRow.user_id]
      );
      await writeAuditLog(client, {
        tenantKey: tokenRow.tenant_key,
        actor: `tenant:${tokenRow.user_id}`,
        action: "auth.invite.accepted",
        details: { email: tokenRow.email, ip: clientIp }
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "invite_accept_error", message: err?.message || "unknown" });
  }
}
