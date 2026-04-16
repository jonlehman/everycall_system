import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import {
  buildPricingOverride,
  buildPlanDisplay,
  computeTrialDaysRemaining,
  ensureTenantBillingAccount,
  getSystemBillingConfig,
  requireActiveTenantUser,
  requireTenantOwner,
  resolveEffectiveCallPricing,
  syncTenantStripeSubscription
} from "../../_lib/billing.js";
import { activatePendingCouponDiscountWindow, getTenantActiveCouponRedemption } from "../../_lib/billingCoupons.js";
import { listBillingPeriods, syncCurrentBillingPeriod } from "../../_lib/callBilling.js";
import {
  findCurrentSubscriptionForCustomer,
  findCurrentSubscriptionForTenantKey,
  retrieveCustomer,
  retrieveInvoice,
  retrieveSubscription
} from "../../_lib/stripe.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

function normalizeMoneyCents(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function toIsoFromUnix(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000).toISOString();
}

function humanizeLabel(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "";
  return normalized
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildBillingStatusLabel(status, { cancelAtPeriodEnd = false } = {}) {
  const normalized = normalizeText(status).toLowerCase();
  if (cancelAtPeriodEnd && ["active", "trialing"].includes(normalized)) {
    return "Canceled";
  }
  if (normalized === "active") return "Active";
  if (normalized === "trialing") return "Trialing";
  if (normalized === "past_due") return "Past due";
  if (["unpaid", "incomplete"].includes(normalized)) return "Payment failed";
  if (normalized === "trial_expired") return "Billing required";
  if (normalized === "deactivated") return "Service paused";
  if (normalized === "canceled") return "Canceled";
  if (normalized === "incomplete_expired") return "Billing expired";
  return humanizeLabel(normalized) || "Unknown";
}

function isStripeObject(value, objectType = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!objectType) return true;
  return normalizeText(value.object).toLowerCase() === normalizeText(objectType).toLowerCase();
}

function extractCardSummary(source) {
  if (!isStripeObject(source)) return null;
  const objectType = normalizeText(source.object).toLowerCase();
  if (objectType === "payment_method") {
    const card = source.card || null;
    if (!card?.last4) return null;
    return {
      brand: normalizeText(card.brand) || null,
      last4: normalizeText(card.last4) || null,
      expMonth: Number(card.exp_month || 0) || null,
      expYear: Number(card.exp_year || 0) || null
    };
  }
  if (objectType === "card") {
    return {
      brand: normalizeText(source.brand) || null,
      last4: normalizeText(source.last4) || null,
      expMonth: Number(source.exp_month || 0) || null,
      expYear: Number(source.exp_year || 0) || null
    };
  }
  return null;
}

function resolvePaymentMethodSummary({ subscription, customer, latestInvoice }) {
  const card = extractCardSummary(subscription?.default_payment_method)
    || extractCardSummary(customer?.invoice_settings?.default_payment_method)
    || extractCardSummary(customer?.default_source)
    || extractCardSummary(latestInvoice?.default_payment_method)
    || extractCardSummary(latestInvoice?.payment_intent?.payment_method);
  if (!card) return null;
  return {
    type: "card",
    brand: card.brand,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear
  };
}

function buildLatestInvoiceSummary(invoice) {
  if (!isStripeObject(invoice, "invoice")) {
    return {
      hasInvoice: false,
      id: null,
      status: null,
      statusLabel: null,
      createdAt: null,
      paidAt: null,
      totalAmountCents: 0,
      amountPaidCents: 0,
      amountDueCents: 0,
      displayAmountCents: 0
    };
  }

  const normalizedStatus = normalizeText(invoice.status).toLowerCase();
  const statusLabel = invoice.paid
    ? "Paid"
    : normalizedStatus === "open"
      ? "Open"
      : normalizedStatus === "draft"
        ? "Draft"
        : normalizedStatus === "uncollectible"
          ? "Past due"
          : normalizedStatus === "void"
            ? "Void"
            : humanizeLabel(normalizedStatus) || "Unknown";
  const totalAmountCents = normalizeMoneyCents(invoice.total);
  const amountPaidCents = normalizeMoneyCents(invoice.amount_paid);
  const amountDueCents = normalizeMoneyCents(invoice.amount_due);
  const displayAmountCents = invoice.paid
    ? (amountPaidCents || totalAmountCents)
    : (amountDueCents || totalAmountCents);

  return {
    hasInvoice: true,
    id: invoice.id || null,
    status: normalizedStatus || null,
    statusLabel,
    createdAt: toIsoFromUnix(invoice.created),
    paidAt: toIsoFromUnix(invoice?.status_transitions?.paid_at),
    totalAmountCents,
    amountPaidCents,
    amountDueCents,
    displayAmountCents
  };
}

