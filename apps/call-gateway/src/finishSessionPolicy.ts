type FinishSessionPolicyInput = {
  requireSpokenClose: boolean;
  lastAssistantTranscript?: string | null;
  configuredClosingPhrase?: string | null;
};

function normalizeSpokenText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function evaluateFinishSessionPolicy(input: FinishSessionPolicyInput) {
  if (!input.requireSpokenClose) {
    return { allowed: true, reason: "policy_disabled" as const };
  }

  const transcript = normalizeSpokenText(input.lastAssistantTranscript);
  const closingPhrase = normalizeSpokenText(input.configuredClosingPhrase);
  if (!closingPhrase) {
    return { allowed: false, reason: "configured_closing_missing" as const };
  }
  if (!transcript.includes(closingPhrase)) {
    return { allowed: false, reason: "spoken_close_required" as const };
  }
  return { allowed: true, reason: "spoken_close_confirmed" as const };
}
