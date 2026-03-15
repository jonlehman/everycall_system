import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

async function readMigrations(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const migrationsDir = path.join(process.cwd(), "migrations");
  const migrationNames = await readMigrations(migrationsDir);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureMigrationsTable(client);

    const appliedRes = await client.query(`SELECT name FROM schema_migrations`);
    const applied = new Set(appliedRes.rows.map((row) => String(row.name)));

    for (const migrationName of migrationNames) {
      if (applied.has(migrationName)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, migrationName), "utf8");
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (name) VALUES ($1)`,
        [migrationName]
      );
      console.log(`applied ${migrationName}`);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
