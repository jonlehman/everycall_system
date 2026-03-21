import { MailtrapClient } from "mailtrap";
import { getSharedSmsNumber } from "./alerts.js";
import { sendTelnyxSms } from "./telnyx.js";
import { formatPhoneDisplay } from "../../../lib/phoneDisplay.js";

const mailtrapToken = String(process.env.MAILTRAP_TOKEN || "").trim();
const mailtrapSender = {
  email: process.env.MAILTRAP_SENDER_EMAIL || "hello@demomailtrap.co",
  name: process.env.MAILTRAP_SENDER_NAME || "EveryCall"
};
const mailtrapClient = mailtrapToken ? new MailtrapClient({ token: mailtrapToken }) : null;

function normalizeText(value) {
  return String(value || "").trim();
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatDisplayPhone(value) {
  const formatted = formatPhoneDisplay(value);
  return formatted || normalizeText(value);
}

function buildCallerName(callRow) {
  const first = normalizeText(callRow.caller_first_name);
  const last = normalizeText(callRow.caller_last_name);
  return [first, last].filter(Boolean).join(" ").trim();
}

function buildAddress(callRow) {
  return [
    normalizeText(callRow.address_line1),
    normalizeText(callRow.address_line2),
    normalizeText(callRow.city),
    normalizeText(callRow.state),
    normalizeText(callRow.postal_code)
  ].filter(Boolean).join(", ");
}

function buildRequestedTime(callRow) {
  return [normalizeText(callRow.requested_date), normalizeText(callRow.requested_time)].filter(Boolean).join(" ");
}

async function updateChannelHealth(pool, {
  tenantKey,
  channel,
  destination,
  status,
  errorCode = null,
  errorMessage = null
}) {
  const attemptedAt = new Date().toISOString();
  await pool.query(
    `INSERT INTO notification_channel_health (
       tenant_key,
       channel,
       destination,
       status,
       last_attempted_at,
       last_succeeded_at,
       last_failed_at,
       last_error_code,
       last_error_message,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5::timestamptz,
       CASE WHEN $4 = 'functioning' THEN $5::timestamptz ELSE NULL END,
       CASE WHEN $4 = 'non_functioning' THEN $5::timestamptz ELSE NULL END,
       $6, $7, NOW()
     )
     ON CONFLICT (tenant_key, channel, destination)
     DO UPDATE SET
       status = EXCLUDED.status,
       last_attempted_at = EXCLUDED.last_attempted_at,
       last_succeeded_at = CASE
         WHEN EXCLUDED.status = 'functioning' THEN EXCLUDED.last_attempted_at
         ELSE notification_channel_health.last_succeeded_at
       END,
       last_failed_at = CASE
         WHEN EXCLUDED.status = 'non_functioning' THEN EXCLUDED.last_attempted_at
         ELSE notification_channel_health.last_failed_at
       END,
       last_error_code = EXCLUDED.last_error_code,
       last_error_message = EXCLUDED.last_error_message,
       updated_at = NOW()`,
    [tenantKey, channel, destination, status, attemptedAt, errorCode, errorMessage]
  );
}

async function beginLeadDelivery(pool, {
  tenantKey,
  callSid,
  channel,
  destination,
  eventType = "new_lead"
}) {
  const result = await pool.query(
    `INSERT INTO lead_notification_deliveries (
       tenant_key,
       call_sid,
       channel,
       destination,
       event_type,
       status,
       attempted_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'sending', NOW(), NOW())
     ON CONFLICT (tenant_key, call_sid, channel, destination, event_type)
     DO UPDATE SET
       status = CASE
         WHEN lead_notification_deliveries.status = 'delivered' THEN lead_notification_deliveries.status
         ELSE 'sending'
       END,
       attempted_at = CASE
         WHEN lead_notification_deliveries.status = 'delivered' THEN lead_notification_deliveries.attempted_at
         ELSE NOW()
       END,
       updated_at = NOW()
     RETURNING id, status`,
    [tenantKey, callSid, channel, destination, eventType]
  );
  const row = result.rows[0] || null;
  return row?.status !== "delivered";
}

async function markLeadDelivery(pool, {
  tenantKey,
  callSid,
  channel,
  destination,
  eventType = "new_lead",
  status,
  errorCode = null,
  errorMessage = null
}) {
  await pool.query(
    `UPDATE lead_notification_deliveries
     SET status = $6,
         attempted_at = COALESCE(attempted_at, NOW()),
         delivered_at = CASE WHEN $6 = 'delivered' THEN NOW() ELSE delivered_at END,
         last_error_code = $7,
         last_error_message = $8,
         updated_at = NOW()
     WHERE tenant_key = $1
       AND call_sid = $2
       AND channel = $3
       AND destination = $4
       AND event_type = $5`,
    [tenantKey, callSid, channel, destination, eventType, status, errorCode, errorMessage]
  );
}

async function loadCombinedTranscript(pool, callSid, callRow) {
  const existing = normalizeText(callRow.transcript_combined) || normalizeText(callRow.transcript);
  if (existing) return existing;
  const events = await pool.query(
    `SELECT role, text
     FROM call_events
     WHERE call_sid = $1
     ORDER BY created_at ASC`,
    [callSid]
  );
  if (!events.rowCount) return "";
  return events.rows
    .map((row) => `${String(row.role || "Speaker").replace(/^[a-z]/, (char) => char.toUpperCase())}: ${normalizeText(row.text)}`)
    .filter(Boolean)
    .join("\n");
}

function buildLeadSms({ tenantName, callRow }) {
  const parts = [
    `New lead for ${tenantName}.`,
    buildCallerName(callRow) ? `Name: ${buildCallerName(callRow)}.` : null,
    callRow.callback_number ? `Callback: ${formatDisplayPhone(callRow.callback_number)}.` : null,
    callRow.service_required ? `Service: ${truncateText(callRow.service_required, 60)}.` : null,
    callRow.summary ? `Summary: ${truncateText(callRow.summary, 120)}.` : null
  ].filter(Boolean);
  return truncateText(parts.join(" "), 320);
}

function buildLeadEmail({ tenantName, appBaseUrl, callSid, callRow, transcript, includeTranscript, timezone }) {
  const lines = [
    `New lead for ${tenantName}`,
    "",
    callRow.summary ? `Summary: ${callRow.summary}` : null,
    buildCallerName(callRow) ? `Caller: ${buildCallerName(callRow)}` : null,
    callRow.callback_number ? `Callback: ${formatDisplayPhone(callRow.callback_number)}` : null,
    callRow.service_required ? `Service requested: ${callRow.service_required}` : null,
    callRow.urgency ? `Urgency: ${callRow.urgency}` : null,
    buildRequestedTime(callRow) ? `Requested time: ${buildRequestedTime(callRow)}` : null,
    buildAddress(callRow) ? `Address: ${buildAddress(callRow)}` : null,
    callRow.created_at
      ? `Received at: ${new Date(callRow.created_at).toLocaleString("en-US", { timeZone: timezone || "America/Los_Angeles" })} ${timezone || ""}`.trim()
      : null,
    `Call ID: ${callSid}`,
    appBaseUrl ? `Open EveryCall: ${appBaseUrl.replace(/\/$/, "")}/client/calls` : null
  ].filter(Boolean);

  if (includeTranscript) {
    lines.push("");
    lines.push("Transcript:");
    lines.push(transcript || "Transcript unavailable.");
  }

  return {
    subject: `New lead for ${tenantName}`,
    text: lines.join("\n")
  };
}

async function sendEmail(pool, { tenantKey, destination, subject, text }) {
  if (!destination) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "email",
      destination: "",
      status: "non_functioning",
      errorCode: "missing_destination",
      errorMessage: "Email destination missing"
    });
    throw new Error("missing_destination");
  }
  if (!mailtrapClient) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "email",
      destination,
      status: "non_functioning",
      errorCode: "mail_provider_missing",
      errorMessage: "Mailtrap not configured"
    });
    throw new Error("mail_provider_missing");
  }
  await mailtrapClient.send({
    from: mailtrapSender,
    to: [{ email: destination }],
    subject,
    text,
    category: "Lead Alert"
  });
  await updateChannelHealth(pool, {
    tenantKey,
    channel: "email",
    destination,
    status: "functioning"
  });
}

