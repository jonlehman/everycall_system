import crypto from "crypto";
import { lockPlatformUserMutations } from "./platformUsers.js";

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
  // Lock the immutable invitee before replacing invitations. Acceptance and user
  // mutations use the same row, so disabling/deleting cannot race issuance.
  const boundType = normalizeText(tokenType);
  if (boundType === "invite" || boundType === "account_setup") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const invitee = await client.query(
        `SELECT id FROM tenant_users
         WHERE tenant_key = $1 AND email = $2
           AND (($4 = 'invite' AND status = 'invited')
             OR ($4 = 'account_setup' AND status = 'active' AND password_hash IS NULL))
           AND ($3::bigint IS NULL OR id = $3::bigint)
         FOR UPDATE`,
        [normalizeText(tenantKey), normalizeText(email).toLowerCase(), userId, boundType]
      );
      if (!invitee.rowCount) throw new Error("invitee_not_invited");
      const id = invitee.rows[0].id;
      await revokeAuthTokens(client, { tokenType: "invite", userId: id });
      await revokeAuthTokens(client, { tokenType: "account_setup", userId: id });
      const rawToken = createRawAuthToken();
      await client.query(
        `INSERT INTO auth_tokens (token, token_hash, token_type, user_id, email, tenant_key, expires_at)
         VALUES ($1, $2, $7, $3, $4, $5, $6)`,
        [createOpaqueReference(), hashAuthToken(rawToken), id, normalizeText(email).toLowerCase(),
          normalizeText(tenantKey), expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt, boundType]
      );
      await client.query("COMMIT");
      return rawToken;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
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

// The caller read the account before hashing/queueing. Validate that snapshot
// under the same lock as platform edits before issuing a new reset credential.
export async function issuePlatformPasswordReset(pool, user, expiresAt) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockPlatformUserMutations(client);
    const result = await client.query(`SELECT id, email, role, password_hash FROM admin_users WHERE id = $1 FOR UPDATE`, [user.id]);
    const current = result.rows[0];
    const ambiguous = await client.query(`SELECT id FROM tenant_users WHERE id = $1 AND email = $2`, [user.id, user.email]);
    if (!current || current.email !== user.email || current.role !== user.role || current.password_hash !== user.password_hash
      || !["admin", "super_admin"].includes(current.role) || ambiguous.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(`DELETE FROM auth_tokens WHERE token_type = 'password_reset' AND user_id = $1 AND email = $2 AND tenant_key IS NULL`, [user.id, user.email]);
    const token = await issueAuthToken(client, { tokenType: "password_reset", userId: user.id, email: user.email, expiresAt });
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

// Fence reset requests that started before a manager changed the password.
export async function issueTenantPasswordReset(pool, user, expiresAt) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT id, email, tenant_key, password_hash FROM tenant_users WHERE id = $1 AND tenant_key = $2 FOR UPDATE`, [user.id, user.tenant_key]);
    const current = result.rows[0];
    if (!current || current.email !== user.email || current.password_hash !== user.password_hash) {
      await client.query("ROLLBACK"); return null;
    }
    await revokeAuthTokens(client, { tokenType: "password_reset", userId: user.id, tenantKey: user.tenant_key });
    const token = await issueAuthToken(client, { tokenType: "password_reset", userId: user.id, email: user.email, tenantKey: user.tenant_key, expiresAt });
    await client.query("COMMIT");
    return token;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
