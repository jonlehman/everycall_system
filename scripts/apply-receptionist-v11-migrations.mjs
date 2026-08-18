import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const REQUIRED_APPROVAL = "EVERYCALL_APPLY_RECEPTIONIST_V11_MIGRATIONS";
const MIGRATIONS = [
  "0041_persist_no_tool_statement.sql",
  "0042_core_fact_spoken_rewrites.sql"
];

function normalizeText(value) {
  return String(value || "").trim();
}

async function main() {
  if (normalizeText(process.env[REQUIRED_APPROVAL]) !== "1") {
    throw new Error(`${REQUIRED_APPROVAL}=1 is required`);
  }
  const databaseUrl = normalizeText(process.env.DATABASE_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    for (const migrationName of MIGRATIONS) {
      const applied = await client.query(
        `SELECT 1 FROM schema_migrations WHERE name = $1`,
        [migrationName]
      );
      if (applied.rowCount) {
        console.log(`already applied ${migrationName}`);
        continue;
      }
      const sql = await fs.readFile(path.join(process.cwd(), "migrations", migrationName), "utf8");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [migrationName]);
      console.log(`applied ${migrationName}`);
    }
    await client.query("COMMIT");
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
