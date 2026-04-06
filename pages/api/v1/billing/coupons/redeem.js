import { requireSession, resolveTenantKey } from "../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { ensureTenantBillingAccount, requireTenantOwner } from "../../../_lib/billing.js";
import { getTenantActiveCouponRedemption, redeemBillingCouponForTenant } from "../../../_lib/billingCoupons.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

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

    const session = await requireSession(req, res);
    if (!session) return;
    const owner = await requireTenantOwner(session);
    if (!owner) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = resolveTenantKey(session, getTenantKey(req));
    const billingState = await ensureTenantBillingAccount(pool, tenantKey);
    if (!billingState) {
      return res.status(404).json({ error: "tenant_not_found" });
    }
    if (String(billingState.billing_status || "").toLowerCase() === "deactivated") {
      return res.status(400).json({ error: "account_deactivated", message: "Restart the account before applying a coupon." });
    }

    const code = String(req.body?.code || "").trim();
    if (!code) {
      return res.status(400).json({ error: "missing_coupon_code" });
    }

    const activeCoupon = await redeemBillingCouponForTenant(pool, {
      tenantKey,
      code,
      actorType: "tenant",
      actorId: String(session.user_id || ""),
      source: "billing_page"
    });

    return res.status(200).json({
      ok: true,
      activeCoupon: activeCoupon || await getTenantActiveCouponRedemption(pool, tenantKey),
      message: "Coupon applied."
    });
  } catch (error) {
    return res.status(400).json({ error: "billing_coupon_redeem_error", message: error?.message || "unknown" });
  }
}
