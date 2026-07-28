import { ensureTables, getPool } from "../_lib/db.js";
import { processSalesFollowupJobs } from "../_lib/salesFollowupJobs.js";
import { processSalesDemoJobs } from "../_lib/salesRepository.js";

export const config = {
  maxDuration: 300
};

function isAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  return Boolean(secret) && String(req.headers.authorization || "") === `Bearer ${secret}`;
}

function salesOutboundEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.SALES_OUTBOUND_ENABLED || "").trim().toLowerCase()
  );
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  if (!salesOutboundEnabled()) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: "sales_outbound_disabled"
    });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "database_unavailable" });
    }
    await ensureTables(pool);
    const workerId = `sales-cron:${process.env.VERCEL_REGION || "local"}:${process.pid}`;
    const [demoJobs, followupJobs] = await Promise.all([
      processSalesDemoJobs(pool, { workerId, limit: 2 }),
      processSalesFollowupJobs(pool, { workerId, limit: 5 })
    ]);
    return res.status(200).json({ ok: true, demoJobs, followupJobs });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "sales_maintenance_failed",
      message: String(error?.message || "unknown").slice(0, 500)
    });
  }
}
