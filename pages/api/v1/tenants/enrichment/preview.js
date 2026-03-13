import { ensureTables, getPool } from "../../../_lib/db.js";
import { loadIndustryKnowledgeDefaults } from "../../../_lib/industryKnowledge.js";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "msn.com",
  "live.com"
]);

const STOPWORDS = new Set([
  "what", "when", "where", "which", "with", "from", "your", "this", "that", "have", "does", "offer", "offers",
  "would", "could", "should", "about", "into", "they", "them"
]);

const KNOWLEDGE_SECTION_KEYWORDS = {
  services_and_capabilities: ["service", "services", "repair", "replace", "install", "installation", "maintenance", "drain", "plumbing", "electrical", "hvac", "heating", "cooling", "sewer"],
  emergency_service: ["emergency", "urgent", "24/7", "after hours", "same day", "priority"],
  service_area: ["service area", "areas we serve", "areas served", "serving", "locations", "nearby communities"],
  hours_and_availability: ["hours", "open", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "availability", "24/7"],
  warranties_and_guarantees: ["warranty", "guarantee", "guaranteed", "satisfaction guarantee", "forever warranty"],
  pricing_and_fees: ["estimate", "estimates", "fee", "fees", "pricing", "price", "diagnostic", "service fee"],
  financing_and_payment: ["financing", "payment", "payments", "credit", "cash", "card", "cards"],
  policies_and_process: ["schedule", "scheduling", "appointment", "callback", "arrive", "arrival", "next step", "process", "book online"]
};

const GUARDRAIL_TOPIC_KEYWORDS = {
  warranty: ["warranty", "coverage", "covered", "forever warranty", "lifetime"],
  guarantees: ["guarantee", "guaranteed", "satisfaction guarantee", "make it right"],
  emergency_service: ["emergency", "24/7", "urgent", "after hours"],
  service_area: ["service area", "areas we serve", "serving", "locations"],
  availability: ["hours", "availability", "open", "24/7", "same day", "monday", "friday"],
  financing: ["financing", "payment", "payments", "credit"],
  pricing: ["fee", "fees", "diagnostic", "estimate", "estimates", "pricing", "price"]
};

const MAX_WEBSITE_PAGES = 250;
const WEBSITE_CRAWL_BATCH_SIZE = 12;
const MAX_SITEMAP_URLS = 500;
const CRAWL_TIME_BUDGET_MS = 90000;
const AI_TOPIC_CHUNK_SIZE = 16;
const AI_TOPIC_CONCURRENCY = 6;

const COVERAGE_CHECKLIST_TEMPLATES = [
  { checkKey: "warranty", title: "Warranty", keywords: ["warranty", "coverage", "covered", "guarantee"], guardrailTopics: ["warranty", "guarantees"] },
  { checkKey: "service_area", title: "Service area", keywords: ["service area", "serve", "locations", "coverage area"], guardrailTopics: ["service_area"] },
  { checkKey: "emergency_service", title: "Emergency service", keywords: ["emergency", "urgent", "24/7", "after hours"], guardrailTopics: ["emergency_service"] },
  { checkKey: "availability", title: "Hours and availability", keywords: ["hours", "availability", "open", "weekend", "schedule"], guardrailTopics: ["availability"] },
  { checkKey: "pricing", title: "Pricing and fees", keywords: ["pricing", "price", "fees", "diagnostic", "estimate"], guardrailTopics: ["pricing"] },
  { checkKey: "financing", title: "Financing and payment", keywords: ["financing", "payment plan", "credit", "monthly"], guardrailTopics: ["financing"] },
  { checkKey: "guarantees", title: "Guarantees and promises", keywords: ["guarantee", "satisfaction", "make it right"], guardrailTopics: ["guarantees"] }
];

const GENERIC_PATH_SEGMENTS = new Set([
  "about", "services", "service", "locations", "location", "areas", "area", "resources", "company", "contact", "home", "blog"
]);

const MARKETING_PHRASES = [
  "peace of mind",
  "quality you can count on",
  "trusted by homeowners",
  "full-service with heart",
  "proudly serving",
  "call today",
  "book online",
  "trusted choice",
  "locally owned team",
  "forever covered. forever comfortable"
];

function normalizeText(value) {
  return String(value || "").trim();
}

function truthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWebsite(website) {
  const raw = normalizeText(website);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function domainFromEmail(email) {
  const raw = normalizeText(email).toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 0) return "";
  return raw.slice(at + 1);
}

