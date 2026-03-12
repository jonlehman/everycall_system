import { normalizePhoneNumber } from "./phone.js";

export function truncateText(value, limit = 400) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function parseProvisioningError(err) {
  const raw = String(err?.message || err || "unknown_error").trim();
  if (raw.startsWith("telnyx_request_failed:")) {
    const [, status, ...rest] = raw.split(":");
    return {
      errorCode: `telnyx_request_failed_${status || "unknown"}`,
      errorMessage: truncateText(rest.join(":") || "Telnyx request failed.")
    };
  }
  if (raw === "TELNYX_VOICE_CONNECTION_ID missing") {
    return {
      errorCode: "missing_voice_connection_id",
      errorMessage: raw
    };
  }
  if (raw === "TELNYX_API_KEY missing") {
    return {
      errorCode: "missing_telnyx_api_key",
      errorMessage: raw
    };
  }
  return {
    errorCode: truncateText(raw.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase(), 80) || "provisioning_error",
    errorMessage: truncateText(raw)
  };
}

export function getVoiceProvisioningAreaCode(primaryNumber) {
  const normalized = normalizePhoneNumber(primaryNumber || null);
  const digits = String(normalized || "").replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits.slice(-10, -7) : null;
}
