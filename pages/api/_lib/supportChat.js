export const SUPPORT_CONVERSATION_STATUSES = [
  "waiting_on_support",
  "waiting_on_client",
  "resolved"
];

export const SUPPORT_MESSAGE_SENDER_TYPES = {
  tenantUser: "tenant_user",
  admin: "admin",
  system: "system"
};

const MAX_SUPPORT_SUBJECT_LENGTH = 160;
const MAX_SUPPORT_BODY_LENGTH = 4000;
const MAX_SUPPORT_PREVIEW_LENGTH = 180;

function normalizeText(value) {
  return String(value || "").trim();
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "open") return "waiting_on_support";
  if (SUPPORT_CONVERSATION_STATUSES.includes(normalized)) return normalized;
  return "waiting_on_support";
}

function normalizeSenderType(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === SUPPORT_MESSAGE_SENDER_TYPES.admin) return SUPPORT_MESSAGE_SENDER_TYPES.admin;
  if (normalized === SUPPORT_MESSAGE_SENDER_TYPES.system) return SUPPORT_MESSAGE_SENDER_TYPES.system;
  return SUPPORT_MESSAGE_SENDER_TYPES.tenantUser;
}

function assertSubject(value) {
  const text = normalizeText(value);
  if (!text) {
    throw Object.assign(new Error("Support subject is required."), { statusCode: 400 });
  }
  return truncateText(text, MAX_SUPPORT_SUBJECT_LENGTH);
}

function assertBody(value) {
  const text = normalizeText(value);
  if (!text) {
    throw Object.assign(new Error("Support message is required."), { statusCode: 400 });
  }
  return truncateText(text, MAX_SUPPORT_BODY_LENGTH);
}

function conversationSelectSql() {
  return `SELECT
    sc.id,
    sc.tenant_key,
    sc.created_by_tenant_user_id,
    sc.subject,
    sc.status,
    sc.priority,
    sc.assigned_admin_user_id,
    sc.client_last_read_at,
    sc.admin_last_read_at,
    sc.client_unread_count,
    sc.admin_unread_count,
    sc.last_message_at,
    sc.last_message_preview,
    sc.resolved_at,
    sc.created_at,
    sc.updated_at,
    creator.name AS created_by_name,
    creator.email AS created_by_email,
    assigned.username AS assigned_admin_name,
    assigned.email AS assigned_admin_email
  FROM support_conversations sc
  LEFT JOIN tenant_users creator ON creator.id = sc.created_by_tenant_user_id
  LEFT JOIN admin_users assigned ON assigned.id = sc.assigned_admin_user_id`;
}

