import { deriveAnnualAmountCents, getStandardBillingPlan, STANDARD_BILLING_PLANS } from "../../../lib/standardBillingPlans.js";
import { getPool } from "./db.js";
import { retrieveSubscriptionSchedule } from "./stripe.js";

export const DEFAULT_PLAN_CODE = "growth";
export const DEFAULT_MONTHLY_AMOUNT_CENTS = getStandardBillingPlan(DEFAULT_PLAN_CODE).monthlyAmountCents;
export const DEFAULT_STRIPE_PRODUCT_ID = String(process.env.STRIPE_DEFAULT_PRODUCT_ID || "").trim() || null;
export const DEFAULT_TRIAL_DAYS = Number(process.env.DEFAULT_TRIAL_DAYS || "30");
export const DEFAULT_BILLING_INTERVAL = "month";

function normalizeOptionalId(value) {
  const text = String(value || "").trim();
  return text || null;
}

function getDefaultPlanStripeCatalog(planCode) {
  const normalizedCode = String(planCode || "").trim().toUpperCase();
  return {
    stripeProductId: normalizeOptionalId(process.env[`STRIPE_${normalizedCode}_PRODUCT_ID`])
      || (normalizedCode === String(DEFAULT_PLAN_CODE).trim().toUpperCase() ? DEFAULT_STRIPE_PRODUCT_ID : null),
    stripePriceId: normalizeOptionalId(process.env[`STRIPE_${normalizedCode}_PRICE_ID`]),
    stripeAnnualPriceId: normalizeOptionalId(process.env[`STRIPE_${normalizedCode}_ANNUAL_PRICE_ID`])
  };
}

export function normalizeBillingInterval(value, fallback = DEFAULT_BILLING_INTERVAL) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["month", "monthly"].includes(normalized)) return "month";
  if (["year", "annual", "annually", "yearly"].includes(normalized)) return "year";
  return fallback;
}

export function formatBillingIntervalLabel(value) {
  return normalizeBillingInterval(value) === "year" ? "Annual" : "Monthly";
}

export function getPlanStripePriceIdForInterval(plan, interval = DEFAULT_BILLING_INTERVAL) {
  const normalizedInterval = normalizeBillingInterval(interval);
  if (normalizedInterval === "year") {
    return normalizeOptionalId(plan?.stripeAnnualPriceId ?? plan?.stripe_annual_price_id);
  }
  return normalizeOptionalId(plan?.stripePriceId ?? plan?.stripe_price_id);
}

export const DEFAULT_BILLING_PLANS = [
  ...STANDARD_BILLING_PLANS.map((plan) => ({
    ...plan,
    leadRateCents: plan.callOverageRateCents,
    includedCount: plan.includedCallCount,
    ...getDefaultPlanStripeCatalog(plan.code)
  }))
];

function normalizePlanCode(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMoneyCents(value, fallback) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return fallback;
  }
  return Math.round(amount);
}

function normalizeCount(value, fallback = 0) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) {
    return fallback;
  }
  return Math.round(count);
}

export function normalizeBillingPlans(value) {
  const source = Array.isArray(value) ? value : [];
  return DEFAULT_BILLING_PLANS.map((fallbackPlan) => {
    const configured = source.find((item) => normalizePlanCode(item?.code) === fallbackPlan.code) || {};
    const stripeProductId = normalizeOptionalId(
      configured.stripeProductId ?? configured.stripe_product_id ?? fallbackPlan.stripeProductId
    );
    const stripePriceId = normalizeOptionalId(
      configured.stripePriceId ?? configured.stripe_price_id ?? fallbackPlan.stripePriceId
    );
    const stripeAnnualPriceId = normalizeOptionalId(
      configured.stripeAnnualPriceId ?? configured.stripe_annual_price_id ?? fallbackPlan.stripeAnnualPriceId
    );
    return {
      code: fallbackPlan.code,
      label: fallbackPlan.label,
      monthlyAmountCents: fallbackPlan.monthlyAmountCents,
      annualAmountCents: fallbackPlan.annualAmountCents,
      leadRateCents: fallbackPlan.leadRateCents,
      includedCount: fallbackPlan.includedCount,
      callOverageRateCents: fallbackPlan.callOverageRateCents,
      includedCallCount: fallbackPlan.includedCallCount,
      stripeProductId,
      stripePriceId,
      stripeAnnualPriceId
    };
  });
}

export function normalizeBillingPlanCatalogBindings(value) {
  return normalizeBillingPlans(value).map((plan) => ({
    code: plan.code,
    ...(plan.stripeProductId ? { stripeProductId: plan.stripeProductId } : {}),
    ...(plan.stripePriceId ? { stripePriceId: plan.stripePriceId } : {}),
    ...(plan.stripeAnnualPriceId ? { stripeAnnualPriceId: plan.stripeAnnualPriceId } : {})
  }));
}

export async function getSystemBillingConfig(pool) {
  if (!pool) {
    return {
      defaultTrialDays: DEFAULT_TRIAL_DAYS,
      plans: normalizeBillingPlans(DEFAULT_BILLING_PLANS)
    };
  }
  const result = await pool.query(
    `SELECT default_trial_days, billing_plans_json
     FROM system_config
     WHERE id = 1
     LIMIT 1`
  );
  const row = result.rows[0] || {};
  const configuredTrialDays = normalizeCount(row.default_trial_days, DEFAULT_TRIAL_DAYS);
  return {
    defaultTrialDays: configuredTrialDays || DEFAULT_TRIAL_DAYS,
    plans: normalizeBillingPlans(row.billing_plans_json)
  };
}

export function getBillingPlanByCode(plans, code) {
  const normalizedCode = normalizePlanCode(code) || DEFAULT_PLAN_CODE;
  const planList = normalizeBillingPlans(plans);
  return planList.find((plan) => plan.code === normalizedCode)
    || planList.find((plan) => plan.code === DEFAULT_PLAN_CODE)
    || planList[0];
}

