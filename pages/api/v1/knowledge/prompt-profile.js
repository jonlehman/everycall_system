import { getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess, requireTenantRoles } from "../../_lib/billing.js";
import {
  loadTenantPromptProfile,
  loadTenantPromptProfileEditorState,
  saveTenantPromptProfile
} from "../../_lib/promptBlueprints.js";

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || req.body?.tenantKey || ""));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    if (req.method === "GET") {
      const state = await loadTenantPromptProfileEditorState(pool, tenantKey);
      return res.status(200).json({ ok: true, ...state });
    }

    if (req.method === "POST") {
      const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
        message: "Only account admins and owners can update the prompt profile."
      });
      if (!manager) return;
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const profile = await saveTenantPromptProfile(pool, tenantKey, body.profile || body, session);
      const state = await loadTenantPromptProfileEditorState(pool, tenantKey);
      return res.status(200).json({ ok: true, profile, ...state });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    return fail(res, 500, "prompt_profile_error", String(err?.message || "unknown"));
  }
}
