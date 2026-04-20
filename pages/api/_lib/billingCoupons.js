import {
  buildPlanDisplay,
  ensureTenantBillingAccount,
  getSystemBillingConfig,
  getTenantBillingState,
  recordBillingLifecycleEvent,
  resolveBillingPlanFromStripeSubscription,
  resolveEffectiveMonthlyAmount,
  syncTenantStripeSubscription
} from "./billing.js";
import {
  findCurrentSubscriptionForCustomer,
  findCurrentSubscriptionForTenantKey,
  retrieveSubscription,
  updateSubscriptionPrice
} from "./stripe.js";

const ACTIVE_STRIPE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "unpaid", "incomplete"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isoDate(value) {
  const date = normalizeDate(value);
  return date ? date.toISOString() : null;
}

function parsePercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(100, Number(amount.toFixed(2))));
}

function normalizeDayCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.max(0, Math.round(count));
}

function addDays(dateLike, days) {
  const date = normalizeDate(dateLike) || new Date();
  date.setUTCDate(date.getUTCDate() + Math.max(0, Number(days || 0)));
  return date;
}

function percentToMultiplier(percent) {
  return Math.max(0, 100 - parsePercent(percent)) / 100;
}

export function normalizeCouponCode(value) {
  return normalizeText(value).toUpperCase();
}

export function computeDiscountedAmountCents(amountCents, discountPercent) {
  const amount = Number.isFinite(Number(amountCents))
    ? Math.max(0, Math.round(Number(amountCents)))
    : 0;
  return Math.max(0, Math.round(amount * percentToMultiplier(discountPercent)));
}

export function couponHasMonthlyDiscount(source = {}) {
  return parsePercent(
    source.snapshot_monthly_discount_percent
      ?? source.monthly_discount_percent
      ?? source.monthlyDiscountPercent
  ) > 0;
}

export function couponHasOverageDiscount(source = {}) {
  return parsePercent(
    source.snapshot_overage_discount_percent
      ?? source.overage_discount_percent
      ?? source.overageDiscountPercent
  ) > 0;
}

export function couponHasTrial(source = {}) {
  return normalizeDayCount(
    source.snapshot_free_trial_days
      ?? source.free_trial_days
      ?? source.freeTrialDays
  ) > 0;
}

export function deriveBillingCouponStatus(coupon = {}) {
  const status = normalizeText(coupon.status).toLowerCase() || "active";
  const redeemBy = normalizeDate(coupon.redeem_by || coupon.redeemBy);
  if (status === "active" && redeemBy && redeemBy.getTime() < Date.now()) {
    return "expired";
  }
  return status;
}

export function deriveCouponRedemptionRuntimeStatus(redemption = {}) {
  const status = normalizeText(redemption.status).toLowerCase() || "active";
  if (status !== "active") return status;
  const now = Date.now();
  const trialEndsAt = normalizeDate(redemption.trial_ends_at || redemption.trialEndsAt);
  const discountStartsAt = normalizeDate(redemption.discount_starts_at || redemption.discountStartsAt);
  const discountEndsAt = normalizeDate(redemption.discount_ends_at || redemption.discountEndsAt);
  const hasDiscount = couponHasMonthlyDiscount(redemption) || couponHasOverageDiscount(redemption);
  if (discountStartsAt && discountEndsAt && discountEndsAt.getTime() <= now) {
    return "expired";
  }
  if (!hasDiscount && trialEndsAt && trialEndsAt.getTime() <= now) {
    return "expired";
  }
  return "active";
}

export function buildBillingCouponDisplay(row = {}) {
  const couponCode = normalizeOptionalText(row.active_coupon_code || row.code || row.coupon_code);
  if (!couponCode) return null;
  const status = deriveCouponRedemptionRuntimeStatus(row);
  const monthlyDiscountPercent = parsePercent(
    row.active_coupon_monthly_discount_percent
      ?? row.snapshot_monthly_discount_percent
      ?? row.monthly_discount_percent
  );
  const overageDiscountPercent = parsePercent(
    row.active_coupon_overage_discount_percent
      ?? row.snapshot_overage_discount_percent
      ?? row.overage_discount_percent
  );
  const freeTrialDays = normalizeDayCount(
    row.active_coupon_free_trial_days
      ?? row.snapshot_free_trial_days
      ?? row.free_trial_days
  );
  const discountDurationDays = normalizeDayCount(
    row.active_coupon_discount_duration_days
      ?? row.snapshot_discount_duration_days
      ?? row.discount_duration_days
  );
  const trialStartsAt = row.active_coupon_trial_starts_at || row.trial_starts_at || null;
  const trialEndsAt = row.active_coupon_trial_ends_at || row.trial_ends_at || null;
  const discountStartsAt = row.active_coupon_discount_starts_at || row.discount_starts_at || null;
  const discountEndsAt = row.active_coupon_discount_ends_at || row.discount_ends_at || null;
  return {
    billingCouponRedemptionId: Number(
      row.active_coupon_redemption_id
        || row.billing_coupon_redemption_id
        || 0
    ) || null,
    billingCouponId: Number(row.active_coupon_id || row.billing_coupon_id || 0) || null,
    code: couponCode,
    status,
    notes: row.active_coupon_notes || row.notes || null,
    monthlyDiscountPercent,
    overageDiscountPercent,
    freeTrialDays,
    discountDurationDays,
    trialStartsAt,
    trialEndsAt,
    discountStartsAt,
    discountEndsAt,
    pendingPaidDiscountStart: !discountStartsAt && (monthlyDiscountPercent > 0 || overageDiscountPercent > 0),
    appliesToBase: monthlyDiscountPercent > 0,
    appliesToOverage: overageDiscountPercent > 0
  };
}

