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

function normalizeText(value) {
  return String(value || "").trim();
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

function textFromHtml(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
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
    if (!resp.ok) return { ok: false, html: "", text: "" };
    const html = await resp.text();
    return { ok: true, html, text: textFromHtml(html).slice(0, 24000) };
  } catch {
    return { ok: false, html: "", text: "" };
  }
}

function extractRelevantInternalLinks(baseUrl, html) {
  const source = String(html || "");
  if (!source) return [];
  const base = new URL(baseUrl);
  const matches = Array.from(source.matchAll(/href=["']([^"'#]+)["']/gi));
  const seen = new Set();
  const urls = [];

  for (const match of matches) {
    const href = normalizeText(match[1]);
    if (!href) continue;
    try {
      const resolved = new URL(href, base);
      if (resolved.hostname !== base.hostname) continue;
      const path = resolved.pathname.toLowerCase();
      if (!/(contact|about|service|area|location|pricing|warranty|membership|plan|plumbing|hvac|electrical)/.test(path)) continue;
      const normalized = `${resolved.origin}${resolved.pathname}`.replace(/\/$/, "") || resolved.origin;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    } catch {
      continue;
    }
    if (urls.length >= 8) break;
  }

  return urls;
}

async function fetchRelevantWebsiteSources(baseUrl) {
  const primary = await fetchWebsiteText(baseUrl);
  if (!primary.ok) return { pages: [], combinedText: "" };

  const pages = [{
    sourceType: "website",
    sourceUrl: baseUrl,
    text: primary.text
  }];

  const links = extractRelevantInternalLinks(baseUrl, primary.html);
  for (const link of links) {
    const page = await fetchWebsiteText(link);
    if (!page.ok || !page.text) continue;
    pages.push({
      sourceType: "website",
      sourceUrl: link,
      text: page.text
    });
  }

  return {
    pages,
    combinedText: pages.map((page) => page.text).filter(Boolean).join(" ").slice(0, 80000)
  };
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

function looksLikeNavOrBoilerplate(sentence) {
  const text = String(sentence || "").toLowerCase();
  if (!text.trim()) return true;
  if (text.includes("privacy policy") || text.includes("terms of service") || text.includes("copyright")) return true;
  if ((text.match(/,/g) || []).length >= 8) return true;
  return false;
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

function findSentenceMatchesByKeywords(keywords, sources, limit = 3) {
  const keys = uniqueValues(keywords).map((keyword) => keyword.toLowerCase());
  if (!keys.length) return [];
  const matches = [];
  for (const source of sources || []) {
    for (const sentence of source.sentences || []) {
      if (looksLikeNavOrBoilerplate(sentence)) continue;
      const lower = String(sentence || "").toLowerCase();
      const matchCount = keys.filter((key) => lower.includes(key)).length;
      if (!matchCount) continue;
      matches.push({
        sentence: cleanEvidenceText(sentence),
        sourceType: source.sourceType || "website",
        sourceUrl: source.sourceUrl || null,
        score: matchCount
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
    for (const sentence of source.sentences || []) {
      if (looksLikeNavOrBoilerplate(sentence)) continue;
      const lower = sentence.toLowerCase();
      const matches = keys.filter((key) => lower.includes(key.toLowerCase())).length;
      if (!matches) continue;
      const matchRatio = matches / Math.max(keys.length, 1);
      const score = Number((matchRatio * Math.min(sentence.length / 120, 1)).toFixed(2));
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

function buildKnowledgeEntries({ profile, sources, industryDefaults }) {
  const defaultsBySection = new Map((industryDefaults || []).map((entry) => [entry.sectionType, entry]));
  const templates = createBlankKnowledgeEntries();
  const addressSummary = [profile.address1, profile.city, profile.state, profile.zip].filter(Boolean).join(", ");

  return templates.map((template) => {
    const defaultEntry = defaultsBySection.get(template.sectionType) || template;
    const matches = findSentenceMatchesByKeywords(
      KNOWLEDGE_SECTION_KEYWORDS[template.sectionType] || [],
      sources,
      template.sectionType === "services_and_capabilities" ? 3 : 2
    );
    const matchedText = joinSentences(matches, template.sectionType === "services_and_capabilities" ? 3 : 2);

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
      contentText: matchedText || fallbackText,
      sourceType: matches[0]?.sourceType || fallbackSource.sourceType,
      sourceUrl: matches[0]?.sourceUrl || fallbackSource.sourceUrl,
      sourceConfidence: matches[0]
        ? Number((Math.min(Number(matches[0].score) / 3, 1)).toFixed(2))
        : fallbackSource.sourceConfidence
    };
  });
}

function buildGuardrailQuestionTests({ profile, sources, defaults, knowledgeEntries, aiByQuestion }) {
  const sectionByType = new Map((knowledgeEntries || []).map((entry) => [entry.sectionType, entry]));

  return (defaults || []).map((template) => {
    const aiMatch = aiByQuestion.get(normalizeText(template.questionText));
    if (aiMatch) {
      return {
        ...template,
        answer: normalizeText(aiMatch.answer),
        sourceType: normalizeText(aiMatch.sourceType) || null,
        sourceUrl: normalizeText(aiMatch.sourceUrl) || null,
        sourceConfidence: toNumberOrNull(aiMatch.sourceConfidence)
      };
    }

    const heuristic = findHeuristicMatch(template.questionText, sources, GUARDRAIL_TOPIC_KEYWORDS[template.topic] || []);
    if (heuristic) {
      return {
        ...template,
        answer: normalizeText(heuristic.answer),
        sourceType: normalizeText(heuristic.sourceType) || null,
        sourceUrl: normalizeText(heuristic.sourceUrl) || null,
        sourceConfidence: toNumberOrNull(heuristic.sourceConfidence)
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
      sentences: source.sentences.slice(0, 80)
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
        sentences: splitSentences(page.text)
      });
    }
    if (normalizeText(gbpText)) {
      sources.push({
        sourceType: "google_business_profile",
        sourceUrl: normalizeText(googleBusinessProfile?.url || googleBusinessProfile?.website) || null,
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
      industryDefaults: industryDefaults.knowledgeEntries
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
      industryDefaults: industryDefaults.knowledgeEntries
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
        guardrailQuestionTests
      }
    });
  } catch (err) {
    return fail(res, 500, "enrichment_preview_error", err?.message || "unknown");
  }
}
