import {
  BILLING_CALL_TYPE_CODES,
  CALL_BILLING_RULE_VERSION,
  classifyCallBillingType,
  computeCallInvoiceEstimate
} from "../../../lib/callBilling.js";
import { getTenantActiveCouponRedemption, refreshTenantCouponState } from "./billingCoupons.js";
import {
  buildPlanDisplay,
  ensureTenantBillingAccount,
  getSystemBillingConfig,
  resolveEffectiveCallPricing
} from "./billing.js";
import { resolveBillingWindow } from "../../../lib/leadBilling.js";
import { createInvoiceItem } from "./stripe.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeReasonCode(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function couponAppliesToPeriod(coupon, periodStart) {
  if (!coupon) return false;
  const normalizedStart = normalizeDate(periodStart);
  if (!normalizedStart || !coupon.discountStartsAt) return false;
  const discountStartsAt = normalizeDate(coupon.discountStartsAt);
  const discountEndsAt = normalizeDate(coupon.discountEndsAt);
  if (!discountStartsAt) return false;
  if (normalizedStart.getTime() < discountStartsAt.getTime()) return false;
  if (discountEndsAt && normalizedStart.getTime() >= discountEndsAt.getTime()) return false;
  return true;
}

const BILLING_CALL_TYPE_SEED = [
  {
    code: BILLING_CALL_TYPE_CODES.answeredHandled,
    label: "Answered & Handled",
    shortDescription: "Answered call lasting one minute or longer.",
    longDescription: "The receptionist answered the call and the interaction lasted at least one minute, so it counts toward included or overage usage.",
    countsTowardUsage: true,
    displayOrder: 10,
    isSystem: true
  },
  {
    code: BILLING_CALL_TYPE_CODES.shortAbandon,
    label: "Short Abandon",
    shortDescription: "Answered call lasting under one minute.",
    longDescription: "The call connected and was answered, but it ended before one minute elapsed, so it does not count toward usage.",
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

export async function getBillingCallTypeByCode(db, code) {
  const normalizedCode = normalizeText(code).toLowerCase();
  if (!normalizedCode) return null;
  await ensureBillingCallTypesSeeded(db);
  const result = await db.query(
    `SELECT billing_call_type_id, code, label, short_description, long_description,
            counts_toward_usage, display_order, is_system, active
     FROM billing_call_types
     WHERE code = $1
     LIMIT 1`,
    [normalizedCode]
  );
  return result.rows[0] || null;
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
  await refreshTenantCouponState(pool, tenantKey);
  const activeCoupon = await getTenantActiveCouponRedemption(pool, tenantKey);
  const appliedCoupon = couponAppliesToPeriod(activeCoupon, periodStart)
    ? activeCoupon
    : null;

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
       billing_coupon_redemption_id,
       billing_coupon_id,
       coupon_code,
       monthly_discount_percent,
       overage_discount_percent,
       stripe_subscription_id,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
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
      appliedCoupon?.billingCouponRedemptionId || null,
      appliedCoupon?.billingCouponId || null,
      appliedCoupon?.code || null,
      Number(appliedCoupon?.monthlyDiscountPercent || 0),
      Number(appliedCoupon?.overageDiscountPercent || 0),
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
  const existingPeriod = result.rows[0] || null;
  if (
    existingPeriod
    && String(existingPeriod.status || "").toLowerCase() === "open"
    && Number(existingPeriod.eligible_call_count || 0) === 0
    && Number(existingPeriod.included_call_count_used || 0) === 0
    && Number(existingPeriod.overage_call_count || 0) === 0
    && (
      Number(existingPeriod.billing_coupon_redemption_id || 0) !== Number(appliedCoupon?.billingCouponRedemptionId || 0)
      || Number(existingPeriod.monthly_discount_percent || 0) !== Number(appliedCoupon?.monthlyDiscountPercent || 0)
      || Number(existingPeriod.overage_discount_percent || 0) !== Number(appliedCoupon?.overageDiscountPercent || 0)
    )
  ) {
    await pool.query(
      `UPDATE billing_periods
       SET billing_coupon_redemption_id = $2,
           billing_coupon_id = $3,
           coupon_code = $4,
           monthly_discount_percent = $5,
           overage_discount_percent = $6,
           updated_at = NOW()
       WHERE billing_period_id = $1`,
      [
        existingPeriod.billing_period_id,
        appliedCoupon?.billingCouponRedemptionId || null,
        appliedCoupon?.billingCouponId || null,
        appliedCoupon?.code || null,
        Number(appliedCoupon?.monthlyDiscountPercent || 0),
        Number(appliedCoupon?.overageDiscountPercent || 0)
      ]
    );
    const refreshed = await pool.query(
      `SELECT *
       FROM billing_periods
       WHERE billing_period_id = $1
       LIMIT 1`,
      [existingPeriod.billing_period_id]
    );
    return refreshed.rows[0] || existingPeriod;
  }
  return existingPeriod;
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
    const invoiceEstimate = computeCallInvoiceEstimate(
      {
        baseAmountCents: Number(period.monthly_amount_cents || 0),
        eligibleCallCount
      },
      {
        includedCallCount: Number(period.included_call_count || 0),
        callOverageRateCents: Number(period.call_overage_rate_cents || 0)
      },
      {
        monthlyDiscountPercent: Number(period.monthly_discount_percent || 0),
        overageDiscountPercent: Number(period.overage_discount_percent || 0)
      }
    );
    const overageAmountCents = Number(invoiceEstimate.overageAmountCents || 0);

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

async function sumBillingPeriodAdjustments(pool, billingPeriodId) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN adjustment_type = 'credit' THEN amount_cents ELSE 0 END), 0)::int AS credit_amount_cents,
       COALESCE(SUM(CASE WHEN adjustment_type = 'debit' THEN amount_cents ELSE 0 END), 0)::int AS debit_amount_cents
     FROM billing_period_adjustments
     WHERE billing_period_id = $1`,
    [billingPeriodId]
  );
  return result.rows[0] || {
    credit_amount_cents: 0,
    debit_amount_cents: 0
  };
}

export async function listBillingPeriods(pool, tenantKey, { limit = 12 } = {}) {
  if (!tenantKey) return [];
  await ensureCurrentBillingPeriod(pool, tenantKey);
  const result = await pool.query(
    `SELECT
       p.billing_period_id,
       p.status,
       p.source,
       p.billing_rule_version,
       p.period_start,
       p.period_end,
       p.plan_code,
       p.monthly_amount_cents,
       p.included_call_count,
       p.call_overage_rate_cents,
       p.billing_coupon_redemption_id,
       p.billing_coupon_id,
       p.coupon_code,
       p.monthly_discount_percent,
       p.overage_discount_percent,
       p.eligible_call_count,
       p.included_call_count_used,
       p.overage_call_count,
       p.overage_amount_cents,
       p.stripe_invoice_id,
       p.stripe_invoice_item_id,
       p.finalized_at,
       p.invoiced_at,
       COALESCE(adj.credit_amount_cents, 0)::int AS credit_amount_cents,
       COALESCE(adj.debit_amount_cents, 0)::int AS debit_amount_cents
     FROM billing_periods p
     LEFT JOIN (
       SELECT
         billing_period_id,
         COALESCE(SUM(CASE WHEN adjustment_type = 'credit' THEN amount_cents ELSE 0 END), 0)::int AS credit_amount_cents,
         COALESCE(SUM(CASE WHEN adjustment_type = 'debit' THEN amount_cents ELSE 0 END), 0)::int AS debit_amount_cents
       FROM billing_period_adjustments
       GROUP BY billing_period_id
     ) adj
       ON adj.billing_period_id = p.billing_period_id
     WHERE p.tenant_key = $1
     ORDER BY p.period_start DESC, p.billing_period_id DESC
     LIMIT $2`,
    [tenantKey, Math.max(1, Number(limit || 12))]
  );
  return (result.rows || []).map((row) => {
    const creditAmountCents = Number(row.credit_amount_cents || 0);
    const debitAmountCents = Number(row.debit_amount_cents || 0);
    const invoiceEstimate = computeCallInvoiceEstimate(
      {
        baseAmountCents: Number(row.monthly_amount_cents || 0),
        eligibleCallCount: Number(row.eligible_call_count || 0)
      },
      {
        includedCallCount: Number(row.included_call_count || 0),
        callOverageRateCents: Number(row.call_overage_rate_cents || 0)
      },
      {
        monthlyDiscountPercent: Number(row.monthly_discount_percent || 0),
        overageDiscountPercent: Number(row.overage_discount_percent || 0)
      }
    );
    return {
      billingPeriodId: Number(row.billing_period_id || 0),
      status: row.status || "open",
      source: row.source || null,
      billingRuleVersion: row.billing_rule_version || null,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      planCode: row.plan_code || null,
      monthlyAmountCents: Number(row.monthly_amount_cents || 0),
      includedCallCount: Number(row.included_call_count || 0),
      callOverageRateCents: Number(row.call_overage_rate_cents || 0),
      billingCouponRedemptionId: Number(row.billing_coupon_redemption_id || 0) || null,
      billingCouponId: Number(row.billing_coupon_id || 0) || null,
      couponCode: row.coupon_code || null,
      monthlyDiscountPercent: Number(row.monthly_discount_percent || 0),
      overageDiscountPercent: Number(row.overage_discount_percent || 0),
      eligibleCallCount: Number(row.eligible_call_count || 0),
      includedCallCountUsed: Number(row.included_call_count_used || 0),
      overageCallCount: Number(row.overage_call_count || 0),
      overageAmountCents: Number(row.overage_amount_cents || 0),
      discountedMonthlyAmountCents: Number(invoiceEstimate.discountedBaseAmountCents || 0),
      creditAmountCents,
      debitAmountCents,
      netAdjustmentAmountCents: debitAmountCents - creditAmountCents,
      totalEstimatedInvoiceCents: Number(invoiceEstimate.totalEstimatedInvoiceCents || 0) + (debitAmountCents - creditAmountCents),
      stripeInvoiceId: row.stripe_invoice_id || null,
      stripeInvoiceItemId: row.stripe_invoice_item_id || null,
      finalizedAt: row.finalized_at || null,
      invoicedAt: row.invoiced_at || null
    };
  });
}

export async function getBillingPeriodDetail(pool, billingPeriodId, { callLimit = 100 } = {}) {
  if (!Number.isFinite(Number(billingPeriodId)) || Number(billingPeriodId) <= 0) {
    return null;
  }

  const periodResult = await pool.query(
    `SELECT *
     FROM billing_periods
     WHERE billing_period_id = $1
     LIMIT 1`,
    [billingPeriodId]
  );
  const period = periodResult.rows[0] || null;
  if (!period) return null;

  const [callsResult, adjustmentsResult, adjustmentTotals, usageSummaryResult] = await Promise.all([
    pool.query(
      `SELECT
         a.call_sid,
         a.charge_bucket,
         a.sequence_number,
         bct.code AS billing_call_type_code,
         bct.label AS billing_call_type_label,
         c.created_at,
         c.summary,
         c.status,
         c.duration_seconds,
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
       LIMIT $2`,
      [billingPeriodId, Math.max(1, Number(callLimit || 100))]
    ),
    pool.query(
      `SELECT
         billing_period_adjustment_id,
         adjustment_type,
         reason_code,
         description,
         amount_cents,
         metadata_json,
         stripe_invoice_item_id,
         invoiced_at,
         created_by_type,
         created_by_id,
         created_at
       FROM billing_period_adjustments
       WHERE billing_period_id = $1
       ORDER BY created_at DESC, billing_period_adjustment_id DESC`,
      [billingPeriodId]
    ),
    sumBillingPeriodAdjustments(pool, billingPeriodId)
    ,
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE charge_bucket = 'included')::int AS included_call_count_used,
         COUNT(*) FILTER (WHERE charge_bucket = 'overage')::int AS overage_call_count,
         COUNT(*) FILTER (WHERE charge_bucket = 'excluded')::int AS excluded_call_count
       FROM billing_period_call_assignments
       WHERE billing_period_id = $1`,
      [billingPeriodId]
    )
  ]);

  const usageSummary = usageSummaryResult.rows[0] || {};
  const creditAmountCents = Number(adjustmentTotals.credit_amount_cents || 0);
  const debitAmountCents = Number(adjustmentTotals.debit_amount_cents || 0);
  const netAdjustmentAmountCents = debitAmountCents - creditAmountCents;
  const invoiceEstimate = computeCallInvoiceEstimate({
    baseAmountCents: Number(period.monthly_amount_cents || 0),
    eligibleCallCount: Number(period.eligible_call_count || 0)
  }, {
    includedCallCount: Number(period.included_call_count || 0),
    callOverageRateCents: Number(period.call_overage_rate_cents || 0)
  }, {
    monthlyDiscountPercent: Number(period.monthly_discount_percent || 0),
    overageDiscountPercent: Number(period.overage_discount_percent || 0)
  });

  return {
    billingPeriodId: Number(period.billing_period_id || 0),
    tenantKey: period.tenant_key,
    status: period.status,
    source: period.source,
    billingRuleVersion: period.billing_rule_version,
    periodStart: period.period_start,
    periodEnd: period.period_end,
    planCode: period.plan_code || null,
    coupon: period.coupon_code
      ? {
          billingCouponRedemptionId: Number(period.billing_coupon_redemption_id || 0) || null,
          billingCouponId: Number(period.billing_coupon_id || 0) || null,
          code: period.coupon_code,
          monthlyDiscountPercent: Number(period.monthly_discount_percent || 0),
          overageDiscountPercent: Number(period.overage_discount_percent || 0)
        }
      : null,
    currentPeriod: {
      label: "Current billing period",
      start: new Date(period.period_start).toISOString(),
      end: new Date(period.period_end).toISOString()
    },
    callPricing: {
      includedCallCount: Number(period.included_call_count || 0),
      callOverageRateCents: Number(period.call_overage_rate_cents || 0)
    },
    callUsage: {
      eligibleCallCount: Number(period.eligible_call_count || 0),
      includedCallCountUsed: Number(usageSummary.included_call_count_used || period.included_call_count_used || 0),
      overageCallCount: Number(usageSummary.overage_call_count || period.overage_call_count || 0),
      excludedCallCount: Number(usageSummary.excluded_call_count || 0),
      recentCalls: callsResult.rows || []
    },
    adjustments: {
      creditAmountCents,
      debitAmountCents,
      netAdjustmentAmountCents,
      items: adjustmentsResult.rows || []
    },
    invoiceEstimate: {
      ...invoiceEstimate,
      adjustmentCreditCents: creditAmountCents,
      adjustmentDebitCents: debitAmountCents,
      netAdjustmentAmountCents,
      totalEstimatedInvoiceCents: invoiceEstimate.totalEstimatedInvoiceCents + netAdjustmentAmountCents
    },
    stripe: {
      subscriptionId: period.stripe_subscription_id || null,
      invoiceId: period.stripe_invoice_id || null,
      invoiceItemId: period.stripe_invoice_item_id || null,
      finalizedAt: period.finalized_at || null,
      invoicedAt: period.invoiced_at || null
    }
  };
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

  const detail = await getBillingPeriodDetail(pool, current.period.billing_period_id, { callLimit: 25 });
  if (!detail) return null;
  return {
    ...detail,
    currentPeriod: {
      label: current.window.label,
      start: detail.currentPeriod.start,
      end: detail.currentPeriod.end
    }
  };
}

