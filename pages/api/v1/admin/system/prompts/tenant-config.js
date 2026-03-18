import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import {
  loadTenantPromptConfigEditorState,
  loadTenantPromptProfile,
  resetTenantPromptProfileToDefaults,
  resetTenantPromptSectionOverrides,
  saveTenantPromptProfile,
  saveTenantPromptSectionOverrides
} from "../../../../_lib/promptBlueprints.js";

function normalizeText(value) {
  return String(value || "").trim();
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = normalizeText(req.query?.tenantKey || req.body?.tenantKey);
    const promptBlueprintId = normalizeText(req.query?.promptBlueprintId || req.body?.promptBlueprintId);
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    if (req.method === "GET") {
      const state = await loadTenantPromptConfigEditorState(pool, tenantKey, promptBlueprintId);
      return res.status(200).json({ ok: true, ...state });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      if (body.profile) {
        await saveTenantPromptProfile(pool, tenantKey, body.profile, admin);
      }
      if (body.sectionOverrides) {
        const effectiveBlueprintId = normalizeText(body.promptBlueprintId || promptBlueprintId);
        const state = await loadTenantPromptConfigEditorState(pool, tenantKey, effectiveBlueprintId);
        await saveTenantPromptSectionOverrides(
          pool,
          tenantKey,
          state.blueprint.prompt_blueprint_id,
          body.sectionOverrides,
          admin
        );
      }
      const next = await loadTenantPromptConfigEditorState(pool, tenantKey, promptBlueprintId);
      return res.status(200).json({ ok: true, ...next });
    }

    if (req.method === "DELETE") {
      const mode = normalizeText(req.query?.mode || req.body?.mode);
      const state = await loadTenantPromptConfigEditorState(pool, tenantKey, promptBlueprintId);
      if (!mode || mode === "all" || mode === "profile") {
        await resetTenantPromptProfileToDefaults(pool, tenantKey, admin);
      }
      if (!mode || mode === "all" || mode === "overrides") {
        await resetTenantPromptSectionOverrides(pool, tenantKey, state.blueprint.prompt_blueprint_id, admin);
      }
      const next = await loadTenantPromptConfigEditorState(pool, tenantKey, promptBlueprintId);
      return res.status(200).json({ ok: true, ...next });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({
      error: "admin_tenant_prompt_config_error",
      message: err?.message || "unknown"
    });
  }
}
