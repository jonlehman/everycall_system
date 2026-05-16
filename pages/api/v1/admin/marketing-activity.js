import { requireSession, getAdminActor } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { getClientIp } from "../../_lib/rateLimit.js";
import {
  buildMarketingActivityIpFilter,
  normalizeMarketingIpHashes,
  loadSarahMarketingActivity,
  loadFencingDemoMarketingActivity,
  mergeMarketingActivity
} from "../../_lib/marketingActivity.js";

function cleanMessage(error, fallback) {
  return String(error?.message || fallback || "unavailable").trim();
}

function unavailableSarahResult(error) {
  return {
    configured: false,
    message: `Sarah intake source unavailable: ${cleanMessage(error, "check CD_SITE_DATABASE_URL")}`,
    items: [],
    summary: {
      total30d: 0,
      reportsReady: 0,
      emailsSent: 0,
      followUps: 0
    }
  };
}

function truthy(value) {
  return value === true || value === "1" || value === "true" || value === "yes";
}

function queryValues(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const excludeCurrentIp = truthy(req.query?.excludeCurrentIp);
    const ipFilter = excludeCurrentIp
      ? buildMarketingActivityIpFilter({ currentIp: getClientIp(req) })
      : { enabled: false, demoIpHashes: [], sarahIpHashes: [] };
    const browserSarahIpHashes = normalizeMarketingIpHashes(queryValues(req.query?.sarahIpHash));
    const sarahIpHashes = normalizeMarketingIpHashes([
      ...ipFilter.sarahIpHashes,
      ...browserSarahIpHashes
    ]);

    const [sarah, fencing] = await Promise.all([
      loadSarahMarketingActivity({
        limit: 60,
        excludedIpHashes: sarahIpHashes,
        excludeMissingIpHash: excludeCurrentIp,
        excludeRepeatIpHashMin: excludeCurrentIp ? 2 : 0
      }).catch(unavailableSarahResult),
      loadFencingDemoMarketingActivity(pool, { limit: 60, excludedIpHashes: ipFilter.demoIpHashes })
    ]);
    const activity = mergeMarketingActivity(sarah.items, fencing.items, 80);

    return res.status(200).json({
      ok: true,
      viewer: {
        id: Number(admin.id),
        email: admin.email,
        role: admin.role
      },
      sources: {
        sarah: {
          configured: Boolean(sarah.configured),
          message: sarah.message || ""
        },
        fencing: {
          configured: Boolean(fencing.configured),
          message: fencing.message || ""
        }
      },
      summary: {
        sarah: sarah.summary,
        fencing: fencing.summary,
        total30d: Number(sarah.summary?.total30d || 0) + Number(fencing.summary?.total30d || 0)
      },
      filters: {
        excludeCurrentIp,
        excludedDemoIpHashes: ipFilter.demoIpHashes.length,
        excludedSarahIpHashes: sarahIpHashes.length,
        browserSarahIpHashReceived: browserSarahIpHashes.length > 0,
        missingSarahIpHashesExcluded: excludeCurrentIp,
        repeatSarahIpHashesExcluded: excludeCurrentIp
      },
      activity
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_marketing_activity_error",
      message: err?.message || "unknown"
    });
  }
}
