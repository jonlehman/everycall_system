import { clearSalesSessionCookie, deleteSalesSession, getSalesSession } from "../../../_lib/auth.js";
import { getPool } from "../../../_lib/db.js";
import { writeAuditLog } from "../../../_lib/auditLog.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const session = await getSalesSession(req);
    await deleteSalesSession(req);
    clearSalesSessionCookie(res);
    if (session) {
      await writeAuditLog(getPool(), {
        actor: `sales:${session.user_id}`, action: "auth.logout", details: { role: "sales" }
      });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "sales_logout_error" });
  }
}
