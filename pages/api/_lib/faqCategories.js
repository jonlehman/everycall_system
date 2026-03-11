export const BROAD_FAQ_CATEGORY_ORDER = [
  "Emergency",
  "Technical Questions",
  "Services Offered",
  "Scheduling & Availability",
  "Pricing & Payment",
  "Service Area & Eligibility",
  "Policies & Process",
  "Warranties & Follow-Up"
];

const DIRECT_CATEGORY_MAP = new Map([
  ["emergency", "Emergency"],
  ["technical", "Technical Questions"],
  ["safety", "Technical Questions"],
  ["maintenance", "Technical Questions"],
  ["preparation", "Technical Questions"],
  ["prevention", "Technical Questions"],
  ["services", "Services Offered"],
  ["service", "Services Offered"],
  ["products", "Services Offered"],
  ["scheduling", "Scheduling & Availability"],
  ["availability", "Scheduling & Availability"],
  ["pricing", "Pricing & Payment"],
  ["payments", "Pricing & Payment"],
  ["payment", "Pricing & Payment"],
  ["billing", "Pricing & Payment"],
  ["coverage", "Service Area & Eligibility"],
  ["service area", "Service Area & Eligibility"],
  ["location", "Service Area & Eligibility"],
  ["process", "Policies & Process"],
  ["insurance", "Policies & Process"],
  ["support", "Warranties & Follow-Up"],
  ["warranty", "Warranties & Follow-Up"]
]);

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

export function normalizeFaqCategory(input) {
  const category = normalizeKey(typeof input === "string" ? input : input?.category);
  const question = normalizeKey(typeof input === "object" ? input?.question : "");
  const answer = normalizeKey(typeof input === "object" ? input?.answer : "");
  const text = `${question} ${answer}`.trim();

  if (includesAny(text, ["insurance", "claim", "permit", "inspection", "proof of ownership", "change order", "what happens next"])) {
    return "Policies & Process";
  }
  if (DIRECT_CATEGORY_MAP.has(category)) {
    return DIRECT_CATEGORY_MAP.get(category);
  }

  if (includesAny(text, ["emergency", "urgent", "burst pipe", "sparks", "lockout", "no heat", "no cooling", "leak", "after-hours"])) {
    return "Emergency";
  }
  if (includesAny(text, ["estimate", "pricing", "price", "cost", "fee", "trip fee", "diagnostic fee", "financing", "payment"])) {
    return "Pricing & Payment";
  }
  if (includesAny(text, ["how soon", "how long", "when can", "lead time", "same-day", "availability", "be home", "timeline", "start date"])) {
    return "Scheduling & Availability";
  }
  if (includesAny(text, ["service area", "areas do you", "where are you", "commercial", "residential", "rental", "located", "coverage"])) {
    return "Service Area & Eligibility";
  }
  if (includesAny(text, ["warranty", "guarantee", "comes back", "follow-up", "make it right", "re-service"])) {
    return "Warranties & Follow-Up";
  }
  if (includesAny(text, ["what should i do", "is it safe", "troubleshoot", "explain how to fix", "why is", "prevent", "prepare", "concern"])) {
    return "Technical Questions";
  }
  if (includesAny(text, ["do you", "can you", "install", "repair", "replace", "handle", "offer", "provide", "service", "work on", "treat"])) {
    return "Services Offered";
  }

  return "Policies & Process";
}
