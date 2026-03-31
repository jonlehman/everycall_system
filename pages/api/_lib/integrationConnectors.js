import { normalizePhoneNumber } from "./phone.js";
import { encryptIntegrationCredentials } from "./integrationSecrets.js";
import {
  buildCallCompletedEvent,
  buildConnectionTestPayload,
  buildDefaultServiceTitanResourcePath,
  buildSignedWebhookRequest,
  getIntegrationConnectionCredentials,
  getWebhookConnectionSecret,
  INTEGRATION_CONNECTOR_LABELS,
  INTEGRATION_CONNECTOR_TYPES,
  parseConnectionConfig,
  serializeIntegrationPayload,
  shouldDeliverConnection
} from "./outboundIntegrations.js";

const MAX_CONNECTOR_NOTE_TRANSCRIPT_CHARS = 8_000;

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stripPhoneDigits(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function stringifyResponseBody(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function buildEveryCallHeaders(payload, attemptNumber = 1) {
  return {
    "Content-Type": "application/json",
    "X-EveryCall-Event-Id": String(payload.event_id || ""),
    "X-EveryCall-Delivery-Id": String(payload.delivery_id || ""),
    "X-EveryCall-Event-Type": String(payload.event_type || ""),
    "X-EveryCall-Event-Version": String(payload.event_version || 1),
    "X-EveryCall-Delivery-Attempt": String(attemptNumber || 1)
  };
}

function getBestPhoneNumber(payload) {
  return normalizeText(payload?.caller?.callback_number)
    || normalizeText(payload?.call?.from_number)
    || "";
}

function createConnectorError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details || {});
  return error;
}

async function readResponse(response) {
  const text = await response.text().catch(() => "");
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return {
    status: response.status,
    ok: response.ok,
    text,
    json: parsed
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const parsed = await readResponse(response);
  if (!parsed.ok) {
    throw createConnectorError(`http_${parsed.status}`, {
      requestUrl: url,
      responseStatus: parsed.status,
      responseBodyExcerpt: parsed.text || stringifyResponseBody(parsed.json)
    });
  }
  return parsed;
}

function formatClassificationLabel(type) {
  return normalizeText(type)
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCallerName(payload) {
  const first = normalizeText(payload?.caller?.first_name);
  const last = normalizeText(payload?.caller?.last_name);
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  const callback = normalizeText(payload?.caller?.callback_number);
  return callback || "Unknown Caller";
}

function buildCallNoteBody(payload, { includeTranscript = false } = {}) {
  const lines = [
    `EveryCall ${payload?.classification?.is_valid_lead ? "valid lead" : "call"}: ${formatClassificationLabel(payload?.classification?.type) || "Call"}`,
    "",
    `Summary: ${normalizeText(payload?.call?.summary) || "No summary available."}`
  ];
  if (normalizeText(payload?.caller?.service_request)) {
    lines.push(`Service request: ${payload.caller.service_request}`);
  }
  if (normalizeText(payload?.caller?.callback_number)) {
    lines.push(`Callback: ${payload.caller.callback_number}`);
  }
  if (normalizeText(payload?.classification?.decision_reason)) {
    lines.push(`Reason: ${payload.classification.decision_reason}`);
  }
  if (normalizeText(payload?.artifacts?.app_url)) {
    lines.push(`EveryCall: ${payload.artifacts.app_url}`);
  }
  if (includeTranscript && normalizeText(payload?.artifacts?.transcript)) {
    lines.push("", "Transcript:", String(payload.artifacts.transcript).slice(0, MAX_CONNECTOR_NOTE_TRANSCRIPT_CHARS));
  }
  return lines.join("\n");
}

async function sendWebhookLikeConnection({ connection, payload, attemptNumber, signed }) {
  const endpointUrl = normalizeText(connection?.endpoint_url);
  if (!endpointUrl) {
    throw createConnectorError("integration_endpoint_missing");
  }

  if (signed) {
    const request = buildSignedWebhookRequest({
      endpointUrl,
      signingSecret: getWebhookConnectionSecret(connection),
      payload,
      attemptNumber
    });
    const response = await requestJson(request.endpointUrl, {
      method: "POST",
      headers: request.headers,
      body: request.body
    });
    return {
      requestUrl: request.endpointUrl,
      responseStatus: response.status,
      responseBody: response.text,
      responseBodyExcerpt: response.text
    };
  }

  const body = serializeIntegrationPayload(payload);
  const headers = buildEveryCallHeaders(payload, attemptNumber);
  const response = await requestJson(endpointUrl, {
    method: "POST",
    headers,
    body
  });
  return {
    requestUrl: endpointUrl,
    responseStatus: response.status,
    responseBody: response.text,
    responseBodyExcerpt: response.text
  };
}

function buildHubSpotPhoneSearchGroups(phoneValue) {
  const values = [
    normalizePhoneNumber(phoneValue),
    normalizeText(phoneValue),
    stripPhoneDigits(phoneValue)
  ].filter(Boolean);
  const groups = [];
  for (const value of values) {
    groups.push({ filters: [{ propertyName: "phone", operator: "EQ", value }] });
    groups.push({ filters: [{ propertyName: "mobilephone", operator: "EQ", value }] });
  }
  return groups;
}

async function findHubSpotContact(token, payload) {
  const callbackNumber = getBestPhoneNumber(payload);
  if (!callbackNumber) return null;
  const response = await requestJson("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filterGroups: buildHubSpotPhoneSearchGroups(callbackNumber),
      properties: ["firstname", "lastname", "phone", "mobilephone"],
      limit: 1
    })
  });
  return Array.isArray(response.json?.results) && response.json.results.length ? response.json.results[0] : null;
}

