// Frozen five-round-trip catalog reader from reviewed97d344; test parity only.
const fail = suffix => { throw Error(`upib_migration_${suffix}`); };
export async function referenceUpibCatalogContract(db, table, excluded = []) {
  const relation = (await db.query(`SELECT c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,
    EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) AS inherited,
    n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=$1`, [table])).rows[0];
  if (!relation) fail(`missing_relation_${table}`);
  const schema = relation.nspname;
  delete relation.nspname;
  const normalize = value => JSON.parse(JSON.stringify(value).replaceAll(`${schema}.`, '').replaceAll(`\\"${schema}\\".`, ''));
  const columns = (await db.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
    pg_get_expr(d.adbin,d.adrelid) AS default_value,a.attcollation::regcollation::text AS collation
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped AND NOT(a.attname=ANY($2::text[])) ORDER BY a.attname`, [table, excluded])).rows;
  const constraints = (await db.query(`SELECT conname,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE conrelid=$1::regclass AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) AND a.attname=ANY($2::text[])) ORDER BY conname`, [table, excluded])).rows;
  const indexes = (await db.query(`SELECT ci.relname,i.indisvalid,i.indisready,i.indisunique,i.indisprimary,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=$1::regclass
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) AND a.attname=ANY($2::text[])) ORDER BY ci.relname`, [table, excluded])).rows;
  const triggers = (await db.query(`SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal ORDER BY tgname`, [table])).rows;
  return normalize({ relation, columns, constraints, indexes, triggers });
}