export async function setManualCallBillingExclusion(pool, {
  tenantKey,
  callSid,
  billingPeriodId,
  exclude = true,
  createdById = null
}) {
  const normalizedPeriodId = Number(billingPeriodId || 0);
  if (!tenantKey || !callSid || !normalizedPeriodId) {
    throw new Error("billing_manual_exclusion_missing_fields");
  }
  const period = await getBillingPeriodDetail(pool, normalizedPeriodId, { callLimit: 1 });
  if (!period || period.tenantKey !== tenantKey) {
    throw new Error("billing_period_not_found");
  }

  if (exclude) {
    const manualType = await getBillingCallTypeByCode(pool, BILLING_CALL_TYPE_CODES.manualExclusion);
    if (!manualType?.billing_call_type_id) {
      throw new Error("manual_exclusion_type_missing");
    }
    await pool.query(
      `UPDATE calls
       SET billing_call_type_id = $3,
           billing_evaluated_at = NOW(),
           billing_notes_json = jsonb_build_object(
             'classifier', $4,
             'reason', 'manual_exclusion',
             'updatedBy', $5
           )
       WHERE tenant_key = $1
         AND call_sid = $2`,
      [tenantKey, callSid, manualType.billing_call_type_id, CALL_BILLING_RULE_VERSION, createdById || null]
    );
  } else {
    await classifyAndPersistCallBilling(pool, {
      tenantKey,
      callSid,
      force: true
    });
  }

  await rateBillingPeriod(pool, normalizedPeriodId);
  return getBillingPeriodDetail(pool, normalizedPeriodId);
}