function serializeConversation(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    tenantKey: row.tenant_key,
    createdByTenantUserId: row.created_by_tenant_user_id ? Number(row.created_by_tenant_user_id) : null,
    subject: row.subject,
    status: normalizeStatus(row.status),
    priority: row.priority || "normal",
    assignedAdminUserId: row.assigned_admin_user_id ? Number(row.assigned_admin_user_id) : null,
    assignedAdminName: row.assigned_admin_name || null,
    assignedAdminEmail: row.assigned_admin_email || null,
    createdByName: row.created_by_name || null,
    createdByEmail: row.created_by_email || null,
    clientLastReadAt: row.client_last_read_at || null,
    adminLastReadAt: row.admin_last_read_at || null,
    clientUnreadCount: Number(row.client_unread_count || 0),
    adminUnreadCount: Number(row.admin_unread_count || 0),
    lastMessageAt: row.last_message_at || null,
    lastMessagePreview: row.last_message_preview || "",
    resolvedAt: row.resolved_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function serializeMessage(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    tenantKey: row.tenant_key,
    senderType: normalizeSenderType(row.sender_type),
    senderId: row.sender_id || null,
    senderName: row.sender_name || null,
    body: row.body || "",
    bodyFormat: row.body_format || "plain_text",
    createdAt: row.created_at || null
  };
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listTenantSupportConversations(pool, tenantKey) {
  const result = await pool.query(
    `${conversationSelectSql()}
     WHERE sc.tenant_key = $1
     ORDER BY CASE WHEN sc.status = 'resolved' THEN 1 ELSE 0 END,
              sc.last_message_at DESC,
              sc.id DESC
     LIMIT 100`,
    [tenantKey]
  );
  return (result.rows || []).map(serializeConversation);
}

export async function listAdminSupportConversations(pool) {
  const result = await pool.query(
    `${conversationSelectSql()}
     ORDER BY CASE WHEN sc.status = 'resolved' THEN 1 ELSE 0 END,
              sc.last_message_at DESC,
              sc.id DESC
     LIMIT 200`
  );
  return (result.rows || []).map(serializeConversation);
}

export async function getTenantSupportConversation(pool, { tenantKey, conversationId }) {
  const result = await pool.query(
    `${conversationSelectSql()}
     WHERE sc.tenant_key = $1
       AND sc.id = $2
     LIMIT 1`,
    [tenantKey, conversationId]
  );
  return serializeConversation(result.rows[0] || null);
}

export async function getAdminSupportConversation(pool, { conversationId }) {
  const result = await pool.query(
    `${conversationSelectSql()}
     WHERE sc.id = $1
     LIMIT 1`,
    [conversationId]
  );
  return serializeConversation(result.rows[0] || null);
}

export async function listSupportMessages(pool, { conversationId }) {
  const result = await pool.query(
    `SELECT id, conversation_id, tenant_key, sender_type, sender_id, sender_name, body, body_format, created_at
     FROM support_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );
  return (result.rows || []).map(serializeMessage);
}

export async function createSupportConversation(pool, {
  tenantKey,
  tenantUser,
  subject,
  body
}) {
  const nextSubject = assertSubject(subject);
  const nextBody = assertBody(body);
  return withTransaction(pool, async (client) => {
    const conversationInsert = await client.query(
      `INSERT INTO support_conversations (
         tenant_key,
         created_by_tenant_user_id,
         subject,
         status,
         client_last_read_at,
         admin_unread_count,
         last_message_at,
         last_message_preview,
         updated_at
       )
       VALUES ($1, $2, $3, 'waiting_on_support', NOW(), 1, NOW(), $4, NOW())
       RETURNING id`,
      [
        tenantKey,
        tenantUser?.id || null,
        nextSubject,
        truncateText(nextBody, MAX_SUPPORT_PREVIEW_LENGTH)
      ]
    );
    const conversationId = Number(conversationInsert.rows[0]?.id || 0);
    await client.query(
      `INSERT INTO support_messages (
         conversation_id,
         tenant_key,
         sender_type,
         sender_id,
         sender_name,
         body
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        conversationId,
        tenantKey,
        SUPPORT_MESSAGE_SENDER_TYPES.tenantUser,
        tenantUser?.id ? `tenant:${tenantUser.id}` : null,
        normalizeText(tenantUser?.name) || normalizeText(tenantUser?.email) || "Client",
        nextBody
      ]
    );
    return conversationId;
  });
}

