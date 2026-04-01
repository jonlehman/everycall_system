import { requireSession, getAdminActor } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { listAdminSupportConversations } from "../../_lib/supportChat.js";

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

    const conversations = await listAdminSupportConversations(pool);
    const counts = {
      all: conversations.length,
      unread: conversations.filter((item) => Number(item.adminUnreadCount || 0) > 0).length,
      unassigned: conversations.filter((item) => !item.assignedAdminUserId && item.status !== "resolved").length,
      mine: conversations.filter((item) => item.assignedAdminUserId === Number(admin.id) && item.status !== "resolved").length,
      resolved: conversations.filter((item) => item.status === "resolved").length
    };

    return res.status(200).json({
      ok: true,
      viewer: {
        id: Number(admin.id),
        email: admin.email,
        role: admin.role
      },
      counts,
      conversations
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_support_error",
      message: err?.message || "unknown"
    });
  }
}