async function markExpiredCoupons(pool) {
  await pool.query(
    `UPDATE billing_coupons
     SET status = 'expired',
         updated_at = NOW()
     WHERE status = 'active'
       AND redeem_by IS NOT NULL
       AND redeem_by < NOW()`
  );
}

async function loadCouponScopes(pool, billingCouponId) {
  const scopes = await pool.query(
    `SELECT plan_code
     FROM billing_coupon_plan_scopes
     WHERE billing_coupon_id = $1
     ORDER BY plan_code ASC`,
    [billingCouponId]
  );
  return (scopes.rows || []).map((row) => normalizeText(row.plan_code).toLowerCase()).filter(Boolean);
}

async function loadCouponById(pool, billingCouponId, { forUpdate = false } = {}) {
  await markExpiredCoupons(pool);
  const result = await pool.query(
    `SELECT *
     FROM billing_coupons
     WHERE billing_coupon_id = $1
     ${forUpdate ? "FOR UPDATE" : ""}
     LIMIT 1`,
    [billingCouponId]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    status: deriveBillingCouponStatus(row),
    planScopes: await loadCouponScopes(pool, row.billing_coupon_id)
  };
}

async function loadCouponByCode(pool, code, { forUpdate = false } = {}) {
  await markExpiredCoupons(pool);
  const result = await pool.query(
    `SELECT *
     FROM billing_coupons
     WHERE code = $1
     ${forUpdate ? "FOR UPDATE" : ""}
     LIMIT 1`,
    [normalizeCouponCode(code)]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    status: deriveBillingCouponStatus(row),
    planScopes: await loadCouponScopes(pool, row.billing_coupon_id)
  };
}

export async function getBillingCouponById(pool, billingCouponId) {
  return loadCouponById(pool, billingCouponId);
}

export async function getBillingCouponByCode(pool, code) {
  return loadCouponByCode(pool, code);
}

async function loadCouponRedemptionById(pool, billingCouponRedemptionId, { forUpdate = false } = {}) {
  if (!Number.isFinite(Number(billingCouponRedemptionId)) || Number(billingCouponRedemptionId) <= 0) {
    return null;
  }
  const result = await pool.query(
    `SELECT
       r.*,
       c.code,
       c.notes,
       c.status AS coupon_status
     FROM billing_coupon_redemptions r
     JOIN billing_coupons c
       ON c.billing_coupon_id = r.billing_coupon_id
     WHERE r.billing_coupon_redemption_id = $1
     ${forUpdate ? "FOR UPDATE" : ""}
     LIMIT 1`,
    [Number(billingCouponRedemptionId)]
  );
  return result.rows[0] || null;
}

async function loadTenantActiveCouponRedemptionRow(pool, tenantKey, { forUpdate = false } = {}) {
  const result = await pool.query(
    `SELECT
       r.*,
       c.code,
       c.notes,
       c.status AS coupon_status,
       b.active_coupon_redemption_id
     FROM tenant_billing_accounts b
     JOIN billing_coupon_redemptions r
       ON r.billing_coupon_redemption_id = b.active_coupon_redemption_id
     JOIN billing_coupons c
       ON c.billing_coupon_id = r.billing_coupon_id
     WHERE b.tenant_key = $1
     ${forUpdate ? "FOR UPDATE OF b, r" : ""}
     LIMIT 1`,
    [tenantKey]
  );
  return result.rows[0] || null;
}

function couponAllowsPlan(coupon, planCode) {
  const normalizedPlanCode = normalizeText(planCode).toLowerCase();
  const scopes = Array.isArray(coupon?.planScopes) ? coupon.planScopes : [];
  return Boolean(normalizedPlanCode) && scopes.includes(normalizedPlanCode);
}

function redemptionHasAnyBenefit(redemption = {}) {
  return couponHasTrial(redemption) || couponHasMonthlyDiscount(redemption) || couponHasOverageDiscount(redemption);
}

function buildRedemptionMetadata(previousState, extra = {}) {
  return {
    previousTrialEnd: previousState?.trial_end || null,
    previousTrialStartedAt: previousState?.trial_started_at || null,
    previousBillingStatus: previousState?.billing_status || null,
    previousServiceAccessStatus: previousState?.service_access_status || null,
    previousAppAccessStatus: previousState?.app_access_status || null,
    previousBillingLockReason: previousState?.billing_lock_reason || null,
    previousActiveCouponRedemptionId: previousState?.active_coupon_redemption_id || null,
    redeemedDuringPaidSubscription: Boolean(previousState?.stripe_subscription_id),
    ...extra
  };
}

