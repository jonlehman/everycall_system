import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import {
  loadKnowledgeRuntimeProfile,
  loadKnowledgeRuntimeProfileEditorState,
  resetKnowledgeRuntimeProfileToDefaults,
  saveKnowledgeRuntimeProfile
} from "../../../../_lib/knowledgeReceptionistConfig.js";

function normalizeText(value) {
  return String(value || "").trim();
}

async function loadTenant(pool, tenantKey) {
  const result = await pool.query(
    `SELECT tenant_key, name
     FROM tenants
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return result.rows[0] || null;
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
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const tenant = await loadTenant(pool, tenantKey);
    if (!tenant) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    if (req.method === "GET") {
      const state = await loadKnowledgeRuntimeProfileEditorState(pool, tenantKey);
      return res.status(200).json({ ok: true, tenant, ...state });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const current = await loadKnowledgeRuntimeProfile(pool, tenantKey);
      const incoming = body.profile || body;
      const profile = await saveKnowledgeRuntimeProfile(pool, tenantKey, {
        ...current,
        ...incoming,
        session_config: {
          ...(current?.session_config || {}),
          ...(incoming?.session_config || {})
        },
        tool_policy: {
          ...(current?.tool_policy || {}),
          ...(incoming?.tool_policy || {})
        },
        wording_defaults: {
          ...(current?.wording_defaults || {}),
          ...(incoming?.wording_defaults || {})
        },
        runtime_defaults: {
          ...(current?.runtime_defaults || {}),
          ...(incoming?.runtime_defaults || {})
        }
      }, admin);
      const state = await loadKnowledgeRuntimeProfileEditorState(pool, tenantKey);
      return res.status(200).json({ ok: true, tenant, profile, ...state });
    }

    if (req.method === "DELETE") {
      const state = await resetKnowledgeRuntimeProfileToDefaults(pool, tenantKey, admin);
      return res.status(200).json({ ok: true, tenant, ...state });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({
      error: "admin_tenant_runtime_profile_error",
      message: err?.message || "unknown"
    });
  }
}
