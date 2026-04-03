export const CALL_CATEGORY_OPTIONS = [
  "project_inquiry",
  "general_inquiry",
  "existing_customer_support",
  "vendor_or_sales",
  "spam",
  "wrong_number",
  "hangup_or_incomplete",
  "other_non_billable"
];

export const CALL_CATEGORY_LABELS = {
  project_inquiry: "Project Inquiry",
  general_inquiry: "General Inquiry",
  existing_customer_support: "Existing Customer Support",
  vendor_or_sales: "Vendor / Sales",
  spam: "Spam",
  wrong_number: "Wrong Number",
  hangup_or_incomplete: "Hangup / Incomplete",
  other_non_billable: "Other Non-Billable"
};

export function getDefaultCallCategorySelection() {
  return [...CALL_CATEGORY_OPTIONS];
}

export function formatCallCategoryLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (CALL_CATEGORY_LABELS[normalized]) {
    return CALL_CATEGORY_LABELS[normalized];
  }
  return normalized
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function sanitizeCallCategorySelection(value, { fallbackToAll = false } = {}) {
  const seen = new Set();
  const categories = [];
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    const normalized = String(item || "").trim();
    if (!CALL_CATEGORY_OPTIONS.includes(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    categories.push(normalized);
  }
  if (!categories.length && fallbackToAll) {
    return getDefaultCallCategorySelection();
  }
  return categories;
}
