import crypto from "node:crypto";

const DEFAULT_APP_BASE_URL = "https://app.everycall.io";
const DEFAULT_CALL_ALERT_LINK_TTL_DAYS = Number.isFinite(Number(process.env.CALL_ALERT_LINK_TTL_DAYS))
  ? Math.max(1, Number(process.env.CALL_ALERT_LINK_TTL_DAYS))
  : 90;

function normalizeText(value) {
  return String(value || "").trim();
}

function createCallAlertToken() {
  return crypto.randomBytes(8).toString("base64url");
}

function getExpiresAt(expiresAt = null) {
  if (expiresAt instanceof Date && Number.isFinite(expiresAt.getTime())) {
    return expiresAt;
  }
  return new Date(Date.now() + DEFAULT_CALL_ALERT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function getCallAlertBaseUrl() {
  return normalizeText(process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/+$/, "") || DEFAULT_APP_BASE_URL;
}

export function buildCallAlertPath(token) {
  const normalizedToken = normalizeText(token);
  return normalizedToken ? `/c/${encodeURIComponent(normalizedToken)}` : "";
}

export function buildCallAlertUrl(token) {
  const path = buildCallAlertPath(token);
  return path ? `${getCallAlertBaseUrl()}${path}` : "";
}

export function buildDirectCallUrl(callSid) {
  const normalizedCallSid = normalizeText(callSid);
  if (!normalizedCallSid) return "";
  return `${getCallAlertBaseUrl()}/client/calls?callSid=${encodeURIComponent(normalizedCallSid)}`;
}

export async function issueCallAlertLink(pool, {
  tenantKey,
  callSid,
  expiresAt = null
}) {
  const normalizedTenantKey = normalizeText(tenantKey);
  const normalizedCallSid = normalizeText(callSid);
  if (!normalizedTenantKey || !normalizedCallSid) return null;

  const existing = await pool.query(
    `SELECT token
     FROM call_alert_links
     WHERE tenant_key = $1
       AND call_sid = $2
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedTenantKey, normalizedCallSid]
  );
  const existingToken = normalizeText(existing.rows[0]?.token);
  if (existingToken) return existingToken;

  const nextExpiresAt = getExpiresAt(expiresAt);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = createCallAlertToken();
    try {
      await pool.query(
        `INSERT INTO call_alert_links (
           token,
           tenant_key,
           call_sid,
           expires_at
         )
         VALUES ($1, $2, $3, $4)`,
        [token, normalizedTenantKey, normalizedCallSid, nextExpiresAt.toISOString()]
      );
      return token;
    } catch (err) {
      if (err?.code !== "23505") {
        throw err;
      }
    }
  }

  throw new Error("call_alert_link_issue_failed");
}

export async function findCallAlertLink(pool, rawToken) {
  const token = normalizeText(rawToken);
  if (!token) return null;
  const result = await pool.query(
    `SELECT token, tenant_key, call_sid, expires_at, created_at
     FROM call_alert_links
     WHERE token = $1
     LIMIT 1`,
    [token]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query(`DELETE FROM call_alert_links WHERE token = $1`, [token]);
    return null;
  }
  return row;
}