function getFutureDate(value) {
  const date = normalizeDate(value);
  if (!date) return null;
  return date.getTime() > Date.now() ? date : null;
}

async function updateTenantCouponPointers(pool, tenantKey, redemption) {
  await pool.query(
    `UPDATE tenant_billing_accounts
     SET active_coupon_redemption_id = $2,
         coupon_trial_ends_at = $3,
         coupon_discount_starts_at = $4,
         coupon_discount_ends_at = $5,
         updated_at = NOW()
     WHERE tenant_key = $1`,
    [
      tenantKey,
      redemption?.billing_coupon_redemption_id || null,
      redemption?.trial_ends_at || null,
      redemption?.discount_starts_at || null,
      redemption?.discount_ends_at || null
    ]
  );
}

async function restoreTenantTrialState(pool, tenantKey, redemption, currentState) {
  const metadata = redemption?.metadata_json && typeof redemption.metadata_json === "object"
    ? redemption.metadata_json
    : {};
  const previousBillingStatus = normalizeOptionalText(metadata.previousBillingStatus) || currentState?.billing_status || "trialing";
  const previousServiceAccessStatus = normalizeOptionalText(metadata.previousServiceAccessStatus) || currentState?.service_access_status || "enabled";
  const previousAppAccessStatus = normalizeOptionalText(metadata.previousAppAccessStatus) || currentState?.app_access_status || "enabled";
  const previousBillingLockReason = metadata.previousBillingLockReason ?? currentState?.billing_lock_reason ?? null;
  const previousTrialStartedAt = metadata.previousTrialStartedAt || currentState?.trial_started_at || null;
  const previousTrialEnd = metadata.previousTrialEnd ?? null;
  await pool.query(
    `UPDATE tenants
     SET trial_started_at = $2,
         trial_end = $3,
         billing_status = $4,
         service_access_status = $5,
         app_access_status = $6,
         billing_lock_reason = $7,
         billing_status_updated_at = NOW()
     WHERE tenant_key = $1`,
    [
      tenantKey,
      previousTrialStartedAt,
      previousTrialEnd,
      previousBillingStatus,
      previousServiceAccessStatus,
      previousAppAccessStatus,
      previousBillingLockReason
    ]
  );
}

async function findActiveStripeSubscriptionForBillingState(billingState, tenantKey) {
  let subscription = null;
  if (billingState?.stripe_subscription_id) {
    try {
      subscription = await retrieveSubscription(billingState.stripe_subscription_id);
    } catch {
      subscription = null;
    }
  }
  if (!subscription && billingState?.stripe_customer_id) {
    try {
      subscription = await findCurrentSubscriptionForCustomer(billingState.stripe_customer_id);
    } catch {
      subscription = null;
    }
  }
  if (!subscription && tenantKey) {
    try {
      subscription = await findCurrentSubscriptionForTenantKey(tenantKey);
    } catch {
      subscription = null;
    }
  }
  if (!subscription || !ACTIVE_STRIPE_SUBSCRIPTION_STATUSES.has(normalizeText(subscription.status).toLowerCase())) {
    return null;
  }
  return subscription;
}

function shouldExpireRedemption(redemption) {
  if (!redemption) return false;
  const runtimeStatus = deriveCouponRedemptionRuntimeStatus(redemption);
  return runtimeStatus === "expired";
}

