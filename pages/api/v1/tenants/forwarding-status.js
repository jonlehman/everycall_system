import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

const ALLOWED_STATUSES = new Set(["not_started", "acknowledged", "configured"]);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed", message: "Method not allowed." });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "database_unavailable", message: "Database is unavailable." });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res, { role: "tenant" });
    if (!session) return;
    const tenantKey = String(session.tenant_key || "").trim();
    if (!tenantKey) {
      return res.status(400).json({ ok: false, error: "missing_tenant", message: "No tenant is associated with this session." });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const status = String(body.status || "").trim();
    if (!ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_status",
        message: "Status must be one of: not_started, acknowledged, configured."
      });
    }

    const updated = await pool.query(
      `UPDATE tenants
       SET forwarding_setup_status = $2,
           forwarding_acknowledged_at =
             CASE
               WHEN $2 IN ('acknowledged', 'configured')
                 THEN COALESCE(forwarding_acknowledged_at, NOW())
               ELSE forwarding_acknowledged_at
             END,
           forwarding_configured_at =
             CASE
               WHEN $2 = 'configured'
                 THEN COALESCE(forwarding_configured_at, NOW())
               ELSE forwarding_configured_at
             END,
           updated_at = NOW()
       WHERE tenant_key = $1
       RETURNING tenant_key, forwarding_setup_status, forwarding_acknowledged_at, forwarding_configured_at`,
      [tenantKey, status]
    );

    if (!updated.rowCount) {
      return res.status(404).json({ ok: false, error: "tenant_not_found", message: "Tenant not found." });
    }

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, 'tenant_user', 'onboarding.forwarding_status_updated', $2)`,
      [tenantKey, `status=${status}`]
    );

    return res.status(200).json({
      ok: true,
      tenantKey,
      forwarding: {
        status: updated.rows[0].forwarding_setup_status,
        acknowledgedAt: updated.rows[0].forwarding_acknowledged_at,
        configuredAt: updated.rows[0].forwarding_configured_at
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "forwarding_status_error",
      message: err?.message || "unknown"
    });
  }
}
