import pg from "pg";
import {
  PRICING_SAFETY_PROCESSING_VERSION,
  assertPricingSafetyArtifactsComplete,
  ensurePricingSafetyArtifacts
} from "../pages/api/_lib/knowledgePricingSafety.js";

const { Pool } = pg;
const APPLY_ENV = "EVERYCALL_APPLY_PRICING_SAFETY_BACKFILL";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const apply = String(process.env[APPLY_ENV] || "").trim() === "1";
  const tenantArgIndex = process.argv.indexOf("--tenant");
  const onlyTenant = tenantArgIndex >= 0 ? String(process.argv[tenantArgIndex + 1] || "").trim() : "";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const active = await pool.query(
      `SELECT active.tenant_key, active.active_build_id,
              (SELECT COUNT(*)::int FROM kb_candidates candidate
                INNER JOIN kb_catalog_revisions revision ON revision.id = candidate.revision_id
               WHERE candidate.tenant_key = active.tenant_key
                 AND revision.knowledge_build_id = active.active_build_id) AS candidate_count,
              (SELECT COUNT(*)::int FROM knowledge_build_cards card
               WHERE card.tenant_key = active.tenant_key
                 AND card.build_id = active.active_build_id) AS card_count,
              (SELECT COUNT(*)::int FROM kb_pricing_safety_artifacts artifact
               WHERE artifact.tenant_key = active.tenant_key
                 AND artifact.build_id = active.active_build_id
                 AND artifact.processing_version = $2) AS artifact_count
       FROM tenant_active_knowledge_builds active
       WHERE ($1 = '' OR active.tenant_key = $1)
       ORDER BY active.tenant_key`,
      [onlyTenant, PRICING_SAFETY_PROCESSING_VERSION]
    );
    if (!apply) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        processingVersion: PRICING_SAFETY_PROCESSING_VERSION,
        applyWith: `${APPLY_ENV}=1`,
        websiteRecrawlRequired: false,
        tenants: active.rows || []
      }, null, 2));
      return;
    }
    const results = [];
    for (const row of active.rows || []) {
      const generated = await ensurePricingSafetyArtifacts(pool, {
        tenantKey: row.tenant_key,
        buildId: row.active_build_id
      });
      const completeness = await assertPricingSafetyArtifactsComplete(pool, {
        tenantKey: row.tenant_key,
        buildId: row.active_build_id
      });
      results.push({ tenantKey: row.tenant_key, buildId: row.active_build_id, generated, completeness });
    }
    console.log(JSON.stringify({ ok: true, dryRun: false, websiteRecrawlRequired: false, results }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
