import pg from "pg";
import { rollbackKnowledgeBuild } from "../pages/api/_lib/knowledgeReceptionistBuilds.js";

const { Pool } = pg;
const TENANT_KEY = "wenatchee_valley_glass";
const REQUIRED_APPROVAL = "EVERYCALL_ROLLBACK_WVG_BUILD";

async function main() {
  if (String(process.env[REQUIRED_APPROVAL] || "").trim() !== "1") {
    throw new Error(`${REQUIRED_APPROVAL}=1 is required`);
  }
  const buildId = String(process.env.EVERYCALL_WVG_ROLLBACK_TARGET_BUILD_ID || "").trim();
  if (!buildId) throw new Error("EVERYCALL_WVG_ROLLBACK_TARGET_BUILD_ID is required");
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const result = await rollbackKnowledgeBuild(pool, TENANT_KEY, buildId);
    console.log(JSON.stringify({
      ok: true,
      tenant_key: TENANT_KEY,
      active_build_id: result.active_build_id,
      previous_build_id: result.previous_build_id
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