function buildFallbackInvoiceEstimate(plan) {
  const baseAmountCents = normalizeMoneyCents(plan?.baseAmountCents);
  return {
    baseAmountCents,
    discountedBaseAmountCents: baseAmountCents,
    monthlyDiscountPercent: 0,
    includedCallCount: Number(plan?.includedCallCount || 0) || 0,
    callOverageRateCents: Number(plan?.callOverageRateCents || 0) || 0,
    eligibleCallCount: 0,
    overageCallCount: 0,
    rawOverageAmountCents: 0,
    overageDiscountPercent: 0,
    overageAmountCents: 0,
    totalEstimatedInvoiceCents: baseAmountCents
  };
}

function buildUsageAllowanceSummary(plan) {
  const includedCallCount = Number(plan?.includedCallCount ?? plan?.includedCount ?? 0);
  if (!Number.isFinite(includedCallCount) || includedCallCount <= 0) return null;
  const cadence = normalizeText(plan?.billingIntervalLabel).toLowerCase() === "annual" ? "year" : "month";
  return `Includes ${includedCallCount.toLocaleString("en-US")} ${includedCallCount === 1 ? "call" : "calls"} per ${cadence}.`;
}

function buildChargeBreakdown(callInvoiceEstimate, callAdjustments) {
  const estimate = callInvoiceEstimate || {};
  const baseAmountCents = normalizeMoneyCents(estimate.baseAmountCents);
  const discountedBaseAmountCents = normalizeMoneyCents(
    estimate.discountedBaseAmountCents ?? estimate.baseAmountCents
  );
  const rawOverageAmountCents = normalizeMoneyCents(
    estimate.rawOverageAmountCents ?? estimate.overageAmountCents
  );
  const overageAmountCents = normalizeMoneyCents(estimate.overageAmountCents);
  const totalAmountCents = normalizeMoneyCents(estimate.totalEstimatedInvoiceCents);
  const netAdjustmentAmountCents = normalizeMoneyCents(callAdjustments?.netAdjustmentAmountCents);
  const discountAmountCents = Math.max(0, baseAmountCents - discountedBaseAmountCents)
    + Math.max(0, rawOverageAmountCents - overageAmountCents);
  const rows = [];

  if (discountedBaseAmountCents > 0 || baseAmountCents > 0) {
    rows.push({
      label: "Base plan",
      amountCents: discountedBaseAmountCents || baseAmountCents,
      tone: "default"
    });
  }
  if (overageAmountCents > 0) {
    rows.push({
      label: "Additional usage",
      amountCents: overageAmountCents,
      tone: "default"
    });
  }
  if (netAdjustmentAmountCents > 0) {
    rows.push({
      label: "Additional charges",
      amountCents: netAdjustmentAmountCents,
      tone: "default"
    });
  }
  if (netAdjustmentAmountCents < 0) {
    rows.push({
      label: "Account credit",
      amountCents: netAdjustmentAmountCents,
      tone: "credit"
    });
  }
  if (discountAmountCents > 0) {
    rows.push({
      label: "Discount",
      amountCents: -discountAmountCents,
      tone: "credit"
    });
  }
  rows.push({
    label: "Total",
    amountCents: totalAmountCents,
    tone: "total"
  });

  return rows;
}

function buildPlanSummary(row, planDisplay) {
  return {
    name: planDisplay?.label || "Plan",
    allowanceSummary: buildUsageAllowanceSummary(planDisplay),
    billingIntervalLabel: planDisplay?.billingIntervalLabel || null,
    endsAt: row?.cancel_at_period_end ? (row?.current_period_end || null) : null
  };
}

