import pg from "pg";
import { backfillActiveBuildCoreFacts } from "../pages/api/_lib/knowledgeCoreFacts.js";

const { Pool } = pg;
const APPLY_ENV = "EVERYCALL_APPLY_CORE_FACT_BACKFILL";
const REPLACE_ENV = "EVERYCALL_RESELECT_EXISTING_CORE_FACTS";
const TARGET_TENANT_ENV = "EVERYCALL_CORE_FACT_BACKFILL_TENANT";

function normalizeText(value) {
  return String(value || "").trim();
}

async function assertMigrationApplied(pool) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'knowledge_build_facts'
         AND column_name = 'is_core_fact_pinned'
     ) AS ready`
  );
  if (result.rows?.[0]?.ready !== true) {
    throw new Error("migration_0039_required_run_pnpm_db_migrate_first");
  }
}

async function main() {
  const databaseUrl = normalizeText(process.env.DATABASE_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const apply = normalizeText(process.env[APPLY_ENV]) === "1";
  const replaceExisting = normalizeText(process.env[REPLACE_ENV]) === "1";
  const targetTenant = normalizeText(process.env[TARGET_TENANT_ENV]);
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await assertMigrationApplied(pool);
    const activeBuilds = await pool.query(
      `SELECT pointer.tenant_key,
              pointer.active_build_id,
              COUNT(facts.knowledge_fact_id)::int AS fact_count,
              COUNT(facts.knowledge_fact_id) FILTER (WHERE facts.is_core_fact_pinned = TRUE)::int AS pin_count
       FROM tenant_active_knowledge_builds pointer
       LEFT JOIN knowledge_build_facts facts
         ON facts.tenant_key = pointer.tenant_key
        AND facts.build_id = pointer.active_build_id
       GROUP BY pointer.tenant_key, pointer.active_build_id
       ORDER BY pointer.tenant_key ASC`
    );
    const coreFactRuns = [];
    const selectedActiveBuilds = (activeBuilds.rows || []).filter((row) =>
      !targetTenant || normalizeText(row.tenant_key) === targetTenant
    );
    if (targetTenant && selectedActiveBuilds.length === 0) {
      throw new Error(`active_core_fact_build_not_found:${targetTenant}`);
    }
    for (const row of selectedActiveBuilds) {
      console.error(JSON.stringify({
        event: "core_fact_backfill_tenant_started",
        tenantKey: row.tenant_key,
        factCount: Number(row.fact_count || 0),
        existingPinCount: Number(row.pin_count || 0),
        mode: apply ? "apply" : "dry_run"
      }));
      const run = await backfillActiveBuildCoreFacts(pool, {
        tenantKey: row.tenant_key,
        buildId: row.active_build_id,
        apply,
        replaceExisting
      });
      coreFactRuns.push(run);
      console.error(JSON.stringify({ event: "core_fact_backfill_tenant_completed", ...run }));
    }
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry_run",
      applyEnvironmentVariable: APPLY_ENV,
      replaceExisting,
      targetTenant: targetTenant || null,
      coreFactRuns
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
