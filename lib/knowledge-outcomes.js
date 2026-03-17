export const DEFAULT_PREFERRED_OUTCOME_OPTIONS = [
  { value: "callback_request", label: "Callback Request" },
  { value: "message_taken", label: "Message Taken" },
  { value: "transfer", label: "Transfer" }
];

export function formatOutcomeLabel(value) {
  const normalized = String(value || "").trim();
  const match = DEFAULT_PREFERRED_OUTCOME_OPTIONS.find((item) => item.value === normalized);
  if (match) return match.label;
  if (!normalized) return "";
  return normalized
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
