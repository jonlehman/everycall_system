import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";
import { runBillingLifecycleJobs } from "../../_lib/billingLifecycle.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    if (req.method === "GET") {
      const tenantKey = String(req.query?.tenantKey || "").trim();
      const rows = await pool.query(
        `SELECT pj.id, pj.tenant_key, pj.stage, pj.status, pj.status_detail, pj.provider, pj.provider_reference,
                pj.error_code, pj.error_message, pj.attempted_at, pj.completed_at, pj.updated_at,
                tu.owner_name, tu.owner_email,
                t.telnyx_voice_status
         FROM provisioning_jobs pj
         LEFT JOIN LATERAL (
           SELECT name AS owner_name, email AS owner_email
           FROM tenant_users
           WHERE tenant_key = pj.tenant_key
             AND role = 'owner'
           ORDER BY id ASC
           LIMIT 1
         ) tu ON TRUE
         LEFT JOIN tenants t ON t.tenant_key = pj.tenant_key
         ${tenantKey ? "WHERE pj.tenant_key = $1" : ""}
         ORDER BY updated_at DESC
         LIMIT 50`,
        tenantKey ? [tenantKey] : []
      );
      const jobs = rows.rows.map((row) => {
        if (
          row.stage === "number_setup" &&
          row.status === "pending" &&
          !row.error_code &&
          !row.error_message &&
          row.telnyx_voice_status === "failed"
        ) {
          return {
            ...row,
            status_detail: row.status_detail || "Legacy provisioning record before detailed logging was added.",
            error_code: "legacy_missing_failure_detail",
            error_message: "This signup failed before detailed Telnyx error logging was deployed. Retry onboarding again to capture the actual provider error."
          };
        }
        return row;
      });
      return res.status(200).json({ jobs });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      if (body.action === "run_billing_lifecycle") {
        const result = await runBillingLifecycleJobs(pool);
        return res.status(200).json({ ok: true, result });
      }
      return res.status(400).json({ error: "unsupported_action" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "admin_jobs_error", message: err?.message || "unknown" });
  }
}
