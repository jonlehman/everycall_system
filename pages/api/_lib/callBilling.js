import {
  BILLING_CALL_TYPE_CODES,
  CALL_BILLING_RULE_VERSION,
  classifyCallBillingType,
  computeCallInvoiceEstimate
} from "../../../lib/callBilling.js";
import {
  buildPlanDisplay,
  ensureTenantBillingAccount,
  getSystemBillingConfig,
  resolveEffectiveCallPricing
} from "./billing.js";
import { resolveBillingWindow } from "../../../lib/leadBilling.js";

function normalizeText(value) {
  return String(value || "").trim();
}

const BILLING_CALL_TYPE_SEED = [
  {
    code: BILLING_CALL_TYPE_CODES.answeredHandled,
    label: "Answered & Handled",
    shortDescription: "Receptionist answered and handled the call.",
    longDescription: "The receptionist answered the call and handled the interaction long enough to count toward included or overage usage.",
    countsTowardUsage: true,
    displayOrder: 10,
    isSystem: true
  },
  {
    code: BILLING_CALL_TYPE_CODES.shortAbandon,
    label: "Short Abandon",
    shortDescription: "Very short answered call.",
    longDescription: "The call connected briefly but ended too quickly to count toward usage.",
    countsTowardUsage: false,
    displayOrder: 20,
    isSystem: true
  },
  {
    code: BILLING_CALL_TYPE_CODES.neverAnswered,
    label: "Never Answered",
    shortDescription: "Call never reached a handled state.",
    longDescription: "The call ended before the receptionist answered and handled it.",
    countsTowardUsage: false,
    displayOrder: 30,
    isSystem: true
  },
  {
    code: BILLING_CALL_TYPE_CODES.technicalFailure,
    label: "Technical Failure",
    shortDescription: "Platform or telephony failure.",
    longDescription: "The call failed because of a platform, prompt, or telephony problem and should not count toward usage.",
    countsTowardUsage: false,
    displayOrder: 40,
    isSystem: true
  },
  {
    code: BILLING_CALL_TYPE_CODES.testCall,
    label: "Test / Internal",
    shortDescription: "Internal or test call.",
    longDescription: "The call was an internal or test interaction and should not count toward customer usage.",
    countsTowardUsage: false,
    displayOrder: 50,
    isSystem: true
  },
  {
    code: BILLING_CALL_TYPE_CODES.manualExclusion,
    label: "Manual Exclusion",
    shortDescription: "Manually excluded from usage.",
    longDescription: "Operations manually excluded this call from usage billing.",
    countsTowardUsage: false,
    displayOrder: 60,
    isSystem: true
  }
];

async function ensureBillingCallTypesSeeded(db) {
  for (const item of BILLING_CALL_TYPE_SEED) {
    await db.query(
      `INSERT INTO billing_call_types (
         code,
         label,
         short_description,
         long_description,
         counts_toward_usage,
         display_order,
         is_system,
         active,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
       ON CONFLICT (code)
       DO UPDATE SET
         label = EXCLUDED.label,
         short_description = EXCLUDED.short_description,
         long_description = EXCLUDED.long_description,
         counts_toward_usage = EXCLUDED.counts_toward_usage,
         display_order = EXCLUDED.display_order,
         is_system = EXCLUDED.is_system,
         active = TRUE,
         updated_at = NOW()`,
      [
        item.code,
        item.label,
        item.shortDescription,
        item.longDescription,
        item.countsTowardUsage,
        item.displayOrder,
        item.isSystem
      ]
    );
  }
}

export async function listBillingCallTypes(db) {
  await ensureBillingCallTypesSeeded(db);
  const result = await db.query(
    `SELECT billing_call_type_id, code, label, short_description, long_description,
            counts_toward_usage, display_order, is_system, active
     FROM billing_call_types
     WHERE active = TRUE
     ORDER BY display_order ASC, billing_call_type_id ASC`
  );
  return result.rows || [];
}

export async function getBillingCallTypesByCode(db) {
  const rows = await listBillingCallTypes(db);
  return new Map(rows.map((row) => [String(row.code || "").trim().toLowerCase(), row]));
}

