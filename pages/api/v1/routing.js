import { ensureTables, getPool } from "../_lib/db.js";
import { requireSession, resolveTenantKey } from "../_lib/auth.js";
import { requireTenantBillingAccess } from "../_lib/billing.js";
import { loadTenantBusinessHours, saveTenantBusinessHours } from "../_lib/tenantBusinessHours.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

export default async function handler(req, res) {
  const fail = (status, error, message) => res.status(status).json({ ok: false, error, message });

  try {
    const pool = getPool();
    if (!pool) {
      return fail(500, "database_unavailable", "Database is unavailable.");
    }

    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, getTenantKey(req));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    if (req.method === "GET") {
      const row = await pool.query(
        `SELECT tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours
         FROM routing_rules
         WHERE tenant_key = $1`,
        [tenantKey]
      );
      const routing = row.rows[0] || null;
      const businessHoursConfig = await loadTenantBusinessHours(pool, tenantKey, {
        legacyBusinessHours: routing?.business_hours || ""
      });
      return res.status(200).json({
        ok: true,
        routing: routing
          ? {
            ...routing,
            business_hours: businessHoursConfig.displayText || routing.business_hours,
            business_hours_config: businessHoursConfig
          }
          : {
            tenant_key: tenantKey,
            primary_queue: "Dispatch Team",
            emergency_behavior: "Immediate Transfer",
            after_hours_behavior: "Collect details and dispatch callback",
            business_hours: businessHoursConfig.displayText,
            business_hours_config: businessHoursConfig
          }
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const primaryQueue = String(body.primaryQueue || "Dispatch Team");
      const emergencyBehavior = String(body.emergencyBehavior || "Immediate Transfer");
      const afterHoursBehavior = String(body.afterHoursBehavior || "Collect details and dispatch callback");
      const businessHoursConfig = body.businessHoursConfig && typeof body.businessHoursConfig === "object"
        ? body.businessHoursConfig
        : null;
      const businessHours = String(
        businessHoursConfig?.displayText
        || body.businessHours
        || ""
      );
      if (!primaryQueue.trim() || !emergencyBehavior.trim() || !afterHoursBehavior.trim()) {
        return fail(400, "missing_fields", "All routing fields are required.");
      }

      await pool.query(
        `INSERT INTO routing_rules (tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_key)
         DO UPDATE SET primary_queue = EXCLUDED.primary_queue,
                       emergency_behavior = EXCLUDED.emergency_behavior,
                       after_hours_behavior = EXCLUDED.after_hours_behavior,
                       business_hours = EXCLUDED.business_hours,
                       updated_at = NOW()`,
        [tenantKey, primaryQueue, emergencyBehavior, afterHoursBehavior, businessHours]
      );

      const savedBusinessHours = await saveTenantBusinessHours(
        pool,
        tenantKey,
        businessHoursConfig || { businessHours },
        { syncRoutingDisplayText: true }
      );

      return res.status(200).json({ ok: true, businessHoursConfig: savedBusinessHours });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    return fail(500, "routing_error", err?.message || "unknown");
  }
}