async function sendSms(pool, { tenantKey, destination, text }) {
  if (!destination) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "sms",
      destination: "",
      status: "non_functioning",
      errorCode: "missing_destination",
      errorMessage: "SMS destination missing"
    });
    throw new Error("missing_destination");
  }
  const from = await getSharedSmsNumber(pool);
  if (!from) {
    await updateChannelHealth(pool, {
      tenantKey,
      channel: "sms",
      destination,
      status: "non_functioning",
      errorCode: "shared_sms_missing",
      errorMessage: "Shared SMS number is not configured"
    });
    throw new Error("shared_sms_missing");
  }
  await sendTelnyxSms({ from, to: destination, text });
  await updateChannelHealth(pool, {
    tenantKey,
    channel: "sms",
    destination,
    status: "functioning"
  });
}

async function loadLeadNotificationContext(pool, tenantKey, callSid) {
  const [tenantRes, settingsRes, callRes, recipientsRes] = await Promise.all([
    pool.query(
      `SELECT name
       FROM tenants
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    ),
    pool.query(
      `SELECT timezone,
              lead_alerts_enabled,
              lead_alert_sms_enabled,
              lead_alert_email_enabled,
              lead_alert_email_include_transcript
       FROM tenant_settings
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    ),
    pool.query(
      `SELECT c.call_sid, c.summary, c.urgency, c.disposition, c.created_at,
              d.caller_first_name, d.caller_last_name, d.callback_number, d.service_required,
              d.address_line1, d.address_line2, d.city, d.state, d.postal_code,
              d.requested_date, d.requested_time, d.transcript_combined, d.transcript
       FROM calls c
       LEFT JOIN call_details d ON d.call_sid = c.call_sid
       WHERE c.tenant_key = $1
         AND c.call_sid = $2
       LIMIT 1`,
      [tenantKey, callSid]
    ),
    pool.query(
      `SELECT id, name, email, phone_number, sms_opt_in_status,
              lead_alert_sms_enabled, lead_alert_email_enabled
       FROM tenant_users
       WHERE tenant_key = $1
         AND status = 'active'`,
      [tenantKey]
    )
  ]);

  return {
    tenantName: normalizeText(tenantRes.rows[0]?.name) || tenantKey,
    settings: settingsRes.rows[0] || {
      timezone: "America/Los_Angeles",
      lead_alerts_enabled: false,
      lead_alert_sms_enabled: false,
      lead_alert_email_enabled: false,
      lead_alert_email_include_transcript: true
    },
    callRow: callRes.rows[0] || null,
    recipients: recipientsRes.rows || []
  };
}

