import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { createSession, setSessionCookie } from "../../_lib/auth.js";

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
    const password = String(body.password || "");
    const role = String(body.role || "client");

    if (!email || !password) {
      return res.status(400).json({ error: "missing_fields" });
    }

    if (role === "admin") {
      const row = await pool.query(
        `SELECT id, email, password_hash, role
         FROM admin_users
         WHERE email = $1
         LIMIT 1`,
        [email]
      );

      if (!row.rowCount) {
        const bootstrapEmail = String(process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
        const bootstrapPassword = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || "");
        if (bootstrapEmail && bootstrapPassword && email === bootstrapEmail && password === bootstrapPassword) {
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
          return res.status(200).json({ ok: true, role: "admin" });
        }
        return res.status(401).json({ error: "invalid_credentials" });
      }

      const user = row.rows[0];
      if (!user.password_hash) {
        return res.status(401).json({ error: "password_not_set" });
      }
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ error: "invalid_credentials" });
      }
      const sessionId = await createSession({ userId: user.id, tenantKey: null, role: "admin" });
      if (sessionId) setSessionCookie(res, sessionId);
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
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const user = row.rows[0];
    if (user.status !== "active") {
      return res.status(403).json({ error: "inactive_user" });
    }
    if (!user.password_hash) {
      return res.status(401).json({ error: "password_not_set" });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const sessionId = await createSession({ userId: user.id, tenantKey: user.tenant_key, role: "tenant" });
    if (sessionId) setSessionCookie(res, sessionId);
    return res.status(200).json({ ok: true, role: "tenant", tenantKey: user.tenant_key });
  } catch (err) {
    return res.status(500).json({ error: "auth_login_error", message: err?.message || "unknown" });
  }
}
