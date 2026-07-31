import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;

export const APPLY_ENV = "EVERYCALL_APPLY_XAI_PROFILE_MIGRATION";
export const TARGET_MODEL = "grok-voice-think-fast-2.0";
export const TARGET_VOICE = "eve";
export const TARGET_TRANSCRIPTION_MODEL = "grok-transcribe";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function planProfileMigration(row) {
  const tenantKey = normalizeText(row.tenant_key);
  const current = asObject(row.session_config_json);
  const next = {
    ...current,
    model: TARGET_MODEL,
    voice: TARGET_VOICE,
    transcription_model: TARGET_TRANSCRIPTION_MODEL,
    turn_detection: {
      ...asObject(current.turn_detection),
      type: "server_vad",
      create_response: true,
      interrupt_response: true
    }
  };
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  return {
    tenant_key: tenantKey,
    action: changed ? "update_to_xai" : "already_xai",
    current_model: normalizeText(current.model) || null,
    next_session_config_json: next
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const apply = process.env[APPLY_ENV] === "1";
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `SELECT tenant_key, session_config_json
       FROM knowledge_runtime_profiles
       ORDER BY tenant_key ASC`
    );
    const plans = result.rows.map(planProfileMigration);
    if (apply) {
      for (const plan of plans.filter((entry) => entry.action === "update_to_xai")) {
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
        update_to_xai: plans.filter((entry) => entry.action === "update_to_xai").length,
        already_xai: plans.filter((entry) => entry.action === "already_xai").length
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
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
