const PUBLIC_ANNUAL_DISCOUNT_MULTIPLIER = 0.85;

export function deriveAnnualAmountCents(monthlyAmountCents) {
  const normalizedMonthlyAmount = Number(monthlyAmountCents || 0);
  if (!Number.isFinite(normalizedMonthlyAmount) || normalizedMonthlyAmount <= 0) {
    return 0;
  }
  return Math.round(normalizedMonthlyAmount * 12 * PUBLIC_ANNUAL_DISCOUNT_MULTIPLIER);
}

export const STANDARD_BILLING_PLANS = [
  {
    code: "starter",
    label: "Starter",
    monthlyAmountCents: 7450,
    annualAmountCents: deriveAnnualAmountCents(7450),
    includedCallCount: 25,
    callOverageRateCents: 300
  },
  {
    code: "growth",
    label: "Growth",
    monthlyAmountCents: 12450,
    annualAmountCents: deriveAnnualAmountCents(12450),
    includedCallCount: 60,
    callOverageRateCents: 200
  },
  {
    code: "pro",
    label: "Pro",
    monthlyAmountCents: 17450,
    annualAmountCents: deriveAnnualAmountCents(17450),
    includedCallCount: 100,
    callOverageRateCents: 175
  }
];

export function getStandardBillingPlan(planCode, fallbackCode = "growth") {
  const normalizedCode = String(planCode || "").trim().toLowerCase();
  const normalizedFallbackCode = String(fallbackCode || "").trim().toLowerCase();
  return STANDARD_BILLING_PLANS.find((plan) => plan.code === normalizedCode)
    || STANDARD_BILLING_PLANS.find((plan) => plan.code === normalizedFallbackCode)
    || STANDARD_BILLING_PLANS[0];
}
