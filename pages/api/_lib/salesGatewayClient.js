import {
  INTERNAL_AUTH_PURPOSES,
  getInternalServiceToken
} from "@everycall/contracts/internalAuth";

function normalizeText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function getGatewayBaseUrl(env = process.env) {
  return normalizeText(env.SALES_CALL_GATEWAY_BASE_URL, 500).replace(/\/+$/, "");
}

async function parseGatewayResponse(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1000) };
  }
}

export async function requestSalesCallGateway(path, {
  method = "GET",
  body,
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  const baseUrl = getGatewayBaseUrl(env);
  if (!baseUrl) {
    throw new Error("sales_call_gateway_url_missing");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("sales_call_gateway_fetch_unavailable");
  }

  const token = getInternalServiceToken(
    env,
    INTERNAL_AUTH_PURPOSES.salesCallControl
  );
  if (!token) {
    throw new Error("sales_call_gateway_auth_missing");
  }

  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await parseGatewayResponse(response);
  if (!response.ok) {
    const message = normalizeText(data?.message || data?.error || response.statusText, 300);
    throw new Error(`sales_call_gateway_request_failed:${response.status}:${message || "unknown"}`);
  }
  return data;
}

export async function sendSalesCallAction(callId, action, {
  payload = {},
  fetchImpl,
  env = process.env
} = {}) {
  const normalizedCallId = normalizeText(callId, 120);
  const normalizedAction = normalizeText(action, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalizedCallId) throw new Error("sales_call_id_required");
  if (!normalizedAction) throw new Error("sales_call_action_required");

  return requestSalesCallGateway(
    `/internal/calls/${encodeURIComponent(normalizedCallId)}/actions`,
    {
      method: "POST",
      body: {
        action: normalizedAction,
        payload: payload && typeof payload === "object" ? payload : {}
      },
      fetchImpl,
      env
    }
  );
}

export async function getSalesGatewayHealth({
  fetchImpl,
  env = process.env
} = {}) {
  return requestSalesCallGateway("/internal/health", {
    method: "GET",
    fetchImpl,
    env
  });
}
