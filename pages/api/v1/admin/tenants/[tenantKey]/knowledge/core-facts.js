import { ensureTables, getPool } from "../../../../../_lib/db.js";
import { requireSession } from "../../../../../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "database_unavailable" });
    await ensureTables(pool);

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    const tenantKey = String(req.query?.tenantKey || "").trim();
    if (!tenantKey) return res.status(400).json({ error: "missing_tenant_key" });

    const [activeBuildResult, pinsResult, historyResult] = await Promise.all([
      pool.query(
        `SELECT active_build_id
         FROM tenant_active_knowledge_builds
         WHERE tenant_key = $1
         LIMIT 1`,
        [tenantKey]
      ),
      pool.query(
        `SELECT knowledge_fact_id, claim_text, fact_role, core_fact_title, core_fact_spoken_text,
                core_fact_score, core_fact_reason, core_fact_fingerprint, core_fact_rank,
                core_fact_selected_at
         FROM knowledge_build_facts
         WHERE tenant_key = $1
           AND build_id = (
             SELECT active_build_id
             FROM tenant_active_knowledge_builds
             WHERE tenant_key = $1
           )
           AND is_core_fact_pinned = TRUE
         ORDER BY core_fact_rank ASC NULLS LAST, core_fact_selected_at ASC, knowledge_fact_id ASC`,
        [tenantKey]
      ),
      pool.query(
        `SELECT change_id, tenant_key, build_id, previous_build_id, knowledge_fact_id,
                fact_fingerprint, change_type, title, spoken_text, claim_text, score, reason,
                metadata_json, created_at
         FROM knowledge_core_fact_pin_changes
         WHERE tenant_key = $1
         ORDER BY created_at DESC, change_id DESC
         LIMIT 50`,
        [tenantKey]
      )
    ]);

    return res.status(200).json({
      ok: true,
      activeBuildId: activeBuildResult.rows[0]?.active_build_id || null,
      pins: pinsResult.rows || [],
      history: historyResult.rows || []
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_core_facts_error", message: err?.message || "unknown" });
  }
}
