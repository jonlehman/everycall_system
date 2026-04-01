import { requireSession } from "../../_lib/auth.js";
import { buildAuditActor, writeAuditLog } from "../../_lib/auditLog.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireActiveTenantUser } from "../../_lib/billing.js";
import { enforceRateLimit, getClientIp } from "../../_lib/rateLimit.js";
import { notifySupportOfNewConversation } from "../../_lib/supportNotifications.js";
import { createSupportConversation, listTenantSupportConversations } from "../../_lib/supportChat.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantUser = await requireActiveTenantUser(session);
    if (!tenantUser) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (req.method === "GET") {
      const conversations = await listTenantSupportConversations(pool, tenantUser.tenant_key);
      return res.status(200).json({
        ok: true,
        viewer: {
          tenantUserId: tenantUser.id,
          name: tenantUser.name,
          email: tenantUser.email,
          role: tenantUser.role
        },
        conversations
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const rateLimit = await enforceRateLimit(res, pool, {
      scope: "support_conversation_create",
      key: `${tenantUser.id}:${getClientIp(req)}`,
      maxHits: 8,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 15 * 60 * 1000,
      message: "Too many support conversations were created. Please wait a few minutes and try again."
    });
    if (rateLimit?.limited) return;

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const conversationId = await createSupportConversation(pool, {
      tenantKey: tenantUser.tenant_key,
      tenantUser,
      subject: body.subject,
      body: body.body
    });
    await writeAuditLog(pool, {
      tenantKey: tenantUser.tenant_key,
      actor: buildAuditActor({ session, tenantUser }),
      action: "support.conversation.created",
      details: {
        conversationId,
        subject: String(body.subject || "").trim()
      }
    });
    try {
      await notifySupportOfNewConversation(pool, {
        tenantKey: tenantUser.tenant_key,
        conversationId,
        subject: body.subject,
        messagePreview: body.body,
        senderName: tenantUser.name,
        senderEmail: tenantUser.email
      });
    } catch {}
    return res.status(200).json({ ok: true, conversationId });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      error: "support_conversations_error",
      message: err?.message || "unknown"
    });
  }
}
