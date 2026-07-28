import crypto from "node:crypto";

export const INTERNAL_AUTH_PURPOSES = {
  gatewayPrompt: "gateway_prompt",
  gatewayToolResult: "gateway_tool_result",
  gatewayError: "gateway_error",
  callSummaryFinalize: "call_summary_finalize",
  gatewayDebugLog: "gateway_debug_log",
  telnyxMediaStream: "telnyx_media_stream",
  salesCallControl: "sales_call_control"
} as const;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

export function resolveInternalServiceSecret(env: Record<string, unknown> = process.env) {
  return normalizeText(env.INTERNAL_SERVICE_SECRET || env.CALL_SUMMARY_TOKEN || "");
}

export function deriveInternalServiceToken(secret: string, purpose: string, scope = "") {
  const normalizedSecret = normalizeText(secret);
  const normalizedPurpose = normalizeText(purpose);
  const normalizedScope = normalizeText(scope);
  if (!normalizedSecret || !normalizedPurpose) return "";
  return crypto
    .createHmac("sha256", normalizedSecret)
    .update(`everycall.internal.${normalizedPurpose}.${normalizedScope}`)
    .digest("base64url");
}

export function getInternalServiceToken(
  env: Record<string, unknown> = process.env,
  purpose: string,
  scope = ""
) {
  return deriveInternalServiceToken(resolveInternalServiceSecret(env), purpose, scope);
}

export function isValidInternalServiceToken(
  provided: unknown,
  env: Record<string, unknown> = process.env,
  purpose: string,
  scope = ""
) {
  const token = normalizeText(provided);
  const expected = getInternalServiceToken(env, purpose, scope);
  if (!token || !expected) return false;
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}
