import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { performance } from "node:perf_hooks";
import { executePlannerPgvectorRuntime } from "@everycall/contracts";
import { extractTextFromDocumentBuffer } from "./knowledgeReceptionistFiles.js";
import { buildSourceChunksForSourceItem, compileKnowledgeBuildArtifacts } from "./knowledgeReceptionistCompiler.js";
import { loadTenantDomainAssignments, resolveTenantDomainAssignments, syncCanonicalKnowledgePacks } from "./knowledgeReceptionistPacks.js";
import { ensureTenantPromptProfileCompanyDescriptionSnapshot } from "./promptBlueprints.js";
import { loadTenantBootstrapProfile } from "./tenantBootstrapProfiles.js";

function readPositiveIntEnv(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const MAX_WEBSITE_PAGES = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_WEBSITE_PAGES", 80);
const MAX_WEBSITE_FILES = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_WEBSITE_FILES", 12);
const CRAWL_BATCH_SIZE = readPositiveIntEnv("KNOWLEDGE_BUILD_CRAWL_BATCH_SIZE", 4);
const FETCH_TIMEOUT_MS = readPositiveIntEnv("KNOWLEDGE_BUILD_FETCH_TIMEOUT_MS", 5000);
const WEBSITE_CRAWL_DEADLINE_MS = readPositiveIntEnv("KNOWLEDGE_BUILD_CRAWL_DEADLINE_MS", 90000);
const INITIAL_WEBSITE_FETCH_MAX_ATTEMPTS = readPositiveIntEnv("KNOWLEDGE_BUILD_INITIAL_FETCH_MAX_ATTEMPTS", 3);
const INITIAL_WEBSITE_FETCH_RETRY_DELAY_MS = readPositiveIntEnv("KNOWLEDGE_BUILD_INITIAL_FETCH_RETRY_DELAY_MS", 750);
const MAX_WEBSITE_PAGE_BYTES = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_WEBSITE_PAGE_BYTES", 2 * 1024 * 1024);
const MAX_WEBSITE_DOWNLOAD_BYTES = readPositiveIntEnv("KNOWLEDGE_BUILD_MAX_WEBSITE_DOWNLOAD_BYTES", 6 * 1024 * 1024);
const SOURCE_DISCOVERY_BATCH_SIZE = 25;
const SOURCE_PERSIST_BATCH_SIZE = 8;
const SOURCE_SEGMENT_INSERT_ROW_LIMIT = 1500;
const SOURCE_CHUNK_INSERT_ROW_LIMIT = 600;
const SOURCE_CLASSIFICATION_VERSION = "v3";
const CACHE_TTL_MS = 5 * 60 * 1000;
const RUNTIME_BUNDLE_SOFT_TOKEN_BUDGET = 1200;
const RUNTIME_BUNDLE_HARD_TOKEN_BUDGET = 1800;
const PROMPT_PAYLOAD_SOFT_TOKEN_BUDGET = 2500;
const PROMPT_PAYLOAD_HARD_TOKEN_BUDGET = 3500;
// Slice-one rule: live runtime is cache-first, so publish gating is based on the
// warmed hot-path fetch only. Cold fetch timing is still recorded as a prewarm
// diagnostic, but it does not block publish because active builds are expected to
// be prewarmed before any live turn uses them.
const ACTIVE_BUILD_HOT_FETCH_SOFT_MS = 75;
const ACTIVE_BUILD_HOT_FETCH_HARD_MS = 150;
const ACTIVE_BUILD_COLD_PREWARM_SOFT_MS = 75;
const ACTIVE_BUILD_COLD_PREWARM_HARD_MS = 150;
// Planner+pgvector runtime uses a remote vector query over both cards and facts,
// so the deterministic retrieval-core gate is calibrated to that live architecture
// rather than the old in-process sparse selector. We still warn aggressively, but
// only hard-block when the vector retrieval stage itself is materially degraded.
const RETRIEVAL_CORE_SOFT_MS = 500;
const RETRIEVAL_CORE_HARD_MS = 1000;
const PLANNER_RUNTIME_SOFT_MS = 2500;
const PLANNER_RUNTIME_HARD_MS = 6000;
const STAGE_A_SIMULATED_FAILURE_AFTER_BATCHES = Number.parseInt(String(process.env.KNOWLEDGE_STAGE_A_FAIL_AFTER_PERSIST_BATCHES || ""), 10) || 0;
const KNOWLEDGE_BUILD_JOB_MAX_BUILDS_PER_RUN = readPositiveIntEnv("KNOWLEDGE_BUILD_JOB_MAX_BUILDS_PER_RUN", 1);
const KNOWLEDGE_BUILD_JOB_MAX_AUTO_RESUME_AGE_MINUTES = readPositiveIntEnv("KNOWLEDGE_BUILD_JOB_MAX_AUTO_RESUME_AGE_MINUTES", 360);

const buildAssetCache = new Map();

function envFlagEnabled(name, defaultValue = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

const BUILD_PROGRESS_LOG_ENABLED = envFlagEnabled("KNOWLEDGE_BUILD_PROGRESS_LOG", false);

function logBuildProgress(event, details = {}) {
  if (!BUILD_PROGRESS_LOG_ENABLED) return;
  try {
    console.error(`build_progress:${event}:${JSON.stringify(details)}`);
  } catch {
    console.error(`build_progress:${event}`);
  }
}

async function withTransaction(db, work) {
  const canBorrowClient = typeof db?.connect === "function" && typeof db?.release !== "function";
  const client = canBorrowClient ? await db.connect() : db;
  const ownsClient = canBorrowClient;
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownsClient && typeof client?.release === "function") {
      client.release();
    }
  }
}

function normalizeText(value) {
  return sanitizeText(value).trim();
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function truncateText(value, limit = 320) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function formatReasonLabel(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function uniqueValues(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function createKnowledgeBuildError(code, message, extra = {}) {
  const error = new Error(normalizeText(message) || code || "knowledge_build_error");
  error.code = normalizeText(code) || "knowledge_build_error";
  Object.assign(error, extra);
  return error;
}

function formatWebsiteFetchFailureReason(failure = {}) {
  const reason = normalizeText(failure.failureReason || "").toLowerCase();
  const status = Number(failure.status || 0);
  if (reason.startsWith("http_")) {
    const code = Number.parseInt(reason.slice(5), 10);
    return Number.isFinite(code) ? `HTTP ${code}` : reason;
  }
  if (Number.isFinite(status) && status > 0) {
    return `HTTP ${status}`;
  }
  if (reason === "aborterror") return "Request timed out";
  if (reason === "website_target_not_public") return "Target is not publicly reachable";
  if (reason === "website_target_unresolvable") return "Target hostname could not be resolved";
  if (reason === "website_redirect_origin_not_allowed") return "Redirect left the approved website origin";
  if (reason === "website_redirect_limit_exceeded") return "Redirect limit exceeded";
  if (reason === "website_redirect_missing_location") return "Redirect response missing location";
  if (reason === "website_response_too_large") return "Response exceeded the website fetch size limit";
  if (reason === "website_url_invalid_protocol") return "Website URL protocol is not allowed";
  if (reason === "typeerror") return "Network request failed";
  return formatReasonLabel(reason || "fetch_failed") || "Fetch failed";
}

function extractKnowledgeBuildFailureMessages(err) {
  const primary = normalizeText(err?.displayMessage || err?.message || "build_failed") || "build_failed";
  const attemptMessages = Array.isArray(err?.failureMessages)
    ? err.failureMessages
    : [];
  return uniqueValues([primary, ...attemptMessages]);
}

function createStableId(prefix, key) {
  return `${prefix}_${stableHash(`${prefix}|${normalizeText(key)}`).slice(0, 24)}`;
}

function createStableSourceKey(sourceItem) {
  return stableHash([
    normalizeText(sourceItem?.sourceChannel),
    normalizeText(sourceItem?.sourceKind),
    normalizeText(sourceItem?.sourceAuthority),
    normalizeText(sourceItem?.sourceLocator)
  ].join("|"));
}

function createStableSourceRefId(buildId, sourceItem) {
  return createStableId("sr", `${buildId}|${createStableSourceKey(sourceItem)}`);
}

function createStableSourceIntakeItemId(intakeSessionId, sourceKey) {
  return createStableId("sit", `${intakeSessionId}|${sourceKey}`);
}

function createStablePersistenceBatchKey(buildId, batchIndex, itemIds) {
  return createStableId("spb", `${buildId}|${batchIndex}|${(itemIds || []).join("|")}`);
}

function chunkArray(items, size) {
  const rows = Array.isArray(items) ? items : [];
  const output = [];
  for (let index = 0; index < rows.length; index += size) {
    output.push(rows.slice(index, index + size));
  }
  return output;
}

function toJson(value, fallback) {
  if (value === undefined) return JSON.stringify(fallback);
  return JSON.stringify(value ?? fallback);
}

function buildValuesClause(rows, valueCount, mapRow) {
  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const mapped = mapRow(row);
    values.push(...mapped);
    const offset = rowIndex * valueCount;
    return `(${Array.from({ length: valueCount }, (_, valueIndex) => `$${offset + valueIndex + 1}`).join(", ")})`;
  });
  return {
    values,
    placeholders: placeholders.join(",\n")
  };
}

function estimateTokenCount(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 4);
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function cleanLineText(value) {
  return decodeHtmlEntities(sanitizeText(value))
    .replace(/\s+/g, " ")
    .replace(/\s*([|>])+?\s*/g, " ")
    .trim();
}

function normalizeWebsiteUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeCrawlUrl(baseOrigin, href) {
  try {
    const resolved = new URL(href, baseOrigin);
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    if (resolved.origin !== new URL(baseOrigin).origin) return null;
    resolved.hash = "";
    resolved.search = "";
    return `${resolved.origin}${resolved.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/"}`;
  } catch {
    return null;
  }
}

function shouldSkipUrl(url) {
  const path = String(url.pathname || "").toLowerCase();
  return /\.(jpg|jpeg|png|webp|svg|gif|pdf|xml|zip|mp4|mp3|mov|avi|webm|woff2?|ttf|eot|css|js|json)$/i.test(path)
    || /\/(wp-json|cart|checkout|login|account)\b/.test(path);
}

function isDownloadableUrl(url) {
  const path = String(url.pathname || "").toLowerCase();
  return /\.(pdf|txt|md|csv|json|html|htm)$/i.test(path);
}

function isQuoteFormPath(path) {
  return /\/(quote|quotes|request-quote|get-a-quote|get-quote|free-quote|estimate|estimates|request-estimate|request-an-estimate)\b/.test(path);
}

function isContactFormPath(path) {
  return /\/(contact|contact-us|get-in-touch|request-info|request-information)\b/.test(path);
}

function hasRestrictedFormSignals(text) {
  return /\b(request a quote|get a quote|free estimate|quote request|estimate request|contact us|get in touch|send us a message|submit(ting)? this form|message and data rates|message frequency varies|consent is not a condition of purchase|reply stop|reply help|providing your phone number)\b/.test(text);
}

function classifyPageType(url) {
  const path = String(url.pathname || "/").toLowerCase();
  if (path === "/" || path === "") return "home";
  if (isQuoteFormPath(path)) return "quote_form";
  if (isContactFormPath(path)) return "contact_form";
  if (/\/(faq|faqs)\b/.test(path)) return "faq";
  if (/\/(service-area|service-areas|locations?)\b/.test(path)) return "service_area";
  if (/\/(about|team|providers?)\b/.test(path)) return "contact";
  if (/\b(policy|policies|terms|privacy|new-patient|insurance|financing|payment|warranty|guarantee)\b/.test(path)) return "policy";
  if (/\/blog\b/.test(path)) return "blog_article";
  if (/\/(services?|repair|replacement|installation)\b/.test(path)) return "service_detail";
  return "unknown_mixed";
}

function addPageTypeScore(scoreboard, pageType, points, reason) {
  if (!pageType || !Number.isFinite(points) || points <= 0) return;
  const current = scoreboard.get(pageType) || { score: 0, reasons: [] };
  current.score += points;
  if (reason && current.reasons.length < 8) {
    current.reasons.push(reason);
  }
  scoreboard.set(pageType, current);
}

function countRegexMatches(text, pattern) {
  if (!text || !pattern) return 0;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  let count = 0;
  while (matcher.exec(text)) {
    count += 1;
  }
  return count;
}

function scorePageTypePattern(scoreboard, pageType, label, text, patterns, points) {
  if (!text) return 0;
  let matched = 0;
  for (const pattern of patterns || []) {
    if (pattern.test(text)) {
      matched += 1;
      addPageTypeScore(scoreboard, pageType, points, `${label}:${pattern.source}`);
    }
  }
  return matched;
}

function inferDocumentClass({ sourceChannel, sourceKind, sourceAuthority, pageType, currentDocumentClass, sourceLocator = "" }) {
  const explicit = normalizeText(currentDocumentClass);
  if (explicit) return explicit;
  if (sourceChannel === "owner_interview") {
    return sourceAuthority === "owner_interview_confirmed" ? "operational" : "reference";
  }
  if (sourceChannel === "uploaded_document") {
    if (pageType === "policy" || pageType === "hours") return "policy";
    if (sourceAuthority === "uploaded_first_party_marketing") return "marketing";
    return "reference";
  }
  if (sourceChannel === "website_file") {
    if (pageType === "policy" || pageType === "hours") return "policy";
    if (sourceKind === "pdf") return "reference";
  }
  if (pageType === "policy" || pageType === "hours") return "policy";
  if (pageType === "quote_form" || pageType === "contact_form") return "reference";
  if (pageType === "blog_article") return "reference";
  if (/\/about\b/.test(String(sourceLocator).toLowerCase()) && pageType === "contact") return "reference";
  return "operational";
}

function inferContentClass({ sourceChannel, sourceAuthority, pageType, documentClass, currentContentClass }) {
  const explicit = normalizeText(currentContentClass);
  if (explicit) return explicit;
  if (sourceAuthority === "uploaded_first_party_marketing") return "marketing";
  if (sourceChannel === "owner_interview" && sourceAuthority === "owner_interview_unconfirmed") return "descriptive";
  if (pageType === "policy" || pageType === "hours" || documentClass === "policy") return "policy_boundary";
  if (pageType === "quote_form" || pageType === "contact_form") return "restricted_process";
  if (pageType === "blog_article") return "educational";
  if (pageType === "contact") return "descriptive";
  if (documentClass === "reference") return "descriptive";
  return "operational_core";
}

function analyzeSourceClassification(input = {}) {
  const sourceChannel = normalizeText(input.sourceChannel || input.source_channel) || "website_page";
  const sourceKind = normalizeText(input.sourceKind || input.source_kind) || "text";
  const sourceAuthority = normalizeText(input.sourceAuthority || input.source_authority) || "website_public_page";
  const sourceLocator = normalizeText(input.sourceLocator || input.source_locator);
  const title = normalizeText(input.title);
  const headings = uniqueValues(Array.isArray(input.headings) ? input.headings : []);
  const lines = Array.isArray(input.lines) ? input.lines.map(cleanLineText).filter(Boolean) : [];
  const text = normalizeText(input.text || lines.join(" "));
  const providedPageType = normalizeText(input.pageType || input.page_type);
  const providedDocumentClass = normalizeText(input.documentClass || input.document_class);
  const providedContentClass = normalizeText(input.contentClass || input.content_class);
  const url = sourceLocator && /^https?:\/\//i.test(sourceLocator) ? new URL(sourceLocator) : null;
  const path = String(url?.pathname || "").toLowerCase();
  const titleText = title.toLowerCase();
  const headingText = headings.join(" ").toLowerCase();
  const sampledText = truncateText(text, 8000).toLowerCase();
  const combinedShortText = [titleText, headingText, truncateText(text, 2400).toLowerCase()].filter(Boolean).join(" ");
  const serviceLexiconText = [path.replace(/[-_/]+/g, " "), titleText, headingText, truncateText(text, 1800).toLowerCase()]
    .filter(Boolean)
    .join(" ");
  const concreteServicePattern = /\b(water heater|tankless|drain|sewer|furnace|hvac|electrical panel|panel upgrade|panel replacement|plumbing|electrician|electrical|heat pump|air conditioning|cooling|heating|repipe|pipe repair|leak detection)\b/;
  const serviceActionPattern = /\b(repair|replacement|replace|installation|install|maintenance|inspection|upgrade|cleaning)\b/;
  const hasConcreteServicePath = /\b(water-heater|tankless|drain|sewer|furnace|hvac|electrical-panel|panel-upgrade|panel-replacement|plumb(er|ing)|electric(al|ian)|heat-pump|air-conditioning|cooling|heating|repipe|pipe-repair|leak-detection)\b/.test(path);
  const hasConcreteServiceTitle = concreteServicePattern.test(`${titleText} ${headingText}`);
  const hasConcreteServiceBody = concreteServicePattern.test(serviceLexiconText);
  const hasServiceActionPath = /\b(repair|replacement|installation|maintenance|inspection|upgrade|cleaning)\b/.test(path);
  const hasServiceActionTitle = serviceActionPattern.test(`${titleText} ${headingText}`);
  const hasServiceActionBody = serviceActionPattern.test(serviceLexiconText);
  const hasPolicySignal = /\b(warranty|guarantee|financing|payment|terms|privacy|policy|after hours|insurance)\b/.test(`${path} ${titleText} ${headingText}`);
  const questionHeadingCount = headings.filter((heading) => /\?$/.test(heading) || /^(q[:\s-]|question[:\s-])/i.test(heading)).length;
  const dayCount = countRegexMatches(sampledText, /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon\b|tue\b|wed\b|thu\b|fri\b|sat\b|sun\b)\b/i);
  const timeCount = countRegexMatches(sampledText, /\b\d{1,2}(?::\d{2})?\s?(am|pm)\b/i) + countRegexMatches(sampledText, /\b\d{1,2}\s?(am|pm)\s?-\s?\d{1,2}\s?(am|pm)\b/i);
  const scoreboard = new Map();

  if (!path || path === "/") {
    addPageTypeScore(scoreboard, "home", 10, "path:root");
  }
  if (providedPageType && providedPageType !== "unknown_mixed") {
    addPageTypeScore(scoreboard, providedPageType, 1.5, `provided:${providedPageType}`);
  }
  if (sourceChannel === "owner_interview") {
    addPageTypeScore(scoreboard, "process", 4, "source_channel:owner_interview");
  }
  if (sourceChannel === "website_file" && (providedDocumentClass === "policy" || sourceKind === "pdf")) {
    addPageTypeScore(scoreboard, "policy", 2, "source_channel:website_file");
  }

  scorePageTypePattern(scoreboard, "faq", "path", path, [/\/(faq|faqs)\b/], 6);
  scorePageTypePattern(scoreboard, "faq", "title", `${titleText} ${headingText}`, [/\bfaq(s)?\b/, /frequently asked questions?/], 5);
  if (questionHeadingCount >= 2) {
    addPageTypeScore(scoreboard, "faq", 4, `headings:question_like:${questionHeadingCount}`);
  }

  scorePageTypePattern(scoreboard, "service_area", "path", path, [/\/(locations?|service-area|service-areas)\b/, /\bareas?-we-serve\b/], 6);
  scorePageTypePattern(scoreboard, "service_area", "title", `${titleText} ${headingText}`, [/\b(service areas?|areas we serve|locations?|cities we serve|where we serve)\b/], 5);
  scorePageTypePattern(scoreboard, "service_area", "text", combinedShortText, [/\b(serving|service area|coverage area|areas we serve|cities we serve)\b/], 2);

  scorePageTypePattern(scoreboard, "quote_form", "path", path, [/\/(quote|quotes|request-quote|get-a-quote|get-quote|free-quote|estimate|estimates|request-estimate|request-an-estimate)\b/], 8);
  scorePageTypePattern(scoreboard, "quote_form", "title", `${titleText} ${headingText}`, [/\b(request a quote|get a quote|free estimate|quote request|estimate request)\b/], 7);
  scorePageTypePattern(scoreboard, "quote_form", "text", combinedShortText, [/\b(request a quote|get a quote|free estimate|quote request|estimate request)\b/, /\b(submit(ting)? this form|message and data rates|consent is not a condition of purchase|reply stop|reply help)\b/], 3);

  scorePageTypePattern(scoreboard, "contact_form", "path", path, [/\/(contact|contact-us|get-in-touch|request-info|request-information)\b/], 7);
  scorePageTypePattern(scoreboard, "contact_form", "title", `${titleText} ${headingText}`, [/\b(contact us|get in touch|send us a message|request information|reach out)\b/], 6);
  scorePageTypePattern(scoreboard, "contact_form", "text", combinedShortText, [/\b(contact us|get in touch|send us a message|request information)\b/, /\b(submit(ting)? this form|message and data rates|consent is not a condition of purchase|reply stop|reply help)\b/], 2.5);

  scorePageTypePattern(scoreboard, "policy", "path", path, [/\b(warranty|guarantee|financing|payment|terms|privacy|policy|after-hours?|insurance)\b/], 6);
  scorePageTypePattern(scoreboard, "policy", "title", `${titleText} ${headingText}`, [/\b(warranty|guarantee|financing|payment options?|terms|privacy|after hours?|insurance)\b/], 5);
  scorePageTypePattern(scoreboard, "policy", "text", combinedShortText, [/\b(warranty|guarantee|financing|payment options?|eligibility|applies|qualify|coverage|exclusions?|limitations?|terms and conditions)\b/], 2);

  scorePageTypePattern(scoreboard, "contact", "path", path, [/\/(about|team|providers?|staff)\b/], 4);
  scorePageTypePattern(scoreboard, "contact", "title", `${titleText} ${headingText}`, [/\b(office|our team|provider|about us|meet the team)\b/], 4);
  scorePageTypePattern(scoreboard, "contact", "text", combinedShortText, [/\b(call us|phone|email|office|visit us|address)\b/], 1.5);

  scorePageTypePattern(scoreboard, "blog_article", "path", path, [/\/blog\b/, /\/articles?\b/, /\/guides?\b/], 6);
  scorePageTypePattern(scoreboard, "blog_article", "title", `${titleText} ${headingText}`, [/\b(blog|article|guide|tips?|resources?)\b/], 4);

  scorePageTypePattern(scoreboard, "process", "title", `${titleText} ${headingText}`, [/\b(what to expect|process|how it works|next steps?|our process|appointment)\b/], 4);
  scorePageTypePattern(scoreboard, "process", "text", combinedShortText, [/\b(what to expect|next steps?|our process|we will|appointment|callback|schedule)\b/], 2);

  scorePageTypePattern(scoreboard, "hours", "path", path, [/\/(hours|business-hours|holiday-hours)\b/], 6);
  scorePageTypePattern(scoreboard, "hours", "title", `${titleText} ${headingText}`, [/\b(hours?|business hours|open now|holiday hours)\b/], 5);
  if (dayCount >= 2 && timeCount >= 1) {
    addPageTypeScore(scoreboard, "hours", 5, `text:days_and_times:${dayCount}/${timeCount}`);
  }
  scorePageTypePattern(scoreboard, "hours", "text", combinedShortText, [/\b(after hours|weekend hours|holiday hours)\b/], 2);

  if (hasConcreteServicePath && (hasServiceActionPath || hasServiceActionTitle || hasServiceActionBody)) {
    addPageTypeScore(scoreboard, "service_detail", 7, "path:concrete_service_with_action");
  }
  if (hasConcreteServiceTitle && (hasServiceActionTitle || hasServiceActionPath)) {
    addPageTypeScore(scoreboard, "service_detail", 6, "title:concrete_service_with_action");
  }
  if ((hasConcreteServiceTitle || hasConcreteServicePath) && hasConcreteServiceBody && hasServiceActionBody) {
    addPageTypeScore(scoreboard, "service_detail", 2, "text:service_detail_support");
  }
  if (/\b(seattle|bellevue|renton|tacoma|olympia|kirkland|redmond|sammamish|auburn)\b/.test(path) && (scoreboard.get("service_detail")?.score || 0) > 0) {
    addPageTypeScore(scoreboard, "service_detail", 1.5, "path:service_with_location");
  }

  if ((scoreboard.get("service_detail")?.score || 0) >= 5 && (scoreboard.get("hours")?.score || 0) > 0) {
    addPageTypeScore(scoreboard, "service_detail", 1, "disambiguation:service_over_hours");
  }
  if ((scoreboard.get("service_detail")?.score || 0) >= 5 && (scoreboard.get("policy")?.score || 0) > 0 && !hasPolicySignal) {
    addPageTypeScore(scoreboard, "service_detail", 1, "disambiguation:service_over_policy");
  }
  if ((scoreboard.get("service_area")?.score || 0) >= 6 && (scoreboard.get("service_detail")?.score || 0) > 0) {
    addPageTypeScore(scoreboard, "service_area", 2, "disambiguation:service_area_over_service_detail");
  }
  if ((scoreboard.get("policy")?.score || 0) >= 6 && (scoreboard.get("service_detail")?.score || 0) > 0) {
    addPageTypeScore(scoreboard, "policy", 2, "disambiguation:policy_over_service_detail");
  }
  if (hasRestrictedFormSignals(combinedShortText) && isQuoteFormPath(path)) {
    addPageTypeScore(scoreboard, "quote_form", 4, "text:restricted_form_signals_quote");
  }
  if (hasRestrictedFormSignals(combinedShortText) && isContactFormPath(path)) {
    addPageTypeScore(scoreboard, "contact_form", 4, "text:restricted_form_signals_contact");
  }

  addPageTypeScore(scoreboard, "unknown_mixed", 0.5, "fallback");

  const candidates = Array.from(scoreboard.entries())
    .map(([pageType, value]) => ({
      page_type: pageType,
      score: Number(value.score || 0),
      reasons: uniqueValues(value.reasons || [])
    }))
    .sort((left, right) => right.score - left.score || left.page_type.localeCompare(right.page_type));

  const winner = candidates[0] || { page_type: providedPageType || "unknown_mixed", score: 0, reasons: [] };
  const secondScore = Number(candidates[1]?.score || 0);
  const margin = Number(winner.score || 0) - secondScore;
  const confidence = winner.score >= 10 || (winner.score >= 8 && margin >= 3)
    ? "high"
    : winner.score >= 5 || margin >= 2
      ? "medium"
      : "low";
  const documentClass = inferDocumentClass({
    sourceChannel,
    sourceKind,
    sourceAuthority,
    pageType: winner.page_type,
    currentDocumentClass: providedDocumentClass,
    sourceLocator
  });
  const contentClass = inferContentClass({
    sourceChannel,
    sourceAuthority,
    pageType: winner.page_type,
    documentClass,
    currentContentClass: providedContentClass
  });

  return {
    version: SOURCE_CLASSIFICATION_VERSION,
    pageType: winner.page_type || "unknown_mixed",
    documentClass,
    contentClass,
    confidence,
    confidenceScore: Number(winner.score || 0),
    scoreMargin: margin,
    reasons: uniqueValues(winner.reasons || []).slice(0, 8),
    candidates: candidates.slice(0, 4),
    signals: {
      source_channel: sourceChannel,
      source_kind: sourceKind,
      source_authority: sourceAuthority,
      provided_page_type: providedPageType || null,
      path,
      title: truncateText(title, 180),
      headings: headings.slice(0, 6)
    }
  };
}

