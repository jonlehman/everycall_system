import { ensureTables, getPool } from "../../../_lib/db.js";
import { createBlankKnowledgeEntries } from "../../../../../lib/knowledgeTemplates.js";
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

const MAX_WEBSITE_PAGES = 20;

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

function scoreRelevantInternalUrl(url, anchorText = "") {
  const path = `${url.pathname} ${anchorText}`.toLowerCase();
  if (!path) return -1;
  if (/\.(jpg|jpeg|png|webp|svg|gif|pdf|xml)$/i.test(url.pathname)) return -1;
  if (/\/(privacy|terms|careers|press|blog|feed|author)\b/.test(path)) return -2;

  let score = 0;
  for (const keywords of Object.values(KNOWLEDGE_SECTION_KEYWORDS)) {
    score += keywords.filter((keyword) => path.includes(String(keyword).toLowerCase())).length * 2;
  }
  if (/(contact|about|service|area|location|pricing|warranty|guarantee|membership|plan|financing|payment|plumbing|hvac|electrical|home-care)/.test(path)) {
    score += 4;
  }
  return score;
}

function extractRelevantInternalLinks(baseUrl, html) {
  const source = String(html || "");
  if (!source) return [];
  const base = new URL(baseUrl);
  const matches = Array.from(source.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const scored = [];
  const seen = new Set();

  for (const match of matches) {
    const href = normalizeText(match[1]);
    if (!href) continue;
    try {
      const resolved = new URL(href, base);
      if (resolved.hostname !== base.hostname) continue;
      const normalized = `${resolved.origin}${resolved.pathname}`.replace(/\/$/, "") || resolved.origin;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const anchorText = cleanLineText(match[2].replace(/<[^>]+>/g, " "));
      const score = scoreRelevantInternalUrl(resolved, anchorText);
      if (score <= 0) continue;
      scored.push({ url: normalized, score });
    } catch {
      continue;
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
    .slice(0, MAX_WEBSITE_PAGES * 2)
    .map((item) => item.url);
}

async function fetchSitemapUrls(baseUrl, maxUrls = 80) {
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
          const normalized = `${resolved.origin}${resolved.pathname}`.replace(/\/$/, "") || resolved.origin;
          if (/\.xml$/i.test(resolved.pathname)) {
            if (!seenSitemaps.has(normalized)) queue.push(normalized);
            continue;
          }
          if (seenUrls.has(normalized)) continue;
          seenUrls.add(normalized);
          if (scoreRelevantInternalUrl(resolved) <= 0) continue;
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

async function fetchRelevantWebsiteSources(baseUrl) {
  const primary = await fetchWebsiteText(baseUrl);
  if (!primary.ok) return { pages: [], combinedText: "" };

  const primaryUrl = `${new URL(baseUrl).origin}${new URL(baseUrl).pathname}`.replace(/\/$/, "") || new URL(baseUrl).origin;
  const sitemapUrls = await fetchSitemapUrls(baseUrl);
  const candidateUrls = uniqueValues([
    ...extractRelevantInternalLinks(baseUrl, primary.html),
    ...sitemapUrls
  ])
    .filter((url) => url !== primaryUrl)
    .sort((left, right) => {
      try {
        const leftScore = scoreRelevantInternalUrl(new URL(left));
        const rightScore = scoreRelevantInternalUrl(new URL(right));
        return rightScore - leftScore || left.length - right.length;
      } catch {
        return 0;
      }
    })
    .slice(0, MAX_WEBSITE_PAGES - 1);

  const fetchedPages = await Promise.all(candidateUrls.map((url) => fetchWebsiteText(url)));
  const rawPages = [{
    sourceType: "website",
    sourceUrl: primaryUrl,
    title: primary.title,
    headings: primary.headings,
    lines: primary.lines,
    text: primary.text
  }];

  for (let index = 0; index < fetchedPages.length; index += 1) {
    const page = fetchedPages[index];
    if (!page.ok || !page.text) continue;
    rawPages.push({
      sourceType: "website",
      sourceUrl: candidateUrls[index],
      title: page.title,
      headings: page.headings,
      lines: page.lines,
      text: page.text
    });
  }

  const pages = finalizeWebsitePages(rawPages);
  return {
    pages,
    combinedText: pages.map((page) => page.text).filter(Boolean).join(" ").slice(0, 120000)
  };
}

function findSentenceMatchesByKeywords(keywords, sources, limit = 3) {
  const keys = uniqueValues(keywords).map((keyword) => keyword.toLowerCase());
  if (!keys.length) return [];
  const matches = [];
  for (const source of sources || []) {
    const sourceContext = `${source.title || ""} ${(source.headings || []).join(" ")} ${source.sourceUrl || ""}`.toLowerCase();
    const sourceBonus = keys.filter((key) => sourceContext.includes(key)).length;
    for (const sentence of source.sentences || []) {
      if (looksLikeNavOrBoilerplate(sentence)) continue;
      const lower = String(sentence || "").toLowerCase();
      const matchCount = keys.filter((key) => lower.includes(key)).length;
      if (!matchCount) continue;
      matches.push({
        sentence: cleanEvidenceText(sentence),
        sourceType: source.sourceType || "website",
        sourceUrl: source.sourceUrl || null,
        score: matchCount + sourceBonus
      });
    }
  }
  return matches
    .sort((a, b) => b.score - a.score || b.sentence.length - a.sentence.length)
    .filter((match, index, items) => items.findIndex((item) => item.sentence === match.sentence) === index)
    .slice(0, limit);
}

function joinSentences(matches, limit = 2) {
  return uniqueValues((matches || []).map((match) => match.sentence)).slice(0, limit).join(" ");
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

function entrySourceFromFallback(fallbackEntry) {
  return {
    sourceType: normalizeText(fallbackEntry?.sourceType) || null,
    sourceUrl: normalizeText(fallbackEntry?.sourceUrl) || null,
    sourceConfidence: toNumberOrNull(fallbackEntry?.sourceConfidence)
  };
}

function looksLowQualityKnowledgeText(text) {
  const cleaned = cleanEvidenceText(text);
  if (!cleaned) return true;
  if (cleaned.split(/\s+/).length < 6) return true;
  if (looksLikeNavOrBoilerplate(cleaned)) return true;
  if ((cleaned.match(/\b(skip|content|reviews|careers|blog|faqs|nominate)\b/gi) || []).length >= 2) return true;
  return false;
}

function inferKnowledgeSectionTypeForPage(page) {
  const haystack = `${page.title || ""} ${(page.headings || []).join(" ")} ${page.sourceUrl || ""} ${(page.text || "").slice(0, 2400)}`.toLowerCase();
  let bestSectionType = null;
  let bestScore = 0;
  for (const [sectionType, keywords] of Object.entries(KNOWLEDGE_SECTION_KEYWORDS)) {
    const score = keywords.filter((keyword) => haystack.includes(String(keyword).toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      bestSectionType = sectionType;
    }
  }
  return bestScore >= 2 ? { sectionType: bestSectionType, score: bestScore } : { sectionType: null, score: 0 };
}

function cleanPageEntryTitle(page, fallbackTitle) {
  const heading = normalizeText(page.headings?.[0]);
  const title = normalizeText(page.title).split("|")[0].trim();
  const candidate = heading || title || fallbackTitle;
  return candidate.replace(/\s{2,}/g, " ").trim();
}

function buildPageSnippet(page, sectionType) {
  const keywords = KNOWLEDGE_SECTION_KEYWORDS[sectionType] || [];
  const lineScores = (page.lines || [])
    .map((line) => {
      const lower = line.toLowerCase();
      const keywordMatches = keywords.filter((keyword) => lower.includes(String(keyword).toLowerCase())).length;
      const headingBonus = (page.headings || []).some((heading) => lower.includes(String(heading).toLowerCase())) ? 1 : 0;
      const lengthBonus = line.length >= 90 ? 1 : 0;
      return {
        line: cleanEvidenceText(line),
        score: keywordMatches * 2 + headingBonus + lengthBonus
      };
    })
    .filter((item) => item.score > 0 && !looksLowQualityKnowledgeText(item.line))
    .sort((a, b) => b.score - a.score || b.line.length - a.line.length);

  return uniqueValues(lineScores.map((item) => item.line)).slice(0, 3).join(" ");
}

function buildAdditionalPageKnowledgeEntries(pages, existingEntries = []) {
  const seen = new Set(
    (existingEntries || [])
      .map((entry) => `${normalizeText(entry.sectionType)}::${normalizeLineKey(entry.title)}::${normalizeLineKey(entry.contentText).slice(0, 120)}`)
      .filter(Boolean)
  );

  const candidates = (pages || [])
    .map((page) => ({
      page,
      ...inferKnowledgeSectionTypeForPage(page)
    }))
    .filter((item) => item.sectionType)
    .sort((a, b) => b.score - a.score || String(a.page.sourceUrl || "").length - String(b.page.sourceUrl || "").length);

  const extras = [];
  for (const item of candidates) {
    const contentText = buildPageSnippet(item.page, item.sectionType);
    const title = cleanPageEntryTitle(item.page, titleCaseWords(item.sectionType.replace(/_/g, " ")));
    if (!contentText || looksLowQualityKnowledgeText(contentText)) continue;
    const key = `${item.sectionType}::${normalizeLineKey(title)}::${normalizeLineKey(contentText).slice(0, 120)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    extras.push({
      sectionType: item.sectionType,
      title,
      contentText,
      sourceType: item.page.sourceType || "website",
      sourceUrl: item.page.sourceUrl || null,
      sourceConfidence: Number(Math.min(0.55 + item.score * 0.08, 0.95).toFixed(2))
    });
    if (extras.length >= 12) break;
  }

  return extras;
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
    headings: Array.isArray(page.headings) ? page.headings.slice(0, 8) : [],
    excerptLines: Array.isArray(page.lines) ? page.lines.slice(0, 12) : []
  }));
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

async function extractSiteTopicsWithAi({ websitePages, businessName }) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const pages = buildAiTopicPromptPages(websitePages);
  if (!apiKey || !pages.length) return null;

  const prompt = {
    businessName: normalizeText(businessName) || null,
    pages
  };

  const instruction = [
    "You analyze cleaned same-site business website pages and produce a topic tree for a voice-agent knowledge system.",
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
    }, 20000);

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
    const normalized = normalizeAiSiteTopics(parsed.items, websitePages, businessName);
    return normalized.length ? normalized : null;
  } catch {
    return null;
  }
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

async function buildSiteTopics({ websitePages, businessName }) {
  const aiTopics = await extractSiteTopicsWithAi({ websitePages, businessName });
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

function buildKnowledgeEntries({ profile, sources, industryDefaults, websitePages }) {
  const defaultsBySection = new Map((industryDefaults || []).map((entry) => [entry.sectionType, entry]));
  const templates = createBlankKnowledgeEntries();
  const addressSummary = [profile.address1, profile.city, profile.state, profile.zip].filter(Boolean).join(", ");

  const baseEntries = templates.map((template) => {
    const defaultEntry = defaultsBySection.get(template.sectionType) || template;
    const matches = findSentenceMatchesByKeywords(
      KNOWLEDGE_SECTION_KEYWORDS[template.sectionType] || [],
      sources,
      template.sectionType === "services_and_capabilities" ? 3 : 2
    );
    const matchedText = joinSentences(matches, template.sectionType === "services_and_capabilities" ? 3 : 2);
    const preferredMatchedText = looksLowQualityKnowledgeText(matchedText) ? "" : matchedText;

    let fallbackText = "";
    let fallbackSource = entrySourceFromFallback(defaultEntry);
    if (template.sectionType === "service_area" && (profile.serviceArea || addressSummary)) {
      fallbackText = [profile.serviceArea, addressSummary].filter(Boolean).join(" ").trim();
      fallbackSource = { sourceType: "derived_profile", sourceUrl: null, sourceConfidence: 1 };
    } else if (template.sectionType === "hours_and_availability" && profile.businessHours) {
      fallbackText = profile.businessHours;
      fallbackSource = { sourceType: "derived_profile", sourceUrl: null, sourceConfidence: 1 };
    } else if (template.sectionType === "emergency_service" && profile.emergencyServices === true) {
      fallbackText = "Emergency or after-hours service appears to be offered. Verify exact availability before promising dispatch timing.";
      fallbackSource = { sourceType: "derived_profile", sourceUrl: null, sourceConfidence: 0.8 };
    } else {
      fallbackText = normalizeText(defaultEntry.contentText);
    }

    return {
      sectionType: template.sectionType,
      title: defaultEntry.title || template.title,
      contentText: preferredMatchedText || fallbackText,
      sourceType: preferredMatchedText ? (matches[0]?.sourceType || fallbackSource.sourceType) : fallbackSource.sourceType,
      sourceUrl: preferredMatchedText ? (matches[0]?.sourceUrl || fallbackSource.sourceUrl) : fallbackSource.sourceUrl,
      sourceConfidence: preferredMatchedText
        ? Number((Math.min(Number(matches[0].score) / 3, 1)).toFixed(2))
        : fallbackSource.sourceConfidence
    };
  });

  const extraEntries = buildAdditionalPageKnowledgeEntries(websitePages, baseEntries);
  return [...baseEntries, ...extraEntries];
}

function buildGuardrailQuestionTests({ profile, sources, defaults, knowledgeEntries, aiByQuestion }) {
  const sectionByType = new Map((knowledgeEntries || []).map((entry) => [entry.sectionType, entry]));
  const sectionTypeByTopic = {
    warranty: "warranties_and_guarantees",
    guarantees: "warranties_and_guarantees",
    service_area: "service_area",
    availability: "hours_and_availability",
    financing: "financing_and_payment",
    pricing: "pricing_and_fees"
  };

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

    const section = sectionByType.get(sectionTypeByTopic[template.topic]);
    if (normalizeText(section?.contentText) && !looksLowQualityKnowledgeText(section.contentText)) {
      return {
        ...template,
        answer: normalizeText(section.contentText),
        sourceType: section.sourceType || null,
        sourceUrl: section.sourceUrl || null,
        sourceConfidence: toNumberOrNull(section.sourceConfidence)
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

    if (template.topic === "service_area") {
      const section = sectionByType.get("service_area");
      if (normalizeText(section?.contentText)) {
        return {
          ...template,
          answer: normalizeText(section.contentText),
          sourceType: section.sourceType || null,
          sourceUrl: section.sourceUrl || null,
          sourceConfidence: toNumberOrNull(section.sourceConfidence)
        };
      }
    }

    if (template.topic === "availability") {
      const section = sectionByType.get("hours_and_availability");
      if (normalizeText(section?.contentText)) {
        return {
          ...template,
          answer: normalizeText(section.contentText),
          sourceType: section.sourceType || null,
          sourceUrl: section.sourceUrl || null,
          sourceConfidence: toNumberOrNull(section.sourceConfidence)
        };
      }
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return fail(res, 405, "method_not_allowed", "Method not allowed.");
    }

    const pool = getPool();
    if (!pool) return fail(res, 500, "database_unavailable", "Database is unavailable.");
    await ensureTables(pool);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const industry = normalizeText(body.industry);
    if (!industry) return fail(res, 400, "missing_industry", "Industry is required.");

    const ownerEmail = normalizeText(body.ownerEmail).toLowerCase();
    const explicitWebsite = normalizeText(body.website);
    const derivedWebsite = explicitWebsite ? "" : websiteFromEmail(ownerEmail);
    const normalizedWebsite = normalizeWebsite(explicitWebsite || derivedWebsite);
    const industryDefaults = await loadIndustryKnowledgeDefaults(pool, industry);

    const websiteSources = normalizedWebsite ? await fetchRelevantWebsiteSources(normalizedWebsite) : { pages: [], combinedText: "" };
    const websiteResult = {
      ok: websiteSources.pages.length > 0,
      text: websiteSources.combinedText
    };

    let googleBusinessProfile = body.googleBusinessProfile && typeof body.googleBusinessProfile === "object"
      ? body.googleBusinessProfile
      : null;
    if (!googleBusinessProfile) {
      googleBusinessProfile = await fetchGoogleBusinessProfile({
        website: normalizedWebsite,
        businessName: normalizeText(body.businessName),
        serviceArea: normalizeText(body.serviceArea)
      });
    }

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

    const aiItems = await extractGuardrailAnswersWithAi(industryDefaults.guardrailQuestionTests, sources);
    const aiByQuestion = new Map(
      Array.isArray(aiItems)
        ? aiItems
            .filter((item) => normalizeText(item?.questionText))
            .map((item) => [normalizeText(item.questionText), item])
        : []
    );

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

    const preliminaryKnowledgeEntries = buildKnowledgeEntries({
      profile,
      sources,
      industryDefaults: industryDefaults.knowledgeEntries,
      websitePages: websiteSources.pages
    });

    const guardrailQuestionTests = buildGuardrailQuestionTests({
      profile,
      sources,
      defaults: industryDefaults.guardrailQuestionTests,
      knowledgeEntries: preliminaryKnowledgeEntries,
      aiByQuestion
    });

    const emergencyServices = inferEmergencyServices(
      [profile.serviceText, ...preliminaryKnowledgeEntries.map((entry) => entry.contentText), ...guardrailQuestionTests.map((item) => item.answer)].join(". ")
    );
    profile.emergencyServices = emergencyServices;

    const knowledgeEntries = buildKnowledgeEntries({
      profile,
      sources,
      industryDefaults: industryDefaults.knowledgeEntries,
      websitePages: websiteSources.pages
    });
    const siteTopics = await buildSiteTopics({
      websitePages: websiteSources.pages,
      businessName
    });
    const coverageChecklist = buildCoverageChecklist({
      siteTopics,
      guardrailQuestionTests
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

    return res.status(200).json({
      ok: true,
      enrichment: {
        website: normalizedWebsite || "",
        websiteAutofilled: Boolean(!explicitWebsite && derivedWebsite),
        websiteFetched: Boolean(websiteResult.ok),
        googleBusinessProfileFound: Boolean(googleBusinessProfile),
        googleBusinessProfile,
        profile,
        provenance,
        knowledgeEntries,
        guardrailQuestionTests,
        siteTopics,
        coverageChecklist
      }
    });
  } catch (err) {
    return fail(res, 500, "enrichment_preview_error", err?.message || "unknown");
  }
}
