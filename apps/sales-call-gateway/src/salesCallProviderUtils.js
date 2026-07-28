import crypto from "node:crypto";

// Sales-call provider primitives are isolated in the dedicated gateway service.

const TRANSIENT_PROVIDER_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class SalesProviderError extends Error {
  constructor(message, {
    provider = "unknown",
    operation = "unknown",
    status = null,
    code = "",
    responseBody = "",
    retryable = false,
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SalesProviderError";
    this.provider = provider;
    this.operation = operation;
    this.status = Number.isFinite(Number(status)) ? Number(status) : null;
    this.code = String(code || "");
    this.responseBody = String(responseBody || "").slice(0, 2000);
    this.retryable = Boolean(retryable);
  }
}

export class SalesCallOrchestrationError extends Error {
  constructor(message, {
    code = "sales_call_orchestration_failed",
    patch = {},
    teardown = null,
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SalesCallOrchestrationError";
    this.code = code;
    this.patch = patch;
    this.teardown = teardown;
  }
}

export function requireSalesValue(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name}_required`);
  return normalized;
}

export function compactSalesObject(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => compactSalesObject(entry));
  }
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    output[key] = compactSalesObject(entry);
  }
  return output;
}

export function deriveSalesCommandId({
  correlationId,
  operation,
  target = ""
}) {
  const material = [
    requireSalesValue(correlationId, "correlation_id"),
    requireSalesValue(operation, "operation"),
    String(target || "").trim()
  ].join("|");
  const bytes = crypto.createHash("sha256").update(material).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

export function deriveSalesRealtimeEventId({
  correlationId,
  operation,
  target = ""
}) {
  return `sales_${operation}_${deriveSalesCommandId({ correlationId, operation, target })}`;
}

export function encodeSalesClientState({
  salesCallId,
  correlationId,
  role,
  nonce
}) {
  const payload = {
    v: 1,
    sales_call_id: requireSalesValue(salesCallId, "sales_call_id"),
    correlation_id: requireSalesValue(correlationId || salesCallId, "correlation_id"),
    role: requireSalesValue(role, "role"),
    ...(String(nonce || "").trim() ? { nonce: String(nonce).trim() } : {})
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodeSalesClientState(value) {
  const encoded = String(value || "").split(";", 1)[0].trim();
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (parsed?.v !== 1) return null;
    const salesCallId = String(parsed?.sales_call_id || "").trim();
    const correlationId = String(parsed?.correlation_id || "").trim();
    const role = String(parsed?.role || "").trim();
    const nonce = String(parsed?.nonce || "").trim();
    if (!salesCallId || !correlationId || !role) return null;
    return {
      sales_call_id: salesCallId,
      correlation_id: correlationId,
      role,
      ...(nonce ? { nonce } : {})
    };
  } catch {
    return null;
  }
}

export function getSalesHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return String(headers.get(name) || headers.get(String(name).toLowerCase()) || "");
  }
  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== target) continue;
    return Array.isArray(value) ? String(value[0] || "") : String(value || "");
  }
  return "";
}

export function isTransientProviderStatus(status) {
  return TRANSIENT_PROVIDER_STATUSES.has(Number(status));
}

export function shouldRetrySalesProviderError(error) {
  if (error?.retryable === true) return true;
  return isTransientProviderStatus(error?.status);
}

export async function withSalesProviderRetry(operation, {
  maxAttempts = 3,
  baseDelayMs = 100,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  shouldRetry = shouldRetrySalesProviderError,
  onRetry = null
} = {}) {
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      const delayMs = Math.max(0, Number(baseDelayMs) || 0) * (2 ** (attempt - 1));
      if (typeof onRetry === "function") {
        await onRetry({ attempt, delayMs, error });
      }
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export async function readSalesProviderResponse(response) {
  const rawBody = await response.text().catch(() => "");
  if (!rawBody) return { rawBody: "", json: null };
  try {
    return { rawBody, json: JSON.parse(rawBody) };
  } catch {
    return { rawBody, json: null };
  }
}

export function summarizeSalesProviderError(error) {
  const provider = String(error?.provider || "provider");
  const operation = String(error?.operation || "operation");
  const code = String(error?.code || error?.status || "failed");
  const message = String(error?.message || "Provider request failed").slice(0, 500);
  return {
    provider_error_code: `${provider}:${operation}:${code}`.slice(0, 200),
    provider_error_message: message
  };
}
