import { REQUIRED_SCHEMA_COLUMNS, REQUIRED_SCHEMA_INDEXES, REQUIRED_SCHEMA_TRIGGERS, REQUIRED_SCHEMA_MIGRATIONS } from "./schemaReadiness.js";
import pg from "pg";

const { Pool } = pg;

export function getPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  if (!globalThis.__everycallPool) {
    const configuredPoolMax = Number.parseInt(
      String(process.env.DATABASE_POOL_MAX || ""),
      10
    );
    globalThis.__everycallPool = new Pool({
      connectionString: databaseUrl,
      ...(Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
        ? { max: configuredPoolMax }
        : {})
    });
  }

  return globalThis.__everycallPool;
}

// A successful check is shared only by callers using this exact pool. Rejected
// checks are evicted so applying migrations allows the next request to recover.
const readinessByPool = new WeakMap();

export class SchemaNotReadyError extends Error {
  constructor(missing, cause) {
    super('Database schema is not ready. Run the reviewed deploy migration command (node scripts/apply-production-remediation-migrations.mjs) before serving requests.', { cause });
    this.name = 'SchemaNotReadyError';
    this.code = 'schema_not_ready';
    this.status = 503;
    this.statusCode = 503;
    this.missing = missing;
  }
}

export async function ensureTables(pool) {
  if (!pool || typeof pool.query !== 'function') throw new SchemaNotReadyError(['database_pool']);
  let pending = readinessByPool.get(pool);
  if (!pending) {
    pending = assertSchemaReady(pool).catch((error) => {
      readinessByPool.delete(pool);
      throw error;
    });
    readinessByPool.set(pool, pending);
  }
  await pending;
}

async function assertSchemaReady(pool) {
  const required = Object.entries(REQUIRED_SCHEMA_COLUMNS).flatMap(([table, columns]) =>
    columns.map(column => ({ table, column })));
  let result;
  try {
    result = await pool.query(`
      SELECT required.table || '.' || required.column AS missing
      FROM jsonb_to_recordset($1::jsonb) AS required("table" text, "column" text)
      LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = current_schema()
      LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = required.table AND c.relkind IN ('r', 'p')
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = required.column AND a.attnum > 0 AND NOT a.attisdropped
      WHERE a.attname IS NULL
      UNION ALL
      SELECT 'index:' || required.name
      FROM unnest($2::text[]) AS required(name)
      LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = current_schema()
      LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = required.name
      LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid AND i.indisvalid AND i.indisready
      WHERE i.indexrelid IS NULL
      UNION ALL
      SELECT 'trigger:' || required.name
      FROM unnest($3::text[]) AS required(name)
      LEFT JOIN pg_catalog.pg_trigger t ON t.tgname = required.name AND t.tgenabled IN ('O', 'A')
        AND t.tgrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema())
      WHERE t.oid IS NULL
    `, [JSON.stringify(required), REQUIRED_SCHEMA_INDEXES, REQUIRED_SCHEMA_TRIGGERS]);
    if (result.rows.length) throw new SchemaNotReadyError(result.rows.map(row => row.missing));
    const receipts = await pool.query('SELECT name FROM schema_migrations WHERE name = ANY($1::text[])', [REQUIRED_SCHEMA_MIGRATIONS]);
    const applied = new Set(receipts.rows.map(row => row.name));
    const missing = REQUIRED_SCHEMA_MIGRATIONS.filter(name => !applied.has(name));
    if (missing.length) throw new SchemaNotReadyError(missing.map(name => `migration:${name}`));
  } catch (error) {
    if (error instanceof SchemaNotReadyError) throw error;
    throw new SchemaNotReadyError(['schema_probe_failed'], error);
  }
}