function extractTagTextList(html, tagName) {
  return Array.from(String(html || "").matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi")))
    .map((match) => cleanLineText(match[1].replace(/<[^>]+>/g, " ")))
    .filter(Boolean);
}

function looksLikeBoilerplate(line) {
  const text = normalizeText(line).toLowerCase();
  if (!text) return true;
  if (text.includes("privacy policy") || text.includes("terms of service")) return true;
  if (text.includes("copyright")) return true;
  if (text.includes("book online") || text.includes("call today")) return true;
  return text.split(/\s+/).length < 4 && !/\d/.test(text);
}

function extractStructuredPageContent(html) {
  const source = String(html || "");
  const title = cleanLineText(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || source;
  const stripped = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  const headings = uniqueValues([
    ...extractTagTextList(stripped, "h1"),
    ...extractTagTextList(stripped, "h2"),
    ...extractTagTextList(stripped, "h3")
  ]).slice(0, 8);

  const lines = decodeHtmlEntities(
    stripped
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(main|article|section|div|p|ul|ol|li|table|tr|td|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<(main|article|section|div|p|ul|ol|li|table|tr|td|h1|h2|h3|h4|h5|h6)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\n+/)
    .map(cleanLineText)
    .filter((line) => line.length >= 24 && !looksLikeBoilerplate(line));

  return {
    title,
    headings,
    lines,
    text: lines.join(" ")
  };
}

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "EveryCall Knowledge Build" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBufferWithLimit(response, maxBytes) {
  const safeMaxBytes = Math.max(1024, Number(maxBytes || 0));
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > safeMaxBytes) {
    throw new Error("website_response_too_large");
  }

  const stream = response.body;
  if (!stream) return Buffer.alloc(0);

  const chunks = [];
  let totalBytes = 0;

  if (typeof stream.getReader === "function") {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > safeMaxBytes) {
          throw new Error("website_response_too_large");
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > safeMaxBytes) {
      throw new Error("website_response_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  if (normalized === "metadata" || normalized === "metadata.google.internal") return true;
  if (normalized === "169.254.169.254") return true;
  return false;
}

function isBlockedIpAddress(address) {
  const normalized = String(address || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIpAddress(normalized.slice(7));
  }
  const version = net.isIP(normalized);
  if (version === 4) {
    const parts = normalized.split(".").map((item) => Number.parseInt(item, 10));
    if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item) || item < 0 || item > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe80:")) return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    return false;
  }
  return true;
}

async function assertSafePublicWebsiteUrl(value, { allowedOrigin = null } = {}) {
  const url = value instanceof URL ? value : new URL(String(value || ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("website_url_invalid_protocol");
  }
  if (allowedOrigin && url.origin !== allowedOrigin) {
    throw new Error("website_redirect_origin_not_allowed");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("website_target_not_public");
  }
  if (net.isIP(url.hostname)) {
    if (isBlockedIpAddress(url.hostname)) {
      throw new Error("website_target_not_public");
    }
    return url;
  }
  let addresses = [];
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("website_target_unresolvable");
  }
  if (!Array.isArray(addresses) || !addresses.length) {
    throw new Error("website_target_unresolvable");
  }
  if (addresses.some((entry) => isBlockedIpAddress(entry?.address))) {
    throw new Error("website_target_not_public");
  }
  return url;
}

async function fetchSafeResponse(url, { allowedOrigin = null, timeoutMs = FETCH_TIMEOUT_MS, maxRedirects = 5 } = {}) {
  let nextUrl = String(url || "");
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeUrl = await assertSafePublicWebsiteUrl(nextUrl, { allowedOrigin });
    const response = await fetchWithTimeout(safeUrl.toString(), timeoutMs);
    if (response.status >= 300 && response.status < 400) {
      const location = String(response.headers.get("location") || "").trim();
      if (!location) {
        throw new Error("website_redirect_missing_location");
      }
      const redirected = new URL(location, safeUrl);
      await assertSafePublicWebsiteUrl(redirected, { allowedOrigin });
      nextUrl = redirected.toString();
      continue;
    }
    return {
      response,
      finalUrl: safeUrl.toString()
    };
  }
  throw new Error("website_redirect_limit_exceeded");
}

export async function fetchWebsitePage(url, options = {}) {
  try {
    const { response, finalUrl } = await fetchSafeResponse(url, options);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        failureReason: `http_${response.status}`,
        url: finalUrl,
        html: "",
        title: "",
        headings: [],
        lines: [],
        text: ""
      };
    }
    const html = (await readResponseBufferWithLimit(response, MAX_WEBSITE_PAGE_BYTES)).toString("utf8");
    const structured = extractStructuredPageContent(html);
    return {
      ok: true,
      status: response.status,
      url: finalUrl,
      html,
      title: structured.title,
      headings: structured.headings,
      lines: structured.lines,
      text: structured.text
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      failureReason: normalizeText(err?.name || err?.message || "fetch_failed") || "fetch_failed",
      url,
      html: "",
      title: "",
      headings: [],
      lines: [],
      text: ""
    };
  }
}

function extractLinkInventory(baseUrl, html) {
  const source = String(html || "");
  const seen = new Set();
  const pageLinks = [];
  const fileLinks = [];
  const skippedLinks = [];
  let duplicateCount = 0;
  let canonicalizedCount = 0;
  for (const match of source.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    const rawHref = normalizeText(match[1]);
    const normalized = normalizeCrawlUrl(baseUrl, rawHref);
    if (!normalized) continue;
    try {
      const resolved = new URL(rawHref, baseUrl);
      const resolvedRaw = `${resolved.origin}${resolved.pathname}${resolved.search}${resolved.hash}`;
      if (normalized !== resolvedRaw) {
        canonicalizedCount += 1;
      }
    } catch {
      // Ignore canonicalization accounting for invalid URLs that were dropped.
    }
    if (seen.has(normalized)) {
      duplicateCount += 1;
      continue;
    }
    const url = new URL(normalized);
    seen.add(normalized);
    if (isDownloadableUrl(url)) {
      fileLinks.push(normalized);
      continue;
    }
    if (shouldSkipUrl(url)) {
      skippedLinks.push({
        sourceLocator: normalized,
        reason: "filtered_url"
      });
      continue;
    }
    pageLinks.push(normalized);
  }
  return {
    pageLinks,
    fileLinks,
    skippedLinks,
    duplicateCount,
    canonicalizedCount
  };
}

function recordDiscoveryEntry(store, key, entry) {
  if (!key || store.has(key)) return;
  store.set(key, entry);
}

function pushUniqueValue(list, value) {
  const text = normalizeText(value);
  if (!text) return;
  if (!list.includes(text)) {
    list.push(text);
  }
}

async function fetchWebsiteDownloadable(url, options = {}) {
  try {
    const { response, finalUrl } = await fetchSafeResponse(url, options);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        failureReason: `http_${response.status}`,
        url: finalUrl,
        mimeType: "",
        sourceKind: "text",
        title: "",
        lines: [],
        text: ""
      };
    }
    const buffer = await readResponseBufferWithLimit(response, MAX_WEBSITE_DOWNLOAD_BYTES);
    const parsed = extractTextFromDocumentBuffer({
      buffer,
      mimeType: response.headers.get("content-type") || "",
      filename: new URL(finalUrl).pathname.split("/").filter(Boolean).slice(-1)[0] || "",
      locator: finalUrl
    });
    const title = new URL(finalUrl).pathname.split("/").filter(Boolean).slice(-1)[0] || finalUrl;
    return {
      ok: true,
      status: response.status,
      url: finalUrl,
      mimeType: parsed.mimeType,
      sourceKind: parsed.sourceKind,
      title,
      lines: splitPlainTextToLines(parsed.bodyText),
      text: parsed.bodyText,
      parseMethod: parsed.parseMethod
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      failureReason: normalizeText(err?.name || err?.message || "fetch_failed") || "fetch_failed",
      url,
      mimeType: "",
      sourceKind: "text",
      title: "",
      lines: [],
      text: ""
    };
  }
}

async function fetchInitialWebsitePageWithRetry(url) {
  const failures = [];
  const maxAttempts = Math.max(1, Number(INITIAL_WEBSITE_FETCH_MAX_ATTEMPTS || 1));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await fetchWebsitePage(url);
    if (result.ok) {
      if (attempt > 1) {
        logBuildProgress("crawl_root_retry_recovered", {
          url: result.url,
          attempts: attempt
        });
      }
      return result;
    }

    const failure = {
      attempt,
      status: Number.isFinite(Number(result.status)) ? Number(result.status) : null,
      failureReason: normalizeText(result.failureReason || "fetch_failed") || "fetch_failed",
      url: normalizeText(result.url || url) || normalizeText(url)
    };
    failures.push(failure);
    logBuildProgress("crawl_root_retry_failed", {
      attempt,
      url: failure.url,
      status: failure.status,
      failureReason: failure.failureReason
    });

    if (attempt < maxAttempts) {
      await sleep(INITIAL_WEBSITE_FETCH_RETRY_DELAY_MS * attempt);
    }
  }

  const summaryReasons = uniqueValues(
    failures.map((failure) => formatWebsiteFetchFailureReason(failure))
  );
  const displayMessage = `Website fetch failed after ${failures.length} attempt${failures.length === 1 ? "" : "s"}: ${summaryReasons.join("; ")}`;
  throw createKnowledgeBuildError("website_fetch_failed", displayMessage, {
    displayMessage,
    failureMessages: failures.map((failure) => (
      `Attempt ${failure.attempt}: ${formatWebsiteFetchFailureReason(failure)}`
    )),
    failures
  });
}

async function crawlWebsiteSources(rootUrl) {
  const normalizedRootUrl = normalizeWebsiteUrl(rootUrl);
  if (!normalizedRootUrl) {
    throw new Error("website_url_required");
  }
  const crawlStartedAt = performance.now();
  const crawlDeadlineAt = crawlStartedAt + WEBSITE_CRAWL_DEADLINE_MS;
  const truncationReasons = [];

  const firstPage = await fetchInitialWebsitePageWithRetry(normalizedRootUrl);
  const crawlOrigin = new URL(firstPage.url).origin;

  const pages = [firstPage];
  const visited = new Set([firstPage.url]);
  const discoveredPageUrls = new Set([firstPage.url]);
  const discoveredFileUrls = new Set();
  const skippedByLocator = new Map();
  const failedPageByLocator = new Map();
  const failedFileByLocator = new Map();
  let duplicateDiscoveryCount = 0;
  let canonicalizedDiscoveryCount = 0;
  let retryArtifactCount = 0;
  const firstInventory = extractLinkInventory(firstPage.url, firstPage.html);
  const queue = firstInventory.pageLinks.slice(0, MAX_WEBSITE_PAGES * 2);
  const downloadableQueue = firstInventory.fileLinks.slice(0, MAX_WEBSITE_FILES * 2);
  const downloadableSeen = new Set(downloadableQueue);
  duplicateDiscoveryCount += Number(firstInventory.duplicateCount || 0);
  canonicalizedDiscoveryCount += Number(firstInventory.canonicalizedCount || 0);
  for (const url of queue) discoveredPageUrls.add(url);
  for (const url of downloadableQueue) discoveredFileUrls.add(url);
  for (const entry of firstInventory.skippedLinks) {
    recordDiscoveryEntry(skippedByLocator, entry.sourceLocator, entry);
  }
  logBuildProgress("crawl_started", {
    rootUrl: normalizedRootUrl,
    seedPageCount: 1,
    initialDiscoveredPageQueue: queue.length,
    initialDiscoveredFileQueue: downloadableQueue.length,
    maxWebsitePages: MAX_WEBSITE_PAGES,
    maxWebsiteFiles: MAX_WEBSITE_FILES,
    crawlDeadlineMs: WEBSITE_CRAWL_DEADLINE_MS
  });

  while (queue.length && pages.length < MAX_WEBSITE_PAGES) {
    if (performance.now() >= crawlDeadlineAt) {
      pushUniqueValue(truncationReasons, "crawl_deadline_reached");
      break;
    }
    const batch = queue.splice(0, CRAWL_BATCH_SIZE);
    const results = await Promise.all(batch.map((url) => fetchWebsitePage(url, { allowedOrigin: crawlOrigin })));
    for (const result of results) {
      if (!result.ok) {
        recordDiscoveryEntry(failedPageByLocator, result.url, {
          sourceLocator: result.url,
          reason: result.failureReason || "fetch_failed",
          status: result.status
        });
        continue;
      }
      if (visited.has(result.url) || !result.text) {
        if (!result.text) {
          recordDiscoveryEntry(failedPageByLocator, result.url, {
            sourceLocator: result.url,
            reason: "empty_text",
            status: result.status
          });
        }
        continue;
      }
      visited.add(result.url);
      if (failedPageByLocator.has(result.url)) {
        retryArtifactCount += 1;
      }
      failedPageByLocator.delete(result.url);
      pages.push(result);
      const linkInventory = extractLinkInventory(crawlOrigin, result.html);
      duplicateDiscoveryCount += Number(linkInventory.duplicateCount || 0);
      canonicalizedDiscoveryCount += Number(linkInventory.canonicalizedCount || 0);
      for (const entry of linkInventory.skippedLinks) {
        recordDiscoveryEntry(skippedByLocator, entry.sourceLocator, entry);
      }
      for (const url of linkInventory.pageLinks) {
        discoveredPageUrls.add(url);
        if (visited.has(url) || queue.includes(url)) {
          duplicateDiscoveryCount += 1;
          continue;
        }
        queue.push(url);
      }
      for (const url of linkInventory.fileLinks) {
        discoveredFileUrls.add(url);
        if (downloadableSeen.has(url)) {
          duplicateDiscoveryCount += 1;
          continue;
        }
        downloadableSeen.add(url);
        downloadableQueue.push(url);
      }
      if (pages.length >= MAX_WEBSITE_PAGES) break;
    }
    logBuildProgress("crawl_page_batch_completed", {
      pageCount: pages.length,
      queueRemaining: queue.length,
      downloadableQueue: downloadableQueue.length
    });
  }

  const files = [];
  while (downloadableQueue.length && files.length < MAX_WEBSITE_FILES) {
    if (performance.now() >= crawlDeadlineAt) {
      pushUniqueValue(truncationReasons, "crawl_deadline_reached");
      break;
    }
    const batch = downloadableQueue.splice(0, CRAWL_BATCH_SIZE);
    const results = await Promise.all(batch.map((url) => fetchWebsiteDownloadable(url, { allowedOrigin: crawlOrigin })));
    for (const result of results) {
      if (!result.ok) {
        recordDiscoveryEntry(failedFileByLocator, result.url, {
          sourceLocator: result.url,
          reason: result.failureReason || "fetch_failed",
          status: result.status
        });
        continue;
      }
      if (!normalizeText(result.text)) {
        recordDiscoveryEntry(failedFileByLocator, result.url, {
          sourceLocator: result.url,
          reason: "empty_text",
          status: result.status
        });
        continue;
      }
      if (failedFileByLocator.has(result.url)) {
        retryArtifactCount += 1;
      }
      failedFileByLocator.delete(result.url);
      files.push({
        sourceUrl: result.url,
        title: result.title,
        lines: result.lines,
        text: result.text,
        mimeType: result.mimeType,
        sourceKind: result.sourceKind,
        parseMethod: result.parseMethod,
        pageType: classifyTextPageType(result.title, result.text, "policy")
      });
      if (files.length >= MAX_WEBSITE_FILES) break;
    }
    logBuildProgress("crawl_file_batch_completed", {
      pageCount: pages.length,
      fileCount: files.length,
      downloadableQueueRemaining: downloadableQueue.length
    });
  }

  if (queue.length && pages.length >= MAX_WEBSITE_PAGES) {
    pushUniqueValue(truncationReasons, "max_website_pages_reached");
  }
  if (downloadableQueue.length && files.length >= MAX_WEBSITE_FILES) {
    pushUniqueValue(truncationReasons, "max_website_files_reached");
  }
  if ((queue.length || downloadableQueue.length) && performance.now() >= crawlDeadlineAt) {
    pushUniqueValue(truncationReasons, "crawl_deadline_reached");
  }

  const includedPageUrls = new Set(pages.map((page) => page.url));
  const includedFileUrls = new Set(files.map((file) => file.sourceUrl));
  const filteredFailedPageEntries = Array.from(failedPageByLocator.values())
    .filter((entry) => !includedPageUrls.has(normalizeText(entry.sourceLocator)));
  const filteredFailedFileEntries = Array.from(failedFileByLocator.values())
    .filter((entry) => !includedFileUrls.has(normalizeText(entry.sourceLocator)));
  const crawlElapsedMs = Math.round((performance.now() - crawlStartedAt) * 100) / 100;

  return {
    pages: pages.map((page) => ({
      sourceUrl: page.url,
      title: page.title || new URL(page.url).hostname,
      headings: page.headings,
      lines: page.lines,
      text: page.text,
      pageType: classifyPageType(new URL(page.url))
    })),
    files,
    crawlSummary: {
      rootUrl: normalizedRootUrl,
      crawlDeadlineMs: WEBSITE_CRAWL_DEADLINE_MS,
      crawlElapsedMs,
      truncated: truncationReasons.length > 0,
      truncationReasons,
      discoveredWebsitePages: discoveredPageUrls.size,
      discoveredWebsiteFiles: discoveredFileUrls.size,
      includedWebsitePages: pages.length,
      includedWebsiteFiles: files.length,
      skippedCount: skippedByLocator.size,
      failedCount: filteredFailedPageEntries.length + filteredFailedFileEntries.length,
      trueFailedPageCount: filteredFailedPageEntries.length,
      trueFailedFileCount: filteredFailedFileEntries.length,
      retryArtifactCount,
      duplicateDiscoveryCount,
      canonicalizedDiscoveryCount,
      skippedReasonCounts: Array.from(skippedByLocator.values()).reduce((acc, entry) => {
        const key = normalizeText(entry.reason) || "skipped";
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {}),
      failedReasonCounts: [...filteredFailedPageEntries, ...filteredFailedFileEntries].reduce((acc, entry) => {
        const key = normalizeText(entry.reason) || "failed";
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {}),
      skippedEntries: Array.from(skippedByLocator.values()),
      failedEntries: [...filteredFailedPageEntries, ...filteredFailedFileEntries]
    }
  };
}

function inferObjectType(pageType) {
  if (pageType === "hours") return "hours";
  if (pageType === "service_detail") return "offering";
  if (pageType === "service_area") return "service_area";
  if (pageType === "policy") return "policy";
  if (pageType === "quote_form" || pageType === "contact_form") return "process";
  if (pageType === "contact") return "contact_channel";
  if (pageType === "process") return "process";
  return "faq";
}

function inferCardType(pageType) {
  if (pageType === "hours") return "policy";
  if (pageType === "service_detail") return "service";
  if (pageType === "service_area") return "coverage";
  if (pageType === "policy") return "policy";
  if (pageType === "quote_form" || pageType === "contact_form") return "process";
  if (pageType === "contact") return "process";
  return "general";
}

function splitPlainTextToLines(text, limit = 4000) {
  return String(text || "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map(cleanLineText)
    .filter((line) => line.length >= 24 && !looksLikeBoilerplate(line))
    .slice(0, limit);
}

function classifyTextPageType(title, text, fallback = "unknown_mixed") {
  const classification = analyzeSourceClassification({
    title,
    text,
    pageType: fallback,
    contentClass: ""
  });
  return classification.pageType || fallback;
}

function sourceAuthorityPriority(sourceAuthority) {
  if (sourceAuthority === "owner_interview_confirmed") return 95;
  if (sourceAuthority === "uploaded_first_party_policy") return 92;
  if (sourceAuthority === "uploaded_first_party_operational") return 90;
  if (sourceAuthority === "website_public_downloadable") return 82;
  if (sourceAuthority === "website_public_page") return 70;
  if (sourceAuthority === "uploaded_first_party_reference") return 60;
  if (sourceAuthority === "owner_interview_unconfirmed") return 45;
  if (sourceAuthority === "uploaded_first_party_marketing") return 18;
  return 35;
}

function contentClassPriority(contentClass) {
  if (contentClass === "policy_boundary") return 30;
  if (contentClass === "operational_core") return 24;
  if (contentClass === "restricted_process") return 8;
  if (contentClass === "descriptive") return 10;
  if (contentClass === "educational") return 3;
  return 0;
}

function normalizeSourceItem(item) {
  const sourceChannel = normalizeText(item?.sourceChannel || item?.source_channel) || "website_page";
  const sourceAuthority = normalizeText(item?.sourceAuthority || item?.source_authority) || "website_public_page";
  const sourceSessionId = normalizeText(item?.sourceSessionId || item?.source_session_id) || null;
  const title = normalizeText(item?.title);
  const text = normalizeText(item?.text);
  const sourceLocator = normalizeText(item?.sourceLocator || item?.source_locator);
  let locatorAlias = "";
  if (sourceLocator) {
    try {
      locatorAlias = String(new URL(sourceLocator).pathname.split("/").filter(Boolean).slice(-1)[0] || "")
        .replace(/[-_]+/g, " ")
        .trim();
    } catch {
      locatorAlias = "";
    }
  }
  const lines = Array.isArray(item?.lines) && item.lines.length
    ? item.lines.map((value) => cleanLineText(value)).filter(Boolean)
    : splitPlainTextToLines(text);
  const headings = Array.isArray(item?.headings) ? item.headings.map((value) => cleanLineText(value)).filter(Boolean) : [];
  const metadata = item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? { ...item.metadata } : {};
  const classification = analyzeSourceClassification({
    sourceChannel,
    sourceKind: normalizeText(item?.sourceKind || item?.source_kind) || "text",
    sourceAuthority,
    sourceLocator,
    sourceSessionId,
    title: title || locatorAlias || "Knowledge Source",
    headings,
    lines,
    text: text || lines.join(" "),
    pageType: normalizeText(item?.pageType || item?.page_type) || normalizeText(metadata.page_type),
    documentClass: normalizeText(item?.documentClass || item?.document_class),
    contentClass: normalizeText(item?.contentClass || item?.content_class)
  });
  const documentClass = classification.documentClass;
  const contentClass = classification.contentClass;
  const pageType = classification.pageType;
  const normalizedMetadata = {
    ...metadata,
    source_session_id: sourceSessionId,
    document_class: documentClass,
    content_class: contentClass,
    page_type: pageType,
    classification_version: classification.version,
    classification_confidence: classification.confidence,
    classification_score: classification.confidenceScore,
    classification_margin: classification.scoreMargin,
    classification_reasons: classification.reasons,
    classification_candidates: classification.candidates,
    classification_signals: classification.signals
  };

  return {
    sourceChannel,
    sourceKind: normalizeText(item?.sourceKind || item?.source_kind) || "text",
    sourceAuthority,
    sourceLocator,
    sourceSessionId,
    title: title || locatorAlias || "Knowledge Source",
    headings,
    lines,
    text: text || lines.join(" "),
    pageType,
    documentClass,
    contentClass,
    compileEnabled: item?.compileEnabled !== false,
    metadata: normalizedMetadata,
    sourcePriority: sourceAuthorityPriority(sourceAuthority),
    contentPriority: contentClassPriority(contentClass),
    classification
  };
}

function titleAliases(title, sourceLocator) {
  let pathLeaf = "";
  if (sourceLocator) {
    try {
      pathLeaf = String(new URL(sourceLocator).pathname.split("/").filter(Boolean).slice(-1)[0] || "")
        .replace(/[-_]+/g, " ")
        .trim();
    } catch {
      pathLeaf = "";
    }
  }
  return uniqueValues([title, pathLeaf]);
}

function buildCallerPhrases(title, lines) {
  const phrases = [];
  if (title) phrases.push(title);
  for (const line of lines || []) {
    const trimmed = truncateText(line, 80);
    if (trimmed) phrases.push(trimmed);
    if (phrases.length >= 5) break;
  }
  return uniqueValues(phrases).slice(0, 5);
}

function buildDirectQuestionPhrases(baseName, variants = []) {
  const name = normalizeText(baseName);
  if (!name) return [];
  const questions = [
    `How does ${name} work?`,
    `What is ${name}?`,
    `Tell me about ${name}.`,
    ...variants
  ];
  return uniqueValues(questions).slice(0, 6);
}

function policyBaseName(title) {
  const normalized = normalizeText(title);
  if (!normalized) return "Policy";
  return normalized.replace(/\s*[-|–]\s*.*$/, "").trim() || normalized;
}

function isPromotionalPolicyLine(line) {
  return /\b(schedule a service|book online|call today|request service)\b/i.test(normalizeText(line));
}

function isPolicyLikeSourceItem(sourceItem) {
  const lower = `${normalizeText(sourceItem?.title)} ${normalizeText(sourceItem?.text)}`.toLowerCase();
  return normalizeText(sourceItem?.pageType) === "policy"
    || normalizeText(sourceItem?.contentClass) === "policy_boundary"
    || /\b(warranty|guarantee|coverage|policy|terms|limitations?)\b/.test(lower);
}

function compactUniqueLines(lines) {
  const output = [];
  const seen = new Set();
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = cleanLineText(rawLine);
    const key = line.toLowerCase();
    if (!line || seen.has(key) || isPromotionalPolicyLine(line)) continue;
    seen.add(key);
    output.push(line);
  }
  return output;
}

function buildPolicySections(sourceItem) {
  const lines = compactUniqueLines(sourceItem.lines);
  const baseName = policyBaseName(sourceItem.title);
  const sections = {
    overview: [],
    coverage: [],
    limits: [],
    nextSteps: []
  };

  let currentSection = "overview";
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower === normalizeText(sourceItem.title).toLowerCase() || lower === baseName.toLowerCase()) {
      if (!sections.overview.includes(line)) sections.overview.push(line);
      continue;
    }

    if (/\bcovers the following (equipment|services)|qualify|qualifying services\b/.test(lower)) {
      currentSection = "coverage";
      sections.coverage.push(line);
      continue;
    }

    if (/\bkey terms and limitations\b/.test(lower)) {
      currentSection = "limits";
      sections.limits.push(line);
      continue;
    }

    if (/\bfor any questions|initiate a warranty claim|contact our customer service team\b/.test(lower)) {
      currentSection = "nextSteps";
      sections.nextSteps.push(line);
      continue;
    }

    if (/\bmaintain the validity|properly maintained|third-party insurer|transferability|parts availability|commercial availability|nominal fee\b/.test(lower)) {
      currentSection = "limits";
      sections.limits.push(line);
      continue;
    }

    if (currentSection === "coverage" && (line.split(/\s+/).length <= 10 || /\b(repipes|replacement|service)\b/.test(lower))) {
      sections.coverage.push(line);
      continue;
    }

    if (currentSection === "nextSteps") {
      sections.nextSteps.push(line);
      continue;
    }

    if (sections.overview.length < 3 || /\b(warranty|coverage|peace of mind|stand behind)\b/.test(lower)) {
      sections.overview.push(line);
      continue;
    }

    if (currentSection === "limits") {
      sections.limits.push(line);
    }
  }

  return {
    baseName,
    sections: {
      overview: uniqueValues(sections.overview).slice(0, 4),
      coverage: uniqueValues(sections.coverage).slice(0, 8),
      limits: uniqueValues(sections.limits).slice(0, 8),
      nextSteps: uniqueValues(sections.nextSteps).slice(0, 4)
    }
  };
}