function buildBillingAlert({ row, paymentMethodSummary }) {
  const normalizedStatus = normalizeText(row?.billing_status).toLowerCase();
  if (normalizedStatus === "past_due") {
    return {
      tone: "bad",
      message: "Your account has a past-due balance. Manage billing in Stripe to complete payment."
    };
  }
  if (["unpaid", "incomplete"].includes(normalizedStatus)) {
    return {
      tone: "bad",
      message: "Your last payment failed. Manage billing in Stripe to update payment details and complete payment."
    };
  }
  if (normalizedStatus === "deactivated") {
    return {
      tone: "bad",
      message: "This account is deactivated. Restart service from EveryCall to provision a new Sales Receptionist Number and reopen the account."
    };
  }
  if (normalizedStatus === "trial_expired" || normalizeText(row?.app_access_status).toLowerCase() === "billing_locked") {
    return {
      tone: "warn",
      message: "Billing is required to keep this account active. Manage billing in Stripe to continue."
    };
  }
  if (!paymentMethodSummary && Boolean(row?.stripe_customer_id) && normalizeText(row?.billing_status).toLowerCase() === "active") {
    return {
      tone: "warn",
      message: "No payment method is on file. Manage billing in Stripe to add one."
    };
  }
  return null;
}

function buildManagementAction(row) {
  const normalizedStatus = normalizeText(row?.billing_status).toLowerCase();
  if (normalizedStatus === "deactivated") {
    return {
      type: "reactivate",
      endpoint: "/api/v1/billing/reactivate"
    };
  }
  if (row?.stripe_subscription_id) {
    return {
      type: "portal",
      endpoint: "/api/v1/billing/portal"
    };
  }
  return {
    type: "checkout",
    endpoint: "/api/v1/billing/checkout"
  };
}