export async function createBillingPeriodAdjustment(pool, {
  tenantKey,
  billingPeriodId,
  adjustmentType,
  reasonCode = null,
  description,
  amountCents,
  createdByType = "admin",
  createdById = null
}) {
  const normalizedPeriodId = Number(billingPeriodId || 0);
  const normalizedType = normalizeText(adjustmentType).toLowerCase();
  const normalizedDescription = normalizeText(description);
  const normalizedAmount = Number(amountCents);
  if (!tenantKey || !normalizedPeriodId || !["credit", "debit"].includes(normalizedType) || !normalizedDescription) {
    throw new Error("billing_adjustment_invalid");
  }
  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error("billing_adjustment_amount_invalid");
  }
  const period = await getBillingPeriodDetail(pool, normalizedPeriodId, { callLimit: 1 });
  if (!period || period.tenantKey !== tenantKey) {
    throw new Error("billing_period_not_found");
  }

  await pool.query(
    `INSERT INTO billing_period_adjustments (
       billing_period_id,
       adjustment_type,
       reason_code,
       description,
       amount_cents,
       metadata_json,
       created_by_type,
       created_by_id,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, NOW())`,
    [
      normalizedPeriodId,
      normalizedType,
      normalizeReasonCode(reasonCode) || null,
      normalizedDescription,
      normalizedAmount,
      createdByType,
      createdById
    ]
  );

  return getBillingPeriodDetail(pool, normalizedPeriodId);
}

