import pg from "pg";
import { backfillActiveBuildCoreFacts } from "../pages/api/_lib/knowledgeCoreFacts.js";
import { rewriteCompanyDescriptionForSpokenRegister } from "../pages/api/_lib/promptBlueprints.js";

const { Pool } = pg;
const APPLY_ENV = "EVERYCALL_APPLY_CORE_FACT_BACKFILL";
const SCOPE_ENV = "EVERYCALL_CORE_FACT_BACKFILL_SCOPE";
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

async function backfillCompanyDescriptions(pool, { apply }) {
  const result = await pool.query(
    `SELECT t.tenant_key,
            t.name AS business_name,
            NULLIF(BTRIM(tp.company_description), '') AS prompt_company_description,
            NULLIF(BTRIM(bp.company_description), '') AS bootstrap_company_description
     FROM tenants t
     LEFT JOIN tenant_prompt_profiles tp
       ON tp.tenant_key = t.tenant_key
     LEFT JOIN tenant_bootstrap_profiles bp
       ON bp.tenant_key = t.tenant_key
     WHERE COALESCE(
       NULLIF(BTRIM(tp.company_description), ''),
       NULLIF(BTRIM(bp.company_description), '')
     ) IS NOT NULL
     ORDER BY t.tenant_key ASC`
  );
  const runs = [];
  for (const row of result.rows || []) {
    const source = normalizeText(row.prompt_company_description || row.bootstrap_company_description);
    console.error(JSON.stringify({
      event: "company_description_backfill_tenant_started",
      tenantKey: row.tenant_key,
      sourceCharacters: source.length,
      mode: apply ? "apply" : "dry_run"
    }));
    const rewritten = await rewriteCompanyDescriptionForSpokenRegister({
      businessName: row.business_name,
      companyDescription: source
    });
    const needsCanonicalSnapshot = !normalizeText(row.prompt_company_description);
    const changed = rewritten !== source;
    if (apply && rewritten && (changed || needsCanonicalSnapshot)) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO tenant_prompt_profiles (
             tenant_key, company_description, updated_by_id, updated_at
           )
           VALUES ($1, $2, 'system:spoken_company_description_backfill', NOW())
           ON CONFLICT (tenant_key)
           DO UPDATE SET company_description = EXCLUDED.company_description,
                         updated_by_id = EXCLUDED.updated_by_id,
                         updated_at = NOW()`,
          [row.tenant_key, rewritten]
        );
        await client.query(
          `INSERT INTO audit_log (tenant_key, actor, action, details)
           VALUES ($1, 'system:spoken_company_description_backfill', $2, $3::jsonb)`,
          [
            row.tenant_key,
            "tenant.prompt_profile.company_description_spoken_backfill",
            JSON.stringify({ changed, canonical_snapshot_created: needsCanonicalSnapshot })
          ]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    const run = {
      tenantKey: row.tenant_key,
      action: apply
        ? (changed || needsCanonicalSnapshot ? "applied" : "skipped_no_change")
        : "planned",
      changed,
      canonicalSnapshotCreated: needsCanonicalSnapshot,
      sourceCharacters: source.length,
      resultCharacters: rewritten.length
    };
    runs.push(run);
    console.error(JSON.stringify({ event: "company_description_backfill_tenant_completed", ...run }));
  }
  return runs;
}

async function main() {
  const databaseUrl = normalizeText(process.env.DATABASE_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const apply = normalizeText(process.env[APPLY_ENV]) === "1";
  const replaceExisting = normalizeText(process.env[REPLACE_ENV]) === "1";
  const targetTenant = normalizeText(process.env[TARGET_TENANT_ENV]);
  const scope = normalizeText(process.env[SCOPE_ENV]) || "all";
  if (!["all", "core_facts", "company_descriptions"].includes(scope)) {
    throw new Error(`${SCOPE_ENV} must be all, core_facts, or company_descriptions`);
  }
  const includeCoreFacts = scope === "all" || scope === "core_facts";
  const includeCompanyDescriptions = scope === "all" || scope === "company_descriptions";
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await assertMigrationApplied(pool);
    const activeBuilds = includeCoreFacts ? await pool.query(
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
    ) : { rows: [] };
    const coreFactRuns = [];
    const selectedActiveBuilds = (activeBuilds.rows || []).filter((row) =>
      !targetTenant || normalizeText(row.tenant_key) === targetTenant
    );
    if (includeCoreFacts && targetTenant && selectedActiveBuilds.length === 0) {
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
    const companyDescriptionRuns = includeCompanyDescriptions
      ? await backfillCompanyDescriptions(pool, { apply })
      : [];
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry_run",
      scope,
      applyEnvironmentVariable: APPLY_ENV,
      replaceExisting,
      targetTenant: targetTenant || null,
      coreFactRuns,
      companyDescriptionRuns
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
