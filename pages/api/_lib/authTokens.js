import crypto from "crypto";

function normalizeText(value) {
  return String(value || "").trim();
}

function createOpaqueReference() {
  return `ref_${crypto.randomBytes(12).toString("hex")}`;
}

export function hashAuthToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function createRawAuthToken() {
  return crypto.randomBytes(24).toString("hex");
}

export async function issueAuthToken(pool, {
  tokenType,
  userId = null,
  email = null,
  tenantKey = null,
  expiresAt
}) {
  const rawToken = createRawAuthToken();
  await pool.query(
    `INSERT INTO auth_tokens (
       token,
       token_hash,
       token_type,
       user_id,
       email,
       tenant_key,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      createOpaqueReference(),
      hashAuthToken(rawToken),
      normalizeText(tokenType),
      userId,
      normalizeText(email).toLowerCase() || null,
      normalizeText(tenantKey) || null,
      expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt
    ]
  );
  return rawToken;
}

export async function revokeAuthTokens(pool, {
  tokenType = null,
  userId = null,
  email = null,
  tenantKey = null
} = {}) {
  const conditions = [];
  const values = [];
  if (normalizeText(tokenType)) {
    values.push(normalizeText(tokenType));
    conditions.push(`token_type = $${values.length}`);
  }
  if (userId !== null && userId !== undefined) {
    values.push(Number(userId));
    conditions.push(`user_id = $${values.length}`);
  }
  if (normalizeText(email)) {
    values.push(normalizeText(email).toLowerCase());
    conditions.push(`email = $${values.length}`);
  }
  if (normalizeText(tenantKey)) {
    values.push(normalizeText(tenantKey));
    conditions.push(`tenant_key = $${values.length}`);
  }
  if (!conditions.length) return;
  await pool.query(
    `DELETE FROM auth_tokens
     WHERE ${conditions.join(" AND ")}`,
    values
  );
}

export async function findAuthToken(pool, rawToken, { tokenType = null } = {}) {
  const normalizedToken = normalizeText(rawToken);
  if (!normalizedToken) return null;
  const conditions = [`(token_hash = $1 OR token = $2)`];
  const values = [hashAuthToken(normalizedToken), normalizedToken];
  if (normalizeText(tokenType)) {
    values.push(normalizeText(tokenType));
    conditions.push(`token_type = $${values.length}`);
  }
  const result = await pool.query(
    `SELECT id, token_type, user_id, email, tenant_key, expires_at, used_at, created_at
     FROM auth_tokens
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 1`,
    values
  );
  return result.rows[0] || null;
}

export async function consumeAuthToken(pool, rawToken, { tokenType = null } = {}) {
  const tokenRow = await findAuthToken(pool, rawToken, { tokenType });
  if (!tokenRow) return null;
  await pool.query(`DELETE FROM auth_tokens WHERE id = $1`, [tokenRow.id]);
  return tokenRow;
}
