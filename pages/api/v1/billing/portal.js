import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { ensureTenantBillingAccount, requireTenantOwner } from "../../_lib/billing.js";
import { createBillingPortalSession } from "../../_lib/stripe.js";

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
    const row = await ensureTenantBillingAccount(pool, tenantKey);
    if (!row) {
      return res.status(404).json({ error: "tenant_not_found" });
    }
    if (!row.stripe_customer_id) {
      return res.status(400).json({ error: "billing_customer_missing", message: "No Stripe customer exists for this tenant yet." });
    }

    const portal = await createBillingPortalSession({
      customerId: row.stripe_customer_id
    });

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, $3, $4)`,
      [tenantKey, `tenant:${session.user_id}`, "billing.portal.created", `portal_session=${portal.id}`]
    );

    return res.status(200).json({
      ok: true,
      portalUrl: portal.url
    });
  } catch (err) {
    return res.status(500).json({ error: "billing_portal_error", message: err?.message || "unknown" });
  }
}
