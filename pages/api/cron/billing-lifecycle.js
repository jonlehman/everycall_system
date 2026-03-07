import { ensureTables, getPool } from "../_lib/db.js";
import { runBillingLifecycleJobs } from "../_lib/billingLifecycle.js";

function isAuthorized(req) {
  const configured = String(process.env.CRON_SECRET || "").trim();
  if (!configured) return false;
  const bearer = String(req.headers.authorization || "");
  if (bearer === `Bearer ${configured}`) return true;
  const header = String(req.headers["x-cron-secret"] || "");
  if (header === configured) return true;
  const query = String(req.query?.token || "");
  return query === configured;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);
    const result = await runBillingLifecycleJobs(pool);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ error: "billing_lifecycle_cron_error", message: err?.message || "unknown" });
  }
}
