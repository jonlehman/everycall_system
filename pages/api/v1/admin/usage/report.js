import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

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

    const tenantRows = await pool.query(
      `SELECT
         c.tenant_key,
         t.name AS tenant_name,
         COUNT(*)::int AS call_count,
         COALESCE(SUM(COALESCE(c.ai_input_tokens, 0)), 0)::bigint AS input_tokens,
         COALESCE(SUM(COALESCE(c.ai_output_tokens, 0)), 0)::bigint AS output_tokens,
         COALESCE(SUM(COALESCE(c.ai_estimated_cost_micros_usd, 0)), 0)::bigint AS estimated_cost_micros_usd
       FROM calls c
       LEFT JOIN tenants t ON t.tenant_key = c.tenant_key
       WHERE c.created_at >= NOW() - interval '30 days'
       GROUP BY c.tenant_key, t.name
       ORDER BY estimated_cost_micros_usd DESC, call_count DESC, c.tenant_key ASC`
    );

    const callRows = await pool.query(
      `SELECT
         c.call_sid,
         c.tenant_key,
         t.name AS tenant_name,
         c.ai_model,
         c.ai_input_tokens,
         c.ai_output_tokens,
         c.ai_estimated_cost_micros_usd,
         c.ai_response_count,
         c.created_at
       FROM calls c
       LEFT JOIN tenants t ON t.tenant_key = c.tenant_key
       WHERE c.created_at >= NOW() - interval '30 days'
       ORDER BY c.created_at DESC
       LIMIT 200`
    );

    return res.status(200).json({
      ok: true,
      tenantRows: tenantRows.rows,
      callRows: callRows.rows,
      summary: {
        totalCalls: tenantRows.rows.reduce((sum, row) => sum + Number(row.call_count || 0), 0),
        totalEstimatedCostMicrosUsd: tenantRows.rows.reduce((sum, row) => sum + Number(row.estimated_cost_micros_usd || 0), 0),
        totalInputTokens: tenantRows.rows.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0),
        totalOutputTokens: tenantRows.rows.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_usage_report_error", message: err?.message || "unknown" });
  }
}
