import { ensureTables, getPool } from "../../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../../_lib/auth.js";
import {
  buildConnectionTestPayload,
  buildSignedWebhookRequest,
  getWebhookConnectionSecret,
  INTEGRATION_CONNECTOR_TYPES,
  recordIntegrationDelivery,
  sanitizeIntegrationConnection,
  updateConnectionTestStatus
} from "../../../../../../_lib/outboundIntegrations.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const tenantKey = normalizeText(req.query?.tenantKey);
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const body = asObject(req.body);
    const connectionId = Number(body.connectionId || 0);
    if (!Number.isFinite(connectionId) || connectionId <= 0) {
      return res.status(400).json({ error: "missing_connection_id" });
    }

    const result = await pool.query(
      `SELECT c.*, t.name AS tenant_name
       FROM integration_connections c
       JOIN tenants t ON t.tenant_key = c.tenant_key
       WHERE c.id = $1
         AND c.tenant_key = $2
         AND c.connector_type = $3
       LIMIT 1`,
      [connectionId, tenantKey, INTEGRATION_CONNECTOR_TYPES.outboundWebhook]
    );
    const connection = result.rows[0] || null;
    if (!connection) {
      return res.status(404).json({ error: "integration_connection_not_found" });
    }

    const payload = buildConnectionTestPayload({
      tenantKey,
      tenantName: connection.tenant_name
    });
    const request = buildSignedWebhookRequest({
      endpointUrl: connection.endpoint_url,
      signingSecret: getWebhookConnectionSecret(connection),
      payload,
      attemptNumber: 1
    });

    const response = await fetch(request.endpointUrl, {
      method: "POST",
      headers: request.headers,
      body: request.body
    });
    const responseText = await response.text().catch(() => "");

    if (!response.ok) {
      await recordIntegrationDelivery(pool, {
        tenantKey,
        connectionId,
        callSid: null,
        eventType: payload.event_type,
        eventVersion: payload.event_version,
        eventId: payload.event_id,
        deliveryId: payload.delivery_id,
        attemptNumber: 1,
        status: "failed",
        requestUrl: connection.endpoint_url,
        responseStatus: response.status,
        responseBodyExcerpt: responseText,
        errorMessage: `http_${response.status}`
      });
      await updateConnectionTestStatus(pool, {
        connectionId,
        status: "failed",
        errorMessage: `HTTP ${response.status}: ${responseText || "unknown"}`
      });
      return res.status(502).json({
        error: "integration_test_failed",
        message: `Webhook test returned HTTP ${response.status}.`,
        responseStatus: response.status,
        responseBody: responseText,
        connection: sanitizeIntegrationConnection(connection)
      });
    }

    await recordIntegrationDelivery(pool, {
      tenantKey,
      connectionId,
      callSid: null,
      eventType: payload.event_type,
      eventVersion: payload.event_version,
      eventId: payload.event_id,
      deliveryId: payload.delivery_id,
      attemptNumber: 1,
      status: "delivered",
      requestUrl: connection.endpoint_url,
      responseStatus: response.status,
      responseBodyExcerpt: responseText
    });
    await updateConnectionTestStatus(pool, {
      connectionId,
      status: "passed"
    });

    const refreshed = await pool.query(
      `SELECT *
       FROM integration_connections
       WHERE id = $1
       LIMIT 1`,
      [connectionId]
    );

    return res.status(200).json({
      ok: true,
      responseStatus: response.status,
      responseBody: responseText,
      connection: sanitizeIntegrationConnection(refreshed.rows[0] || connection)
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_integrations_webhook_test_error",
      message: err?.message || "unknown"
    });
  }
}
