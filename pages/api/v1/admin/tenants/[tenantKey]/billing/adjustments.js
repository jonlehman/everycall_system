import { ensureTables, getPool } from "../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../_lib/auth.js";
import { createBillingPeriodAdjustment } from "../../../../../_lib/callBilling.js";

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
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = String(req.query?.tenantKey || "").trim();
    const body = typeof req.body === "object" && req.body ? req.body : {};
    const billingPeriodId = Number(body.billingPeriodId || 0);
    const adjustmentType = String(body.adjustmentType || "").trim().toLowerCase();
    const description = String(body.description || "").trim();
    const amountCents = Number(body.amountCents || 0);

    if (!tenantKey || !billingPeriodId) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const currentBillingPeriod = await createBillingPeriodAdjustment(pool, {
      tenantKey,
      billingPeriodId,
      adjustmentType,
      description,
      amountCents,
      createdByType: "admin",
      createdById: String(admin.id)
    });

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, 'billing.adjustment.created', $3)`,
      [
        tenantKey,
        `admin:${admin.id}`,
        `billing_period_id=${billingPeriodId} type=${adjustmentType} amount_cents=${amountCents} description=${description}`
      ]
    );

    return res.status(200).json({
      ok: true,
      tenantKey,
      currentBillingPeriod
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_tenant_billing_adjustment_error", message: err?.message || "unknown" });
  }
}
