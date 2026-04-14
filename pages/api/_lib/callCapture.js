function normalizeText(value) {
  return String(value || "").trim();
}

function pickText(source, keys) {
  for (const key of keys) {
    const text = normalizeText(source?.[key]);
    if (text) return text;
  }
  return null;
}

function clipText(value, maxLength) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.slice(0, maxLength);
}

export function normalizeCapturedCallFields(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};

  return {
    extractedJson: source,
    firstName: clipText(pickText(source, ["first_name", "firstName", "caller_first_name"]), 120),
    lastName: clipText(pickText(source, ["last_name", "lastName", "caller_last_name"]), 120),
    callbackNumber: clipText(pickText(source, ["callback_number", "callbackNumber", "caller_phone", "phone_number"]), 40),
    callerEmail: clipText(pickText(source, ["caller_email", "callerEmail", "email", "email_address"]), 240),
    serviceRequired: clipText(pickText(source, ["service_required", "serviceRequired", "service_request", "serviceRequest", "issue_summary"]), 240),
    urgencyLevel: clipText(pickText(source, ["urgency_level", "urgencyLevel", "urgency", "priority"]), 32),
    addressLine1: clipText(pickText(source, ["address_line1", "addressLine1"]), 240),
    addressLine2: clipText(pickText(source, ["address_line2", "addressLine2"]), 240),
    city: clipText(pickText(source, ["city"]), 120),
    state: clipText(pickText(source, ["state", "state_code"]), 60),
    postalCode: clipText(pickText(source, ["postal_code", "postalCode", "zip", "zip_code"]), 20),
    requestedDate: clipText(pickText(source, ["requested_date", "requestedDate"]), 32),
    requestedTime: clipText(pickText(source, ["requested_time", "requestedTime"]), 32),
    transcriptCombined: pickText(source, ["transcript_combined", "transcript"]),
    outcomeType: clipText(pickText(source, ["outcome_type", "outcomeType", "disposition"]), 80)
  };
}