function buildNextChargeSummary({
  row,
  planDisplay,
  callInvoiceEstimate,
  callAdjustments,
  latestInvoiceSummary
}) {
  const normalizedStatus = normalizeText(row?.billing_status).toLowerCase();
  const effectiveInvoiceEstimate = callInvoiceEstimate || buildFallbackInvoiceEstimate(planDisplay);
  const breakdown = buildChargeBreakdown(effectiveInvoiceEstimate, callAdjustments);
  const statusLabel = buildBillingStatusLabel(normalizedStatus, {
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end)
  });

  if (normalizedStatus === "trialing") {
    return {
      mode: "trial_end",
      amountCents: normalizeMoneyCents(effectiveInvoiceEstimate.totalEstimatedInvoiceCents),
      date: row?.trial_end || row?.current_period_end || null,
      status: normalizedStatus,
      statusLabel,
      breakdown
    };
  }

  if (["past_due", "unpaid", "incomplete"].includes(normalizedStatus)) {
    return {
      mode: "amount_due",
      amountCents: latestInvoiceSummary?.amountDueCents > 0
        ? latestInvoiceSummary.amountDueCents
        : normalizeMoneyCents(effectiveInvoiceEstimate.totalEstimatedInvoiceCents),
      date: latestInvoiceSummary?.createdAt || row?.current_period_end || null,
      status: normalizedStatus,
      statusLabel,
      breakdown
    };
  }

  return {
    mode: "charge",
    amountCents: normalizeMoneyCents(effectiveInvoiceEstimate.totalEstimatedInvoiceCents),
    date: row?.current_period_end || null,
    status: normalizedStatus,
    statusLabel,
    breakdown
  };
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

    const session = await requireSession(req, res);
    if (!session) return;
    const activeUser = session.role === "tenant" ? await requireActiveTenantUser(session) : null;
    if (session.role === "tenant" && !activeUser) {
      return res.status(403).json({ error: "forbidden" });
    }
    const owner = session.role === "tenant" ? await requireTenantOwner(session) : null;
    const canViewStripeDetails = session.role === "admin" || Boolean(owner);

    const tenantKey = resolveTenantKey(session, getTenantKey(req));
    let row = await ensureTenantBillingAccount(pool, tenantKey);
    if (!row) {
      return res.status(404).json({ error: "tenant_not_found" });
    }
    const billingConfig = await getSystemBillingConfig(pool);
    const priorCurrentPeriodStart = row.current_period_start || null;
    const priorStripeSubscriptionId = row.stripe_subscription_id || null;

    let stripeSubscription = null;
    let stripeSubscriptionSource = "none";
    let stripeLookupError = null;

    try {
      if (row.stripe_subscription_id) {
        stripeSubscription = await retrieveSubscription(row.stripe_subscription_id);
        stripeSubscriptionSource = "stored_subscription_id";
      } else if (row.stripe_customer_id) {
        stripeSubscription = await findCurrentSubscriptionForCustomer(row.stripe_customer_id);
        stripeSubscriptionSource = stripeSubscription ? "customer_lookup" : "customer_lookup_empty";
      }
    } catch (error) {
      stripeLookupError = error?.message || "unknown";
    }

    let tenantSubscription = stripeSubscription;
    if (!tenantSubscription) {
      try {
        tenantSubscription = await findCurrentSubscriptionForTenantKey(tenantKey);
        if (tenantSubscription) {
          stripeSubscriptionSource = "tenant_key_lookup";
        } else if (stripeSubscriptionSource === "none") {
          stripeSubscriptionSource = "tenant_key_lookup_empty";
        }
      } catch (error) {
        stripeLookupError = `${stripeLookupError ? `${stripeLookupError};` : ""}${error?.message || "unknown"}`;
      }
    }

    console.info("billing_summary_stripe_lookup", {
      tenantKey,
      hasStoredStripeCustomerId: Boolean(row.stripe_customer_id),
      hasStoredStripeSubscriptionId: Boolean(row.stripe_subscription_id),
      source: stripeSubscriptionSource,
      foundSubscription: Boolean(tenantSubscription?.id),
      foundSubscriptionStatus: tenantSubscription?.status || null,
      stripeLookupError
    });
    if (tenantSubscription) {
      row = await syncTenantStripeSubscription(pool, tenantKey, row, tenantSubscription, "billing.summary.sync");
      const nextCurrentPeriodStart = row.current_period_start || null;
      const shouldActivatePendingDiscount = String(tenantSubscription?.status || "").trim().toLowerCase() !== "trialing"
        && (
          !priorStripeSubscriptionId
          || String(priorStripeSubscriptionId) !== String(row.stripe_subscription_id || "")
          || String(priorCurrentPeriodStart || "") !== String(nextCurrentPeriodStart || "")
        );
      if (shouldActivatePendingDiscount) {
        await activatePendingCouponDiscountWindow(pool, tenantKey, { subscription: tenantSubscription }).catch(() => null);
      }
    }

    const planDisplay = buildPlanDisplay(row, billingConfig);
    let detailedSubscription = null;
    let stripeCustomer = null;
    let latestInvoice = null;

    try {
      const [subscriptionResult, customerResult] = await Promise.all([
        row.stripe_subscription_id
          ? retrieveSubscription(row.stripe_subscription_id, {
              expand: [
                "default_payment_method",
                "latest_invoice.default_payment_method",
                "latest_invoice.payment_intent.payment_method"
              ]
            }).catch(() => null)
          : Promise.resolve(null),
        row.stripe_customer_id
          ? retrieveCustomer(row.stripe_customer_id, {
              expand: [
                "invoice_settings.default_payment_method",
                "default_source"
              ]
            }).catch(() => null)
          : Promise.resolve(null)
      ]);

      detailedSubscription = isStripeObject(subscriptionResult) && !subscriptionResult.deleted
        ? subscriptionResult
        : null;
      stripeCustomer = isStripeObject(customerResult) && !customerResult.deleted
        ? customerResult
        : null;

      const expandedLatestInvoice = isStripeObject(detailedSubscription?.latest_invoice, "invoice")
        ? detailedSubscription.latest_invoice
        : null;
      const latestInvoiceId = row.last_invoice_id || expandedLatestInvoice?.id || null;

      if (expandedLatestInvoice && (!latestInvoiceId || expandedLatestInvoice.id === latestInvoiceId)) {
        latestInvoice = expandedLatestInvoice;
      } else if (latestInvoiceId) {
        latestInvoice = await retrieveInvoice(latestInvoiceId, {
          expand: [
            "default_payment_method",
            "payment_intent.payment_method"
          ]
        }).catch(() => null);
      }
    } catch (stripeDetailError) {
      console.error("billing_summary_stripe_detail_failed", {
        tenantKey,
        message: stripeDetailError?.message || "unknown"
      });
      detailedSubscription = null;
      stripeCustomer = null;
      latestInvoice = null;
    }

    const invoices = row.last_invoice_id ? [{ id: row.last_invoice_id }] : [];
    let callBilling = null;
    try {
      callBilling = await syncCurrentBillingPeriod(pool, tenantKey);
    } catch (callBillingError) {
      console.error("call_billing_summary_failed", {
        tenantKey,
        message: callBillingError?.message || "unknown"
      });
      callBilling = null;
    }
    const callPricing = callBilling?.callPricing || resolveEffectiveCallPricing(row, billingConfig);
    let billingPeriodHistory = [];
    let activeCoupon = null;
    try {
      billingPeriodHistory = await listBillingPeriods(pool, tenantKey, { limit: 12 });
    } catch (historyError) {
      console.error("billing_period_history_failed", {
        tenantKey,
        message: historyError?.message || "unknown"
      });
      billingPeriodHistory = [];
    }
    try {
      activeCoupon = await getTenantActiveCouponRedemption(pool, tenantKey);
    } catch (couponError) {
      console.error("billing_coupon_summary_failed", {
        tenantKey,
        message: couponError?.message || "unknown"
      });
      activeCoupon = null;
    }

    const latestInvoiceSummary = buildLatestInvoiceSummary(latestInvoice);
    const paymentMethodSummary = resolvePaymentMethodSummary({
      subscription: detailedSubscription,
      customer: stripeCustomer,
      latestInvoice
    });
    const callInvoiceEstimate = callBilling?.invoiceEstimate || buildFallbackInvoiceEstimate(planDisplay);
    const callAdjustments = callBilling?.adjustments || {
      creditAmountCents: 0,
      debitAmountCents: 0,
      netAdjustmentAmountCents: 0,
      items: []
    };
    const billingSummary = {
      statusLabel: buildBillingStatusLabel(row.billing_status, {
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end)
      }),
      manageAction: buildManagementAction(row),
      alert: buildBillingAlert({ row, paymentMethodSummary }),
      nextCharge: buildNextChargeSummary({
        row,
        planDisplay,
        callInvoiceEstimate,
        callAdjustments,
        latestInvoiceSummary
      }),
      plan: buildPlanSummary(row, planDisplay),
      paymentMethod: paymentMethodSummary
        ? {
            hasPaymentMethod: true,
            brand: paymentMethodSummary.brand,
            last4: paymentMethodSummary.last4,
            expMonth: paymentMethodSummary.expMonth,
            expYear: paymentMethodSummary.expYear
          }
        : {
            hasPaymentMethod: false,
            brand: null,
            last4: null,
            expMonth: null,
            expYear: null
          },
      latestInvoice: latestInvoiceSummary
    };

    return res.status(200).json({
      ok: true,
      tenantKey,
      billing: {
        status: row.billing_status,
        serviceAccessStatus: row.service_access_status,
        appAccessStatus: row.app_access_status,
        lockReason: row.billing_lock_reason || null,
        stripeCustomerId: canViewStripeDetails ? (row.stripe_customer_id || null) : null,
        stripeSubscriptionId: canViewStripeDetails ? (row.stripe_subscription_id || null) : null,
        hasStripeCustomer: Boolean(row.stripe_customer_id),
        hasStripeSubscription: Boolean(row.stripe_subscription_id),
        trialStartedAt: row.trial_started_at,
        trialEnd: row.trial_end,
        trialDaysRemaining: computeTrialDaysRemaining(row.trial_end),
        postTrialAccessEndsAt: row.post_trial_access_ends_at,
        billingGraceEndsAt: row.billing_grace_ends_at,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        canceledAt: row.canceled_at,
        plan: planDisplay,
        currentPeriod: {
          label: callBilling?.currentPeriod?.label || null,
          start: callBilling?.currentPeriod?.start || row.current_period_start || null,
          end: callBilling?.currentPeriod?.end || row.current_period_end || null
        },
        callPricing,
        callUsage: callBilling?.callUsage || {
          eligibleCallCount: 0,
          includedCallCountUsed: 0,
          overageCallCount: 0,
          excludedCallCount: 0,
          recentCalls: []
        },
        callAdjustments,
        callInvoiceEstimate,
        callBillingPeriod: callBilling?.currentPeriod || null,
        currentBillingPeriodId: Number(callBilling?.billingPeriodId || 0) || null,
        billingPeriodHistory: billingPeriodHistory.map((period) => ({
          ...period,
          stripeInvoiceId: canViewStripeDetails ? period.stripeInvoiceId : null,
          stripeInvoiceItemId: canViewStripeDetails ? period.stripeInvoiceItemId : null
        })),
        activeCoupon,
        override: buildPricingOverride(row),
        invoices,
        summary: billingSummary
      },
      viewer: {
        role: session.role,
        canManage: Boolean(owner),
        userRole: activeUser?.role || null
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "billing_summary_error", message: err?.message || "unknown" });
  }
}