function factRecordForSourceLine({
  buildId,
  tenantKey,
  domainId,
  subdomainId,
  sourceRefId,
  sourceItem,
  subject,
  line,
  section,
  predicate
}) {
  return {
    knowledge_fact_id: createId("kf"),
    tenant_key: tenantKey,
    build_id: buildId,
    domain_id: domainId,
    subdomain_id: subdomainId,
    fact_type: section ? `${sourceItem.sourceChannel}_${section}` : `${sourceItem.sourceChannel}_claim`,
    object_type: "policy",
    subject,
    predicate,
    object_text: line,
    normalized_value_json: section ? { policy_section: section } : null,
    confidence: factConfidenceForAuthority(sourceItem.sourceAuthority),
    source_ref_ids_json: [sourceRefId],
    scope_json: {
      source_authority: sourceItem.sourceAuthority,
      source_channel: sourceItem.sourceChannel,
      source_locator: sourceItem.sourceLocator,
      content_class: sourceItem.contentClass,
      source_priority: sourceItem.sourcePriority,
      content_priority: sourceItem.contentPriority,
      policy_section: section || null
    },
    content_class: sourceItem.contentClass,
    risk_level: sourceItem.contentClass === "policy_boundary" ? "high" : "normal",
    claim_text: line,
    evidence_text: line
  };
}

function factConfidenceForAuthority(sourceAuthority) {
  if (sourceAuthority === "owner_interview_confirmed") return 0.93;
  if (sourceAuthority === "uploaded_first_party_policy") return 0.89;
  if (sourceAuthority === "uploaded_first_party_operational") return 0.87;
  if (sourceAuthority === "website_public_downloadable") return 0.8;
  if (sourceAuthority === "website_public_page") return 0.72;
  if (sourceAuthority === "uploaded_first_party_reference") return 0.68;
  if (sourceAuthority === "owner_interview_unconfirmed") return 0.55;
  return 0.45;
}

export function buildFactsForSourceItem({ buildId, tenantKey, domainId, subdomainId, sourceRefId, sourceItem }) {
  if (isPolicyLikeSourceItem(sourceItem)) {
    const { baseName, sections } = buildPolicySections(sourceItem);
    const facts = [];
    for (const line of sections.overview) {
      facts.push(factRecordForSourceLine({
        buildId,
        tenantKey,
        domainId,
        subdomainId,
        sourceRefId,
        sourceItem,
        subject: baseName,
        line,
        section: "policy_overview",
        predicate: "explains_policy"
      }));
    }
    for (const line of sections.coverage) {
      facts.push(factRecordForSourceLine({
        buildId,
        tenantKey,
        domainId,
        subdomainId,
        sourceRefId,
        sourceItem,
        subject: baseName,
        line,
        section: "policy_coverage",
        predicate: "covers"
      }));
    }
    for (const line of sections.limits) {
      facts.push(factRecordForSourceLine({
        buildId,
        tenantKey,
        domainId,
        subdomainId,
        sourceRefId,
        sourceItem,
        subject: baseName,
        line,
        section: "policy_limits",
        predicate: "limits"
      }));
    }
    for (const line of sections.nextSteps) {
      facts.push(factRecordForSourceLine({
        buildId,
        tenantKey,
        domainId,
        subdomainId,
        sourceRefId,
        sourceItem,
        subject: baseName,
        line,
        section: "policy_next_step",
        predicate: "next_step"
      }));
    }
    return facts;
  }

  const facts = [];
  const objectType = inferObjectType(sourceItem.pageType);
  const subject = sourceItem.title || sourceItem.sourceLocator;
  for (const line of sourceItem.lines.slice(0, 4)) {
    facts.push({
      knowledge_fact_id: createId("kf"),
      tenant_key: tenantKey,
      build_id: buildId,
      domain_id: domainId,
      subdomain_id: subdomainId,
      fact_type: `${sourceItem.sourceChannel}_claim`,
      object_type: objectType,
      subject,
      predicate: "states",
      object_text: line,
      normalized_value_json: null,
      confidence: factConfidenceForAuthority(sourceItem.sourceAuthority),
      source_ref_ids_json: [sourceRefId],
      scope_json: {
        source_authority: sourceItem.sourceAuthority,
        source_channel: sourceItem.sourceChannel,
        source_locator: sourceItem.sourceLocator,
        content_class: sourceItem.contentClass,
        source_priority: sourceItem.sourcePriority,
        content_priority: sourceItem.contentPriority
      },
      content_class: sourceItem.contentClass,
      risk_level: sourceItem.contentClass === "policy_boundary" ? "high" : "normal",
      claim_text: line,
      evidence_text: line
    });
  }
  return facts;
}

function buildSectionCard({
  buildId,
  tenantKey,
  domainId,
  subdomainId,
  sourceRefId,
  sourceItem,
  canonicalName,
  topicPath,
  aliases,
  callerPhrases,
  facts,
  summary
}) {
  const scope = {
    source_authority: sourceItem.sourceAuthority,
    source_channel: sourceItem.sourceChannel,
    source_locator: sourceItem.sourceLocator,
    source_session_id: sourceItem.sourceSessionId,
    content_class: sourceItem.contentClass,
    source_priority: sourceItem.sourcePriority,
    content_priority: sourceItem.contentPriority
  };

  return {
    knowledge_card_id: createId("kc"),
    tenant_key: tenantKey,
    build_id: buildId,
    domain_id: domainId,
    subdomain_id: subdomainId,
    card_type: "policy",
    object_type: "policy",
    canonical_name: canonicalName,
    topic_path: topicPath,
    intent_tags_json: ["policy", topicPath],
    entity_tags_json: ["warranty", "policy"],
    aliases_json: uniqueValues(aliases),
    caller_phrases_json: uniqueValues(callerPhrases).slice(0, 8),
    scope_json: scope,
    speakable_summary: truncateText(summary, 260) || truncateText(sourceItem.text, 260),
    answer_facts_json: facts.map((fact) => ({
      fact_id: fact.knowledge_fact_id,
      claim: fact.claim_text,
      risk_level: fact.risk_level
    })),
    related_card_ids_json: [],
    source_ref_ids_json: [sourceRefId],
    content_class: sourceItem.contentClass,
    allowed_uses_json: ["answer", "clarify", "advance_next_step"],
    risk_level: sourceItem.contentClass === "policy_boundary" ? "high" : "normal",
    quality_score: Math.min(0.99, 0.38 + (facts.length * 0.09) + (sourceItem.sourcePriority / 220) + (sourceItem.contentPriority / 100)),
    search_text: uniqueValues([
      canonicalName,
      ...aliases,
      ...callerPhrases,
      summary,
      ...facts.map((fact) => fact.claim_text),
      sourceItem.contentClass,
      topicPath
    ]).join(" ")
  };
}

export function buildCardsForSourceItem({ buildId, tenantKey, domainId, subdomainId, sourceRefId, sourceItem, facts }) {
  if (isPolicyLikeSourceItem(sourceItem)) {
    const baseName = policyBaseName(sourceItem.title);
    const sectionFacts = {
      overview: facts.filter((fact) => fact.normalized_value_json?.policy_section === "policy_overview"),
      coverage: facts.filter((fact) => fact.normalized_value_json?.policy_section === "policy_coverage"),
      limits: facts.filter((fact) => fact.normalized_value_json?.policy_section === "policy_limits"),
      nextSteps: facts.filter((fact) => fact.normalized_value_json?.policy_section === "policy_next_step")
    };
    const cards = [];

    if (sectionFacts.overview.length) {
      cards.push(buildSectionCard({
        buildId,
        tenantKey,
        domainId,
        subdomainId,
        sourceRefId,
        sourceItem,
        canonicalName: `${baseName} Overview`,
        topicPath: "policy_overview",
        aliases: [baseName, sourceItem.title, `${baseName} warranty`, `${baseName} details`],
        callerPhrases: [
          ...buildDirectQuestionPhrases(baseName),
          ...buildCallerPhrases(baseName, sectionFacts.overview.map((fact) => fact.claim_text))
        ],
        facts: sectionFacts.overview,
        summary: sectionFacts.overview.map((fact) => fact.claim_text).slice(0, 2).join(" ")
      }));
    }

    if (sectionFacts.coverage.length) {
      cards.push(buildSectionCard({
        buildId,
        tenantKey,
        domainId,
        subdomainId,
        sourceRefId,
        sourceItem,
        canonicalName: `${baseName} Covered Services`,
        topicPath: "policy_coverage",
        aliases: [
          `${baseName} qualifying services`,
          `${baseName} covered services`,
          `${baseName} applies to`,
          `${baseName} all services`
        ],
        callerPhrases: buildDirectQuestionPhrases(baseName, [
          `Does ${baseName} apply to all services?`,
          `What services qualify for ${baseName}?`,
          `What does ${baseName} cover?`
        ]),
        facts: sectionFacts.coverage,
        summary: sectionFacts.coverage.map((fact) => fact.claim_text).slice(0, 4).join(" ")
      }));
    }

    if (sectionFacts.limits.length) {
      cards.push(buildSectionCard({
        buildId,
        tenantKey,
        domainId,
        subdomainId,
        sourceRefId,
        sourceItem,
        canonicalName: `${baseName} Terms And Limits`,
        topicPath: "policy_limits",
        aliases: [
          `${baseName} limitations`,
          `${baseName} exclusions`,
          `${baseName} transferability`,
          `${baseName} parts availability`
        ],
        callerPhrases: buildDirectQuestionPhrases(baseName, [
          `Does ${baseName} apply to all services?`,
          `What are the limits of ${baseName}?`,
          `Are there exclusions for ${baseName}?`
        ]),
        facts: sectionFacts.limits,
        summary: sectionFacts.limits.map((fact) => fact.claim_text).slice(0, 3).join(" ")
      }));
    }

    if (sectionFacts.nextSteps.length) {
      cards.push(buildSectionCard({
        buildId,
        tenantKey,
        domainId,
        subdomainId,
        sourceRefId,
        sourceItem,
        canonicalName: `${baseName} Claims And Questions`,
        topicPath: "policy_next_step",
        aliases: [`${baseName} claim`, `${baseName} contact`, `${baseName} questions`],
        callerPhrases: buildDirectQuestionPhrases(baseName, [
          `Who do I contact about ${baseName}?`,
          `How do I start a ${baseName} claim?`
        ]),
        facts: sectionFacts.nextSteps,
        summary: sectionFacts.nextSteps.map((fact) => fact.claim_text).slice(0, 2).join(" ")
      }));
    }

    if (cards.length) {
      return cards;
    }
  }

  const canonicalName = sourceItem.title || "Knowledge Source";
  const aliases = titleAliases(canonicalName, sourceItem.sourceLocator);
  const callerPhrases = buildCallerPhrases(canonicalName, sourceItem.lines);
  const speakableSummary = truncateText(sourceItem.lines.slice(0, 2).join(" "), 260) || truncateText(sourceItem.text, 260);
  const scope = {
    source_authority: sourceItem.sourceAuthority,
    source_channel: sourceItem.sourceChannel,
    source_locator: sourceItem.sourceLocator,
    source_session_id: sourceItem.sourceSessionId,
    content_class: sourceItem.contentClass,
    source_priority: sourceItem.sourcePriority,
    content_priority: sourceItem.contentPriority
  };

  return [{
    knowledge_card_id: createId("kc"),
    tenant_key: tenantKey,
    build_id: buildId,
    domain_id: domainId,
    subdomain_id: subdomainId,
    card_type: inferCardType(sourceItem.pageType),
    object_type: inferObjectType(sourceItem.pageType),
    canonical_name: canonicalName,
    topic_path: sourceItem.pageType,
    intent_tags_json: [sourceItem.pageType],
    entity_tags_json: [],
    aliases_json: aliases,
    caller_phrases_json: callerPhrases,
    scope_json: scope,
    speakable_summary: speakableSummary || truncateText(sourceItem.sourceLocator, 180),
    answer_facts_json: facts.map((fact) => ({
      fact_id: fact.knowledge_fact_id,
      claim: fact.claim_text,
      risk_level: fact.risk_level
    })),
    related_card_ids_json: [],
    source_ref_ids_json: [sourceRefId],
    content_class: sourceItem.contentClass,
    allowed_uses_json: ["answer", "clarify", "advance_next_step"],
    risk_level: sourceItem.contentClass === "policy_boundary" ? "high" : "normal",
    quality_score: Math.min(0.98, 0.25 + (facts.length * 0.08) + (sourceItem.sourcePriority / 200) + (sourceItem.contentPriority / 100)),
    search_text: uniqueValues([
      canonicalName,
      ...aliases,
      ...callerPhrases,
      speakableSummary,
      sourceItem.pageType,
      sourceItem.contentClass,
      ...facts.map((fact) => fact.claim_text)
    ]).join(" ")
  }];
}

async function assertSliceTablesReady(db) {
  const res = await db.query(`SELECT to_regclass('knowledge_builds') AS table_name`);
  if (!normalizeText(res.rows[0]?.table_name)) {
    throw new Error("knowledge_receptionist_migrations_not_applied");
  }
  await db.query(
    `ALTER TABLE knowledge_builds
       ADD COLUMN IF NOT EXISTS build_kind TEXT NOT NULL DEFAULT 'legacy_combined',
       ADD COLUMN IF NOT EXISTS base_build_id TEXT REFERENCES knowledge_builds(build_id) ON DELETE SET NULL,
       ADD COLUMN IF NOT EXISTS overlay_build_id TEXT REFERENCES knowledge_builds(build_id) ON DELETE SET NULL,
       ADD COLUMN IF NOT EXISTS composite_parent_build_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
       ADD COLUMN IF NOT EXISTS source_fingerprint_json JSONB NOT NULL DEFAULT '{}'::jsonb;`
  );
}