export async function refreshTenantCouponState(pool, tenantKey) {
  const current = await loadTenantActiveCouponRedemptionRow(pool, tenantKey, { forUpdate: false });
  if (!current) return null;
  if (!shouldExpireRedemption(current)) {
    return buildBillingCouponDisplay(current);
  }

  const currentState = await getTenantBillingState(pool, tenantKey);
  await pool.query(
    `UPDATE billing_coupon_redemptions
     SET status = 'expired',
         updated_at = NOW()
     WHERE billing_coupon_redemption_id = $1`,
    [current.billing_coupon_redemption_id]
  );

  const shouldRestoreTrial = couponHasTrial(current)
    && !couponHasMonthlyDiscount(current)
    && !couponHasOverageDiscount(current)
    && String(currentState?.billing_status || "").toLowerCase() === "trialing"
    && !currentState?.stripe_subscription_id;

  if (shouldRestoreTrial) {
    await restoreTenantTrialState(pool, tenantKey, current, currentState);
  }

  await updateTenantCouponPointers(pool, tenantKey, null);
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, 'system', 'billing.coupon.expired', $2)`,
    [tenantKey, `coupon_code=${current.code}`]
  );
  await recordBillingLifecycleEvent(pool, {
    tenantKey,
    eventType: "billing.coupon.expired",
    fromBillingStatus: currentState?.billing_status || null,
    toBillingStatus: currentState?.billing_status || null,
    fromServiceAccessStatus: currentState?.service_access_status || null,
    toServiceAccessStatus: currentState?.service_access_status || null,
    fromAppAccessStatus: currentState?.app_access_status || null,
    toAppAccessStatus: currentState?.app_access_status || null,
    reason: "coupon_window_ended",
    metadata: {
      couponCode: current.code,
      billingCouponRedemptionId: current.billing_coupon_redemption_id
    },
    createdByType: "system"
  });
  return null;
}

export async function getTenantActiveCouponRedemption(pool, tenantKey) {
  await refreshTenantCouponState(pool, tenantKey);
  const row = await loadTenantActiveCouponRedemptionRow(pool, tenantKey);
  return row ? buildBillingCouponDisplay(row) : null;
}

export async function listBillingCoupons(pool) {
  await markExpiredCoupons(pool);
  const result = await pool.query(
    `SELECT
       c.*,
       r.tenant_key AS redeemed_tenant_key,
       r.redeemed_at,
       r.status AS redemption_status,
       r.trial_ends_at,
       r.discount_ends_at
     FROM billing_coupons c
     LEFT JOIN billing_coupon_redemptions r
       ON r.billing_coupon_id = c.billing_coupon_id
     ORDER BY c.created_at DESC, c.billing_coupon_id DESC`
  );
  const rows = result.rows || [];
  const scopeRows = await pool.query(
    `SELECT billing_coupon_id, plan_code
     FROM billing_coupon_plan_scopes
     ORDER BY plan_code ASC`
  );
  const scopeMap = new Map();
  for (const row of scopeRows.rows || []) {
    const key = Number(row.billing_coupon_id || 0);
    if (!scopeMap.has(key)) scopeMap.set(key, []);
    scopeMap.get(key).push(normalizeText(row.plan_code).toLowerCase());
  }
  return rows.map((row) => ({
    billingCouponId: Number(row.billing_coupon_id || 0),
    code: row.code,
    status: deriveBillingCouponStatus(row),
    monthlyDiscountPercent: parsePercent(row.monthly_discount_percent),
    overageDiscountPercent: parsePercent(row.overage_discount_percent),
    discountDurationDays: normalizeDayCount(row.discount_duration_days),
    freeTrialDays: normalizeDayCount(row.free_trial_days),
    singleUseGlobal: row.single_use_global !== false,
    maxRedemptions: Number(row.max_redemptions || 1) || 1,
    redeemBy: row.redeem_by || null,
    notes: row.notes || null,
    createdByAdminUserId: row.created_by_admin_user_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    planScopes: scopeMap.get(Number(row.billing_coupon_id || 0)) || [],
    redemption: row.redeemed_tenant_key
      ? {
          tenantKey: row.redeemed_tenant_key,
          redeemedAt: row.redeemed_at || null,
          status: row.redemption_status || null,
          trialEndsAt: row.trial_ends_at || null,
          discountEndsAt: row.discount_ends_at || null
        }
      : null
  }));
}

export async function saveBillingCoupon(pool, {
  billingCouponId = null,
  code,
  status = "active",
  monthlyDiscountPercent = 0,
  overageDiscountPercent = 0,
  discountDurationDays = 0,
  freeTrialDays = 0,
  redeemBy = null,
  notes = null,
  planScopes = [],
  createdByAdminUserId = null
}) {
  const normalizedCode = normalizeCouponCode(code);
  const normalizedStatus = normalizeText(status).toLowerCase() || "active";
  const normalizedPlanScopes = [...new Set((Array.isArray(planScopes) ? planScopes : [])
    .map((item) => normalizeText(item).toLowerCase())
    .filter((item) => ["starter", "growth", "pro"].includes(item)))];
  if (!normalizedCode) {
    throw new Error("coupon_code_required");
  }
  if (!["active", "disabled", "redeemed", "expired"].includes(normalizedStatus)) {
    throw new Error("coupon_status_invalid");
  }
  if (!normalizedPlanScopes.length) {
    throw new Error("coupon_plan_scope_required");
  }
  const normalizedMonthlyDiscountPercent = parsePercent(monthlyDiscountPercent);
  const normalizedOverageDiscountPercent = parsePercent(overageDiscountPercent);
  const normalizedDiscountDurationDays = normalizeDayCount(discountDurationDays);
  const normalizedFreeTrialDays = normalizeDayCount(freeTrialDays);
  if (
    normalizedMonthlyDiscountPercent <= 0
    && normalizedOverageDiscountPercent <= 0
    && normalizedFreeTrialDays <= 0
  ) {
    throw new Error("coupon_benefit_required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (billingCouponId) {
      const existing = await loadCouponById(client, billingCouponId, { forUpdate: true });
      if (!existing) {
        throw new Error("coupon_not_found");
      }
      await client.query(
        `UPDATE billing_coupons
         SET code = $2,
             status = $3,
             monthly_discount_percent = $4,
             overage_discount_percent = $5,
             discount_duration_days = $6,
             free_trial_days = $7,
             redeem_by = $8,
             notes = $9,
             updated_at = NOW()
         WHERE billing_coupon_id = $1`,
        [
          Number(billingCouponId),
          normalizedCode,
          normalizedStatus,
          normalizedMonthlyDiscountPercent,
          normalizedOverageDiscountPercent,
          normalizedDiscountDurationDays,
          normalizedFreeTrialDays,
          isoDate(redeemBy),
          normalizeOptionalText(notes)
        ]
      );
      await client.query(`DELETE FROM billing_coupon_plan_scopes WHERE billing_coupon_id = $1`, [Number(billingCouponId)]);
      for (const planCode of normalizedPlanScopes) {
        await client.query(
          `INSERT INTO billing_coupon_plan_scopes (billing_coupon_id, plan_code, created_at)
           VALUES ($1, $2, NOW())`,
          [Number(billingCouponId), planCode]
        );
      }
      await client.query("COMMIT");
      return loadCouponById(pool, billingCouponId);
    }

    const inserted = await client.query(
      `INSERT INTO billing_coupons (
         code,
         status,
         monthly_discount_percent,
         overage_discount_percent,
         discount_duration_days,
         free_trial_days,
         single_use_global,
         max_redemptions,
         redeem_by,
         notes,
         created_by_admin_user_id,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, 1, $7, $8, $9, NOW(), NOW())
       RETURNING billing_coupon_id`,
      [
        normalizedCode,
        normalizedStatus,
        normalizedMonthlyDiscountPercent,
        normalizedOverageDiscountPercent,
        normalizedDiscountDurationDays,
        normalizedFreeTrialDays,
        isoDate(redeemBy),
        normalizeOptionalText(notes),
        createdByAdminUserId || null
      ]
    );
    const nextId = Number(inserted.rows[0]?.billing_coupon_id || 0);
    for (const planCode of normalizedPlanScopes) {
      await client.query(
        `INSERT INTO billing_coupon_plan_scopes (billing_coupon_id, plan_code, created_at)
         VALUES ($1, $2, NOW())`,
        [nextId, planCode]
      );
    }
    await client.query("COMMIT");
    return loadCouponById(pool, nextId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function syncCouponRedemptionPointersAfterUpdate(client, tenantKey, redemptionId = null) {
  const row = redemptionId ? await loadCouponRedemptionById(client, redemptionId) : null;
  await updateTenantCouponPointers(client, tenantKey, row);
  return row;
}

export async function activatePendingCouponDiscountWindow(pool, tenantKey, {
  activatedAt = null,
  subscription = null
} = {}) {
  const redemption = await loadTenantActiveCouponRedemptionRow(pool, tenantKey, { forUpdate: false });
  if (!redemption || !redemptionHasAnyBenefit(redemption)) {
    return null;
  }
  if (normalizeDate(redemption.discount_starts_at)) {
    return buildBillingCouponDisplay(redemption);
  }
  if (!couponHasMonthlyDiscount(redemption) && !couponHasOverageDiscount(redemption)) {
    return buildBillingCouponDisplay(redemption);
  }
  const effectiveStart = normalizeDate(activatedAt)
    || (subscription?.current_period_start
      ? normalizeDate(new Date(Number(subscription.current_period_start || 0) * 1000))
      : null)
    || new Date();
  const durationDays = normalizeDayCount(redemption.snapshot_discount_duration_days);
  const nextDiscountEndsAt = durationDays > 0 ? addDays(effectiveStart, durationDays) : null;
  await pool.query(
    `UPDATE billing_coupon_redemptions
     SET discount_starts_at = $2,
         discount_ends_at = $3,
         updated_at = NOW()
     WHERE billing_coupon_redemption_id = $1`,
    [
      redemption.billing_coupon_redemption_id,
      effectiveStart.toISOString(),
      isoDate(nextDiscountEndsAt)
    ]
  );
  const updated = await syncCouponRedemptionPointersAfterUpdate(pool, tenantKey, redemption.billing_coupon_redemption_id);
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, 'system', 'billing.coupon.monthly_discount_applied', $2)`,
    [
      tenantKey,
      `coupon_code=${redemption.code} discount_starts_at=${effectiveStart.toISOString()}`
    ]
  );
  return updated ? buildBillingCouponDisplay(updated) : null;
}