function domainFromWebsite(website) {
  try {
    const normalized = normalizeWebsite(website);
    if (!normalized) return "";
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function websiteFromEmail(email) {
  const domain = domainFromEmail(email);
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return "";
  return `https://${domain}`;
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

function normalizeLineKey(value) {
  return decodeHtmlEntities(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLineText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .replace(/\s*([|>])+?\s*/g, " ")
    .trim();
}

function extractTagTextList(html, tagName) {
  return Array.from(String(html || "").matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi")))
    .map((match) => cleanLineText(match[1].replace(/<[^>]+>/g, " ")))
    .filter(Boolean);
}

function looksLikeNavOrBoilerplate(sentence) {
  const text = cleanLineText(sentence).toLowerCase();
  if (!text.trim()) return true;
  if (text.includes("privacy policy") || text.includes("terms of service") || text.includes("copyright")) return true;
  if (text.includes("skip to content")) return true;
  if ((text.match(/,/g) || []).length >= 8) return true;
  if (/\b(book online|call us today|choose location|all services|service areas|careers|press releases|blog|faqs|our community|nominate your hero)\b/.test(text)) return true;
  if (text.split(/\s+/).length <= 3 && !/\d/.test(text)) return true;
  if (/(plumbing|electrical|hvac)/.test(text) && (text.match(/\b(plumbing|electrical|hvac)\b/g) || []).length >= 3) return true;
  return false;
}

function extractStructuredPageContent(html) {
  const source = String(html || "");
  const title = cleanLineText(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || source;
  const primary = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || body;
  const withoutNoise = primary
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
    ...extractTagTextList(withoutNoise, "h1"),
    ...extractTagTextList(withoutNoise, "h2"),
    ...extractTagTextList(withoutNoise, "h3")
  ]).slice(0, 10);
  const rawLines = decodeHtmlEntities(
    withoutNoise
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(main|article|section|div|p|ul|ol|li|table|tr|td|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<(main|article|section|div|p|ul|ol|li|table|tr|td|h1|h2|h3|h4|h5|h6)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\n+/)
    .map(cleanLineText)
    .filter((line) =>
      line.length >= 24
      || /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(line)
      || /\b[A-Z]{2}\s+\d{5}\b/.test(line)
      || /\b24\/7\b/i.test(line)
      || (line.length >= 8 && /\b(open|hours|financing|warranty)\b/i.test(line))
    );

  const lines = [];
  const seen = new Set();
  for (const line of rawLines) {
    const key = normalizeLineKey(line);
    if (!key || seen.has(key) || looksLikeNavOrBoilerplate(line)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= 160) break;
  }

  return {
    title,
    headings,
    lines,
    text: lines.join(" ").slice(0, 24000)
  };
}

function textFromHtml(html) {
  return extractStructuredPageContent(html).text;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWebsiteText(url) {
  try {
    const resp = await fetchWithTimeout(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "EveryCall Enrichment Preview" }
    });
    if (!resp.ok) return { ok: false, html: "", text: "", title: "", headings: [], lines: [] };
    const html = await resp.text();
    const structured = extractStructuredPageContent(html);
    return {
      ok: true,
      html,
      text: structured.text,
      title: structured.title,
      headings: structured.headings,
      lines: structured.lines
    };
  } catch {
    return { ok: false, html: "", text: "", title: "", headings: [], lines: [] };
  }
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .slice(0, 700);
}

function keywordsFromText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function cleanEvidenceText(sentence) {
  return decodeHtmlEntities(String(sentence || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function receptionistStyleText(answer) {
  const text = cleanEvidenceText(answer)
    .replace(/\bwe specialize in\b/gi, "We handle")
    .replace(/\bwe proudly offer\b/gi, "We offer")
    .replace(/\bour team\b/gi, "We")
    .replace(/\bcustomers\b/gi, "you")
    .replace(/\bclients\b/gi, "you");

  if (!text) return "";

  return text
    .replace(/\bcontact us today\b/gi, "give us a call")
    .replace(/\blearn more\b/gi, "we can share more details")
    .replace(/\bfor more information\b/gi, "for details")
    .replace(/\bstate-of-the-art\b/gi, "")
    .replace(/\btop-quality\b/gi, "quality")
    .replace(/\bhigh-quality\b/gi, "quality")
    .replace(/\s+/g, " ")
    .trim();
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

function normalizeCrawlUrl(baseOrigin, href) {
  try {
    const resolved = new URL(href, baseOrigin);
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    if (resolved.origin !== new URL(baseOrigin).origin) return null;
    resolved.hash = "";
    resolved.search = "";
    const normalizedPath = resolved.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    return `${resolved.origin}${normalizedPath}` || resolved.origin;
  } catch {
    return null;
  }
}

function shouldSkipCrawlUrl(url) {
  const path = `${url.pathname}`.toLowerCase();
  if (!path) return false;
  if (/\.(jpg|jpeg|png|webp|svg|gif|pdf|xml|zip|mp4|mp3|mov|avi|webm|woff2?|ttf|eot|css|js|json|txt)$/i.test(path)) return true;
  if (/\/(wp-json|cdn-cgi|cart|checkout|account|login)\b/.test(path)) return true;
  return false;
}

function scoreRelevantInternalUrl(url, anchorText = "") {
  if (shouldSkipCrawlUrl(url)) return -1;
  const path = `${url.pathname} ${anchorText}`.toLowerCase();
  let score = 0;

  const depth = url.pathname.split("/").filter(Boolean).length;
  score += Math.max(0, 4 - Math.min(depth, 4));

  for (const keywords of Object.values(KNOWLEDGE_SECTION_KEYWORDS)) {
    score += keywords.filter((keyword) => path.includes(String(keyword).toLowerCase())).length * 2;
  }
  if (/(contact|about|service|area|location|pricing|warranty|guarantee|membership|plan|financing|payment|plumbing|hvac|electrical|home-care|legal|policy|privacy|terms)/.test(path)) {
    score += 4;
  }

  return score;
}

function extractInternalLinks(baseUrl, html) {
  const source = String(html || "");
  if (!source) return [];
  const matches = Array.from(source.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const scored = [];
  const seen = new Set();

  for (const match of matches) {
    const href = normalizeText(match[1]);
    if (!href) continue;
    const normalized = normalizeCrawlUrl(baseUrl, href);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const anchorText = cleanLineText(match[2].replace(/<[^>]+>/g, " "));
    const score = scoreRelevantInternalUrl(new URL(normalized), anchorText);
    if (score < 0) continue;
    scored.push({ url: normalized, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
    .slice(0, MAX_WEBSITE_PAGES * 4);
}

async function fetchSitemapUrls(baseUrl, maxUrls = MAX_SITEMAP_URLS) {
  try {
    const origin = new URL(baseUrl).origin;
    const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
    const seenSitemaps = new Set();
    const collected = [];
    const seenUrls = new Set();

    while (queue.length && seenSitemaps.size < 6 && collected.length < maxUrls) {
      const sitemapUrl = queue.shift();
      if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue;
      seenSitemaps.add(sitemapUrl);
      const resp = await fetchWithTimeout(sitemapUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": "EveryCall Enrichment Preview" }
      }, 7000);
      if (!resp.ok) continue;
      const xml = await resp.text();
      const locs = Array.from(xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi))
        .map((match) => decodeHtmlEntities(match[1]).trim())
        .filter(Boolean);

      for (const loc of locs) {
        try {
          const resolved = new URL(loc);
          if (resolved.origin !== origin) continue;
          const normalized = normalizeCrawlUrl(origin, resolved.toString());
          if (!normalized) continue;
          if (/\.xml$/i.test(resolved.pathname)) {
            if (!seenSitemaps.has(normalized)) queue.push(normalized);
            continue;
          }
          if (seenUrls.has(normalized)) continue;
          seenUrls.add(normalized);
          collected.push(normalized);
          if (collected.length >= maxUrls) break;
        } catch {
          continue;
        }
      }
    }

    return collected;
  } catch {
    return [];
  }
}

function finalizeWebsitePages(rawPages) {
  const pageCountByLine = new Map();
  for (const page of rawPages || []) {
    const lineKeys = new Set((page.lines || []).map((line) => normalizeLineKey(line)).filter(Boolean));
    for (const key of lineKeys) {
      pageCountByLine.set(key, (pageCountByLine.get(key) || 0) + 1);
    }
  }

  const repeatThreshold = Math.max(3, Math.ceil((rawPages || []).length * 0.35));
  return (rawPages || [])
    .map((page) => {
      const filteredLines = (page.lines || []).filter((line) => {
        const key = normalizeLineKey(line);
        if (!key) return false;
        const repeated = (pageCountByLine.get(key) || 0) >= repeatThreshold;
        if (repeated && (line.length < 220 || looksLikeNavOrBoilerplate(line))) return false;
        return !looksLikeNavOrBoilerplate(line);
      });
      return {
        ...page,
        headings: uniqueValues(page.headings || []).slice(0, 8),
        lines: filteredLines.slice(0, 120),
        text: filteredLines.join(" ").slice(0, 24000)
      };
    })
    .filter((page) => page.text);
}

async function fetchRelevantWebsiteSources(baseUrl, { onProgress } = {}) {
  const crawlStartedAt = Date.now();
  const primary = await fetchWebsiteText(baseUrl);
  if (!primary.ok) return { pages: [], combinedText: "" };

  const primaryUrl = normalizeCrawlUrl(baseUrl, baseUrl) || new URL(baseUrl).origin;
  const sitemapUrls = await fetchSitemapUrls(baseUrl);
  const queue = [];
  const queued = new Set();
  const visited = new Set([primaryUrl]);

  function enqueue(url, depth, score = null) {
    const normalized = normalizeText(url);
    if (!normalized || queued.has(normalized) || visited.has(normalized)) return;
    queued.add(normalized);
    queue.push({
      url: normalized,
      depth,
      score: Number.isFinite(Number(score)) ? Number(score) : scoreRelevantInternalUrl(new URL(normalized)),
      order: queue.length
    });
  }

  for (const item of extractInternalLinks(baseUrl, primary.html)) {
    enqueue(item.url, 1, item.score);
  }
  for (const url of sitemapUrls) {
    enqueue(url, 1);
  }

  const rawPages = [{
    sourceType: "website",
    sourceUrl: primaryUrl,
    title: primary.title,
    headings: primary.headings,
    lines: primary.lines,
    text: primary.text
  }];
  onProgress?.({
    phase: "crawling",
    pagesScanned: rawPages.length,
    pagesQueued: queue.length,
    maxPages: MAX_WEBSITE_PAGES
  });

  while (queue.length && rawPages.length < MAX_WEBSITE_PAGES) {
    if (Date.now() - crawlStartedAt >= CRAWL_TIME_BUDGET_MS) {
      break;
    }
    queue.sort((left, right) =>
      left.depth - right.depth
      || right.score - left.score
      || left.url.length - right.url.length
      || left.order - right.order
    );

    const batch = queue.splice(0, Math.min(WEBSITE_CRAWL_BATCH_SIZE, MAX_WEBSITE_PAGES - rawPages.length));
    const fetchedPages = await Promise.all(
      batch.map(async (item) => ({
        ...item,
        page: await fetchWebsiteText(item.url)
      }))
    );

    for (const result of fetchedPages) {
      visited.add(result.url);
      queued.delete(result.url);
      if (!result.page.ok || !result.page.text) continue;

      rawPages.push({
        sourceType: "website",
        sourceUrl: result.url,
        title: result.page.title,
        headings: result.page.headings,
        lines: result.page.lines,
        text: result.page.text
      });
      onProgress?.({
        phase: "crawling",
        pagesScanned: rawPages.length,
        pagesQueued: queue.length,
        maxPages: MAX_WEBSITE_PAGES
      });

      for (const link of extractInternalLinks(result.url, result.page.html)) {
        enqueue(link.url, result.depth + 1, link.score);
      }
    }
  }

  const pages = finalizeWebsitePages(rawPages);
  return {
    pages,
    combinedText: pages.map((page) => page.text).filter(Boolean).join(" ").slice(0, 120000),
    crawlStats: {
      pagesScanned: rawPages.length,
      pagesRetained: pages.length,
      queueRemaining: queue.length,
      crawlTimeBudgetReached: queue.length > 0 && rawPages.length < MAX_WEBSITE_PAGES && (Date.now() - crawlStartedAt >= CRAWL_TIME_BUDGET_MS)
    }
  };
}

function extractAddressCandidates(text) {
  return Array.from(String(text || "").matchAll(/\b\d{3,6}\s+[A-Za-z0-9.\- ]+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g))
    .map((match) => match[0].trim());
}

function extractLabeledAddress(text) {
  const match = String(text || "").match(/\b(?:office|warehouse|address|location)\s*:\s*([^.\n]+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i);
  return match ? match[1].trim() : "";
}

function extractBusinessHours(text) {
  const match = String(text || "").match(/\b(?:mon|monday)[^.\n;]{0,80}(?:am|pm)\s*-\s*(?:\d{1,2}:?\d{0,2}\s*)?(?:am|pm)\b/i);
  return match ? cleanEvidenceText(match[0]) : "";
}

function extractPhone(text) {
  const match = String(text || "").match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/);
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function guessBusinessName({ googleBusinessProfile, website, ownerEmail }) {
  const gbpName = normalizeText(googleBusinessProfile?.name);
  if (gbpName) return gbpName;
  const domain = domainFromWebsite(website) || domainFromEmail(ownerEmail);
  if (!domain) return "";
  return titleCaseWords(domain.replace(/\.(com|net|org|biz|co|io|us)$/i, ""));
}

function parseUsAddress(address) {
  const raw = normalizeText(address).replace(/,\s*USA$/i, "");
  if (!raw) {
    return { address1: "", city: "", state: "", zip: "" };
  }

  const match = raw.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (match) {
    return {
      address1: match[1].trim(),
      city: match[2].trim(),
      state: match[3].trim().toUpperCase(),
      zip: match[4].trim()
    };
  }

  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    address1: parts[0] || raw,
    city: parts[1] || "",
    state: "",
    zip: ""
  };
}

function inferEmergencyServices(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower) return null;
  if (
    lower.includes("24/7") ||
    lower.includes("24 hours") ||
    lower.includes("after hours") ||
    lower.includes("emergency service") ||
    lower.includes("emergency repair") ||
    lower.includes("urgent service")
  ) {
    return true;
  }
  return null;
}

function findWebsitePageForText(pages, value) {
  const needle = normalizeText(value).toLowerCase();
  if (!needle) return null;
  for (const page of pages || []) {
    if (String(page?.text || "").toLowerCase().includes(needle)) {
      return page?.sourceUrl || null;
    }
  }
  return null;
}

function buildProfileProvenance({
  explicitWebsite,
  derivedWebsite,
  normalizedWebsite,
  websiteSources,
  googleBusinessProfile,
  businessName,
  phone,
  extractedWebsitePhone,
  selectedAddressRaw,
  addressSourceType,
  addressSourceUrl,
  serviceArea,
  businessHours,
  extractedHours,
  emergencyServices,
  websiteResult
}) {
  const gbpName = normalizeText(googleBusinessProfile?.name);
  const gbpPhone = normalizeText(googleBusinessProfile?.phone);
  const gbpAddress = normalizeText(googleBusinessProfile?.serviceArea);
  const gbpHours = normalizeText(googleBusinessProfile?.hours);
  return {
    website: {
      value: normalizedWebsite || "",
      source: explicitWebsite ? "user_input" : derivedWebsite ? "derived_from_email" : null,
      sourceUrl: normalizedWebsite || null
    },
    businessName: {
      value: businessName || "",
      source: gbpName ? "google_business_profile.name" : normalizedWebsite ? "website_domain" : "email_domain",
      sourceUrl: googleBusinessProfile?.url || googleBusinessProfile?.website || normalizedWebsite || null
    },
    phone: {
      value: phone || "",
      source: gbpPhone ? "google_business_profile.phone" : extractedWebsitePhone ? "website_text" : null,
      sourceUrl: gbpPhone
        ? (googleBusinessProfile?.url || googleBusinessProfile?.website || null)
        : findWebsitePageForText(websiteSources.pages, extractedWebsitePhone),
      evidence: gbpPhone || extractedWebsitePhone || null
    },
    address: {
      value: selectedAddressRaw || "",
      source: addressSourceType,
      sourceUrl: addressSourceUrl,
      evidence: selectedAddressRaw || null
    },
    serviceArea: {
      value: serviceArea || "",
      source: gbpAddress ? "google_business_profile.formatted_address" : null,
      sourceUrl: gbpAddress ? (googleBusinessProfile?.url || googleBusinessProfile?.website || null) : null,
      evidence: gbpAddress || null
    },
    businessHours: {
      value: businessHours || "",
      source: gbpHours ? "google_business_profile.hours" : extractedHours ? "website_text" : null,
      sourceUrl: gbpHours
        ? (googleBusinessProfile?.url || googleBusinessProfile?.website || null)
        : findWebsitePageForText(websiteSources.pages, extractedHours),
      evidence: gbpHours || extractedHours || null
    },
    emergencyServices: {
      value: emergencyServices,
      source: emergencyServices === null ? null : "inferred_from_website_and_extracted_answers",
      sourceUrl: websiteResult.ok ? normalizedWebsite || null : null
    },
    fetchedSources: {
      websitePages: (websiteSources.pages || []).map((page) => ({
        sourceType: page.sourceType || "website",
        sourceUrl: page.sourceUrl || null
      })),
      googleBusinessProfileFound: Boolean(googleBusinessProfile)
    }
  };
}

function findHeuristicMatch(queryText, sources, keywordHints = []) {
  const keys = uniqueValues([
    ...keywordsFromText(queryText),
    ...keywordHints
  ]);
  if (!keys.length) return null;

  let best = null;
  for (const source of sources || []) {
    const sourceContext = `${source.title || ""} ${(source.headings || []).join(" ")} ${source.sourceUrl || ""}`.toLowerCase();
    const sourceBonus = keys.filter((key) => sourceContext.includes(key.toLowerCase())).length;
    for (const sentence of source.sentences || []) {
      if (looksLikeNavOrBoilerplate(sentence)) continue;
      const lower = sentence.toLowerCase();
      const matches = keys.filter((key) => lower.includes(key.toLowerCase())).length;
      if (!matches) continue;
      const matchRatio = matches / Math.max(keys.length, 1);
      const score = Number(((matchRatio * Math.min(sentence.length / 120, 1)) + Math.min(sourceBonus * 0.08, 0.24)).toFixed(2));
      const candidate = {
        answer: receptionistStyleText(sentence),
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        evidenceSnippet: cleanEvidenceText(sentence),
        sourceConfidence: score
      };
      if (!best || candidate.sourceConfidence > best.sourceConfidence) {
        best = candidate;
      }
    }
  }
  return best;
}

function looksLowQualityKnowledgeText(text) {
  const cleaned = cleanEvidenceText(text);
  if (!cleaned) return true;
  if (cleaned.split(/\s+/).length < 6) return true;
  if (looksLikeNavOrBoilerplate(cleaned)) return true;
  if ((cleaned.match(/\b(skip|content|reviews|careers|blog|faqs|nominate)\b/gi) || []).length >= 2) return true;
  return false;
}

function cleanPageEntryTitle(page, fallbackTitle) {
  const heading = normalizeText(page.headings?.[0]);
  const title = normalizeText(page.title).split("|")[0].trim();
  const candidate = heading || title || fallbackTitle;
  return candidate.replace(/\s{2,}/g, " ").trim();
}

function normalizeObjectiveText(text) {
  let cleaned = cleanEvidenceText(text);
  for (const phrase of MARKETING_PHRASES) {
    cleaned = cleaned.replace(new RegExp(phrase, "ig"), "");
  }
  return cleaned.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

function buildObjectiveSummaryFromLines(lines, limit = 2) {
  const candidates = uniqueValues(lines)
    .map((line) => normalizeObjectiveText(line))
    .filter((line) => line && !looksLowQualityKnowledgeText(line))
    .filter((line) => !MARKETING_PHRASES.some((phrase) => line.toLowerCase().includes(phrase)));
  return candidates.slice(0, limit).join(" ");
}

function friendlySegmentName(segment) {
  return titleCaseWords(
    decodeURIComponent(String(segment || ""))
      .replace(/\.(html|php|aspx?)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim()
  );
}

function derivePageTopicSegments(page, businessName) {
  try {
    const url = new URL(page.sourceUrl);
    const pathSegments = url.pathname.split("/").filter(Boolean).slice(0, 4).map(friendlySegmentName).filter(Boolean);
    const leafTitle = cleanPageEntryTitle(page, businessName || "Home");
    if (!pathSegments.length) {
      return [leafTitle || businessName || "Home"];
    }

    const segments = [...pathSegments];
    const lastSegment = segments[segments.length - 1];
    if (leafTitle && normalizeLineKey(leafTitle) !== normalizeLineKey(lastSegment) && !GENERIC_PATH_SEGMENTS.has(normalizeLineKey(lastSegment))) {
      segments.push(leafTitle);
    } else if (GENERIC_PATH_SEGMENTS.has(normalizeLineKey(lastSegment)) && leafTitle) {
      segments[segments.length - 1] = leafTitle;
    }
    return uniqueValues(segments);
  } catch {
    return [cleanPageEntryTitle(page, businessName || "Home")];
  }
}

function inferTopicRiskLevelFromText(text) {
  const lower = normalizeText(text).toLowerCase();
  if (!lower) return "normal";
  if (/\b(warranty|guarantee|pricing|price|fee|fees|diagnostic|estimate|estimates)\b/.test(lower)) return "critical";
  if (/\b(emergency|urgent|24\/7|after hours|service area|locations|hours|availability|financing|payment plan)\b/.test(lower)) return "high";
  return "normal";
}

function buildTopicLinesForHeading(page, heading) {
  const headingTokens = keywordsFromText(heading).slice(0, 6);
  const scored = (page.lines || [])
    .map((line) => {
      const lower = line.toLowerCase();
      const matchCount = headingTokens.filter((token) => lower.includes(token)).length;
      return {
        line: normalizeObjectiveText(line),
        score: matchCount + (line.length >= 90 ? 1 : 0)
      };
    })
    .filter((item) => item.score > 0 && !looksLowQualityKnowledgeText(item.line))
    .sort((a, b) => b.score - a.score || b.line.length - a.line.length);
  return uniqueValues(scored.map((item) => item.line)).slice(0, 2);
}

function normalizeTopicPath(topicPath) {
  if (Array.isArray(topicPath)) {
    return uniqueValues(topicPath.map((segment) => normalizeText(segment))).join(" > ");
  }

  return String(topicPath || "")
    .split(">")
    .map((segment) => normalizeText(segment))
    .filter(Boolean)
    .join(" > ");
}

function normalizeTopicType(value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return "page";
  if (["group", "category", "container", "parent"].includes(raw)) return "group";
  if (["section", "subtopic", "child"].includes(raw)) return "section";
  return "page";
}

function normalizeTopicRiskLevel(value, fallbackText = "") {
  const raw = normalizeText(value).toLowerCase();
  if (["critical", "high", "normal"].includes(raw)) return raw;
  return inferTopicRiskLevelFromText(fallbackText);
}

function buildAiTopicPromptPages(websitePages) {
  return (websitePages || []).map((page) => ({
    sourceUrl: page.sourceUrl || null,
    title: page.title || "",
    headings: Array.isArray(page.headings) ? page.headings.slice(0, 6) : [],
    pageSummary: buildObjectiveSummaryFromLines(page.lines || [], 3),
    excerptLines: Array.isArray(page.lines) ? page.lines.slice(0, 4) : []
  }));
}

function chunkArray(items, size) {
  const normalizedSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let index = 0; index < (items || []).length; index += normalizedSize) {
    chunks.push(items.slice(index, index + normalizedSize));
  }
  return chunks;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < list.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

function normalizeAiSiteTopics(rawItems, websitePages, businessName) {
  const topicMap = new Map();
  const pageUrlSet = new Set((websitePages || []).map((page) => normalizeText(page.sourceUrl)).filter(Boolean));

  function ensureTopicNode({
    topicPath,
    displayTitle,
    topicType,
    summaryObjective = "",
    sourceUrl = null,
    sourceConfidence = null,
    riskLevel = "normal",
    metadata = {}
  }) {
    const normalizedPath = normalizeTopicPath(topicPath);
    if (!normalizedPath) return;
    const segments = normalizedPath.split(" > ").map((segment) => normalizeText(segment)).filter(Boolean);
    if (!segments.length) return;

    for (let index = 0; index < segments.length - 1; index += 1) {
      const ancestorPath = segments.slice(0, index + 1).join(" > ");
      if (!topicMap.has(ancestorPath)) {
        topicMap.set(ancestorPath, {
          topicKey: slugify(ancestorPath),
          parentTopicKey: index > 0 ? slugify(segments.slice(0, index).join(" > ")) : null,
          topicPath: ancestorPath,
          parentTopicPath: index > 0 ? segments.slice(0, index).join(" > ") : null,
          displayTitle: segments[index],
          topicType: "group",
          sourceUrl: null,
          sourceUrls: [],
          summaryObjective: "",
          sourceConfidence: 0.6,
          riskLevel: normalizeTopicRiskLevel(null, ancestorPath),
          metadata: { aiGenerated: true, derivedAncestor: true }
        });
      }
    }

    const parentTopicPath = segments.length > 1 ? segments.slice(0, -1).join(" > ") : null;
    const normalizedDisplayTitle = normalizeText(displayTitle) || segments[segments.length - 1] || businessName || "Topic";
    const normalizedSummary = normalizeObjectiveText(summaryObjective);
    const normalizedSourceUrl = pageUrlSet.has(normalizeText(sourceUrl)) ? normalizeText(sourceUrl) : null;
    const normalizedConfidence = Number.isFinite(Number(sourceConfidence))
      ? Math.max(0, Math.min(1, Number(sourceConfidence)))
      : (normalizedSummary ? 0.78 : 0.62);
    const normalizedRisk = normalizeTopicRiskLevel(riskLevel, `${normalizedPath} ${normalizedSummary}`);
    const existing = topicMap.get(normalizedPath);
    const mergedSourceUrls = uniqueValues([...(existing?.sourceUrls || []), normalizedSourceUrl].filter(Boolean));

    topicMap.set(normalizedPath, {
      topicKey: slugify(normalizedPath),
      parentTopicKey: parentTopicPath ? slugify(parentTopicPath) : null,
      topicPath: normalizedPath,
      parentTopicPath,
      displayTitle: existing?.displayTitle || normalizedDisplayTitle,
      topicType: existing?.topicType === "group" && normalizeTopicType(topicType) !== "group"
        ? normalizeTopicType(topicType)
        : (existing?.topicType || normalizeTopicType(topicType)),
      sourceUrl: existing?.sourceUrl || normalizedSourceUrl || null,
      sourceUrls: mergedSourceUrls,
      summaryObjective: existing?.summaryObjective || normalizedSummary || "",
      sourceConfidence: existing?.sourceConfidence ?? normalizedConfidence,
      riskLevel: existing?.riskLevel === "critical" || normalizedRisk === "critical"
        ? "critical"
        : existing?.riskLevel === "high" || normalizedRisk === "high"
          ? "high"
          : "normal",
      metadata: { ...(existing?.metadata || {}), ...metadata, aiGenerated: true }
    });
  }

  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const normalizedPath = normalizeTopicPath(raw?.topicPath || raw?.path || raw?.pathSegments);
    if (!normalizedPath) continue;
    ensureTopicNode({
      topicPath: normalizedPath,
      displayTitle: raw?.displayTitle || raw?.title,
      topicType: raw?.topicType,
      summaryObjective: raw?.summaryObjective || raw?.summary || raw?.description,
      sourceUrl: raw?.sourceUrl,
      sourceConfidence: raw?.sourceConfidence,
      riskLevel: raw?.riskLevel,
      metadata: {
        aiGenerated: true,
        extractionMethod: "openai_site_topics"
      }
    });
  }

  return Array.from(topicMap.values()).sort((left, right) =>
    left.topicPath.split(">").length - right.topicPath.split(">").length
    || left.topicPath.localeCompare(right.topicPath)
  );
}

async function requestAiSiteTopicItems({ instruction, payload, timeoutMs = 20000 }) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;

  try {
    const resp = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ENRICH_MODEL || "gpt-4.1-mini",
        input: [
          { role: "system", content: instruction },
          { role: "user", content: JSON.stringify(payload) }
        ]
      })
    }, timeoutMs);

    if (!resp.ok) return null;
    const json = await resp.json();
    const outputText =
      json.output_text ||
      json.output
        ?.flatMap((item) => item.content || [])
        .find((item) => item.type === "output_text" && typeof item.text === "string")
        ?.text || "";
    const parsed = extractJsonObject(outputText);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

async function extractSiteTopicsWithAi({ websitePages, businessName, onProgress }) {
  const pages = buildAiTopicPromptPages(websitePages);
  if (!pages.length) return null;

  const extractionInstruction = [
    "You analyze cleaned same-site business website pages and extract candidate topics for a voice-agent knowledge system.",
    "The website defines the topics. Do not force the site into a fixed template.",
    "Include all meaningful explicit topics from the site, including services, warranties, guarantees, financing, memberships, service areas, hours, policies, legal or niche operational topics when present.",
    "Use objective summaries, not marketing language.",
    "Each summary must be grounded only in the provided page excerpts.",
    "Do not invent details, prices, guarantees, or policies that are not explicit.",
    "Use hierarchical topicPath strings like \"Services > Plumbing > Water Heaters\".",
    "Include parent/group topics when they help organize the tree, but leaf topics should carry the real summary whenever possible.",
    "Prefer one clear topic per distinct customer-facing concept instead of many near-duplicates.",
    "Set riskLevel to critical, high, or normal based on business risk if the agent answers incorrectly.",
    "Use sourceUrl from the page that best supports the topic.",
    "Return strict JSON with shape:",
    '{"items":[{"topicPath":"...","displayTitle":"...","topicType":"group|page|section","summaryObjective":"...","sourceUrl":"https://...","sourceConfidence":0.0,"riskLevel":"critical|high|normal"}]}'
  ].join("\n");

  const pageChunks = chunkArray(pages, AI_TOPIC_CHUNK_SIZE);
  let completedChunks = 0;
  onProgress?.({
    phase: "compiling_topics",
    pagesScanned: websitePages.length,
    aiChunksCompleted: 0,
    aiChunksTotal: pageChunks.length
  });

  const chunkResults = await mapWithConcurrency(pageChunks, AI_TOPIC_CONCURRENCY, async (chunk) => {
    const items = await requestAiSiteTopicItems({
      instruction: extractionInstruction,
      payload: {
        businessName: normalizeText(businessName) || null,
        pages: chunk
      }
    });
    completedChunks += 1;
    onProgress?.({
      phase: "compiling_topics",
      pagesScanned: websitePages.length,
      aiChunksCompleted: completedChunks,
      aiChunksTotal: pageChunks.length
    });
    return Array.isArray(items) ? items : [];
  });
  const chunkResponses = chunkResults.flat();

  if (!chunkResponses.length) return null;

  const consolidationInstruction = [
    "You consolidate candidate business-website topics into a final hierarchical topic tree for a voice-agent knowledge system.",
    "Merge duplicates and near-duplicates.",
    "Preserve meaningful hierarchy when it helps retrieval.",
    "Keep objective summaries and remove marketing phrasing.",
    "Do not invent details not present in the candidate topics.",
    "Keep legal and policy topics when present.",
    "Favor the clearest sourceUrl and strongest summary for each final topic.",
    "Return strict JSON with shape:",
    '{"items":[{"topicPath":"...","displayTitle":"...","topicType":"group|page|section","summaryObjective":"...","sourceUrl":"https://...","sourceConfidence":0.0,"riskLevel":"critical|high|normal"}]}'
  ].join("\n");

  onProgress?.({
    phase: "consolidating_topics",
    pagesScanned: websitePages.length,
    aiChunksCompleted: completedChunks,
    aiChunksTotal: pageChunks.length
  });
  const consolidatedItems = await requestAiSiteTopicItems({
    instruction: consolidationInstruction,
    payload: {
      businessName: normalizeText(businessName) || null,
      candidateTopics: chunkResponses.slice(0, 240)
    },
    timeoutMs: 25000
  });

  const normalized = normalizeAiSiteTopics(
    Array.isArray(consolidatedItems) && consolidatedItems.length ? consolidatedItems : chunkResponses,
    websitePages,
    businessName
  );
  return normalized.length ? normalized : null;
}

function buildSiteTopicsHeuristically({ websitePages, businessName }) {
  const topicMap = new Map();

  function ensureTopicNode({
    topicPath,
    parentTopicPath,
    displayTitle,
    topicType,
    sourceUrl = null,
    summaryObjective = "",
    sourceConfidence = null,
    riskLevel = "normal",
    metadata = {}
  }) {
    const key = normalizeText(topicPath);
    if (!key) return;
    const existing = topicMap.get(key);
    if (existing) {
      const mergedSources = uniqueValues([...(existing.sourceUrls || []), sourceUrl].filter(Boolean));
      topicMap.set(key, {
        ...existing,
        sourceUrls: mergedSources,
        sourceUrl: existing.sourceUrl || sourceUrl || null,
        summaryObjective: existing.summaryObjective || summaryObjective || "",
        sourceConfidence: existing.sourceConfidence ?? sourceConfidence ?? null,
        riskLevel: existing.riskLevel === "critical" || riskLevel === "critical"
          ? "critical"
          : existing.riskLevel === "high" || riskLevel === "high"
            ? "high"
            : existing.riskLevel,
        metadata: { ...(existing.metadata || {}), ...metadata }
      });
      return;
    }

    topicMap.set(key, {
      topicKey: slugify(topicPath),
      parentTopicKey: parentTopicPath ? slugify(parentTopicPath) : null,
      topicPath,
      parentTopicPath: parentTopicPath || null,
      displayTitle,
      topicType,
      sourceUrl,
      sourceUrls: sourceUrl ? [sourceUrl] : [],
      summaryObjective,
      sourceConfidence,
      riskLevel,
      metadata
    });
  }

  for (const page of websitePages || []) {
    const segments = derivePageTopicSegments(page, businessName);
    if (!segments.length) continue;

    let currentPath = "";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const nextPath = currentPath ? `${currentPath} > ${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      const summaryLines = isLeaf
        ? buildObjectiveSummaryFromLines(page.lines, 2)
        : [];
      ensureTopicNode({
        topicPath: nextPath,
        parentTopicPath: currentPath || null,
        displayTitle: segment,
        topicType: isLeaf ? "page" : "group",
        sourceUrl: page.sourceUrl || null,
        summaryObjective: Array.isArray(summaryLines) ? summaryLines.join(" ") : summaryLines,
        sourceConfidence: isLeaf ? 0.8 : 0.7,
        riskLevel: inferTopicRiskLevelFromText(`${nextPath} ${page.text || ""}`),
        metadata: {
          pageTitle: page.title || "",
          headings: page.headings || []
        }
      });
      currentPath = nextPath;
    }

    const leafPath = segments.join(" > ");
    for (const heading of (page.headings || []).slice(1, 4)) {
      const headingTitle = normalizeText(heading);
      if (!headingTitle) continue;
      const summaryLines = buildTopicLinesForHeading(page, headingTitle);
      if (!summaryLines.length) continue;
      const topicPath = `${leafPath} > ${headingTitle}`;
      ensureTopicNode({
        topicPath,
        parentTopicPath: leafPath,
        displayTitle: headingTitle,
        topicType: "section",
        sourceUrl: page.sourceUrl || null,
        summaryObjective: buildObjectiveSummaryFromLines(summaryLines, 2),
        sourceConfidence: 0.72,
        riskLevel: inferTopicRiskLevelFromText(`${topicPath} ${summaryLines.join(" ")}`),
        metadata: {
          pageTitle: page.title || "",
          derivedFromHeading: true
        }
      });
    }
  }

  return Array.from(topicMap.values()).sort((left, right) =>
    left.topicPath.split(">").length - right.topicPath.split(">").length
    || left.topicPath.localeCompare(right.topicPath)
  );
}

async function buildSiteTopics({ websitePages, businessName }, { onProgress } = {}) {
  const aiTopics = await extractSiteTopicsWithAi({
    websitePages,
    businessName,
    onProgress: typeof onProgress === "function" ? onProgress : null
  });
  if (Array.isArray(aiTopics) && aiTopics.length) {
    return aiTopics;
  }
  return buildSiteTopicsHeuristically({ websitePages, businessName });
}

function buildCoverageChecklist({ siteTopics, guardrailQuestionTests }) {
  return COVERAGE_CHECKLIST_TEMPLATES.map((template) => {
    const matchingTopics = (siteTopics || []).filter((topic) => {
      const haystack = `${topic.topicPath} ${topic.displayTitle} ${topic.summaryObjective}`.toLowerCase();
      return template.keywords.some((keyword) => haystack.includes(String(keyword).toLowerCase()));
    });
    const matchingGuardrails = (guardrailQuestionTests || []).filter((item) => template.guardrailTopics.includes(item.topic));
    const strongGuardrail = matchingGuardrails.some((item) => isUsableGuardrailAnswer(item.answer, item.topic) && Number(item.sourceConfidence || 0) >= 0.55);
    const mediumGuardrail = matchingGuardrails.some((item) => isUsableGuardrailAnswer(item.answer, item.topic));
    const topicConfidence = matchingTopics.length
      ? Math.max(...matchingTopics.map((topic) => Number(topic.sourceConfidence || 0.5)))
      : 0;

    let status = "missing";
    if ((matchingTopics.length >= 1 && topicConfidence >= 0.72) && strongGuardrail) {
      status = "ready";
    } else if (matchingTopics.length || mediumGuardrail) {
      status = "partial";
    }

    return {
      checkKey: template.checkKey,
      title: template.title,
      status,
      coverageConfidence: Number(Math.max(topicConfidence, strongGuardrail ? 0.85 : mediumGuardrail ? 0.55 : 0).toFixed(2)),
      matchedTopicPaths: matchingTopics.map((topic) => topic.topicPath).slice(0, 8),
      notes: status === "ready"
        ? "Grounded site topics and guardrail coverage were found."
        : status === "partial"
          ? "Some relevant site knowledge exists, but review is still needed."
          : "No reliable grounded coverage was found yet.",
      metadata: {
        topicCount: matchingTopics.length,
        guardrailCount: matchingGuardrails.length
      }
    };
  });
}

function isUsableGuardrailAnswer(answer, topic) {
  const cleaned = cleanEvidenceText(answer);
  if (!cleaned) return false;
  if (looksLikeNavOrBoilerplate(cleaned)) return false;
  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount < 4 && !["availability", "service_area"].includes(String(topic || ""))) return false;
  const topicKeywords = GUARDRAIL_TOPIC_KEYWORDS[topic] || [];
  if (topicKeywords.length && !topicKeywords.some((keyword) => cleaned.toLowerCase().includes(String(keyword).toLowerCase())) && wordCount < 10) {
    return false;
  }
  return true;
}

function findSiteTopicFallbackSummary(siteTopics, topic) {
  const keywords = GUARDRAIL_TOPIC_KEYWORDS[topic] || [];
  if (!keywords.length) return null;

  const candidates = (siteTopics || [])
    .map((item) => {
      const summary = normalizeText(item?.summaryObjective);
      if (!summary || looksLowQualityKnowledgeText(summary)) return null;
      const haystack = `${item?.topicPath || ""} ${item?.displayTitle || ""} ${summary}`.toLowerCase();
      const keywordMatches = keywords.filter((keyword) => haystack.includes(String(keyword).toLowerCase())).length;
      if (!keywordMatches) return null;
      const depth = String(item?.topicPath || "").split(">").filter(Boolean).length;
      const typeBonus = item?.topicType === "section" ? 0.2 : item?.topicType === "page" ? 0.12 : 0;
      const confidence = Math.max(0, Math.min(Number(item?.sourceConfidence || 0.55), 1));
      return {
        answer: summary,
        sourceType: "site_topic",
        sourceUrl: item?.sourceUrl || null,
        sourceConfidence: Number(Math.min((keywordMatches * 0.2) + typeBonus + confidence, 0.95).toFixed(2)),
        matchScore: keywordMatches * 10 + depth + typeBonus + confidence
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.matchScore - left.matchScore);

  if (!candidates.length) return null;
  const best = candidates[0];
  return {
    answer: best.answer,
    sourceType: best.sourceType,
    sourceUrl: best.sourceUrl,
    sourceConfidence: best.sourceConfidence
  };
}

function buildGuardrailQuestionTests({ profile, sources, defaults, siteTopics, aiByQuestion }) {
  return (defaults || []).map((template) => {
    const aiMatch = aiByQuestion.get(normalizeText(template.questionText));
    if (aiMatch && isUsableGuardrailAnswer(aiMatch.answer, template.topic)) {
      return {
        ...template,
        answer: normalizeText(aiMatch.answer),
        sourceType: normalizeText(aiMatch.sourceType) || null,
        sourceUrl: normalizeText(aiMatch.sourceUrl) || null,
        sourceConfidence: toNumberOrNull(aiMatch.sourceConfidence)
      };
    }

    const heuristic = findHeuristicMatch(template.questionText, sources, GUARDRAIL_TOPIC_KEYWORDS[template.topic] || []);
    if (heuristic && isUsableGuardrailAnswer(heuristic.answer, template.topic)) {
      return {
        ...template,
        answer: normalizeText(heuristic.answer),
        sourceType: normalizeText(heuristic.sourceType) || null,
        sourceUrl: normalizeText(heuristic.sourceUrl) || null,
        sourceConfidence: toNumberOrNull(heuristic.sourceConfidence)
      };
    }

    const siteTopicFallback = findSiteTopicFallbackSummary(siteTopics, template.topic);
    if (siteTopicFallback && isUsableGuardrailAnswer(siteTopicFallback.answer, template.topic)) {
      return {
        ...template,
        answer: normalizeText(siteTopicFallback.answer),
        sourceType: siteTopicFallback.sourceType || null,
        sourceUrl: siteTopicFallback.sourceUrl || null,
        sourceConfidence: toNumberOrNull(siteTopicFallback.sourceConfidence)
      };
    }

    if (template.topic === "emergency_service" && profile.emergencyServices === true) {
      return {
        ...template,
        answer: "Emergency or after-hours service appears to be offered, but exact dispatch timing should be confirmed before making a promise.",
        sourceType: "derived_profile",
        sourceUrl: null,
        sourceConfidence: 0.8
      };
    }

    return template;
  });
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const raw = normalizeText(text);
  const parsedRaw = safeJsonParse(raw);
  if (parsedRaw) return parsedRaw;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return safeJsonParse(raw.slice(start, end + 1));
  }
  return null;
}

async function extractGuardrailAnswersWithAi(questionTemplates, sources) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey || !questionTemplates.length || !sources.length) return null;

  const prompt = {
    guardrailQuestions: questionTemplates.map((item) => ({
      questionText: item.questionText,
      topic: item.topic,
      answer: item.answer || ""
    })),
    sources: sources.map((source) => ({
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
      title: source.title || "",
      sentences: source.sentences.slice(0, 18)
    }))
  };

  const instruction = [
    "You extract approved business answers for high-risk guardrail questions from source text.",
    "Rules:",
    "1) Answer only when explicit evidence appears in a source sentence.",
    "2) If no explicit evidence exists, return answer as empty string.",
    "3) Return confidence from 0 to 1.",
    "4) Keep the answer concise, faithful to evidence, and suitable for a receptionist.",
    "5) Do not add promises, pricing, or policy details that are not explicit in the source text.",
    "Output strict JSON with shape:",
    '{"items":[{"questionText":"...","answer":"...","sourceType":"website|google_business_profile|null","sourceUrl":"...|null","evidenceSnippet":"...|null","sourceConfidence":0.0}]}'
  ].join("\n");

  try {
    const resp = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ENRICH_MODEL || "gpt-4.1-mini",
        input: [
          { role: "system", content: instruction },
          { role: "user", content: JSON.stringify(prompt) }
        ]
      })
    }, 15000);

    if (!resp.ok) return null;
    const json = await resp.json();
    const outputText =
      json.output_text ||
      json.output
        ?.flatMap((item) => item.content || [])
        .find((item) => item.type === "output_text" && typeof item.text === "string")
        ?.text || "";
    const parsed = extractJsonObject(outputText);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

async function fetchGoogleBusinessProfile({ website, businessName, serviceArea }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";
  if (!apiKey) return null;

  const domain = domainFromWebsite(website);
  const queryCandidates = Array.from(new Set([
    [businessName, serviceArea].filter(Boolean).join(" ").trim(),
    normalizeText(businessName),
    domain
  ].filter(Boolean)));

  async function lookupPlaceId(query) {
    const findUrl = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
    findUrl.searchParams.set("input", query);
    findUrl.searchParams.set("inputtype", "textquery");
    findUrl.searchParams.set("fields", "name,place_id");
    findUrl.searchParams.set("key", apiKey);
    const findResp = await fetchWithTimeout(findUrl.toString(), {}, 8000);
    const findData = await findResp.json().catch(() => null);
    if (findData?.candidates?.[0]?.place_id) return findData.candidates[0].place_id;

    const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("key", apiKey);
    const searchResp = await fetchWithTimeout(searchUrl.toString(), {}, 8000);
    const searchData = await searchResp.json().catch(() => null);
    return searchData?.results?.[0]?.place_id || null;
  }

  for (const query of queryCandidates) {
    try {
      const placeId = await lookupPlaceId(query);
      if (!placeId) continue;

      const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailsUrl.searchParams.set("place_id", placeId);
      detailsUrl.searchParams.set(
        "fields",
        "name,website,url,formatted_phone_number,formatted_address,opening_hours,editorial_summary,types"
      );
      detailsUrl.searchParams.set("key", apiKey);
      const detailsResp = await fetchWithTimeout(detailsUrl.toString(), {}, 8000);
      const detailsData = await detailsResp.json().catch(() => null);
      const result = detailsData?.result;
      if (!result) continue;

      return {
        name: result.name || "",
        url: result.url || null,
        website: result.website || null,
        description: decodeHtmlEntities(result.editorial_summary?.overview || ""),
        services: Array.isArray(result.types) ? result.types.join(", ") : "",
        hours: Array.isArray(result.opening_hours?.weekday_text)
          ? result.opening_hours.weekday_text.join("; ")
          : "",
        serviceArea: result.formatted_address || "",
        phone: result.formatted_phone_number || ""
      };
    } catch {
      continue;
    }
  }

  return null;
}

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

function createStreamingPreviewWriter(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  return {
    progress(payload) {
      res.write(`${JSON.stringify({ type: "progress", ...payload })}\n`);
    },
    result(body) {
      res.write(`${JSON.stringify({ type: "result", ok: true, body })}\n`);
      res.end();
    },
    error(error, message) {
      res.write(`${JSON.stringify({ type: "error", ok: false, error, message })}\n`);
      res.end();
    }
  };
}

export default async function handler(req, res) {
  let streamWriter = null;
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return fail(res, 405, "method_not_allowed", "Method not allowed.");
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const streamProgress = truthy(body.streamProgress);
    streamWriter = streamProgress ? createStreamingPreviewWriter(res) : null;
    const emitProgress = (payload) => streamWriter?.progress(payload);

    const pool = getPool();
    if (!pool) {
      if (streamWriter) return streamWriter.error("database_unavailable", "Database is unavailable.");
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }
    await ensureTables(pool);

    const industry = normalizeText(body.industry);
    if (!industry) {
      if (streamWriter) return streamWriter.error("missing_industry", "Industry is required.");
      return fail(res, 400, "missing_industry", "Industry is required.");
    }
    emitProgress({ phase: "starting", pagesScanned: 0 });

    const ownerEmail = normalizeText(body.ownerEmail).toLowerCase();
    const explicitWebsite = normalizeText(body.website);
    const derivedWebsite = explicitWebsite ? "" : websiteFromEmail(ownerEmail);
    const normalizedWebsite = normalizeWebsite(explicitWebsite || derivedWebsite);
    const industryDefaults = await loadIndustryKnowledgeDefaults(pool, industry);

    const googleBusinessProfilePromise = body.googleBusinessProfile && typeof body.googleBusinessProfile === "object"
      ? Promise.resolve(body.googleBusinessProfile)
      : fetchGoogleBusinessProfile({
          website: normalizedWebsite,
          businessName: normalizeText(body.businessName),
          serviceArea: normalizeText(body.serviceArea)
        });

    const websiteSources = normalizedWebsite
      ? await fetchRelevantWebsiteSources(normalizedWebsite, { onProgress: emitProgress })
      : { pages: [], combinedText: "", crawlStats: { pagesScanned: 0, pagesRetained: 0, queueRemaining: 0, crawlTimeBudgetReached: false } };
    const websiteResult = {
      ok: websiteSources.pages.length > 0,
      text: websiteSources.combinedText
    };

    const googleBusinessProfile = await googleBusinessProfilePromise;

    const gbpText = googleBusinessProfile
      ? [
          googleBusinessProfile.description,
          googleBusinessProfile.services,
          googleBusinessProfile.hours,
          googleBusinessProfile.serviceArea,
          googleBusinessProfile.phone
        ].filter(Boolean).join(". ")
      : "";

    const sources = [];
    for (const page of websiteSources.pages) {
      sources.push({
        sourceType: page.sourceType,
        sourceUrl: page.sourceUrl,
        title: page.title || "",
        headings: Array.isArray(page.headings) ? page.headings : [],
        sentences: Array.isArray(page.lines) && page.lines.length ? page.lines.slice(0, 80) : splitSentences(page.text)
      });
    }
    if (normalizeText(gbpText)) {
      sources.push({
        sourceType: "google_business_profile",
        sourceUrl: normalizeText(googleBusinessProfile?.url || googleBusinessProfile?.website) || null,
        title: normalizeText(googleBusinessProfile?.name) || "Google Business Profile",
        headings: [],
        sentences: splitSentences(gbpText)
      });
    }

    const businessName = guessBusinessName({ googleBusinessProfile, website: normalizedWebsite, ownerEmail });
    const addressText = [websiteResult.text, googleBusinessProfile?.serviceArea].filter(Boolean).join(" ");
    const labeledAddress = extractLabeledAddress(addressText);
    const addressCandidates = extractAddressCandidates(addressText);
    const selectedAddressRaw = labeledAddress || addressCandidates[0] || googleBusinessProfile?.serviceArea || "";
    let addressSourceType = null;
    let addressSourceUrl = null;
    if (labeledAddress) {
      addressSourceType = "website_labeled_address";
      addressSourceUrl = findWebsitePageForText(websiteSources.pages, labeledAddress);
    } else if (addressCandidates[0]) {
      addressSourceType = "website_address_match";
      addressSourceUrl = findWebsitePageForText(websiteSources.pages, addressCandidates[0]);
    } else if (googleBusinessProfile?.serviceArea) {
      addressSourceType = "google_business_profile.formatted_address";
      addressSourceUrl = googleBusinessProfile?.url || googleBusinessProfile?.website || null;
    }

    const parsedAddress = parseUsAddress(selectedAddressRaw);
    const extractedWebsitePhone = extractPhone(websiteResult.text);
    const extractedHours = extractBusinessHours(websiteResult.text);

    const profile = {
      businessName,
      phone: normalizeText(googleBusinessProfile?.phone) || extractedWebsitePhone,
      address1: parsedAddress.address1,
      city: parsedAddress.city,
      state: parsedAddress.state,
      zip: parsedAddress.zip,
      serviceArea: normalizeText(googleBusinessProfile?.serviceArea),
      businessHours: normalizeText(googleBusinessProfile?.hours) || extractedHours,
      emergencyServices: null,
      serviceText: [
        normalizeText(googleBusinessProfile?.description),
        normalizeText(googleBusinessProfile?.services),
        websiteResult.text.slice(0, 10000)
      ].filter(Boolean).join(". ")
    };

    const [aiItems, siteTopics] = await Promise.all([
      extractGuardrailAnswersWithAi(industryDefaults.guardrailQuestionTests, sources),
      buildSiteTopics({
        websitePages: websiteSources.pages,
        businessName
      }, { onProgress: emitProgress })
    ]);
    const aiByQuestion = new Map(
      Array.isArray(aiItems)
        ? aiItems
            .filter((item) => normalizeText(item?.questionText))
            .map((item) => [normalizeText(item.questionText), item])
        : []
    );

    const guardrailQuestionTests = buildGuardrailQuestionTests({
      profile,
      sources,
      defaults: industryDefaults.guardrailQuestionTests,
      siteTopics,
      aiByQuestion
    });

    const emergencyServices = inferEmergencyServices(
      [
        profile.serviceText,
        ...(siteTopics || []).map((topic) => topic.summaryObjective),
        ...guardrailQuestionTests.map((item) => item.answer)
      ].join(". ")
    );
    profile.emergencyServices = emergencyServices;

    const coverageChecklist = buildCoverageChecklist({
      siteTopics,
      guardrailQuestionTests
    });
    emitProgress({
      phase: "complete",
      pagesScanned: websiteSources.crawlStats?.pagesScanned || websiteSources.pages.length
    });

    const provenance = buildProfileProvenance({
      explicitWebsite,
      derivedWebsite,
      normalizedWebsite,
      websiteSources,
      googleBusinessProfile,
      businessName,
      phone: profile.phone,
      extractedWebsitePhone,
      selectedAddressRaw,
      addressSourceType,
      addressSourceUrl,
      serviceArea: profile.serviceArea,
      businessHours: profile.businessHours,
      extractedHours,
      emergencyServices,
      websiteResult
    });

    const responseBody = {
      ok: true,
      enrichment: {
        website: normalizedWebsite || "",
        websiteAutofilled: Boolean(!explicitWebsite && derivedWebsite),
        websiteFetched: Boolean(websiteResult.ok),
        googleBusinessProfileFound: Boolean(googleBusinessProfile),
        googleBusinessProfile,
        profile,
        provenance,
        crawlStats: websiteSources.crawlStats || null,
        guardrailQuestionTests,
        siteTopics,
        coverageChecklist
      }
    };

    if (streamWriter) {
      return streamWriter.result(responseBody);
    }
    return res.status(200).json(responseBody);
  } catch (err) {
    if (streamWriter) {
      return streamWriter.error("enrichment_preview_error", err?.message || "unknown");
    }
    return fail(res, 500, "enrichment_preview_error", err?.message || "unknown");
  }
}