export function getBillingPlanByStripePriceId(plans, stripePriceId) {
  const normalizedPriceId = normalizeOptionalId(stripePriceId);
  if (!normalizedPriceId) return null;
  const planList = normalizeBillingPlans(plans);
  return planList.find((plan) => (
    normalizedPriceId === normalizeOptionalId(plan?.stripePriceId ?? plan?.stripe_price_id)
      || normalizedPriceId === normalizeOptionalId(plan?.stripeAnnualPriceId ?? plan?.stripe_annual_price_id)
  )) || null;
}

export function getBillingIntervalByStripePriceId(plans, stripePriceId, fallback = DEFAULT_BILLING_INTERVAL) {
  const normalizedPriceId = normalizeOptionalId(stripePriceId);
  if (!normalizedPriceId) return normalizeBillingInterval(fallback);
  const planList = normalizeBillingPlans(plans);
  const matchingPlan = planList.find((plan) => (
    normalizedPriceId === normalizeOptionalId(plan?.stripePriceId ?? plan?.stripe_price_id)
      || normalizedPriceId === normalizeOptionalId(plan?.stripeAnnualPriceId ?? plan?.stripe_annual_price_id)
  ));
  if (!matchingPlan) {
    return normalizeBillingInterval(fallback);
  }
  return normalizedPriceId === normalizeOptionalId(matchingPlan?.stripeAnnualPriceId ?? matchingPlan?.stripe_annual_price_id)
    ? "year"
    : "month";
}

function getStripePriceReference(price) {
  if (!price) {
    return {
      id: null,
      interval: null
    };
  }
  if (typeof price === "string") {
    return {
      id: normalizeOptionalId(price),
      interval: null
    };
  }
  return {
    id: normalizeOptionalId(price.id),
    interval: normalizeBillingInterval(price?.recurring?.interval, null)
  };
}

function toTimestampMillis(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function unixSecondsToMillis(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 1000);
}

function millisToIso(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric).toISOString();
}

export function resolveBillingPlanFromStripeSubscription(plans, subscription) {
  const item = subscription?.items?.data?.[0] || {};
  const byPrice = getBillingPlanByStripePriceId(plans, item?.price?.id);
  if (byPrice) {
    return {
      plan: byPrice,
      source: "price"
    };
  }
  const metadataPlanCode = normalizePlanCode(subscription?.metadata?.plan_code);
  if (metadataPlanCode) {
    return {
      plan: getBillingPlanByCode(plans, metadataPlanCode),
      source: "metadata"
    };
  }
  return {
    plan: null,
    source: null
  };
}

function getFutureStripeSchedulePhase(schedule) {
  const phases = Array.isArray(schedule?.phases)
    ? [...schedule.phases].sort((a, b) => Number(a?.start_date || 0) - Number(b?.start_date || 0))
    : [];
  if (!phases.length) return null;
  const currentPhaseEnd = Number(schedule?.current_phase?.end_date || 0);
  if (currentPhaseEnd > 0) {
    return phases.find((phase) => Number(phase?.start_date || 0) >= currentPhaseEnd) || null;
  }
  const now = Math.floor(Date.now() / 1000);
  return phases.find((phase) => Number(phase?.start_date || 0) > now) || null;
}

function resolveBillingPlanFromStripeSchedulePhase(plans, phase) {
  const item = Array.isArray(phase?.items) ? (phase.items[0] || null) : null;
  const priceRef = getStripePriceReference(item?.price);
  const byPrice = getBillingPlanByStripePriceId(plans, priceRef.id);
  if (byPrice) {
    return {
      plan: byPrice,
      source: "price",
      priceId: priceRef.id,
      billingInterval: priceRef.interval || getBillingIntervalByStripePriceId(plans, priceRef.id, null)
    };
  }
  const metadataPlanCode = normalizePlanCode(phase?.metadata?.plan_code);
  if (metadataPlanCode) {
    return {
      plan: getBillingPlanByCode(plans, metadataPlanCode),
      source: "metadata",
      priceId: priceRef.id,
      billingInterval: priceRef.interval || getBillingIntervalByStripePriceId(plans, priceRef.id, null)
    };
  }
  return {
    plan: null,
    source: null,
    priceId: priceRef.id,
    billingInterval: priceRef.interval || getBillingIntervalByStripePriceId(plans, priceRef.id, null)
  };
}

export function buildPendingPlanFromStripeSchedule(
  plans,
  schedule,
  {
    currentPlanCode = DEFAULT_PLAN_CODE,
    currentBillingInterval = DEFAULT_BILLING_INTERVAL
  } = {}
) {
  const status = String(schedule?.status || "").trim().toLowerCase();
  if (!["active", "not_started"].includes(status)) {
    return null;
  }
  const futurePhase = getFutureStripeSchedulePhase(schedule);
  if (!futurePhase) return null;
  const resolvedPlan = resolveBillingPlanFromStripeSchedulePhase(plans, futurePhase);
  if (!resolvedPlan.plan) return null;
  const currentPlan = getBillingPlanByCode(plans, currentPlanCode);
  const futureInterval = normalizeBillingInterval(resolvedPlan.billingInterval, currentBillingInterval);
  const normalizedCurrentInterval = normalizeBillingInterval(currentBillingInterval);
  if (resolvedPlan.plan.code === currentPlan.code && futureInterval === normalizedCurrentInterval) {
    return null;
  }
  return {
    plan: resolvedPlan.plan,
    source: resolvedPlan.source,
    billingInterval: futureInterval,
    effectiveAt: millisToIso(unixSecondsToMillis(futurePhase.start_date))
  };
}