async function applyCouponTrialState(client, tenantKey, currentState, trialEndsAt) {
  const existingFutureTrialEnd = getFutureDate(currentState?.trial_end);
  const effectiveTrialEnd = existingFutureTrialEnd && existingFutureTrialEnd.getTime() > trialEndsAt.getTime()
    ? existingFutureTrialEnd
    : trialEndsAt;
  await client.query(
    `UPDATE tenants
     SET trial_started_at = COALESCE(trial_started_at, NOW()),
         trial_end = $2,
         billing_status = 'trialing',
         service_access_status = 'enabled',
         app_access_status = 'enabled',
         billing_lock_reason = NULL,
         billing_status_updated_at = NOW()
     WHERE tenant_key = $1`,
    [tenantKey, effectiveTrialEnd.toISOString()]
  );
  return effectiveTrialEnd;
}

export async function redeemBillingCouponForTenant(pool, {
  tenantKey,
  code,
  actorType = "tenant",
  actorId = null,
  source = "self_service"
}) {
  const normalizedCode = normalizeCouponCode(code);
  if (!tenantKey || !normalizedCode) {
    throw new Error("coupon_redemption_invalid");
  }

  const client = await pool.connect();
  let nextRedemption = null;
  let billingState = null;
  try {
    await client.query("BEGIN");

    billingState = await ensureTenantBillingAccount(client, tenantKey);
    if (!billingState) {
      throw new Error("tenant_not_found");
    }
    const billingConfig = await getSystemBillingConfig(client);
    const plan = buildPlanDisplay(billingState, billingConfig);
    if (plan.isCustom) {
      throw new Error("coupon_not_available_for_custom_plan");
    }

    const coupon = await loadCouponByCode(client, normalizedCode, { forUpdate: true });
    if (!coupon) {
      throw new Error("coupon_not_found");
    }
    if (deriveBillingCouponStatus(coupon) !== "active") {
      throw new Error("coupon_not_active");
    }
    if (!couponAllowsPlan(coupon, plan.basePlanCode)) {
      throw new Error("coupon_not_valid_for_plan");
    }

    const existingRedeemer = await client.query(
      `SELECT tenant_key
       FROM billing_coupon_redemptions
       WHERE billing_coupon_id = $1
       LIMIT 1`,
      [coupon.billing_coupon_id]
    );
    if (existingRedeemer.rowCount) {
      const existingTenantKey = normalizeText(existingRedeemer.rows[0]?.tenant_key);
      if (existingTenantKey === tenantKey) {
        throw new Error("coupon_already_active_for_tenant");
      }
      throw new Error("coupon_already_redeemed");
    }

    if (normalizeDayCount(coupon.free_trial_days) > 0 && billingState?.stripe_subscription_id) {
      throw new Error("coupon_free_trial_requires_no_active_subscription");
    }

    const previousRedemption = await loadTenantActiveCouponRedemptionRow(client, tenantKey, { forUpdate: true });
    if (previousRedemption) {
      await client.query(
        `UPDATE billing_coupon_redemptions
         SET status = 'revoked',
             updated_at = NOW()
         WHERE billing_coupon_redemption_id = $1`,
        [previousRedemption.billing_coupon_redemption_id]
      );
      const shouldRestorePreviousTrial = couponHasTrial(previousRedemption)
        && !billingState?.stripe_subscription_id
        && String(billingState?.billing_status || "").toLowerCase() === "trialing";
      if (shouldRestorePreviousTrial) {
        await restoreTenantTrialState(client, tenantKey, previousRedemption, billingState);
        billingState = await ensureTenantBillingAccount(client, tenantKey);
      }
    }

    const now = new Date();
    const freeTrialDays = normalizeDayCount(coupon.free_trial_days);
    const discountDurationDays = normalizeDayCount(coupon.discount_duration_days);
    const trialStartsAt = freeTrialDays > 0 ? now : null;
    let trialEndsAt = freeTrialDays > 0 ? addDays(now, freeTrialDays) : null;
    let discountStartsAt = null;
    if (billingState?.stripe_subscription_id && billingState?.current_period_end) {
      const nextPeriodStart = getFutureDate(billingState.current_period_end);
      if (nextPeriodStart) {
        discountStartsAt = nextPeriodStart;
      }
    }
    const discountEndsAt = discountStartsAt && discountDurationDays > 0
      ? addDays(discountStartsAt, discountDurationDays)
      : null;

    const metadataJson = buildRedemptionMetadata(billingState, {
      source,
      code: coupon.code
    });

    const inserted = await client.query(
      `INSERT INTO billing_coupon_redemptions (
         billing_coupon_id,
         tenant_key,
         status,
         redeemed_at,
         trial_starts_at,
         trial_ends_at,
         discount_starts_at,
         discount_ends_at,
         snapshot_plan_code,
         snapshot_monthly_discount_percent,
         snapshot_overage_discount_percent,
         snapshot_discount_duration_days,
         snapshot_free_trial_days,
         metadata_json,
         created_by_type,
         created_by_id,
         created_at,
         updated_at
       )
       VALUES ($1, $2, 'active', NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, NOW(), NOW())
       RETURNING billing_coupon_redemption_id`,
      [
        coupon.billing_coupon_id,
        tenantKey,
        isoDate(trialStartsAt),
        isoDate(trialEndsAt),
        isoDate(discountStartsAt),
        isoDate(discountEndsAt),
        plan.basePlanCode,
        parsePercent(coupon.monthly_discount_percent),
        parsePercent(coupon.overage_discount_percent),
        discountDurationDays,
        freeTrialDays,
        JSON.stringify(metadataJson),
        actorType,
        actorId ? String(actorId) : null
      ]
    );
    const redemptionId = Number(inserted.rows[0]?.billing_coupon_redemption_id || 0);

    if (freeTrialDays > 0 && trialEndsAt) {
      trialEndsAt = await applyCouponTrialState(client, tenantKey, billingState, trialEndsAt);
      await client.query(
        `UPDATE billing_coupon_redemptions
         SET trial_ends_at = $2,
             updated_at = NOW()
         WHERE billing_coupon_redemption_id = $1`,
        [redemptionId, trialEndsAt.toISOString()]
      );
    }

    await client.query(
      `UPDATE billing_coupons
       SET status = 'redeemed',
           updated_at = NOW()
       WHERE billing_coupon_id = $1`,
      [coupon.billing_coupon_id]
    );

    const updatedRedemption = await syncCouponRedemptionPointersAfterUpdate(client, tenantKey, redemptionId);

    await client.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, 'billing.coupon.redeemed', $3)`,
      [
        tenantKey,
        `${actorType}:${actorId || "system"}`,
        `coupon_code=${coupon.code} source=${source}`
      ]
    );

    await recordBillingLifecycleEvent(client, {
      tenantKey,
      eventType: "billing.coupon.redeemed",
      fromBillingStatus: billingState?.billing_status || null,
      toBillingStatus: freeTrialDays > 0 ? "trialing" : (billingState?.billing_status || null),
      fromServiceAccessStatus: billingState?.service_access_status || null,
      toServiceAccessStatus: freeTrialDays > 0 ? "enabled" : (billingState?.service_access_status || null),
      fromAppAccessStatus: billingState?.app_access_status || null,
      toAppAccessStatus: freeTrialDays > 0 ? "enabled" : (billingState?.app_access_status || null),
      reason: source,
      metadata: {
        couponCode: coupon.code,
        billingCouponRedemptionId: redemptionId
      },
      createdByType: actorType,
      createdById: actorId ? String(actorId) : null
    });

    await client.query("COMMIT");
    nextRedemption = updatedRedemption ? buildBillingCouponDisplay(updatedRedemption) : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    await syncTenantCouponSubscriptionPricing(pool, tenantKey);
  } catch (error) {
    console.error("coupon_subscription_sync_failed", {
      tenantKey,
      message: error?.message || "unknown"
    });
  }

  return nextRedemption;
}

export async function revokeTenantCouponRedemption(pool, {
  tenantKey,
  actorType = "admin",
  actorId = null,
  reason = "manual_revoke"
}) {
  const client = await pool.connect();
  let priorState = null;
  let revokedCoupon = null;
  try {
    await client.query("BEGIN");
    priorState = await getTenantBillingState(client, tenantKey);
    const redemption = await loadTenantActiveCouponRedemptionRow(client, tenantKey, { forUpdate: true });
    if (!redemption) {
      throw new Error("coupon_not_active_for_tenant");
    }

    await client.query(
      `UPDATE billing_coupon_redemptions
       SET status = 'revoked',
           updated_at = NOW()
       WHERE billing_coupon_redemption_id = $1`,
      [redemption.billing_coupon_redemption_id]
    );
    await updateTenantCouponPointers(client, tenantKey, null);

    const shouldRestoreTrial = couponHasTrial(redemption)
      && !priorState?.stripe_subscription_id
      && String(priorState?.billing_status || "").toLowerCase() === "trialing";
    if (shouldRestoreTrial) {
      await restoreTenantTrialState(client, tenantKey, redemption, priorState);
    }

    await client.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, 'billing.coupon.revoked', $3)`,
      [
        tenantKey,
        `${actorType}:${actorId || "system"}`,
        `coupon_code=${redemption.code} reason=${reason}`
      ]
    );

    await recordBillingLifecycleEvent(client, {
      tenantKey,
      eventType: "billing.coupon.revoked",
      fromBillingStatus: priorState?.billing_status || null,
      toBillingStatus: shouldRestoreTrial
        ? normalizeOptionalText(redemption?.metadata_json?.previousBillingStatus) || priorState?.billing_status || null
        : priorState?.billing_status || null,
      fromServiceAccessStatus: priorState?.service_access_status || null,
      toServiceAccessStatus: shouldRestoreTrial
        ? normalizeOptionalText(redemption?.metadata_json?.previousServiceAccessStatus) || priorState?.service_access_status || null
        : priorState?.service_access_status || null,
      fromAppAccessStatus: priorState?.app_access_status || null,
      toAppAccessStatus: shouldRestoreTrial
        ? normalizeOptionalText(redemption?.metadata_json?.previousAppAccessStatus) || priorState?.app_access_status || null
        : priorState?.app_access_status || null,
      reason,
      metadata: {
        couponCode: redemption.code,
        billingCouponRedemptionId: redemption.billing_coupon_redemption_id
      },
      createdByType: actorType,
      createdById: actorId ? String(actorId) : null
    });

    await client.query("COMMIT");
    revokedCoupon = redemption.code;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    await syncTenantCouponSubscriptionPricing(pool, tenantKey);
  } catch (error) {
    console.error("coupon_revoke_subscription_sync_failed", {
      tenantKey,
      couponCode: revokedCoupon,
      message: error?.message || "unknown"
    });
  }
  return getTenantActiveCouponRedemption(pool, tenantKey);
}

