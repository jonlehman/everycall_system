import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { buildSparseEmbedding, rankKnowledgeCards, selectBundleCards as selectSharedBundleCards } from "@everycall/contracts";
import { extractTextFromDocumentBuffer } from "./knowledgeReceptionistFiles.js";
import { loadTenantDomainAssignments, resolveTenantDomainAssignments, syncCanonicalKnowledgePacks } from "./knowledgeReceptionistPacks.js";

const BUILD_RATE_LIMIT_HOURS = 24;
const MAX_WEBSITE_PAGES = 250;
const MAX_WEBSITE_FILES = 25;
const CRAWL_BATCH_SIZE = 4;
const FETCH_TIMEOUT_MS = 8000;
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
const RETRIEVAL_WARM_SOFT_MS = 75;
const RETRIEVAL_WARM_HARD_MS = 250;

const buildAssetCache = new Map();

function envFlagEnabled(name, defaultValue = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
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

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

function classifyPageType(url) {
  const path = String(url.pathname || "/").toLowerCase();
  if (path === "/" || path === "") return "home";
  if (/\/(faq|faqs)\b/.test(path)) return "faq";
  if (/\/(service-area|service-areas|locations?)\b/.test(path)) return "service_area";
  if (/\/(contact|about|team|providers?)\b/.test(path)) return "contact";
  if (/\/(policy|policies|terms|privacy|new-patient|insurance|financing|payment|warranty)\b/.test(path)) return "policy";
  if (/\/blog\b/.test(path)) return "blog_article";
  if (/\/(services?|repair|replacement|installation)\b/.test(path)) return "service_detail";
  return "unknown_mixed";
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
    .filter((line) => line.length >= 24 && !looksLikeBoilerplate(line))
    .slice(0, 80);

  return {
    title,
    headings,
    lines,
    text: lines.join(" ").slice(0, 24000)
  };
}

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "EveryCall Knowledge Build" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWebsitePage(url) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return { ok: false, status: response.status, url, html: "", title: "", headings: [], lines: [], text: "" };
    }
    const html = await response.text();
    const structured = extractStructuredPageContent(html);
    return {
      ok: true,
      status: response.status,
      url,
      html,
      title: structured.title,
      headings: structured.headings,
      lines: structured.lines,
      text: structured.text
    };
  } catch {
    return { ok: false, status: null, url, html: "", title: "", headings: [], lines: [], text: "" };
  }
}