export function buildPendingPlanDisplay(row, billingConfig = null) {
  const pendingPlanCode = normalizePlanCode(row?.pending_plan_code);
  if (!pendingPlanCode) return null;
  const plan = getBillingPlanByCode(
    billingConfig?.plans || DEFAULT_BILLING_PLANS,
    pendingPlanCode
  );
  const effectiveAt = row?.pending_plan_effective_at || row?.current_period_end || null;
  return {
    code: plan.code,
    label: plan.label,
    effectiveAt,
    billingInterval: normalizeBillingInterval(row?.pending_billing_interval ?? row?.billing_interval),
    billingIntervalLabel: formatBillingIntervalLabel(row?.pending_billing_interval ?? row?.billing_interval),
    monthlyAmountCents: Number(plan.monthlyAmountCents || 0),
    annualAmountCents: Number(plan.annualAmountCents || 0),
    includedCallCount: Number(plan.includedCallCount ?? plan.includedCount ?? 0),
    callOverageRateCents: Number(plan.callOverageRateCents ?? plan.leadRateCents ?? 0)
  };
}

export async function requireActiveTenantUser(session) {
  const pool = getPool();
  if (!pool || !session?.user_id || session.role !== "tenant") {
    return null;
  }
  const result = await pool.query(
    `SELECT id, tenant_key, role, email, name, phone_number, status
     FROM tenant_users
     WHERE id = $1
     LIMIT 1`,
    [session.user_id]
  );
  const user = result.rows[0] || null;
  if (!user || user.status !== "active") {
    return null;
  }
  return user;
}

export async function requireTenantOwner(session) {
  const user = await requireActiveTenantUser(session);
  if (!user || user.role !== "owner") {
    return null;
  }
  return user;
}

export function tenantUserHasAnyRole(user, roles = []) {
  const allowed = new Set(
    (Array.isArray(roles) ? roles : [])
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowed.size) return false;
  const userRole = String(user?.role || "").trim().toLowerCase();
  return allowed.has(userRole);
}

export async function requireTenantRoles(res, session, roles = [], options = {}) {
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  if (session.role === "admin") {
    return {
      id: session.user_id,
      role: "admin",
      tenant_key: session.tenant_key || null,
      isPlatformAdmin: true
    };
  }
  const user = await requireActiveTenantUser(session);
  if (!user) {
    res.status(403).json({
      error: "forbidden",
      message: options.inactiveMessage || "An active tenant user session is required."
    });
    return null;
  }
  if (!tenantUserHasAnyRole(user, roles)) {
    res.status(403).json({
      error: "forbidden",
      message: options.message || "You do not have permission to perform this action."
    });
    return null;
  }
  return user;
}

export function resolveEffectiveMonthlyAmount(row) {
  const overrideAmount = Number(row?.monthly_amount_override_cents || 0);
  if (overrideAmount > 0) return overrideAmount;
  const baseAmount = Number(row?.monthly_amount_cents || 0);
  if (baseAmount > 0) return baseAmount;
  return DEFAULT_MONTHLY_AMOUNT_CENTS;
}

export function resolveEffectiveBillingInterval(row) {
  return normalizeBillingInterval(row?.billing_interval);
}

export function resolveEffectiveAnnualAmount(row, billingConfig = null) {
  const plan = getBillingPlanByCode(
    billingConfig?.plans || DEFAULT_BILLING_PLANS,
    row?.plan_code || DEFAULT_PLAN_CODE
  );
  if (hasCustomPricing(row)) {
    return deriveAnnualAmountCents(resolveEffectiveMonthlyAmount(row));
  }
  const annualAmount = Number(plan?.annualAmountCents || 0);
  if (annualAmount > 0) return Math.round(annualAmount);
  return deriveAnnualAmountCents(resolveEffectiveMonthlyAmount(row));
}

export function resolveEffectiveBaseAmount(row, billingConfig = null) {
  return resolveEffectiveBillingInterval(row) === "year"
    ? resolveEffectiveAnnualAmount(row, billingConfig)
    : resolveEffectiveMonthlyAmount(row);
}

export function hasCustomPricing(row) {
  const monthlyOverrideSet = row?.monthly_amount_override_cents !== null
    && row?.monthly_amount_override_cents !== undefined;
  const usageOverrideSet = (row?.lead_rate_override_cents !== null
    && row?.lead_rate_override_cents !== undefined)
    || (row?.call_overage_rate_override_cents !== null
      && row?.call_overage_rate_override_cents !== undefined);
  return monthlyOverrideSet || usageOverrideSet;
}

export function resolveEffectiveLeadPricing(row, billingConfig = null) {
  const plan = getBillingPlanByCode(
    billingConfig?.plans || DEFAULT_BILLING_PLANS,
    row?.plan_code || DEFAULT_PLAN_CODE
  );
  const overrideRate = Number(row?.lead_rate_override_cents);
  const baseRate = Number(row?.lead_rate_cents || 0);
  const includedCount = Number(row?.included_lead_count);
  const hasLeadRateOverride = row?.lead_rate_override_cents !== null
    && row?.lead_rate_override_cents !== undefined
    && Number.isFinite(overrideRate)
    && overrideRate >= 0;
  return {
    rateCents: hasLeadRateOverride ? Math.round(overrideRate) : (baseRate > 0 ? Math.round(baseRate) : plan.leadRateCents),
    includedCount: Number.isFinite(includedCount) && includedCount >= 0 ? Math.round(includedCount) : plan.includedCount
  };
}

