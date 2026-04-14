import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

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
    const reviewed = Boolean(body.reviewed);

    const updated = await pool.query(
      `UPDATE tenants
       SET receptionist_basics_reviewed_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE tenant_key = $1
       RETURNING tenant_key, receptionist_basics_reviewed_at`,
      [tenantKey, reviewed]
    );

    if (!updated.rowCount) {
      return res.status(404).json({ ok: false, error: "tenant_not_found", message: "Tenant not found." });
    }

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, 'tenant_user', 'onboarding.receptionist_basics_review_status_updated', $2)`,
      [tenantKey, `reviewed=${reviewed}`]
    );

    return res.status(200).json({
      ok: true,
      tenantKey,
      review: {
        reviewed,
        reviewedAt: updated.rows[0].receptionist_basics_reviewed_at
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "receptionist_basics_review_status_error",
      message: err?.message || "unknown"
    });
  }
}