export async function ensureBillingPeriodsForActiveTenants(pool) {
  const tenants = await pool.query(
    `SELECT tenant_key
     FROM tenants
     WHERE billing_status IN ('trialing', 'active', 'past_due', 'unpaid')`
  );
  let ensured = 0;
  for (const row of tenants.rows || []) {
    const ensuredPeriod = await ensureCurrentBillingPeriod(pool, row.tenant_key);
    if (ensuredPeriod?.period?.billing_period_id) {
      ensured += 1;
    }
  }
  return ensured;
}

async function createOverageInvoiceItemForPeriod(pool, period) {
  if (period.stripe_invoice_item_id || Number(period.overage_amount_cents || 0) <= 0) {
    return null;
  }
  const billingState = await ensureTenantBillingAccount(pool, period.tenant_key);
  if (!billingState?.stripe_customer_id || !billingState?.stripe_subscription_id) {
    return null;
  }
  if (String(billingState.billing_status || "").toLowerCase() === "trialing") {
    return null;
  }
  const rawOverageAmountCents = Math.max(0, Number(period.overage_call_count || 0)) * Math.max(0, Number(period.call_overage_rate_cents || 0));
  const overageDiscountPercent = Number(period.overage_discount_percent || 0);
  const description = overageDiscountPercent > 0
    ? `${Number(period.overage_call_count || 0)} call overages × $${(Number(period.call_overage_rate_cents || 0) / 100).toFixed(2)} = $${(rawOverageAmountCents / 100).toFixed(2)}, discounted ${overageDiscountPercent}% = $${(Number(period.overage_amount_cents || 0) / 100).toFixed(2)} (included limit: ${Number(period.included_call_count || 0)})`
    : `${Number(period.overage_call_count || 0)} call overages × $${(Number(period.call_overage_rate_cents || 0) / 100).toFixed(2)} = $${(Number(period.overage_amount_cents || 0) / 100).toFixed(2)} (included limit: ${Number(period.included_call_count || 0)})`;
  const item = await createInvoiceItem({
    customerId: billingState.stripe_customer_id,
    subscriptionId: billingState.stripe_subscription_id,
    amountCents: Number(period.overage_amount_cents || 0),
    description,
    metadata: {
      tenant_key: period.tenant_key,
      billing_period_id: String(period.billing_period_id),
      item_type: "call_overage"
    }
  });
  await pool.query(
    `UPDATE billing_periods
     SET stripe_invoice_item_id = $2,
         stripe_subscription_id = COALESCE(stripe_subscription_id, $3),
         status = 'invoiced',
         invoiced_at = COALESCE(invoiced_at, NOW()),
         updated_at = NOW()
     WHERE billing_period_id = $1`,
    [period.billing_period_id, item?.id || null, billingState.stripe_subscription_id]
  );
  return item || null;
}

