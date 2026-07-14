import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";
import {
  estimateAiCostMicrosUsd,
  estimatePeriodNumberCostCents,
  estimateTelephonyCostMicrosUsd
} from "@everycall/contracts/callCosting";

function parsePositiveRate(value, fallback) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const realtimeInputRatePer1MUsd = parsePositiveRate(process.env.OPENAI_REALTIME_INPUT_RATE_PER_1M_USD, 4);
const realtimeCachedInputRatePer1MUsd = parsePositiveRate(process.env.OPENAI_REALTIME_CACHED_INPUT_RATE_PER_1M_USD, 0.4);
const realtimeAudioInputRatePer1MUsd = parsePositiveRate(process.env.OPENAI_REALTIME_AUDIO_INPUT_RATE_PER_1M_USD, 32);
const realtimeOutputRatePer1MUsd = parsePositiveRate(process.env.OPENAI_REALTIME_OUTPUT_RATE_PER_1M_USD, 24);
const realtimeAudioOutputRatePer1MUsd = parsePositiveRate(process.env.OPENAI_REALTIME_AUDIO_OUTPUT_RATE_PER_1M_USD, 64);
const telnyxEstimatedInboundRatePerMinuteUsd = parsePositiveRate(process.env.TELNYX_ESTIMATED_INBOUND_RATE_PER_MINUTE_USD, 0.0055);

function normalizeMicros(value) {
  const micros = Number(value || 0);
  return Number.isFinite(micros) && micros > 0 ? Math.round(micros) : 0;
}

function estimateCallAiCost(row) {
  const stored = normalizeMicros(row.ai_estimated_cost_micros_usd);
  if (stored > 0) return stored;
  return estimateAiCostMicrosUsd(
    {
      inputTokens: Number(row.ai_input_tokens || 0),
      outputTokens: Number(row.ai_output_tokens || 0),
      cachedInputTokens: Number(row.ai_cached_input_tokens || 0),
      cachedInputTextTokens: Number(row.ai_cached_input_text_tokens || 0),
      cachedInputAudioTokens: Number(row.ai_cached_input_audio_tokens || 0),
      inputTextTokens: Number(row.ai_input_text_tokens || 0),
      inputAudioTokens: Number(row.ai_input_audio_tokens || 0),
      outputTextTokens: Number(row.ai_output_text_tokens || 0),
      outputAudioTokens: Number(row.ai_output_audio_tokens || 0)
    },
    {
      textInputRatePer1MUsd: realtimeInputRatePer1MUsd,
      cachedInputRatePer1MUsd: realtimeCachedInputRatePer1MUsd,
      audioInputRatePer1MUsd: realtimeAudioInputRatePer1MUsd,
      textOutputRatePer1MUsd: realtimeOutputRatePer1MUsd,
      audioOutputRatePer1MUsd: realtimeAudioOutputRatePer1MUsd
    }
  );
}

