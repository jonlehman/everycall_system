import { getPool } from "./db.js";
import { releaseVoiceNumber } from "./telnyx.js";

const TENANT_KEY_TABLES = [
  "runtime_bundles",
  "call_states",
  "knowledge_coverage_events",
  "knowledge_build_source_artifacts",
  "knowledge_build_source_summaries",
  "knowledge_build_analysis_batches",
  "source_intake_persistence_batches",
  "source_intake_items",
  "knowledge_build_fact_vectors",
  "knowledge_build_card_vectors",
  "knowledge_build_cards",
  "knowledge_build_facts",
  "knowledge_build_subtopics",
  "knowledge_build_topics",
  "source_chunks",
  "source_segments",
  "source_refs",
  "source_intake_sessions",
  "tenant_active_knowledge_builds",
  "knowledge_builds",
  "uploaded_documents",
  "knowledge_guardrails",
  "knowledge_overrides",
  "knowledge_runtime_profiles",
  "knowledge_readiness_states",
  "call_outcome_schemas",
  "setup_interview_summary_blocks",
  "setup_interview_sessions",
  "setup_interview_intents",
  "business_call_intents",
  "tenant_domain_assignments",
  "call_events",
  "calls",
  "dispatch_queue",
  "routing_rules",
  "tenant_business_hours",
  "tenant_settings",
  "tenant_bootstrap_profiles",
  "onboarding_intake",
  "audit_log",
  "billing_events",
  "billing_lifecycle_events",
  "notification_channel_health",
  "lead_notification_deliveries",
  "async_jobs",
  "sms_failover_events",
  "provisioning_jobs",
  "incidents",
  "tenant_billing_accounts",
  "auth_tokens",
  "sessions",
  "tenant_users",
  "tenants"
];

export const QA_TENANT_PATTERNS = {
  name: ["ClientUI QA %", "Intake QA %", "Collision QA %"],
  tenantKey: ["clientui_e2e_%", "intake_e2e_%", "dbg_%", "clientui_qa_%", "intake_qa_%", "collision_qa_%"]
};

export async function cleanupTenantByKey(tenantKey, { releaseNumber = true } = {}) {
  if (!tenantKey) return { tenantKey, deleted: false, reason: "missing_tenant_key" };

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required for tenant cleanup.");
  }

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
  }
}

export async function findQaTenants(patterns = QA_TENANT_PATTERNS) {
  const namePatterns = Array.isArray(patterns?.name) ? patterns.name.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const tenantKeyPatterns = Array.isArray(patterns?.tenantKey) ? patterns.tenantKey.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (namePatterns.length === 0 && tenantKeyPatterns.length === 0) return [];

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required for tenant cleanup.");
  }

  const values = [];
  const clauses = [];
  for (const pattern of namePatterns) {
    values.push(pattern.includes("%") ? pattern : `${pattern}%`);
    clauses.push(`name ILIKE $${values.length}`);
  }
  for (const pattern of tenantKeyPatterns) {
    values.push(pattern.includes("%") ? pattern : `${pattern}%`);
    clauses.push(`tenant_key ILIKE $${values.length}`);
  }
  const rows = await pool.query(
    `SELECT tenant_key, name
     FROM tenants
     WHERE ${clauses.join(" OR ")}
     ORDER BY name ASC`,
    values
  );
  return rows.rows || [];
}

export async function cleanupQaTenants(patterns = QA_TENANT_PATTERNS, options = {}) {
  const matches = await findQaTenants(patterns);
  const deleted = [];
  for (const row of matches) {
    deleted.push(await cleanupTenantByKey(row.tenant_key, options));
  }
  return { matches, deleted };
}
