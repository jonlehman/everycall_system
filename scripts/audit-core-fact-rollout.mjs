import fs from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const [appliedResult, overrideResult, columnResult] = await Promise.all([
      pool.query(`SELECT name FROM schema_migrations ORDER BY name ASC`),
      pool.query(
        `SELECT pb.version,
                COUNT(*)::int AS override_count,
                COUNT(DISTINCT overrides.tenant_key)::int AS tenant_count
         FROM tenant_prompt_section_overrides overrides
         JOIN prompt_blueprints pb
           ON pb.prompt_blueprint_id = overrides.prompt_blueprint_id
         WHERE pb.blueprint_key = $1
           AND pb.version IN (8, 9)
         GROUP BY pb.version
         ORDER BY pb.version ASC`,
        ["canonical_receptionist"]
      ),
      pool.query(
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'knowledge_build_facts'
             AND column_name = 'is_core_fact_pinned'
         ) AS core_fact_columns_ready`
      )
    ]);
    const migrationNames = (await fs.readdir(new URL("../migrations", import.meta.url)))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const applied = new Set((appliedResult.rows || []).map((row) => String(row.name)));
    console.log(JSON.stringify({
      pendingMigrations: migrationNames.filter((name) => !applied.has(name)),
      promptOverrideCounts: overrideResult.rows || [],
      coreFactColumnsReady: columnResult.rows?.[0]?.core_fact_columns_ready === true
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
