import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess, requireActiveTenantUser, requireTenantRoles, tenantUserHasAnyRole } from "../../_lib/billing.js";
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials
} from "../../_lib/integrationSecrets.js";
import {
  buildDefaultServiceTitanResourcePath,
  CANONICAL_CLASSIFICATION_TYPES,
  INTEGRATION_CONNECTOR_LABELS,
  INTEGRATION_CONNECTOR_TYPES,
  INTEGRATION_NATIVE_CONNECTOR_TYPES,
  listIntegrationConnections,
  parseConnectionConfig,
  sanitizeIntegrationConnection
} from "../../_lib/outboundIntegrations.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function writeAuditLog(pool, { tenantKey, actorId, action, details }) {
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [tenantKey, actorId, action, JSON.stringify(details || {})]
  );
}

function validateEndpointUrl(value) {
  const text = normalizeText(value);
  if (!text) {
    throw Object.assign(new Error("Endpoint URL is required."), { statusCode: 400 });
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw Object.assign(new Error("Endpoint URL is invalid."), { statusCode: 400 });
  }
  const isHttps = url.protocol === "https:";
  const isLocalHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:";
  if (!isHttps && !isLocalHttp) {
    throw Object.assign(new Error("Endpoint URL must use HTTPS."), { statusCode: 400 });
  }
  return url.toString();
}

function buildBaseConfig(body, connectorType) {
  const payload = asObject(body);
  const includeTypesRaw = Array.isArray(payload.includeTypes) ? payload.includeTypes : [];
  const includeTypes = includeTypesRaw
    .map((item) => normalizeText(item))
    .filter((item) => CANONICAL_CLASSIFICATION_TYPES.includes(item));
  const base = {
    includeTypes,
    includeNonBillable: payload.includeNonBillable !== false,
    includeDuplicates: payload.includeDuplicates !== false,
    includeTranscript: payload.includeTranscript === true
  };

  if (connectorType === INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp) {
    return parseConnectionConfig({
      ...base,
      createNote: payload.createNote !== false
    }, connectorType);
  }

  if (connectorType === INTEGRATION_CONNECTOR_TYPES.jobberClient) {
    return parseConnectionConfig({
      ...base,
      apiVersion: normalizeText(payload.apiVersion)
    }, connectorType);
  }

  if (connectorType === INTEGRATION_CONNECTOR_TYPES.servicetitanBooking) {
    const tenantId = normalizeText(payload.serviceTitanTenantId || payload.tenantId);
    const resourcePath = normalizeText(payload.resourcePath) || buildDefaultServiceTitanResourcePath(tenantId);
    return parseConnectionConfig({
      ...base,
      environment: normalizeText(payload.environment),
      tenantId,
      resourcePath
    }, connectorType);
  }

  return parseConnectionConfig(base, connectorType);
}

function mergeCredentials(existingCredentials, body, connectorType) {
  const current = asObject(existingCredentials);
  const payload = asObject(body);

  if (connectorType === INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp) {
    return {
      privateAppToken: normalizeText(payload.privateAppToken) || normalizeText(current.privateAppToken)
    };
  }

  if (connectorType === INTEGRATION_CONNECTOR_TYPES.jobberClient) {
    return {
      clientId: normalizeText(payload.clientId) || normalizeText(current.clientId),
      clientSecret: normalizeText(payload.clientSecret) || normalizeText(current.clientSecret),
      refreshToken: normalizeText(payload.refreshToken) || normalizeText(current.refreshToken)
    };
  }

  if (connectorType === INTEGRATION_CONNECTOR_TYPES.servicetitanBooking) {
    return {
      clientId: normalizeText(payload.clientId) || normalizeText(current.clientId),
      clientSecret: normalizeText(payload.clientSecret) || normalizeText(current.clientSecret),
      appKey: normalizeText(payload.appKey) || normalizeText(current.appKey)
    };
  }

  return {};
}

function assertRequiredCredentials(credentials, connectorType) {
  const normalized = asObject(credentials);
  const missing = [];
  if (connectorType === INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp) {
    if (!normalizeText(normalized.privateAppToken)) missing.push("privateAppToken");
  }
  if (connectorType === INTEGRATION_CONNECTOR_TYPES.jobberClient) {
    if (!normalizeText(normalized.clientId)) missing.push("clientId");
    if (!normalizeText(normalized.clientSecret)) missing.push("clientSecret");
    if (!normalizeText(normalized.refreshToken)) missing.push("refreshToken");
  }
  if (connectorType === INTEGRATION_CONNECTOR_TYPES.servicetitanBooking) {
    if (!normalizeText(normalized.clientId)) missing.push("clientId");
    if (!normalizeText(normalized.clientSecret)) missing.push("clientSecret");
    if (!normalizeText(normalized.appKey)) missing.push("appKey");
  }
  if (missing.length) {
    throw Object.assign(new Error(`Missing required credentials: ${missing.join(", ")}`), { statusCode: 400 });
  }
}