function shouldApplyMonthlyDiscountToNextCycle(redemption, billingState) {
  if (!redemption || !couponHasMonthlyDiscount(redemption)) return false;
  const nextPeriodStart = getFutureDate(billingState?.current_period_end) || new Date();
  const discountStartsAt = normalizeDate(redemption.discount_starts_at);
  const discountEndsAt = normalizeDate(redemption.discount_ends_at);
  if (discountStartsAt && discountStartsAt.getTime() > nextPeriodStart.getTime()) {
    return false;
  }
  if (discountEndsAt && discountEndsAt.getTime() <= nextPeriodStart.getTime()) {
    return false;
  }
  return true;
}

export async function syncTenantCouponSubscriptionPricing(pool, tenantKey) {
  if (!tenantKey) return null;
  await refreshTenantCouponState(pool, tenantKey);
  let billingState = await ensureTenantBillingAccount(pool, tenantKey);
  if (!billingState?.stripe_subscription_id && !billingState?.stripe_customer_id) {
    return billingState;
  }
  const subscription = await findActiveStripeSubscriptionForBillingState(billingState, tenantKey);
  if (!subscription) {
    return billingState;
  }
  const subscriptionItem = subscription?.items?.data?.[0] || null;
  if (!subscriptionItem?.id) {
    return billingState;
  }

  const billingConfig = await getSystemBillingConfig(pool);
  const plan = buildPlanDisplay(billingState, billingConfig);
  const resolvedSubscriptionPlan = resolveBillingPlanFromStripeSubscription(billingConfig.plans, subscription);
  const pendingPlanCode = normalizeText(billingState?.pending_plan_code).toLowerCase();
  const targetPlanCode = normalizeText(
    resolvedSubscriptionPlan.plan?.code
      || plan.basePlanCode
  ).toLowerCase();
  const shouldUseSubscriptionPlanPricing = Boolean(
    resolvedSubscriptionPlan.source === "price"
      || (resolvedSubscriptionPlan.plan && pendingPlanCode && resolvedSubscriptionPlan.plan.code === pendingPlanCode)
  );
  const activeCoupon = await getTenantActiveCouponRedemption(pool, tenantKey);
  const shouldDiscount = shouldApplyMonthlyDiscountToNextCycle(activeCoupon, billingState);
  const selectedPlan = billingConfig.plans.find((item) => normalizeText(item.code).toLowerCase() === targetPlanCode) || null;
  const baseMonthlyAmountCents = shouldUseSubscriptionPlanPricing && selectedPlan
    ? Number(selectedPlan.monthlyAmountCents || 0)
    : resolveEffectiveMonthlyAmount(billingState);
  const targetMonthlyAmountCents = shouldDiscount
    ? computeDiscountedAmountCents(baseMonthlyAmountCents, activeCoupon.monthlyDiscountPercent)
    : baseMonthlyAmountCents;
  const targetIsCustom = Boolean(plan.isCustom && !shouldUseSubscriptionPlanPricing);
  const standardPriceId = !targetIsCustom ? (selectedPlan?.stripePriceId || null) : null;
  const standardProductId = !targetIsCustom ? (selectedPlan?.stripeProductId || null) : null;
  const currentUnitAmount = Number(subscriptionItem.price?.unit_amount || 0);
  const currentPriceId = normalizeOptionalText(subscriptionItem.price?.id);
  const shouldUseCatalogPrice = Boolean(
    !shouldDiscount
      && !targetIsCustom
      && standardPriceId
      && (currentPriceId === standardPriceId || shouldUseSubscriptionPlanPricing)
  );

  if (shouldUseCatalogPrice && currentPriceId === standardPriceId) {
    return billingState;
  }
  if (!shouldUseCatalogPrice && currentUnitAmount === targetMonthlyAmountCents) {
    return billingState;
  }

  const updatedSubscription = await updateSubscriptionPrice({
    subscriptionId: subscription.id,
    subscriptionItemId: subscriptionItem.id,
    priceId: shouldUseCatalogPrice ? standardPriceId : null,
    unitAmount: targetMonthlyAmountCents,
    productId: shouldUseCatalogPrice
      ? standardProductId
      : (standardProductId || billingState.stripe_product_id || subscriptionItem.price?.product || null),
    productName: `${billingState.name || "EveryCall"} Subscription`,
      metadata: {
        tenant_key: tenantKey,
        plan_code: targetPlanCode || plan.basePlanCode,
        billing_coupon_code: activeCoupon?.code || "",
        billing_coupon_next_cycle_discount_percent: shouldDiscount ? String(activeCoupon.monthlyDiscountPercent) : "0"
      }
  });
  billingState = await syncTenantStripeSubscription(pool, tenantKey, billingState, updatedSubscription, "billing.coupon.subscription_sync");
  return billingState;
}
