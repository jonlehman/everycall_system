import { requireSession } from "../../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { cleanupTenantByKey } from "../../../../_lib/tenantCleanup.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const tenantKey = String(req.query?.tenantKey || "").trim();
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const result = await cleanupTenantByKey(tenantKey, { releaseNumber: true });
    if (!result.deleted) {
      return res.status(404).json({ error: result.reason || "tenant_not_found" });
    }

    return res.status(200).json({ ok: true, deleted: result });
  } catch (err) {
    return res.status(500).json({ error: "admin_tenant_delete_error", message: err?.message || "unknown" });
  }
}