function estimateCallTelephonyCost(row) {
  const stored = normalizeMicros(row.telephony_estimated_cost_micros_usd);
  if (stored > 0) return stored;
  return estimateTelephonyCostMicrosUsd(
    Number(row.duration_seconds || 0),
    telnyxEstimatedInboundRatePerMinuteUsd
  );
}

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

    const tenantMetaRows = await pool.query(
      `SELECT
         t.tenant_key,
         t.name AS tenant_name,
         t.telnyx_voice_monthly_cost_cents AS phone_monthly_cost_cents,
         t.telnyx_voice_purchased_at AS phone_purchased_at
       FROM tenants t
       WHERE t.tenant_key IN (
         SELECT DISTINCT c.tenant_key
         FROM calls c
         WHERE c.created_at >= NOW() - interval '30 days'
       )
          OR t.telnyx_voice_number IS NOT NULL
          OR COALESCE(t.telnyx_voice_monthly_cost_cents, 0) > 0
       ORDER BY t.tenant_key ASC`
    );

    const callRowsResult = await pool.query(
      `SELECT
         c.call_sid,
         c.tenant_key,
         t.name AS tenant_name,
         c.ai_model,
         c.ai_input_tokens,
         c.ai_output_tokens,
         c.ai_cached_input_tokens,
         c.ai_cached_input_text_tokens,
         c.ai_cached_input_audio_tokens,
         c.ai_input_text_tokens,
         c.ai_input_audio_tokens,
         c.ai_output_text_tokens,
         c.ai_output_audio_tokens,
         c.ai_input_rate_micros_usd,
         c.ai_output_rate_micros_usd,
         c.duration_seconds,
         c.telephony_billable_minutes,
         c.telephony_rate_micros_usd,
         c.ai_estimated_cost_micros_usd,
         c.telephony_estimated_cost_micros_usd,
         c.notification_estimated_cost_micros_usd,
         c.total_estimated_cost_micros_usd,
         c.ai_response_count,
         c.created_at
       FROM calls c
       LEFT JOIN tenants t ON t.tenant_key = c.tenant_key
       WHERE c.created_at >= NOW() - interval '30 days'
       ORDER BY c.created_at DESC
       LIMIT 200`
    );

    const normalizedCallRows = callRowsResult.rows.map((row) => {
      const aiEstimatedCostMicrosUsd = estimateCallAiCost(row);
      const telephonyEstimatedCostMicrosUsd = estimateCallTelephonyCost(row);
      const notificationEstimatedCostMicrosUsd = normalizeMicros(row.notification_estimated_cost_micros_usd);
      const totalEstimatedCostMicrosUsd = normalizeMicros(row.total_estimated_cost_micros_usd)
        || (aiEstimatedCostMicrosUsd + telephonyEstimatedCostMicrosUsd + notificationEstimatedCostMicrosUsd);
      return {
        ...row,
        ai_estimated_cost_micros_usd: aiEstimatedCostMicrosUsd,
        telephony_estimated_cost_micros_usd: telephonyEstimatedCostMicrosUsd,
        notification_estimated_cost_micros_usd: notificationEstimatedCostMicrosUsd,
        total_estimated_cost_micros_usd: totalEstimatedCostMicrosUsd
      };
    });

    const tenantMetaByKey = new Map(
      tenantMetaRows.rows.map((row) => [
        row.tenant_key,
        {
          tenant_key: row.tenant_key,
          tenant_name: row.tenant_name,
          phone_monthly_cost_cents: Number(row.phone_monthly_cost_cents || 0),
          phone_purchased_at: row.phone_purchased_at || null
        }
      ])
    );

    const tenantRollups = new Map();
    for (const row of normalizedCallRows) {
      const existing = tenantRollups.get(row.tenant_key) || {
        tenant_key: row.tenant_key,
        tenant_name: row.tenant_name || row.tenant_key,
        call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        duration_seconds: 0,
        telephony_billable_minutes: 0,
        ai_estimated_cost_micros_usd: 0,
        telephony_estimated_cost_micros_usd: 0,
        notification_estimated_cost_micros_usd: 0
      };
      existing.call_count += 1;
      existing.input_tokens += Number(row.ai_input_tokens || 0);
      existing.output_tokens += Number(row.ai_output_tokens || 0);
      existing.duration_seconds += Number(row.duration_seconds || 0);
      existing.telephony_billable_minutes += Number(row.telephony_billable_minutes || 0);
      existing.ai_estimated_cost_micros_usd += Number(row.ai_estimated_cost_micros_usd || 0);
      existing.telephony_estimated_cost_micros_usd += Number(row.telephony_estimated_cost_micros_usd || 0);
      existing.notification_estimated_cost_micros_usd += Number(row.notification_estimated_cost_micros_usd || 0);
      tenantRollups.set(row.tenant_key, existing);
    }

    const periodEndMs = Date.now();
    const periodStartMs = periodEndMs - (30 * 24 * 60 * 60 * 1000);
    const allTenantKeys = new Set([
      ...tenantMetaByKey.keys(),
      ...tenantRollups.keys()
    ]);

    const normalizedTenantRows = Array.from(allTenantKeys).map((tenantKey) => {
      const meta = tenantMetaByKey.get(tenantKey) || {
        tenant_key: tenantKey,
        tenant_name: tenantKey,
        phone_monthly_cost_cents: 0,
        phone_purchased_at: null
      };
      const rollup = tenantRollups.get(tenantKey) || {
        tenant_key: tenantKey,
        tenant_name: meta.tenant_name || tenantKey,
        call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        duration_seconds: 0,
        telephony_billable_minutes: 0,
        ai_estimated_cost_micros_usd: 0,
        telephony_estimated_cost_micros_usd: 0,
        notification_estimated_cost_micros_usd: 0
      };
      const numberEstimatedCostCents = estimatePeriodNumberCostCents(
        meta.phone_monthly_cost_cents,
        meta.phone_purchased_at,
        { periodStartMs, periodEndMs }
      );
      const numberEstimatedCostMicrosUsd = numberEstimatedCostCents * 10_000;
      const variableEstimatedCostMicrosUsd =
        Number(rollup.ai_estimated_cost_micros_usd || 0)
        + Number(rollup.telephony_estimated_cost_micros_usd || 0)
        + Number(rollup.notification_estimated_cost_micros_usd || 0);
      return {
        ...rollup,
        tenant_name: meta.tenant_name || rollup.tenant_name || tenantKey,
        phone_monthly_cost_cents: meta.phone_monthly_cost_cents,
        phone_purchased_at: meta.phone_purchased_at,
        number_estimated_cost_cents: numberEstimatedCostCents,
        number_estimated_cost_micros_usd: numberEstimatedCostMicrosUsd,
        variable_estimated_cost_micros_usd: variableEstimatedCostMicrosUsd,
        total_estimated_cost_micros_usd: variableEstimatedCostMicrosUsd + numberEstimatedCostMicrosUsd
      };
    }).sort((a, b) => {
      const totalDiff = Number(b.total_estimated_cost_micros_usd || 0) - Number(a.total_estimated_cost_micros_usd || 0);
      if (totalDiff !== 0) return totalDiff;
      const callDiff = Number(b.call_count || 0) - Number(a.call_count || 0);
      if (callDiff !== 0) return callDiff;
      return String(a.tenant_key || "").localeCompare(String(b.tenant_key || ""));
    });

    return res.status(200).json({
      ok: true,
      tenantRows: normalizedTenantRows,
      callRows: normalizedCallRows,
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
