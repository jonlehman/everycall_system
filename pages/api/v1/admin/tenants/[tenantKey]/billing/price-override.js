import { ensureTables, getPool } from "../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../_lib/auth.js";
import { recordBillingLifecycleEvent } from "../../../../../_lib/billing.js";

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
    const body = typeof req.body === "object" && req.body ? req.body : {};
    const amountCents = body.clear === true ? null : Number(body.monthlyAmountOverrideCents || 0);
    const cyclesRemaining = body.clear === true ? null : Number(body.cyclesUntilRevert ?? 0);
    const reason = String(body.reason || "").trim() || null;

    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }
    if (body.clear !== true) {
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: "invalid_amount" });
      }
      if (!Number.isInteger(cyclesRemaining) || cyclesRemaining < 0) {
        return res.status(400).json({ error: "invalid_cycles" });
      }
    }

    await pool.query(
      `INSERT INTO tenant_billing_accounts (
         tenant_key,
         monthly_amount_override_cents,
         price_override_cycles_remaining,
         price_override_reason,
         updated_at
       )
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_key)
       DO UPDATE SET
         monthly_amount_override_cents = $2,
         price_override_cycles_remaining = $3,
         price_override_reason = $4,
         updated_at = NOW()`,
      [tenantKey, amountCents, cyclesRemaining, reason]
    );

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, 'billing.price_override.updated', $3)`,
      [
        tenantKey,
        `admin:${admin.id}`,
        body.clear === true
          ? "cleared"
          : `amount_cents=${amountCents} cycles=${cyclesRemaining} reason=${reason || ""}`
      ]
    );

    await recordBillingLifecycleEvent(pool, {
      tenantKey,
      eventType: "billing.price_override.updated",
      reason: body.clear === true ? "override_cleared" : "override_updated",
      metadata: {
        amountCents,
        cyclesRemaining,
        reason,
        cleared: body.clear === true
      },
      createdByType: "admin",
      createdById: String(admin.id)
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "admin_price_override_error", message: err?.message || "unknown" });
  }
}