async function createAdjustmentInvoiceItemsForPeriod(pool, period) {
  const billingState = await ensureTenantBillingAccount(pool, period.tenant_key);
  if (!billingState?.stripe_customer_id || !billingState?.stripe_subscription_id) {
    return 0;
  }
  if (String(billingState.billing_status || "").toLowerCase() === "trialing") {
    return 0;
  }
  const pending = await pool.query(
    `SELECT billing_period_adjustment_id, adjustment_type, description, amount_cents
     FROM billing_period_adjustments
     WHERE billing_period_id = $1
       AND stripe_invoice_item_id IS NULL
     ORDER BY created_at ASC, billing_period_adjustment_id ASC`,
    [period.billing_period_id]
  );
  let created = 0;
  for (const row of pending.rows || []) {
    const signedAmountCents = String(row.adjustment_type || "").toLowerCase() === "credit"
      ? -Math.abs(Number(row.amount_cents || 0))
      : Math.abs(Number(row.amount_cents || 0));
    const item = await createInvoiceItem({
      customerId: billingState.stripe_customer_id,
      subscriptionId: billingState.stripe_subscription_id,
      amountCents: signedAmountCents,
      description: `Billing adjustment: ${row.description}`,
      metadata: {
        tenant_key: period.tenant_key,
        billing_period_id: String(period.billing_period_id),
        billing_period_adjustment_id: String(row.billing_period_adjustment_id),
        item_type: "billing_adjustment"
      }
    });
    await pool.query(
      `UPDATE billing_period_adjustments
       SET stripe_invoice_item_id = $2,
           invoiced_at = NOW()
       WHERE billing_period_adjustment_id = $1`,
      [row.billing_period_adjustment_id, item?.id || null]
    );
    created += 1;
  }
  return created;
}

