function normalizeText(value) {
  return String(value || "").trim();
}

export function formatLeadOutcomeLabel(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "Non-lead";
  return normalized
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const LEAD_REASON_LABELS = {
  explicit_project_lead: "Explicit project lead",
  inferred_project_lead: "Inferred project lead",
  duplicate_recent_lead: "Duplicate recent lead",
  missing_callback_number: "Missing callback number",
  general_inquiry_only: "General inquiry only",
  no_project_intent_detected: "No project intent detected",
  explicit_non_lead_outcome: "Explicit non-lead outcome"
};

export function formatLeadDecisionReason(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "No lead decision recorded";
  return LEAD_REASON_LABELS[normalized] || formatLeadOutcomeLabel(normalized);
}

export function getLeadStatusMeta(source = {}) {
  const isValidLead = Boolean(source.isValidLead ?? source.lead_is_valid);
  const isBillableLead = Boolean(source.isBillableLead ?? source.lead_is_billable);
  const outcomeType = source.outcomeType ?? source.lead_outcome_type;
  const decisionReason = source.decisionReason ?? source.lead_decision_reason;

  if (isValidLead && isBillableLead) {
    return {
      label: "Valid Lead",
      tone: "ok",
      detail: formatLeadDecisionReason(decisionReason)
    };
  }
  if (isValidLead) {
    return {
      label: "Valid Lead · Non-billable",
      tone: "warn",
      detail: formatLeadDecisionReason(decisionReason)
    };
  }
  return {
    label: formatLeadOutcomeLabel(outcomeType || "non_lead"),
    tone: "neutral",
    detail: formatLeadDecisionReason(decisionReason)
  };
}

export function getLeadPricingConfig(envLike = process.env) {
  const rateCents = Number(envLike?.LEAD_BILLING_RATE_CENTS || 700);
  const includedCount = Number(envLike?.LEAD_BILLING_INCLUDED_COUNT || 0);
  return {
    rateCents: Number.isFinite(rateCents) && rateCents >= 0 ? Math.round(rateCents) : 700,
    includedCount: Number.isFinite(includedCount) && includedCount >= 0 ? Math.round(includedCount) : 0
  };
}

export function computeLeadInvoiceEstimate({ baseAmountCents, billableLeadCount }, pricing = getLeadPricingConfig()) {
  const normalizedBaseAmount = Number.isFinite(Number(baseAmountCents)) ? Math.max(0, Math.round(Number(baseAmountCents))) : 0;
  const normalizedBillableCount = Number.isFinite(Number(billableLeadCount)) ? Math.max(0, Math.round(Number(billableLeadCount))) : 0;
  const billableOverIncluded = Math.max(0, normalizedBillableCount - Math.max(0, Number(pricing?.includedCount || 0)));
  const leadChargesCents = billableOverIncluded * Math.max(0, Number(pricing?.rateCents || 0));
  return {
    baseAmountCents: normalizedBaseAmount,
    includedCount: Math.max(0, Number(pricing?.includedCount || 0)),
    leadRateCents: Math.max(0, Number(pricing?.rateCents || 0)),
    billableLeadCount: normalizedBillableCount,
    overageLeadCount: billableOverIncluded,
    leadChargesCents,
    totalEstimatedInvoiceCents: normalizedBaseAmount + leadChargesCents
  };
}

export function resolveBillingWindow(billing = {}, now = new Date()) {
  const start = billing?.currentPeriodStart ? new Date(billing.currentPeriodStart) : null;
  const end = billing?.currentPeriodEnd ? new Date(billing.currentPeriodEnd) : null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    return {
      start,
      end,
      label: "Current billing period"
    };
  }

  const current = new Date(now);
  const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
  const nextMonthStart = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  return {
    start: monthStart,
    end: nextMonthStart,
    label: "Current calendar month"
  };
}
