import { applySalesPaidCheckout } from "../../_lib/salesCheckout.js";
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

async function boundedProviderRead(operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("stripe_provider_timeout")), 10000); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function hydrateSubscriptionSchedule(subscription) {
  const ref = subscription?.schedule;
  const scheduleId = typeof ref === "string" ? ref : ref?.id;
  if (scheduleId && !ref?.phases) {
    // The general sync helper tolerates a failed schedule read. Webhooks must
    // retry that failure instead of committing an incomplete processed event.
    return { ...subscription, schedule: await boundedProviderRead(() => retrieveSubscriptionSchedule(scheduleId)) };
  }
  return subscription;
}

async function decrementOverrideCyclesIfNeeded(pool, tenantKey, invoiceId) {
  if (!invoiceId) throw new Error("paid_invoice_id_missing");
  const effect = await pool.query(
    `INSERT INTO billing_invoice_effects (invoice_id, tenant_key) VALUES ($1, $2)
     ON CONFLICT (invoice_id) DO NOTHING RETURNING invoice_id`, [invoiceId, tenantKey]
  );
  if (!effect.rowCount) return;
  await pool.query(
    `UPDATE tenant_billing_accounts
     SET price_override_cycles_remaining = GREATEST(price_override_cycles_remaining - 1, 0), updated_at = NOW()
     WHERE tenant_key = $1 AND price_override_cycles_remaining > 0`, [tenantKey]
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const database = getPool();
  let pool = database;
  let client = null;
  let event = null;
  let ownsLock = false;
  let verified = false;
  if (!pool) {
    return res.status(500).json({ error: "database_unavailable" });
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = String(req.headers["stripe-signature"] || "");
    event = constructWebhookEvent(rawBody, signature);
    verified = true;
    await ensureTables(pool);

    // Persist a retryable identity, then serialize every effect and the final
    // marker in one transaction. A crash rolls back all local effects.
    client = await database.connect();
    pool = client;
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query(
      `INSERT INTO billing_events (tenant_key, stripe_event_id, event_type, payload_json, processed_at, status)
       VALUES (NULL, $1, $2, $3::jsonb, NULL, 'pending')
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(event)]
    );
    await client.query("COMMIT");
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL statement_timeout = '25s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
    const existing = await client.query(
      `SELECT status FROM billing_events WHERE stripe_event_id = $1 FOR UPDATE NOWAIT`, [event.id]
    );
    ownsLock = true;
    if (existing.rows[0]?.status === 'processed') {
      await client.query("COMMIT");
      return res.status(200).json({ ok: true, duplicate: true });
    }
    await client.query(
      `UPDATE billing_events SET status = 'processing', error_message = NULL WHERE stripe_event_id = $1`, [event.id]
    );

    const object = event.data?.object || {};
    const metadataTenantKey = String(object.metadata?.tenant_key || object.subscription_details?.metadata?.tenant_key || "").trim() || null;

    await applySalesPaidCheckout(pool,event);
    if (event.type === "checkout.session.completed" && !object.metadata?.sales_checkout_id) {
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
          const subscription = await hydrateSubscriptionSchedule(await boundedProviderRead(() => retrieveSubscription(String(object.subscription))));
          await syncTenantStripeSubscription(pool, tenantRow.tenant_key, tenantRow, subscription, event.type);
          if (String(subscription?.status || "").trim().toLowerCase() !== "trialing") {
            await activatePendingCouponDiscountWindow(pool, tenantRow.tenant_key, { subscription });
          }
        }
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const canonicalSubscription = await hydrateSubscriptionSchedule(
        object.id && event.type !== "customer.subscription.deleted"
          ? await boundedProviderRead(() => retrieveSubscription(String(object.id)))
          : object
      );
      const tenantRow = await getTenantBillingRow(pool, {
        tenantKey: metadataTenantKey || String(canonicalSubscription.metadata?.tenant_key || "").trim() || null,
        customerId: canonicalSubscription.customer ? String(canonicalSubscription.customer) : null,
        subscriptionId: canonicalSubscription.id || null
      });
      if (tenantRow) {
        await syncTenantStripeSubscription(pool, tenantRow.tenant_key, tenantRow, canonicalSubscription, event.type);
        if (String(canonicalSubscription?.status || "").trim().toLowerCase() !== "trialing") {
          await activatePendingCouponDiscountWindow(pool, tenantRow.tenant_key, { subscription: canonicalSubscription });
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
        ? await boundedProviderRead(() => retrieveSubscriptionSchedule(String(object.id)))
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
          await decrementOverrideCyclesIfNeeded(pool, tenantRow.tenant_key, object.id);
        }
      }
    }

    await client.query(
      `UPDATE billing_events SET status = 'processed', processed_at = NOW(), error_message = NULL
       WHERE stripe_event_id = $1`, [event.id]
    );
    await client.query("COMMIT");
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK").catch(() => null);
      if (ownsLock && event?.id) {
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL lock_timeout = '1s'");
          await client.query("SET LOCAL statement_timeout = '5s'");
          await client.query(
            `UPDATE billing_events SET status = 'failed', processed_at = NULL, error_message = $2
             WHERE stripe_event_id = $1 AND status <> 'processed'`,
            [event.id, String(err?.message || "unknown").slice(0, 1000)]
          );
          await client.query("COMMIT");
        } catch {
          await client.query("ROLLBACK").catch(() => null);
        }
      }
    }
    if (verified) res.setHeader("Retry-After", "10");
    return res.status(verified ? 503 : 400).json({ error: "stripe_webhook_error" });
  } finally {
    if (client) client.release();
  }
}