async function loadCallForBilling(db, { tenantKey, callSid }) {
  const result = await db.query(
    `SELECT
       c.call_sid,
       c.tenant_key,
       c.created_at,
       c.status,
       c.summary,
       c.disposition,
       c.answered_at,
       c.completed_at,
       c.duration_seconds,
       c.billing_call_type_id,
       bct.code AS billing_call_type_code,
       COALESCE(err.error_count, 0) AS gateway_error_count
     FROM calls c
     LEFT JOIN billing_call_types bct
       ON bct.billing_call_type_id = c.billing_call_type_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS error_count
       FROM call_events e
       WHERE e.call_sid = c.call_sid
         AND e.event_type = 'error'
         AND e.role = 'system'
     ) err ON TRUE
     WHERE c.tenant_key = $1
       AND c.call_sid = $2
     LIMIT 1`,
    [tenantKey, callSid]
  );
  return result.rows[0] || null;
}

function resolvePeriodSource(billingState) {
  return billingState?.current_period_start && billingState?.current_period_end
    ? "stripe"
    : "internal";
}

export async function ensureBillingPeriodForWindow(pool, {
  tenantKey,
  billingState,
  billingConfig,
  start,
  end
}) {
  if (!tenantKey || !start || !end) {
    throw new Error("billing_period_requires_window");
  }
  const normalizedBillingConfig = billingConfig || await getSystemBillingConfig(pool);
  const periodStart = new Date(start);
  const periodEnd = new Date(end);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error("billing_period_invalid_window");
  }

  const plan = buildPlanDisplay(billingState, normalizedBillingConfig);
  const callPricing = resolveEffectiveCallPricing(billingState, normalizedBillingConfig);

  await pool.query(
    `INSERT INTO billing_periods (
       tenant_key,
       period_start,
       period_end,
       status,
       source,
       billing_rule_version,
       plan_code,
       monthly_amount_cents,
       included_call_count,
       call_overage_rate_cents,
       stripe_subscription_id,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     ON CONFLICT (tenant_key, period_start, period_end)
     DO NOTHING`,
    [
      tenantKey,
      periodStart.toISOString(),
      periodEnd.toISOString(),
      resolvePeriodSource(billingState),
      CALL_BILLING_RULE_VERSION,
      plan.basePlanCode || plan.code,
      plan.monthlyAmountCents,
      callPricing.includedCallCount,
      callPricing.callOverageRateCents,
      billingState?.stripe_subscription_id || null
    ]
  );

  const result = await pool.query(
    `SELECT *
     FROM billing_periods
     WHERE tenant_key = $1
       AND period_start = $2
       AND period_end = $3
     LIMIT 1`,
    [tenantKey, periodStart.toISOString(), periodEnd.toISOString()]
  );
  return result.rows[0] || null;
}

export async function ensureCurrentBillingPeriod(pool, tenantKey) {
  const billingState = await ensureTenantBillingAccount(pool, tenantKey);
  if (!billingState) return null;
  const billingConfig = await getSystemBillingConfig(pool);
  const window = resolveBillingWindow({
    currentPeriodStart: billingState.current_period_start,
    currentPeriodEnd: billingState.current_period_end
  });
  const period = await ensureBillingPeriodForWindow(pool, {
    tenantKey,
    billingState,
    billingConfig,
    start: window.start,
    end: window.end
  });
  return {
    billingState,
    billingConfig,
    window,
    period
  };
}

