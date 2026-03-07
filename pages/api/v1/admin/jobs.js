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
      const rows = await pool.query(
        `SELECT id, tenant_key, stage, status, updated_at
         FROM provisioning_jobs
         ORDER BY updated_at DESC
         LIMIT 50`
      );
      return res.status(200).json({ jobs: rows.rows });
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
