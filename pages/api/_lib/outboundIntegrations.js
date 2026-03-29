import crypto from "node:crypto";
import { buildTranscriptFromEvents, sanitizeTranscriptText } from "@everycall/contracts/callTranscript";
import { normalizePhoneNumber } from "./phone.js";
import {
  decryptIntegrationCredentials,
  decryptIntegrationSecret,
  createSigningSecret
} from "./integrationSecrets.js";

export const INTEGRATION_CONNECTOR_TYPES = {
  outboundWebhook: "outbound_webhook",
  zapierHook: "zapier_hook",
  hubspotPrivateApp: "hubspot_private_app",
  jobberClient: "jobber_client",
  servicetitanBooking: "servicetitan_booking"
};

export const INTEGRATION_NATIVE_CONNECTOR_TYPES = [
  INTEGRATION_CONNECTOR_TYPES.zapierHook,
  INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp,
  INTEGRATION_CONNECTOR_TYPES.jobberClient,
  INTEGRATION_CONNECTOR_TYPES.servicetitanBooking
];

export const INTEGRATION_CONNECTOR_LABELS = {
  [INTEGRATION_CONNECTOR_TYPES.outboundWebhook]: "Outbound Webhook",
  [INTEGRATION_CONNECTOR_TYPES.zapierHook]: "Zapier Catch Hook",
  [INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp]: "HubSpot",
  [INTEGRATION_CONNECTOR_TYPES.jobberClient]: "Jobber",
  [INTEGRATION_CONNECTOR_TYPES.servicetitanBooking]: "ServiceTitan"
};

export const INTEGRATION_EVENT_TYPES = {
  callCompleted: "call.completed",
  connectionTest: "integration.connection_test"
};

export const CANONICAL_CLASSIFICATION_TYPES = [
  "project_inquiry",
  "general_inquiry",
  "existing_customer_support",
  "vendor_or_sales",
  "spam",
  "wrong_number",
  "hangup_or_incomplete",
  "other_non_billable"
];

const DEFAULT_APP_BASE_URL = "https://app.everycall.io";
const DEFAULT_JOBBER_API_VERSION = normalizeText(process.env.JOBBER_API_VERSION || "2026-01-20") || "2026-01-20";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function truncateText(value, maxLength = 1200) {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function getAppBaseUrl() {
  return normalizeText(process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/+$/, "") || DEFAULT_APP_BASE_URL;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean)
    : [];
}

