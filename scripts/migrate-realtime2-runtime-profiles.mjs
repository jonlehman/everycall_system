import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;

export const APPLY_ENV = "EVERYCALL_APPLY_REALTIME2_PROFILE_MIGRATION";
export const TARGET_MODEL = "gpt-realtime-2.1";
const LEGACY_MODELS = new Set(["gpt-realtime", "gpt-realtime-1.5"]);
const PREVIOUS_DEFAULT_MODELS = new Set(["gpt-realtime-2"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isApplyMode() {
  return process.env[APPLY_ENV] === "1";
}

export function planProfileMigration(row) {
  const tenantKey = normalizeText(row.tenant_key);
  const sessionConfig = asObject(row.session_config_json);
  const currentModel = normalizeText(sessionConfig.model);
  if (!currentModel) {
    return {
      tenant_key: tenantKey,
      action: "inherits_new_default",
      current_model: null,
      next_session_config_json: sessionConfig
    };
  }
  if (currentModel === TARGET_MODEL) {
    return {
      tenant_key: tenantKey,
      action: "already_target",
      current_model: currentModel,
      next_session_config_json: sessionConfig
    };
  }
  if (PREVIOUS_DEFAULT_MODELS.has(currentModel)) {
    const nextSessionConfig = { ...sessionConfig };
    delete nextSessionConfig.model;
    return {
      tenant_key: tenantKey,
      action: "remove_previous_default_model_override",
      current_model: currentModel,
      next_model: TARGET_MODEL,
      next_session_config_json: nextSessionConfig
    };
  }
  if (LEGACY_MODELS.has(currentModel)) {
    const nextSessionConfig = { ...sessionConfig };
    delete nextSessionConfig.model;
    return {
      tenant_key: tenantKey,
      action: "remove_legacy_model_override",
      current_model: currentModel,
      next_model: TARGET_MODEL,
      next_session_config_json: nextSessionConfig
    };
  }
  return {
    tenant_key: tenantKey,
    action: "manual_review",
    current_model: currentModel,
    next_session_config_json: sessionConfig
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const apply = isApplyMode();
  try {
    const res = await pool.query(
      `SELECT tenant_key, session_config_json
       FROM knowledge_runtime_profiles
       ORDER BY tenant_key ASC`
    );
    const plans = res.rows.map(planProfileMigration);
    const applicable = plans.filter((plan) => [
      "remove_previous_default_model_override",
      "remove_legacy_model_override"
    ].includes(plan.action));

    if (apply) {
      for (const plan of applicable) {
        await pool.query(
          `UPDATE knowledge_runtime_profiles
           SET session_config_json = $2::jsonb,
               updated_at = NOW()
           WHERE tenant_key = $1`,
          [plan.tenant_key, JSON.stringify(plan.next_session_config_json)]
        );
      }
    }

    console.log(JSON.stringify({
      ok: true,
      mode: apply ? "apply" : "dry_run",
      target_model: TARGET_MODEL,
      apply_env: APPLY_ENV,
      totals: {
        profiles_scanned: plans.length,
        inherits_new_default: plans.filter((plan) => plan.action === "inherits_new_default").length,
        already_target: plans.filter((plan) => plan.action === "already_target").length,
        remove_previous_default_model_override: plans.filter(
          (plan) => plan.action === "remove_previous_default_model_override"
        ).length,
        remove_legacy_model_override: plans.filter((plan) => plan.action === "remove_legacy_model_override").length,
        manual_review: plans.filter((plan) => plan.action === "manual_review").length
      },
      plans
    }, null, 2));
  } finally {
    await pool.end();
  }
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === entrypointUrl) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  });
}
