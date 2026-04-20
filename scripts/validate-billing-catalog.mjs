import assert from "node:assert/strict";

import { STANDARD_BILLING_PLANS } from "../lib/standardBillingPlans.js";
import {
  buildPendingPlanFromStripeSchedule,
  buildPendingPlanDisplay,
  DEFAULT_BILLING_PLANS,
  getBillingPlanByStripePriceId,
  getBillingIntervalByStripePriceId,
  normalizeBillingPlanCatalogBindings,
  normalizeBillingPlans,
  resolveBillingPlanFromStripeSubscription
} from "../pages/api/_lib/billing.js";

const EXPECTED_STANDARD_PLANS = [
  {
    code: "starter",
    label: "Starter",
    monthlyAmountCents: 4950,
    annualAmountCents: 50490,
    includedCallCount: 25,
    callOverageRateCents: 300
  },
  {
    code: "growth",
    label: "Growth",
    monthlyAmountCents: 9950,
    annualAmountCents: 101490,
    includedCallCount: 60,
    callOverageRateCents: 200
  },
  {
    code: "pro",
    label: "Pro",
    monthlyAmountCents: 14950,
    annualAmountCents: 152490,
    includedCallCount: 100,
    callOverageRateCents: 175
  }
];

assert.deepEqual(STANDARD_BILLING_PLANS, EXPECTED_STANDARD_PLANS, "standard billing catalog drifted");

assert.deepEqual(
  DEFAULT_BILLING_PLANS.map((plan) => ({
    code: plan.code,
    label: plan.label,
    monthlyAmountCents: plan.monthlyAmountCents,
    annualAmountCents: plan.annualAmountCents,
    includedCallCount: plan.includedCallCount,
    callOverageRateCents: plan.callOverageRateCents
  })),
  EXPECTED_STANDARD_PLANS,
  "API billing defaults drifted from the standard catalog"
);

const normalizedPlans = normalizeBillingPlans([
  {
    code: "starter",
    label: "Incorrect",
    monthlyAmountCents: 999999,
    annualAmountCents: 888888,
    includedCallCount: 999,
    callOverageRateCents: 999,
    stripeProductId: "prod_testStarter",
    stripePriceId: "price_testStarterMonthly",
    stripeAnnualPriceId: "price_testStarterAnnual"
  }
]);

assert.equal(normalizedPlans[0].monthlyAmountCents, 4950, "runtime config should not override starter monthly price");
assert.equal(normalizedPlans[0].annualAmountCents, 50490, "runtime config should not override starter annual price");
assert.equal(normalizedPlans[0].includedCallCount, 25, "runtime config should not override starter included call count");
assert.equal(normalizedPlans[0].callOverageRateCents, 300, "runtime config should not override starter overage rate");
assert.equal(normalizedPlans[0].stripeProductId, "prod_testStarter", "runtime Stripe product binding should be preserved");
assert.equal(normalizedPlans[0].stripePriceId, "price_testStarterMonthly", "runtime Stripe monthly binding should be preserved");
assert.equal(normalizedPlans[0].stripeAnnualPriceId, "price_testStarterAnnual", "runtime Stripe annual binding should be preserved");
assert.equal(
  getBillingPlanByStripePriceId(normalizedPlans, "price_testStarterMonthly")?.code,
  "starter",
  "monthly Stripe price should map back to the starter plan"
);
assert.equal(
  getBillingPlanByStripePriceId(normalizedPlans, "price_testStarterAnnual")?.code,
  "starter",
  "annual Stripe price should map back to the starter plan"
);
assert.equal(
  getBillingPlanByStripePriceId(normalizedPlans, "price_unknown"),
  null,
  "unknown Stripe prices should not guess a plan"
);
assert.equal(
  getBillingIntervalByStripePriceId(normalizedPlans, "price_testStarterMonthly"),
  "month",
  "monthly Stripe price should map back to the monthly interval"
);
assert.equal(
  getBillingIntervalByStripePriceId(normalizedPlans, "price_testStarterAnnual"),
  "year",
  "annual Stripe price should map back to the annual interval"
);
assert.equal(
  resolveBillingPlanFromStripeSubscription(normalizedPlans, {
    items: {
      data: [
        {
          price: {
            id: "price_testStarterMonthly"
          }
        }
      ]
    },
    metadata: {}
  }).plan?.code,
  "starter",
  "subscription price IDs should resolve back to a standard plan"
);
assert.equal(
  resolveBillingPlanFromStripeSubscription(normalizedPlans, {
    items: { data: [{ price: {} }] },
    metadata: { plan_code: "starter" }
  }).source,
  "metadata",
  "subscription metadata should be the fallback plan source"
);
assert.deepEqual(
  buildPendingPlanDisplay({
    pending_plan_code: "starter",
    pending_plan_effective_at: "2026-05-01T00:00:00.000Z",
    pending_billing_interval: "month"
  }, { plans: normalizedPlans }),
  {
    code: "starter",
    label: "Starter",
    effectiveAt: "2026-05-01T00:00:00.000Z",
    billingInterval: "month",
    billingIntervalLabel: "Monthly",
    monthlyAmountCents: 4950,
    annualAmountCents: 50490,
    includedCallCount: 25,
    callOverageRateCents: 300
  },
  "pending plan display should resolve from the standard catalog"
);
assert.deepEqual(
  buildPendingPlanFromStripeSchedule(
    normalizedPlans,
    {
      status: "active",
      current_phase: {
        start_date: 1775000000,
        end_date: 1777592000
      },
      phases: [
        {
          start_date: 1775000000,
          end_date: 1777592000,
          items: [{ price: "price_testStarterMonthly" }]
        },
        {
          start_date: 1777592000,
          end_date: 1780270400,
          items: [{ price: "price_testStarterAnnual" }]
        }
      ]
    },
    {
      currentPlanCode: "starter",
      currentBillingInterval: "month"
    }
  ),
  {
    plan: normalizedPlans[0],
    source: "price",
    billingInterval: "year",
    effectiveAt: "2026-04-30T23:33:20.000Z"
  },
  "scheduled portal changes should resolve even when the plan code stays the same and only the billing interval changes"
);

assert.deepEqual(
  normalizeBillingPlanCatalogBindings([
    {
      code: "growth",
      monthlyAmountCents: 1,
      stripeProductId: "prod_growth",
      stripePriceId: "price_growth_month",
      stripeAnnualPriceId: "price_growth_year"
    }
  ]),
  [
    { code: "starter" },
    {
      code: "growth",
      stripeProductId: "prod_growth",
      stripePriceId: "price_growth_month",
      stripeAnnualPriceId: "price_growth_year"
    },
    { code: "pro" }
  ],
  "catalog binding normalization should persist only plan codes and Stripe IDs"
);

console.log("billing catalog validation passed");