function buildHubSpotContactProperties(payload) {
  const properties = {};
  const firstName = normalizeText(payload?.caller?.first_name);
  const lastName = normalizeText(payload?.caller?.last_name);
  const callbackNumber = getBestPhoneNumber(payload);
  if (firstName) properties.firstname = firstName;
  if (lastName) properties.lastname = lastName;
  if (callbackNumber) properties.phone = callbackNumber;
  return properties;
}

async function deliverHubSpotConnection(connection, payload) {
  const credentials = getIntegrationConnectionCredentials(connection);
  const token = normalizeText(credentials.privateAppToken);
  if (!token) {
    throw createConnectorError("hubspot_private_app_token_missing");
  }

  const config = parseConnectionConfig(connection.config_json, connection.connector_type);
  const existingContact = await findHubSpotContact(token, payload);
  const properties = buildHubSpotContactProperties(payload);
  let contactId = normalizeText(existingContact?.id);
  let requestUrl = "https://api.hubapi.com/crm/v3/objects/contacts";
  let lastResponseText = "";
  let lastResponseStatus = 200;

  if (contactId) {
    const response = await requestJson(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties })
    });
    requestUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`;
    lastResponseStatus = response.status;
    lastResponseText = response.text;
  } else {
    const response = await requestJson("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ properties })
    });
    contactId = normalizeText(response.json?.id);
    requestUrl = "https://api.hubapi.com/crm/v3/objects/contacts";
    lastResponseStatus = response.status;
    lastResponseText = response.text;
  }

  if (config.createNote && contactId) {
    const noteResponse = await requestJson("https://api.hubapi.com/crm/v3/objects/notes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: {
          hs_note_body: buildCallNoteBody(payload, { includeTranscript: config.includeTranscript }),
          hs_timestamp: payload.occurred_at
        },
        associations: [
          {
            to: { id: contactId },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 202
              }
            ]
          }
        ]
      })
    });
    requestUrl = "https://api.hubapi.com/crm/v3/objects/notes";
    lastResponseStatus = noteResponse.status;
    lastResponseText = noteResponse.text;
  }

  return {
    requestUrl,
    responseStatus: lastResponseStatus,
    responseBody: lastResponseText,
    responseBodyExcerpt: lastResponseText
  };
}

async function refreshJobberAccessToken(pool, connection) {
  const credentials = getIntegrationConnectionCredentials(connection);
  const clientId = normalizeText(credentials.clientId);
  const clientSecret = normalizeText(credentials.clientSecret);
  const refreshToken = normalizeText(credentials.refreshToken);
  if (!clientId || !clientSecret || !refreshToken) {
    throw createConnectorError("jobber_credentials_missing");
  }
  const response = await requestJson("https://api.getjobber.com/api/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }).toString()
  });

  const accessToken = normalizeText(response.json?.access_token);
  const nextRefreshToken = normalizeText(response.json?.refresh_token);
  if (!accessToken) {
    throw createConnectorError("jobber_access_token_missing", {
      responseStatus: response.status,
      responseBodyExcerpt: response.text
    });
  }
  if (nextRefreshToken && nextRefreshToken !== refreshToken) {
    await pool.query(
      `UPDATE integration_connections
       SET credentials_ciphertext = $2,
           reconnect_required = FALSE,
           updated_at = NOW()
       WHERE id = $1`,
      [
        connection.id,
        encryptIntegrationCredentials({
          ...credentials,
          refreshToken: nextRefreshToken
        })
      ]
    );
  }
  return accessToken;
}

async function jobberGraphqlRequest(accessToken, apiVersion, { query, variables = {} }) {
  const response = await requestJson("https://api.getjobber.com/api/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": normalizeText(apiVersion)
    },
    body: JSON.stringify({ query, variables })
  });
  if (Array.isArray(response.json?.errors) && response.json.errors.length) {
    throw createConnectorError("jobber_graphql_failed", {
      requestUrl: "https://api.getjobber.com/api/graphql",
      responseStatus: response.status,
      responseBodyExcerpt: stringifyResponseBody(response.json.errors)
    });
  }
  return response;
}

function buildJobberClientInput(payload) {
  const callbackNumber = getBestPhoneNumber(payload);
  const firstName = normalizeText(payload?.caller?.first_name) || "EveryCall";
  const lastName = normalizeText(payload?.caller?.last_name) || "Lead";
  const input = {
    firstName,
    lastName
  };
  if (callbackNumber) {
    input.phones = [
      {
        description: "MAIN",
        primary: true,
        number: callbackNumber
      }
    ];
  }
  return input;
}

async function deliverJobberConnection(pool, connection, payload) {
  const config = parseConnectionConfig(connection.config_json, connection.connector_type);
  const accessToken = await refreshJobberAccessToken(pool, connection);
  const response = await jobberGraphqlRequest(accessToken, config.apiVersion, {
    query: `
      mutation EveryCallCreateClient($input: ClientCreateInput!) {
        clientCreate(input: $input) {
          client {
            id
            firstName
            lastName
            jobberWebUri
          }
          userErrors {
            message
            path
          }
        }
      }
    `,
    variables: {
      input: buildJobberClientInput(payload)
    }
  });
  const userErrors = Array.isArray(response.json?.data?.clientCreate?.userErrors)
    ? response.json.data.clientCreate.userErrors.filter((item) => normalizeText(item?.message))
    : [];
  if (userErrors.length) {
    throw createConnectorError("jobber_client_create_failed", {
      requestUrl: "https://api.getjobber.com/api/graphql",
      responseStatus: response.status,
      responseBodyExcerpt: JSON.stringify(userErrors)
    });
  }
  return {
    requestUrl: "https://api.getjobber.com/api/graphql",
    responseStatus: response.status,
    responseBody: response.text,
    responseBodyExcerpt: response.text
  };
}

function getServiceTitanEnvironmentConfig(config) {
  return normalizeText(config?.environment).toLowerCase() === "production"
    ? {
        authBaseUrl: "https://auth.servicetitan.io",
        apiBaseUrl: "https://api.servicetitan.io"
      }
    : {
        authBaseUrl: "https://auth-integration.servicetitan.io",
        apiBaseUrl: "https://api-integration.servicetitan.io"
      };
}

async function getServiceTitanAccessToken(connection) {
  const config = parseConnectionConfig(connection.config_json, connection.connector_type);
  const credentials = getIntegrationConnectionCredentials(connection);
  const clientId = normalizeText(credentials.clientId);
  const clientSecret = normalizeText(credentials.clientSecret);
  if (!clientId || !clientSecret) {
    throw createConnectorError("servicetitan_credentials_missing");
  }
  const environment = getServiceTitanEnvironmentConfig(config);
  const response = await requestJson(`${environment.authBaseUrl}/connect/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    }).toString()
  });
  const accessToken = normalizeText(response.json?.access_token);
  if (!accessToken) {
    throw createConnectorError("servicetitan_access_token_missing", {
      requestUrl: `${environment.authBaseUrl}/connect/token`,
      responseStatus: response.status,
      responseBodyExcerpt: response.text
    });
  }
  return {
    accessToken,
    apiBaseUrl: environment.apiBaseUrl
  };
}

