import { requireSession, getAdminActor } from "../../_lib/auth.js";
import { getPool } from "../../_lib/db.js";
import { loadMarketingInsights } from "../../_lib/marketingInsights.js";

function parseDays(value) {
  const numeric = Number(value || 3);
  if (!Number.isFinite(numeric)) return 3;
  return Math.min(3, Math.max(1, Math.round(numeric)));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    const report = await loadMarketingInsights({
      pool,
      days: parseDays(req.query?.days),
      refresh: req.query?.refresh
    });

    return res.status(200).json({
      ...report,
      viewer: {
        id: Number(admin.id),
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "admin_marketing_insights_error",
      message: error?.message || "unknown"
    });
  }
}