async function nextBuildVersion(db, tenantKey) {
  const res = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM knowledge_builds
     WHERE tenant_key = $1`,
    [tenantKey]
  );
  const count = Number(res.rows[0]?.count || 0) + 1;
  return `v${count}`;
}

async function assertBuildRateLimit(db, tenantKey) {
  void db;
  void tenantKey;
}

function sameNormalizedIdArray(left, right) {
  const leftValues = uniqueValues(left).sort();
  const rightValues = uniqueValues(right).sort();
  if (leftValues.length !== rightValues.length) return false;
  return leftValues.every((value, index) => value === rightValues[index]);
}

function normalizeBuildKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "website_base") return "website_base";
  if (normalized === "document_overlay") return "document_overlay";
  if (normalized === "composite") return "composite";
  return "legacy_combined";
}

function buildSourceInputFingerprint({ buildKind, websiteUrl, uploadedDocumentIds, setupInterviewSessionIds, baseBuildId }) {
  return {
    build_kind: normalizeBuildKind(buildKind),
    base_build_id: normalizeText(baseBuildId),
    website_root_url: normalizeWebsiteUrl(websiteUrl),
    uploaded_document_ids: uniqueValues(uploadedDocumentIds).sort(),
    setup_interview_session_ids: uniqueValues(setupInterviewSessionIds).sort()
  };
}

async function findResumableBuildState(db, tenantKey, inputFingerprint, preferredBuildId = "") {
  const preferred = normalizeText(preferredBuildId);
  const res = await db.query(
    `SELECT kb.build_id,
            kb.version,
            kb.status AS build_status,
            kb.build_kind,
            kb.base_build_id,
            kb.domain_assignments_json,
            sis.source_intake_session_id,
            sis.status AS intake_status,
            sis.website_root_url,
            sis.metadata_json,
            sis.crawl_summary_json,
            sis.persistence_checkpoint_json,
            COALESCE((
              SELECT COUNT(*)::int
              FROM source_intake_items sii
              WHERE sii.tenant_key = kb.tenant_key
                AND sii.build_id = kb.build_id
                AND sii.source_intake_session_id = sis.source_intake_session_id
            ), 0) AS intake_item_count
     FROM knowledge_builds kb
     INNER JOIN source_intake_sessions sis
       ON sis.build_id = kb.build_id
     WHERE kb.tenant_key = $1
       AND kb.status IN ('queued', 'running', 'failed')
     ORDER BY CASE WHEN kb.build_id = $2 THEN 0 ELSE 1 END,
              kb.created_at DESC
     LIMIT 20`,
    [tenantKey, preferred]
  );
  for (const row of res.rows || []) {
    const metadata = row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
      ? row.metadata_json
      : {};
    const rowFingerprint = buildSourceInputFingerprint({
      buildKind: row.build_kind,
      baseBuildId: row.base_build_id,
      websiteUrl: row.website_root_url,
      uploadedDocumentIds: metadata.uploaded_document_ids || [],
      setupInterviewSessionIds: metadata.setup_interview_session_ids || []
    });
    const hasPersistedState = Number(row.intake_item_count || 0) > 0
      || Number(row.persistence_checkpoint_json?.total_persisted_sources || 0) > 0;
    const buildStatus = normalizeText(row.build_status).toLowerCase();
    if (!hasPersistedState && !["queued", "running"].includes(buildStatus)) continue;
    if (rowFingerprint.build_kind !== inputFingerprint.build_kind) continue;
    if (rowFingerprint.base_build_id !== inputFingerprint.base_build_id) continue;
    if (rowFingerprint.website_root_url !== inputFingerprint.website_root_url) continue;
    if (!sameNormalizedIdArray(rowFingerprint.uploaded_document_ids, inputFingerprint.uploaded_document_ids)) continue;
    if (!sameNormalizedIdArray(rowFingerprint.setup_interview_session_ids, inputFingerprint.setup_interview_session_ids)) continue;
    return row;
  }
  return null;
}

async function loadUploadedDocumentSourceItems(db, tenantKey, uploadedDocumentIds = []) {
  const ids = uniqueValues(uploadedDocumentIds);
  if (!ids.length) return [];
  const res = await db.query(
    `SELECT *
     FROM uploaded_documents
     WHERE tenant_key = $1
       AND status = 'approved'
       AND uploaded_document_id = ANY($2::text[])`,
    [tenantKey, ids]
  );
  if (res.rows.length !== ids.length) {
    throw new Error("uploaded_document_not_found");
  }
  const byId = new Map((res.rows || []).map((row) => [normalizeText(row.uploaded_document_id), row]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((row) => normalizeSourceItem({
    sourceChannel: "uploaded_document",
    sourceKind: normalizeText(row.source_kind) === "single_page_url"
      ? "html"
      : (/\.pdf$/i.test(normalizeText(row.filename || row.mime_type)) ? "pdf" : "text"),
    sourceAuthority: row.source_authority,
    sourceLocator: normalizeText(row.source_locator) || `uploaded-document:${row.uploaded_document_id}`,
    title: row.title,
    text: row.body_text,
    pageType: classifyTextPageType(row.title, row.body_text, row.document_class === "policy" ? "policy" : "unknown_mixed"),
    documentClass: row.document_class,
    metadata: {
      uploaded_document_id: row.uploaded_document_id,
      filename: row.filename,
      mime_type: row.mime_type,
      status: row.status,
      source_kind: row.source_kind,
      source_locator: row.source_locator,
      fetch_status: row.fetch_status
    }
  }));
}

async function loadApprovedUploadedDocumentIds(db, tenantKey) {
  const res = await db.query(
    `SELECT uploaded_document_id
     FROM uploaded_documents
     WHERE tenant_key = $1
       AND status = 'approved'
     ORDER BY updated_at DESC, uploaded_document_id DESC`,
    [tenantKey]
  );
  return uniqueValues((res.rows || []).map((row) => row.uploaded_document_id));
}

function isReusableBaseSourceChannel(value) {
  const normalized = normalizeText(value);
  return normalized === "website_page" || normalized === "website_file" || normalized === "owner_interview";
}

async function loadDocumentOverlayBaseBuild(db, tenantKey, preferredBaseBuildId = "") {
  const preferred = normalizeText(preferredBaseBuildId);
  const params = [tenantKey];
  let filterSql = "";
  if (preferred) {
    params.push(preferred);
    filterSql = `AND kb.build_id = $2`;
  } else {
    filterSql = `AND (kb.build_id = pointer.active_build_id OR kb.status IN ('published', 'superseded', 'ready_to_publish'))`;
  }
  const res = await db.query(
    `SELECT kb.build_id,
            kb.status,
            kb.build_kind,
            sis.source_intake_session_id,
            sis.website_root_url
     FROM knowledge_builds kb
     LEFT JOIN tenant_active_knowledge_builds pointer
       ON pointer.tenant_key = kb.tenant_key
     LEFT JOIN source_intake_sessions sis
       ON sis.build_id = kb.build_id
     WHERE kb.tenant_key = $1
       ${filterSql}
     ORDER BY CASE WHEN kb.build_id = pointer.active_build_id THEN 0 ELSE 1 END,
              kb.created_at DESC
     LIMIT 1`,
    params
  );
  return res.rows[0] || null;
}

async function loadReusableBaseSourceItems(db, tenantKey, baseBuildId, sourceIntakeSessionId) {
  const rows = await loadPersistedSourceIntakeItems(
    db,
    { tenant_key: tenantKey, build_id: baseBuildId },
    sourceIntakeSessionId,
    "included"
  );
  return (rows || [])
    .filter((row) => isReusableBaseSourceChannel(row.source_channel))
    .map((row) => buildSourceItemFromIntakeRow(row));
}

async function collectDocumentOverlaySourcePayload(db, tenantKey, input = {}, buildInfo, sourceIntakeSessionId, preferredBaseBuildId = "") {
  const baseBuild = await loadDocumentOverlayBaseBuild(db, tenantKey, preferredBaseBuildId);
  if (!baseBuild?.build_id || !baseBuild?.source_intake_session_id) {
    throw new Error("overlay_base_build_required");
  }

  const baseSourceItems = await loadReusableBaseSourceItems(
    db,
    tenantKey,
    baseBuild.build_id,
    baseBuild.source_intake_session_id
  );
  if (!baseSourceItems.length) {
    throw new Error("overlay_base_sources_missing");
  }

  const requestedUploadedDocumentIds = normalizeIdArray(input.uploadedDocumentIds || input.uploaded_document_ids);
  const effectiveUploadedDocumentIds = requestedUploadedDocumentIds.length
    ? requestedUploadedDocumentIds
    : await loadApprovedUploadedDocumentIds(db, tenantKey);

  const [uploadedDocumentSources, setupInterviewSources] = await Promise.all([
    loadUploadedDocumentSourceItems(db, tenantKey, effectiveUploadedDocumentIds),
    loadSetupInterviewSourceItems(db, tenantKey, input.setupInterviewSessionIds || input.setup_interview_session_ids || [])
  ]);

  const includedSourceItems = [...baseSourceItems, ...uploadedDocumentSources, ...setupInterviewSources];
  const discoveryEntries = includedSourceItems.map((item) => buildDiscoveryEntryFromSourceItem(buildInfo, sourceIntakeSessionId, item));
  const reusedWebsitePages = baseSourceItems.filter((item) => item.sourceChannel === "website_page").length;
  const reusedWebsiteFiles = baseSourceItems.filter((item) => item.sourceChannel === "website_file").length;

  return {
    baseBuildId: normalizeText(baseBuild.build_id),
    websiteUrl: normalizeWebsiteUrl(baseBuild.website_root_url),
    sourceItems: includedSourceItems,
    discoveryEntries,
    crawlSummary: buildSourceCollectionSummary(discoveryEntries, {
      rootUrl: normalizeWebsiteUrl(baseBuild.website_root_url),
      crawlDeadlineMs: 0,
      crawlElapsedMs: 0,
      truncated: false,
      truncationReasons: [],
      discoveredWebsitePages: reusedWebsitePages,
      discoveredWebsiteFiles: reusedWebsiteFiles,
      includedWebsitePages: reusedWebsitePages,
      includedWebsiteFiles: reusedWebsiteFiles,
      skippedCount: 0,
      failedCount: 0,
      trueFailedPageCount: 0,
      trueFailedFileCount: 0,
      retryArtifactCount: 0,
      duplicateDiscoveryCount: 0,
      canonicalizedDiscoveryCount: 0,
      skippedReasonCounts: {},
      failedReasonCounts: {}
    }),
    warnings: ["website_sources_reused_for_document_overlay"]
  };
}

async function loadSetupInterviewSourceItems(db, tenantKey, setupInterviewSessionIds = []) {
  const sessionIds = uniqueValues(setupInterviewSessionIds);
  if (!sessionIds.length) return [];
  const [sessionRes, blockRes] = await Promise.all([
    db.query(
      `SELECT *
       FROM setup_interview_sessions
       WHERE tenant_key = $1
         AND setup_interview_session_id = ANY($2::text[])`,
      [tenantKey, sessionIds]
    ),
    db.query(
      `SELECT b.*, s.completion_status, s.raw_transcript_text
       FROM setup_interview_summary_blocks b
       INNER JOIN setup_interview_sessions s
         ON s.setup_interview_session_id = b.setup_interview_session_id
       WHERE s.tenant_key = $1
         AND b.confirmation_status = 'confirmed'
         AND s.setup_interview_session_id = ANY($2::text[])
       ORDER BY b.updated_at DESC`,
      [tenantKey, sessionIds]
    )
  ]);
  if (sessionRes.rows.length !== sessionIds.length) {
    throw new Error("setup_interview_session_not_found");
  }

  const output = [];
  for (const session of sessionRes.rows) {
    const rawTranscriptText = normalizeText(session.raw_transcript_text);
    if (rawTranscriptText) {
      output.push(normalizeSourceItem({
        sourceChannel: "owner_interview",
        sourceKind: "transcript",
        sourceAuthority: "owner_interview_unconfirmed",
        sourceLocator: `setup-interview:${session.setup_interview_session_id}:transcript`,
        sourceSessionId: session.setup_interview_session_id,
        title: "Setup interview transcript evidence",
        text: rawTranscriptText,
        pageType: "process",
        contentClass: "descriptive",
        compileEnabled: false,
        metadata: {
          setup_interview_session_id: session.setup_interview_session_id,
          completion_status: session.completion_status,
          evidence_only: true
        }
      }));
    }
  }

  for (const block of blockRes.rows) {
    output.push(normalizeSourceItem({
      sourceChannel: "owner_interview",
      sourceKind: "note",
      sourceAuthority: "owner_interview_confirmed",
      sourceLocator: `setup-interview:${block.setup_interview_session_id}:block:${block.block_key}`,
      sourceSessionId: block.setup_interview_session_id,
      title: block.title,
      headings: [block.title],
      text: block.summary_text,
      pageType: classifyTextPageType(block.title, block.summary_text, "process"),
      contentClass: "operational_core",
      metadata: {
        setup_interview_session_id: block.setup_interview_session_id,
        block_key: block.block_key,
        confirmation_status: block.confirmation_status,
        authority_level: block.authority_level
      }
    }));
  }

  return output;
}

export function buildWebsiteSourceItems(websiteSources) {
  const pages = Array.isArray(websiteSources?.pages) ? websiteSources.pages : [];
  const files = Array.isArray(websiteSources?.files) ? websiteSources.files : [];
  const pageItems = pages.map((page) => {
    const pageType = normalizeText(page.pageType) === "unknown_mixed"
      ? classifyTextPageType(page.title, page.text, page.pageType)
      : page.pageType;
    return normalizeSourceItem({
      sourceChannel: "website_page",
      sourceKind: "html",
      sourceAuthority: "website_public_page",
      sourceLocator: page.sourceUrl,
      title: page.title || page.sourceUrl,
      headings: page.headings,
      lines: page.lines,
      text: page.text,
      pageType,
      metadata: { headings: page.headings || [] }
    });
  });
  const fileItems = files.map((file) => {
    const pageType = normalizeText(file.pageType) === "unknown_mixed"
      ? classifyTextPageType(file.title, file.text, file.pageType)
      : file.pageType;
    return normalizeSourceItem({
      sourceChannel: "website_file",
      sourceKind: normalizeText(file.sourceKind) || "text",
      sourceAuthority: "website_public_downloadable",
      sourceLocator: file.sourceUrl,
      title: file.title || file.sourceUrl,
      lines: file.lines,
      text: file.text,
      pageType,
      metadata: {
        mime_type: file.mimeType || null,
        parse_method: file.parseMethod || null
      }
    });
  });
  return [...pageItems, ...fileItems];
}

function buildDiscoveryEntryFromSourceItem(buildInfo, sourceIntakeSessionId, rawItem, overrides = {}) {
  const sourceItem = normalizeSourceItem(rawItem);
  const sourceKey = createStableSourceKey(sourceItem);
  return {
    source_intake_item_id: createStableSourceIntakeItemId(sourceIntakeSessionId, sourceKey),
    tenant_key: buildInfo.tenant_key,
    build_id: buildInfo.build_id,
    source_intake_session_id: sourceIntakeSessionId,
    source_key: sourceKey,
    source_channel: sourceItem.sourceChannel,
    source_kind: sourceItem.sourceKind,
    source_authority: sourceItem.sourceAuthority,
    source_locator: sourceItem.sourceLocator,
    title: sourceItem.title || null,
    page_type: sourceItem.pageType || null,
    content_hash: normalizeText(overrides.contentHash || stableHash(sourceItem.text || "")) || null,
    discovery_status: overrides.discoveryStatus || "included",
    persistence_status: overrides.persistenceStatus || (overrides.discoveryStatus === "included" || !overrides.discoveryStatus ? "pending" : "not_applicable"),
    failure_reason: normalizeText(overrides.failureReason) || null,
    source_ref_id: normalizeText(overrides.sourceRefId) || null,
    headings_json: sourceItem.headings || [],
    lines_json: sourceItem.lines || [],
    text_content: sourceItem.text || null,
    metadata_json: {
      headings: sourceItem.headings || [],
      content_class: sourceItem.contentClass,
      document_class: sourceItem.documentClass,
      compile_enabled: sourceItem.compileEnabled,
      source_session_id: sourceItem.sourceSessionId,
      ...sourceItem.metadata
    }
  };
}

function buildWebsiteAuditEntry(buildInfo, sourceIntakeSessionId, locator, status, reason, sourceChannel = "website_page") {
  const normalizedLocator = normalizeText(locator);
  const sourceKind = sourceChannel === "website_file" ? "text" : "html";
  const authority = sourceChannel === "website_file" ? "website_public_downloadable" : "website_public_page";
  const pageType = sourceChannel === "website_page" && normalizedLocator && /^https?:\/\//i.test(normalizedLocator)
    ? classifyPageType(new URL(normalizedLocator))
    : null;
  return buildDiscoveryEntryFromSourceItem(
    buildInfo,
    sourceIntakeSessionId,
    {
      sourceChannel,
      sourceKind,
      sourceAuthority: authority,
      sourceLocator: normalizedLocator,
      title: normalizedLocator,
      lines: [],
      text: "",
      pageType,
      contentClass: sourceChannel === "website_file" ? "policy_boundary" : "descriptive",
      compileEnabled: false,
      metadata: {
        audit_category: status === "failed" ? "true_failure" : "skipped_by_policy",
        audit_reason: normalizeText(reason) || status
      }
    },
    {
      discoveryStatus: status,
      persistenceStatus: "not_applicable",
      failureReason: reason || status,
      contentHash: ""
    }
  );
}

function buildSourceCollectionSummary(discoveryEntries, websiteSummary = null) {
  const totals = {
    total_discovered_sources: discoveryEntries.length,
    total_included_sources: discoveryEntries.filter((item) => item.discovery_status === "included").length,
    total_skipped_sources: discoveryEntries.filter((item) => item.discovery_status === "skipped").length,
    total_failed_sources: discoveryEntries.filter((item) => item.discovery_status === "failed").length
  };
  const trueFailedSources = Number(websiteSummary?.trueFailedPageCount || 0) + Number(websiteSummary?.trueFailedFileCount || 0);
  const skippedReasonCounts = websiteSummary?.skippedReasonCounts && typeof websiteSummary.skippedReasonCounts === "object" && !Array.isArray(websiteSummary.skippedReasonCounts)
    ? websiteSummary.skippedReasonCounts
    : {};
  const failedReasonCounts = websiteSummary?.failedReasonCounts && typeof websiteSummary.failedReasonCounts === "object" && !Array.isArray(websiteSummary.failedReasonCounts)
    ? websiteSummary.failedReasonCounts
    : {};
  return {
    root_url: normalizeText(websiteSummary?.rootUrl) || null,
    ...totals,
    crawl_deadline_ms: Number(websiteSummary?.crawlDeadlineMs || 0),
    crawl_elapsed_ms: Number(websiteSummary?.crawlElapsedMs || 0),
    crawl_truncated: Boolean(websiteSummary?.truncated),
    crawl_truncation_reasons: Array.isArray(websiteSummary?.truncationReasons) ? websiteSummary.truncationReasons.filter(Boolean) : [],
    discovered_website_pages: Number(websiteSummary?.discoveredWebsitePages || 0),
    discovered_website_files: Number(websiteSummary?.discoveredWebsiteFiles || 0),
    included_website_pages: Number(websiteSummary?.includedWebsitePages || 0),
    included_website_files: Number(websiteSummary?.includedWebsiteFiles || 0),
    skipped_website_sources: Number(websiteSummary?.skippedCount || 0),
    failed_website_sources: Number(websiteSummary?.failedCount || 0),
    failure_accounting: {
      tracking_version: "v2",
      true_failed_sources: trueFailedSources,
      true_failed_website_pages: Number(websiteSummary?.trueFailedPageCount || 0),
      true_failed_website_files: Number(websiteSummary?.trueFailedFileCount || 0),
      skipped_by_policy_sources: Number(websiteSummary?.skippedCount || 0),
      retry_artifact_count: Number(websiteSummary?.retryArtifactCount || 0),
      duplicate_discovery_events: Number(websiteSummary?.duplicateDiscoveryCount || 0),
      canonicalized_discovery_events: Number(websiteSummary?.canonicalizedDiscoveryCount || 0),
      final_failed_reason_counts: failedReasonCounts,
      skipped_reason_counts: skippedReasonCounts
    },
    included_source_item_ids: discoveryEntries.filter((item) => item.discovery_status === "included").map((item) => item.source_intake_item_id),
    remaining_source_item_ids: discoveryEntries.filter((item) => item.discovery_status === "included").map((item) => item.source_intake_item_id),
    stage_status: "discovery_completed"
  };
}

function buildFailureAccountingSummary(discoveryRows, priorSummary = {}) {
  const rows = Array.isArray(discoveryRows) ? discoveryRows : [];
  const failedReasonCounts = {};
  const skippedReasonCounts = {};
  const trueFailedWebsitePages = rows.filter((row) => normalizeText(row.discovery_status) === "failed" && normalizeText(row.source_channel) === "website_page").length;
  const trueFailedWebsiteFiles = rows.filter((row) => normalizeText(row.discovery_status) === "failed" && normalizeText(row.source_channel) === "website_file").length;
  for (const row of rows) {
    const status = normalizeText(row.discovery_status);
    const reason = normalizeText(row.failure_reason) || status;
    if (status === "failed") {
      failedReasonCounts[reason] = Number(failedReasonCounts[reason] || 0) + 1;
    } else if (status === "skipped") {
      skippedReasonCounts[reason] = Number(skippedReasonCounts[reason] || 0) + 1;
    }
  }
  const priorFailureAccounting = asObject(priorSummary.failure_accounting);
  return {
    tracking_version: priorFailureAccounting.tracking_version || "v2",
    true_failed_sources: rows.filter((row) => normalizeText(row.discovery_status) === "failed").length,
    true_failed_website_pages: Number(priorFailureAccounting.true_failed_website_pages ?? trueFailedWebsitePages),
    true_failed_website_files: Number(priorFailureAccounting.true_failed_website_files ?? trueFailedWebsiteFiles),
    skipped_by_policy_sources: rows.filter((row) => normalizeText(row.discovery_status) === "skipped").length,
    retry_artifact_count: priorFailureAccounting.retry_artifact_count ?? null,
    duplicate_discovery_events: priorFailureAccounting.duplicate_discovery_events ?? null,
    canonicalized_discovery_events: priorFailureAccounting.canonicalized_discovery_events ?? null,
    final_failed_reason_counts: failedReasonCounts,
    skipped_reason_counts: skippedReasonCounts,
    retry_tracking_available: priorFailureAccounting.retry_artifact_count !== undefined && priorFailureAccounting.retry_artifact_count !== null,
    duplicate_tracking_available: (priorFailureAccounting.duplicate_discovery_events !== undefined && priorFailureAccounting.duplicate_discovery_events !== null)
      || (priorFailureAccounting.canonicalized_discovery_events !== undefined && priorFailureAccounting.canonicalized_discovery_events !== null)
  };
}

function buildClassificationSummary(rows, changes = []) {
  const pageTypeCounts = {};
  const contentClassCounts = {};
  const confidenceCounts = {};
  for (const row of rows || []) {
    const metadata = asObject(row.metadata_json);
    const pageType = normalizeText(row.page_type) || "unknown_mixed";
    const contentClass = normalizeText(metadata.content_class) || "operational_core";
    const confidence = normalizeText(metadata.classification_confidence) || "unknown";
    pageTypeCounts[pageType] = Number(pageTypeCounts[pageType] || 0) + 1;
    contentClassCounts[contentClass] = Number(contentClassCounts[contentClass] || 0) + 1;
    confidenceCounts[confidence] = Number(confidenceCounts[confidence] || 0) + 1;
  }
  return {
    version: SOURCE_CLASSIFICATION_VERSION,
    included_source_count: rows.length,
    materially_reclassified_count: changes.length,
    page_type_counts: pageTypeCounts,
    content_class_counts: contentClassCounts,
    confidence_counts: confidenceCounts,
    materially_reclassified_examples: changes.slice(0, 25)
  };
}

async function loadSourceIntakeSessionSummaryJson(db, sourceIntakeSessionId) {
  const result = await db.query(
    `SELECT crawl_summary_json
     FROM source_intake_sessions
     WHERE source_intake_session_id = $1
     LIMIT 1`,
    [sourceIntakeSessionId]
  );
  return asObject(result.rows[0]?.crawl_summary_json);
}

async function collectBuildSourcePayload(db, tenantKey, input = {}, websiteUrl = "", buildInfo, sourceIntakeSessionId) {
  const websiteResult = websiteUrl ? await crawlWebsiteSources(websiteUrl) : { pages: [], files: [], crawlSummary: null };
  const websiteSources = buildWebsiteSourceItems(websiteResult);
  const [uploadedDocumentSources, setupInterviewSources] = await Promise.all([
    loadUploadedDocumentSourceItems(db, tenantKey, input.uploadedDocumentIds || input.uploaded_document_ids || []),
    loadSetupInterviewSourceItems(db, tenantKey, input.setupInterviewSessionIds || input.setup_interview_session_ids || [])
  ]);

  const includedSourceItems = [...websiteSources, ...uploadedDocumentSources, ...setupInterviewSources];
  const discoveryEntries = includedSourceItems.map((item) => buildDiscoveryEntryFromSourceItem(buildInfo, sourceIntakeSessionId, item));

  for (const entry of websiteResult?.crawlSummary?.skippedEntries || []) {
    discoveryEntries.push(buildWebsiteAuditEntry(buildInfo, sourceIntakeSessionId, entry.sourceLocator, "skipped", entry.reason, "website_page"));
  }
  for (const entry of websiteResult?.crawlSummary?.failedEntries || []) {
    const sourceChannel = isDownloadableUrl(new URL(entry.sourceLocator)) ? "website_file" : "website_page";
    discoveryEntries.push(buildWebsiteAuditEntry(buildInfo, sourceIntakeSessionId, entry.sourceLocator, "failed", entry.reason, sourceChannel));
  }

  return {
    sourceItems: includedSourceItems,
    discoveryEntries,
    crawlSummary: buildSourceCollectionSummary(discoveryEntries, websiteResult?.crawlSummary || null),
    warnings: Array.isArray(websiteResult?.crawlSummary?.truncationReasons) && websiteResult.crawlSummary.truncationReasons.length
      ? uniqueValues([
          "website_crawl_truncated",
          ...websiteResult.crawlSummary.truncationReasons.map((reason) => `website_crawl_${normalizeText(reason)}`)
        ])
      : []
  };
}

async function loadPersistedSourceIntakeItems(db, buildInfo, sourceIntakeSessionId, discoveryStatus = "included") {
  const hasDiscoveryFilter = normalizeText(discoveryStatus);
  const result = await db.query(
    `SELECT *
     FROM source_intake_items
     WHERE tenant_key = $1
       AND build_id = $2
       AND source_intake_session_id = $3
       ${hasDiscoveryFilter ? "AND discovery_status = $4" : ""}
     ORDER BY source_locator ASC, source_intake_item_id ASC`,
    hasDiscoveryFilter
      ? [buildInfo.tenant_key, buildInfo.build_id, sourceIntakeSessionId, discoveryStatus]
      : [buildInfo.tenant_key, buildInfo.build_id, sourceIntakeSessionId]
  );
  return result.rows || [];
}

async function loadExistingSourceIntakeSummary(db, buildInfo, sourceIntakeSessionId) {
  const result = await db.query(
    `SELECT
        COUNT(*)::int AS total_discovered_sources,
        COUNT(*) FILTER (WHERE discovery_status = 'included')::int AS total_included_sources,
        COUNT(*) FILTER (WHERE discovery_status = 'skipped')::int AS total_skipped_sources,
        COUNT(*) FILTER (WHERE discovery_status = 'failed')::int AS total_failed_sources,
        COUNT(*) FILTER (WHERE discovery_status = 'included' AND persistence_status = 'completed')::int AS total_persisted_sources,
        COALESCE(jsonb_agg(source_intake_item_id) FILTER (WHERE discovery_status = 'included' AND persistence_status = 'completed'), '[]'::jsonb) AS completed_ids_json,
        COALESCE(jsonb_agg(source_intake_item_id) FILTER (WHERE discovery_status = 'included' AND persistence_status <> 'completed'), '[]'::jsonb) AS remaining_ids_json
     FROM source_intake_items
     WHERE tenant_key = $1
       AND build_id = $2
       AND source_intake_session_id = $3`,
    [buildInfo.tenant_key, buildInfo.build_id, sourceIntakeSessionId]
  );
  return result.rows[0] || {
    total_discovered_sources: 0,
    total_included_sources: 0,
    total_skipped_sources: 0,
    total_failed_sources: 0,
    total_persisted_sources: 0,
    completed_ids_json: [],
    remaining_ids_json: []
  };
}

async function updateSourceIntakeSessionCrawlSummary(db, sourceIntakeSessionId, crawlSummary, status) {
  await db.query(
    `UPDATE source_intake_sessions
     SET status = COALESCE($2, status),
         crawl_summary_json = $3::jsonb,
         updated_at = NOW()
     WHERE source_intake_session_id = $1`,
    [sourceIntakeSessionId, status || null, toJson(crawlSummary || {}, {})]
  );
}

async function updateSourceIntakeSessionPersistenceCheckpoint(db, sourceIntakeSessionId, checkpoint, status) {
  await db.query(
    `UPDATE source_intake_sessions
     SET status = COALESCE($2, status),
         persistence_checkpoint_json = $3::jsonb,
         updated_at = NOW()
     WHERE source_intake_session_id = $1`,
    [sourceIntakeSessionId, status || null, toJson(checkpoint || {}, {})]
  );
}

async function upsertSourceIntakeItemBatch(db, rows) {
  if (!rows.length) return;
  const { placeholders, values } = buildValuesClause(rows, 22, (row) => [
    row.source_intake_item_id,
    row.tenant_key,
    row.build_id,
    row.source_intake_session_id,
    row.source_key,
    row.source_channel,
    row.source_kind,
    row.source_authority,
    row.source_locator,
    row.title || null,
    row.page_type || null,
    row.content_hash || null,
    row.discovery_status,
    row.persistence_status,
    row.failure_reason || null,
    row.source_ref_id || null,
    toJson(row.headings_json || [], []),
    toJson(row.lines_json || [], []),
    row.text_content || null,
    toJson(row.metadata_json || {}, {}),
    row.discovered_at || new Date().toISOString(),
    row.updated_at || new Date().toISOString()
  ]);
  await db.query(
    `INSERT INTO source_intake_items (
       source_intake_item_id, tenant_key, build_id, source_intake_session_id, source_key,
       source_channel, source_kind, source_authority, source_locator, title, page_type, content_hash,
       discovery_status, persistence_status, failure_reason, source_ref_id, headings_json, lines_json,
       text_content, metadata_json, discovered_at, updated_at
     )
     VALUES ${placeholders}
     ON CONFLICT (build_id, source_key)
     DO UPDATE SET
       source_channel = EXCLUDED.source_channel,
       source_kind = EXCLUDED.source_kind,
       source_authority = EXCLUDED.source_authority,
       source_locator = EXCLUDED.source_locator,
       title = EXCLUDED.title,
       page_type = EXCLUDED.page_type,
       content_hash = EXCLUDED.content_hash,
       discovery_status = EXCLUDED.discovery_status,
       persistence_status = CASE
         WHEN source_intake_items.persistence_status = 'completed' THEN source_intake_items.persistence_status
         ELSE EXCLUDED.persistence_status
       END,
       failure_reason = EXCLUDED.failure_reason,
       source_ref_id = COALESCE(source_intake_items.source_ref_id, EXCLUDED.source_ref_id),
       headings_json = EXCLUDED.headings_json,
       lines_json = EXCLUDED.lines_json,
       text_content = EXCLUDED.text_content,
       metadata_json = EXCLUDED.metadata_json,
       updated_at = NOW()`,
    values
  );
}

async function persistDiscoveredSourceItems(db, buildInfo, sourceIntakeSessionId, discoveryEntries, crawlSummary) {
  const batches = chunkArray(discoveryEntries, SOURCE_DISCOVERY_BATCH_SIZE);
  let persistedRows = 0;
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    await withTransaction(db, async (client) => {
      await upsertSourceIntakeItemBatch(client, batch);
      persistedRows += batch.length;
      await updateSourceIntakeSessionCrawlSummary(client, sourceIntakeSessionId, {
        ...crawlSummary,
        persisted_discovery_rows: persistedRows,
        remaining_discovery_rows: Math.max(0, discoveryEntries.length - persistedRows),
        discovery_batches_total: batches.length,
        discovery_batches_committed: index + 1,
        stage_status: index + 1 >= batches.length ? "discovery_completed" : "persisting_discovery"
      }, index + 1 >= batches.length ? "raw_source_persisting" : "discovering");
    });
  }
  const includedIds = discoveryEntries
    .filter((entry) => entry.discovery_status === "included")
    .map((entry) => entry.source_intake_item_id);
  await updateSourceIntakeSessionPersistenceCheckpoint(db, sourceIntakeSessionId, {
    total_discovered_sources: discoveryEntries.length,
    total_persisted_sources: 0,
    completed_source_item_ids: [],
    remaining_source_item_ids: includedIds,
    last_committed_batch: null,
    last_committed_batch_index: 0,
    total_batches: 0,
    stage_status: includedIds.length ? "raw_source_pending" : "raw_source_persisted"
  }, includedIds.length ? "raw_source_persisting" : "compiling");
}

function buildSourceItemFromIntakeRow(row) {
  const metadata = row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
    ? row.metadata_json
    : {};
  const sourceItem = normalizeSourceItem({
    sourceChannel: row.source_channel,
    sourceKind: row.source_kind,
    sourceAuthority: row.source_authority,
    sourceLocator: row.source_locator,
    sourceSessionId: metadata.source_session_id || null,
    title: row.title,
    headings: Array.isArray(row.headings_json) ? row.headings_json : [],
    lines: Array.isArray(row.lines_json) ? row.lines_json : [],
    text: row.text_content,
    pageType: row.page_type,
    compileEnabled: metadata.compile_enabled !== false,
    metadata
  });
  return sourceItem;
}

function buildSourceRecordFromIntakeRow(buildInfo, row) {
  const sourceItem = buildSourceItemFromIntakeRow(row);
  const sourceRefId = normalizeText(row.source_ref_id) || createStableSourceRefId(buildInfo.build_id, sourceItem);
  const sourceChunks = buildSourceChunksForSourceItem(sourceItem, sourceRefId, buildInfo);
  return {
    sourceIntakeItemId: row.source_intake_item_id,
    sourceItem,
    sourceRefId,
    sourceChunks
  };
}

async function refreshPersistedSourceClassification(db, buildInfo, sourceIntakeSessionId) {
  const includedRows = await loadPersistedSourceIntakeItems(db, buildInfo, sourceIntakeSessionId, "included");
  if (!includedRows.length) {
    return {
      changedRows: [],
      pageTypeCounts: {},
      contentClassCounts: {},
      confidenceCounts: {}
    };
  }

  const changedRows = [];
  const intakeUpdates = [];
  const sourceRefUpdates = [];

  for (const row of includedRows) {
    const priorMetadata = asObject(row.metadata_json);
    const priorPageType = normalizeText(row.page_type) || "unknown_mixed";
    const priorContentClass = normalizeText(priorMetadata.content_class) || "operational_core";
    const priorDocumentClass = normalizeText(priorMetadata.document_class) || "operational";
    const sourceItem = buildSourceItemFromIntakeRow(row);
    const nextMetadata = sourceItem.metadata || {};
    const materiallyChanged = priorPageType !== sourceItem.pageType
      || priorContentClass !== sourceItem.contentClass
      || priorDocumentClass !== sourceItem.documentClass;
    if (!materiallyChanged && normalizeText(priorMetadata.classification_version) === SOURCE_CLASSIFICATION_VERSION) {
      continue;
    }
    intakeUpdates.push({
      source_intake_item_id: row.source_intake_item_id,
      page_type: sourceItem.pageType,
      metadata_json: nextMetadata
    });
    if (normalizeText(row.source_ref_id)) {
      sourceRefUpdates.push({
        source_ref_id: row.source_ref_id,
        page_type: sourceItem.pageType,
        metadata_json: nextMetadata
      });
    }
    if (materiallyChanged) {
      changedRows.push({
        source_locator: row.source_locator,
        previous_page_type: priorPageType,
        next_page_type: sourceItem.pageType,
        previous_content_class: priorContentClass,
        next_content_class: sourceItem.contentClass,
        confidence: normalizeText(nextMetadata.classification_confidence) || "unknown",
        reasons: Array.isArray(nextMetadata.classification_reasons) ? nextMetadata.classification_reasons : []
      });
    }
  }

  for (const batch of chunkArray(intakeUpdates, 100)) {
    if (!batch.length) continue;
    const { placeholders, values } = buildValuesClause(batch, 3, (row) => [
      row.source_intake_item_id,
      row.page_type,
      toJson(row.metadata_json || {}, {})
    ]);
    await db.query(
      `UPDATE source_intake_items AS sii
       SET page_type = mapped.page_type,
           metadata_json = mapped.metadata_json::jsonb,
           updated_at = NOW()
       FROM (VALUES ${placeholders}) AS mapped(source_intake_item_id, page_type, metadata_json)
       WHERE sii.source_intake_item_id = mapped.source_intake_item_id`,
      values
    );
  }

  for (const batch of chunkArray(sourceRefUpdates, 100)) {
    if (!batch.length) continue;
    const { placeholders, values } = buildValuesClause(batch, 3, (row) => [
      row.source_ref_id,
      row.page_type,
      toJson(row.metadata_json || {}, {})
    ]);
    await db.query(
      `UPDATE source_refs AS sr
       SET page_type = mapped.page_type,
           metadata_json = mapped.metadata_json::jsonb
       FROM (VALUES ${placeholders}) AS mapped(source_ref_id, page_type, metadata_json)
       WHERE sr.source_ref_id = mapped.source_ref_id`,
      values
    );
  }

  const refreshedRows = await loadPersistedSourceIntakeItems(db, buildInfo, sourceIntakeSessionId, "included");
  const classificationSummary = buildClassificationSummary(refreshedRows, changedRows);
  const priorSummary = await loadSourceIntakeSessionSummaryJson(db, sourceIntakeSessionId);
  const allRows = await loadPersistedSourceIntakeItems(db, buildInfo, sourceIntakeSessionId, null);
  const auditUpdates = allRows
    .filter((row) => normalizeText(row.discovery_status) !== "included")
    .map((row) => {
      const metadata = asObject(row.metadata_json);
      const discoveryStatus = normalizeText(row.discovery_status);
      const failureReason = normalizeText(row.failure_reason);
      return {
        source_intake_item_id: row.source_intake_item_id,
        metadata_json: {
          ...metadata,
          audit_category: discoveryStatus === "failed"
            ? "true_failure"
            : (failureReason === "filtered_url" ? "skipped_by_policy" : "skipped"),
          audit_reason: failureReason || discoveryStatus
        }
      };
    });
  for (const batch of chunkArray(auditUpdates, 100)) {
    if (!batch.length) continue;
    const { placeholders, values } = buildValuesClause(batch, 2, (row) => [
      row.source_intake_item_id,
      toJson(row.metadata_json || {}, {})
    ]);
    await db.query(
      `UPDATE source_intake_items AS sii
       SET metadata_json = mapped.metadata_json::jsonb,
           updated_at = NOW()
       FROM (VALUES ${placeholders}) AS mapped(source_intake_item_id, metadata_json)
       WHERE sii.source_intake_item_id = mapped.source_intake_item_id`,
      values
    );
  }
  await updateSourceIntakeSessionCrawlSummary(db, sourceIntakeSessionId, {
    ...priorSummary,
    failure_accounting: buildFailureAccountingSummary(allRows, priorSummary),
    classification_summary: classificationSummary
  }, null);
  logBuildProgress("source_classification_refreshed", {
    buildId: buildInfo.build_id,
    materiallyChanged: changedRows.length,
    includedSources: refreshedRows.length
  });
  return classificationSummary;
}

function buildSourcePersistenceBatches(records) {
  const batches = [];
  let current = [];
  let segmentCount = 0;
  let chunkCount = 0;
  for (const record of records) {
    const nextSegmentCount = segmentCount + record.sourceItem.lines.length;
    const nextChunkCount = chunkCount + record.sourceChunks.length;
    const wouldOverflow = current.length && (
      current.length >= SOURCE_PERSIST_BATCH_SIZE
      || nextSegmentCount > SOURCE_SEGMENT_INSERT_ROW_LIMIT
      || nextChunkCount > SOURCE_CHUNK_INSERT_ROW_LIMIT
    );
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      segmentCount = 0;
      chunkCount = 0;
    }
    current.push(record);
    segmentCount += record.sourceItem.lines.length;
    chunkCount += record.sourceChunks.length;
  }
  if (current.length) {
    batches.push(current);
  }
  return batches;
}

async function bulkUpsertSourceRefs(db, buildInfo, sourceIntakeSessionId, records) {
  if (!records.length) return 0;
  const rows = records.map((record) => ({
    source_ref_id: record.sourceRefId,
    tenant_key: buildInfo.tenant_key,
    build_id: buildInfo.build_id,
    source_intake_session_id: sourceIntakeSessionId,
    source_channel: record.sourceItem.sourceChannel,
    source_kind: record.sourceItem.sourceKind,
    source_authority: record.sourceItem.sourceAuthority,
    source_locator: record.sourceItem.sourceLocator,
    title: record.sourceItem.title || null,
    page_type: record.sourceItem.pageType,
    content_hash: stableHash(record.sourceItem.text),
    metadata_json: {
      headings: record.sourceItem.headings || [],
      content_class: record.sourceItem.contentClass,
      document_class: record.sourceItem.documentClass,
      compile_enabled: record.sourceItem.compileEnabled,
      source_session_id: record.sourceItem.sourceSessionId,
      ...record.sourceItem.metadata
    }
  }));
  const { placeholders, values } = buildValuesClause(rows, 12, (row) => [
    row.source_ref_id,
    row.tenant_key,
    row.build_id,
    row.source_intake_session_id,
    row.source_channel,
    row.source_kind,
    row.source_authority,
    row.source_locator,
    row.title,
    row.page_type,
    row.content_hash,
    toJson(row.metadata_json || {}, {})
  ]);
  await db.query(
    `INSERT INTO source_refs (
       source_ref_id, tenant_key, build_id, source_intake_session_id, source_channel, source_kind,
       source_authority, source_locator, title, page_type, content_hash, metadata_json
     )
     VALUES ${placeholders}
     ON CONFLICT (source_ref_id)
     DO UPDATE SET
       source_intake_session_id = EXCLUDED.source_intake_session_id,
       source_channel = EXCLUDED.source_channel,
       source_kind = EXCLUDED.source_kind,
       source_authority = EXCLUDED.source_authority,
       source_locator = EXCLUDED.source_locator,
       title = EXCLUDED.title,
       page_type = EXCLUDED.page_type,
       content_hash = EXCLUDED.content_hash,
       metadata_json = EXCLUDED.metadata_json`,
    values
  );
  return rows.length;
}

async function bulkUpsertSourceSegments(db, buildInfo, records) {
  const rows = records.flatMap((record) => record.sourceItem.lines.map((line, index) => ({
    tenant_key: buildInfo.tenant_key,
    build_id: buildInfo.build_id,
    source_ref_id: record.sourceRefId,
    heading_path: (record.sourceItem.headings || []).join(" > ") || null,
    segment_index: index,
    text_span: line,
    content_hash: stableHash(line),
    metadata_json: {
      title: record.sourceItem.title || null,
      source_locator: record.sourceItem.sourceLocator,
      source_channel: record.sourceItem.sourceChannel
    }
  })));
  let inserted = 0;
  for (const batch of chunkArray(rows, SOURCE_SEGMENT_INSERT_ROW_LIMIT)) {
    if (!batch.length) continue;
    const { placeholders, values } = buildValuesClause(batch, 8, (row) => [
      row.tenant_key,
      row.build_id,
      row.source_ref_id,
      row.heading_path,
      row.segment_index,
      row.text_span,
      row.content_hash,
      toJson(row.metadata_json || {}, {})
    ]);
    await db.query(
      `INSERT INTO source_segments (
         tenant_key, build_id, source_ref_id, heading_path, segment_index, text_span, content_hash, metadata_json
       )
       VALUES ${placeholders}
       ON CONFLICT (source_ref_id, segment_index)
       DO UPDATE SET
         heading_path = EXCLUDED.heading_path,
         text_span = EXCLUDED.text_span,
         content_hash = EXCLUDED.content_hash,
         metadata_json = EXCLUDED.metadata_json`,
      values
    );
    inserted += batch.length;
  }
  return inserted;
}

async function bulkUpsertSourceChunks(db, records) {
  const rows = records.flatMap((record) => record.sourceChunks);
  let inserted = 0;
  for (const batch of chunkArray(rows, SOURCE_CHUNK_INSERT_ROW_LIMIT)) {
    if (!batch.length) continue;
    const { placeholders, values } = buildValuesClause(batch, 12, (row) => [
      row.source_chunk_id,
      row.tenant_key,
      row.build_id,
      row.source_ref_id,
      row.chunk_index,
      row.chunk_kind,
      row.section_title || null,
      row.heading_path || null,
      row.text_span,
      row.token_estimate,
      row.content_hash,
      toJson(row.metadata_json || {}, {})
    ]);
    await db.query(
      `INSERT INTO source_chunks (
         source_chunk_id, tenant_key, build_id, source_ref_id, chunk_index, chunk_kind, section_title,
         heading_path, text_span, token_estimate, content_hash, metadata_json
       )
       VALUES ${placeholders}
       ON CONFLICT (source_ref_id, chunk_index)
       DO UPDATE SET
         source_chunk_id = EXCLUDED.source_chunk_id,
         chunk_index = EXCLUDED.chunk_index,
         chunk_kind = EXCLUDED.chunk_kind,
         section_title = EXCLUDED.section_title,
         heading_path = EXCLUDED.heading_path,
         text_span = EXCLUDED.text_span,
         token_estimate = EXCLUDED.token_estimate,
         content_hash = EXCLUDED.content_hash,
         metadata_json = EXCLUDED.metadata_json`,
      values
    );
    inserted += batch.length;
  }
  return inserted;
}

async function markSourceIntakeItemsPersisted(db, rows) {
  if (!rows.length) return;
  const { placeholders, values } = buildValuesClause(rows, 2, (row) => [row.sourceIntakeItemId, row.sourceRefId]);
  await db.query(
    `UPDATE source_intake_items AS sii
     SET persistence_status = 'completed',
         source_ref_id = mapped.source_ref_id,
         persisted_at = NOW(),
         updated_at = NOW()
     FROM (VALUES ${placeholders}) AS mapped(source_intake_item_id, source_ref_id)
     WHERE sii.source_intake_item_id = mapped.source_intake_item_id`,
    values
  );
}

async function upsertSourceIntakePersistenceBatch(db, buildInfo, sourceIntakeSessionId, batchIndex, records, counts) {
  const itemIds = records.map((record) => record.sourceIntakeItemId);
  const batchKey = createStablePersistenceBatchKey(buildInfo.build_id, batchIndex, itemIds);
  await db.query(
    `INSERT INTO source_intake_persistence_batches (
       source_intake_persistence_batch_id, tenant_key, build_id, source_intake_session_id, batch_key, batch_index,
       status, item_ids_json, source_ref_count, source_segment_count, source_chunk_count, error_text, created_at, updated_at, completed_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, 'completed', $7::jsonb, $8, $9, $10, NULL, NOW(), NOW(), NOW()
     )
     ON CONFLICT (build_id, batch_key)
     DO UPDATE SET
       status = 'completed',
       item_ids_json = EXCLUDED.item_ids_json,
       source_ref_count = EXCLUDED.source_ref_count,
       source_segment_count = EXCLUDED.source_segment_count,
       source_chunk_count = EXCLUDED.source_chunk_count,
       error_text = NULL,
       updated_at = NOW(),
       completed_at = NOW()`,
    [
      createStableId("spb", batchKey),
      buildInfo.tenant_key,
      buildInfo.build_id,
      sourceIntakeSessionId,
      batchKey,
      batchIndex,
      toJson(itemIds, []),
      Number(counts.sourceRefs || 0),
      Number(counts.sourceSegments || 0),
      Number(counts.sourceChunks || 0)
    ]
  );
  return batchKey;
}

async function persistRawBuildSourcesFromDb(db, buildInfo, sourceIntakeSessionId) {
  const allIncludedRows = await loadPersistedSourceIntakeItems(db, buildInfo, sourceIntakeSessionId, "included");
  const completedRows = allIncludedRows.filter((row) => normalizeText(row.persistence_status) === "completed");
  const pendingRows = allIncludedRows.filter((row) => normalizeText(row.persistence_status) !== "completed");
  const completedIds = completedRows.map((row) => row.source_intake_item_id);
  const remainingIds = pendingRows.map((row) => row.source_intake_item_id);
  const batches = buildSourcePersistenceBatches(pendingRows.map((row) => buildSourceRecordFromIntakeRow(buildInfo, row)));
  const existingMetricsRes = await db.query(
    `SELECT
        COALESCE((SELECT COUNT(*)::int FROM source_refs WHERE tenant_key = $1 AND build_id = $2), 0) AS source_refs,
        COALESCE((SELECT COUNT(*)::int FROM source_segments WHERE tenant_key = $1 AND build_id = $2), 0) AS source_segments,
        COALESCE((SELECT COUNT(*)::int FROM source_chunks WHERE tenant_key = $1 AND build_id = $2), 0) AS source_chunks,
        COALESCE((SELECT COUNT(*)::int FROM source_intake_persistence_batches WHERE tenant_key = $1 AND build_id = $2), 0) AS persisted_batches`,
    [buildInfo.tenant_key, buildInfo.build_id]
  );
  const sourceCounts = {
    sourceRefs: Number(existingMetricsRes.rows[0]?.source_refs || completedRows.length || 0),
    sourceSegments: Number(existingMetricsRes.rows[0]?.source_segments || 0),
    sourceChunks: Number(existingMetricsRes.rows[0]?.source_chunks || 0)
  };
  const existingBatchCount = Number(existingMetricsRes.rows[0]?.persisted_batches || 0);
  if (!batches.length) {
    await updateSourceIntakeSessionPersistenceCheckpoint(db, sourceIntakeSessionId, {
      total_discovered_sources: allIncludedRows.length,
      total_persisted_sources: completedIds.length,
      completed_source_item_ids: completedIds,
      remaining_source_item_ids: [],
      last_committed_batch: null,
      last_committed_batch_index: existingBatchCount,
      total_batches: existingBatchCount,
      stage_status: "raw_source_persisted"
    }, "compiling");
    return {
      counts: sourceCounts
    };
  }

  let committedBatchCount = 0;
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const batchCounts = {
      sourceRefs: 0,
      sourceSegments: 0,
      sourceChunks: 0
    };
    let batchKey = null;
    const nextCompletedIds = [...completedIds, ...batch.map((record) => record.sourceIntakeItemId)];
    const nextRemainingIds = remainingIds.filter((itemId) => !batch.some((record) => record.sourceIntakeItemId === itemId));
    await withTransaction(db, async (client) => {
      batchCounts.sourceRefs = await bulkUpsertSourceRefs(client, buildInfo, sourceIntakeSessionId, batch);
      batchCounts.sourceSegments = await bulkUpsertSourceSegments(client, buildInfo, batch);
      batchCounts.sourceChunks = await bulkUpsertSourceChunks(client, batch);
      await markSourceIntakeItemsPersisted(client, batch.map((record) => ({
        sourceIntakeItemId: record.sourceIntakeItemId,
        sourceRefId: record.sourceRefId
      })));
      batchKey = await upsertSourceIntakePersistenceBatch(client, buildInfo, sourceIntakeSessionId, existingBatchCount + committedBatchCount + 1, batch, batchCounts);
      await updateSourceIntakeSessionPersistenceCheckpoint(client, sourceIntakeSessionId, {
        total_discovered_sources: allIncludedRows.length,
        total_persisted_sources: nextCompletedIds.length,
        completed_source_item_ids: nextCompletedIds,
        remaining_source_item_ids: nextRemainingIds,
        last_committed_batch: batchKey,
        last_committed_batch_index: existingBatchCount + committedBatchCount + 1,
        total_batches: existingBatchCount + batches.length,
        stage_status: nextRemainingIds.length ? "raw_source_persisting" : "raw_source_persisted"
      }, nextRemainingIds.length ? "raw_source_persisting" : "compiling");
    });
    completedIds.splice(0, completedIds.length, ...nextCompletedIds);
    remainingIds.splice(0, remainingIds.length, ...nextRemainingIds);
    sourceCounts.sourceRefs += batchCounts.sourceRefs;
    sourceCounts.sourceSegments += batchCounts.sourceSegments;
    sourceCounts.sourceChunks += batchCounts.sourceChunks;
    committedBatchCount += 1;
    logBuildProgress("raw_source_batch_committed", {
      buildId: buildInfo.build_id,
      batchIndex: committedBatchCount,
      batchKey,
      sourceRefCount: sourceCounts.sourceRefs,
      sourceSegmentCount: sourceCounts.sourceSegments,
      sourceChunkCount: sourceCounts.sourceChunks,
      remainingSources: remainingIds.length
    });
    if (STAGE_A_SIMULATED_FAILURE_AFTER_BATCHES > 0 && committedBatchCount >= STAGE_A_SIMULATED_FAILURE_AFTER_BATCHES) {
      throw new Error(`stage_a_simulated_failure_after_batch_${committedBatchCount}`);
    }
  }

  const countsRes = await db.query(
    `SELECT
        COALESCE((SELECT COUNT(*)::int FROM source_refs WHERE tenant_key = $1 AND build_id = $2), 0) AS source_refs,
        COALESCE((SELECT COUNT(*)::int FROM source_segments WHERE tenant_key = $1 AND build_id = $2), 0) AS source_segments,
        COALESCE((SELECT COUNT(*)::int FROM source_chunks WHERE tenant_key = $1 AND build_id = $2), 0) AS source_chunks`,
    [buildInfo.tenant_key, buildInfo.build_id]
  );
  return {
    counts: {
      sourceRefs: Number(countsRes.rows[0]?.source_refs || 0),
      sourceSegments: Number(countsRes.rows[0]?.source_segments || 0),
      sourceChunks: Number(countsRes.rows[0]?.source_chunks || 0)
    }
  };
}

async function insertCompiledArtifacts(db, buildInfo, rawCounts, compiled) {
  const validTopicIds = new Set((compiled.topics || []).map((topic) => normalizeText(topic?.knowledge_topic_id)).filter(Boolean));
  const validSubtopicIds = new Set((compiled.subtopics || []).map((subtopic) => normalizeText(subtopic?.knowledge_subtopic_id)).filter(Boolean));
  const sanitizedFacts = [];
  const sanitizedCards = [];
  let sanitizedFactTopicRefs = 0;
  let sanitizedCardTopicRefs = 0;

  for (const fact of compiled.facts || []) {
    const nextFact = { ...fact };
    const topicId = normalizeText(nextFact.knowledge_topic_id);
    const subtopicId = normalizeText(nextFact.knowledge_subtopic_id);
    if (topicId && !validTopicIds.has(topicId)) {
      nextFact.knowledge_topic_id = null;
      nextFact.knowledge_subtopic_id = null;
      sanitizedFactTopicRefs += 1;
    } else if (subtopicId && !validSubtopicIds.has(subtopicId)) {
      nextFact.knowledge_subtopic_id = null;
      sanitizedFactTopicRefs += 1;
    }
    sanitizedFacts.push(nextFact);
  }

  for (const card of compiled.cards || []) {
    const nextCard = { ...card };
    const topicId = normalizeText(nextCard.knowledge_topic_id);
    const subtopicId = normalizeText(nextCard.knowledge_subtopic_id);
    if (topicId && !validTopicIds.has(topicId)) {
      nextCard.knowledge_topic_id = null;
      nextCard.knowledge_subtopic_id = null;
      sanitizedCardTopicRefs += 1;
    } else if (subtopicId && !validSubtopicIds.has(subtopicId)) {
      nextCard.knowledge_subtopic_id = null;
      sanitizedCardTopicRefs += 1;
    }
    sanitizedCards.push(nextCard);
  }

  const sourceCounts = {
    sourceRefs: Number(rawCounts?.sourceRefs || 0),
    sourceSegments: Number(rawCounts?.sourceSegments || 0),
    sourceChunks: Number(rawCounts?.sourceChunks || 0),
    topics: compiled.topics.length,
    subtopics: compiled.subtopics.length,
    cards: sanitizedCards.length,
    facts: sanitizedFacts.length
  };

  await db.query(`DELETE FROM knowledge_build_card_vectors WHERE tenant_key = $1 AND build_id = $2`, [buildInfo.tenant_key, buildInfo.build_id]);
  await db.query(`DELETE FROM knowledge_build_fact_vectors WHERE tenant_key = $1 AND build_id = $2`, [buildInfo.tenant_key, buildInfo.build_id]);
  await db.query(`DELETE FROM knowledge_build_cards WHERE tenant_key = $1 AND build_id = $2`, [buildInfo.tenant_key, buildInfo.build_id]);
  await db.query(`DELETE FROM knowledge_build_facts WHERE tenant_key = $1 AND build_id = $2`, [buildInfo.tenant_key, buildInfo.build_id]);
  await db.query(`DELETE FROM knowledge_build_subtopics WHERE tenant_key = $1 AND build_id = $2`, [buildInfo.tenant_key, buildInfo.build_id]);
  await db.query(`DELETE FROM knowledge_build_topics WHERE tenant_key = $1 AND build_id = $2`, [buildInfo.tenant_key, buildInfo.build_id]);

  for (const topic of compiled.topics || []) {
    await db.query(
      `INSERT INTO knowledge_build_topics (
         knowledge_topic_id, tenant_key, build_id, topic_name, description, aliases_json,
         source_coverage_summary, metadata_json
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)`,
      [
        topic.knowledge_topic_id,
        topic.tenant_key,
        topic.build_id,
        topic.topic_name,
        topic.description,
        JSON.stringify(topic.aliases_json || []),
        topic.source_coverage_summary || null,
        JSON.stringify(topic.metadata_json || {})
      ]
    );
  }

  for (const subtopic of compiled.subtopics || []) {
    await db.query(
      `INSERT INTO knowledge_build_subtopics (
         knowledge_subtopic_id, tenant_key, build_id, knowledge_topic_id, subtopic_name, description,
         aliases_json, source_coverage_summary, metadata_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)`,
      [
        subtopic.knowledge_subtopic_id,
        subtopic.tenant_key,
        subtopic.build_id,
        subtopic.knowledge_topic_id,
        subtopic.subtopic_name,
        subtopic.description,
        JSON.stringify(subtopic.aliases_json || []),
        subtopic.source_coverage_summary || null,
        JSON.stringify(subtopic.metadata_json || {})
      ]
    );
  }

  for (const fact of sanitizedFacts) {
    await db.query(
      `INSERT INTO knowledge_build_facts (
         knowledge_fact_id, tenant_key, build_id, domain_id, subdomain_id, fact_type, object_type, subject,
         predicate, object_text, normalized_value_json, confidence, source_ref_ids_json, scope_json,
         content_class, risk_level, claim_text, evidence_text, knowledge_topic_id, knowledge_subtopic_id,
         fact_role, support_type, source_span_refs_json, source_chunk_ids_json, qualifier_json,
         boundary_json, support_metadata_json, search_text
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14::jsonb,
         $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, $24::jsonb, $25::jsonb,
         $26::jsonb, $27::jsonb, $28
       )`,
      [
        fact.knowledge_fact_id,
        fact.tenant_key,
        fact.build_id,
        fact.domain_id,
        fact.subdomain_id,
        fact.fact_type,
        fact.object_type,
        fact.subject,
        fact.predicate,
        fact.object_text,
        fact.normalized_value_json ? JSON.stringify(fact.normalized_value_json) : null,
        fact.confidence,
        JSON.stringify(fact.source_ref_ids_json || []),
        JSON.stringify(fact.scope_json || {}),
        fact.content_class,
        fact.risk_level,
        fact.claim_text,
        fact.evidence_text,
        fact.knowledge_topic_id,
        fact.knowledge_subtopic_id,
        fact.fact_role,
        fact.support_type,
        JSON.stringify(fact.source_span_refs_json || []),
        JSON.stringify(fact.source_chunk_ids_json || []),
        JSON.stringify(fact.qualifier_json || {}),
        JSON.stringify(fact.boundary_json || {}),
        JSON.stringify(fact.support_metadata_json || {}),
        fact.search_text || fact.claim_text
      ]
    );
  }

  for (const card of sanitizedCards) {
    await db.query(
      `INSERT INTO knowledge_build_cards (
         knowledge_card_id, tenant_key, build_id, domain_id, subdomain_id, card_type, object_type, canonical_name,
         topic_path, intent_tags_json, entity_tags_json, aliases_json, caller_phrases_json, scope_json,
         speakable_summary, answer_facts_json, related_card_ids_json, source_ref_ids_json, content_class,
         allowed_uses_json, risk_level, quality_score, search_text, knowledge_topic_id, knowledge_subtopic_id,
         card_role, support_summary, source_span_refs_json, support_metadata_json
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
         $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20::jsonb, $21, $22, $23, $24, $25,
         $26, $27, $28::jsonb, $29::jsonb
       )`,
      [
        card.knowledge_card_id,
        card.tenant_key,
        card.build_id,
        card.domain_id,
        card.subdomain_id,
        card.card_type,
        card.object_type,
        card.canonical_name,
        card.topic_path,
        JSON.stringify(card.intent_tags_json || []),
        JSON.stringify(card.entity_tags_json || []),
        JSON.stringify(card.aliases_json || []),
        JSON.stringify(card.caller_phrases_json || []),
        JSON.stringify(card.scope_json || {}),
        card.speakable_summary,
        JSON.stringify(card.answer_facts_json || []),
        JSON.stringify(card.related_card_ids_json || []),
        JSON.stringify(card.source_ref_ids_json || []),
        card.content_class,
        JSON.stringify(card.allowed_uses_json || []),
        card.risk_level,
        card.quality_score,
        card.search_text,
        card.knowledge_topic_id,
        card.knowledge_subtopic_id,
        card.card_role,
        card.support_summary || card.speakable_summary,
        JSON.stringify(card.source_span_refs_json || []),
        JSON.stringify(card.support_metadata_json || {})
      ]
    );
  }

  for (const cardVector of compiled.cardVectors) {
    await db.query(
      `INSERT INTO knowledge_build_card_vectors (
         tenant_key, build_id, knowledge_card_id, embedding_model, embedding
       )
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (knowledge_card_id, embedding_model)
       DO UPDATE SET embedding = EXCLUDED.embedding`,
      [
        cardVector.tenant_key,
        cardVector.build_id,
        cardVector.knowledge_card_id,
        cardVector.embedding_model,
        cardVector.embedding
      ]
    );
  }

  for (const factVector of compiled.factVectors) {
    await db.query(
      `INSERT INTO knowledge_build_fact_vectors (
         tenant_key, build_id, knowledge_fact_id, embedding_model, embedding
       )
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (knowledge_fact_id, embedding_model)
       DO UPDATE SET embedding = EXCLUDED.embedding`,
      [
        factVector.tenant_key,
        factVector.build_id,
        factVector.knowledge_fact_id,
        factVector.embedding_model,
        factVector.embedding
      ]
    );
  }

  await db.query(
    `UPDATE knowledge_builds
     SET compiler_version = $2,
         topic_inventory_summary_json = $3::jsonb,
         embedding_model = $4,
         planner_model = $5,
         updated_at = NOW()
     WHERE build_id = $1`,
    [
      buildInfo.build_id,
      compiled.compilerVersion,
      JSON.stringify(compiled.topicInventorySummary || {}),
      compiled.embeddingModel,
      compiled.plannerModel
    ]
  );

  return {
    counts: sourceCounts,
    compilerWarnings: uniqueValues([
      ...(compiled.warnings || []),
      ...(sanitizedFactTopicRefs ? [`fact_topic_refs_cleared:${sanitizedFactTopicRefs}`] : []),
      ...(sanitizedCardTopicRefs ? [`card_topic_refs_cleared:${sanitizedCardTopicRefs}`] : [])
    ]),
    compiled
  };
}

async function loadBuildAssetsFromDb(db, tenantKey, buildId) {
  const [buildRes, cardRes, factRes] = await Promise.all([
    db.query(
      `SELECT build_id, tenant_key, status, version, domain_assignments_json, validation_summary_json,
              source_channels_json, compiler_version, topic_inventory_summary_json, embedding_model, planner_model
       FROM knowledge_builds
       WHERE tenant_key = $1
         AND build_id = $2
       LIMIT 1`,
      [tenantKey, buildId]
    ),
    db.query(
      `SELECT knowledge_card_id, canonical_name, aliases_json, caller_phrases_json, speakable_summary,
              support_summary, answer_facts_json, quality_score, search_text, domain_id, subdomain_id, content_class, scope_json,
              topic_path, card_type, object_type, intent_tags_json, entity_tags_json, card_role, source_ref_ids_json
       FROM knowledge_build_cards
       WHERE tenant_key = $1
         AND build_id = $2
       ORDER BY quality_score DESC, created_at DESC`,
      [tenantKey, buildId]
    ),
    db.query(
      `SELECT knowledge_fact_id, claim_text, fact_role, search_text, source_ref_ids_json
       FROM knowledge_build_facts
       WHERE tenant_key = $1
         AND build_id = $2
       ORDER BY created_at DESC`,
      [tenantKey, buildId]
    )
  ]);

  if (!buildRes.rowCount) {
    throw new Error("build_not_found");
  }

  const buildRow = buildRes.rows[0];
  const assignments = Array.isArray(buildRow.domain_assignments_json) ? buildRow.domain_assignments_json : [];
  return {
    build_id: buildRow.build_id,
    tenant_key: buildRow.tenant_key,
    status: buildRow.status,
    assignments,
    source_channels_json: Array.isArray(buildRow.source_channels_json) ? buildRow.source_channels_json : [],
    compiler_version: normalizeText(buildRow.compiler_version),
    topic_inventory_summary_json: buildRow.topic_inventory_summary_json && typeof buildRow.topic_inventory_summary_json === "object"
      ? buildRow.topic_inventory_summary_json
      : {},
    embedding_model: normalizeText(buildRow.embedding_model),
    planner_model: normalizeText(buildRow.planner_model),
    primaryDomainId: normalizeText(assignments[0]?.domain_id || cardRes.rows[0]?.domain_id),
    primarySubdomainId: normalizeText(assignments[0]?.subdomain_id || cardRes.rows[0]?.subdomain_id) || null,
    cards: (cardRes.rows || []).map((row) => ({
      ...row,
      aliases_json: Array.isArray(row.aliases_json) ? row.aliases_json : [],
      caller_phrases_json: Array.isArray(row.caller_phrases_json) ? row.caller_phrases_json : [],
      answer_facts_json: Array.isArray(row.answer_facts_json) ? row.answer_facts_json : [],
      intent_tags_json: Array.isArray(row.intent_tags_json) ? row.intent_tags_json : [],
      entity_tags_json: Array.isArray(row.entity_tags_json) ? row.entity_tags_json : [],
      source_ref_ids_json: Array.isArray(row.source_ref_ids_json) ? row.source_ref_ids_json : [],
      scope_json: row.scope_json && typeof row.scope_json === "object" && !Array.isArray(row.scope_json) ? row.scope_json : {}
    })),
    facts: (factRes.rows || []).map((row) => ({
      knowledge_fact_id: row.knowledge_fact_id,
      claim_text: row.claim_text,
      fact_role: row.fact_role,
      search_text: row.search_text,
      source_ref_ids_json: Array.isArray(row.source_ref_ids_json) ? row.source_ref_ids_json : []
    }))
  };
}

function cacheKey(tenantKey, buildId) {
  return `${tenantKey}:${buildId}`;
}

function setBuildAssetCache(tenantKey, buildId, assets) {
  buildAssetCache.set(cacheKey(tenantKey, buildId), { assets, loadedAt: Date.now() });
}

function invalidateBuildAssetCache(tenantKey, buildId) {
  buildAssetCache.delete(cacheKey(tenantKey, buildId));
}

async function loadBuildAssets(db, tenantKey, buildId, { useCache = true } = {}) {
  const key = cacheKey(tenantKey, buildId);
  if (useCache) {
    const cached = buildAssetCache.get(key);
    if (cached && (Date.now() - cached.loadedAt) < CACHE_TTL_MS) {
      return { assets: cached.assets, fetchMs: 0, cacheHit: true };
    }
  }

  const started = Date.now();
  const assets = await loadBuildAssetsFromDb(db, tenantKey, buildId);
  const fetchMs = Date.now() - started;
  setBuildAssetCache(tenantKey, buildId, assets);
  return { assets, fetchMs, cacheHit: false };
}

async function validateBuildBudgetsAndLatency(db, tenantKey, buildId) {
  invalidateBuildAssetCache(tenantKey, buildId);
  const coldFetch = await loadBuildAssets(db, tenantKey, buildId, { useCache: true });
  const warmFetch = await loadBuildAssets(db, tenantKey, buildId, { useCache: true });
  const assets = warmFetch.assets;

  const sampleQueries = uniqueValues([
    ...assets.cards.slice(0, 3).flatMap((card) => [
      ...(card.caller_phrases_json || []).slice(0, 2),
      card.canonical_name,
      normalizeText(card.speakable_summary).split(/[.!?]/)[0]
    ]),
    ...assets.facts.slice(0, 2).map((fact) => fact.claim_text)
  ]).slice(0, 5);

  const retrievalCoreDurations = [];
  const plannerRuntimeDurations = [];
  const plannerTimingSamples = [];
  const runtimePackets = [];
  const retrievalTelemetry = [];
  for (const query of sampleQueries) {
    const started = performance.now();
    const runtimeResult = await executePlannerPgvectorRuntime(db, {
      tenantKey,
      buildId,
      queryText: query,
      recentConversationSummary: "",
      tenantPersona: "Helpful business receptionist. Answer briefly in the tenant's voice.",
      businessCallIntentSummary: "Answer the caller directly from approved business truth and move them to the next supported step.",
      currentStage: "answer_or_route",
      embeddingModel: assets.embedding_model || undefined,
      plannerModel: assets.planner_model || undefined
    });
    const durationMs = Number((performance.now() - started).toFixed(3));
    retrievalCoreDurations.push(Number(runtimeResult.timings?.retrieval_ms || 0));
    plannerRuntimeDurations.push(durationMs);
    plannerTimingSamples.push(runtimeResult.timings || {});
    retrievalTelemetry.push({
      query,
      duration_ms: durationMs,
      timings_ms: runtimeResult.timings || {},
      coverage_items: runtimeResult.planner.coverage_items,
      coverage: runtimeResult.answerPacket.coverage.map((item) => ({
        requested_coverage_item_text: item.requested_coverage_item_text,
        support_strength: item.support_strength,
        used_card_ids: item.used_card_ids,
        used_fact_ids: item.used_fact_ids
      }))
    });
    runtimePackets.push(runtimeResult.answerPacket);
  }

  const largestRuntimePacketTokens = runtimePackets.length
    ? Math.max(...runtimePackets.map((packet) => estimateTokenCount(packet)))
    : 0;
  const retrievalCoreMaxMs = retrievalCoreDurations.length ? Math.max(...retrievalCoreDurations) : 0;
  const plannerRuntimeMaxMs = plannerRuntimeDurations.length ? Math.max(...plannerRuntimeDurations) : 0;

  const warnings = [];
  const blockers = [];

  if (!assets.cards.length || !assets.facts.length) {
    blockers.push("no_runtime_support_artifacts_compiled");
  }

  if (largestRuntimePacketTokens > PROMPT_PAYLOAD_HARD_TOKEN_BUDGET) {
    blockers.push("runtime_packet_hard_budget_exceeded");
  } else if (largestRuntimePacketTokens > PROMPT_PAYLOAD_SOFT_TOKEN_BUDGET) {
    warnings.push("runtime_packet_soft_budget_exceeded");
  }

  if (!warmFetch.cacheHit) {
    blockers.push("active_build_hot_path_cache_miss");
  } else if (warmFetch.fetchMs > ACTIVE_BUILD_HOT_FETCH_HARD_MS) {
    blockers.push("active_build_hot_fetch_hard_limit_exceeded");
  } else if (warmFetch.fetchMs > ACTIVE_BUILD_HOT_FETCH_SOFT_MS) {
    warnings.push("active_build_hot_fetch_soft_limit_exceeded");
  }

  if (coldFetch.fetchMs > ACTIVE_BUILD_COLD_PREWARM_HARD_MS) {
    warnings.push("active_build_cold_prewarm_hard_limit_exceeded");
  } else if (coldFetch.fetchMs > ACTIVE_BUILD_COLD_PREWARM_SOFT_MS) {
    warnings.push("active_build_cold_prewarm_soft_limit_exceeded");
  }

  if (retrievalCoreMaxMs > RETRIEVAL_CORE_HARD_MS) {
    blockers.push("retrieval_core_latency_hard_limit_exceeded");
  } else if (retrievalCoreMaxMs > RETRIEVAL_CORE_SOFT_MS) {
    warnings.push("retrieval_core_latency_soft_limit_exceeded");
  }

  if (plannerRuntimeMaxMs > PLANNER_RUNTIME_HARD_MS) {
    warnings.push("planner_runtime_latency_hard_limit_exceeded");
  } else if (plannerRuntimeMaxMs > PLANNER_RUNTIME_SOFT_MS) {
    warnings.push("planner_runtime_latency_soft_limit_exceeded");
  }

  return {
    sample_query_count: sampleQueries.length,
    runtime_packet: {
      soft_budget_tokens: PROMPT_PAYLOAD_SOFT_TOKEN_BUDGET,
      hard_budget_tokens: PROMPT_PAYLOAD_HARD_TOKEN_BUDGET,
      largest_packet_tokens: largestRuntimePacketTokens
    },
    active_build_fetch_cost: {
      gate_policy: "warm_hot_path_hard_gate__cold_prewarm_warn_only",
      cold_fetch_ms: coldFetch.fetchMs,
      warm_fetch_ms: warmFetch.fetchMs,
      warm_cache_hit: warmFetch.cacheHit
    },
    retrieval_latency: {
      sample_count: retrievalCoreDurations.length,
      max_ms: retrievalCoreMaxMs,
      durations_ms: retrievalCoreDurations
    },
    planner_runtime_latency: {
      sample_count: plannerRuntimeDurations.length,
      max_ms: plannerRuntimeMaxMs,
      durations_ms: plannerRuntimeDurations,
      timing_samples: plannerTimingSamples
    },
    retrieval_eval_samples: retrievalTelemetry,
    warnings,
    blockers
  };
}

export async function prewarmKnowledgeBuildCache(db, tenantKey, buildId) {
  const assets = await loadBuildAssetsFromDb(db, tenantKey, buildId);
  setBuildAssetCache(tenantKey, buildId, assets);
  return {
    build_id: buildId,
    cache_prewarmed: true,
    card_count: assets.cards.length,
    fact_count: assets.facts.length
  };
}

export async function loadActiveKnowledgeBuildAssets(db, tenantKey, { useCache = true } = {}) {
  await assertSliceTablesReady(db);
  const pointerRes = await db.query(
    `SELECT active_build_id
     FROM tenant_active_knowledge_builds
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const activeBuildId = normalizeText(pointerRes.rows[0]?.active_build_id);
  if (!activeBuildId) {
    throw new Error("no_active_build");
  }
  const build = await getKnowledgeBuild(db, tenantKey, activeBuildId);
  if (!build) {
    throw new Error("build_not_found");
  }
  const assetLoad = await loadBuildAssets(db, tenantKey, activeBuildId, { useCache });
  return {
    activeBuildId,
    build,
    assetLoad
  };
}