function buildServiceTitanBookingPayload(payload) {
  const callbackNumber = getBestPhoneNumber(payload);
  const addressLine1 = normalizeText(payload?.caller?.address_line1);
  const addressLine2 = normalizeText(payload?.caller?.address_line2);
  const city = normalizeText(payload?.caller?.city);
  const state = normalizeText(payload?.caller?.state);
  const postalCode = normalizeText(payload?.caller?.postal_code);
  const booking = {
    name: formatCallerName(payload),
    summary: normalizeText(payload?.call?.summary) || "EveryCall booking",
    phone: callbackNumber || undefined,
    source: "EveryCall"
  };
  if (addressLine1 || city || state || postalCode) {
    booking.address = {
      street: addressLine1 || undefined,
      unit: addressLine2 || undefined,
      city: city || undefined,
      state: state || undefined,
      zip: postalCode || undefined,
      country: "USA"
    };
  }
  return booking;
}

async function deliverServiceTitanConnection(connection, payload) {
  const config = parseConnectionConfig(connection.config_json, connection.connector_type);
  const credentials = getIntegrationConnectionCredentials(connection);
  const appKey = normalizeText(credentials.appKey);
  const tenantId = normalizeText(config.tenantId);
  const resourcePath = normalizeText(config.resourcePath) || buildDefaultServiceTitanResourcePath(tenantId);
  if (!appKey || !tenantId || !resourcePath) {
    throw createConnectorError("servicetitan_configuration_incomplete");
  }
  const { accessToken, apiBaseUrl } = await getServiceTitanAccessToken(connection);
  const requestUrl = `${apiBaseUrl}${resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`}`;
  const response = await requestJson(requestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "ST-App-Key": appKey
    },
    body: JSON.stringify(buildServiceTitanBookingPayload(payload))
  });
  return {
    requestUrl,
    responseStatus: response.status,
    responseBody: response.text,
    responseBodyExcerpt: response.text
  };
}

async function testHubSpotConnection(connection) {
  const credentials = getIntegrationConnectionCredentials(connection);
  const token = normalizeText(credentials.privateAppToken);
  if (!token) {
    throw createConnectorError("hubspot_private_app_token_missing");
  }
  const response = await requestJson("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      limit: 1,
      properties: ["firstname", "lastname", "phone"]
    })
  });
  return {
    requestUrl: "https://api.hubapi.com/crm/v3/objects/contacts/search",
    responseStatus: response.status,
    responseBody: response.text
  };
}

async function testJobberConnection(pool, connection) {
  const config = parseConnectionConfig(connection.config_json, connection.connector_type);
  const accessToken = await refreshJobberAccessToken(pool, connection);
  const response = await jobberGraphqlRequest(accessToken, config.apiVersion, {
    query: `
      query EveryCallTestConnection {
        account {
          id
          name
          phone
        }
      }
    `
  });
  return {
    requestUrl: "https://api.getjobber.com/api/graphql",
    responseStatus: response.status,
    responseBody: response.text
  };
}

async function testServiceTitanConnection(connection) {
  const config = parseConnectionConfig(connection.config_json, connection.connector_type);
  const credentials = getIntegrationConnectionCredentials(connection);
  const appKey = normalizeText(credentials.appKey);
  const tenantId = normalizeText(config.tenantId);
  if (!appKey || !tenantId) {
    throw createConnectorError("servicetitan_configuration_incomplete");
  }
  const { accessToken, apiBaseUrl } = await getServiceTitanAccessToken(connection);
  const requestUrl = `${apiBaseUrl}/settings/v2/tenant/${encodeURIComponent(tenantId)}/employees?pageSize=1`;
  const response = await requestJson(requestUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "ST-App-Key": appKey
    }
  });
  return {
    requestUrl,
    responseStatus: response.status,
    responseBody: response.text
  };
}

async function setReconnectRequired(pool, connectionId, reconnectRequired) {
  await pool.query(
    `UPDATE integration_connections
     SET reconnect_required = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [connectionId, Boolean(reconnectRequired)]
  );
}

