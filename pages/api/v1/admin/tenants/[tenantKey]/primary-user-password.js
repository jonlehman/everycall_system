import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";

function actorId(actor, session) {
  if (actor?.id) {
    return `admin:${actor.id}`;
  }
  if (session?.user_id) {
    return `admin:${session.user_id}`;
  }
  return "admin:unknown";
}

async function writeAuditLog(pool, { tenantKey, actor, session, action, details }) {
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [tenantKey, actorId(actor, session), action, JSON.stringify(details || {})]
  );
}

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
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = String(req.query?.tenantKey || "").trim();
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const password = String(body.password || "");
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "invalid_password", message: "Password must be at least 8 characters." });
    }

    const userRes = await pool.query(
      `SELECT id, tenant_key, email, name, role, status
       FROM tenant_users
       WHERE tenant_key = $1
       ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [tenantKey]
    );
    const primaryUser = userRes.rows[0] || null;
    if (!primaryUser) {
      return res.status(404).json({ error: "primary_user_not_found", message: "No tenant user exists for this tenant." });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE tenant_users
       SET password_hash = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [hash, primaryUser.id]
    );

    await writeAuditLog(pool, {
      tenantKey,
      actor: admin,
      session,
      action: "admin.tenant.primary_user_password_set",
      details: {
        target_user_id: primaryUser.id,
        target_user_email: primaryUser.email,
        target_user_role: primaryUser.role
      }
    });

    return res.status(200).json({
      ok: true,
      user: {
        id: primaryUser.id,
        email: primaryUser.email,
        name: primaryUser.name,
        role: primaryUser.role,
        status: primaryUser.status
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_primary_user_password_error",
      message: err?.message || "unknown"
    });
  }
}