async function loadConnectionsAndDeliveries(pool, tenantKey) {
  const connections = await listIntegrationConnections(pool, {
    tenantKey,
    enabledOnly: false
  });
  const nativeConnections = connections.filter((row) => INTEGRATION_NATIVE_CONNECTOR_TYPES.includes(row.connector_type));
  const deliveries = await pool.query(
    `SELECT
       d.id,
       d.connection_id,
       c.name AS connection_name,
       c.connector_type,
       d.call_sid,
       d.event_type,
       d.event_version,
       d.event_id,
       d.delivery_id,
       d.attempt_number,
       d.status,
       d.request_url,
       d.response_status,
       d.response_body_excerpt,
       d.error_message,
       d.delivered_at,
       d.created_at
     FROM integration_deliveries d
     LEFT JOIN integration_connections c ON c.id = d.connection_id
     WHERE d.tenant_key = $1
       AND c.connector_type = ANY($2::text[])
     ORDER BY d.created_at DESC
     LIMIT 50`,
    [tenantKey, INTEGRATION_NATIVE_CONNECTOR_TYPES]
  );

  return {
    connections: nativeConnections.map((row) => sanitizeIntegrationConnection(row)),
    deliveries: deliveries.rows || []
  };
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, req.query?.tenantKey);
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    const viewer = session.role === "tenant" ? await requireActiveTenantUser(session) : null;
    if (!viewer) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (req.method === "GET") {
      const data = await loadConnectionsAndDeliveries(pool, tenantKey);
      return res.status(200).json({
        ok: true,
        viewer: {
          canManage: tenantUserHasAnyRole(viewer, ["owner", "admin"]),
          userRole: viewer.role || null
        },
        ...data
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
      message: "Only account admins and owners can manage integrations."
    });
    if (!manager) return;

    const body = asObject(req.body);
    const connectorType = normalizeText(body.connectorType);
    if (!INTEGRATION_NATIVE_CONNECTOR_TYPES.includes(connectorType)) {
      return res.status(400).json({ error: "invalid_connector_type" });
    }

    const connectionId = Number(body.connectionId || 0) || null;
    const status = normalizeText(body.status) === "disabled" || body.enabled === false ? "disabled" : "enabled";
    const config = buildBaseConfig(body, connectorType);
    const endpointUrl = connectorType === INTEGRATION_CONNECTOR_TYPES.zapierHook
      ? validateEndpointUrl(body.endpointUrl)
      : null;

    let existing = null;
    if (connectionId) {
      const result = await pool.query(
        `SELECT *
         FROM integration_connections
         WHERE id = $1
           AND tenant_key = $2
           AND connector_type = $3
         LIMIT 1`,
        [connectionId, tenantKey, connectorType]
      );
      existing = result.rows[0] || null;
      if (!existing) {
        return res.status(404).json({ error: "integration_connection_not_found" });
      }
    } else {
      const existingByType = await pool.query(
        `SELECT *
         FROM integration_connections
         WHERE tenant_key = $1
           AND connector_type = $2
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [tenantKey, connectorType]
      );
      existing = existingByType.rows[0] || null;
    }

    const currentCredentials = existing?.credentials_ciphertext ? decryptIntegrationCredentials(existing.credentials_ciphertext) : {};
    const credentials = mergeCredentials(currentCredentials, body, connectorType);
    assertRequiredCredentials(credentials, connectorType);
    const credentialsCiphertext = Object.keys(credentials).length ? encryptIntegrationCredentials(credentials) : null;
    const name = normalizeText(body.name) || existing?.name || INTEGRATION_CONNECTOR_LABELS[connectorType] || "Integration";

    let savedRow = null;
    if (existing) {
      const updated = await pool.query(
        `UPDATE integration_connections
         SET name = $3,
             status = $4,
             endpoint_url = $5,
             credentials_ciphertext = $6,
             config_json = $7::jsonb,
             reconnect_required = FALSE,
             updated_at = NOW()
         WHERE id = $1
           AND tenant_key = $2
         RETURNING *`,
        [
          existing.id,
          tenantKey,
          name,
          status,
          endpointUrl,
          credentialsCiphertext,
          JSON.stringify(config)
        ]
      );
      savedRow = updated.rows[0] || null;
      await writeAuditLog(pool, {
        tenantKey,
        actorId: `tenant_user:${viewer.id}`,
        action: "tenant.integration.connector_updated",
        details: {
          connection_id: existing.id,
          connector_type: connectorType,
          status,
          config
        }
      });
    } else {
      const inserted = await pool.query(
        `INSERT INTO integration_connections (
           tenant_key,
           connector_type,
           name,
           status,
           endpoint_url,
           credentials_ciphertext,
           config_json,
           reconnect_required,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, FALSE, NOW())
         RETURNING *`,
        [
          tenantKey,
          connectorType,
          name,
          status,
          endpointUrl,
          credentialsCiphertext,
          JSON.stringify(config)
        ]
      );
      savedRow = inserted.rows[0] || null;
      await writeAuditLog(pool, {
        tenantKey,
        actorId: `tenant_user:${viewer.id}`,
        action: "tenant.integration.connector_created",
        details: {
          connection_id: savedRow?.id || null,
          connector_type: connectorType,
          status,
          config
        }
      });
    }

    const data = await loadConnectionsAndDeliveries(pool, tenantKey);
    return res.status(200).json({
        ok: true,
        viewer: {
          canManage: true,
        userRole: viewer.role || null
      },
      connection: sanitizeIntegrationConnection(savedRow),
      ...data
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    return res.status(statusCode).json({
      error: "client_integrations_connectors_error",
      message: error?.message || "unknown"
    });
  }
}