export async function deliverIntegrationConnection(pool, {
  connection,
  tenantKey,
  callSid,
  eventId,
  attemptNumber = 1
}) {
  const config = parseConnectionConfig(connection.config_json, connection.connector_type);
  const payload = await buildCallCompletedEvent(pool, {
    tenantKey,
    callSid,
    includeTranscript: config.includeTranscript,
    eventId
  });

  const decision = shouldDeliverConnection({
    payload,
    config: connection.config_json,
    connectorType: connection.connector_type
  });
  if (connection.status !== "enabled") {
    return {
      status: "skipped",
      payload,
      requestUrl: connection.endpoint_url || null,
      errorMessage: "connection_disabled"
    };
  }
  if (!decision.deliver) {
    return {
      status: "skipped",
      payload,
      requestUrl: connection.endpoint_url || null,
      errorMessage: decision.reason || "filtered_out"
    };
  }

  let result;
  try {
    switch (connection.connector_type) {
      case INTEGRATION_CONNECTOR_TYPES.outboundWebhook:
        result = await sendWebhookLikeConnection({ connection, payload, attemptNumber, signed: true });
        break;
      case INTEGRATION_CONNECTOR_TYPES.zapierHook:
        result = await sendWebhookLikeConnection({ connection, payload, attemptNumber, signed: false });
        break;
      case INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp:
        result = await deliverHubSpotConnection(connection, payload);
        break;
      case INTEGRATION_CONNECTOR_TYPES.jobberClient:
        result = await deliverJobberConnection(pool, connection, payload);
        break;
      case INTEGRATION_CONNECTOR_TYPES.servicetitanBooking:
        result = await deliverServiceTitanConnection(connection, payload);
        break;
      default:
        throw createConnectorError(`integration_connector_not_supported:${connection.connector_type}`);
    }
  } catch (error) {
    if (connection.connector_type === INTEGRATION_CONNECTOR_TYPES.jobberClient) {
      const code = normalizeText(error?.responseBodyExcerpt || error?.message).toLowerCase();
      if (code.includes("invalid_grant") || code.includes("invalid token") || code.includes("invalid_request")) {
        await setReconnectRequired(pool, connection.id, true);
      }
    }
    throw error;
  }

  if (connection.connector_type === INTEGRATION_CONNECTOR_TYPES.jobberClient) {
    await setReconnectRequired(pool, connection.id, false);
  }

  return {
    status: "delivered",
    payload,
    ...result
  };
}

