import fs from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const MIGRATION_NAMES = [
  "0039_automatic_core_fact_pins.sql",
  "0040_event_driven_core_fact_sections.sql"
];
const APPLY_ENV = "EVERYCALL_APPLY_CORE_FACT_MIGRATION";

async function main() {
  if (String(process.env[APPLY_ENV] || "").trim() !== "1") {
    throw new Error(`${APPLY_ENV}=1 is required`);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const actions = [];
    for (const migrationName of MIGRATION_NAMES) {
      const existing = await client.query(
        `SELECT name FROM schema_migrations WHERE name = $1 LIMIT 1`,
        [migrationName]
      );
      if (existing.rowCount) {
        actions.push({ migration: migrationName, action: "already_applied" });
        continue;
      }
      const sql = await fs.readFile(new URL(`../migrations/${migrationName}`, import.meta.url), "utf8");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [migrationName]);
      actions.push({ migration: migrationName, action: "applied" });
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ actions }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
