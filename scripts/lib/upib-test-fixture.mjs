import crypto from 'node:crypto';
import pg from 'pg';
import { bootstrapFixtureSchema, migrationBody, readMigration } from './schema-migrations.mjs';

// Integration fixtures never fall back to DATABASE_URL or a production env file.
export async function createUpibTestFixture({
  databaseUrl = process.env.EVERYCALL_TEST_POSTGRES_URL,
  label = 'journey',
  migrations = ['0063_unified_paid_intake.sql', '0064_paid_billing_lifecycle.sql']
} = {}) {
  if (!databaseUrl) throw Error('EVERYCALL_TEST_POSTGRES_URL is required');
  const target = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw Error('UPIB fixtures require a disposable loopback PostgreSQL database');
  }
  const prefix = String(label).replace(/[^a-z0-9]/gi, '').slice(0, 20).toLowerCase() || 'journey';
  const schema = `upib_${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  const options = { connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 15000 };
  const admin = new pg.Pool({ ...options, max: 1 });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ ...options, max: 12, options: `-c search_path=${schema},public` });
    await bootstrapFixtureSchema(pool, { includePaidBilling: false });
    for (const name of migrations) {
      const receipt = await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (receipt.rowCount) continue;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migrationBody(await readMigration(name)));
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    let closed = false;
    return {
      pool,
      schema,
      databaseUrl,
      async close() {
        if (closed) return;
        closed = true;
        await pool.end();
        try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
        finally { await admin.end(); }
      }
    };
  } catch (error) {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end();
    throw error;
  }
}
