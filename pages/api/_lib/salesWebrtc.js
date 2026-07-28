function normalizeText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

async function parseTokenResponse(response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return normalizeText(parsed, 10000);
    return normalizeText(parsed?.data?.token || parsed?.token, 10000);
  } catch {
    return normalizeText(text, 10000);
  }
}

export function resolveSalesOperatorTelephonyCredential({
  adminUserId,
  operatorSettings,
  env = process.env
} = {}) {
  const stored = normalizeText(
    operatorSettings?.telnyxTelephonyCredentialId
      || operatorSettings?.telnyx_telephony_credential_id,
    120
  );
  if (stored) return stored;

  const mappingText = normalizeText(env.SALES_TELNYX_TELEPHONY_CREDENTIALS_JSON, 20000);
  if (mappingText && adminUserId !== undefined && adminUserId !== null) {
    try {
      const mapping = JSON.parse(mappingText);
      const mapped = normalizeText(mapping?.[String(adminUserId)], 120);
      if (mapped) return mapped;
    } catch {
      throw new Error("telnyx_sales_telephony_credentials_json_invalid");
    }
  }
  return normalizeText(env.SALES_TELNYX_TELEPHONY_CREDENTIAL_ID, 120);
}

export async function createSalesWebrtcToken({
  credentialId,
  fetchImpl = globalThis.fetch,
  env = process.env
}) {
  const normalizedCredentialId = normalizeText(credentialId, 120);
  if (!normalizedCredentialId) {
    throw new Error("telnyx_sales_telephony_credential_missing");
  }
  const apiKey = normalizeText(env.SALES_TELNYX_API_KEY, 1000);
  if (!apiKey) {
    throw new Error("sales_telnyx_api_key_missing");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("telnyx_fetch_unavailable");
  }

  const response = await fetchImpl(
    `https://api.telnyx.com/v2/telephony_credentials/${encodeURIComponent(normalizedCredentialId)}/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );
  const token = await parseTokenResponse(response);
  if (!response.ok || !token) {
    throw new Error(`telnyx_webrtc_token_failed:${response.status}`);
  }
  return {
    token,
    credentialId: normalizedCredentialId,
    expiresInSeconds: 24 * 60 * 60
  };
}

export function buildSalesWebrtcCallOptions({
  salesCallId,
  prospectPhone,
  callerIdNumber,
  callerName = "EveryCall"
}) {
  const normalizedCallId = normalizeText(salesCallId, 120);
  const normalizedDestination = normalizeText(prospectPhone, 60);
  const normalizedCallerId = normalizeText(callerIdNumber, 60);
  if (!normalizedCallId) throw new Error("sales_call_id_required");
  if (!normalizedDestination) throw new Error("sales_prospect_phone_required");
  if (!normalizedCallerId) throw new Error("telnyx_sales_caller_id_missing");

  return {
    destinationNumber: normalizedDestination,
    callerNumber: normalizedCallerId,
    callerName: normalizeText(callerName, 128) || "EveryCall",
    audio: true,
    video: false,
    trickleIce: true,
    prefetchIceCandidates: true,
    sessionId: normalizedCallId,
    customHeaders: [
      { name: "X-EveryCall-Sales-Call-Id", value: normalizedCallId },
      { name: "X-EveryCall-Call-Role", value: "operator" }
    ]
  };
}
