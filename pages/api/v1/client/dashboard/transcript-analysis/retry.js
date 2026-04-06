import { requireSession, resolveTenantKey } from "../../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import {
  ensureTenantBillingAccount,
  requireTenantBillingAccess,
  requireTenantRoles
} from "../../../../_lib/billing.js";
import {
  enqueueMissingCallTranscriptAnalyses,
  reviveDeadLetterCallTranscriptAnalyses
} from "../../../../_lib/callTranscriptAnalysis.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || "default"));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;
    const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
      message: "Only account admins and owners can manage transcript analysis."
    });
    if (!manager) return;

    const billingState = await ensureTenantBillingAccount(pool, tenantKey);
    if (!billingState) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    const [revived, enqueued] = await Promise.all([
      reviveDeadLetterCallTranscriptAnalyses(pool, {
        tenantKey,
        days: 30,
        limit: 50
      }),
      enqueueMissingCallTranscriptAnalyses(pool, {
        tenantKey,
        days: 30,
        limit: 50
      })
    ]);

    return res.status(200).json({
      ok: true,
      revived: Number(revived?.revived || 0),
      enqueued: Number(enqueued?.enqueued || 0)
    });
  } catch (error) {
    return res.status(500).json({
      error: "transcript_analysis_retry_failed",
      message: error?.message || "unknown"
    });
  }
}
