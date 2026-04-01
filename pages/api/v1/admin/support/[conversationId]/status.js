import { requireSession, getAdminActor } from "../../../../_lib/auth.js";
import { buildAuditActor, writeAuditLog } from "../../../../_lib/auditLog.js";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { updateSupportConversationStatus } from "../../../../_lib/supportChat.js";

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

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const conversationId = Number(req.query?.conversationId || 0);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: "invalid_conversation_id" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const result = await updateSupportConversationStatus(pool, {
      conversationId,
      status: body.status
    });
    await writeAuditLog(pool, {
      tenantKey: result.tenantKey,
      actor: buildAuditActor({ session, admin }),
      action: "support.conversation.status_changed",
      details: {
        conversationId,
        status: result.status
      }
    });
    return res.status(200).json({ ok: true, status: result.status });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      error: "admin_support_status_error",
      message: err?.message || "unknown"
    });
  }
}
