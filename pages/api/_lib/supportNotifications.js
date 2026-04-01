import { sendTransactionalEmail } from "./mail.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function getAppBaseUrl() {
  return normalizeText(process.env.APP_BASE_URL || "https://app.everycall.io") || "https://app.everycall.io";
}

function listEmails(value) {
  return String(value || "")
    .split(",")
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean);
}

async function getSupportRecipients(pool) {
  const explicit = listEmails(process.env.SUPPORT_INBOX_EMAILS || process.env.SUPPORT_EMAILS);
  if (explicit.length) {
    return explicit;
  }
  const result = await pool.query(
    `SELECT email
     FROM admin_users
     WHERE email IS NOT NULL
       AND email <> ''
     ORDER BY id ASC
     LIMIT 10`
  );
  return (result.rows || [])
    .map((row) => normalizeText(row.email).toLowerCase())
    .filter(Boolean);
}

export async function notifySupportOfNewConversation(pool, {
  tenantKey,
  conversationId,
  subject,
  messagePreview,
  senderName,
  senderEmail
}) {
  const recipients = await getSupportRecipients(pool);
  if (!recipients.length) return;
  const appBaseUrl = getAppBaseUrl();
  const text = [
    `A new support conversation was opened in EveryCall.`,
    ``,
    `Tenant: ${tenantKey || "-"}`,
    `Subject: ${normalizeText(subject) || "-"}`,
    `From: ${normalizeText(senderName) || normalizeText(senderEmail) || "Tenant user"}`,
    ``,
    `Preview:`,
    normalizeText(messagePreview) || "-",
    ``,
    `Open admin support: ${appBaseUrl}/admin/support`,
    `Conversation ID: ${conversationId}`
  ].join("\n");

  await sendTransactionalEmail({
    to: recipients,
    subject: `EveryCall support: new conversation from ${tenantKey || "tenant"}`,
    text,
    category: "Support Conversation"
  });
}

export async function notifyTenantOfAdminReply(pool, {
  conversationId
}) {
  const result = await pool.query(
    `SELECT
       sc.tenant_key,
       sc.subject,
       tu.email,
       tu.name
     FROM support_conversations sc
     LEFT JOIN tenant_users tu ON tu.id = sc.created_by_tenant_user_id
     WHERE sc.id = $1
     LIMIT 1`,
    [conversationId]
  );
  const row = result.rows[0] || null;
  const email = normalizeText(row?.email).toLowerCase();
  if (!email) return;
  const appBaseUrl = getAppBaseUrl();
  const text = [
    `EveryCall support replied to your conversation.`,
    ``,
    `Tenant: ${normalizeText(row?.tenant_key) || "-"}`,
    `Subject: ${normalizeText(row?.subject) || "-"}`,
    ``,
    `Open support: ${appBaseUrl}/client/account/support`,
    `Conversation ID: ${conversationId}`
  ].join("\n");

  await sendTransactionalEmail({
    to: email,
    subject: `EveryCall support replied: ${normalizeText(row?.subject) || "Support conversation"}`,
    text,
    category: "Support Reply"
  });
}
