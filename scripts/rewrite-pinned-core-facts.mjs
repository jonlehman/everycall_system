import pg from "pg";
import { rewriteActivePinnedCoreFactsForSpeech } from "../pages/api/_lib/knowledgeCoreFacts.js";

const { Pool } = pg;
const APPLY_ENV = "EVERYCALL_REWRITE_PINNED_CORE_FACTS";
const TARGET_TENANT_ENV = "EVERYCALL_PINNED_CORE_FACT_TENANT";

function normalizeText(value) {
  return String(value || "").trim();
}

async function assertMigrationApplied(pool) {
  const result = await pool.query(
    `SELECT COUNT(*)::int = 3 AS ready
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'knowledge_build_facts'
       AND column_name IN (
         'core_fact_spoken_version',
         'core_fact_spoken_model',
         'core_fact_spoken_at'
       )`
  );
  if (result.rows?.[0]?.ready !== true) {
    throw new Error("core_fact_spoken_rewrite_migration_0042_required");
  }
}

async function main() {
  const databaseUrl = normalizeText(process.env.DATABASE_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (normalizeText(process.env[APPLY_ENV]) !== "1") {
    throw new Error(`${APPLY_ENV}=1 is required`);
  }
  const tenantKey = normalizeText(process.env[TARGET_TENANT_ENV]);
  if (!tenantKey) throw new Error(`${TARGET_TENANT_ENV} is required`);

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await assertMigrationApplied(pool);
    const result = await rewriteActivePinnedCoreFactsForSpeech(pool, {
      tenantKey,
      apply: true,
      allowModelRewrite: true,
      onUnsafeRewrite: (diagnostic) => {
        console.error(JSON.stringify({ event: "pinned_core_fact_rewrite_rejected", ...diagnostic }));
      }
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
