function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOutcomeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizePhoneForLeadMatch(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

function normalizeLooseText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildServiceFingerprint(value) {
  return normalizeLooseText(value)
    .split(" ")
    .filter((token) => token.length > 2)
    .slice(0, 16)
    .join(" ");
}

const NON_LEAD_OUTCOMES = new Set([
  "spam",
  "wrong_number",
  "general_inquiry",
  "general_question",
  "question_only",
  "existing_customer_support",
  "existing_customer",
  "vendor",
  "vendor_or_sales",
  "sales_call",
  "job_applicant",
  "recruiting",
  "billing_question",
  "non_lead",
  "hangup",
  "hangup_incomplete",
  "canceled"
]);

const LEAD_OUTCOMES = new Set([
  "callback_request",
  "estimate_request",
  "quote_request",
  "consultation_request",
  "appointment_request",
  "project_inquiry",
  "project_request",
  "service_request",
  "message_taken",
  "transfer",
  "lead",
  "new_customer_lead"
]);

const GENERAL_INQUIRY_PATTERNS = [
  /\b(what are your hours|are you open|what time do you close)\b/i,
  /\b(where are you located|what is your address)\b/i,
  /\b(do you service|service area|what areas do you serve)\b/i,
  /\b(what services do you offer|do you do)\b/i,
  /\b(just had a question|general question)\b/i
];

const PROJECT_INTENT_PATTERNS = [
  /\b(estimate|quote|bid|pricing)\b/i,
  /\b(install|installation|replace|replacement)\b/i,
  /\b(repair|troubleshoot|troubleshooting|inspection)\b/i,
  /\b(project|remodel|renovation)\b/i,
  /\b(appointment|consultation|callback|call back|follow up)\b/i,
  /\b(issue|problem|broken|leak)\b/i
];

function looksLikeGeneralInquiry(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return GENERAL_INQUIRY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeProjectIntent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return PROJECT_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sameOpportunity(currentFingerprint, existingFingerprint) {
  if (!currentFingerprint || !existingFingerprint) return false;
  return currentFingerprint === existingFingerprint
    || currentFingerprint.includes(existingFingerprint)
    || existingFingerprint.includes(currentFingerprint);
}

async function findDuplicateLead(pool, {
  tenantKey,
  callSid,
  callbackNumber,
  serviceFingerprint
}) {
  if (!pool || !callbackNumber) return null;
  const result = await pool.query(
    `SELECT
       c.call_sid,
       c.created_at,
       c.lead_is_valid,
       c.lead_is_billable,
       d.service_required,
       c.summary
     FROM calls c
     LEFT JOIN call_details d ON d.call_sid = c.call_sid
     WHERE c.tenant_key = $1
       AND c.call_sid <> $2
       AND c.lead_is_valid = TRUE
       AND c.created_at >= NOW() - interval '30 days'
       AND regexp_replace(COALESCE(d.callback_number, ''), '\D', '', 'g') = $3
     ORDER BY c.created_at DESC
     LIMIT 20`,
    [tenantKey, callSid, callbackNumber]
  );

  for (const row of result.rows || []) {
    const existingFingerprint = buildServiceFingerprint(row.service_required || row.summary || "");
    if (sameOpportunity(serviceFingerprint, existingFingerprint)) {
      return row;
    }
  }

  return null;
}

export async function evaluateLeadDecision(pool, {
  tenantKey,
  callSid,
  disposition,
  summary,
  extractedFields
}) {
  const outcomeType = normalizeOutcomeKey(disposition || extractedFields?.outcomeType || "unknown");
  const callbackNumber = normalizePhoneForLeadMatch(extractedFields?.callbackNumber);
  const serviceFingerprint = buildServiceFingerprint(
    extractedFields?.serviceRequired || summary || ""
  );
  const contextText = [
    extractedFields?.serviceRequired,
    summary
  ].filter(Boolean).join(" ");

  if (NON_LEAD_OUTCOMES.has(outcomeType)) {
    return {
      outcomeType,
      isValidLead: false,
      isBillableLead: false,
      decisionReason: "explicit_non_lead_outcome",
      duplicateOfCallSid: null
    };
  }

  if (!callbackNumber || callbackNumber.length < 11) {
    return {
      outcomeType,
      isValidLead: false,
      isBillableLead: false,
      decisionReason: "missing_callback_number",
      duplicateOfCallSid: null
    };
  }

  if (looksLikeGeneralInquiry(contextText) && !LEAD_OUTCOMES.has(outcomeType)) {
    return {
      outcomeType,
      isValidLead: false,
      isBillableLead: false,
      decisionReason: "general_inquiry_only",
      duplicateOfCallSid: null
    };
  }

  const hasProjectIntent = LEAD_OUTCOMES.has(outcomeType) || looksLikeProjectIntent(contextText);
  if (!hasProjectIntent) {
    return {
      outcomeType,
      isValidLead: false,
      isBillableLead: false,
      decisionReason: "no_project_intent_detected",
      duplicateOfCallSid: null
    };
  }

  const duplicate = await findDuplicateLead(pool, {
    tenantKey,
    callSid,
    callbackNumber,
    serviceFingerprint
  });

  if (duplicate?.call_sid) {
    return {
      outcomeType,
      isValidLead: true,
      isBillableLead: false,
      decisionReason: "duplicate_recent_lead",
      duplicateOfCallSid: duplicate.call_sid
    };
  }

  return {
    outcomeType,
    isValidLead: true,
    isBillableLead: true,
    decisionReason: LEAD_OUTCOMES.has(outcomeType)
      ? "explicit_project_lead"
      : "inferred_project_lead",
    duplicateOfCallSid: null
  };
}
