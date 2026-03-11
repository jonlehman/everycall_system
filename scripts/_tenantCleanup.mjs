import pg from "pg";
import { releaseVoiceNumber } from "../pages/api/_lib/telnyx.js";

const { Pool } = pg;

const TENANT_KEY_TABLES = [
  "call_events",
  "calls",
  "dispatch_queue",
  "faqs",
  "agent_versions",
  "agents",
  "routing_rules",
  "tenant_settings",
  "onboarding_intake",
  "audit_log",
  "billing_events",
  "billing_lifecycle_events",
  "notification_channel_health",
  "provisioning_jobs",
  "incidents",
  "tenant_billing_accounts",
  "auth_tokens",
  "sessions",
  "tenant_users",
  "tenants"
];

function getPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for tenant cleanup.");
  }
  return new Pool({ connectionString: databaseUrl });
}

export async function cleanupTenantByKey(tenantKey, { releaseNumber = true } = {}) {
  if (!tenantKey) return { tenantKey, deleted: false, reason: "missing_tenant_key" };

  const pool = getPool();
  const client = await pool.connect();
  try {
    const tenantRow = await client.query(
      `SELECT tenant_key, telnyx_voice_number
       FROM tenants
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    if (!tenantRow.rowCount) {
      return { tenantKey, deleted: false, reason: "not_found" };
    }

    const telnyxVoiceNumber = tenantRow.rows[0]?.telnyx_voice_number || null;

    await client.query("BEGIN");
    await client.query(
      `DELETE FROM call_details
       WHERE call_sid IN (
         SELECT call_sid
         FROM calls
         WHERE tenant_key = $1
       )`,
      [tenantKey]
    );
    for (const tableName of TENANT_KEY_TABLES) {
      await client.query(`DELETE FROM ${tableName} WHERE tenant_key = $1`, [tenantKey]);
    }
    await client.query("COMMIT");

    if (releaseNumber && telnyxVoiceNumber) {
      try {
        await releaseVoiceNumber({ phoneNumber: telnyxVoiceNumber });
      } catch {
        // Best effort. Tenant data is already deleted.
      }
    }

    return { tenantKey, deleted: true, releasedVoiceNumber: telnyxVoiceNumber || null };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function cleanupQaTenantsByNamePatterns(patterns, options = {}) {
  const names = Array.isArray(patterns) ? patterns.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (names.length === 0) return { matches: [], deleted: [] };

  const pool = getPool();
  try {
    const clauses = names.map((_, index) => `name ILIKE $${index + 1}`);
    const values = names.map((pattern) => pattern.includes("%") ? pattern : `${pattern}%`);
    const rows = await pool.query(
      `SELECT tenant_key, name
       FROM tenants
       WHERE ${clauses.join(" OR ")}
       ORDER BY name ASC`,
      values
    );

    const matches = rows.rows || [];
    const deleted = [];
    for (const row of matches) {
      deleted.push(await cleanupTenantByKey(row.tenant_key, options));
    }
    return { matches, deleted };
  } finally {
    await pool.end();
  }
}

export async function findQaTenantsByNamePatterns(patterns) {
  const names = Array.isArray(patterns) ? patterns.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (names.length === 0) return [];

  const pool = getPool();
  try {
    const clauses = names.map((_, index) => `name ILIKE $${index + 1}`);
    const values = names.map((pattern) => pattern.includes("%") ? pattern : `${pattern}%`);
    const rows = await pool.query(
      `SELECT tenant_key, name
       FROM tenants
       WHERE ${clauses.join(" OR ")}
       ORDER BY name ASC`,
      values
    );
    return rows.rows || [];
  } finally {
    await pool.end();
  }
}
