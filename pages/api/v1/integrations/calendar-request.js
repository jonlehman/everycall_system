import { requireSession } from "../../_lib/auth.js";
import { buildAuditActor, writeAuditLog } from "../../_lib/auditLog.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireActiveTenantUser, requireTenantBillingAccess } from "../../_lib/billing.js";
import { enforceRateLimit, getClientIp } from "../../_lib/rateLimit.js";
import { appendSupportMessage, createSupportConversation } from "../../_lib/supportChat.js";
import { notifySupportOfCalendarIntegrationRequest } from "../../_lib/supportNotifications.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function assertRequired(value, message) {
  const text = normalizeText(value);
  if (!text) {
    throw Object.assign(new Error(message), { statusCode: 400 });
  }
  return text;
}

function truncateText(value, max = 1000) {
  const text = normalizeText(value);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function buildCalendarRequestBody({ calendarSystem, workflow, teamSetup, notes, tenantUser }) {
  return [
    `${normalizeText(tenantUser?.name) || normalizeText(tenantUser?.email) || "A tenant user"} requested calendar integration help.`,
    "",
    `Calendar system: ${calendarSystem}`,
    `Requested workflow: ${workflow}`,
    `Who should be booked: ${teamSetup}`,
    "",
    "Notes:",
    truncateText(notes, 2000) || "-"
  ].join("\n");
}

async function createOrUpdateCalendarRequestConversation(pool, {
  tenantKey,
  tenantUser,
  calendarSystem,
  workflow,
  teamSetup,
  notes
}) {
  const subject = "Calendar integration request";
  const body = buildCalendarRequestBody({
    calendarSystem,
    workflow,
    teamSetup,
    notes,
    tenantUser
  });

  const existing = await pool.query(
    `SELECT id
     FROM support_conversations
     WHERE tenant_key = $1
       AND subject = $2
       AND status <> 'resolved'
     ORDER BY last_message_at DESC, id DESC
     LIMIT 1`,
    [tenantKey, subject]
  );

  const existingConversationId = Number(existing.rows[0]?.id || 0) || null;
  if (existingConversationId) {
    await appendSupportMessage(pool, {
      conversationId: existingConversationId,
      tenantKey,
      senderType: "tenant_user",
      senderId: tenantUser?.id ? `tenant:${tenantUser.id}` : null,
      senderName: normalizeText(tenantUser?.name) || normalizeText(tenantUser?.email) || "Client",
      body
    });
    return { conversationId: existingConversationId, created: false, subject, body };
  }

  const conversationId = await createSupportConversation(pool, {
    tenantKey,
    tenantUser,
    subject,
    body
  });

  return { conversationId, created: true, subject, body };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = normalizeText(session?.tenant_key);
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    const tenantUser = await requireActiveTenantUser(session);
    if (!tenantUser) {
      return res.status(403).json({ error: "forbidden" });
    }

    const rateLimit = await enforceRateLimit(res, pool, {
      scope: "calendar_integration_request",
      key: `${tenantUser.id}:${getClientIp(req)}`,
      maxHits: 6,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 15 * 60 * 1000,
      message: "Too many calendar integration requests were sent. Please wait a few minutes and try again."
    });
    if (rateLimit?.limited) return;

    const body = asObject(req.body);
    const calendarSystem = assertRequired(body.calendarSystem, "Please choose which calendar system you want connected.");
    const workflow = assertRequired(body.workflow, "Please choose what you want the receptionist to do.");
    const teamSetup = assertRequired(body.teamSetup, "Please choose who should be booked.");
    const notes = truncateText(body.notes, 2000);

    const conversation = await createOrUpdateCalendarRequestConversation(pool, {
      tenantKey,
      tenantUser,
      calendarSystem,
      workflow,
      teamSetup,
      notes
    });

    await writeAuditLog(pool, {
      tenantKey,
      actor: buildAuditActor({ session, tenantUser }),
      action: "support.calendar_integration_requested",
      details: {
        conversationId: conversation.conversationId,
        calendarSystem,
        workflow,
        teamSetup
      }
    });

    await notifySupportOfCalendarIntegrationRequest({
      tenantKey,
      conversationId: conversation.conversationId,
      requesterName: tenantUser.name,
      requesterEmail: tenantUser.email,
      calendarSystem,
      workflow,
      teamSetup,
      notes
    });

    return res.status(200).json({
      ok: true,
      conversationId: conversation.conversationId,
      created: conversation.created
    });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      error: "calendar_integration_request_error",
      message: err?.message || "unknown"
    });
  }
}