export async function retrieveBuildRuntimeBundle(db, tenantKey, buildId, query, options = {}) {
  await assertSliceTablesReady(db);
  const queryText = normalizeText(query);
  if (!queryText) {
    throw new Error("query_required");
  }
  const assetLoad = await loadBuildAssets(db, tenantKey, buildId, { useCache: true });
  const started = performance.now();
  const runtimeResult = await executePlannerPgvectorRuntime(db, {
    tenantKey,
    buildId,
    queryText,
    recentConversationSummary: normalizeText(options.recentConversationSummary || options.recent_conversation_summary || ""),
    tenantPersona: normalizeText(options.tenantPersona || options.tenant_persona || "Helpful business receptionist."),
    businessCallIntentSummary: normalizeText(options.businessCallIntentSummary || options.business_call_intent_summary || "Answer directly from approved business truth and move toward the next supported step."),
    currentStage: normalizeText(options.currentStage || options.current_stage || options.callState?.current_stage || options.call_state?.current_stage || "answer_or_route"),
    plannerModel: assetLoad.assets.planner_model || undefined,
    embeddingModel: assetLoad.assets.embedding_model || undefined
  });
  const durationMs = Number((performance.now() - started).toFixed(3));
  return {
    answerPacket: runtimeResult.answerPacket,
    planner: runtimeResult.planner,
    coverageSupportEvents: runtimeResult.coverageSupportEvents,
    retrievalTelemetry: {
      query: queryText,
      duration_ms: durationMs,
      candidate_count: Object.values(runtimeResult.cardResultsByCoverageItem).reduce((sum, items) => sum + items.length, 0)
        + Object.values(runtimeResult.factResultsByCoverageItem).reduce((sum, items) => sum + items.length, 0),
      coverage_items: runtimeResult.answerPacket.coverage,
      planner_coverage_items: runtimeResult.planner.coverage_items
    },
    cacheHit: assetLoad.cacheHit,
    fetchMs: assetLoad.fetchMs,
    assetLoad
  };
}

