import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

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
        `SELECT username, email, role, last_active_at
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
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO admin_users (username, email, role, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email)
         DO UPDATE SET username = EXCLUDED.username,
                       role = EXCLUDED.role,
                       password_hash = EXCLUDED.password_hash`,
        [username, email, role, hash]
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "admin_users_error", message: err?.message || "unknown" });
  }
}
