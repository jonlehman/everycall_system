import { readRawBody } from "../../_lib/telnyx.js";
import { constructWebhookEvent } from "../../_lib/stripe.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { recordBillingLifecycleEvent } from "../../_lib/billing.js";

export const config = {
  api: {
    bodyParser: false
  }
};

function mapSubscriptionStatus(subscriptionStatus, currentRow) {
  const currentBillingStatus = String(currentRow?.billing_status || "");
  const currentServiceAccessStatus = String(currentRow?.service_access_status || "enabled");
  const currentAppAccessStatus = String(currentRow?.app_access_status || "enabled");

  if (subscriptionStatus === "trialing") {
    return {
      billingStatus: currentBillingStatus === "trial_expired" ? "trial_expired" : "trialing",
      serviceAccessStatus: "enabled",
      appAccessStatus: currentBillingStatus === "trial_expired" ? "billing_locked" : "enabled"
    };
  }

  if (subscriptionStatus === "active") {
    return {
      billingStatus: "active",
      serviceAccessStatus: "enabled",
      appAccessStatus: "enabled"
    };
  }

  if (subscriptionStatus === "past_due") {
    return {
      billingStatus: "past_due",
      serviceAccessStatus: currentServiceAccessStatus || "enabled",
      appAccessStatus: currentAppAccessStatus || "enabled"
    };
  }

  if (subscriptionStatus === "unpaid") {
    return {
      billingStatus: "unpaid",
      serviceAccessStatus: "restricted",
      appAccessStatus: currentAppAccessStatus || "enabled"
    };
  }

  if (subscriptionStatus === "canceled" || subscriptionStatus === "incomplete_expired") {
    return {
      billingStatus: subscriptionStatus === "canceled" ? "canceled" : "incomplete_expired",
      serviceAccessStatus: "disabled",
      appAccessStatus: "billing_locked"
    };
  }

  if (subscriptionStatus === "incomplete") {
    return {
      billingStatus: "incomplete",
      serviceAccessStatus: "disabled",
      appAccessStatus: "billing_locked"
    };
  }

  return {
    billingStatus: currentBillingStatus || "trialing",
    serviceAccessStatus: currentServiceAccessStatus,
    appAccessStatus: currentAppAccessStatus
  };
}

async function getTenantBillingRow(pool, { tenantKey, customerId, subscriptionId }) {
  if (tenantKey) {
    const byTenant = await pool.query(
      `SELECT t.tenant_key, t.billing_status, t.service_access_status, t.app_access_status
       FROM tenants t
       WHERE t.tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    if (byTenant.rowCount) return byTenant.rows[0];
  }

  if (subscriptionId) {
    const bySub = await pool.query(
      `SELECT t.tenant_key, t.billing_status, t.service_access_status, t.app_access_status
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
      `SELECT t.tenant_key, t.billing_status, t.service_access_status, t.app_access_status
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

async function upsertBillingAccountFromSubscription(pool, tenantKey, subscription) {
  const item = subscription?.items?.data?.[0] || {};
  await pool.query(
    `INSERT INTO tenant_billing_accounts (
       tenant_key,
       stripe_customer_id,
       stripe_subscription_id,
       stripe_product_id,
       stripe_price_id,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       canceled_at,
       trial_end,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7), $8, $9, $10, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_product_id = EXCLUDED.stripe_product_id,
       stripe_price_id = EXCLUDED.stripe_price_id,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       canceled_at = EXCLUDED.canceled_at,
       trial_end = EXCLUDED.trial_end,
       updated_at = NOW()`,
    [
      tenantKey,
      subscription.customer ? String(subscription.customer) : null,
      subscription.id || null,
      item.price?.product ? String(item.price.product) : null,
      item.price?.id || null,
      subscription.current_period_start || null,
      subscription.current_period_end || null,
      Boolean(subscription.cancel_at_period_end),
      subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null
    ]
  );
}

async function applySubscriptionState(pool, tenantRow, subscription, eventType) {
  const mapped = mapSubscriptionStatus(subscription.status, tenantRow);
  await upsertBillingAccountFromSubscription(pool, tenantRow.tenant_key, subscription);
  await pool.query(
    `UPDATE tenants
     SET billing_status = $2,
         service_access_status = $3,
         app_access_status = $4,
         billing_status_updated_at = NOW()
     WHERE tenant_key = $1`,
    [
      tenantRow.tenant_key,
      mapped.billingStatus,
      mapped.serviceAccessStatus,
      mapped.appAccessStatus
    ]
  );

  if (
    tenantRow.billing_status !== mapped.billingStatus ||
    tenantRow.service_access_status !== mapped.serviceAccessStatus ||
    tenantRow.app_access_status !== mapped.appAccessStatus
  ) {
    await recordBillingLifecycleEvent(pool, {
      tenantKey: tenantRow.tenant_key,
      eventType,
      fromBillingStatus: tenantRow.billing_status,
      toBillingStatus: mapped.billingStatus,
      fromServiceAccessStatus: tenantRow.service_access_status,
      toServiceAccessStatus: mapped.serviceAccessStatus,
      fromAppAccessStatus: tenantRow.app_access_status,
      toAppAccessStatus: mapped.appAccessStatus,
      reason: `stripe_subscription_${subscription.status}`,
      metadata: {
        stripeSubscriptionId: subscription.id
      },
      createdByType: "stripe_webhook",
      createdById: subscription.id
    });
  }
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
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const tenantRow = await getTenantBillingRow(pool, {
        tenantKey: metadataTenantKey,
        customerId: object.customer ? String(object.customer) : null,
        subscriptionId: object.id || null
      });
      if (tenantRow) {
        await applySubscriptionState(pool, tenantRow, object, event.type);
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
