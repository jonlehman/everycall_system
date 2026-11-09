import bcrypt from "bcryptjs";
import { isAdminRole } from "./auth.js";
import { buildAuditActor, writeAuditLog } from "./auditLog.js";
import { lockPlatformUserMutations } from "./platformUsers.js";

function fail(status, error, message) {
  throw Object.assign(new Error(message), { status, publicError: error });
}

// Only tenant-owned credentials are removed. Historical tokens without a tenant
// may belong to independently numbered platform users; never guess on collisions.
export async function revokeTenantCredentials(client, user) {
  await client.query(`DELETE FROM sessions WHERE user_id = $1 AND role = 'tenant' AND tenant_key = $2`, [user.id, user.tenant_key]);
  await client.query(
    `DELETE FROM auth_tokens WHERE user_id = $1 AND
       (tenant_key = $2 OR (tenant_key IS NULL AND email = $3
         AND token_type = 'password_reset'
         AND NOT EXISTS (SELECT 1 FROM admin_users WHERE id = $1 AND email = $3)))`,
    [user.id, user.tenant_key, user.email]
  );
}

export async function setTenantUserPassword(pool, session, tenantKey, body) {
  if (Object.keys(body).some(key => !["action", "id", "password"].includes(key))) fail(400, "invalid_fields", "Only the user and new password may be changed here.");
  const id = String(body.id || "");
  if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) fail(400, "invalid_user_id", "Select a valid user.");
  if (typeof body.password !== "string" || body.password.length < 8) fail(400, "password_too_short", "Use at least 8 characters.");
  if (Buffer.byteLength(body.password, "utf8") > 72) fail(400, "password_too_long", "Use a password of at most 72 UTF-8 bytes.");
  const hash = await bcrypt.hash(body.password, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (session.role === "admin") await lockPlatformUserMutations(client);
    // Serialize reciprocal manager resets before taking either tenant user row.
    await client.query("SELECT pg_advisory_xact_lock(200705, hashtext($1))", [tenantKey]);
    let actor;
    if (session.role === "admin") {
      actor = await client.query(`SELECT u.id, u.role FROM admin_users u JOIN sessions s ON s.user_id = u.id
        WHERE s.id = $1 AND s.role = 'admin' AND s.tenant_key IS NULL AND s.expires_at > NOW()
        FOR UPDATE OF u, s`, [session.id]);
      if (!isAdminRole(actor.rows[0]?.role)) fail(401, "unauthorized", "Sign in again before changing a password.");
    } else {
      actor = await client.query(`SELECT u.id, u.role FROM tenant_users u JOIN sessions s ON s.user_id = u.id AND s.tenant_key = u.tenant_key
        WHERE s.id = $1 AND s.role = 'tenant' AND s.tenant_key = $2 AND s.expires_at > NOW()
          AND u.status = 'active' AND u.role IN ('owner', 'admin') FOR UPDATE OF u, s`, [session.id, tenantKey]);
      if (!actor.rowCount) fail(401, "unauthorized", "Sign in again with an account owner or admin account.");
    }
    const result = await client.query(`SELECT id, email, tenant_key, status FROM tenant_users WHERE id = $1 AND tenant_key = $2 FOR UPDATE`, [id, tenantKey]);
    const user = result.rows[0];
    if (!user) fail(404, "not_found", "User not found.");
    if (user.status !== "active") fail(409, "user_not_active", "Enable this user's access or complete their invitation before setting a password.");
    await client.query(`UPDATE tenant_users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND tenant_key = $3`, [hash, user.id, tenantKey]);
    await revokeTenantCredentials(client, user);
    await writeAuditLog(client, { tenantKey, actor: buildAuditActor({ session }), action: "tenant.team_user.password_updated", details: { user_id: user.id, sessions_revoked: true } });
    await client.query("COMMIT");
    return { ok: true, reauthenticate: session.role === "tenant" && String(session.user_id) === String(user.id) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