export function resolveEffectiveCallPricing(row, billingConfig = null) {
  const plan = getBillingPlanByCode(
    billingConfig?.plans || DEFAULT_BILLING_PLANS,
    row?.plan_code || DEFAULT_PLAN_CODE
  );
  const overrideRate = Number(
    row?.call_overage_rate_override_cents ?? row?.lead_rate_override_cents
  );
  const baseRate = Number(
    row?.call_overage_rate_cents ?? row?.lead_rate_cents ?? 0
  );
  const includedCount = Number(
    row?.included_call_count ?? row?.included_lead_count
  );
  const hasRateOverride = (row?.call_overage_rate_override_cents !== null
    && row?.call_overage_rate_override_cents !== undefined
    && Number.isFinite(Number(row?.call_overage_rate_override_cents))
    && Number(row.call_overage_rate_override_cents) >= 0)
    || (row?.lead_rate_override_cents !== null
      && row?.lead_rate_override_cents !== undefined
      && Number.isFinite(Number(row?.lead_rate_override_cents))
      && Number(row.lead_rate_override_cents) >= 0);
  const defaultRate = Number(plan.callOverageRateCents ?? plan.leadRateCents ?? 0);
  const defaultIncludedCount = Number(plan.includedCallCount ?? plan.includedCount ?? 0);
  return {
    callOverageRateCents: hasRateOverride
      ? Math.round(overrideRate)
      : (baseRate > 0 ? Math.round(baseRate) : defaultRate),
    includedCallCount: Number.isFinite(includedCount) && includedCount >= 0
      ? Math.round(includedCount)
      : defaultIncludedCount
  };
}

