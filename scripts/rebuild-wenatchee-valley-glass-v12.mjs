import pg from "pg";
import {
  enqueueKnowledgeBuild,
  runKnowledgeBuildJobs
} from "../pages/api/_lib/knowledgeReceptionistBuilds.js";
import { getDefaultPromptBlueprintSeed } from "@everycall/contracts";

const { Pool } = pg;
const TENANT_KEY = "wenatchee_valley_glass";
const REQUIRED_APPROVAL = "EVERYCALL_REBUILD_WVG_V12";

function normalizeText(value) {
  return String(value || "").trim();
}

async function main() {
  if (normalizeText(process.env[REQUIRED_APPROVAL]) !== "1") {
    throw new Error(`${REQUIRED_APPROVAL}=1 is required`);
  }
  const databaseUrl = normalizeText(process.env.DATABASE_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  process.env.KNOWLEDGE_RECEPTIONIST_DISABLE_BUILD_RATE_LIMIT = "true";
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  try {
    const target = await pool.query(
      `SELECT tenant.tenant_key, tenant.name, bootstrap.website_url,
              active.active_build_id AS previous_active_build_id
       FROM tenants tenant
       LEFT JOIN tenant_bootstrap_profiles bootstrap
         ON bootstrap.tenant_key = tenant.tenant_key
       LEFT JOIN tenant_active_knowledge_builds active
         ON active.tenant_key = tenant.tenant_key
       WHERE tenant.tenant_key = $1
       LIMIT 1`,
      [TENANT_KEY]
    );
    const tenant = target.rows?.[0];
    if (!tenant) throw new Error("wvg_tenant_not_found");
    const websiteUrl = normalizeText(tenant.website_url);
    if (!websiteUrl) throw new Error("wvg_website_url_missing");

    const queued = await enqueueKnowledgeBuild(pool, TENANT_KEY, {
      buildKind: "website_base",
      websiteUrl,
      forceRescrape: true
    });
    const buildId = normalizeText(queued?.build?.build_id);
    if (!buildId) throw new Error("wvg_build_id_missing");
    const job = await runKnowledgeBuildJobs(pool, {
      tenantKey: TENANT_KEY,
      buildId,
      maxBuilds: 1,
      workerId: "script:rebuild-wenatchee-valley-glass-v12"
    });
    const run = job.runs?.[0] || null;
    if (run?.status !== "published") {
      throw new Error(`wvg_build_not_published:${run?.error || run?.status || "unknown"}`);
    }

    const [profile, facts, confirmation] = await Promise.all([
      pool.query(
        `SELECT company_description, basic_no_tool_allowed_statement, updated_at
         FROM tenant_prompt_profiles
         WHERE tenant_key = $1`,
        [TENANT_KEY]
      ),
      pool.query(
        `SELECT knowledge_fact_id, core_fact_rank, core_fact_score,
                core_fact_title, core_fact_spoken_text,
                core_fact_caller_question_categories_json,
                core_fact_rating_version, core_fact_spoken_version
         FROM knowledge_build_facts
         WHERE tenant_key = $1
           AND build_id = $2
           AND is_core_fact_pinned = TRUE
         ORDER BY core_fact_rank ASC`,
        [TENANT_KEY, buildId]
      ),
      pool.query(
        `SELECT status, trigger_build_id, missing_categories_json
         FROM tenant_caller_faq_confirmations
         WHERE tenant_key = $1`,
        [TENANT_KEY]
      )
    ]);
    const blueprint = getDefaultPromptBlueprintSeed();
    console.log(JSON.stringify({
      tenant: {
        tenant_key: TENANT_KEY,
        name: tenant.name,
        website_url: websiteUrl,
        previous_active_build_id: tenant.previous_active_build_id,
        active_build_id: buildId
      },
      run,
      prompt_blueprint: { version: blueprint.version, name: blueprint.name },
      prompt_profile: profile.rows?.[0] || null,
      pinned_facts: facts.rows || [],
      caller_faq_confirmation: confirmation.rows?.[0] || null
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
