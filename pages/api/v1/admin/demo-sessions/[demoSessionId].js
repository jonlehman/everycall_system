import { requireSession, getAdminActor } from "../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { loadAdminDemoSessionDetail } from "../../../_lib/demoSessions.js";

function normalizeText(value) {
  return String(value || "").trim();
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

    const demoSessionId = normalizeText(req.query?.demoSessionId);
    if (!demoSessionId) {
      return res.status(400).json({ error: "demo_session_id_required" });
    }

    const detail = await loadAdminDemoSessionDetail(pool, demoSessionId);
    if (!detail) {
      return res.status(404).json({ error: "demo_session_not_found" });
    }

    return res.status(200).json({
      ok: true,
      detail
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_demo_session_detail_error",
      message: err?.message || "unknown"
    });
  }
}
