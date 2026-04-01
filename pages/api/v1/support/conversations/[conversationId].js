import { requireSession } from "../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { requireActiveTenantUser } from "../../../_lib/billing.js";
import { loadTenantSupportConversationDetail } from "../../../_lib/supportChat.js";

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

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantUser = await requireActiveTenantUser(session);
    if (!tenantUser) {
      return res.status(403).json({ error: "forbidden" });
    }

    const conversationId = Number(req.query?.conversationId || 0);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: "invalid_conversation_id" });
    }

    const detail = await loadTenantSupportConversationDetail(pool, {
      tenantKey: tenantUser.tenant_key,
      conversationId
    });
    return res.status(200).json({ ok: true, ...detail });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      error: "support_conversation_detail_error",
      message: err?.message || "unknown"
    });
  }
}
