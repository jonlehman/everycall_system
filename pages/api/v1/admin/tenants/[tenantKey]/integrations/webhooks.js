import { ensureTables, getPool } from "../../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../../_lib/auth.js";
import { encryptIntegrationSecret } from "../../../../../_lib/integrationSecrets.js";
import { validateSafePublicEndpointUrl } from "../../../../../_lib/safePublicEndpoint.js";
import {
  CANONICAL_CLASSIFICATION_TYPES,
  createSigningSecret,
  INTEGRATION_CONNECTOR_TYPES,
  parseConnectionConfig,
  sanitizeIntegrationConnection
} from "../../../../../_lib/outboundIntegrations.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function actorId(actor, session) {
  if (actor?.id) return `admin:${actor.id}`;
  if (session?.user_id) return `admin:${session.user_id}`;
  return "admin:unknown";
}

async function writeAuditLog(pool, { tenantKey, actor, session, action, details }) {
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [tenantKey, actorId(actor, session), action, JSON.stringify(details || {})]
  );
}

function buildConfigFromBody(body) {
  const payload = asObject(body);
  const includeTypesRaw = Array.isArray(payload.includeTypes) ? payload.includeTypes : [];
  const includeTypes = includeTypesRaw
    .map((item) => normalizeText(item))
    .filter((item) => CANONICAL_CLASSIFICATION_TYPES.includes(item));
  return parseConnectionConfig({
    includeTypes,
    includeNonBillable: payload.includeNonBillable !== false,
    includeDuplicates: payload.includeDuplicates !== false,
    includeTranscript: payload.includeTranscript === true
  });
}

async function loadConnectionsAndDeliveries(pool, tenantKey) {
  const [connections, deliveries] = await Promise.all([
    pool.query(
      `SELECT *
       FROM integration_connections
       WHERE tenant_key = $1
         AND connector_type = $2
       ORDER BY created_at ASC, id ASC`,
      [tenantKey, INTEGRATION_CONNECTOR_TYPES.outboundWebhook]
    ),
    pool.query(
      `SELECT
         d.id,
         d.connection_id,
         c.name AS connection_name,
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
       ORDER BY d.created_at DESC
       LIMIT 50`,
      [tenantKey]
    )
  ]);

  return {
    connections: connections.rows.map((row) => sanitizeIntegrationConnection(row)),
    deliveries: deliveries.rows
  };
}

export default async function handler(req, res) {
  try {
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

    if (req.method === "GET") {
      const data = await loadConnectionsAndDeliveries(pool, tenantKey);
      return res.status(200).json({ ok: true, ...data });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const body = asObject(req.body);
    const connectionId = Number(body.connectionId || 0) || null;
    const name = normalizeText(body.name) || "Outbound Webhook";
    const endpointUrl = await validateSafePublicEndpointUrl(body.endpointUrl);
    const status = normalizeText(body.status) === "disabled" || body.enabled === false ? "disabled" : "enabled";
    const config = buildConfigFromBody(body);
    const providedSecret = normalizeText(body.signingSecret);

    let existing = null;
    if (connectionId) {
      const existingResult = await pool.query(
        `SELECT *
         FROM integration_connections
         WHERE id = $1
           AND tenant_key = $2
           AND connector_type = $3
         LIMIT 1`,
        [connectionId, tenantKey, INTEGRATION_CONNECTOR_TYPES.outboundWebhook]
      );
      existing = existingResult.rows[0] || null;
      if (!existing) {
        return res.status(404).json({ error: "integration_connection_not_found" });
      }
    }

    let generatedSecret = "";
    let signingSecretCiphertext = existing?.signing_secret_ciphertext || null;
    if (providedSecret) {
      signingSecretCiphertext = encryptIntegrationSecret(providedSecret);
    } else if (!existing) {
      generatedSecret = createSigningSecret();
      signingSecretCiphertext = encryptIntegrationSecret(generatedSecret);
    }

    if (!signingSecretCiphertext) {
      return res.status(400).json({ error: "missing_signing_secret", message: "A signing secret is required." });
    }

    let savedRow = null;
    if (existing) {
      const updated = await pool.query(
        `UPDATE integration_connections
         SET name = $3,
             status = $4,
             endpoint_url = $5,
             signing_secret_ciphertext = $6,
             config_json = $7::jsonb,
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
          signingSecretCiphertext,
          JSON.stringify(config)
        ]
      );
      savedRow = updated.rows[0] || null;
      await writeAuditLog(pool, {
        tenantKey,
        actor: admin,
        session,
        action: "admin.integration.webhook_updated",
        details: {
          connection_id: existing.id,
          endpoint_url: endpointUrl,
          status,
          signing_secret_rotated: Boolean(providedSecret),
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
           signing_secret_ciphertext,
           config_json,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
         RETURNING *`,
        [
          tenantKey,
          INTEGRATION_CONNECTOR_TYPES.outboundWebhook,
          name,
          status,
          endpointUrl,
          signingSecretCiphertext,
          JSON.stringify(config)
        ]
      );
      savedRow = inserted.rows[0] || null;
      await writeAuditLog(pool, {
        tenantKey,
        actor: admin,
        session,
        action: "admin.integration.webhook_created",
        details: {
          connection_id: savedRow?.id || null,
          endpoint_url: endpointUrl,
          status,
          generated_secret: Boolean(generatedSecret),
          config
        }
      });
    }

    const data = await loadConnectionsAndDeliveries(pool, tenantKey);
    return res.status(200).json({
      ok: true,
      connection: sanitizeIntegrationConnection(savedRow),
      generatedSecret: generatedSecret || null,
      ...data
    });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      error: "admin_integrations_webhooks_error",
      message: err?.message || "unknown"
    });
  }
}
