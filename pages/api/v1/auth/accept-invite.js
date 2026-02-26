import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";

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
    if (!token || !password) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const row = await pool.query(
      `SELECT id, token_type, email, tenant_key, expires_at
       FROM auth_tokens
       WHERE token = $1`,
      [token]
    );
    if (!row.rowCount) {
      return res.status(400).json({ error: "invalid_token" });
    }
    const tokenRow = row.rows[0];
    if (tokenRow.token_type !== "invite") {
      return res.status(400).json({ error: "invalid_token_type" });
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

    await pool.query(`DELETE FROM auth_tokens WHERE token = $1`, [token]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "invite_accept_error", message: err?.message || "unknown" });
  }
}
