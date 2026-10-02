import crypto from "crypto";
import { getPool } from "./db.js";

const SESSION_COOKIE = "everycall_session";
const SALES_SESSION_COOKIE = "everycall_sales_session";
const SESSION_TTL_DAYS = 7;

export function isAdminRole(role) {
  return role === "admin" || role === "super_admin";
}

function readCookie(req, name) {
  const header = req.headers?.cookie || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1 || part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function getSessionCookie(req) {
  return readCookie(req, SESSION_COOKIE);
}

export function getSalesSessionCookie(req) {
  return readCookie(req, SALES_SESSION_COOKIE);
}

export function hasSalesSessionCookie(req) {
  return String(req.headers?.cookie || "").split(";").some((part) =>
    part.split("=", 1)[0].trim() === SALES_SESSION_COOKIE
  );
}

export function clearSessionCookie(res) {
  writeSessionCookie(res, SESSION_COOKIE, "", 0);
}

function writeSessionCookie(res, name, sessionId, maxAge) {
  const secure = process.env.NODE_ENV === "production";
  const cookie = `${name}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const existing = res.getHeader?.("Set-Cookie");
  res.setHeader("Set-Cookie", existing ? [...(Array.isArray(existing) ? existing : [existing]), cookie] : cookie);
}

export function setSessionCookie(res, sessionId) {
  writeSessionCookie(res, SESSION_COOKIE, sessionId, SESSION_TTL_DAYS * 24 * 60 * 60);
}

export function setSalesSessionCookie(res, sessionId) {
  writeSessionCookie(res, SALES_SESSION_COOKIE, sessionId, SESSION_TTL_DAYS * 24 * 60 * 60);
}

export function clearSalesSessionCookie(res) {
  writeSessionCookie(res, SALES_SESSION_COOKIE, "", 0);
}

export async function createSession({ userId, tenantKey, role }) {
  const pool = getPool();
  if (!pool) return null;
  const sessionId = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (id, user_id, tenant_key, role, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, userId, tenantKey || null, role, expiresAt.toISOString()]
  );
  return sessionId;
}

export async function deleteSessionsForPrincipal({ userId, role, tenantKey = null }) {
  const pool = getPool();
  if (!pool || !userId || !role) return;
  const values = [userId, role];
  const conditions = [`user_id = $1`, `role = $2`];
  if (tenantKey !== null && tenantKey !== undefined) {
    values.push(tenantKey);
    conditions.push(`tenant_key = $${values.length}`);
  }
  await pool.query(
    `DELETE FROM sessions
     WHERE ${conditions.join(" AND ")}`,
    values
  );
}

async function findSession(sessionId) {
  const pool = getPool();
  if (!pool) return null;
  if (!sessionId) return null;
  const row = await pool.query(
    `SELECT id, user_id, tenant_key, role, expires_at
     FROM sessions
     WHERE id = $1`,
    [sessionId]
  );
  if (!row.rowCount) return null;
  const session = row.rows[0];
  const expiresAt = new Date(session.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    return null;
  }
  return session;
}

export async function getSession(req) {
  const session = await findSession(getSessionCookie(req));
  // Cookie names are not an authorization boundary: reject a copied sales ID.
  if (!session || !["admin", "tenant"].includes(session.role)) return null;
  if (session.role === "admin" && !await getAdminActor(session)) return null;
  return session;
}

export async function getSalesSession(req) {
  const session = await findSession(getSalesSessionCookie(req));
  if (!session || session.role !== "sales" || session.tenant_key) return null;
  const pool = getPool();
  const result = await pool.query(
    `SELECT u.id, u.username, u.email, u.role
     FROM admin_users u
     JOIN sales_operator_settings settings ON settings.admin_user_id = u.id
     WHERE u.id = $1 AND u.role = 'sales'
       AND settings.active = TRUE
     LIMIT 1`,
    [session.user_id]
  );
  const user = result.rows[0];
  if (!user || user.role !== "sales") return null;
  return { ...session, user };
}

export async function requireSession(req, res, options = {}) {
  const session = await getSession(req);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  if (options.role && session.role !== options.role) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return session;
}

export async function deleteSession(req) {
  const pool = getPool();
  if (!pool) return;
  const sessionId = getSessionCookie(req);
  if (!sessionId) return;
  await pool.query(`DELETE FROM sessions WHERE id = $1 AND role IN ('admin', 'tenant')`, [sessionId]);
}

export async function deleteSalesSession(req) {
  const pool = getPool();
  const sessionId = getSalesSessionCookie(req);
  if (!pool || !sessionId) return;
  await pool.query(`DELETE FROM sessions WHERE id = $1 AND role = 'sales'`, [sessionId]);
}

export function resolveTenantKey(session, requestedTenantKey) {
  if (session?.role === "admin") {
    return String(requestedTenantKey || "default");
  }
  return session?.tenant_key || String(requestedTenantKey || "default");
}

export async function getAdminActor(session) {
  if (!session || session.role !== "admin") return null;
  const pool = getPool();
  if (!pool) return null;
  const row = await pool.query(
    `SELECT id, email, role
     FROM admin_users
     WHERE id = $1
     LIMIT 1`,
    [session.user_id]
  );
  const user = row.rows[0];
  return user && isAdminRole(user.role) ? user : null;
}
