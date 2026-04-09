function normalizeText(value) {
  return String(value || "").trim();
}

export const CALL_BILLING_RULE_VERSION = "call_billing_v1";
export const SHORT_ABANDON_SECONDS = 60;

export const BILLING_CALL_TYPE_CODES = {
  answeredHandled: "answered_handled",
  shortAbandon: "short_abandon",
  neverAnswered: "never_answered",
  technicalFailure: "technical_failure",
  testCall: "test_call",
  manualExclusion: "manual_exclusion"
};

const BILLING_CALL_TYPE_LABELS = {
  [BILLING_CALL_TYPE_CODES.answeredHandled]: "Answered & Handled",
  [BILLING_CALL_TYPE_CODES.shortAbandon]: "Short Abandon",
  [BILLING_CALL_TYPE_CODES.neverAnswered]: "Never Answered",
  [BILLING_CALL_TYPE_CODES.technicalFailure]: "Technical Failure",
  [BILLING_CALL_TYPE_CODES.testCall]: "Test / Internal",
  [BILLING_CALL_TYPE_CODES.manualExclusion]: "Manual Exclusion"
};

const CHARGE_BUCKET_META = {
  included: {
    label: "Included",
    tone: "ok"
  },
  overage: {
    label: "Overage",
    tone: "warn"
  },
  excluded: {
    label: "Excluded",
    tone: "neutral"
  }
};

function normalizePercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(100, Number(amount.toFixed(2))));
}

function applyPercentDiscount(amountCents, percent) {
  const normalizedAmount = Number.isFinite(Number(amountCents))
    ? Math.max(0, Math.round(Number(amountCents)))
    : 0;
  const normalizedPercent = normalizePercent(percent);
  return Math.max(0, Math.round(normalizedAmount * ((100 - normalizedPercent) / 100)));
}

export function computeCallInvoiceEstimate({ baseAmountCents, eligibleCallCount }, pricing = {}, discounts = {}) {
  const normalizedBaseAmount = Number.isFinite(Number(baseAmountCents))
    ? Math.max(0, Math.round(Number(baseAmountCents)))
    : 0;
  const normalizedEligibleCount = Number.isFinite(Number(eligibleCallCount))
    ? Math.max(0, Math.round(Number(eligibleCallCount)))
    : 0;
  const includedCallCount = Number.isFinite(Number(pricing?.includedCallCount))
    ? Math.max(0, Math.round(Number(pricing.includedCallCount)))
    : 0;
  const callOverageRateCents = Number.isFinite(Number(pricing?.callOverageRateCents))
    ? Math.max(0, Math.round(Number(pricing.callOverageRateCents)))
    : 0;
  const monthlyDiscountPercent = normalizePercent(discounts?.monthlyDiscountPercent);
  const overageDiscountPercent = normalizePercent(discounts?.overageDiscountPercent);
  const overageCallCount = Math.max(0, normalizedEligibleCount - includedCallCount);
  const rawOverageAmountCents = overageCallCount * callOverageRateCents;
  const discountedBaseAmountCents = applyPercentDiscount(normalizedBaseAmount, monthlyDiscountPercent);
  const overageAmountCents = applyPercentDiscount(rawOverageAmountCents, overageDiscountPercent);
  return {
    baseAmountCents: normalizedBaseAmount,
    discountedBaseAmountCents,
    monthlyDiscountPercent,
    includedCallCount,
    callOverageRateCents,
    eligibleCallCount: normalizedEligibleCount,
    overageCallCount,
    rawOverageAmountCents,
    overageDiscountPercent,
    overageAmountCents,
    totalEstimatedInvoiceCents: discountedBaseAmountCents + overageAmountCents
  };
}

export function formatBillingCallTypeLabel(code) {
  const normalized = normalizeText(code).toLowerCase();
  if (!normalized) return "Unclassified";
  return BILLING_CALL_TYPE_LABELS[normalized]
    || normalized
      .split(/[_\s]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
}

export function getChargeBucketMeta(chargeBucket) {
  const normalized = normalizeText(chargeBucket).toLowerCase();
  return CHARGE_BUCKET_META[normalized] || CHARGE_BUCKET_META.excluded;
}

export function classifyCallBillingType(source = {}, {
  shortAbandonSeconds = SHORT_ABANDON_SECONDS
} = {}) {
  const existingCode = normalizeText(source.billing_call_type_code).toLowerCase();
  if (existingCode === BILLING_CALL_TYPE_CODES.manualExclusion) {
    return {
      code: BILLING_CALL_TYPE_CODES.manualExclusion,
      reason: "manual_exclusion_preserved"
    };
  }

  const durationSeconds = Number.isFinite(Number(source.duration_seconds))
    ? Math.max(0, Math.round(Number(source.duration_seconds)))
    : 0;
  const answeredAt = normalizeText(source.answered_at);
  const hasAnswered = Boolean(answeredAt);
  const hasGatewayErrors = Number(source.gateway_error_count || 0) > 0;

  if (hasAnswered && durationSeconds >= Math.max(1, shortAbandonSeconds)) {
    return {
      code: BILLING_CALL_TYPE_CODES.answeredHandled,
      reason: "answered_duration_threshold_met"
    };
  }

  if (hasAnswered && durationSeconds > 0 && durationSeconds < Math.max(1, shortAbandonSeconds)) {
    return {
      code: BILLING_CALL_TYPE_CODES.shortAbandon,
      reason: "answered_but_short"
    };
  }

  if (hasGatewayErrors) {
    return {
      code: BILLING_CALL_TYPE_CODES.technicalFailure,
      reason: "gateway_error_recorded"
    };
  }

  return {
    code: BILLING_CALL_TYPE_CODES.neverAnswered,
    reason: "not_answered"
  };
}
