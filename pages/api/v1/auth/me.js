import { ensureTables, getPool } from "../../_lib/db.js";
import { getSession } from "../../_lib/auth.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await getSession(req);
    if (!session) {
      return res.status(200).json({ authenticated: false });
    }

    return res.status(200).json({
      authenticated: true,
      role: session.role,
      tenantKey: session.tenant_key || null
    });
  } catch (err) {
    return res.status(500).json({ error: "auth_me_error", message: err?.message || "unknown" });
  }
}
