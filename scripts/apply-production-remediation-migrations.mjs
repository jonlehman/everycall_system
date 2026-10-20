import crypto from 'node:crypto';
import pg from 'pg';
import { applyRemediationMigrations } from './lib/schema-migrations.mjs';
import { ensureTables } from '../pages/api/_lib/db.js';

if (process.env.EVERYCALL_APPLY_PRODUCTION_REMEDIATION !== '1') throw new Error('EVERYCALL_APPLY_PRODUCTION_REMEDIATION=1 is required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const target = new URL(process.env.DATABASE_URL);
const fingerprint = crypto.createHash('sha256').update(target.hostname + target.pathname).digest('hex');
if (!process.env.EVERYCALL_DATABASE_TARGET_SHA256 || process.env.EVERYCALL_DATABASE_TARGET_SHA256 !== fingerprint) {
  throw new Error('EVERYCALL_DATABASE_TARGET_SHA256 must match the independently verified database target');
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
try {
  const applied = await applyRemediationMigrations(pool);
  await ensureTables(pool);
  console.log(JSON.stringify({ targetFingerprint: fingerprint, applied, schemaReady: true }));
} catch (error) {
  // Do not print connection credentials or SQL payloads on a failed deploy.
  console.error(JSON.stringify({ error: error.code || 'schema_migration_failed', message: error.message, missing: error.missing }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
