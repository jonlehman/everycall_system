import { ensureTables, getPool } from "../../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../../_lib/auth.js";
import { getTenantActiveCouponRedemption, revokeTenantCouponRedemption } from "../../../../../../_lib/billingCoupons.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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
    if (!admin || admin.role !== "super-admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = String(req.query?.tenantKey || "").trim();
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    await revokeTenantCouponRedemption(pool, {
      tenantKey,
      actorType: "admin",
      actorId: String(admin.id || ""),
      reason: "admin_manual"
    });

    return res.status(200).json({
      ok: true,
      activeCoupon: await getTenantActiveCouponRedemption(pool, tenantKey),
      message: "Coupon revoked."
    });
  } catch (error) {
    return res.status(400).json({ error: "admin_tenant_coupon_revoke_error", message: error?.message || "unknown" });
  }
}
