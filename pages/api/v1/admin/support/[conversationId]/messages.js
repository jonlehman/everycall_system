import { requireSession, getAdminActor } from "../../../../_lib/auth.js";
import { buildAuditActor, writeAuditLog } from "../../../../_lib/auditLog.js";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { enforceRateLimit, getClientIp } from "../../../../_lib/rateLimit.js";
import { notifyTenantOfAdminReply } from "../../../../_lib/supportNotifications.js";
import { appendSupportMessage } from "../../../../_lib/supportChat.js";

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

    const rateLimit = await enforceRateLimit(res, pool, {
      scope: "admin_support_message_send",
      key: `${admin.id}:${getClientIp(req)}`,
      maxHits: 60,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 10 * 60 * 1000,
      message: "Too many support messages were sent. Please wait a moment and try again."
    });
    if (rateLimit?.limited) return;

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const tenantKey = await appendSupportMessage(pool, {
      conversationId,
      senderType: "admin",
      senderId: `admin:${admin.id}`,
      senderName: admin.username || admin.email || "Support",
      body: body.body,
      assignedAdminUserId: admin.id
    });
    await writeAuditLog(pool, {
      tenantKey,
      actor: buildAuditActor({ session, admin }),
      action: "support.message.sent",
      details: { conversationId, senderType: "admin" }
    });
    try {
      await notifyTenantOfAdminReply(pool, { conversationId });
    } catch {}
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      error: "admin_support_message_send_error",
      message: err?.message || "unknown"
    });
  }
}
