import { ensureTables, getPool } from "../_lib/db.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const tenantKey = getTenantKey(req);

    if (req.method === "GET") {
      const row = await pool.query(
        `SELECT tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours
         FROM routing_rules
         WHERE tenant_key = $1`,
        [tenantKey]
      );
      return res.status(200).json({ routing: row.rows[0] || null });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const primaryQueue = String(body.primaryQueue || "Dispatch Team");
      const emergencyBehavior = String(body.emergencyBehavior || "Priority Queue");
      const afterHoursBehavior = String(body.afterHoursBehavior || "Collect details and dispatch callback");
      const businessHours = String(body.businessHours || "");

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

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "routing_error", message: err?.message || "unknown" });
  }
}