export async function finalizeDueBillingPeriods(pool) {
  await ensureBillingPeriodsForActiveTenants(pool);
  const due = await pool.query(
    `SELECT *
     FROM billing_periods
     WHERE period_end <= NOW()
       AND status IN ('open', 'finalized')
     ORDER BY period_end ASC, billing_period_id ASC`
  );
  let finalizedPeriods = 0;
  let invoicedPeriods = 0;
  let createdInvoiceItems = 0;

  for (const period of due.rows || []) {
    await rateBillingPeriod(pool, period.billing_period_id);
    await pool.query(
      `UPDATE billing_periods
       SET status = CASE WHEN status = 'open' THEN 'finalized' ELSE status END,
           finalized_at = COALESCE(finalized_at, NOW()),
           updated_at = NOW()
       WHERE billing_period_id = $1`,
      [period.billing_period_id]
    );
    finalizedPeriods += 1;

    const refreshedResult = await pool.query(
      `SELECT *
       FROM billing_periods
       WHERE billing_period_id = $1
       LIMIT 1`,
      [period.billing_period_id]
    );
    const refreshed = refreshedResult.rows[0] || period;
    const overageItem = await createOverageInvoiceItemForPeriod(pool, refreshed);
    const adjustmentCount = await createAdjustmentInvoiceItemsForPeriod(pool, refreshed);
    if (overageItem) {
      createdInvoiceItems += 1;
    }
    createdInvoiceItems += adjustmentCount;

    if (
      refreshed.source !== "stripe"
      || String((await ensureTenantBillingAccount(pool, refreshed.tenant_key))?.billing_status || "").toLowerCase() === "trialing"
      || refreshed.stripe_invoice_item_id
      || Number(refreshed.overage_amount_cents || 0) <= 0
    ) {
      await pool.query(
        `UPDATE billing_periods
         SET status = CASE
           WHEN status = 'finalized' AND ($2::boolean = TRUE) THEN 'invoiced'
           ELSE status
         END,
             invoiced_at = CASE
               WHEN status = 'finalized' AND ($2::boolean = TRUE) THEN COALESCE(invoiced_at, NOW())
               ELSE invoiced_at
             END,
             updated_at = NOW()
         WHERE billing_period_id = $1`,
        [refreshed.billing_period_id, refreshed.source !== "stripe" || Number(refreshed.overage_amount_cents || 0) <= 0]
      );
    }

    const finalState = await pool.query(
      `SELECT status
       FROM billing_periods
       WHERE billing_period_id = $1
       LIMIT 1`,
      [refreshed.billing_period_id]
    );
    if (String(finalState.rows[0]?.status || "") === "invoiced") {
      invoicedPeriods += 1;
    }
  }

  return {
    ensuredPeriods: Number(due.rowCount || 0),
    finalizedPeriods,
    invoicedPeriods,
    createdInvoiceItems
  };
}