export async function classifyAndPersistCallBilling(pool, {
  tenantKey,
  callSid,
  force = false
}) {
  const callRow = await loadCallForBilling(pool, { tenantKey, callSid });
  if (!callRow) {
    throw new Error("call_billing_call_not_found");
  }

  if (!force && Number(callRow.billing_call_type_id || 0) > 0 && normalizeText(callRow.billing_call_type_code).toLowerCase() !== BILLING_CALL_TYPE_CODES.manualExclusion) {
    return {
      callSid,
      billingCallTypeCode: String(callRow.billing_call_type_code || "").trim().toLowerCase() || null,
      billingCallTypeId: Number(callRow.billing_call_type_id || 0) || null,
      reason: "existing_classification_preserved"
    };
  }

  const typeByCode = await getBillingCallTypesByCode(pool);
  const classification = classifyCallBillingType(callRow);
  const typeRow = typeByCode.get(String(classification.code || "").trim().toLowerCase());
  if (!typeRow?.billing_call_type_id) {
    throw new Error(`billing_call_type_missing:${classification.code}`);
  }

  await pool.query(
    `UPDATE calls
     SET billing_call_type_id = $3,
         billing_evaluated_at = NOW(),
         billing_notes_json = $4::jsonb
     WHERE tenant_key = $1
       AND call_sid = $2`,
    [
      tenantKey,
      callSid,
      typeRow.billing_call_type_id,
      JSON.stringify({
        classifier: CALL_BILLING_RULE_VERSION,
        reason: classification.reason,
        gatewayErrorCount: Number(callRow.gateway_error_count || 0),
        durationSeconds: Number(callRow.duration_seconds || 0)
      })
    ]
  );

  return {
    callSid,
    billingCallTypeCode: String(typeRow.code || "").trim().toLowerCase(),
    billingCallTypeId: Number(typeRow.billing_call_type_id || 0),
    reason: classification.reason
  };
}

async function classifyMissingCallsForPeriod(db, period) {
  const missing = await db.query(
    `SELECT c.call_sid
     FROM calls c
     WHERE c.tenant_key = $1
       AND c.created_at >= $2
       AND c.created_at < $3
       AND c.billing_call_type_id IS NULL
     ORDER BY c.created_at ASC, c.call_sid ASC`,
    [period.tenant_key, period.period_start, period.period_end]
  );

  for (const row of missing.rows || []) {
    await classifyAndPersistCallBilling(db, {
      tenantKey: period.tenant_key,
      callSid: row.call_sid
    });
  }
}

