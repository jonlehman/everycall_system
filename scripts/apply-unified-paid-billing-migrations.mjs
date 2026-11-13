import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyUnifiedPaidBillingMigrations, UPIB_MIGRATIONS } from './lib/unified-paid-billing-migrations.mjs';

if (process.env.EVERYCALL_APPLY_UNIFIED_PAID_BILLING !== '1') throw Error('EVERYCALL_APPLY_UNIFIED_PAID_BILLING=1 is required');
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const currentRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd }).trim();
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', cwd }).trim()) throw Error('Reviewed tracked files must be committed and unchanged');
execFileSync('git', ['ls-files', '--error-unmatch', 'scripts/apply-unified-paid-billing-migrations.mjs', 'scripts/lib/unified-paid-billing-migrations.mjs', 'scripts/test-unified-paid-billing-migrations.mjs', ...UPIB_MIGRATIONS.map(name => `migrations/${name}`)], { stdio: 'pipe', cwd });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, query_timeout: 12000 });
try {
  console.log(JSON.stringify(await applyUnifiedPaidBillingMigrations(pool, {
    execute: true, databaseUrl: process.env.DATABASE_URL,
    expectedTargetFingerprint: process.env.EVERYCALL_DATABASE_TARGET_SHA256,
    reviewedRevision: process.env.EVERYCALL_REVIEWED_REVISION, currentRevision,
    expectedMigrationSha256: Object.fromEntries(UPIB_MIGRATIONS.map(name => [name, process.env[`EVERYCALL_${name.slice(0, 4)}_SQL_SHA256`]])),
    releaseEvidenceReference: process.env.EVERYCALL_UPIB_RELEASE_EVIDENCE,
    inventoryEvidenceReference: process.env.EVERYCALL_UPIB_INVENTORY_EVIDENCE
  })));
} catch (error) {
  console.error(JSON.stringify({ error: error.code || error.message, missing: error.missing }));
  process.exitCode = 1;
} finally { await pool.end(); }
