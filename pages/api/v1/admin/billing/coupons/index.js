import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import { listBillingCoupons, saveBillingCoupon } from "../../../../_lib/billingCoupons.js";

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

    if (req.method === "GET") {
      const coupons = await listBillingCoupons(pool);
      return res.status(200).json({ ok: true, coupons });
    }

    if (req.method === "POST") {
      const payload = normalizeCouponPayload(typeof req.body === "object" && req.body ? req.body : {});
      const coupon = await saveBillingCoupon(pool, {
        ...payload,
        createdByAdminUserId: String(admin.id || "")
      });
      await pool.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES (NULL, $1, 'billing.coupon.created', $2)`,
        [`admin:${admin.id}`, `coupon_code=${coupon?.code || ""}`]
      );
      return res.status(200).json({ ok: true, coupon });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (error) {
    return res.status(500).json({ error: "admin_billing_coupons_error", message: error?.message || "unknown" });
  }
}
