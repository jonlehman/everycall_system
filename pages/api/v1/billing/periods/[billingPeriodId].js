import { requireSession, resolveTenantKey } from "../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { getBillingPeriodDetail } from "../../../_lib/callBilling.js";
import { requireActiveTenantUser, requireTenantOwner } from "../../../_lib/billing.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
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
    const billingPeriodId = Number(req.query?.billingPeriodId || 0);

    if (!Number.isFinite(billingPeriodId) || billingPeriodId <= 0) {
      return res.status(400).json({ error: "invalid_billing_period_id" });
    }

    const detail = await getBillingPeriodDetail(pool, billingPeriodId, { callLimit: 250 });
    if (!detail || detail.tenantKey !== tenantKey) {
      return res.status(404).json({ error: "billing_period_not_found" });
    }

    return res.status(200).json({
      ok: true,
      billingPeriod: {
        ...detail,
        stripe: canViewStripeDetails
          ? detail.stripe
          : {
              subscriptionId: null,
              invoiceId: null,
              invoiceItemId: null,
              finalizedAt: detail?.stripe?.finalizedAt || null,
              invoicedAt: detail?.stripe?.invoicedAt || null
            }
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "billing_period_detail_error", message: err?.message || "unknown" });
  }
}
