import { ensureTables, getPool } from "../../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../../_lib/auth.js";
import { setManualCallBillingExclusion } from "../../../../../../_lib/callBilling.js";

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
    const callSid = String(req.query?.callSid || "").trim();
    const body = typeof req.body === "object" && req.body ? req.body : {};
    const billingPeriodId = Number(body.billingPeriodId || 0);
    const action = String(body.action || "").trim().toLowerCase();

    if (!tenantKey || !callSid || !billingPeriodId) {
      return res.status(400).json({ error: "missing_fields" });
    }
    if (!["exclude", "reinclude"].includes(action)) {
      return res.status(400).json({ error: "invalid_action" });
    }

    const currentBillingPeriod = await setManualCallBillingExclusion(pool, {
      tenantKey,
      callSid,
      billingPeriodId,
      exclude: action === "exclude",
      createdById: String(admin.id)
    });

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, 'billing.call_assignment.updated', $3)`,
      [
        tenantKey,
        `admin:${admin.id}`,
        `call_sid=${callSid} billing_period_id=${billingPeriodId} action=${action}`
      ]
    );

    return res.status(200).json({
      ok: true,
      tenantKey,
      callSid,
      currentBillingPeriod
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_tenant_billing_call_update_error", message: err?.message || "unknown" });
  }
}
