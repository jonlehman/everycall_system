import pg from "pg";
import { knowledgeHeartInternals } from "../pages/api/_lib/knowledgeHeartCatalog.js";

const { Pool } = pg;
const APPLY_ENV = "EVERYCALL_APPLY_KNOWS_BY_HEART_METADATA_REPAIR";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const tenantKey = argumentValue("--tenant");
  if (!tenantKey) throw new Error("--tenant is required");
  const apply = String(process.env[APPLY_ENV] || "").trim() === "1";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const result = await pool.query(
      `SELECT id, spoken_text, canonical_text, title, category, polarity,
              quantities_json, boundaries_json, qualifiers_json, subject_text
       FROM kb_tenant_facts
       WHERE tenant_key = $1 AND kind = 'confirmed' AND archived_at IS NULL
         AND created_by = 'tenant:migrated-caller-faq-confirmation'
       ORDER BY id`,
      [tenantKey]
    );
    const repaired = [];
    for (const row of result.rows || []) {
      const derived = await knowledgeHeartInternals.correctionFactFromStatement(
        row.canonical_text,
        { approved_title: row.title, approved_category: row.category }
      );
      repaired.push({
        id: row.id,
        expectedCanonicalText: row.canonical_text,
        category: row.category,
        polarity: derived.polarity,
        quantities: derived.quantities,
        boundaries: derived.boundaries,
        qualifiers: derived.qualifiers,
        subjectText: derived.subject_text
      });
    }
    if (!apply) {
      console.log(JSON.stringify({ ok: true, dryRun: true, applyWith: `${APPLY_ENV}=1`, tenantKey, repaired }, null, 2));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of repaired) {
        const locked = await client.query(
          `SELECT canonical_text FROM kb_tenant_facts
           WHERE tenant_key = $1 AND id = $2 AND archived_at IS NULL
           FOR UPDATE`,
          [tenantKey, item.id]
        );
        if (locked.rows?.[0]?.canonical_text !== item.expectedCanonicalText) {
          throw new Error(`kb_confirmed_metadata_source_changed:${item.id}`);
        }
        await client.query(
          `UPDATE kb_tenant_facts
           SET polarity = $3, quantities_json = $4::jsonb,
               boundaries_json = $5::jsonb, qualifiers_json = $6::jsonb,
               subject_text = $7
           WHERE tenant_key = $1 AND id = $2`,
          [tenantKey, item.id, item.polarity, JSON.stringify(item.quantities),
            JSON.stringify(item.boundaries), JSON.stringify(item.qualifiers), item.subjectText]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    console.log(JSON.stringify({ ok: true, dryRun: false, tenantKey, repairedCount: repaired.length }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
