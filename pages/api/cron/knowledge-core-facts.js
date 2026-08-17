import { ensureTables, getPool } from "../_lib/db.js";
import { runCoreFactRefinementJobs } from "../_lib/knowledgeCoreFacts.js";

function isAuthorized(req) {
  const configured = String(process.env.CRON_SECRET || "").trim();
  if (!configured) return false;
  const bearer = String(req.headers.authorization || "");
  if (bearer === `Bearer ${configured}`) return true;
  return String(req.headers["x-cron-secret"] || "") === configured;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!isAuthorized(req)) return res.status(401).json({ error: "unauthorized" });

  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "database_unavailable" });
    await ensureTables(pool);
    const result = await runCoreFactRefinementJobs(pool, { maxTenants: 1 });
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      error: "knowledge_core_facts_cron_error",
      message: error?.message || "unknown"
    });
  }
}
