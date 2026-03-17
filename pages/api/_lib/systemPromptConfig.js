import {
  getDefaultRuntimePromptConfig,
  normalizeRuntimePromptConfig
} from "@everycall/contracts";

const DEFAULT_EMERGENCY_PHRASE = "If this is an emergency, please hang up and dial 911.";

function actorId(actor) {
  if (!actor) return null;
  if (typeof actor === "string") return actor;
  const role = String(actor.role || "").trim() || "admin";
  const id = String(actor.user_id || actor.userId || actor.id || "").trim();
  return id ? `${role}:${id}` : role;
}

async function writeAuditLog(db, actor, action, details) {
  await db.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [null, actorId(actor) || "system", action, JSON.stringify(details || {})]
  );
}

export function getPromptConfigDefaults() {
  return getDefaultRuntimePromptConfig();
}

export async function loadSystemPromptConfig(db) {
  const res = await db.query(
    `SELECT prompt_layers_json
     FROM system_config
     WHERE id = 1
     LIMIT 1`
  );
  return normalizeRuntimePromptConfig(res.rows[0]?.prompt_layers_json || null);
}

export async function saveSystemPromptConfig(db, promptConfig, actor = null) {
  const normalized = normalizeRuntimePromptConfig(promptConfig);
  await db.query(
    `INSERT INTO system_config (
       id,
       global_emergency_phrase,
       prompt_layers_json
     )
     VALUES (
       1,
       COALESCE((SELECT global_emergency_phrase FROM system_config WHERE id = 1), $1),
       $2::jsonb
     )
     ON CONFLICT (id)
     DO UPDATE SET prompt_layers_json = EXCLUDED.prompt_layers_json,
                   updated_at = NOW()`,
    [DEFAULT_EMERGENCY_PHRASE, JSON.stringify(normalized)]
  );
  await writeAuditLog(db, actor, "admin.system_prompt_layers.saved", {
    prompt_layer_keys: Object.keys(normalized || {})
  });
  return normalized;
}

export async function resetSystemPromptConfig(db, actor = null) {
  await db.query(
    `INSERT INTO system_config (
       id,
       global_emergency_phrase,
       prompt_layers_json
     )
     VALUES (
       1,
       COALESCE((SELECT global_emergency_phrase FROM system_config WHERE id = 1), $1),
       NULL
     )
     ON CONFLICT (id)
     DO UPDATE SET prompt_layers_json = NULL,
                   updated_at = NOW()`,
    [DEFAULT_EMERGENCY_PHRASE]
  );
  await writeAuditLog(db, actor, "admin.system_prompt_layers.reset", {});
  return getDefaultRuntimePromptConfig();
}
