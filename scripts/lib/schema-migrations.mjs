import fs from 'node:fs/promises';
import { ensureTables } from '../../pages/api/_lib/db.js';
import { REQUIRED_SCHEMA_MIGRATIONS } from '../../pages/api/_lib/schemaReadiness.js';

export const REMEDIATION_MIGRATIONS = REQUIRED_SCHEMA_MIGRATIONS;
export const BASELINE_MIGRATION = '0055_explicit_schema_baseline.sql';
export const readMigration = name => fs.readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

// Only remove the outer wrapper. PL/pgSQL BEGIN/END blocks remain untouched.
// Reviewed migrations are either unwrapped or have exactly this outer pair.
export function migrationBody(sql) {
  const start = /^((?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*)BEGIN\s*;/i;
  if (!start.test(sql)) return sql;
  if (!/COMMIT\s*;\s*$/i.test(sql)) throw new Error('migration_transaction_wrapper_invalid');
  return sql.replace(start, '$1').replace(/COMMIT\s*;\s*$/i, '');
}

// This entrypoint deliberately never scans or replays the historical directory.
// The outer transaction contains every schema change and its migration receipt.
export async function applyRemediationMigrations(pool) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1763910417)');
    const baseline = await client.query("SELECT name FROM schema_migrations WHERE name = '0050_live_brief_curation.sql'");
    if (!baseline.rows.length) throw new Error('reviewed_0050_baseline_receipt_required');
    for (const name of REMEDIATION_MIGRATIONS) {
      const existing = await client.query('SELECT name FROM schema_migrations WHERE name = $1', [name]);
      if (existing.rows.length) continue;
      await client.query(migrationBody(await readMigration(name)));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      applied.push(name);
    }
    // A fresh wrapper prevents a prior successful client check from hiding drift.
    await ensureTables({ query: (sql, params) => client.query(sql, params) });
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Explicit baseline for an empty development database before historical schema
// migrations. It has no runtime importers and makes no migration-history claims.
export async function bootstrapSchemaBaseline(pool, { executeSql = sql => pool.query(sql) } = {}) {
  await executeSql(await readMigration(BASELINE_MIGRATION));
}

// Minimal, real migration-backed schema for offline sales/API fixtures. It does
// not provision pgvector or certify the complete knowledge-runtime schema.
// Never use against an existing database: that is the deploy runner's job.
export async function bootstrapFixtureSchema(pool, { executeSql = sql => pool.query(sql) } = {}) {
  const existing = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()");
  if (existing.rows.length) throw new Error('fixture_bootstrap_requires_empty_schema');
  await executeSql('BEGIN');
  try {
    await bootstrapSchemaBaseline(pool, { executeSql });
    const fixtures = [
      '0001_knowledge_receptionist_slice.sql',
      '0003_knowledge_receptionist_slice_two.sql',
      '0004_knowledge_receptionist_slice_three.sql',
      '0005_knowledge_receptionist_cutover.sql',
      '0008_knowledge_receptionist_batched_analysis.sql',
      '0009_knowledge_receptionist_stage_a_durable_persistence.sql',
      '0020_layered_knowledge_builds.sql',
      '0032_outbound_sales_demo.sql',
      '0043_knowledge_build_execution_leases.sql'
    ];
    for (const name of fixtures) await executeSql(migrationBody(await readMigration(name)));
    const vectorMigration = await readMigration('0006_knowledge_receptionist_pgvector_runtime.sql');
    const coverage = vectorMigration.match(/CREATE TABLE IF NOT EXISTS knowledge_coverage_events \([\s\S]*?\n\);/);
    if (!coverage) throw new Error('knowledge_coverage_fixture_definition_missing');
    await executeSql(coverage[0]);
    // Reapply additive optional-column declarations after knowledge tables exist.
    await bootstrapSchemaBaseline(pool, { executeSql });
    for (const name of REMEDIATION_MIGRATIONS) {
      await executeSql(migrationBody(await readMigration(name)));
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
    await executeSql('COMMIT');
  } catch (error) {
    await executeSql('ROLLBACK').catch(() => {});
    throw error;
  }
}