function extractInternalLinks(baseUrl, html) {
  const source = String(html || "");
  const seen = new Set();
  const links = [];
  for (const match of source.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    const normalized = normalizeCrawlUrl(baseUrl, match[1]);
    if (!normalized || seen.has(normalized)) continue;
    const url = new URL(normalized);
    if (shouldSkipUrl(url)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

function extractDownloadableLinks(baseUrl, html) {
  const source = String(html || "");
  const seen = new Set();
  const links = [];
  for (const match of source.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    const normalized = normalizeCrawlUrl(baseUrl, match[1]);
    if (!normalized || seen.has(normalized)) continue;
    const url = new URL(normalized);
    if (!isDownloadableUrl(url)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

async function fetchWebsiteDownloadable(url) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url,
        mimeType: "",
        sourceKind: "text",
        title: "",
        lines: [],
        text: ""
      };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = extractTextFromDocumentBuffer({
      buffer,
      mimeType: response.headers.get("content-type") || "",
      filename: new URL(url).pathname.split("/").filter(Boolean).slice(-1)[0] || "",
      locator: url
    });
    const title = new URL(url).pathname.split("/").filter(Boolean).slice(-1)[0] || url;
    return {
      ok: true,
      status: response.status,
      url,
      mimeType: parsed.mimeType,
      sourceKind: parsed.sourceKind,
      title,
      lines: splitPlainTextToLines(parsed.bodyText),
      text: parsed.bodyText,
      parseMethod: parsed.parseMethod
    };
  } catch {
    return {
      ok: false,
      status: null,
      url,
      mimeType: "",
      sourceKind: "text",
      title: "",
      lines: [],
      text: ""
    };
  }
}

async function crawlWebsiteSources(rootUrl) {
  const normalizedRootUrl = normalizeWebsiteUrl(rootUrl);
  if (!normalizedRootUrl) {
    throw new Error("website_url_required");
  }

  const firstPage = await fetchWebsitePage(normalizedRootUrl);
  if (!firstPage.ok) {
    throw new Error("website_fetch_failed");
  }

  const pages = [firstPage];
  const visited = new Set([firstPage.url]);
  const queue = extractInternalLinks(normalizedRootUrl, firstPage.html).slice(0, MAX_WEBSITE_PAGES * 2);
  const downloadableQueue = extractDownloadableLinks(normalizedRootUrl, firstPage.html).slice(0, MAX_WEBSITE_FILES * 2);
  const downloadableSeen = new Set(downloadableQueue);

  while (queue.length && pages.length < MAX_WEBSITE_PAGES) {
    const batch = queue.splice(0, CRAWL_BATCH_SIZE);
    const results = await Promise.all(batch.map((url) => fetchWebsitePage(url)));
    for (const result of results) {
      if (!result.ok || visited.has(result.url) || !result.text) continue;
      visited.add(result.url);
      pages.push(result);
      for (const url of extractInternalLinks(normalizedRootUrl, result.html)) {
        if (visited.has(url) || queue.includes(url)) continue;
        queue.push(url);
      }
      for (const url of extractDownloadableLinks(normalizedRootUrl, result.html)) {
        if (downloadableSeen.has(url)) continue;
        downloadableSeen.add(url);
        downloadableQueue.push(url);
      }
      if (pages.length >= MAX_WEBSITE_PAGES) break;
    }
  }

  const files = [];
  while (downloadableQueue.length && files.length < MAX_WEBSITE_FILES) {
    const batch = downloadableQueue.splice(0, CRAWL_BATCH_SIZE);
    const results = await Promise.all(batch.map((url) => fetchWebsiteDownloadable(url)));
    for (const result of results) {
      if (!result.ok || !normalizeText(result.text)) continue;
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
  }

  return {
    pages: pages.map((page) => ({
      sourceUrl: page.url,
      title: page.title || new URL(page.url).hostname,
      headings: page.headings,
      lines: page.lines,
      text: page.text,
      pageType: classifyPageType(new URL(page.url))
    })),
    files
  };
}

function inferObjectType(pageType) {
  if (pageType === "hours") return "hours";
  if (pageType === "service_detail") return "offering";
  if (pageType === "service_area") return "service_area";
  if (pageType === "policy") return "policy";
  if (pageType === "contact") return "contact_channel";
  if (pageType === "process") return "process";
  return "faq";
}

function inferCardType(pageType) {
  if (pageType === "hours") return "policy";
  if (pageType === "service_detail") return "service";
  if (pageType === "service_area") return "coverage";
  if (pageType === "policy") return "policy";
  if (pageType === "contact") return "process";
  return "general";
}

function splitPlainTextToLines(text, limit = 60) {
  return String(text || "")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map(cleanLineText)
    .filter((line) => line.length >= 24 && !looksLikeBoilerplate(line))
    .slice(0, limit);
}

function classifyTextPageType(title, text, fallback = "unknown_mixed") {
  const lower = `${normalizeText(title)} ${normalizeText(text)}`.toLowerCase();
  if (/\b(hours|open|monday|tuesday|24\/7|after hours|weekend)\b/.test(lower)) return "hours";
  if (/\b(service area|locations?|serves|serving|coverage area|cities)\b/.test(lower)) return "service_area";
  if (/\b(policy|pricing|estimate|financing|insurance|warranty|guarantee|after hours)\b/.test(lower)) return "policy";
  if (/\b(contact|call|phone|email|office|location)\b/.test(lower)) return "contact";
  if (/\b(process|what to expect|next step|appointment|callback|booking|schedule)\b/.test(lower)) return "process";
  if (/\b(repair|replacement|installation|service|offering|maintenance)\b/.test(lower)) return "service_detail";
  if (/\b(blog|article|learn|tips|guide|resource)\b/.test(lower)) return "blog_article";
  return fallback;
}

function classifyContentClass({ sourceChannel, sourceAuthority, pageType, documentClass }) {
  if (pageType === "policy" || pageType === "hours" || documentClass === "policy") return "policy_boundary";
  if (pageType === "blog_article") return "educational";
  if (documentClass === "marketing" || sourceAuthority === "uploaded_first_party_marketing") return "marketing";
  if (sourceChannel === "owner_interview" && sourceAuthority === "owner_interview_unconfirmed") return "descriptive";
  if (documentClass === "reference") return "descriptive";
  return "operational_core";
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
  if (contentClass === "descriptive") return 10;
  if (contentClass === "educational") return 3;
  return 0;
}

function normalizeSourceItem(item) {
  const title = normalizeText(item?.title);
  const text = normalizeText(item?.text);
  const pageType = normalizeText(item?.pageType || item?.page_type) || classifyTextPageType(title, text);
  const sourceChannel = normalizeText(item?.sourceChannel || item?.source_channel) || "website_page";
  const sourceAuthority = normalizeText(item?.sourceAuthority || item?.source_authority) || "website_public_page";
  const documentClass = normalizeText(item?.documentClass || item?.document_class) || (
    sourceChannel === "uploaded_document" ? "reference" : "operational"
  );
  const contentClass = normalizeText(item?.contentClass || item?.content_class)
    || classifyContentClass({ sourceChannel, sourceAuthority, pageType, documentClass });
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

  return {
    sourceChannel,
    sourceKind: normalizeText(item?.sourceKind || item?.source_kind) || "text",
    sourceAuthority,
    sourceLocator,
    sourceSessionId: normalizeText(item?.sourceSessionId || item?.source_session_id) || null,
    title: title || locatorAlias || "Knowledge Source",
    headings: Array.isArray(item?.headings) ? item.headings.map((value) => cleanLineText(value)).filter(Boolean) : [],
    lines,
    text: text || lines.join(" "),
    pageType,
    documentClass,
    contentClass,
    compileEnabled: item?.compileEnabled !== false,
    metadata: item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {},
    sourcePriority: sourceAuthorityPriority(sourceAuthority),
    contentPriority: contentClassPriority(contentClass)
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

function buildFactsForSourceItem({ buildId, tenantKey, domainId, subdomainId, sourceRefId, sourceItem }) {
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

function buildCardForSourceItem({ buildId, tenantKey, domainId, subdomainId, sourceRefId, sourceItem, facts }) {
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

  return {
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
  };
}

function hybridSearchBuildAssets(assets, query, { callState = null, maxResults = 6 } = {}) {
  const ranking = rankKnowledgeCards(assets.cards, query, { callState, maxResults });
  return {
    results: ranking.results,
    telemetry: ranking.telemetry
  };
}

function buildRuntimeBundleFromSearch(cards, query, buildInfo, options = {}) {
  const runtimeEntryMode = normalizeText(options.runtimeEntryMode) || "customer_call";
  const selectedCards = selectSharedBundleCards(cards, query).map((card) => ({
    knowledge_card_id: card.knowledge_card_id,
    canonical_name: card.canonical_name,
    speakable_summary: card.speakable_summary,
    aliases: Array.isArray(card.aliases_json) ? card.aliases_json : [],
    caller_phrases: Array.isArray(card.caller_phrases_json) ? card.caller_phrases_json : [],
    selected_facts: Array.isArray(card.answer_facts_json) ? card.answer_facts_json.slice(0, card === cards[0] ? 2 : 1) : []
  }));
  const factSeen = new Set();
  const selectedFacts = selectedCards
    .flatMap((card) => card.selected_facts)
    .filter((fact) => {
      const factId = normalizeText(fact.fact_id);
      if (!factId || factSeen.has(factId)) return false;
      factSeen.add(factId);
      return true;
    })
    .slice(0, 6);

  return {
    runtime_bundle_id: createId("rb"),
    call_id: "validation_call",
    turn_id: createId("turn"),
    tenant_id: buildInfo.tenant_key,
    build_id: buildInfo.build_id,
    runtime_entry_mode: runtimeEntryMode,
    runtime_mode: selectedCards.length ? "answer" : "clarify",
    active_domain_id: buildInfo.primaryDomainId,
    active_subdomain_id: buildInfo.primarySubdomainId,
    detected_turn_intent: query,
    selected_cards: selectedCards,
    selected_answer_facts: selectedFacts,
    missing_critical_slots: [],
    state_delta: {},
    response_rules: [
      "Answer only from the bundle.",
      "Do not invent pricing, availability, or policy.",
      "Ask one clarifying question at most if needed."
    ],
    confidence_score: selectedCards.length ? 0.7 : 0.2
  };
}

function buildPromptPayloadSample(runtimeBundle) {
  const selectedCards = Array.isArray(runtimeBundle.selected_cards) ? runtimeBundle.selected_cards : [];
  return {
    runtime_entry_mode: runtimeBundle.runtime_entry_mode,
    runtime_mode: runtimeBundle.runtime_mode,
    build_id: runtimeBundle.build_id,
    universal_role_contract: [
      "You are the business receptionist and soft-sales assistant.",
      "Use only approved business truth for this turn.",
      "Do not invent pricing, availability, guarantees, or policy."
    ],
    intent_summary: {
      intent_id: "validation_intent",
      intent_type: runtimeBundle.runtime_entry_mode === "setup_interview" ? "setup_interview_intent" : "business_call_intent",
      primary_goal: "Welcome the caller, answer briefly from approved facts, and advance the correct next step.",
      summary: "Welcome callers, answer direct questions briefly, and advance to the next step when supported.",
      disclosure_strategy: { mode: "reactive_if_asked" },
      handoff_strategy: { when_uncertain: "capture_and_callback" },
      after_hours_strategy: { default: "capture_and_queue" },
      stage_ids: ["opening", "discover_need", "answer_or_route", "advance_next_step", "confirm_and_close"]
    },
    active_domain: {
      domain_id: runtimeBundle.active_domain_id,
      subdomain_id: runtimeBundle.active_subdomain_id
    },
    pack_context: {
      domain_id: runtimeBundle.active_domain_id,
      subdomain_id: runtimeBundle.active_subdomain_id,
      domain_name: "Service Business",
      subdomain_name: "Plumbing",
      pack_version: "v1",
      prompt_fragments: ["Answer briefly and move toward the next safe step."],
      stage_guidance: ["In answer_or_route, answer directly from the runtime bundle."]
    },
    tenant_configuration: {
      matched_overrides: [],
      matched_guardrails: []
    },
    runtime_bundle: runtimeBundle,
    call_state: {
      call_id: runtimeBundle.call_id,
      tenant_id: runtimeBundle.tenant_id,
      runtime_entry_mode: runtimeBundle.runtime_entry_mode,
      current_stage: "answer_or_route",
      completed_stages: ["opening", "discover_need"],
      skipped_stages: [],
      active_domain_id: runtimeBundle.active_domain_id,
      active_subdomain_id: runtimeBundle.active_subdomain_id,
      active_service: null,
      active_location: null,
      active_provider: null,
      pending_clarifier: null,
      last_turn_intent: runtimeBundle.detected_turn_intent,
      last_bundle_id: runtimeBundle.runtime_bundle_id,
      captured_fields: {},
      outcome_in_progress: null,
      uncertainty_mode: null
    },
    response_restrictions: runtimeBundle.response_rules,
    retrieval_telemetry: {
      query: runtimeBundle.detected_turn_intent || "validation query",
      duration_ms: 0.5,
      candidate_count: selectedCards.length,
      selected_card_count: selectedCards.length,
      lexical_weight: 1.6,
      vector_weight: 0.45,
      precedence_weight: 0.08,
      top_scores: selectedCards.map((card, index) => ({
        knowledge_card_id: card.knowledge_card_id,
        lexical_score: 12 - index,
        vector_score: 5 - index,
        precedence_score: 18 - index,
        continuity_score: 4 - index,
        final_score: 32 - index
      }))
    }
  };
}

async function assertSliceTablesReady(db) {
  const res = await db.query(`SELECT to_regclass('knowledge_builds') AS table_name`);
  if (!normalizeText(res.rows[0]?.table_name)) {
    throw new Error("knowledge_receptionist_migrations_not_applied");
  }
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
  // Dev/test deployments can bypass the once-per-24-hour build gate by setting
  // KNOWLEDGE_RECEPTIONIST_DISABLE_BUILD_RATE_LIMIT=true in the environment.
  if (envFlagEnabled("KNOWLEDGE_RECEPTIONIST_DISABLE_BUILD_RATE_LIMIT")) {
    return;
  }

  const res = await db.query(
    `SELECT created_at
     FROM knowledge_builds
     WHERE tenant_key = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantKey]
  );
  const createdAt = res.rows[0]?.created_at ? new Date(res.rows[0].created_at) : null;
  if (!createdAt) return;
  const elapsedMs = Date.now() - createdAt.getTime();
  if (elapsedMs < BUILD_RATE_LIMIT_HOURS * 60 * 60 * 1000) {
    throw new Error("build_rate_limited");
  }
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
  return res.rows.map((row) => normalizeSourceItem({
    sourceChannel: "uploaded_document",
    sourceKind: /\.pdf$/i.test(normalizeText(row.filename || row.mime_type)) ? "pdf" : "text",
    sourceAuthority: row.source_authority,
    sourceLocator: `uploaded-document:${row.uploaded_document_id}`,
    title: row.title,
    text: row.body_text,
    pageType: classifyTextPageType(row.title, row.body_text, row.document_class === "policy" ? "policy" : "unknown_mixed"),
    documentClass: row.document_class,
    contentClass: classifyContentClass({
      sourceChannel: "uploaded_document",
      sourceAuthority: row.source_authority,
      pageType: classifyTextPageType(row.title, row.body_text, "unknown_mixed"),
      documentClass: row.document_class
    }),
    metadata: {
      uploaded_document_id: row.uploaded_document_id,
      filename: row.filename,
      mime_type: row.mime_type,
      status: row.status
    }
  }));
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

function buildWebsiteSourceItems(websiteSources) {
  const pages = Array.isArray(websiteSources?.pages) ? websiteSources.pages : [];
  const files = Array.isArray(websiteSources?.files) ? websiteSources.files : [];
  const pageItems = pages.map((page) => normalizeSourceItem({
    sourceChannel: "website_page",
    sourceKind: "html",
    sourceAuthority: "website_public_page",
    sourceLocator: page.sourceUrl,
    title: page.title || page.sourceUrl,
    headings: page.headings,
    lines: page.lines,
    text: page.text,
    pageType: page.pageType,
    contentClass: classifyContentClass({
      sourceChannel: "website_page",
      sourceAuthority: "website_public_page",
      pageType: page.pageType,
      documentClass: "operational"
    }),
    metadata: { headings: page.headings || [] }
  }));
  const fileItems = files.map((file) => normalizeSourceItem({
    sourceChannel: "website_file",
    sourceKind: normalizeText(file.sourceKind) || "text",
    sourceAuthority: "website_public_downloadable",
    sourceLocator: file.sourceUrl,
    title: file.title || file.sourceUrl,
    lines: file.lines,
    text: file.text,
    pageType: file.pageType,
    contentClass: classifyContentClass({
      sourceChannel: "website_file",
      sourceAuthority: "website_public_downloadable",
      pageType: file.pageType,
      documentClass: "policy"
    }),
    metadata: {
      mime_type: file.mimeType || null,
      parse_method: file.parseMethod || null
    }
  }));
  return [...pageItems, ...fileItems];
}

async function collectBuildSourceItems(db, tenantKey, input = {}, websiteUrl = "") {
  const websiteSources = websiteUrl ? buildWebsiteSourceItems(await crawlWebsiteSources(websiteUrl)) : [];
  const [uploadedDocumentSources, setupInterviewSources] = await Promise.all([
    loadUploadedDocumentSourceItems(db, tenantKey, input.uploadedDocumentIds || input.uploaded_document_ids || []),
    loadSetupInterviewSourceItems(db, tenantKey, input.setupInterviewSessionIds || input.setup_interview_session_ids || [])
  ]);
  return [...websiteSources, ...uploadedDocumentSources, ...setupInterviewSources];
}

async function insertBuildArtifacts(db, buildInfo, sourceIntakeSessionId, sourceItems) {
  const sourceCounts = { sourceRefs: 0, sourceSegments: 0, cards: 0, facts: 0 };

  for (const rawItem of sourceItems) {
    const sourceItem = normalizeSourceItem(rawItem);
    const sourceRefId = createId("sr");
    await db.query(
      `INSERT INTO source_refs (
         source_ref_id, tenant_key, build_id, source_intake_session_id, source_channel, source_kind,
         source_authority, source_locator, title, page_type, content_hash, metadata_json
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
       )`,
      [
        sourceRefId,
        buildInfo.tenant_key,
        buildInfo.build_id,
        sourceIntakeSessionId,
        sourceItem.sourceChannel,
        sourceItem.sourceKind,
        sourceItem.sourceAuthority,
        sourceItem.sourceLocator,
        sourceItem.title || null,
        sourceItem.pageType,
        stableHash(sourceItem.text),
        JSON.stringify({
          headings: sourceItem.headings || [],
          content_class: sourceItem.contentClass,
          document_class: sourceItem.documentClass,
          compile_enabled: sourceItem.compileEnabled,
          source_session_id: sourceItem.sourceSessionId,
          ...sourceItem.metadata
        })
      ]
    );
    sourceCounts.sourceRefs += 1;

    for (let index = 0; index < sourceItem.lines.length; index += 1) {
      const line = sourceItem.lines[index];
      await db.query(
        `INSERT INTO source_segments (
           tenant_key, build_id, source_ref_id, heading_path, segment_index, text_span, content_hash, metadata_json
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          buildInfo.tenant_key,
          buildInfo.build_id,
          sourceRefId,
          (sourceItem.headings || []).join(" > ") || null,
          index,
          line,
          stableHash(line),
          JSON.stringify({
            title: sourceItem.title || null,
            source_locator: sourceItem.sourceLocator,
            source_channel: sourceItem.sourceChannel
          })
        ]
      );
      sourceCounts.sourceSegments += 1;
    }

    if (!sourceItem.compileEnabled) {
      continue;
    }

    const facts = buildFactsForSourceItem({
      buildId: buildInfo.build_id,
      tenantKey: buildInfo.tenant_key,
      domainId: buildInfo.primaryDomainId,
      subdomainId: buildInfo.primarySubdomainId,
      sourceRefId,
      sourceItem
    });

    for (const fact of facts) {
      await db.query(
        `INSERT INTO knowledge_build_facts (
           knowledge_fact_id, tenant_key, build_id, domain_id, subdomain_id, fact_type, object_type, subject,
           predicate, object_text, normalized_value_json, confidence, source_ref_ids_json, scope_json,
           content_class, risk_level, claim_text, evidence_text
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14::jsonb, $15, $16, $17, $18
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
          JSON.stringify(fact.source_ref_ids_json),
          JSON.stringify(fact.scope_json),
          fact.content_class,
          fact.risk_level,
          fact.claim_text,
          fact.evidence_text
        ]
      );
      sourceCounts.facts += 1;
    }

    const card = buildCardForSourceItem({
      buildId: buildInfo.build_id,
      tenantKey: buildInfo.tenant_key,
      domainId: buildInfo.primaryDomainId,
      subdomainId: buildInfo.primarySubdomainId,
      sourceRefId,
      sourceItem,
      facts
    });

    await db.query(
      `INSERT INTO knowledge_build_cards (
         knowledge_card_id, tenant_key, build_id, domain_id, subdomain_id, card_type, object_type, canonical_name,
         topic_path, intent_tags_json, entity_tags_json, aliases_json, caller_phrases_json, scope_json,
         speakable_summary, answer_facts_json, related_card_ids_json, source_ref_ids_json, content_class,
         allowed_uses_json, risk_level, quality_score, search_text
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
         $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20::jsonb, $21, $22, $23
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
        JSON.stringify(card.intent_tags_json),
        JSON.stringify(card.entity_tags_json),
        JSON.stringify(card.aliases_json),
        JSON.stringify(card.caller_phrases_json),
        JSON.stringify(card.scope_json),
        card.speakable_summary,
        JSON.stringify(card.answer_facts_json),
        JSON.stringify(card.related_card_ids_json),
        JSON.stringify(card.source_ref_ids_json),
        card.content_class,
        JSON.stringify(card.allowed_uses_json),
        card.risk_level,
        card.quality_score,
        card.search_text
      ]
    );
    sourceCounts.cards += 1;

    await db.query(
      `INSERT INTO knowledge_build_embeddings (
         build_id, knowledge_card_id, embedding_model, embedding_json
       )
       VALUES ($1, $2, 'deterministic_sparse_v1', $3::jsonb)
       ON CONFLICT (knowledge_card_id, embedding_model)
       DO UPDATE SET embedding_json = EXCLUDED.embedding_json`,
      [buildInfo.build_id, card.knowledge_card_id, JSON.stringify(buildSparseEmbedding(card.search_text))]
    );
  }

  return sourceCounts;
}

async function loadBuildAssetsFromDb(db, tenantKey, buildId) {
  const [buildRes, cardRes, embeddingRes] = await Promise.all([
    db.query(
      `SELECT build_id, tenant_key, status, version, domain_assignments_json, validation_summary_json, source_channels_json
       FROM knowledge_builds
       WHERE tenant_key = $1
         AND build_id = $2
       LIMIT 1`,
      [tenantKey, buildId]
    ),
    db.query(
      `SELECT knowledge_card_id, canonical_name, aliases_json, caller_phrases_json, speakable_summary,
              answer_facts_json, quality_score, search_text, domain_id, subdomain_id, content_class, scope_json,
              topic_path, card_type, object_type, intent_tags_json, entity_tags_json
       FROM knowledge_build_cards
       WHERE tenant_key = $1
         AND build_id = $2
       ORDER BY quality_score DESC, created_at DESC`,
      [tenantKey, buildId]
    ),
    db.query(
      `SELECT knowledge_card_id, embedding_json
       FROM knowledge_build_embeddings
       WHERE build_id = $1`,
      [buildId]
    )
  ]);

  if (!buildRes.rowCount) {
    throw new Error("build_not_found");
  }

  const buildRow = buildRes.rows[0];
  const assignments = Array.isArray(buildRow.domain_assignments_json) ? buildRow.domain_assignments_json : [];
  const embeddingByCardId = new Map(
    (embeddingRes.rows || []).map((row) => [normalizeText(row.knowledge_card_id), row.embedding_json && typeof row.embedding_json === "object" ? row.embedding_json : {}])
  );
  return {
    build_id: buildRow.build_id,
    tenant_key: buildRow.tenant_key,
    status: buildRow.status,
    assignments,
    source_channels_json: Array.isArray(buildRow.source_channels_json) ? buildRow.source_channels_json : [],
    primaryDomainId: normalizeText(assignments[0]?.domain_id || cardRes.rows[0]?.domain_id),
    primarySubdomainId: normalizeText(assignments[0]?.subdomain_id || cardRes.rows[0]?.subdomain_id) || null,
    cards: (cardRes.rows || []).map((row) => ({
      ...row,
      aliases_json: Array.isArray(row.aliases_json) ? row.aliases_json : [],
      caller_phrases_json: Array.isArray(row.caller_phrases_json) ? row.caller_phrases_json : [],
      answer_facts_json: Array.isArray(row.answer_facts_json) ? row.answer_facts_json : [],
      intent_tags_json: Array.isArray(row.intent_tags_json) ? row.intent_tags_json : [],
      entity_tags_json: Array.isArray(row.entity_tags_json) ? row.entity_tags_json : [],
      scope_json: row.scope_json && typeof row.scope_json === "object" && !Array.isArray(row.scope_json) ? row.scope_json : {},
      embedding_json: embeddingByCardId.get(normalizeText(row.knowledge_card_id)) || {}
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

  const sampleQueries = uniqueValues(
    assets.cards.flatMap((card) => [card.canonical_name, ...(card.aliases_json || [])])
  ).slice(0, 5);

  const retrievalDurations = [];
  const runtimeBundles = [];
  const retrievalTelemetry = [];
  for (const query of sampleQueries) {
    const started = performance.now();
    const retrieval = hybridSearchBuildAssets(assets, query);
    const durationMs = Number((performance.now() - started).toFixed(3));
    retrievalDurations.push(durationMs);
    retrievalTelemetry.push({
      ...retrieval.telemetry,
      duration_ms: durationMs
    });
    runtimeBundles.push(buildRuntimeBundleFromSearch(retrieval.results, query, assets));
  }

  const largestRuntimeBundleTokens = runtimeBundles.length
    ? Math.max(...runtimeBundles.map((bundle) => estimateTokenCount(bundle)))
    : 0;
  const largestPromptPayloadTokens = runtimeBundles.length
    ? Math.max(...runtimeBundles.map((bundle) => estimateTokenCount(buildPromptPayloadSample(bundle))))
    : 0;
  const retrievalMaxMs = retrievalDurations.length ? Math.max(...retrievalDurations) : 0;

  const warnings = [];
  const blockers = [];

  if (!assets.cards.length) {
    blockers.push("no_runtime_cards_compiled");
  }

  if (largestRuntimeBundleTokens > RUNTIME_BUNDLE_HARD_TOKEN_BUDGET) {
    blockers.push("runtime_bundle_hard_budget_exceeded");
  } else if (largestRuntimeBundleTokens > RUNTIME_BUNDLE_SOFT_TOKEN_BUDGET) {
    warnings.push("runtime_bundle_soft_budget_exceeded");
  }

  if (largestPromptPayloadTokens > PROMPT_PAYLOAD_HARD_TOKEN_BUDGET) {
    blockers.push("prompt_payload_hard_budget_exceeded");
  } else if (largestPromptPayloadTokens > PROMPT_PAYLOAD_SOFT_TOKEN_BUDGET) {
    warnings.push("prompt_payload_soft_budget_exceeded");
  }

  // Cache-first policy for this slice:
  // 1. Warm/hot-path fetch remains the hard runtime gate.
  // 2. Cold fetch is treated as a prewarm cost diagnostic only.
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

  if (retrievalMaxMs > RETRIEVAL_WARM_HARD_MS) {
    blockers.push("retrieval_latency_hard_limit_exceeded");
  } else if (retrievalMaxMs > RETRIEVAL_WARM_SOFT_MS) {
    warnings.push("retrieval_latency_soft_limit_exceeded");
  }

  return {
    sample_query_count: sampleQueries.length,
    runtime_bundle: {
      soft_budget_tokens: RUNTIME_BUNDLE_SOFT_TOKEN_BUDGET,
      hard_budget_tokens: RUNTIME_BUNDLE_HARD_TOKEN_BUDGET,
      largest_bundle_tokens: largestRuntimeBundleTokens
    },
    prompt_payload: {
      soft_budget_tokens: PROMPT_PAYLOAD_SOFT_TOKEN_BUDGET,
      hard_budget_tokens: PROMPT_PAYLOAD_HARD_TOKEN_BUDGET,
      largest_payload_tokens: largestPromptPayloadTokens
    },
    active_build_fetch_cost: {
      gate_policy: "warm_hot_path_hard_gate__cold_prewarm_warn_only",
      cold_fetch_ms: coldFetch.fetchMs,
      warm_fetch_ms: warmFetch.fetchMs,
      warm_cache_hit: warmFetch.cacheHit
    },
    retrieval_latency: {
      sample_count: retrievalDurations.length,
      max_ms: retrievalMaxMs,
      durations_ms: retrievalDurations
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
    card_count: assets.cards.length
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
  const retrieval = hybridSearchBuildAssets(assetLoad.assets, queryText, {
    callState: options.callState || options.call_state || null
  });
  const durationMs = Number((performance.now() - started).toFixed(3));
  const runtimeBundle = buildRuntimeBundleFromSearch(retrieval.results, queryText, assetLoad.assets, {
    runtimeEntryMode: options.runtimeEntryMode || options.runtime_entry_mode
  });
  return {
    runtimeBundle,
    retrievalTelemetry: {
      ...retrieval.telemetry,
      duration_ms: durationMs
    },
    cacheHit: assetLoad.cacheHit,
    fetchMs: assetLoad.fetchMs
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

export async function listKnowledgeReceptionistBuilds(db, tenantKey) {
  await assertSliceTablesReady(db);
  const [buildsRes, pointerRes, assignments] = await Promise.all([
    db.query(
      `SELECT build_id, status, version, domain_assignments_json, source_channels_json, artifact_counts_json,
              quality_summary_json, warnings_json, validation_summary_json, published_at, supersedes_build_id,
              created_at, updated_at
       FROM knowledge_builds
       WHERE tenant_key = $1
       ORDER BY created_at DESC`,
      [tenantKey]
    ),
    db.query(
      `SELECT active_build_id, previous_build_id, updated_at
       FROM tenant_active_knowledge_builds
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    ),
    loadTenantDomainAssignments(db, tenantKey)
  ]);

  return {
    activeBuild: pointerRes.rows[0] || null,
    assignments,
    builds: buildsRes.rows || []
  };
}

function normalizeIdArray(value) {
  return uniqueValues(Array.isArray(value) ? value : []);
}

export async function createKnowledgeBuild(db, tenantKey, input = {}) {
  await assertSliceTablesReady(db);
  await syncCanonicalKnowledgePacks(db);
  await assertBuildRateLimit(db, tenantKey);

  let websiteUrl = normalizeWebsiteUrl(input.websiteUrl || input.website_url);
  const uploadedDocumentIds = normalizeIdArray(input.uploadedDocumentIds || input.uploaded_document_ids);
  const setupInterviewSessionIds = normalizeIdArray(input.setupInterviewSessionIds || input.setup_interview_session_ids);
  if (!websiteUrl && !uploadedDocumentIds.length && !setupInterviewSessionIds.length) {
    const intakeRes = await db.query(
      `SELECT website
       FROM onboarding_intake
       WHERE tenant_key = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantKey]
    );
    websiteUrl = normalizeWebsiteUrl(intakeRes.rows[0]?.website);
  }
  if (!websiteUrl && !uploadedDocumentIds.length && !setupInterviewSessionIds.length) {
    throw new Error("approved_source_required");
  }

  const assignments = await resolveTenantDomainAssignments(db, tenantKey, input.assignments || []);
  if (!assignments.length) {
    throw new Error("domain_assignment_required");
  }

  const buildId = createId("build");
  const version = await nextBuildVersion(db, tenantKey);
  const intakeSessionId = createId("intake");
  const primaryAssignment = assignments[0];
  const extraWarnings = [];
  if (assignments.length > 1) {
    extraWarnings.push("multi_domain_assignment_present_slice_uses_primary_assignment_only");
  }
  const sourceChannels = [];
  if (websiteUrl) sourceChannels.push("website_page", "website_file");
  if (uploadedDocumentIds.length) sourceChannels.push("uploaded_document");
  if (setupInterviewSessionIds.length) sourceChannels.push("owner_interview");
  const runtimeEntryMode = setupInterviewSessionIds.length && !websiteUrl && !uploadedDocumentIds.length
    ? "setup_interview"
    : "customer_call";

  await withTransaction(db, async (client) => {
    await client.query(
      `INSERT INTO knowledge_builds (
         build_id, tenant_key, status, version, domain_assignments_json, source_snapshot_id,
         source_channels_json, artifact_counts_json, quality_summary_json, warnings_json, validation_summary_json,
         created_by_type, created_by_id
       )
       VALUES (
         $1, $2, 'running', $3, $4::jsonb, $5, $6::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
         '{}'::jsonb, 'tenant', NULL
       )`,
      [
        buildId,
        tenantKey,
        version,
        JSON.stringify(assignments.map((item) => ({ domain_id: item.domainId, subdomain_id: item.subdomainId }))),
        intakeSessionId,
        JSON.stringify(sourceChannels)
      ]
    );
    await client.query(
      `INSERT INTO source_intake_sessions (
         source_intake_session_id, tenant_key, build_id, runtime_entry_mode, status, website_root_url,
         source_channels_json, metadata_json, started_at
       )
       VALUES (
         $1, $2, $3, $4, 'running', $5, $6::jsonb, $7::jsonb, NOW()
       )`,
      [
        intakeSessionId,
        tenantKey,
        buildId,
        runtimeEntryMode,
        websiteUrl || null,
        JSON.stringify(sourceChannels),
        JSON.stringify({ uploaded_document_ids: uploadedDocumentIds, setup_interview_session_ids: setupInterviewSessionIds })
      ]
    );
  });

  let sourceItems;
  try {
    sourceItems = await collectBuildSourceItems(db, tenantKey, { uploadedDocumentIds, setupInterviewSessionIds }, websiteUrl);
    if (!sourceItems.length) {
      throw new Error("approved_source_required");
    }
  } catch (err) {
    await db.query(
      `UPDATE knowledge_builds
       SET status = 'failed',
           warnings_json = $2::jsonb,
           updated_at = NOW()
       WHERE build_id = $1`,
      [buildId, JSON.stringify([normalizeText(err?.message || "website_fetch_failed")])]
    );
    await db.query(
      `UPDATE source_intake_sessions
       SET status = 'failed',
           errors_json = $2::jsonb,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE source_intake_session_id = $1`,
      [intakeSessionId, JSON.stringify([normalizeText(err?.message || "website_fetch_failed")])]
    );
    throw err;
  }

  try {
    const nextStatus = await withTransaction(db, async (client) => {
      const counts = await insertBuildArtifacts(
        client,
        {
          build_id: buildId,
          tenant_key: tenantKey,
          primaryDomainId: primaryAssignment.domainId,
          primarySubdomainId: primaryAssignment.subdomainId
        },
        intakeSessionId,
        sourceItems
      );

      await client.query(
        `UPDATE source_intake_sessions
         SET status = 'completed',
             warnings_json = $2::jsonb,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE source_intake_session_id = $1`,
        [intakeSessionId, JSON.stringify(extraWarnings)]
      );

      const validationSummary = await validateBuildBudgetsAndLatency(client, tenantKey, buildId);
      return updateBuildAfterValidation(client, buildId, counts, validationSummary, extraWarnings);
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
      status: nextStatus
    };
  } catch (err) {
    await db.query(
      `UPDATE knowledge_builds
       SET status = 'failed',
           warnings_json = $2::jsonb,
           updated_at = NOW()
       WHERE build_id = $1`,
      [buildId, JSON.stringify([normalizeText(err?.message || "build_failed")])]
    );
    await db.query(
      `UPDATE source_intake_sessions
       SET status = 'failed',
           errors_json = $2::jsonb,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE source_intake_session_id = $1`,
      [intakeSessionId, JSON.stringify([normalizeText(err?.message || "build_failed")])]
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
