import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";
import { estimatePeriodNumberCostCents } from "@everycall/contracts/callCosting";

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
         t.tenant_key,
         t.name AS tenant_name,
         COUNT(c.call_sid)::int AS call_count,
         COALESCE(MAX(t.telnyx_voice_monthly_cost_cents), 0)::bigint AS phone_monthly_cost_cents,
         MAX(t.telnyx_voice_purchased_at) AS phone_purchased_at,
         COALESCE(SUM(COALESCE(c.ai_input_tokens, 0)), 0)::bigint AS input_tokens,
         COALESCE(SUM(COALESCE(c.ai_output_tokens, 0)), 0)::bigint AS output_tokens,
         COALESCE(SUM(COALESCE(c.duration_seconds, 0)), 0)::bigint AS duration_seconds,
         COALESCE(SUM(COALESCE(c.telephony_billable_minutes, 0)), 0)::bigint AS telephony_billable_minutes,
         COALESCE(SUM(COALESCE(c.ai_estimated_cost_micros_usd, 0)), 0)::bigint AS ai_estimated_cost_micros_usd,
         COALESCE(SUM(COALESCE(c.telephony_estimated_cost_micros_usd, 0)), 0)::bigint AS telephony_estimated_cost_micros_usd,
         COALESCE(SUM(COALESCE(c.notification_estimated_cost_micros_usd, 0)), 0)::bigint AS notification_estimated_cost_micros_usd,
         COALESCE(SUM(COALESCE(c.total_estimated_cost_micros_usd, COALESCE(c.ai_estimated_cost_micros_usd, 0) + COALESCE(c.telephony_estimated_cost_micros_usd, 0) + COALESCE(c.notification_estimated_cost_micros_usd, 0))), 0)::bigint AS variable_estimated_cost_micros_usd
       FROM tenants t
       LEFT JOIN calls c
         ON c.tenant_key = t.tenant_key
        AND c.created_at >= NOW() - interval '30 days'
       WHERE c.call_sid IS NOT NULL
          OR t.telnyx_voice_number IS NOT NULL
          OR COALESCE(t.telnyx_voice_monthly_cost_cents, 0) > 0
       GROUP BY t.tenant_key, t.name
       ORDER BY variable_estimated_cost_micros_usd DESC, call_count DESC, t.tenant_key ASC`
    );

    const callRows = await pool.query(
      `SELECT
         c.call_sid,
         c.tenant_key,
         t.name AS tenant_name,
         c.ai_model,
         c.ai_input_tokens,
         c.ai_output_tokens,
         c.duration_seconds,
         c.telephony_billable_minutes,
         c.ai_estimated_cost_micros_usd,
         c.telephony_estimated_cost_micros_usd,
         c.notification_estimated_cost_micros_usd,
         COALESCE(c.total_estimated_cost_micros_usd, COALESCE(c.ai_estimated_cost_micros_usd, 0) + COALESCE(c.telephony_estimated_cost_micros_usd, 0) + COALESCE(c.notification_estimated_cost_micros_usd, 0)) AS total_estimated_cost_micros_usd,
         c.ai_response_count,
         c.created_at
       FROM calls c
       LEFT JOIN tenants t ON t.tenant_key = c.tenant_key
       WHERE c.created_at >= NOW() - interval '30 days'
       ORDER BY c.created_at DESC
       LIMIT 200`
    );

    const periodEndMs = Date.now();
    const periodStartMs = periodEndMs - (30 * 24 * 60 * 60 * 1000);
    const normalizedTenantRows = tenantRows.rows.map((row) => {
      const numberEstimatedCostCents = estimatePeriodNumberCostCents(
        Number(row.phone_monthly_cost_cents || 0),
        row.phone_purchased_at || null,
        { periodStartMs, periodEndMs }
      );
      const numberEstimatedCostMicrosUsd = numberEstimatedCostCents * 10_000;
      return {
        ...row,
        number_estimated_cost_cents: numberEstimatedCostCents,
        number_estimated_cost_micros_usd: numberEstimatedCostMicrosUsd,
        total_estimated_cost_micros_usd: Number(row.variable_estimated_cost_micros_usd || 0) + numberEstimatedCostMicrosUsd
      };
    });

    return res.status(200).json({
      ok: true,
      tenantRows: normalizedTenantRows,
      callRows: callRows.rows,
      summary: {
        totalCalls: normalizedTenantRows.reduce((sum, row) => sum + Number(row.call_count || 0), 0),
        totalInputTokens: normalizedTenantRows.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0),
        totalOutputTokens: normalizedTenantRows.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0),
        totalDurationSeconds: normalizedTenantRows.reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0),
        totalTelephonyBillableMinutes: normalizedTenantRows.reduce((sum, row) => sum + Number(row.telephony_billable_minutes || 0), 0),
        totalAiEstimatedCostMicrosUsd: normalizedTenantRows.reduce((sum, row) => sum + Number(row.ai_estimated_cost_micros_usd || 0), 0),
        totalTelephonyEstimatedCostMicrosUsd: normalizedTenantRows.reduce((sum, row) => sum + Number(row.telephony_estimated_cost_micros_usd || 0), 0),
        totalNotificationEstimatedCostMicrosUsd: normalizedTenantRows.reduce((sum, row) => sum + Number(row.notification_estimated_cost_micros_usd || 0), 0),
        totalNumberEstimatedCostMicrosUsd: normalizedTenantRows.reduce((sum, row) => sum + Number(row.number_estimated_cost_micros_usd || 0), 0),
        totalEstimatedCostMicrosUsd: normalizedTenantRows.reduce((sum, row) => sum + Number(row.total_estimated_cost_micros_usd || 0), 0)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_usage_report_error", message: err?.message || "unknown" });
  }
}
