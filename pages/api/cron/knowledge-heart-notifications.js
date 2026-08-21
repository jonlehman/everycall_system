import { getPool } from "../_lib/db.js";
import { processKnowledgeHeartFlagEmails } from "../_lib/knowledgeHeartNotifications.js";
import { purgeExpiredKnowledgeHeartAudio } from "../_lib/knowledgeHeartAudio.js";

function authorized(req) {
  const expected = String(process.env.CRON_SECRET || "").trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  const authorization = String(req.headers.authorization || "").trim();
  const header = String(req.headers["x-cron-secret"] || "").trim();
  return authorization === `Bearer ${expected}` || header === expected;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "database_unavailable" });
    const [result, audioGc] = await Promise.all([
      processKnowledgeHeartFlagEmails(pool),
      purgeExpiredKnowledgeHeartAudio(pool)
    ]);
    return res.status(200).json({ ok: true, ...result, audioGc });
  } catch (error) {
    return res.status(500).json({ error: "knowledge_heart_notifications_error", message: error?.message || "unknown" });
  }
}