async function updateBuildAfterValidation(db, buildId, counts, validationSummary, extraWarnings = []) {
  const blockers = Array.isArray(validationSummary?.blockers) ? validationSummary.blockers : [];
  const warnings = uniqueValues([...(validationSummary?.warnings || []), ...extraWarnings]);
  const nextStatus = blockers.length ? "qa_blocked" : "ready_to_publish";

  await db.query(
    `UPDATE knowledge_builds
     SET status = $2,
         artifact_counts_json = $3::jsonb,
         quality_summary_json = $4::jsonb,
         warnings_json = $5::jsonb,
         validation_summary_json = $6::jsonb,
         updated_at = NOW()
     WHERE build_id = $1`,
    [
      buildId,
      nextStatus,
      JSON.stringify(counts),
      JSON.stringify({
        source_count: counts.sourceRefs,
        segment_count: counts.sourceSegments,
        fact_count: counts.facts,
        card_count: counts.cards,
        blockers: blockers.length,
        warnings: warnings.length
      }),
      JSON.stringify(warnings),
      JSON.stringify(validationSummary)
    ]
  );

  return nextStatus;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function batchStageProgress(batchStatsByStage, stage) {
  const stats = asObject(batchStatsByStage?.[stage]);
  const completed = toNumber(stats.completed_batches) + toNumber(stats.fallback_batches);
  return {
    total: toNumber(stats.total_batches),
    completed,
    running: toNumber(stats.running_batches),
    failed: toNumber(stats.failed_batches),
    latestRunningAt: normalizeText(stats.latest_running_at)
  };
}

function rowStageProgress(rowStatsByStage, stage) {
  const stats = asObject(rowStatsByStage?.[stage]);
  const completed = toNumber(stats.completed_rows) + toNumber(stats.fallback_rows);
  return {
    total: toNumber(stats.total_rows),
    completed,
    completedOnly: toNumber(stats.completed_rows),
    fallback: toNumber(stats.fallback_rows)
  };
}

function ratioPercent(done, total) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function timestampMs(value) {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestRunningStage(stageEntries = []) {
  return stageEntries
    .filter((entry) => entry?.stats?.running > 0 && timestampMs(entry?.stats?.latestRunningAt) > 0)
    .sort((left, right) => timestampMs(right.stats.latestRunningAt) - timestampMs(left.stats.latestRunningAt))[0]?.key
    || "";
}

function buildKnowledgeProgress(buildRow, batchStatsByStage = {}, rowStatsByStage = {}, persistedArtifactStats = {}) {
  const buildStatus = normalizeText(buildRow?.status).toLowerCase();
  const intakeStatus = normalizeText(buildRow?.intake_status).toLowerCase();
  const crawlSummary = asObject(buildRow?.crawl_summary_json);
  const persistenceCheckpoint = asObject(buildRow?.persistence_checkpoint_json);
  const analysisCheckpoint = asObject(buildRow?.analysis_checkpoint_json);
  const sourceSummaryStage = asObject(analysisCheckpoint.source_summary_stage);
  const topicInventoryStage = asObject(analysisCheckpoint.topic_inventory_stage);
  const sourceArtifactStage = asObject(analysisCheckpoint.source_artifact_stage);
  const artifactEmbeddingStage = asObject(analysisCheckpoint.artifact_embedding_stage);
  const summaryBatches = batchStageProgress(batchStatsByStage, "source_summary");
  const topicBatches = batchStageProgress(batchStatsByStage, "topic_inventory");
  const artifactBatches = batchStageProgress(batchStatsByStage, "source_artifact");
  const summaryRows = rowStageProgress(rowStatsByStage, "source_summary");
  const artifactRows = rowStageProgress(rowStatsByStage, "source_artifact");
  const cards = toNumber(buildRow?.artifact_counts_json?.cards);
  const facts = toNumber(buildRow?.artifact_counts_json?.facts);
  const persistedCards = toNumber(persistedArtifactStats.cards);
  const persistedFacts = toNumber(persistedArtifactStats.facts);
  const persistedCardVectors = toNumber(persistedArtifactStats.card_vectors);
  const persistedFactVectors = toNumber(persistedArtifactStats.fact_vectors);
  const totalIncludedSources = toNumber(crawlSummary.total_included_sources);
  const totalPersistedSources = toNumber(persistenceCheckpoint.total_persisted_sources);
  const totalSummarySources = Math.max(
    toNumber(sourceSummaryStage.total_sources),
    toNumber(summaryRows.total),
    totalIncludedSources
  );
  const completedSummarySources = Math.max(
    toNumber(sourceSummaryStage.completed_sources),
    toNumber(summaryRows.completed)
  );
  const totalArtifactSources = Math.max(
    toNumber(sourceArtifactStage.total_sources),
    toNumber(artifactRows.total),
    totalIncludedSources
  );
  const completedArtifactSources = Math.max(
    toNumber(sourceArtifactStage.completed_sources),
    toNumber(artifactRows.completed)
  );
  const totalTopicWindows = toNumber(topicInventoryStage.window_count || topicBatches.total);
  const completedTopicWindows = totalTopicWindows > 0
    ? Math.max(
        topicBatches.completed,
        normalizeText(topicInventoryStage.reused_existing).toLowerCase() === "true" || topicInventoryStage.reused_existing
          ? totalTopicWindows
          : 0
      )
    : 0;
  const consolidatedCards = toNumber(analysisCheckpoint?.artifact_consolidation_stage?.card_count);
  const consolidatedFacts = toNumber(analysisCheckpoint?.artifact_consolidation_stage?.fact_count);
  const embeddedCards = toNumber(artifactEmbeddingStage.card_vector_count);
  const embeddedFacts = toNumber(artifactEmbeddingStage.fact_vector_count);
  const summaryDone = totalSummarySources > 0 && completedSummarySources >= totalSummarySources;
  const topicDone = totalTopicWindows > 0
    ? completedTopicWindows >= totalTopicWindows
    : toNumber(topicInventoryStage.topic_count) > 0;
  const artifactDone = totalArtifactSources > 0 && completedArtifactSources >= totalArtifactSources;
  const embeddingDone = embeddedCards > 0 || embeddedFacts > 0;
  const finalPersistCountsReady = (cards > 0 || facts > 0 || persistedCards > 0 || persistedFacts > 0 || persistedCardVectors > 0 || persistedFactVectors > 0);
  const liveAnalysisStage = !finalPersistCountsReady && !embeddingDone
    ? latestRunningStage([
        { key: "source_summary", stats: summaryBatches },
        { key: "topic_inventory", stats: topicBatches },
        { key: "source_artifact", stats: artifactBatches }
      ])
    : "";
  const stageDefinitions = [
    { key: "discovering", label: "Discover" },
    { key: "persisting", label: "Persist" },
    { key: "source_summary", label: "Summaries" },
    { key: "topic_inventory", label: "Topics" },
    { key: "source_artifact", label: "Artifacts" },
    { key: "embedding", label: "Embed" },
    { key: "finalizing", label: "Finalize" }
  ];
  const stageIndexByKey = new Map(stageDefinitions.map((stage, index) => [stage.key, index]));
  const withStageMeta = (progress) => {
    const phaseKey = normalizeText(progress?.phase).toLowerCase();
    const currentIndex = stageIndexByKey.has(phaseKey)
      ? stageIndexByKey.get(phaseKey)
      : progress?.percent >= 100
        ? stageDefinitions.length - 1
        : Math.max(0, Math.min(stageDefinitions.length - 1, Math.ceil((toNumber(progress?.percent) / 100) * stageDefinitions.length) - 1));
    const stages = stageDefinitions.map((stage, index) => {
      let status = "pending";
      if (progress?.percent >= 100) {
        status = "done";
      } else if (index < currentIndex) {
        status = "done";
      } else if (index === currentIndex && progress?.active) {
        status = "active";
      } else if (index === currentIndex && toNumber(progress?.percent) > 0) {
        status = "done";
      }
      return {
        ...stage,
        status
      };
    });
    return {
      ...progress,
      step: Math.min(stageDefinitions.length, currentIndex + 1),
      stepTotal: stageDefinitions.length,
      stages
    };
  };

  if (buildStatus === "published") {
    return withStageMeta({
      phase: "published",
      label: "Published",
      summary: `Live with ${cards} cards and ${facts} facts.`,
      percent: 100,
      active: false,
      details: [
        `${cards} cards`,
        `${facts} facts`
      ]
    });
  }

  if (buildStatus === "ready_to_publish") {
    return withStageMeta({
      phase: "ready_to_publish",
      label: "Ready To Publish",
      summary: `${cards} cards and ${facts} facts are ready.`,
      percent: 100,
      active: false,
      details: [
        `${cards} cards`,
        `${facts} facts`
      ]
    });
  }

  if (buildStatus === "qa_blocked") {
    return withStageMeta({
      phase: "qa_blocked",
      label: "Needs Review",
      summary: `${cards} cards and ${facts} facts built. Review warnings before publishing.`,
      percent: 100,
      active: false,
      details: [
        `${cards} cards`,
        `${facts} facts`
      ]
    });
  }

  if (buildStatus === "failed") {
    const intakeErrors = Array.isArray(buildRow?.intake_errors_json) ? buildRow.intake_errors_json : [];
    const warnings = Array.isArray(buildRow?.warnings_json) ? buildRow.warnings_json : [];
    return withStageMeta({
      phase: "failed",
      label: "Failed",
      summary: normalizeText(intakeErrors[0] || warnings[0] || "The build stopped before completion."),
      percent: Math.max(
        embeddingDone ? 96 : 0,
        artifactDone ? 88 : 0,
        topicDone ? 66 : 0,
        summaryDone ? 48 : 0,
        totalPersistedSources > 0 ? 18 : 0
      ),
      active: false,
      details: [
        totalIncludedSources > 0 ? `${totalIncludedSources} sources discovered` : "",
        totalPersistedSources > 0 ? `${totalPersistedSources} persisted` : "",
        consolidatedCards > 0 || consolidatedFacts > 0 ? `${consolidatedCards} cards and ${consolidatedFacts} facts prepared` : ""
      ].filter(Boolean)
    });
  }

  if (buildStatus === "queued") {
    return withStageMeta({
      phase: "queued",
      label: "Queued",
      summary: "Waiting for the background build runner.",
      percent: 0,
      active: true,
      details: []
    });
  }

  if (intakeStatus === "discovering" || normalizeText(crawlSummary.stage_status).toLowerCase() === "discovering") {
    const discovered = toNumber(crawlSummary.total_discovered_sources);
    const included = totalIncludedSources;
    return withStageMeta({
      phase: "discovering",
      label: "Discovering Sources",
      summary: included > 0
        ? `${included} included source${included === 1 ? "" : "s"} discovered so far.`
        : `${discovered || 0} source${discovered === 1 ? "" : "s"} examined so far.`,
      percent: Math.max(5, Math.round(ratioPercent(discovered, Math.max(discovered, included, 1)) * 0.2)),
      active: true,
      details: [
        `${included || 0} included`,
        `${toNumber(crawlSummary.total_skipped_sources)} skipped`,
        `${toNumber(crawlSummary.total_failed_sources)} failed`
      ]
    });
  }

  if (intakeStatus === "raw_source_persisting" || (totalIncludedSources > 0 && totalPersistedSources < totalIncludedSources)) {
    return withStageMeta({
      phase: "persisting",
      label: "Persisting Raw Sources",
      summary: `${totalPersistedSources} of ${totalIncludedSources || "?"} sources stored for compile.`,
      percent: Math.max(20, Math.min(40, 20 + Math.round(ratioPercent(totalPersistedSources, totalIncludedSources || 1) * 0.2))),
      active: true
      ,
      details: [
        `${totalPersistedSources} persisted`,
        `${Math.max(0, totalIncludedSources - totalPersistedSources)} remaining`
      ]
    });
  }

  if (!summaryDone) {
    const summaryPercent = totalSummarySources > 0
      ? ratioPercent(completedSummarySources, totalSummarySources)
      : ratioPercent(summaryBatches.completed, summaryBatches.total || 1);
    return withStageMeta({
      phase: "source_summary",
      label: "Summarizing Sources",
      summary: totalSummarySources > 0
        ? `${completedSummarySources} of ${totalSummarySources} sources summarized.`
        : `${summaryBatches.completed} of ${summaryBatches.total} summary batches completed.`,
      percent: Math.max(40, Math.min(65, 40 + Math.round(summaryPercent * 0.25))),
      active: true,
      batches: summaryBatches,
      details: [
        `${summaryRows.completedOnly} completed`,
        `${summaryRows.fallback} fallback`,
        summaryBatches.running > 0 ? `${summaryBatches.running} batches running` : ""
      ].filter(Boolean)
    });
  }

  if (!topicDone) {
    const topicPercent = totalTopicWindows > 0
      ? ratioPercent(completedTopicWindows, totalTopicWindows)
      : ratioPercent(topicBatches.completed, topicBatches.total || 1);
    return withStageMeta({
      phase: "topic_inventory",
      label: "Building Topic Inventory",
      summary: totalTopicWindows > 0
        ? `${completedTopicWindows} of ${totalTopicWindows} topic windows completed.`
        : `${topicBatches.completed} of ${topicBatches.total} topic windows completed.`,
      percent: Math.max(65, Math.min(75, 65 + Math.round(topicPercent * 0.1))),
      active: true,
      batches: topicBatches,
      details: [
        topicBatches.running > 0 ? `${topicBatches.running} windows running` : "",
        `${toNumber(topicInventoryStage.topic_count)} topics so far`,
        `${toNumber(topicInventoryStage.subtopic_count)} subtopics so far`
      ].filter(Boolean)
    });
  }

  if (!artifactDone) {
    const artifactPercent = totalArtifactSources > 0
      ? ratioPercent(completedArtifactSources, totalArtifactSources)
      : ratioPercent(artifactBatches.completed, artifactBatches.total || 1);
    return withStageMeta({
      phase: "source_artifact",
      label: "Extracting Cards And Facts",
      summary: totalArtifactSources > 0
        ? `${completedArtifactSources} of ${totalArtifactSources} sources compiled into artifacts.`
        : `${artifactBatches.completed} of ${artifactBatches.total} artifact batches completed.`,
      percent: Math.max(75, Math.min(90, 75 + Math.round(artifactPercent * 0.15))),
      active: true,
      batches: artifactBatches,
      details: [
        `${artifactRows.completedOnly} completed`,
        `${artifactRows.fallback} fallback`,
        artifactBatches.running > 0 ? `${artifactBatches.running} batches running` : ""
      ].filter(Boolean)
    });
  }

  if (liveAnalysisStage === "source_summary") {
    const summaryPercent = totalSummarySources > 0
      ? ratioPercent(completedSummarySources, totalSummarySources)
      : ratioPercent(summaryBatches.completed, summaryBatches.total || 1);
    return withStageMeta({
      phase: "source_summary",
      label: "Summarizing Sources",
      summary: totalSummarySources > 0
        ? `${completedSummarySources} of ${totalSummarySources} sources summarized.`
        : `${summaryBatches.completed} of ${summaryBatches.total} summary batches completed.`,
      percent: Math.max(40, Math.min(65, 40 + Math.round(summaryPercent * 0.25))),
      active: true,
      batches: summaryBatches,
      details: [
        `${summaryRows.completedOnly} completed`,
        `${summaryRows.fallback} fallback`,
        `${summaryBatches.running} batches running`
      ].filter(Boolean)
    });
  }

  if (liveAnalysisStage === "topic_inventory") {
    const topicPercent = totalTopicWindows > 0
      ? ratioPercent(completedTopicWindows, totalTopicWindows)
      : ratioPercent(topicBatches.completed, topicBatches.total || 1);
    return withStageMeta({
      phase: "topic_inventory",
      label: "Building Topic Inventory",
      summary: totalTopicWindows > 0
        ? `${completedTopicWindows} of ${totalTopicWindows} topic windows completed.`
        : `${topicBatches.completed} of ${topicBatches.total} topic windows completed.`,
      percent: Math.max(65, Math.min(75, 65 + Math.round(topicPercent * 0.1))),
      active: true,
      batches: topicBatches,
      details: [
        `${topicBatches.running} windows running`,
        `${toNumber(topicInventoryStage.topic_count)} topics so far`,
        `${toNumber(topicInventoryStage.subtopic_count)} subtopics so far`
      ].filter(Boolean)
    });
  }

  if (liveAnalysisStage === "source_artifact") {
    const artifactPercent = totalArtifactSources > 0
      ? ratioPercent(completedArtifactSources, totalArtifactSources)
      : ratioPercent(artifactBatches.completed, artifactBatches.total || 1);
    return withStageMeta({
      phase: "source_artifact",
      label: "Extracting Cards And Facts",
      summary: totalArtifactSources > 0
        ? `${completedArtifactSources} of ${totalArtifactSources} sources compiled into artifacts.`
        : `${artifactBatches.completed} of ${artifactBatches.total} artifact batches completed.`,
      percent: Math.max(75, Math.min(90, 75 + Math.round(artifactPercent * 0.15))),
      active: true,
      batches: artifactBatches,
      details: [
        `${artifactRows.completedOnly} completed`,
        `${artifactRows.fallback} fallback`,
        `${artifactBatches.running} batches running`
      ].filter(Boolean)
    });
  }

  if (!embeddingDone) {
    return withStageMeta({
      phase: "embedding",
      label: "Embedding Artifacts",
      summary: `${consolidatedCards} cards and ${consolidatedFacts} facts are being prepared for vector search.`,
      percent: 94,
      active: true,
      details: [
        `${consolidatedCards} cards prepared`,
        `${consolidatedFacts} facts prepared`
      ]
    });
  }

  if (buildStatus === "running" && !["published", "ready_to_publish", "qa_blocked"].includes(buildStatus)) {
    const finalCards = cards || persistedCards || consolidatedCards;
    const finalFacts = facts || persistedFacts || consolidatedFacts;
    return withStageMeta({
      phase: "finalizing",
      label: "Finalizing Build",
      summary: finalPersistCountsReady
        ? `${persistedCards || finalCards} cards, ${persistedFacts || finalFacts} facts, ${persistedCardVectors || embeddedCards} card vectors, and ${persistedFactVectors || embeddedFacts} fact vectors written.`
        : `${embeddedCards} card vectors and ${embeddedFacts} fact vectors created. Validating the runtime bundle now.`,
      percent: finalPersistCountsReady ? 98 : 96,
      active: true,
      details: [
        `${persistedCards || finalCards} cards`,
        `${persistedFacts || finalFacts} facts`,
        `${persistedCardVectors || embeddedCards} card vectors`,
        `${persistedFactVectors || embeddedFacts} fact vectors`
      ]
    });
  }

  return withStageMeta({
    phase: "running",
    label: "Running",
    summary: "Build work is in progress.",
    percent: Math.max(
      embeddingDone ? 96 : 0,
      artifactDone ? 88 : 0,
      topicDone ? 66 : 0,
      summaryDone ? 48 : 0,
      totalPersistedSources > 0 ? 18 : 10
    ),
    active: true,
    details: []
  });
}

async function loadKnowledgeBuildBatchStats(db, tenantKey) {
  const result = await db.query(
    `SELECT build_id,
            stage,
            COUNT(*)::int AS total_batches,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_batches,
            COUNT(*) FILTER (WHERE status = 'fallback')::int AS fallback_batches,
            COUNT(*) FILTER (WHERE status = 'running')::int AS running_batches,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_batches,
            MAX(updated_at) FILTER (WHERE status = 'running') AS latest_running_at
     FROM knowledge_build_analysis_batches
     WHERE tenant_key = $1
     GROUP BY build_id, stage`,
    [tenantKey]
  );

  const byBuild = new Map();
  for (const row of result.rows || []) {
    const buildId = normalizeText(row.build_id);
    const stage = normalizeText(row.stage);
    if (!buildId || !stage) continue;
    if (!byBuild.has(buildId)) byBuild.set(buildId, {});
    byBuild.get(buildId)[stage] = row;
  }
  return byBuild;
}

async function loadKnowledgeBuildRowStats(db, tenantKey) {
  const result = await db.query(
    `SELECT build_id,
            stage,
            COUNT(*)::int AS total_rows,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_rows,
            COUNT(*) FILTER (WHERE status = 'fallback')::int AS fallback_rows
     FROM (
       SELECT build_id, status, 'source_summary'::text AS stage
       FROM knowledge_build_source_summaries
       WHERE tenant_key = $1
       UNION ALL
       SELECT build_id, status, 'source_artifact'::text AS stage
       FROM knowledge_build_source_artifacts
       WHERE tenant_key = $1
     ) stage_rows
     GROUP BY build_id, stage`,
    [tenantKey]
  );

  const byBuild = new Map();
  for (const row of result.rows || []) {
    const buildId = normalizeText(row.build_id);
    const stage = normalizeText(row.stage);
    if (!buildId || !stage) continue;
    if (!byBuild.has(buildId)) byBuild.set(buildId, {});
    byBuild.get(buildId)[stage] = row;
  }
  return byBuild;
}

async function loadKnowledgeBuildPersistedArtifactStats(db, tenantKey) {
  const result = await db.query(
    `SELECT build_id,
            SUM(cards_count)::int AS cards,
            SUM(facts_count)::int AS facts,
            SUM(card_vectors_count)::int AS card_vectors,
            SUM(fact_vectors_count)::int AS fact_vectors
     FROM (
       SELECT build_id,
              COUNT(*)::int AS cards_count,
              0::int AS facts_count,
              0::int AS card_vectors_count,
              0::int AS fact_vectors_count
       FROM knowledge_build_cards
       WHERE tenant_key = $1
       GROUP BY build_id
       UNION ALL
       SELECT build_id,
              0::int AS cards_count,
              COUNT(*)::int AS facts_count,
              0::int AS card_vectors_count,
              0::int AS fact_vectors_count
       FROM knowledge_build_facts
       WHERE tenant_key = $1
       GROUP BY build_id
       UNION ALL
       SELECT build_id,
              0::int AS cards_count,
              0::int AS facts_count,
              COUNT(*)::int AS card_vectors_count,
              0::int AS fact_vectors_count
       FROM knowledge_build_card_vectors
       WHERE tenant_key = $1
       GROUP BY build_id
       UNION ALL
       SELECT build_id,
              0::int AS cards_count,
              0::int AS facts_count,
              0::int AS card_vectors_count,
              COUNT(*)::int AS fact_vectors_count
       FROM knowledge_build_fact_vectors
       WHERE tenant_key = $1
       GROUP BY build_id
     ) persisted
     GROUP BY build_id`,
    [tenantKey]
  );

  const byBuild = new Map();
  for (const row of result.rows || []) {
    byBuild.set(normalizeText(row.build_id), row);
  }
  return byBuild;
}

async function loadKnowledgeBuildRow(db, buildId) {
  const result = await db.query(
    `SELECT *
     FROM knowledge_builds
     WHERE build_id = $1
     LIMIT 1`,
    [buildId]
  );
  return result.rows[0] || null;
}

async function loadKnowledgeBuildExecutionInput(db, tenantKey, buildId) {
  const result = await db.query(
    `SELECT kb.build_id,
            kb.tenant_key,
            kb.status,
            kb.build_kind,
            kb.base_build_id,
            kb.domain_assignments_json,
            sis.website_root_url,
            sis.metadata_json
     FROM knowledge_builds kb
     INNER JOIN source_intake_sessions sis
       ON sis.build_id = kb.build_id
     WHERE kb.tenant_key = $1
       AND kb.build_id = $2
     LIMIT 1`,
    [tenantKey, buildId]
  );
  if (!result.rowCount) {
    throw new Error("build_not_found");
  }
  const row = result.rows[0];
  const metadata = asObject(row.metadata_json);
  return {
    buildId: normalizeText(row.build_id),
    buildStatus: normalizeText(row.status).toLowerCase(),
    buildKind: normalizeBuildKind(row.build_kind),
    baseBuildId: normalizeText(row.base_build_id),
    websiteUrl: normalizeWebsiteUrl(row.website_root_url),
    uploadedDocumentIds: normalizeIdArray(metadata.uploaded_document_ids),
    setupInterviewSessionIds: normalizeIdArray(metadata.setup_interview_session_ids),
    assignments: Array.isArray(row.domain_assignments_json)
      ? row.domain_assignments_json
          .map((item) => ({
            domainId: normalizeText(item?.domain_id),
            subdomainId: normalizeText(item?.subdomain_id) || null
          }))
          .filter((item) => item.domainId)
      : []
  };
}

async function withKnowledgeBuildExecutionLock(db, tenantKey, buildId, work) {
  const canBorrowClient = typeof db?.connect === "function" && typeof db?.release !== "function";
  const client = canBorrowClient ? await db.connect() : db;
  const ownsClient = canBorrowClient;
  try {
    const lockRes = await client.query(
      `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked`,
      [normalizeText(tenantKey), normalizeText(buildId)]
    );
    if (!lockRes.rows[0]?.locked) {
      return { locked: false, result: null };
    }
    try {
      return { locked: true, result: await work(client) };
    } finally {
      await client.query(
        `SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`,
        [normalizeText(tenantKey), normalizeText(buildId)]
      ).catch(() => {});
    }
  } finally {
    if (ownsClient && typeof client?.release === "function") {
      client.release();
    }
  }
}

export async function listKnowledgeReceptionistBuilds(db, tenantKey) {
  await assertSliceTablesReady(db);
  const [buildsRes, pointerRes, assignments, bootstrapProfile, batchStatsByBuild, rowStatsByBuild, persistedArtifactStatsByBuild] = await Promise.all([
    db.query(
      `SELECT kb.build_id,
              kb.status,
              kb.build_kind,
              kb.base_build_id,
              kb.version,
              kb.domain_assignments_json,
              kb.source_channels_json,
              kb.artifact_counts_json,
              kb.quality_summary_json,
              kb.warnings_json,
              kb.validation_summary_json,
              kb.analysis_checkpoint_json,
              kb.published_at,
              kb.supersedes_build_id,
              kb.created_at,
              kb.updated_at,
              sis.source_intake_session_id,
              sis.status AS intake_status,
              sis.website_root_url,
              sis.crawl_summary_json,
              sis.persistence_checkpoint_json,
              sis.warnings_json AS intake_warnings_json,
              sis.errors_json AS intake_errors_json,
              sis.metadata_json AS intake_metadata_json
       FROM knowledge_builds kb
       LEFT JOIN source_intake_sessions sis
         ON sis.build_id = kb.build_id
       WHERE kb.tenant_key = $1
       ORDER BY kb.created_at DESC`,
      [tenantKey]
    ),
    db.query(
      `SELECT active_build_id, previous_build_id, updated_at
       FROM tenant_active_knowledge_builds
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    ),
    loadTenantDomainAssignments(db, tenantKey),
    loadTenantBootstrapProfile(db, tenantKey),
    loadKnowledgeBuildBatchStats(db, tenantKey),
    loadKnowledgeBuildRowStats(db, tenantKey),
    loadKnowledgeBuildPersistedArtifactStats(db, tenantKey)
  ]);

  const builds = (buildsRes.rows || []).map((row) => ({
    ...row,
    progress: buildKnowledgeProgress(
      row,
      batchStatsByBuild.get(normalizeText(row.build_id)) || {},
      rowStatsByBuild.get(normalizeText(row.build_id)) || {},
      persistedArtifactStatsByBuild.get(normalizeText(row.build_id)) || {}
    )
  }));

  return {
    activeBuild: pointerRes.rows[0] || null,
    assignments,
    builds,
    bootstrapWebsiteUrl: normalizeWebsiteUrl(bootstrapProfile?.website_url || "")
  };
}

function normalizeIdArray(value) {
  return uniqueValues(Array.isArray(value) ? value : []);
}

export async function runKnowledgeBuildJobs(db, options = {}) {
  await assertSliceTablesReady(db);
  const tenantKey = normalizeText(options.tenantKey);
  const buildId = normalizeText(options.buildId);
  const maxBuilds = Math.max(1, Number(options.maxBuilds || KNOWLEDGE_BUILD_JOB_MAX_BUILDS_PER_RUN || 1));
  const params = [];
  const where = [];

  if (tenantKey) {
    params.push(tenantKey);
    where.push(`tenant_key = $${params.length}`);
  }
  if (buildId) {
    params.push(buildId);
    where.push(`build_id = $${params.length}`);
  }
  where.push(`status IN ('queued', 'running')`);
  if (!buildId && KNOWLEDGE_BUILD_JOB_MAX_AUTO_RESUME_AGE_MINUTES > 0) {
    params.push(KNOWLEDGE_BUILD_JOB_MAX_AUTO_RESUME_AGE_MINUTES);
    where.push(`updated_at >= NOW() - ($${params.length}::int * INTERVAL '1 minute')`);
  }
  params.push(maxBuilds);

  const result = await db.query(
    `SELECT build_id, tenant_key, status, created_at, updated_at
     FROM knowledge_builds
     WHERE ${where.join(" AND ")}
     ORDER BY CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
              updated_at ASC,
              created_at ASC
     LIMIT $${params.length}`,
    params
  );

  const runs = [];
  for (const row of result.rows || []) {
    const lockedResult = await withKnowledgeBuildExecutionLock(db, row.tenant_key, row.build_id, async (client) => {
      const executionInput = await loadKnowledgeBuildExecutionInput(client, row.tenant_key, row.build_id);
      try {
        const buildResult = await createKnowledgeBuild(client, row.tenant_key, {
          buildId: executionInput.buildId,
          buildKind: executionInput.buildKind,
          baseBuildId: executionInput.baseBuildId,
          websiteUrl: executionInput.websiteUrl,
          assignments: executionInput.assignments,
          uploadedDocumentIds: executionInput.uploadedDocumentIds,
          setupInterviewSessionIds: executionInput.setupInterviewSessionIds
        });
        if (normalizeText(buildResult?.status).toLowerCase() === "ready_to_publish") {
          await publishKnowledgeBuild(client, row.tenant_key, executionInput.buildId);
          return {
            buildId: executionInput.buildId,
            tenantKey: row.tenant_key,
            action: "processed",
            status: "published",
            autoPublished: true
          };
        }
        return {
          buildId: executionInput.buildId,
          tenantKey: row.tenant_key,
          action: "processed",
          status: buildResult.status
        };
      } catch (err) {
        return {
          buildId: executionInput.buildId,
          tenantKey: row.tenant_key,
          action: "failed",
          status: "failed",
          error: normalizeText(err?.message || "build_failed")
        };
      }
    });

    if (!lockedResult.locked) {
      runs.push({
        buildId: normalizeText(row.build_id),
        tenantKey: normalizeText(row.tenant_key),
        action: "skipped_locked",
        status: normalizeText(row.status).toLowerCase()
      });
      continue;
    }
    runs.push(lockedResult.result || {
      buildId: normalizeText(row.build_id),
      tenantKey: normalizeText(row.tenant_key),
      action: "processed",
      status: "unknown"
    });
  }

  return {
    requestedMaxBuilds: maxBuilds,
    consideredBuilds: (result.rows || []).length,
    runs
  };
}

export async function enqueueKnowledgeBuild(db, tenantKey, input = {}) {
  return createKnowledgeBuild(db, tenantKey, {
    ...input,
    enqueueOnly: true
  });
}

export async function createKnowledgeBuild(db, tenantKey, input = {}) {
  await assertSliceTablesReady(db);
  await syncCanonicalKnowledgePacks(db);

  const enqueueOnly = input.enqueueOnly === true
    || String(input.enqueueOnly || input.enqueue_only || "").toLowerCase() === "true";
  const preferredBuildId = normalizeText(input.buildId || input.build_id);
  const buildKind = normalizeBuildKind(input.buildKind || input.build_kind);
  let baseBuildId = normalizeText(input.baseBuildId || input.base_build_id);
  let websiteUrl = normalizeWebsiteUrl(input.websiteUrl || input.website_url);
  let uploadedDocumentIds = normalizeIdArray(input.uploadedDocumentIds || input.uploaded_document_ids);
  const setupInterviewSessionIds = normalizeIdArray(input.setupInterviewSessionIds || input.setup_interview_session_ids);
  const forceRescrape = input.forceRescrape === true
    || String(input.forceRescrape || input.force_rescrape || "").toLowerCase() === "true";

  if (buildKind === "document_overlay" && !uploadedDocumentIds.length) {
    uploadedDocumentIds = await loadApprovedUploadedDocumentIds(db, tenantKey);
  }
  if (buildKind === "website_base" && !uploadedDocumentIds.length) {
    uploadedDocumentIds = await loadApprovedUploadedDocumentIds(db, tenantKey);
  }

  if (buildKind !== "document_overlay" && !websiteUrl && !uploadedDocumentIds.length && !setupInterviewSessionIds.length) {
    const bootstrapProfile = await loadTenantBootstrapProfile(db, tenantKey);
    websiteUrl = normalizeWebsiteUrl(bootstrapProfile?.website_url);
  }
  if (buildKind === "document_overlay") {
    const overlayBaseBuild = await loadDocumentOverlayBaseBuild(db, tenantKey, baseBuildId);
    if (!overlayBaseBuild?.build_id) {
      throw new Error("overlay_base_build_required");
    }
    baseBuildId = normalizeText(overlayBaseBuild.build_id);
    websiteUrl = normalizeWebsiteUrl(overlayBaseBuild.website_root_url);
  }
  if (buildKind === "website_base" && !websiteUrl) {
    throw new Error("website_url_required");
  }
  if (!websiteUrl && !uploadedDocumentIds.length && !setupInterviewSessionIds.length) {
    throw new Error("approved_source_required");
  }

  const inputFingerprint = buildSourceInputFingerprint({
    buildKind,
    baseBuildId,
    websiteUrl,
    uploadedDocumentIds,
    setupInterviewSessionIds
  });
  const resumableState = forceRescrape ? null : await findResumableBuildState(db, tenantKey, inputFingerprint, preferredBuildId);
  if (preferredBuildId && !resumableState) {
    throw new Error("build_not_found");
  }
  if (preferredBuildId && normalizeText(resumableState?.build_id) !== preferredBuildId) {
    throw new Error("build_not_found");
  }
  if (!resumableState) {
    await assertBuildRateLimit(db, tenantKey);
  }

  const assignments = await resolveTenantDomainAssignments(db, tenantKey, input.assignments || []);
  if (!assignments.length) {
    throw new Error("domain_assignment_required");
  }

  const persistedAssignments = Array.isArray(resumableState?.domain_assignments_json)
    ? resumableState.domain_assignments_json
        .map((item) => ({
          domainId: normalizeText(item?.domain_id),
          subdomainId: normalizeText(item?.subdomain_id) || null
        }))
        .filter((item) => item.domainId)
    : [];
  const effectiveAssignments = persistedAssignments.length ? persistedAssignments : assignments;
  const buildId = normalizeText(resumableState?.build_id) || createId("build");
  const version = normalizeText(resumableState?.version) || await nextBuildVersion(db, tenantKey);
  const intakeSessionId = normalizeText(resumableState?.source_intake_session_id) || createId("intake");
  const primaryAssignment = effectiveAssignments[0];
  const extraWarnings = [];
  if (effectiveAssignments.length > 1) {
    extraWarnings.push("multi_domain_assignment_present_slice_uses_primary_assignment_only");
  }
  const sourceChannels = [];
  if (websiteUrl || buildKind === "document_overlay") sourceChannels.push("website_page", "website_file");
  if (uploadedDocumentIds.length) sourceChannels.push("uploaded_document");
  if (setupInterviewSessionIds.length) sourceChannels.push("owner_interview");
  const runtimeEntryMode = setupInterviewSessionIds.length && !websiteUrl && !uploadedDocumentIds.length
    ? "setup_interview"
    : "customer_call";

  if (!resumableState) {
    await withTransaction(db, async (client) => {
      await client.query(
        `INSERT INTO knowledge_builds (
           build_id, tenant_key, status, version, domain_assignments_json, source_snapshot_id,
           source_channels_json, artifact_counts_json, quality_summary_json, warnings_json, validation_summary_json,
           created_by_type, created_by_id, build_kind, base_build_id, source_fingerprint_json,
           composite_parent_build_ids_json
         )
         VALUES (
           $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
           '{}'::jsonb, 'tenant', NULL, $8, $9, $10::jsonb, $11::jsonb
         )`,
        [
          buildId,
          tenantKey,
          enqueueOnly ? "queued" : "running",
          version,
          JSON.stringify(effectiveAssignments.map((item) => ({ domain_id: item.domainId, subdomain_id: item.subdomainId }))),
          intakeSessionId,
          JSON.stringify(sourceChannels),
          buildKind,
          baseBuildId || null,
          JSON.stringify(inputFingerprint),
          JSON.stringify(baseBuildId ? [baseBuildId] : [])
        ]
      );
      await client.query(
        `INSERT INTO source_intake_sessions (
           source_intake_session_id, tenant_key, build_id, runtime_entry_mode, status, website_root_url,
           source_channels_json, metadata_json, started_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW()
         )`,
        [
          intakeSessionId,
          tenantKey,
          buildId,
          runtimeEntryMode,
          enqueueOnly ? "queued" : "discovering",
          websiteUrl || null,
          JSON.stringify(sourceChannels),
          JSON.stringify({
            build_kind: buildKind,
            base_build_id: baseBuildId || null,
            uploaded_document_ids: uploadedDocumentIds,
            setup_interview_session_ids: setupInterviewSessionIds
          })
        ]
      );
    });
  }

  const rawBuildInfo = {
    build_id: buildId,
    tenant_key: tenantKey,
    primaryDomainId: primaryAssignment.domainId,
    primarySubdomainId: primaryAssignment.subdomainId
  };

  if (enqueueOnly) {
    if (resumableState) {
      const queuedStatus = normalizeText(resumableState.build_status).toLowerCase() === "running" ? "running" : "queued";
      await db.query(
        `UPDATE knowledge_builds
         SET status = $2,
             build_kind = $3,
             base_build_id = $4,
             source_fingerprint_json = $5::jsonb,
             warnings_json = CASE WHEN $2 = 'queued' THEN '[]'::jsonb ELSE warnings_json END,
             updated_at = NOW()
         WHERE build_id = $1`,
        [buildId, queuedStatus, buildKind, baseBuildId || null, JSON.stringify(inputFingerprint)]
      );
      await db.query(
        `UPDATE source_intake_sessions
         SET status = $2,
             website_root_url = $3,
             source_channels_json = $4::jsonb,
             metadata_json = $5::jsonb,
             errors_json = '[]'::jsonb,
             completed_at = CASE WHEN $2 = 'queued' THEN NULL ELSE completed_at END,
             updated_at = NOW()
         WHERE source_intake_session_id = $1`,
        [
          intakeSessionId,
          queuedStatus === "running" ? "running" : "queued",
          websiteUrl || null,
          JSON.stringify(sourceChannels),
          JSON.stringify({
            build_kind: buildKind,
            base_build_id: baseBuildId || null,
            uploaded_document_ids: uploadedDocumentIds,
            setup_interview_session_ids: setupInterviewSessionIds
          })
        ]
      );
    }
    const queuedBuild = await loadKnowledgeBuildRow(db, buildId);
    return {
      build: queuedBuild,
      status: normalizeText(queuedBuild?.status || (resumableState ? resumableState.build_status : "queued")).toLowerCase() || "queued",
      resumed: Boolean(resumableState),
      queued: true
    };
  }

  try {
    const existingSourceSummary = await loadExistingSourceIntakeSummary(db, rawBuildInfo, intakeSessionId);
    const includedSourceItemIds = uniqueValues([
      ...(Array.isArray(existingSourceSummary.completed_ids_json) ? existingSourceSummary.completed_ids_json : []),
      ...(Array.isArray(existingSourceSummary.remaining_ids_json) ? existingSourceSummary.remaining_ids_json : [])
    ]);
    const totalIncludedSources = Number(existingSourceSummary.total_included_sources || 0);
    const totalPersistedSources = Number(existingSourceSummary.total_persisted_sources || 0);
    const priorCrawlSummary = resumableState?.crawl_summary_json && typeof resumableState.crawl_summary_json === "object" && !Array.isArray(resumableState.crawl_summary_json)
      ? resumableState.crawl_summary_json
      : {};
    const priorDiscoveryStageStatus = normalizeText(priorCrawlSummary.stage_status);
    const discoveryCompleted = ["discovery_completed", "raw_source_persisting", "raw_source_pending", "raw_source_persisted", "compiling", "completed"]
      .includes(priorDiscoveryStageStatus)
      || (
        Number(priorCrawlSummary.discovery_batches_total || 0) > 0
        && Number(priorCrawlSummary.discovery_batches_committed || 0) >= Number(priorCrawlSummary.discovery_batches_total || 0)
      );
    const rawSourceStageStatus = totalIncludedSources > 0 && totalPersistedSources >= totalIncludedSources
      ? "compiling"
      : (discoveryCompleted ? "raw_source_persisting" : "discovering");

    await db.query(
      `UPDATE knowledge_builds
       SET status = 'running',
           build_kind = $2,
           base_build_id = $3,
           source_fingerprint_json = $4::jsonb,
           warnings_json = '[]'::jsonb,
           updated_at = NOW()
       WHERE build_id = $1`,
      [buildId, buildKind, baseBuildId || null, JSON.stringify(inputFingerprint)]
    );
    await db.query(
      `UPDATE source_intake_sessions
       SET status = $2,
           website_root_url = $3,
           source_channels_json = $4::jsonb,
           metadata_json = $5::jsonb,
           errors_json = '[]'::jsonb,
           completed_at = NULL,
           updated_at = NOW()
       WHERE source_intake_session_id = $1`,
      [
        intakeSessionId,
        rawSourceStageStatus,
        websiteUrl || null,
        JSON.stringify(sourceChannels),
        JSON.stringify({
          build_kind: buildKind,
          base_build_id: baseBuildId || null,
          uploaded_document_ids: uploadedDocumentIds,
          setup_interview_session_ids: setupInterviewSessionIds
        })
      ]
    );

    if (!discoveryCompleted) {
      if (resumableState) {
        await withTransaction(db, async (client) => {
          await client.query(`DELETE FROM source_intake_persistence_batches WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId]);
          await client.query(`DELETE FROM source_intake_items WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId]);
          await client.query(`DELETE FROM source_chunks WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId]);
          await client.query(`DELETE FROM source_segments WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId]);
          await client.query(`DELETE FROM source_refs WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId]);
        });
      }
      const sourcePayload = buildKind === "document_overlay"
        ? await collectDocumentOverlaySourcePayload(
            db,
            tenantKey,
            { uploadedDocumentIds, setupInterviewSessionIds },
            rawBuildInfo,
            intakeSessionId,
            baseBuildId
          )
        : await collectBuildSourcePayload(
            db,
            tenantKey,
            { uploadedDocumentIds, setupInterviewSessionIds },
            websiteUrl,
            rawBuildInfo,
            intakeSessionId
          );
      if (!(sourcePayload.sourceItems || []).length) {
        throw new Error("approved_source_required");
      }
      if (normalizeText(sourcePayload.baseBuildId)) {
        baseBuildId = normalizeText(sourcePayload.baseBuildId);
      }
      if (normalizeWebsiteUrl(sourcePayload.websiteUrl)) {
        websiteUrl = normalizeWebsiteUrl(sourcePayload.websiteUrl);
      }
      extraWarnings.push(...uniqueValues(sourcePayload.warnings || []));
      await persistDiscoveredSourceItems(
        db,
        rawBuildInfo,
        intakeSessionId,
        sourcePayload.discoveryEntries,
        sourcePayload.crawlSummary
      );
    } else {
      await updateSourceIntakeSessionCrawlSummary(db, intakeSessionId, {
        ...priorCrawlSummary,
        total_discovered_sources: Number(existingSourceSummary.total_discovered_sources || 0),
        total_included_sources: totalIncludedSources,
        total_skipped_sources: Number(existingSourceSummary.total_skipped_sources || 0),
        total_failed_sources: Number(existingSourceSummary.total_failed_sources || 0),
        included_source_item_ids: includedSourceItemIds,
        stage_status: "discovery_completed"
      }, rawSourceStageStatus);
      await updateSourceIntakeSessionPersistenceCheckpoint(db, intakeSessionId, {
        total_discovered_sources: Number(existingSourceSummary.total_discovered_sources || 0),
        total_persisted_sources: totalPersistedSources,
        completed_source_item_ids: Array.isArray(existingSourceSummary.completed_ids_json) ? existingSourceSummary.completed_ids_json : [],
        remaining_source_item_ids: Array.isArray(existingSourceSummary.remaining_ids_json) ? existingSourceSummary.remaining_ids_json : [],
        last_committed_batch: resumableState?.persistence_checkpoint_json?.last_committed_batch || null,
        last_committed_batch_index: Number(resumableState?.persistence_checkpoint_json?.last_committed_batch_index || 0),
        total_batches: Number(resumableState?.persistence_checkpoint_json?.total_batches || 0),
        stage_status: totalIncludedSources > 0 && totalPersistedSources >= totalIncludedSources ? "raw_source_persisted" : "raw_source_persisting"
      }, rawSourceStageStatus);
    }

    const rawSources = await persistRawBuildSourcesFromDb(db, rawBuildInfo, intakeSessionId);
    const classificationSummary = await refreshPersistedSourceClassification(db, rawBuildInfo, intakeSessionId);
    logBuildProgress("raw_source_stage_ready", {
      buildId,
      sourceRefCount: rawSources.counts.sourceRefs,
      sourceSegmentCount: rawSources.counts.sourceSegments,
      sourceChunkCount: rawSources.counts.sourceChunks,
      materiallyReclassifiedCount: Number(classificationSummary.materially_reclassified_count || 0)
    });
    const compiled = await compileKnowledgeBuildArtifacts({
      db,
      buildInfo: rawBuildInfo
    });

    const nextStatus = await withTransaction(db, async (client) => {
      const { counts, compilerWarnings } = await insertCompiledArtifacts(
        client,
        rawBuildInfo,
        rawSources.counts,
        compiled
      );

      await client.query(
        `UPDATE source_intake_sessions
         SET status = 'completed',
             warnings_json = $2::jsonb,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE source_intake_session_id = $1`,
        [intakeSessionId, JSON.stringify(uniqueValues([...extraWarnings, ...compilerWarnings]))]
      );

      const validationSummary = await validateBuildBudgetsAndLatency(client, tenantKey, buildId);
      return updateBuildAfterValidation(
        client,
        buildId,
        counts,
        validationSummary,
        uniqueValues([...extraWarnings, ...compilerWarnings])
      );
    });

    const buildRes = await db.query(
      `SELECT *
       FROM knowledge_builds
       WHERE build_id = $1
       LIMIT 1`,
      [buildId]
    );
    return {
      build: buildRes.rows[0] || null,
      status: nextStatus,
      resumed: Boolean(resumableState)
    };
  } catch (err) {
    const failureMessages = extractKnowledgeBuildFailureMessages(err);
    await db.query(
      `UPDATE knowledge_builds
       SET status = 'failed',
           warnings_json = $2::jsonb,
           updated_at = NOW()
       WHERE build_id = $1`,
      [buildId, JSON.stringify(failureMessages)]
    );
    await db.query(
      `UPDATE source_intake_sessions
       SET status = 'failed',
           errors_json = $2::jsonb,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE source_intake_session_id = $1`,
      [intakeSessionId, JSON.stringify(failureMessages)]
    );
    throw err;
  }
}

