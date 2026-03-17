import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";
import {
  getPromptConfigDefaults,
  loadSystemPromptConfig,
  resetSystemPromptConfig,
  saveSystemPromptConfig
} from "../../../_lib/systemPromptConfig.js";

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

    if (req.method === "GET") {
      const [config, tenants] = await Promise.all([
        loadSystemPromptConfig(pool),
        pool.query(
          `SELECT tenant_key, name
           FROM tenants
           ORDER BY name ASC`
        )
      ]);
      return res.status(200).json({
        ok: true,
        config,
        defaults: getPromptConfigDefaults(),
        tenants: tenants.rows
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const config = await saveSystemPromptConfig(pool, body.config || {}, admin);
      return res.status(200).json({
        ok: true,
        config,
        defaults: getPromptConfigDefaults()
      });
    }

    if (req.method === "DELETE") {
      const config = await resetSystemPromptConfig(pool, admin);
      return res.status(200).json({
        ok: true,
        config,
        defaults: getPromptConfigDefaults()
      });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({
      error: "admin_system_prompts_error",
      message: err?.message || "unknown"
    });
  }
}
