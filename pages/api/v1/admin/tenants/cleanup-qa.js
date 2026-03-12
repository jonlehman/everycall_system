import { requireSession } from "../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { cleanupQaTenants, findQaTenants, QA_TENANT_PATTERNS } from "../../../_lib/tenantCleanup.js";

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
      const matches = await findQaTenants(QA_TENANT_PATTERNS);
      return res.status(200).json({ ok: true, patterns: QA_TENANT_PATTERNS, matches });
    }

    if (req.method === "POST") {
      const result = await cleanupQaTenants(QA_TENANT_PATTERNS, { releaseNumber: true });
      return res.status(200).json({
        ok: true,
        patterns: QA_TENANT_PATTERNS,
        matchCount: result.matches.length,
        deletedCount: result.deleted.filter((item) => item.deleted).length,
        matches: result.matches,
        deleted: result.deleted
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "admin_cleanup_qa_error", message: err?.message || "unknown" });
  }
}
