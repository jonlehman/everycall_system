import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { buildPlanDisplay, ensureTenantBillingAccount, requireTenantOwner, resolveEffectiveMonthlyAmount } from "../../_lib/billing.js";
import { createCheckoutSession, findOrCreateCustomer } from "../../_lib/stripe.js";

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

    const customer = await findOrCreateCustomer({
      tenantKey,
      stripeCustomerId: row.stripe_customer_id,
      email: owner.email || row.owner_email || undefined,
      name: owner.name || row.owner_name || row.name,
      phone: owner.phone_number || undefined,
      metadata: {
        tenant_key: tenantKey,
        tenant_name: row.name || ""
      }
    });

    await pool.query(
      `INSERT INTO tenant_billing_accounts (tenant_key, stripe_customer_id, monthly_amount_cents, stripe_product_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_key)
       DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id,
                     updated_at = NOW()`,
      [tenantKey, customer.id, Number(row.monthly_amount_cents || resolveEffectiveMonthlyAmount(row)), row.stripe_product_id || null]
    );

    const trialEnd = row.billing_status === "trialing" && row.trial_end && new Date(row.trial_end).getTime() > Date.now()
      ? row.trial_end
      : null;

    const sessionData = await createCheckoutSession({
      customerId: customer.id,
      customerEmail: customer.email || owner.email || row.owner_email || undefined,
      unitAmount: resolveEffectiveMonthlyAmount(row),
      productId: row.stripe_product_id || null,
      productName: `${row.name || "EveryCall"} Subscription`,
      trialEnd,
      tenantKey,
      planCode: buildPlanDisplay(row).code,
      metadata: {
        tenant_key: tenantKey,
        actor_user_id: String(session.user_id || "")
      }
    });

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, $3, $4)`,
      [tenantKey, `tenant:${session.user_id}`, "billing.checkout.created", `checkout_session=${sessionData.id}`]
    );

    return res.status(200).json({
      ok: true,
      checkoutUrl: sessionData.url,
      checkoutSessionId: sessionData.id
    });
  } catch (err) {
    return res.status(500).json({ error: "billing_checkout_error", message: err?.message || "unknown" });
  }
}
