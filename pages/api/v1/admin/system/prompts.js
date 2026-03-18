import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";
import {
  listPromptBlueprints,
  loadPromptBlueprint,
  savePromptBlueprint
} from "../../../_lib/promptBlueprints.js";

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
      const promptBlueprintId = String(req.query?.promptBlueprintId || "").trim();
      const [blueprints, activeBlueprint, tenants] = await Promise.all([
        listPromptBlueprints(pool),
        loadPromptBlueprint(pool, promptBlueprintId),
        pool.query(
          `SELECT tenant_key, name
           FROM tenants
           ORDER BY name ASC`
        )
      ]);
      return res.status(200).json({
        ok: true,
        blueprints,
        active_blueprint: activeBlueprint,
        tenants: tenants.rows || []
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const blueprint = await savePromptBlueprint(pool, body.blueprint || body, admin);
      const blueprints = await listPromptBlueprints(pool);
      return res.status(200).json({
        ok: true,
        blueprints,
        active_blueprint: blueprint
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({
      error: "admin_prompt_blueprint_error",
      message: err?.message || "unknown"
    });
  }
}
