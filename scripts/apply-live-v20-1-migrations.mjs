import fs from 'node:fs/promises';
import pg from 'pg';

const names = ['0049_live_prompt_settings.sql', '0050_live_brief_curation.sql'];
if (process.env.EVERYCALL_APPLY_LIVE_V201_MIGRATIONS !== '1') {
  throw new Error('EVERYCALL_APPLY_LIVE_V201_MIGRATIONS=1 is required');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  for (const name of names) {
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rowCount) continue;
    const sql = await fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    process.stdout.write(`applied ${name}\n`);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
