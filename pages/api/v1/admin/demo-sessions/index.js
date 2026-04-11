import { requireSession, getAdminActor } from "../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { listAdminDemoSessions } from "../../../_lib/demoSessions.js";

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

    const demoSessions = await listAdminDemoSessions(pool);
    return res.status(200).json({
      ok: true,
      viewer: {
        id: Number(admin.id),
        email: admin.email,
        role: admin.role
      },
      demoSessions
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_demo_sessions_error",
      message: err?.message || "unknown"
    });
  }
}