export function buildStableEventId({ tenantKey, callSid, eventType, eventVersion = 1 }) {
  const raw = `${normalizeText(tenantKey)}|${normalizeText(callSid)}|${normalizeText(eventType)}|${Number(eventVersion || 1)}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return `evt_${hash.slice(0, 24)}`;
}

export function createDeliveryId() {
  return createId("del");
}

export function buildDefaultServiceTitanResourcePath(tenantId) {
  const normalizedTenantId = normalizeText(tenantId);
  return normalizedTenantId ? `/crm/v2/tenant/${encodeURIComponent(normalizedTenantId)}/bookings` : "";
}

function getDefaultNativeFilters() {
  return {
    includeTypes: ["project_inquiry"],
    includeNonBillable: false,
    includeDuplicates: false,
    includeTranscript: false
  };
}

export function getDefaultConnectionConfig(connectorType = INTEGRATION_CONNECTOR_TYPES.outboundWebhook) {
  const normalizedType = normalizeText(connectorType);
  if (normalizedType === INTEGRATION_CONNECTOR_TYPES.zapierHook || normalizedType === INTEGRATION_CONNECTOR_TYPES.outboundWebhook) {
    return {
      includeTypes: [...CANONICAL_CLASSIFICATION_TYPES],
      includeNonBillable: true,
      includeDuplicates: true,
      includeTranscript: false
    };
  }
  if (normalizedType === INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp) {
    return {
      ...getDefaultNativeFilters(),
      createNote: true
    };
  }
  if (normalizedType === INTEGRATION_CONNECTOR_TYPES.jobberClient) {
    return {
      ...getDefaultNativeFilters(),
      apiVersion: DEFAULT_JOBBER_API_VERSION
    };
  }
  if (normalizedType === INTEGRATION_CONNECTOR_TYPES.servicetitanBooking) {
    return {
      ...getDefaultNativeFilters(),
      environment: "integration",
      tenantId: "",
      resourcePath: ""
    };
  }
  return {
    includeTypes: [...CANONICAL_CLASSIFICATION_TYPES],
    includeNonBillable: true,
    includeDuplicates: true,
    includeTranscript: false
  };
}

export function parseConnectionConfig(configValue, connectorType = INTEGRATION_CONNECTOR_TYPES.outboundWebhook) {
  const source = asObject(configValue);
  const defaultConfig = getDefaultConnectionConfig(connectorType);
  const normalizedTypes = asStringArray(source.includeTypes);
  const normalized = {
    includeTypes: normalizedTypes.length ? normalizedTypes.filter((value) => CANONICAL_CLASSIFICATION_TYPES.includes(value)) : defaultConfig.includeTypes,
    includeNonBillable: source.includeNonBillable !== false,
    includeDuplicates: source.includeDuplicates !== false,
    includeTranscript: source.includeTranscript === true
  };
  if (connectorType === INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp) {
    return {
      ...normalized,
      createNote: source.createNote !== false
    };
  }
  if (connectorType === INTEGRATION_CONNECTOR_TYPES.jobberClient) {
    return {
      ...normalized,
      apiVersion: normalizeText(source.apiVersion) || defaultConfig.apiVersion
    };
  }
  if (connectorType === INTEGRATION_CONNECTOR_TYPES.servicetitanBooking) {
    const tenantId = normalizeText(source.tenantId);
    return {
      ...normalized,
      environment: normalizeText(source.environment).toLowerCase() === "production" ? "production" : "integration",
      tenantId,
      resourcePath: normalizeText(source.resourcePath) || buildDefaultServiceTitanResourcePath(tenantId)
    };
  }
  return normalized;
}

export function sanitizeIntegrationConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    connectorType: row.connector_type,
    name: row.name,
    status: row.status,
    endpointUrl: row.endpoint_url,
    secretConfigured: Boolean(normalizeText(row.signing_secret_ciphertext)),
    credentialsConfigured: Boolean(normalizeText(row.credentials_ciphertext)),
    config: parseConnectionConfig(row.config_json, row.connector_type),
    reconnectRequired: Boolean(row.reconnect_required),
    lastTestStatus: row.last_test_status || null,
    lastTestedAt: row.last_tested_at || null,
    lastTestError: row.last_test_error || null,
    lastDeliverySucceededAt: row.last_delivery_succeeded_at || null,
    lastDeliveryFailedAt: row.last_delivery_failed_at || null,
    lastDeliveryError: row.last_delivery_error || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export function getWebhookConnectionSecret(connectionRow) {
  const ciphertext = normalizeText(connectionRow?.signing_secret_ciphertext);
  if (!ciphertext) {
    throw new Error("integration_signing_secret_missing");
  }
  return decryptIntegrationSecret(ciphertext);
}

export function getIntegrationConnectionCredentials(connectionRow) {
  const ciphertext = normalizeText(connectionRow?.credentials_ciphertext);
  return ciphertext ? decryptIntegrationCredentials(ciphertext) : {};
}

export function normalizeClassificationType(outcomeType, isValidLead) {
  const normalized = normalizeText(outcomeType).toLowerCase();
  if (
    isValidLead
    || [
      "callback_request",
      "estimate_request",
      "quote_request",
      "consultation_request",
      "appointment_request",
      "project_request",
      "project_inquiry",
      "service_request",
      "lead",
      "new_customer_lead",
      "message_taken",
      "transfer"
    ].includes(normalized)
  ) {
    return "project_inquiry";
  }
  if (["general_inquiry", "general_question", "question_only"].includes(normalized)) {
    return "general_inquiry";
  }
  if (normalized === "existing_customer_support" || normalized === "existing_customer") {
    return "existing_customer_support";
  }
  if (["vendor_or_sales", "vendor", "sales_call"].includes(normalized)) {
    return "vendor_or_sales";
  }
  if (normalized === "spam") {
    return "spam";
  }
  if (normalized === "wrong_number") {
    return "wrong_number";
  }
  if (["hangup", "hangup_incomplete", "canceled"].includes(normalized)) {
    return "hangup_or_incomplete";
  }
  return "other_non_billable";
}

async function loadTranscript(pool, callSid, row) {
  const existing = sanitizeTranscriptText(row?.transcript_combined || "")
    || sanitizeTranscriptText(row?.transcript || "");
  if (existing) return existing;
  const events = await pool.query(
    `SELECT role, text, event_type
     FROM call_events
     WHERE call_sid = $1
     ORDER BY created_at ASC`,
    [callSid]
  );
  if (!events.rowCount) return "";
  return buildTranscriptFromEvents(events.rows);
}

export async function buildCallCompletedEvent(pool, {
  tenantKey,
  callSid,
  includeTranscript = false,
  deliveryId = null,
  eventId = null
}) {
  const result = await pool.query(
    `SELECT
       t.name AS tenant_name,
       c.call_sid,
       c.from_number,
       c.to_number,
       c.status,
       c.summary,
       c.created_at,
       c.completed_at,
       c.lead_outcome_type,
       c.lead_is_valid,
       c.lead_is_billable,
       c.lead_decision_reason,
       c.lead_duplicate_of_call_sid,
       d.transcript,
       d.transcript_combined,
       d.caller_first_name,
       d.caller_last_name,
       d.callback_number,
       d.service_required,
       d.address_line1,
       d.address_line2,
       d.city,
       d.state,
       d.postal_code
     FROM calls c
     JOIN tenants t ON t.tenant_key = c.tenant_key
     LEFT JOIN call_details d ON d.call_sid = c.call_sid
     WHERE c.tenant_key = $1
       AND c.call_sid = $2
     LIMIT 1`,
    [tenantKey, callSid]
  );
  const row = result.rows[0] || null;
  if (!row) {
    throw new Error("integration_call_not_found");
  }
  if (!normalizeText(row.summary)) {
    throw new Error("integration_summary_missing");
  }

  const canonicalType = normalizeClassificationType(row.lead_outcome_type, row.lead_is_valid);
  const transcript = includeTranscript ? await loadTranscript(pool, callSid, row) : null;
  const nextDeliveryId = normalizeText(deliveryId) || createDeliveryId();
  const nextEventId = normalizeText(eventId) || buildStableEventId({
    tenantKey,
    callSid,
    eventType: INTEGRATION_EVENT_TYPES.callCompleted,
    eventVersion: 1
  });
  const occurredAtSource = row.completed_at || row.created_at || new Date();

  return {
    event_id: nextEventId,
    delivery_id: nextDeliveryId,
    event_type: INTEGRATION_EVENT_TYPES.callCompleted,
    event_version: 1,
    occurred_at: new Date(occurredAtSource).toISOString(),
    tenant: {
      tenant_key: tenantKey,
      name: row.tenant_name
    },
    call: {
      call_sid: row.call_sid,
      from_number: normalizePhoneNumber(row.from_number) || normalizeText(row.from_number) || null,
      to_number: normalizePhoneNumber(row.to_number) || normalizeText(row.to_number) || null,
      status: normalizeText(row.status) || "completed",
      received_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      summary: normalizeText(row.summary)
    },
    caller: {
      first_name: normalizeText(row.caller_first_name) || null,
      last_name: normalizeText(row.caller_last_name) || null,
      callback_number: normalizePhoneNumber(row.callback_number) || normalizeText(row.callback_number) || null,
      service_request: normalizeText(row.service_required) || null,
      address_line1: normalizeText(row.address_line1) || null,
      address_line2: normalizeText(row.address_line2) || null,
      city: normalizeText(row.city) || null,
      state: normalizeText(row.state) || null,
      postal_code: normalizeText(row.postal_code) || null
    },
    classification: {
      type: canonicalType,
      is_valid_lead: Boolean(row.lead_is_valid),
      is_billable_lead: Boolean(row.lead_is_billable),
      decision_reason: normalizeText(row.lead_decision_reason) || null,
      duplicate_of_call_sid: normalizeText(row.lead_duplicate_of_call_sid) || null
    },
    artifacts: {
      transcript: includeTranscript ? (transcript || null) : null,
      transcript_url: null,
      recording_url: null,
      app_url: `${getAppBaseUrl()}/client/calls${callSid ? `?callSid=${encodeURIComponent(callSid)}` : ""}`
    }
  };
}

export function shouldDeliverConnection({ payload, config, connectorType = INTEGRATION_CONNECTOR_TYPES.outboundWebhook }) {
  const normalizedConfig = parseConnectionConfig(config, connectorType);
  const classification = asObject(payload?.classification);
  const type = normalizeText(classification.type);
  if (!type || !normalizedConfig.includeTypes.includes(type)) {
    return { deliver: false, reason: "type_filtered_out" };
  }
  if (!normalizedConfig.includeNonBillable && !classification.is_billable_lead) {
    return { deliver: false, reason: "non_billable_filtered_out" };
  }
  if (!normalizedConfig.includeDuplicates && normalizeText(classification.duplicate_of_call_sid)) {
    return { deliver: false, reason: "duplicate_filtered_out" };
  }
  return { deliver: true, reason: null };
}

export function buildSignedWebhookRequest({
  endpointUrl,
  signingSecret,
  payload,
  attemptNumber = 1
}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");

  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-EveryCall-Event-Id": String(payload.event_id || ""),
      "X-EveryCall-Delivery-Id": String(payload.delivery_id || ""),
      "X-EveryCall-Event-Type": String(payload.event_type || ""),
      "X-EveryCall-Event-Version": String(payload.event_version || 1),
      "X-EveryCall-Timestamp": timestamp,
      "X-EveryCall-Delivery-Attempt": String(attemptNumber || 1),
      "X-EveryCall-Signature": signature
    },
    endpointUrl
  };
}

export async function recordIntegrationDelivery(pool, {
  tenantKey,
  connectionId,
  callSid = null,
  eventType,
  eventVersion = 1,
  eventId,
  deliveryId,
  attemptNumber = 1,
  status,
  requestUrl = null,
  responseStatus = null,
  responseBodyExcerpt = null,
  errorMessage = null
}) {
  await pool.query(
    `INSERT INTO integration_deliveries (
       tenant_key,
       connection_id,
       call_sid,
       event_type,
       event_version,
       event_id,
       delivery_id,
       attempt_number,
       status,
       request_url,
       response_status,
       response_body_excerpt,
       error_message,
       delivered_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $9 = 'delivered' THEN NOW() ELSE NULL END)`,
    [
      tenantKey,
      connectionId,
      callSid,
      eventType,
      eventVersion,
      eventId,
      deliveryId,
      attemptNumber,
      status,
      requestUrl,
      Number.isFinite(Number(responseStatus)) ? Number(responseStatus) : null,
      truncateText(responseBodyExcerpt, 4000) || null,
      truncateText(errorMessage, 2000) || null
    ]
  );
}

export async function updateConnectionDeliveryHealth(pool, {
  connectionId,
  status,
  errorMessage = null
}) {
  if (!connectionId) return;
  if (status === "delivered") {
    await pool.query(
      `UPDATE integration_connections
       SET last_delivery_succeeded_at = NOW(),
           last_delivery_error = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [connectionId]
    );
    return;
  }
  if (status === "failed") {
    await pool.query(
      `UPDATE integration_connections
       SET last_delivery_failed_at = NOW(),
           last_delivery_error = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [connectionId, truncateText(errorMessage, 1000) || "unknown"]
    );
  }
}

export async function updateConnectionTestStatus(pool, {
  connectionId,
  status,
  errorMessage = null
}) {
  await pool.query(
    `UPDATE integration_connections
     SET last_test_status = $2,
         last_tested_at = NOW(),
         last_test_error = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [connectionId, status, truncateText(errorMessage, 1000) || null]
  );
}

