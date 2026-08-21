import { MailtrapClient } from "mailtrap";

function normalizeText(value) {
  return String(value || "").trim();
}

function getMailSender() {
  return {
    email: normalizeText(process.env.MAIL_FROM_EMAIL || process.env.MAILTRAP_SENDER_EMAIL || "hello@everycall.io"),
    name: normalizeText(process.env.MAIL_FROM_NAME || process.env.MAILTRAP_SENDER_NAME || "EveryCall")
  };
}

function getConfiguredMailProvider() {
  const explicit = normalizeText(process.env.MAIL_PROVIDER).toLowerCase();
  if (explicit) return explicit;
  if (normalizeText(process.env.RESEND_API_KEY)) return "resend";
  if (normalizeText(process.env.MAILTRAP_TOKEN)) return "mailtrap";
  return "";
}

let cachedMailtrapClient = null;

function getMailtrapClient() {
  const token = normalizeText(process.env.MAILTRAP_TOKEN);
  if (!token) return null;
  if (!cachedMailtrapClient) {
    cachedMailtrapClient = new MailtrapClient({ token });
  }
  return cachedMailtrapClient;
}

async function sendWithMailtrap(payload) {
  const client = getMailtrapClient();
  if (!client) {
    throw new Error("mail_provider_unavailable");
  }
  const response = await client.send(payload);
  return {
    provider: "mailtrap",
    id: response?.message_ids?.[0] || response?.id || null
  };
}

async function sendWithResend({ from, to, subject, text, html, idempotencyKey }) {
  const apiKey = normalizeText(process.env.RESEND_API_KEY);
  if (!apiKey) {
    throw new Error("mail_provider_unavailable");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: JSON.stringify({
      from: `${from.name} <${from.email}>`,
      to: Array.isArray(to) ? to : [],
      subject,
      text: text || undefined,
      html: html || undefined
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(normalizeText(data?.message || data?.error || "mail_send_failed"));
  }
  return {
    provider: "resend",
    id: data?.id || null
  };
}

export async function sendTransactionalEmail({
  to,
  subject,
  text,
  html,
  category = null,
  idempotencyKey = null
}) {
  const recipients = (Array.isArray(to) ? to : [to])
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (!recipients.length) {
    throw new Error("missing_destination");
  }
  const from = getMailSender();
  const provider = getConfiguredMailProvider();
  if (!provider) {
    throw new Error("mail_provider_unavailable");
  }

  if (provider === "resend") {
    return sendWithResend({ from, to: recipients, subject, text, html, category, idempotencyKey });
  }

  if (provider === "mailtrap") {
    return sendWithMailtrap({
      from,
      to: recipients.map((email) => ({ email })),
      subject,
      text,
      html,
      category: category || undefined
    });
  }

  throw new Error(`mail_provider_not_supported:${provider}`);
}