export async function createWebsiteKnowledgeBuild(db, tenantKey, input = {}) {
  return createKnowledgeBuild(db, tenantKey, input);
}

export async function publishKnowledgeBuild(db, tenantKey, buildId) {
  await assertSliceTablesReady(db);
  const result = await withTransaction(db, async (client) => {
    const buildRes = await client.query(
      `SELECT build_id, status
       FROM knowledge_builds
       WHERE tenant_key = $1
         AND build_id = $2
       FOR UPDATE`,
      [tenantKey, buildId]
    );
    if (!buildRes.rowCount) {
      throw new Error("build_not_found");
    }
    const status = normalizeText(buildRes.rows[0]?.status);
    if (status !== "ready_to_publish") {
      throw new Error("build_not_ready_to_publish");
    }

    const pointerRes = await client.query(
      `SELECT active_build_id, previous_build_id
       FROM tenant_active_knowledge_builds
       WHERE tenant_key = $1
       FOR UPDATE`,
      [tenantKey]
    );
    const currentActiveBuildId = normalizeText(pointerRes.rows[0]?.active_build_id) || null;
    const prewarmedAssets = await loadBuildAssetsFromDb(client, tenantKey, buildId);

    await client.query(
      `INSERT INTO tenant_active_knowledge_builds (tenant_key, active_build_id, previous_build_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_key)
       DO UPDATE SET active_build_id = EXCLUDED.active_build_id,
                     previous_build_id = EXCLUDED.previous_build_id,
                     updated_at = NOW()`,
      [tenantKey, buildId, currentActiveBuildId]
    );

    await client.query(
      `UPDATE knowledge_builds
       SET status = 'published',
           published_at = NOW(),
           supersedes_build_id = $2,
           updated_at = NOW()
       WHERE build_id = $1`,
      [buildId, currentActiveBuildId]
    );

    await ensureTenantPromptProfileCompanyDescriptionSnapshot(client, tenantKey, {
      buildId,
      actor: "system:publish_build"
    });

    if (currentActiveBuildId && currentActiveBuildId !== buildId) {
      await client.query(
        `UPDATE knowledge_builds
         SET status = 'superseded',
             updated_at = NOW()
         WHERE build_id = $1`,
        [currentActiveBuildId]
      );
      invalidateBuildAssetCache(tenantKey, currentActiveBuildId);
    }

    return { ok: true, active_build_id: buildId, previous_build_id: currentActiveBuildId, prewarmedAssets };
  });
  setBuildAssetCache(tenantKey, buildId, result.prewarmedAssets);
  return { ok: result.ok, active_build_id: result.active_build_id, previous_build_id: result.previous_build_id, cache_prewarmed: true };
}