export async function getTenantBillingState(pool, tenantKey) {
  const result = await pool.query(
    `SELECT
       t.tenant_key,
       t.name,
       t.plan,
       t.plan_code,
       t.status,
       t.created_at,
       tu.name AS owner_name,
       tu.email AS owner_email,
       t.telnyx_voice_number,
       t.billing_status,
       t.trial_started_at,
       t.trial_end,
       t.post_trial_access_ends_at,
       t.billing_grace_ends_at,
       t.service_access_status,
       t.app_access_status,
       t.deactivated_at,
       t.billing_status_updated_at,
       t.billing_lock_reason,
       b.stripe_customer_id,
       b.stripe_subscription_id,
       b.stripe_product_id,
       b.stripe_price_id,
       b.billing_interval,
       b.monthly_amount_cents,
       b.lead_rate_cents,
       b.included_lead_count,
       b.call_overage_rate_cents,
       b.included_call_count,
       b.monthly_amount_override_cents,
       b.lead_rate_override_cents,
       b.call_overage_rate_override_cents,
       b.price_override_reason,
       b.price_override_cycles_remaining,
       b.pending_plan_code,
       b.pending_billing_interval,
       b.pending_plan_effective_at,
       b.current_period_start,
       b.current_period_end,
       b.cancel_at_period_end,
       b.canceled_at,
       b.trial_end AS stripe_trial_end,
       b.active_coupon_redemption_id,
       b.coupon_trial_ends_at,
       b.coupon_discount_starts_at,
       b.coupon_discount_ends_at,
       b.last_invoice_id,
       b.updated_at AS billing_account_updated_at
     FROM tenants t
     LEFT JOIN tenant_billing_accounts b
       ON b.tenant_key = t.tenant_key
     LEFT JOIN LATERAL (
       SELECT name, email
       FROM tenant_users
       WHERE tenant_key = t.tenant_key
         AND role = 'owner'
       ORDER BY id ASC
       LIMIT 1
     ) tu ON TRUE
     WHERE t.tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return result.rows[0] || null;
}

export async function ensureTenantBillingAccount(pool, tenantKey, values = {}) {
  const current = await getTenantBillingState(pool, tenantKey);
  const billingConfig = await getSystemBillingConfig(pool);
  const plan = getBillingPlanByCode(
    billingConfig.plans,
    values.plan_code || current?.plan_code || DEFAULT_PLAN_CODE
  );
  const billingInterval = normalizeBillingInterval(values.billing_interval ?? current?.billing_interval);
  await pool.query(
    `UPDATE tenants
     SET trial_started_at = COALESCE(trial_started_at, created_at),
         trial_end = COALESCE(trial_end, created_at + ($2::text || ' days')::interval),
         billing_status_updated_at = COALESCE(billing_status_updated_at, NOW()),
         plan_code = COALESCE(plan_code, $3),
         plan = CASE
           WHEN plan_code IS NULL OR TRIM(plan_code) = '' THEN $4
           ELSE COALESCE(plan, $4)
         END
     WHERE tenant_key = $1`,
    [
      tenantKey,
      String(values.default_trial_days || billingConfig.defaultTrialDays || DEFAULT_TRIAL_DAYS),
      plan.code,
      plan.label
    ]
  );
  await pool.query(
    `INSERT INTO tenant_billing_accounts (
       tenant_key,
       billing_interval,
       monthly_amount_cents,
       lead_rate_cents,
       included_lead_count,
       call_overage_rate_cents,
       included_call_count,
       stripe_product_id,
       stripe_price_id,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $4, $5, $6, $7, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET
       billing_interval = COALESCE(tenant_billing_accounts.billing_interval, EXCLUDED.billing_interval),
       monthly_amount_cents = COALESCE(tenant_billing_accounts.monthly_amount_cents, EXCLUDED.monthly_amount_cents),
       lead_rate_cents = COALESCE(tenant_billing_accounts.lead_rate_cents, EXCLUDED.lead_rate_cents),
       included_lead_count = COALESCE(tenant_billing_accounts.included_lead_count, EXCLUDED.included_lead_count),
       call_overage_rate_cents = COALESCE(tenant_billing_accounts.call_overage_rate_cents, EXCLUDED.call_overage_rate_cents),
       included_call_count = COALESCE(tenant_billing_accounts.included_call_count, EXCLUDED.included_call_count),
       stripe_product_id = COALESCE(tenant_billing_accounts.stripe_product_id, EXCLUDED.stripe_product_id),
       stripe_price_id = COALESCE(tenant_billing_accounts.stripe_price_id, EXCLUDED.stripe_price_id),
       updated_at = NOW()`,
    [
      tenantKey,
      billingInterval,
      Number(values.monthly_amount_cents || plan.monthlyAmountCents || DEFAULT_MONTHLY_AMOUNT_CENTS),
      Number(values.lead_rate_cents || plan.leadRateCents || 0),
      Number(values.included_lead_count ?? plan.includedCount ?? 0),
      values.stripe_product_id || plan.stripeProductId || DEFAULT_STRIPE_PRODUCT_ID,
      values.stripe_price_id || getPlanStripePriceIdForInterval(plan, billingInterval) || null
    ]
  );
  return getTenantBillingState(pool, tenantKey);
}

export function buildPlanDisplay(row, billingConfig = null) {
  const plan = getBillingPlanByCode(
    billingConfig?.plans || DEFAULT_BILLING_PLANS,
    row?.plan_code || DEFAULT_PLAN_CODE
  );
  const effectiveLeadPricing = resolveEffectiveLeadPricing(row, billingConfig);
  const billingInterval = resolveEffectiveBillingInterval(row);
  const isCustom = hasCustomPricing(row);
  const monthlyAmountCents = resolveEffectiveMonthlyAmount(row);
  const annualAmountCents = resolveEffectiveAnnualAmount(row, billingConfig);
  return {
    code: isCustom ? "custom" : plan.code,
    label: isCustom ? "Custom" : plan.label,
    basePlanCode: plan.code,
    basePlanLabel: plan.label,
    legacyLabel: row?.plan || null,
    monthlyAmountCents,
    annualAmountCents,
    baseAmountCents: billingInterval === "year" ? annualAmountCents : monthlyAmountCents,
    billingInterval,
    billingIntervalLabel: formatBillingIntervalLabel(billingInterval),
    leadRateCents: effectiveLeadPricing.rateCents,
    includedCount: effectiveLeadPricing.includedCount,
    callOverageRateCents: effectiveLeadPricing.rateCents,
    includedCallCount: effectiveLeadPricing.includedCount,
    isCustom
  };
}

export function buildPricingOverride(row) {
  if (!hasCustomPricing(row)) return null;
  const monthlyAmountOverrideCents = Number(row?.monthly_amount_override_cents);
  const leadRateOverrideCents = Number(
    row?.call_overage_rate_override_cents ?? row?.lead_rate_override_cents
  );
  const hasMonthlyOverride = row?.monthly_amount_override_cents !== null
    && row?.monthly_amount_override_cents !== undefined
    && Number.isFinite(monthlyAmountOverrideCents)
    && monthlyAmountOverrideCents >= 0;
  const hasLeadOverride = ((row?.call_overage_rate_override_cents !== null
    && row?.call_overage_rate_override_cents !== undefined)
    || (row?.lead_rate_override_cents !== null
    && row?.lead_rate_override_cents !== undefined))
    && Number.isFinite(leadRateOverrideCents)
    && leadRateOverrideCents >= 0;
  return {
    monthlyAmountCents: hasMonthlyOverride ? monthlyAmountOverrideCents : null,
    leadRateCents: hasLeadOverride ? leadRateOverrideCents : null,
    callOverageRateCents: hasLeadOverride ? leadRateOverrideCents : null,
    reason: row?.price_override_reason || null,
    cyclesRemaining: row?.price_override_cycles_remaining ?? null
  };
}

export function buildAdminPricingState(row, billingConfig = null) {
  const normalizedBillingConfig = billingConfig || {
    defaultTrialDays: DEFAULT_TRIAL_DAYS,
    plans: DEFAULT_BILLING_PLANS
  };
  const planDisplay = buildPlanDisplay(row, normalizedBillingConfig);
  const basePlan = getBillingPlanByCode(normalizedBillingConfig.plans, planDisplay.basePlanCode);
  return {
    availablePlans: normalizeBillingPlans(normalizedBillingConfig.plans),
    defaultTrialDays: Number(normalizedBillingConfig.defaultTrialDays || DEFAULT_TRIAL_DAYS),
    selectedPlanCode: basePlan.code,
    selectedPlanLabel: basePlan.label,
    selectedBillingInterval: resolveEffectiveBillingInterval(row),
    effectiveMonthlyAmountCents: planDisplay.monthlyAmountCents,
    effectiveAnnualAmountCents: planDisplay.annualAmountCents,
    effectiveBaseAmountCents: planDisplay.baseAmountCents,
    effectiveLeadRateCents: planDisplay.leadRateCents,
    effectiveCallOverageRateCents: planDisplay.callOverageRateCents,
    includedCount: planDisplay.includedCount,
    includedCallCount: planDisplay.includedCallCount,
    baseMonthlyAmountCents: basePlan.monthlyAmountCents,
    baseAnnualAmountCents: basePlan.annualAmountCents,
    baseLeadRateCents: basePlan.leadRateCents,
    baseCallOverageRateCents: basePlan.callOverageRateCents,
    baseIncludedCount: basePlan.includedCount,
    baseIncludedCallCount: basePlan.includedCallCount,
    subscriptionDisplayId: planDisplay.isCustom ? "Custom" : (row?.stripe_subscription_id || null),
    stripeSubscriptionId: row?.stripe_subscription_id || null,
    stripeCustomerId: row?.stripe_customer_id || null,
    isCustom: planDisplay.isCustom
  };
}

export function computeTrialDaysRemaining(trialEnd) {
  if (!trialEnd) return null;
  const end = new Date(trialEnd).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function mapStripeSubscriptionToTenantState(subscriptionStatus, currentRow = {}) {
  const currentBillingStatus = String(currentRow?.billing_status || "");
  const currentServiceAccessStatus = String(currentRow?.service_access_status || "enabled");
  const currentAppAccessStatus = String(currentRow?.app_access_status || "enabled");

  if (subscriptionStatus === "trialing") {
    return {
      billingStatus: currentBillingStatus === "trial_expired" ? "trial_expired" : "trialing",
      serviceAccessStatus: "enabled",
      appAccessStatus: currentBillingStatus === "trial_expired" ? "billing_locked" : "enabled",
      billingLockReason: currentBillingStatus === "trial_expired" ? "trial_expired_unpaid" : null
    };
  }

  if (subscriptionStatus === "active") {
    return {
      billingStatus: "active",
      serviceAccessStatus: "enabled",
      appAccessStatus: "enabled",
      billingLockReason: null
    };
  }

  if (subscriptionStatus === "past_due") {
    return {
      billingStatus: "past_due",
      serviceAccessStatus: currentServiceAccessStatus || "enabled",
      appAccessStatus: currentAppAccessStatus || "enabled",
      billingLockReason: null
    };
  }

  if (subscriptionStatus === "unpaid") {
    return {
      billingStatus: "unpaid",
      serviceAccessStatus: "restricted",
      appAccessStatus: currentAppAccessStatus || "enabled",
      billingLockReason: null
    };
  }

  if (subscriptionStatus === "canceled" || subscriptionStatus === "incomplete_expired") {
    return {
      billingStatus: subscriptionStatus === "canceled" ? "canceled" : "incomplete_expired",
      serviceAccessStatus: "disabled",
      appAccessStatus: "billing_locked",
      billingLockReason: subscriptionStatus === "canceled" ? "subscription_canceled" : "subscription_incomplete_expired"
    };
  }

  if (subscriptionStatus === "incomplete") {
    return {
      billingStatus: "incomplete",
      serviceAccessStatus: "disabled",
      appAccessStatus: "billing_locked",
      billingLockReason: "subscription_incomplete"
    };
  }

  return {
    billingStatus: currentBillingStatus || "trialing",
    serviceAccessStatus: currentServiceAccessStatus,
    appAccessStatus: currentAppAccessStatus,
    billingLockReason: currentRow?.billing_lock_reason || null
  };
}

export async function syncTenantStripeSubscription(pool, tenantKey, currentRow, subscription, eventType = "stripe.sync") {
  if (!tenantKey || !subscription?.id) {
    return currentRow;
  }

  const item = subscription?.items?.data?.[0] || {};
  const billingInterval = normalizeBillingInterval(item?.price?.recurring?.interval || currentRow?.billing_interval);
  const billingConfig = await getSystemBillingConfig(pool);
  const currentPlan = getBillingPlanByCode(
    billingConfig.plans,
    currentRow?.plan_code || DEFAULT_PLAN_CODE
  );
  let attachedSchedule = null;
  const attachedScheduleRef = subscription?.schedule;
  const attachedScheduleId = typeof attachedScheduleRef === "string"
    ? normalizeOptionalId(attachedScheduleRef)
    : normalizeOptionalId(attachedScheduleRef?.id);
  if (attachedScheduleId) {
    try {
      attachedSchedule = attachedScheduleRef?.phases
        ? attachedScheduleRef
        : await retrieveSubscriptionSchedule(attachedScheduleId);
    } catch (error) {
      console.error("stripe_subscription_schedule_retrieve_failed", {
        tenantKey,
        subscriptionId: subscription.id,
        scheduleId: attachedScheduleId,
        eventType,
        message: error?.message || "unknown"
      });
    }
  }
  const existingPendingPlan = normalizePlanCode(currentRow?.pending_plan_code)
    ? getBillingPlanByCode(billingConfig.plans, currentRow.pending_plan_code)
    : null;
  const resolvedSubscriptionPlan = resolveBillingPlanFromStripeSubscription(billingConfig.plans, subscription);
  const matchedPlan = resolvedSubscriptionPlan.plan;
  const scheduledPendingPlan = buildPendingPlanFromStripeSchedule(billingConfig.plans, attachedSchedule, {
    currentPlanCode: currentPlan.code,
    currentBillingInterval: currentRow?.billing_interval || billingInterval
  });
  const mapped = mapStripeSubscriptionToTenantState(subscription.status, currentRow);
  const priorPeriodStartMs = toTimestampMillis(currentRow?.current_period_start);
  const priorPeriodEndMs = toTimestampMillis(currentRow?.current_period_end);
  const nextPeriodStartMs = unixSecondsToMillis(subscription.current_period_start);
  const nextPeriodEndMs = unixSecondsToMillis(subscription.current_period_end);
  const sameBillingPeriod = priorPeriodStartMs > 0
    && priorPeriodEndMs > 0
    && priorPeriodStartMs === nextPeriodStartMs
    && priorPeriodEndMs === nextPeriodEndMs;
  const currentPeriodStillActive = priorPeriodEndMs > Date.now();
  const shouldKeepExistingPendingPlan = Boolean(
    existingPendingPlan
      && matchedPlan
      && existingPendingPlan.code === matchedPlan.code
      && sameBillingPeriod
      && currentPeriodStillActive
  );
  const shouldStagePendingPlan = Boolean(
    matchedPlan
      && matchedPlan.code !== currentPlan.code
      && sameBillingPeriod
      && currentPeriodStillActive
      && (resolvedSubscriptionPlan.source === "price" || shouldKeepExistingPendingPlan)
  );
  const shouldApplyPlanNow = Boolean(
    matchedPlan
      && !shouldStagePendingPlan
      && (
        matchedPlan.code !== currentPlan.code
        || (existingPendingPlan && existingPendingPlan.code === matchedPlan.code)
      )
  );
  const appliedPlan = shouldApplyPlanNow && matchedPlan ? matchedPlan : currentPlan;
  const pendingPlanFromPrice = shouldStagePendingPlan && matchedPlan ? matchedPlan : null;
  const pendingPlan = scheduledPendingPlan?.plan || pendingPlanFromPrice || null;
  const shouldRefreshBasePlanValues = Boolean(shouldApplyPlanNow && matchedPlan);
  const shouldClearOverrides = shouldRefreshBasePlanValues;
  const baseMonthlyAmountCents = shouldRefreshBasePlanValues
    ? Number(appliedPlan.monthlyAmountCents || 0)
    : (Number.isFinite(Number(currentRow?.monthly_amount_cents))
      ? Math.round(Number(currentRow.monthly_amount_cents))
      : null);
  const baseCallOverageRateCents = shouldRefreshBasePlanValues
    ? Number(appliedPlan.callOverageRateCents ?? appliedPlan.leadRateCents ?? 0)
    : (Number.isFinite(Number(currentRow?.call_overage_rate_cents ?? currentRow?.lead_rate_cents))
      ? Math.max(0, Math.round(Number(currentRow.call_overage_rate_cents ?? currentRow.lead_rate_cents)))
      : null);
  const baseIncludedCallCount = shouldRefreshBasePlanValues
    ? Number(appliedPlan.includedCallCount ?? appliedPlan.includedCount ?? 0)
    : (Number.isFinite(Number(currentRow?.included_call_count ?? currentRow?.included_lead_count))
      ? Math.max(0, Math.round(Number(currentRow.included_call_count ?? currentRow.included_lead_count)))
      : null);
  const pendingPlanCode = pendingPlan?.code || null;
  const pendingBillingInterval = pendingPlanCode
    ? normalizeBillingInterval(scheduledPendingPlan?.billingInterval || billingInterval)
    : null;
  const pendingPlanEffectiveAt = pendingPlanCode
    ? (scheduledPendingPlan?.effectiveAt || currentRow?.current_period_end || millisToIso(nextPeriodEndMs))
    : null;

  await pool.query(
    `INSERT INTO tenant_billing_accounts (
       tenant_key,
       stripe_customer_id,
       stripe_subscription_id,
       stripe_product_id,
       stripe_price_id,
       billing_interval,
       monthly_amount_cents,
       lead_rate_cents,
       included_lead_count,
       call_overage_rate_cents,
       included_call_count,
       pending_plan_code,
       pending_billing_interval,
       pending_plan_effective_at,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       canceled_at,
       trial_end,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9, $10, $11, $12, to_timestamp(NULLIF($13, 0)), to_timestamp(NULLIF($14, 0)), $15, $16, $17, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_product_id = EXCLUDED.stripe_product_id,
       stripe_price_id = EXCLUDED.stripe_price_id,
       billing_interval = EXCLUDED.billing_interval,
       monthly_amount_cents = CASE
         WHEN $18 THEN EXCLUDED.monthly_amount_cents
         ELSE tenant_billing_accounts.monthly_amount_cents
       END,
       lead_rate_cents = CASE
         WHEN $18 THEN EXCLUDED.lead_rate_cents
         ELSE tenant_billing_accounts.lead_rate_cents
       END,
       included_lead_count = CASE
         WHEN $18 THEN EXCLUDED.included_lead_count
         ELSE tenant_billing_accounts.included_lead_count
       END,
       call_overage_rate_cents = CASE
         WHEN $18 THEN EXCLUDED.call_overage_rate_cents
         ELSE tenant_billing_accounts.call_overage_rate_cents
       END,
       included_call_count = CASE
         WHEN $18 THEN EXCLUDED.included_call_count
         ELSE tenant_billing_accounts.included_call_count
       END,
       pending_plan_code = EXCLUDED.pending_plan_code,
       pending_billing_interval = EXCLUDED.pending_billing_interval,
       pending_plan_effective_at = EXCLUDED.pending_plan_effective_at,
       monthly_amount_override_cents = CASE
         WHEN $19 THEN NULL
         ELSE tenant_billing_accounts.monthly_amount_override_cents
       END,
       lead_rate_override_cents = CASE
         WHEN $19 THEN NULL
         ELSE tenant_billing_accounts.lead_rate_override_cents
       END,
       call_overage_rate_override_cents = CASE
         WHEN $19 THEN NULL
         ELSE tenant_billing_accounts.call_overage_rate_override_cents
       END,
       price_override_reason = CASE
         WHEN $19 THEN NULL
         ELSE tenant_billing_accounts.price_override_reason
       END,
       price_override_cycles_remaining = CASE
         WHEN $19 THEN NULL
         ELSE tenant_billing_accounts.price_override_cycles_remaining
       END,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       canceled_at = EXCLUDED.canceled_at,
       trial_end = EXCLUDED.trial_end,
       updated_at = NOW()`,
    [
      tenantKey,
      subscription.customer ? String(subscription.customer) : null,
      subscription.id || null,
      item.price?.product ? String(item.price.product) : null,
      item.price?.id || null,
      billingInterval,
      baseMonthlyAmountCents,
      baseCallOverageRateCents,
      baseIncludedCallCount,
      pendingPlanCode,
      pendingBillingInterval,
      pendingPlanEffectiveAt,
      subscription.current_period_start || 0,
      subscription.current_period_end || 0,
      Boolean(subscription.cancel_at_period_end),
      subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      Boolean(shouldRefreshBasePlanValues),
      Boolean(shouldClearOverrides)
    ]
  );

  await pool.query(
    `UPDATE tenants
     SET billing_status = $2,
         service_access_status = $3,
         app_access_status = $4,
         billing_lock_reason = $5,
         plan_code = COALESCE($6, plan_code),
         plan = CASE
           WHEN $6 IS NULL THEN plan
           ELSE $7
         END,
         billing_status_updated_at = NOW()
     WHERE tenant_key = $1`,
    [
      tenantKey,
      mapped.billingStatus,
      mapped.serviceAccessStatus,
      mapped.appAccessStatus,
      mapped.billingLockReason,
      shouldApplyPlanNow ? (appliedPlan?.code || null) : null,
      shouldApplyPlanNow ? (appliedPlan?.label || null) : null
    ]
  );

  if (
    currentRow?.billing_status !== mapped.billingStatus ||
    currentRow?.service_access_status !== mapped.serviceAccessStatus ||
    currentRow?.app_access_status !== mapped.appAccessStatus ||
    String(currentRow?.billing_lock_reason || "") !== String(mapped.billingLockReason || "")
  ) {
    await recordBillingLifecycleEvent(pool, {
      tenantKey,
      eventType,
      fromBillingStatus: currentRow?.billing_status || null,
      toBillingStatus: mapped.billingStatus,
      fromServiceAccessStatus: currentRow?.service_access_status || null,
      toServiceAccessStatus: mapped.serviceAccessStatus,
      fromAppAccessStatus: currentRow?.app_access_status || null,
      toAppAccessStatus: mapped.appAccessStatus,
      reason: `stripe_subscription_${subscription.status}`,
      metadata: {
        stripeSubscriptionId: subscription.id
      },
      createdByType: "stripe_sync",
      createdById: subscription.id
    });
  }

  return getTenantBillingState(pool, tenantKey);
}

export async function syncTenantStripeSubscriptionSchedule(pool, tenantKey, currentRow, schedule, eventType = "stripe.schedule.sync") {
  if (!tenantKey || !schedule?.id) {
    return currentRow;
  }
  const billingConfig = await getSystemBillingConfig(pool);
  const pendingPlan = buildPendingPlanFromStripeSchedule(billingConfig.plans, schedule, {
    currentPlanCode: currentRow?.plan_code || DEFAULT_PLAN_CODE,
    currentBillingInterval: currentRow?.billing_interval || DEFAULT_BILLING_INTERVAL
  });
  const stripeCustomerId = normalizeOptionalId(schedule?.customer);
  const stripeSubscriptionId = normalizeOptionalId(schedule?.subscription || schedule?.released_subscription);

  await pool.query(
    `INSERT INTO tenant_billing_accounts (
       tenant_key,
       stripe_customer_id,
       stripe_subscription_id,
       pending_plan_code,
       pending_billing_interval,
       pending_plan_effective_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, tenant_billing_accounts.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, tenant_billing_accounts.stripe_subscription_id),
       pending_plan_code = EXCLUDED.pending_plan_code,
       pending_billing_interval = EXCLUDED.pending_billing_interval,
       pending_plan_effective_at = EXCLUDED.pending_plan_effective_at,
       updated_at = NOW()`,
    [
      tenantKey,
      stripeCustomerId,
      stripeSubscriptionId,
      pendingPlan?.plan?.code || null,
      pendingPlan?.billingInterval || null,
      pendingPlan?.effectiveAt || null
    ]
  );

  return getTenantBillingState(pool, tenantKey);
}

export async function recordBillingLifecycleEvent(pool, {
  tenantKey,
  eventType,
  fromBillingStatus = null,
  toBillingStatus = null,
  fromServiceAccessStatus = null,
  toServiceAccessStatus = null,
  fromAppAccessStatus = null,
  toAppAccessStatus = null,
  reason = null,
  metadata = null,
  createdByType = "system",
  createdById = null
}) {
  await pool.query(
    `INSERT INTO billing_lifecycle_events (
       tenant_key,
       event_type,
       from_billing_status,
       to_billing_status,
       from_service_access_status,
       to_service_access_status,
       from_app_access_status,
       to_app_access_status,
       reason,
       metadata_json,
       created_by_type,
       created_by_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
    [
      tenantKey,
      eventType,
      fromBillingStatus,
      toBillingStatus,
      fromServiceAccessStatus,
      toServiceAccessStatus,
      fromAppAccessStatus,
      toAppAccessStatus,
      reason,
      metadata ? JSON.stringify(metadata) : null,
      createdByType,
      createdById
    ]
  );
}

export async function requireTenantBillingAccess(res, pool, session, tenantKey, options = {}) {
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  if (session.role === "admin") {
    return { allowed: true, reason: null };
  }

  const activeUser = await requireActiveTenantUser(session);
  if (!activeUser) {
    res.status(403).json({
      error: "forbidden",
      message: "An active tenant user session is required."
    });
    return null;
  }
  if (activeUser.tenant_key && tenantKey && activeUser.tenant_key !== tenantKey) {
    res.status(403).json({
      error: "forbidden",
      message: "That tenant does not match the active session."
    });
    return null;
  }

  const state = await getTenantBillingState(pool, tenantKey);
  if (!state) {
    res.status(404).json({ error: "tenant_not_found" });
    return null;
  }

  const allowBillingLocked = options.allowBillingLocked === true;
  const allowDeactivated = options.allowDeactivated === true;

  if (state.billing_status === "deactivated" && !allowDeactivated) {
    res.status(403).json({
      error: "account_deactivated",
      message: "Open Billing in EveryCall to restart service and reactivate your account."
    });
    return null;
  }

  if (state.app_access_status === "billing_locked" && !allowBillingLocked) {
    res.status(402).json({
      error: "billing_locked",
      message: "Billing is required to access this area.",
      billingStatus: state.billing_status
    });
    return null;
  }

  return { allowed: true, reason: null, state };
}

export async function getAdminBillingReport(pool) {
  const rows = await pool.query(
    `SELECT
       t.tenant_key,
       t.name,
       t.billing_status,
       t.service_access_status,
       t.app_access_status,
       t.trial_end,
       t.post_trial_access_ends_at,
       t.telnyx_voice_number,
       nh_email.status AS email_status,
       nh_email.last_error_message AS email_error,
       nh_sms.status AS sms_status,
       nh_sms.last_error_message AS sms_error
     FROM tenants t
     LEFT JOIN LATERAL (
       SELECT status, last_error_message
       FROM notification_channel_health
       WHERE tenant_key = t.tenant_key AND channel = 'email'
       ORDER BY updated_at DESC
       LIMIT 1
     ) nh_email ON TRUE
     LEFT JOIN LATERAL (
       SELECT status, last_error_message
       FROM notification_channel_health
       WHERE tenant_key = t.tenant_key AND channel = 'sms'
       ORDER BY updated_at DESC
       LIMIT 1
     ) nh_sms ON TRUE
     WHERE
       (t.billing_status = 'trialing' AND t.trial_end IS NOT NULL AND t.trial_end <= NOW() + interval '7 days')
       OR
       (t.billing_status = 'trial_expired' AND t.post_trial_access_ends_at IS NOT NULL AND t.post_trial_access_ends_at <= NOW() + interval '7 days')
     ORDER BY COALESCE(t.trial_end, t.post_trial_access_ends_at) ASC`
  );
  return rows.rows;
}
