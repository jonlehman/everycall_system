import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import { getBillingCouponById, saveBillingCoupon } from "../../../../_lib/billingCoupons.js";

function normalizeCouponPayload(body = {}) {
  return {
    code: body.code,
    status: body.status,
    monthlyDiscountPercent: body.monthlyDiscountPercent,
    overageDiscountPercent: body.overageDiscountPercent,
    discountDurationDays: body.discountDurationDays,
    freeTrialDays: body.freeTrialDays,
    redeemBy: body.redeemBy || null,
    notes: body.notes || null,
    planScopes: body.planScopes
  };
}

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
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

    const couponId = Number(req.query?.couponId || 0);
    if (!Number.isFinite(couponId) || couponId <= 0) {
      return res.status(400).json({ error: "invalid_coupon_id" });
    }

    const existing = await getBillingCouponById(pool, couponId);
    if (!existing) {
      return res.status(404).json({ error: "coupon_not_found" });
    }

    const payload = normalizeCouponPayload(typeof req.body === "object" && req.body ? req.body : {});
    const coupon = await saveBillingCoupon(pool, {
      billingCouponId: couponId,
      ...payload
    });
    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES (NULL, $1, 'billing.coupon.updated', $2)`,
      [`admin:${admin.id}`, `coupon_code=${coupon?.code || existing.code}`]
    );
    return res.status(200).json({ ok: true, coupon });
  } catch (error) {
    return res.status(500).json({ error: "admin_billing_coupon_update_error", message: error?.message || "unknown" });
  }
}
