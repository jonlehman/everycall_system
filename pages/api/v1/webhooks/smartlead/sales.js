import crypto from "node:crypto";
import { ensureTables, getPool } from "../../../_lib/db.js";
import {
  getSalesProspectByNormalizedEmail,
  updateSalesProspectEmailState
} from "../../../_lib/salesRepository.js";

function normalizeText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length
    && leftBuffer.length > 0
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req) {
  const configured = normalizeText(process.env.SMARTLEAD_SALES_WEBHOOK_SECRET, 1000);
  const supplied = normalizeText(
    req.headers["x-everycall-webhook-secret"] || req.query?.secret,
    1000
  );
  return safeEqual(configured, supplied);
}

function normalizeEvent(body) {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const type = normalizeText(
    payload.event_type || payload.eventType || payload.type || payload.event,
    160
  ).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const email = normalizeText(
    payload.lead_email
      || payload.leadEmail
      || payload.email
      || payload.lead?.email,
    320
  ).toLowerCase();
  const occurredInput = payload.timestamp || payload.occurred_at || payload.created_at || null;
  let occurredAt = null;
  if (occurredInput) {
    const numeric = Number(occurredInput);
    const date = Number.isFinite(numeric)
      ? new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000)
      : new Date(occurredInput);
    if (!Number.isNaN(date.getTime())) occurredAt = date.toISOString();
  }
  const explicitId = normalizeText(
    payload.webhook_id || payload.event_id,
    240
  );
  const eventId = explicitId || crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
  const storedPayload = {
    campaignId: normalizeText(payload.campaign_id || payload.campaignId, 240) || null,
    leadId: normalizeText(payload.lead_id || payload.leadId || payload.lead?.id, 240) || null,
    messageId: normalizeText(payload.message_id || payload.messageId, 240) || null,
    emailAccountId: normalizeText(
      payload.email_account_id || payload.emailAccountId,
      240
    ) || null,
    sequenceNumber: normalizeText(
      payload.sequence_number || payload.sequenceNumber,
      80
    ) || null
  };
  return { storedPayload, type: type || "unknown", email, occurredAt, eventId };
}

function prospectChangesForEvent(type, occurredAt) {
  const common = {
    lastEmailEventAt: occurredAt || new Date().toISOString()
  };
  if (type.includes("unsubscribe")) {
    return {
      ...common,
      emailSuppressed: true,
      emailSuppressionReason: "smartlead_unsubscribe",
      smartleadStatus: "unsubscribed"
    };
  }
  if (type.includes("bounce")) {
    return {
      ...common,
      emailSuppressed: true,
      emailSuppressionReason: "smartlead_bounce",
      smartleadStatus: "bounced"
    };
  }
  if (type.includes("reply")) {
    return { ...common, smartleadStatus: "replied" };
  }
  return { ...common, smartleadStatus: type };
}

async function persistEvent(pool, event) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prospect = event.email
      ? await getSalesProspectByNormalizedEmail(client, event.email)
      : null;
    const inserted = await client.query(
      `INSERT INTO sales_email_events (
         provider, event_id, prospect_id, email, type, payload_json, occurred_at
       )
       VALUES ('smartlead', $1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()))
       ON CONFLICT (provider, event_id)
       DO NOTHING
       RETURNING sales_email_event_id`,
      [
        event.eventId,
        prospect?.prospectId || null,
        event.email || null,
        event.type,
        JSON.stringify(event.storedPayload),
        event.occurredAt
      ]
    );
    if (inserted.rowCount && prospect && event.email) {
      await updateSalesProspectEmailState(
        client,
        event.email,
        prospectChangesForEvent(event.type, event.occurredAt)
      );
    }
    await client.query("COMMIT");
    return Boolean(inserted.rowCount);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "database_unavailable" });
    }
    await ensureTables(pool);
    const event = normalizeEvent(req.body);
    const inserted = await persistEvent(pool, event);
    return res.status(200).json({
      ok: true,
      accepted: true,
      replayed: !inserted
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "smartlead_sales_webhook_failed"
    });
  }
}
