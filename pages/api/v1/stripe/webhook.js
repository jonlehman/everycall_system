import { readRawBody } from "../../_lib/telnyx.js";
import { constructWebhookEvent, retrieveSubscription, retrieveSubscriptionSchedule } from "../../_lib/stripe.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { syncTenantStripeSubscription, syncTenantStripeSubscriptionSchedule } from "../../_lib/billing.js";
import { activatePendingCouponDiscountWindow } from "../../_lib/billingCoupons.js";

export const config = {
  api: {
    bodyParser: false
  }
};

async function getTenantBillingRow(pool, { tenantKey, customerId, subscriptionId }) {
  if (tenantKey) {
    const byTenant = await pool.query(
      `SELECT
         t.tenant_key,
         t.plan_code,
         t.billing_status,
         t.service_access_status,
         t.app_access_status,
         t.billing_lock_reason,
         b.billing_interval,
         b.pending_plan_code,
         b.current_period_start,
         b.current_period_end
       FROM tenants t
       LEFT JOIN tenant_billing_accounts b ON b.tenant_key = t.tenant_key
       WHERE t.tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    if (byTenant.rowCount) return byTenant.rows[0];
  }

  if (subscriptionId) {
    const bySub = await pool.query(
      `SELECT
         t.tenant_key,
         t.plan_code,
         t.billing_status,
         t.service_access_status,
         t.app_access_status,
         t.billing_lock_reason,
         b.billing_interval,
         b.pending_plan_code,
         b.current_period_start,
         b.current_period_end
       FROM tenant_billing_accounts b
       JOIN tenants t ON t.tenant_key = b.tenant_key
       WHERE b.stripe_subscription_id = $1
       LIMIT 1`,
      [subscriptionId]
    );
    if (bySub.rowCount) return bySub.rows[0];
  }

  if (customerId) {
    const byCustomer = await pool.query(
      `SELECT
         t.tenant_key,
         t.plan_code,
         t.billing_status,
         t.service_access_status,
         t.app_access_status,
         t.billing_lock_reason,
         b.billing_interval,
         b.pending_plan_code,
         b.current_period_start,
         b.current_period_end
       FROM tenant_billing_accounts b
       JOIN tenants t ON t.tenant_key = b.tenant_key
       WHERE b.stripe_customer_id = $1
       LIMIT 1`,
      [customerId]
    );
    if (byCustomer.rowCount) return byCustomer.rows[0];
  }

  return null;
}

async function decrementOverrideCyclesIfNeeded(pool, tenantKey) {
  const row = await pool.query(
    `SELECT price_override_cycles_remaining
     FROM tenant_billing_accounts
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const cycles = Number(row.rows[0]?.price_override_cycles_remaining ?? -1);
  if (cycles <= 0) return;
  await pool.query(
    `UPDATE tenant_billing_accounts
     SET price_override_cycles_remaining = GREATEST(price_override_cycles_remaining - 1, 0),
         updated_at = NOW()
     WHERE tenant_key = $1`,
    [tenantKey]
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const pool = getPool();
  if (!pool) {
    return res.status(500).json({ error: "database_unavailable" });
  }

  await ensureTables(pool);

  try {
    const rawBody = await readRawBody(req);
    const signature = String(req.headers["stripe-signature"] || "");
    const event = constructWebhookEvent(rawBody, signature);

    const existing = await pool.query(
      `SELECT id FROM billing_events WHERE stripe_event_id = $1 LIMIT 1`,
      [event.id]
    );
    if (existing.rowCount) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    await pool.query(
      `INSERT INTO billing_events (tenant_key, stripe_event_id, event_type, payload_json, processed_at, status)
       VALUES ($1, $2, $3, $4::jsonb, NOW(), 'processed')`,
      [null, event.id, event.type, JSON.stringify(event)]
    );

    const object = event.data?.object || {};
    const metadataTenantKey = String(object.metadata?.tenant_key || object.subscription_details?.metadata?.tenant_key || "").trim() || null;

    if (event.type === "checkout.session.completed") {
      const tenantRow = await getTenantBillingRow(pool, {
        tenantKey: metadataTenantKey,
        customerId: object.customer ? String(object.customer) : null,
        subscriptionId: object.subscription ? String(object.subscription) : null
      });
      if (tenantRow) {
        await pool.query(
          `INSERT INTO tenant_billing_accounts (tenant_key, stripe_customer_id, stripe_subscription_id, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (tenant_key)
           DO UPDATE SET
             stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, tenant_billing_accounts.stripe_customer_id),
             stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, tenant_billing_accounts.stripe_subscription_id),
             updated_at = NOW()`,
          [
            tenantRow.tenant_key,
            object.customer ? String(object.customer) : null,
            object.subscription ? String(object.subscription) : null
          ]
        );
        if (object.subscription) {
          const subscription = await retrieveSubscription(String(object.subscription));
          await syncTenantStripeSubscription(pool, tenantRow.tenant_key, tenantRow, subscription, event.type);
          if (String(subscription?.status || "").trim().toLowerCase() !== "trialing") {
            await activatePendingCouponDiscountWindow(pool, tenantRow.tenant_key, { subscription }).catch(() => null);
          }
        }
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const canonicalSubscription = object.id
        ? await retrieveSubscription(String(object.id)).catch(() => object)
        : object;
      const tenantRow = await getTenantBillingRow(pool, {
        tenantKey: metadataTenantKey || String(canonicalSubscription.metadata?.tenant_key || "").trim() || null,
        customerId: canonicalSubscription.customer ? String(canonicalSubscription.customer) : null,
        subscriptionId: canonicalSubscription.id || null
      });
      if (tenantRow) {
        await syncTenantStripeSubscription(pool, tenantRow.tenant_key, tenantRow, canonicalSubscription, event.type);
        if (String(canonicalSubscription?.status || "").trim().toLowerCase() !== "trialing") {
          await activatePendingCouponDiscountWindow(pool, tenantRow.tenant_key, { subscription: canonicalSubscription }).catch(() => null);
        }
      }
    }

    if (
      event.type === "subscription_schedule.created" ||
      event.type === "subscription_schedule.updated" ||
      event.type === "subscription_schedule.released" ||
      event.type === "subscription_schedule.completed" ||
      event.type === "subscription_schedule.canceled"
    ) {
      const canonicalSchedule = object.id
        ? await retrieveSubscriptionSchedule(String(object.id)).catch(() => object)
        : object;
      const scheduleSubscriptionId = canonicalSchedule.subscription
        ? String(canonicalSchedule.subscription)
        : (canonicalSchedule.released_subscription ? String(canonicalSchedule.released_subscription) : null);
      const tenantRow = await getTenantBillingRow(pool, {
        tenantKey: metadataTenantKey || String(canonicalSchedule.metadata?.tenant_key || "").trim() || null,
        customerId: canonicalSchedule.customer ? String(canonicalSchedule.customer) : null,
        subscriptionId: scheduleSubscriptionId
      });
      if (tenantRow) {
        await syncTenantStripeSubscriptionSchedule(pool, tenantRow.tenant_key, tenantRow, canonicalSchedule, event.type);
      }
    }

    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_failed" ||
      event.type === "invoice.payment_action_required"
    ) {
      const subscriptionId = object.subscription ? String(object.subscription) : null;
      const customerId = object.customer ? String(object.customer) : null;
      const tenantRow = await getTenantBillingRow(pool, {
        tenantKey: metadataTenantKey,
        customerId,
        subscriptionId
      });
      if (tenantRow) {
        await pool.query(
          `UPDATE tenant_billing_accounts
           SET last_invoice_id = $2,
               updated_at = NOW()
           WHERE tenant_key = $1`,
          [tenantRow.tenant_key, object.id || null]
        );
        if (event.type === "invoice.paid") {
          await decrementOverrideCyclesIfNeeded(pool, tenantRow.tenant_key);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    const poolError = getPool();
    if (poolError && req.method === "POST") {
      try {
        await poolError.query(
          `INSERT INTO billing_events (tenant_key, stripe_event_id, event_type, payload_json, processed_at, status, error_message)
           VALUES ($1, $2, $3, $4::jsonb, NOW(), 'failed', $5)`,
          [null, `failed_${Date.now()}`, "webhook_error", JSON.stringify({}), err?.message || "unknown"]
        );
      } catch {}
    }
    return res.status(400).json({ error: "stripe_webhook_error", message: err?.message || "unknown" });
  }
}
