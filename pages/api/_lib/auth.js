import crypto from "crypto";
import { getPool } from "./db.js";

const SESSION_COOKIE = "everycall_session";
const SESSION_TTL_DAYS = 7;

export function getSessionCookie(req) {
  const header = req.headers?.cookie || "";
  const cookies = Object.fromEntries(
    header.split(";").map((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return [part.trim(), ""];
      return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim())];
    })
  );
  return cookies[SESSION_COOKIE] || "";
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

export function setSessionCookie(res, sessionId) {
  const secure = process.env.NODE_ENV === "production";
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`
  );
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

export async function getSession(req) {
  const pool = getPool();
  if (!pool) return null;
  const sessionId = getSessionCookie(req);
  if (!sessionId) return null;
  const row = await pool.query(
    `SELECT id, user_id, tenant_key, role, expires_at
     FROM sessions
     WHERE id = $1`,
    [sessionId]
  );
  if (!row.rowCount) return null;
  const session = row.rows[0];
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    return null;
  }
  return session;
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
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

export function resolveTenantKey(session, requestedTenantKey) {
  if (session?.role === "admin") {
    return String(requestedTenantKey || "default");
  }
  return session?.tenant_key || String(requestedTenantKey || "default");
}