export async function appendSupportMessage(pool, {
  conversationId,
  tenantKey = null,
  senderType,
  senderId = null,
  senderName = null,
  body,
  assignedAdminUserId = null
}) {
  const nextBody = assertBody(body);
  const normalizedSenderType = normalizeSenderType(senderType);

  return withTransaction(pool, async (client) => {
    const conversationRes = await client.query(
      `SELECT *
       FROM support_conversations
       WHERE id = $1
       FOR UPDATE`,
      [conversationId]
    );
    const conversation = conversationRes.rows[0] || null;
    if (!conversation) {
      throw Object.assign(new Error("support_conversation_not_found"), { statusCode: 404 });
    }
    if (tenantKey && conversation.tenant_key !== tenantKey) {
      throw Object.assign(new Error("support_conversation_not_found"), { statusCode: 404 });
    }

    await client.query(
      `INSERT INTO support_messages (
         conversation_id,
         tenant_key,
         sender_type,
         sender_id,
         sender_name,
         body
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        conversationId,
        conversation.tenant_key,
        normalizedSenderType,
        normalizeText(senderId) || null,
        truncateText(senderName, 120) || null,
        nextBody
      ]
    );

    let status = conversation.status || "waiting_on_support";
    let clientUnreadCount = Number(conversation.client_unread_count || 0);
    let adminUnreadCount = Number(conversation.admin_unread_count || 0);
    let assignedAdminId = conversation.assigned_admin_user_id || null;
    let clientLastReadAt = conversation.client_last_read_at || null;
    let adminLastReadAt = conversation.admin_last_read_at || null;
    let resolvedAt = conversation.resolved_at || null;

    if (normalizedSenderType === SUPPORT_MESSAGE_SENDER_TYPES.admin) {
      status = "waiting_on_client";
      clientUnreadCount += 1;
      adminUnreadCount = 0;
      adminLastReadAt = new Date().toISOString();
      resolvedAt = null;
      if (Number.isFinite(Number(assignedAdminUserId)) && Number(assignedAdminUserId) > 0) {
        assignedAdminId = Number(assignedAdminUserId);
      }
    } else {
      status = "waiting_on_support";
      adminUnreadCount += 1;
      clientUnreadCount = 0;
      clientLastReadAt = new Date().toISOString();
      resolvedAt = null;
    }

    await client.query(
      `UPDATE support_conversations
       SET status = $2,
           assigned_admin_user_id = $3,
           client_last_read_at = $4,
           admin_last_read_at = $5,
           client_unread_count = $6,
           admin_unread_count = $7,
           last_message_at = NOW(),
           last_message_preview = $8,
           resolved_at = $9,
           updated_at = NOW()
       WHERE id = $1`,
      [
        conversationId,
        status,
        assignedAdminId,
        clientLastReadAt,
        adminLastReadAt,
        clientUnreadCount,
        adminUnreadCount,
        truncateText(nextBody, MAX_SUPPORT_PREVIEW_LENGTH),
        resolvedAt
      ]
    );

    return conversation.tenant_key;
  });
}

export async function markSupportConversationRead(pool, {
  conversationId,
  tenantKey = null,
  viewerType
}) {
  const normalizedViewerType = normalizeSenderType(viewerType);
  const conditions = [`id = $1`];
  const values = [conversationId];
  if (tenantKey) {
    values.push(tenantKey);
    conditions.push(`tenant_key = $${values.length}`);
  }
  const fieldPrefix = normalizedViewerType === SUPPORT_MESSAGE_SENDER_TYPES.admin ? "admin" : "client";
  const result = await pool.query(
    `UPDATE support_conversations
     SET ${fieldPrefix}_last_read_at = NOW(),
         ${fieldPrefix}_unread_count = 0,
         updated_at = NOW()
     WHERE ${conditions.join(" AND ")}
     RETURNING id`,
    values
  );
  return Boolean(result.rowCount);
}

export async function assignSupportConversation(pool, {
  conversationId,
  adminUserId = null
}) {
  const normalizedAdminUserId = Number.isFinite(Number(adminUserId)) && Number(adminUserId) > 0
    ? Number(adminUserId)
    : null;
  const result = await pool.query(
    `UPDATE support_conversations
     SET assigned_admin_user_id = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING tenant_key`,
    [conversationId, normalizedAdminUserId]
  );
  if (!result.rowCount) {
    throw Object.assign(new Error("support_conversation_not_found"), { statusCode: 404 });
  }
  return result.rows[0]?.tenant_key || null;
}

export async function updateSupportConversationStatus(pool, {
  conversationId,
  status
}) {
  const normalizedStatus = normalizeStatus(status);
  const result = await pool.query(
    `UPDATE support_conversations
     SET status = $2,
         resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING tenant_key, status`,
    [conversationId, normalizedStatus]
  );
  if (!result.rowCount) {
    throw Object.assign(new Error("support_conversation_not_found"), { statusCode: 404 });
  }
  return {
    tenantKey: result.rows[0]?.tenant_key || null,
    status: normalizeStatus(result.rows[0]?.status)
  };
}

export async function loadTenantSupportConversationDetail(pool, {
  tenantKey,
  conversationId
}) {
  const conversation = await getTenantSupportConversation(pool, { tenantKey, conversationId });
  if (!conversation) {
    throw Object.assign(new Error("support_conversation_not_found"), { statusCode: 404 });
  }
  const messages = await listSupportMessages(pool, { conversationId });
  return { conversation, messages };
}

export async function loadAdminSupportConversationDetail(pool, {
  conversationId
}) {
  const conversation = await getAdminSupportConversation(pool, { conversationId });
  if (!conversation) {
    throw Object.assign(new Error("support_conversation_not_found"), { statusCode: 404 });
  }

  const [messages, tenantContextResult, recentCallsResult] = await Promise.all([
    listSupportMessages(pool, { conversationId }),
    pool.query(
      `SELECT
         t.tenant_key,
         t.name,
         t.billing_status,
         t.app_access_status,
         t.service_access_status,
         t.telnyx_voice_number,
         owner.name AS owner_name,
         owner.email AS owner_email
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT name, email
         FROM tenant_users
         WHERE tenant_key = t.tenant_key
           AND role = 'owner'
         ORDER BY id ASC
         LIMIT 1
       ) owner ON TRUE
       WHERE t.tenant_key = $1
       LIMIT 1`,
      [conversation.tenantKey]
    ),
    pool.query(
      `SELECT
         call_sid,
         created_at,
         summary,
         lead_outcome_type,
         lead_is_valid,
         lead_is_billable
       FROM calls
       WHERE tenant_key = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [conversation.tenantKey]
    )
  ]);

  return {
    conversation,
    messages,
    tenantContext: {
      ...(tenantContextResult.rows[0] || {}),
      recentCalls: recentCallsResult.rows || []
    }
  };
}