export async function testIntegrationConnection(pool, {
  connection,
  tenantKey,
  tenantName
}) {
  switch (connection.connector_type) {
    case INTEGRATION_CONNECTOR_TYPES.outboundWebhook:
      return sendWebhookLikeConnection({
        connection,
        payload: buildConnectionTestPayload({ tenantKey, tenantName }),
        attemptNumber: 1,
        signed: true
      });
    case INTEGRATION_CONNECTOR_TYPES.zapierHook:
      return sendWebhookLikeConnection({
        connection,
        payload: buildConnectionTestPayload({ tenantKey, tenantName }),
        attemptNumber: 1,
        signed: false
      });
    case INTEGRATION_CONNECTOR_TYPES.hubspotPrivateApp:
      return testHubSpotConnection(connection);
    case INTEGRATION_CONNECTOR_TYPES.jobberClient:
      return testJobberConnection(pool, connection);
    case INTEGRATION_CONNECTOR_TYPES.servicetitanBooking:
      return testServiceTitanConnection(connection);
    default:
      throw createConnectorError(`integration_connector_not_supported:${connection.connector_type}`);
  }
}

export function getConnectorDisplayLabel(connectorType) {
  return INTEGRATION_CONNECTOR_LABELS[normalizeText(connectorType)] || normalizeText(connectorType) || "Integration";
}
