import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";
import { writeAuditLog } from "../../_lib/auditLog.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    if (req.method === "GET") {
      const rows = await pool.query(
        `SELECT id, username, email, role, last_active_at
         FROM admin_users
         ORDER BY username ASC`
      );
      return res.status(200).json({ users: rows.rows });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const email = String(body.email || "").trim().toLowerCase();
      const username = String(body.username || "").trim() || email.split("@")[0];
      const role = String(body.role || "admin");
      const password = String(body.password || "");
      if (!email || !password) {
        return res.status(400).json({ error: "missing_fields" });
      }
      if (!["admin", "super_admin", "sales"].includes(role)) {
        return res.status(400).json({ error: "invalid_role" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "password_too_short" });
      }
      const hash = await bcrypt.hash(password, 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const saved = await client.query(
          `INSERT INTO admin_users (username, email, role, password_hash)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (email)
           DO UPDATE SET username = EXCLUDED.username,
                         role = EXCLUDED.role,
                         password_hash = EXCLUDED.password_hash
           RETURNING id`,
          [username, email, role, hash]
        );
        const userId = saved.rows[0].id;
        if (role === "sales") {
          await client.query(
            `INSERT INTO sales_operator_settings (admin_user_id, display_name, active)
             VALUES ($1, $2, TRUE)
             ON CONFLICT (admin_user_id) DO NOTHING`,
            [userId, username]
          );
        }
        await client.query(
          `DELETE FROM sessions WHERE user_id = $1 AND role IN ('admin', 'sales')`,
          [userId]
        );
        await client.query(
          `DELETE FROM auth_tokens WHERE user_id = $1 AND email = $2 AND tenant_key IS NULL`,
          [userId, email]
        );
        await writeAuditLog(client, {
          actor: `admin:${session.user_id}`, action: "admin.user.saved",
          details: { userId, email, role, sessionsRevoked: true }
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "admin_users_error", message: err?.message || "unknown" });
  }
}