export async function rateBillingPeriod(pool, periodId) {
  await ensureBillingCallTypesSeeded(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const periodResult = await client.query(
      `SELECT *
       FROM billing_periods
       WHERE billing_period_id = $1
       FOR UPDATE`,
      [periodId]
    );
    const period = periodResult.rows[0] || null;
    if (!period) {
      throw new Error("billing_period_not_found");
    }

    await classifyMissingCallsForPeriod(client, period);

    const callsResult = await client.query(
      `SELECT
         c.call_sid,
         c.created_at,
         c.billing_call_type_id,
         bct.code AS billing_call_type_code,
         COALESCE(bct.counts_toward_usage, FALSE) AS counts_toward_usage
       FROM calls c
       LEFT JOIN billing_call_types bct
         ON bct.billing_call_type_id = c.billing_call_type_id
       WHERE c.tenant_key = $1
         AND c.created_at >= $2
         AND c.created_at < $3
       ORDER BY c.created_at ASC, c.call_sid ASC`,
      [period.tenant_key, period.period_start, period.period_end]
    );

    const periodCalls = callsResult.rows || [];
    const includedLimit = Math.max(0, Number(period.included_call_count || 0));
    let eligibleSequence = 0;

    await client.query(
      `DELETE FROM billing_period_call_assignments
       WHERE billing_period_id = $1`,
      [period.billing_period_id]
    );

    for (const row of periodCalls) {
      const isEligible = Boolean(row.counts_toward_usage);
      const sequenceNumber = isEligible ? eligibleSequence + 1 : null;
      const chargeBucket = !isEligible
        ? "excluded"
        : sequenceNumber <= includedLimit
          ? "included"
          : "overage";

      if (isEligible) {
        eligibleSequence += 1;
      }

      await client.query(
        `INSERT INTO billing_period_call_assignments (
           billing_period_id,
           call_sid,
           billing_call_type_id,
           charge_bucket,
           sequence_number,
           assigned_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          period.billing_period_id,
          row.call_sid,
          row.billing_call_type_id || null,
          chargeBucket,
          sequenceNumber
        ]
      );
    }

    const eligibleCallCount = eligibleSequence;
    const includedCallCountUsed = Math.min(eligibleCallCount, includedLimit);
    const overageCallCount = Math.max(0, eligibleCallCount - includedLimit);
    const overageAmountCents = overageCallCount * Math.max(0, Number(period.call_overage_rate_cents || 0));

    await client.query(
      `UPDATE billing_periods
       SET eligible_call_count = $2,
           included_call_count_used = $3,
           overage_call_count = $4,
           overage_amount_cents = $5,
           updated_at = NOW()
       WHERE billing_period_id = $1`,
      [
        period.billing_period_id,
        eligibleCallCount,
        includedCallCountUsed,
        overageCallCount,
        overageAmountCents
      ]
    );

    await client.query("COMMIT");
    return {
      billingPeriodId: Number(period.billing_period_id || 0),
      eligibleCallCount,
      includedCallCountUsed,
      overageCallCount,
      overageAmountCents
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function syncCurrentBillingPeriod(pool, tenantKey) {
  const current = await ensureCurrentBillingPeriod(pool, tenantKey);
  if (!current?.period?.billing_period_id) {
    return null;
  }
  await rateBillingPeriod(pool, current.period.billing_period_id);
  return summarizeCurrentBillingPeriod(pool, tenantKey);
}

export async function syncCallBillingForCall(pool, {
  tenantKey,
  callSid
}) {
  await classifyAndPersistCallBilling(pool, { tenantKey, callSid });
  return syncCurrentBillingPeriod(pool, tenantKey);
}

export async function summarizeCurrentBillingPeriod(pool, tenantKey) {
  const current = await ensureCurrentBillingPeriod(pool, tenantKey);
  if (!current?.period?.billing_period_id) {
    return null;
  }

  const result = await pool.query(
    `SELECT
       p.billing_period_id,
       p.period_start,
       p.period_end,
       p.status,
       p.source,
       p.billing_rule_version,
       p.plan_code,
       p.monthly_amount_cents,
       p.included_call_count,
       p.call_overage_rate_cents,
       p.eligible_call_count,
       p.included_call_count_used,
       p.overage_call_count,
       p.overage_amount_cents,
       COUNT(*) FILTER (WHERE a.charge_bucket = 'excluded')::int AS excluded_call_count
     FROM billing_periods p
     LEFT JOIN billing_period_call_assignments a
       ON a.billing_period_id = p.billing_period_id
     WHERE p.billing_period_id = $1
     GROUP BY p.billing_period_id`,
    [current.period.billing_period_id]
  );
  const period = result.rows[0] || current.period;
  const invoiceEstimate = computeCallInvoiceEstimate({
    baseAmountCents: Number(period.monthly_amount_cents || 0),
    eligibleCallCount: Number(period.eligible_call_count || 0)
  }, {
    includedCallCount: Number(period.included_call_count || 0),
    callOverageRateCents: Number(period.call_overage_rate_cents || 0)
  });

  const recentCallsResult = await pool.query(
    `SELECT
       a.call_sid,
       a.charge_bucket,
       a.sequence_number,
       bct.code AS billing_call_type_code,
       bct.label AS billing_call_type_label,
       c.created_at,
       c.summary,
       c.status,
       d.caller_first_name,
       d.caller_last_name,
       d.callback_number,
       d.service_required
     FROM billing_period_call_assignments a
     LEFT JOIN billing_call_types bct
       ON bct.billing_call_type_id = a.billing_call_type_id
     LEFT JOIN calls c
       ON c.call_sid = a.call_sid
     LEFT JOIN call_details d
       ON d.call_sid = a.call_sid
     WHERE a.billing_period_id = $1
     ORDER BY c.created_at DESC, a.call_sid DESC
     LIMIT 25`,
    [current.period.billing_period_id]
  );

  return {
    billingPeriodId: Number(period.billing_period_id || 0),
    currentPeriod: {
      label: current.window.label,
      start: new Date(period.period_start || current.window.start).toISOString(),
      end: new Date(period.period_end || current.window.end).toISOString()
    },
    source: period.source || current.period.source || "internal",
    billingRuleVersion: period.billing_rule_version || CALL_BILLING_RULE_VERSION,
    callPricing: {
      includedCallCount: Number(period.included_call_count || 0),
      callOverageRateCents: Number(period.call_overage_rate_cents || 0)
    },
    callUsage: {
      eligibleCallCount: Number(period.eligible_call_count || 0),
      includedCallCountUsed: Number(period.included_call_count_used || 0),
      overageCallCount: Number(period.overage_call_count || 0),
      excludedCallCount: Number(period.excluded_call_count || 0),
      recentCalls: recentCallsResult.rows || []
    },
    invoiceEstimate
  };
}