export async function loadIntegrationConnection(pool, {
  tenantKey,
  connectionId
}) {
  const result = await pool.query(
    `SELECT *
     FROM integration_connections
     WHERE tenant_key = $1
       AND id = $2
     LIMIT 1`,
    [tenantKey, connectionId]
  );
  return result.rows[0] || null;
}

export async function listIntegrationConnections(pool, {
  tenantKey,
  connectorType = null,
  enabledOnly = false
}) {
  const conditions = [`tenant_key = $1`];
  const values = [tenantKey];
  if (normalizeText(connectorType)) {
    values.push(normalizeText(connectorType));
    conditions.push(`connector_type = $${values.length}`);
  }
  if (enabledOnly) {
    conditions.push(`status = 'enabled'`);
  }
  const result = await pool.query(
    `SELECT *
     FROM integration_connections
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at ASC, id ASC`,
    values
  );
  return result.rows || [];
}

export function buildConnectionTestPayload({ tenantKey, tenantName }) {
  return {
    event_id: createId("evt_test"),
    delivery_id: createDeliveryId(),
    event_type: INTEGRATION_EVENT_TYPES.connectionTest,
    event_version: 1,
    occurred_at: new Date().toISOString(),
    tenant: {
      tenant_key: tenantKey,
      name: tenantName
    },
    message: "EveryCall outbound webhook test"
  };
}

export { createSigningSecret };
