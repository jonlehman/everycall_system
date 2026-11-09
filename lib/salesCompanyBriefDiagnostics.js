// Shared allowlist for persisted diagnostics, API responses and rep-facing text.
// Never accept an exception message, provider body or stored display text here.
const definitions = {
  model_timeout: ["model", "The brief provider timed out. Try generating the brief again."],
  provider_http_error: ["model", "The brief provider returned an error. Try again; if it repeats, share the reference with support."],
  provider_rate_limited: ["model", "The brief provider is busy or has reached a usage limit. Try again later."],
  provider_auth_error: ["model", "The brief provider could not authorize the request. Share the reference with support."],
  provider_not_configured: ["model", "The brief provider is not configured. Share the reference with support."],
  provider_network_error: ["model", "The brief provider could not be reached. Try generating the brief again."],
  provider_refusal: ["model", "The brief provider declined this request. Share the reference with support."],
  provider_incomplete: ["model", "The brief provider returned an incomplete answer. Try generating the brief again."],
  model_empty_output: ["schema", "The brief provider returned no usable content. Try generating the brief again."],
  invalid_json: ["schema", "The brief provider returned an unreadable answer. Try generating the brief again."],
  schema_invalid: ["schema", "The generated brief did not match the required format. Try again; if it repeats, share the reference with support."],
  unsupported_quote: ["grounding", "The generated brief included a claim that could not be verified against the saved website. Try generating it again."],
  invalid_word_count: ["validation", "The generated brief did not meet the required length. Try again; if it repeats, share the reference with support."],
  duplicate_services: ["validation", "The generated brief repeated a service. Try generating it again."],
  insufficient_website_evidence: ["evidence", "The saved website content does not provide enough detail for a company brief."],
  website_evidence_missing: ["evidence", "No usable saved website content is available for a company brief."],
  generation_interrupted: ["runner", "The previous brief attempt was interrupted. You can generate it again."],
  unexpected_error: ["runner", "An unexpected error prevented the company brief. Try again; if it repeats, share the reference with support."],
  request_failed: ["request", "The brief request could not be completed. Check the brief again; the attempt may still be running."],
  request_unauthorized: ["request", "Your session has expired. Sign in again to generate the brief."],
  request_forbidden: ["request", "You no longer have access to this prospect. Refresh your workspace."],
  demo_not_ready: ["request", "Prepare the website demo before generating a company brief."],
};
const hasCode = (code) => typeof code === "string" && Object.hasOwn(definitions, code);
const stages = new Set(["evidence", "model", "schema", "grounding", "validation", "runner", "request"]);
const issueCodes = new Set(["invalid_type", "invalid_literal", "invalid_enum_value", "invalid_value", "too_small", "too_big", "invalid_string", "invalid_format", "unrecognized_keys", "invalid_union", "custom"]);
const providerCodes = new Set(["invalid_api_key", "insufficient_quota", "rate_limit_exceeded", "model_not_found", "unsupported_parameter", "unsupported_value", "invalid_json_schema", "invalid_request_error", "context_length_exceeded", "server_error"]);
const providerParams = new Set(["model", "temperature", "reasoning.effort", "text.format", "text.format.schema", "max_output_tokens", "prompt_cache_key", "prompt_cache_retention"]);
export function companyBriefAttemptMetadata(value) {
  const result = {};
  if (typeof value?.attemptRef === "string" && /^cb_[a-f0-9]{32}$/.test(value.attemptRef)) result.attemptRef = value.attemptRef;
  if (typeof value?.generatedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.generatedAt) && Number.isFinite(Date.parse(value.generatedAt))) result.generatedAt = value.generatedAt;
  return result;
}
export function sanitizeCompanyBriefDiagnostic(value, fallbackCode = "unexpected_error") {
  const code = hasCode(value?.code) ? value.code : hasCode(fallbackCode) ? fallbackCode : "unexpected_error";
  const result = { code, stage: code === "unexpected_error" && stages.has(value?.stage) ? value.stage : definitions[code][0] };
  const details = {};
  for (const name of ["wordCount", "serviceCount", "uniqueServiceCount", "claimIndex", "evidencePageCount", "issueCount"]) {
    if (Number.isInteger(value?.details?.[name]) && value.details[name] >= 0 && value.details[name] <= 100000) details[name] = value.details[name];
  }
  if (Number.isInteger(value?.details?.httpStatus) && value.details.httpStatus >= 400 && value.details.httpStatus <= 599) details.httpStatus = value.details.httpStatus;
  if (providerCodes.has(value?.details?.providerCode)) details.providerCode = value.details.providerCode;
  if (providerParams.has(value?.details?.providerParam)) details.providerParam = value.details.providerParam;
  if (Array.isArray(value?.details?.issues)) {
    details.issues = value.details.issues.slice(0, 8).map((issue) => ({
      code: issueCodes.has(issue?.code) ? issue.code : "invalid_value",
      path: typeof issue?.path === "string" && /^(?:\$|(?:standOut|services)(?:\.[0-9]{1,2})?(?:\.(?:text|quote|sourceUrl|evidenceId))?|whyCustomersCall(?:\.(?:text|quote|sourceUrl|evidenceId))?)$/.test(issue.path) ? issue.path : "$",
    }));
  }
  if (Object.keys(details).length) result.details = details;
  return result;
}
export function companyBriefFailureMessage(brief) {
  if (brief?.diagnostic) return definitions[sanitizeCompanyBriefDiagnostic(brief.diagnostic).code][1];
  return hasCode(brief?.reason) ? definitions[brief.reason][1] : "Company brief unavailable. You can try again.";
}
export function companyBriefRequestFailure(error) {
  const code = error?.status === 401 ? "request_unauthorized" : error?.status === 403 ? "request_forbidden"
    : error?.payload?.error === "demo_not_ready" ? "demo_not_ready" : "request_failed";
  return { status: "unavailable", reason: "request_failed", ...companyBriefAttemptMetadata(error?.payload?.companyBrief),
    diagnostic: sanitizeCompanyBriefDiagnostic({ code }) };
}

export function normalizeCompanyBrief(brief) {
  if (!brief || !["ready", "pending", "unavailable"].includes(brief.status)) return { status: "missing" };
  const base = { status: brief.status, ...companyBriefAttemptMetadata(brief) };
  if (brief.status === "ready") return { ...base, standOut: typeof brief.standOut === "string" ? brief.standOut : "",
    services: Array.isArray(brief.services) ? brief.services.filter((item) => typeof item === "string") : [],
    whyCustomersCall: typeof brief.whyCustomersCall === "string" ? brief.whyCustomersCall : "" };
  if (brief.status === "pending") return base;
  const reason = ["generation_failed", "website_evidence_missing", "insufficient_website_evidence", "generation_interrupted", "invalid_brief", "request_failed"].includes(brief.reason) ? brief.reason : "generation_failed";
  return { ...base, reason, ...(brief.diagnostic ? { diagnostic: sanitizeCompanyBriefDiagnostic(brief.diagnostic, reason) } : {}) };
}
