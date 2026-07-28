import { ensureTables, getPool } from "../../../../_lib/db.js";
import { processSalesDemoJobs } from "../../../../_lib/salesRepository.js";
import { processSalesFollowupJobs } from "../../../../_lib/salesFollowupJobs.js";
import {
  requireSalesInternalSecret,
  sendSalesApiError
} from "../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    if (!requireSalesInternalSecret(req, res)) return;
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "database_unavailable" });
    }
    await ensureTables(pool);
    const workerId = `api:${process.env.VERCEL_REGION || "local"}:${process.pid}`;
    const demoJobs = await processSalesDemoJobs(pool, {
      workerId,
      limit: req.method === "POST" ? req.body?.limit : req.query?.limit
    });
    const followupJobs = await processSalesFollowupJobs(pool, {
      workerId,
      limit: req.method === "POST" ? req.body?.followupLimit : req.query?.followupLimit
    });
    return res.status(200).json({ ok: true, demoJobs, followupJobs });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_demo_jobs_failed");
  }
}