export async function sendLeadNotifications(pool, { tenantKey, callSid }) {
  const context = await loadLeadNotificationContext(pool, tenantKey, callSid);
  const settings = context.settings || {};
  if (!settings.lead_alerts_enabled) {
    return { ok: true, skipped: "tenant_alerts_disabled" };
  }
  if (!context.callRow) {
    return { ok: false, error: "call_not_found" };
  }
  if (["spam", "canceled"].includes(normalizeText(context.callRow.disposition).toLowerCase())) {
    return { ok: true, skipped: "non_lead_disposition" };
  }

  const smsRecipients = settings.lead_alert_sms_enabled
    ? context.recipients.filter((row) => row.lead_alert_sms_enabled && normalizeText(row.phone_number) && row.sms_opt_in_status === "opted_in")
    : [];
  const emailRecipients = settings.lead_alert_email_enabled
    ? context.recipients.filter((row) => row.lead_alert_email_enabled && normalizeText(row.email))
    : [];

  if (!smsRecipients.length && !emailRecipients.length) {
    return { ok: true, skipped: "no_recipients" };
  }

  const transcript = settings.lead_alert_email_enabled && settings.lead_alert_email_include_transcript
    ? await loadCombinedTranscript(pool, callSid, context.callRow)
    : "";
  const smsText = smsRecipients.length
    ? buildLeadSms({ tenantName: context.tenantName, callRow: context.callRow })
    : "";
  const emailPayload = emailRecipients.length
    ? buildLeadEmail({
        tenantName: context.tenantName,
        appBaseUrl: process.env.APP_BASE_URL || "https://app.everycall.io",
        callSid,
        callRow: context.callRow,
        transcript,
        includeTranscript: Boolean(settings.lead_alert_email_include_transcript),
        timezone: normalizeText(settings.timezone) || "America/Los_Angeles"
      })
    : null;

  const results = {
    smsAttempted: 0,
    smsDelivered: 0,
    emailAttempted: 0,
    emailDelivered: 0
  };

  for (const recipient of smsRecipients) {
    const destination = normalizeText(recipient.phone_number);
    if (!destination) continue;
    const shouldSend = await beginLeadDelivery(pool, {
      tenantKey,
      callSid,
      channel: "sms",
      destination
    });
    if (!shouldSend) continue;
    results.smsAttempted += 1;
    try {
      await sendSms(pool, { tenantKey, destination, text: smsText });
      await markLeadDelivery(pool, {
        tenantKey,
        callSid,
        channel: "sms",
        destination,
        status: "delivered"
      });
      results.smsDelivered += 1;
    } catch (err) {
      await markLeadDelivery(pool, {
        tenantKey,
        callSid,
        channel: "sms",
        destination,
        status: "failed",
        errorCode: "send_failed",
        errorMessage: err instanceof Error ? err.message : "unknown"
      });
    }
  }

  for (const recipient of emailRecipients) {
    const destination = normalizeText(recipient.email).toLowerCase();
    if (!destination || !emailPayload) continue;
    const shouldSend = await beginLeadDelivery(pool, {
      tenantKey,
      callSid,
      channel: "email",
      destination
    });
    if (!shouldSend) continue;
    results.emailAttempted += 1;
    try {
      await sendEmail(pool, {
        tenantKey,
        destination,
        subject: emailPayload.subject,
        text: emailPayload.text
      });
      await markLeadDelivery(pool, {
        tenantKey,
        callSid,
        channel: "email",
        destination,
        status: "delivered"
      });
      results.emailDelivered += 1;
    } catch (err) {
      await markLeadDelivery(pool, {
        tenantKey,
        callSid,
        channel: "email",
        destination,
        status: "failed",
        errorCode: "send_failed",
        errorMessage: err instanceof Error ? err.message : "unknown"
      });
    }
  }

  return { ok: true, ...results };
}
