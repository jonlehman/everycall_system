import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession, clearSessionCookie, clearSalesSessionCookie, isAdminRole } from "../../_lib/auth.js";
import { writeAuditLog } from "../../_lib/auditLog.js";
import { lockPlatformUserMutations, platformUserError } from "../../_lib/platformUsers.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "database_unavailable" });
    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    if (req.method === "GET") {
      const rows = await pool.query(`SELECT id, username, email, role, last_active_at FROM admin_users ORDER BY username ASC`);
      return res.status(200).json({ users: rows.rows });
    }
    if (!["POST", "PATCH"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST, PATCH");
      return res.status(405).json({ error: "method_not_allowed" });
    }
    const editing = req.method === "PATCH";
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const allowed = editing ? ["id", "email", "username", "role", "password"] : ["email", "username", "role", "password"];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw platformUserError(400, "unexpected_fields");
    if (["email", "username", "role", "password"].some(key => body[key] !== undefined && typeof body[key] !== "string")) throw platformUserError(400, "invalid_fields");
    const id = String(body.id ?? "");
    if (editing && (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n)) throw platformUserError(400, "invalid_user_id");
    const email = (body.email || "").trim().toLowerCase();
    const username = (body.username || "").trim() || (editing ? "" : email.split("@")[0]);
    const role = body.role || (editing ? "" : "admin");
    const password = body.password || "";
    if (!email || !username || (!editing && !password)) throw platformUserError(400, "missing_fields");
    if (email.length > 254 || !emailPattern.test(email)) throw platformUserError(400, "invalid_email");
    if (username.length > 100 || /[\u0000-\u001f\u007f]/.test(username)) throw platformUserError(400, "invalid_username");
    if (!["admin", "super_admin", "sales"].includes(role)) throw platformUserError(400, "invalid_role");
    if (password && password.length < 8) throw platformUserError(400, "password_too_short");
    if (Buffer.byteLength(password, "utf8") > 72) throw platformUserError(400, "password_too_long");
    const hash = password ? await bcrypt.hash(password, 10) : null;
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      await lockPlatformUserMutations(client);
      // Recheck the actual principal after waiting: a previously authorized request
      // must not mutate accounts after another edit revokes its session or role.
      const actor = await client.query(
        `SELECT u.id FROM admin_users u JOIN sessions s ON s.user_id = u.id
         WHERE s.id = $1 AND s.role = 'admin' AND s.tenant_key IS NULL
           AND s.expires_at > NOW() AND u.role IN ('admin', 'super_admin')
         FOR UPDATE OF u, s`, [session.id]
      );
      if (!actor.rowCount) throw platformUserError(401, "unauthorized");
      const existing = await client.query(
        `SELECT id, username, email, role, password_hash FROM admin_users
         WHERE ${editing ? "id = $1" : "email = $1"} FOR UPDATE`, [editing ? id : email]
      );
      const user = existing.rows[0];
      if (editing && !user) throw platformUserError(404, "user_not_found");
      const conflicts = await client.query(
        `SELECT email, username FROM admin_users WHERE ($3::bigint IS NULL OR id <> $3)
           AND (LOWER(email) = $1 OR LOWER(username) = LOWER($2))`, [email, username, user?.id || null]
      );
      if (conflicts.rows.some(row => row.email.toLowerCase() === email)) throw platformUserError(409, "email_in_use");
      if (conflicts.rowCount) throw platformUserError(409, "username_in_use");
      if (user && isAdminRole(user.role) && !isAdminRole(role)) {
        const others = await client.query(`SELECT email, password_hash FROM admin_users WHERE id <> $1 AND role IN ('admin', 'super_admin')`, [user.id]);
        if (!others.rows.some(other => emailPattern.test(other.email) && other.email === other.email.trim().toLowerCase() && passwordHashPattern.test(other.password_hash || "") && bcrypt.getRounds(other.password_hash) >= 4 && bcrypt.getRounds(other.password_hash) <= 31)) throw platformUserError(409, "last_admin_required");
      }
      const changedFields = user ? ["username", "email", "role"].filter(key => user[key] !== ({ username, email, role })[key]) : ["username", "email", "role"];
      if (hash) changedFields.push("password");
      const saved = user
        ? await client.query(`UPDATE admin_users SET username = $2, email = $3, role = $4, password_hash = COALESCE($5, password_hash) WHERE id = $1 RETURNING id, username, email, role`, [user.id, username, email, role, hash])
        : await client.query(`INSERT INTO admin_users (username, email, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role`, [username, email, role, hash]);
      const savedUser = saved.rows[0];
      if (role === "sales") {
        await client.query(`INSERT INTO sales_operator_settings (admin_user_id, display_name, active) VALUES ($1, $2, TRUE) ON CONFLICT (admin_user_id) DO NOTHING`, [savedUser.id, username]);
      }
      // Operator display names are separately configured. Preserve them, including
      // an old default, instead of guessing whether it was deliberately chosen.
      const sessionsRevoked = !editing || changedFields.some(key => ["email", "role", "password"].includes(key));
      if (sessionsRevoked) {
        await client.query(`DELETE FROM sessions WHERE user_id = $1 AND role IN ('admin', 'sales')`, [savedUser.id]);
        await client.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND email = $2 AND tenant_key IS NULL`, [savedUser.id, user?.email || email]);
      }
      await writeAuditLog(client, { actor: `admin:${session.user_id}`, action: editing ? "admin.user.updated" : "admin.user.saved", details: { userId: savedUser.id, changedFields, sessionsRevoked } });
      await client.query("COMMIT");
      result = { ok: true, user: savedUser, reauthenticate: sessionsRevoked && String(session.user_id) === String(savedUser.id) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    if (result.reauthenticate) {
      clearSessionCookie(res);
      clearSalesSessionCookie(res);
    }
    return res.status(200).json(result);
  } catch (error) {
    if (error.publicError) return res.status(error.status).json({ error: error.publicError });
    if (error.code === "23505") return res.status(409).json({ error: "email_in_use" });
    return res.status(500).json({ error: "admin_users_error" });
  }
}
