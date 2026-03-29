import { ensureTables, getPool } from "../../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../../_lib/auth.js";
import { testIntegrationConnection } from "../../../../../../_lib/integrationConnectors.js";
import {
  INTEGRATION_NATIVE_CONNECTOR_TYPES,
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
         AND c.connector_type = ANY($3::text[])
       LIMIT 1`,
      [connectionId, tenantKey, INTEGRATION_NATIVE_CONNECTOR_TYPES]
    );
    const connection = result.rows[0] || null;
    if (!connection) {
      return res.status(404).json({ error: "integration_connection_not_found" });
    }

    try {
      const delivery = await testIntegrationConnection(pool, {
        connection,
        tenantKey,
        tenantName: connection.tenant_name
      });
      await recordIntegrationDelivery(pool, {
        tenantKey,
        connectionId,
        callSid: null,
        eventType: "integration.connection_test",
        eventVersion: 1,
        eventId: `evt_test_${connectionId}_${Date.now()}`,
        deliveryId: `del_test_${connectionId}_${Date.now()}`,
        attemptNumber: 1,
        status: "delivered",
        requestUrl: delivery.requestUrl,
        responseStatus: delivery.responseStatus,
        responseBodyExcerpt: delivery.responseBody
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
        responseStatus: delivery.responseStatus,
        responseBody: delivery.responseBody,
        connection: sanitizeIntegrationConnection(refreshed.rows[0] || connection)
      });
    } catch (error) {
      await recordIntegrationDelivery(pool, {
        tenantKey,
        connectionId,
        callSid: null,
        eventType: "integration.connection_test",
        eventVersion: 1,
        eventId: `evt_test_${connectionId}_${Date.now()}`,
        deliveryId: `del_test_${connectionId}_${Date.now()}`,
        attemptNumber: 1,
        status: "failed",
        requestUrl: error?.requestUrl || connection.endpoint_url,
        responseStatus: error?.responseStatus,
        responseBodyExcerpt: error?.responseBodyExcerpt,
        errorMessage: error?.message || "integration_test_failed"
      });
      await updateConnectionTestStatus(pool, {
        connectionId,
        status: "failed",
        errorMessage: error?.message || "integration_test_failed"
      });
      return res.status(502).json({
        error: "integration_test_failed",
        message: error?.message || "Integration test failed.",
        responseStatus: error?.responseStatus || null,
        responseBody: error?.responseBodyExcerpt || null,
        connection: sanitizeIntegrationConnection(connection)
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: "admin_integrations_connector_test_error",
      message: error?.message || "unknown"
    });
  }
}