export async function rollbackKnowledgeBuild(db, tenantKey, buildId) {
  await assertSliceTablesReady(db);
  const result = await withTransaction(db, async (client) => {
    const targetRes = await client.query(
      `SELECT build_id, status
       FROM knowledge_builds
       WHERE tenant_key = $1
         AND build_id = $2
       FOR UPDATE`,
      [tenantKey, buildId]
    );
    if (!targetRes.rowCount) {
      throw new Error("build_not_found");
    }

    const pointerRes = await client.query(
      `SELECT active_build_id
       FROM tenant_active_knowledge_builds
       WHERE tenant_key = $1
       FOR UPDATE`,
      [tenantKey]
    );
    const currentActiveBuildId = normalizeText(pointerRes.rows[0]?.active_build_id);
    if (!currentActiveBuildId) {
      throw new Error("no_active_build");
    }
    if (currentActiveBuildId === buildId) {
      throw new Error("build_already_active");
    }
    const prewarmedAssets = await loadBuildAssetsFromDb(client, tenantKey, buildId);

    await client.query(
      `UPDATE tenant_active_knowledge_builds
       SET active_build_id = $2,
           previous_build_id = $3,
           updated_at = NOW()
       WHERE tenant_key = $1`,
      [tenantKey, buildId, currentActiveBuildId]
    );

    await client.query(
      `UPDATE knowledge_builds
       SET status = 'published',
           updated_at = NOW()
       WHERE build_id = $1`,
      [buildId]
    );

    await client.query(
      `UPDATE knowledge_builds
       SET status = 'rolled_back',
           updated_at = NOW()
       WHERE build_id = $1`,
      [currentActiveBuildId]
    );

    invalidateBuildAssetCache(tenantKey, buildId);
    invalidateBuildAssetCache(tenantKey, currentActiveBuildId);
    return { ok: true, active_build_id: buildId, previous_build_id: currentActiveBuildId, prewarmedAssets };
  });
  setBuildAssetCache(tenantKey, buildId, result.prewarmedAssets);
  return { ok: result.ok, active_build_id: result.active_build_id, previous_build_id: result.previous_build_id, cache_prewarmed: true };
}

export async function getKnowledgeBuild(db, tenantKey, buildId) {
  await assertSliceTablesReady(db);
  const res = await db.query(
    `SELECT *
     FROM knowledge_builds
     WHERE tenant_key = $1
       AND build_id = $2
     LIMIT 1`,
    [tenantKey, buildId]
  );
  return res.rows[0] || null;
}
