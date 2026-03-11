import { ensureTables, getPool } from "../../../_lib/db.js";
import { normalizeFaqCategory } from "../../../_lib/faqCategories.js";

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

const FALLBACK_INDUSTRY_FAQS = {
  plumbing: [
    { question: "What should I do for a burst pipe?", category: "Emergency" },
    { question: "Do you handle drain clogs and backups?", category: "Services" }
  ],
  window_installers: [
    { question: "Do you replace broken glass or only full windows?", category: "Services" },
    { question: "What is the typical lead time for installation?", category: "Scheduling" }
  ],
  electrical: [
    { question: "What should I do if I smell burning or see sparks?", category: "Emergency" },
    { question: "Do you upgrade electrical panels?", category: "Services" }
  ],
  hvac: [
    { question: "What should I do if I have no heat or no cooling?", category: "Emergency" },
    { question: "Do you offer maintenance plans?", category: "Maintenance" }
  ],
  roofing: [
    { question: "Do you handle emergency leaks?", category: "Emergency" },
    { question: "Do you work with insurance claims?", category: "Billing" }
  ],
  landscaping: [
    { question: "Do you offer recurring maintenance?", category: "Maintenance" },
    { question: "Can you handle irrigation issues?", category: "Services" }
  ],
  cleaning: [
    { question: "Do you provide recurring cleanings?", category: "Maintenance" },
    { question: "Do you bring your own supplies?", category: "Services" }
  ],
  pest_control: [
    { question: "Do you offer one-time treatments?", category: "Services" },
    { question: "How soon can you come out for an infestation?", category: "Scheduling" }
  ],
  garage_door: [
    { question: "Do you repair broken springs?", category: "Services" },
    { question: "Do you install new openers?", category: "Services" }
  ],
  general_contractor: [
    { question: "Do you handle permits?", category: "Process" },
    { question: "Can you provide a project timeline?", category: "Scheduling" }
  ],
  locksmith: [
    { question: "Do you offer emergency lockout service?", category: "Emergency" },
    { question: "Can you rekey locks?", category: "Services" }
  ]
};

const STOPWORDS = new Set([
  "what", "when", "where", "which", "with", "from", "your", "this", "that", "have", "do", "does", "only", "they", "them", "into", "about", "would", "could", "should", "offer", "offers"
]);

function normalizeWebsite(website) {
  const raw = String(website || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function domainFromEmail(email) {
  const raw = String(email || "").trim().toLowerCase();
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

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
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
    if (!resp.ok) return { ok: false, text: "" };
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
    const href = String(match[1] || "").trim();
    if (!href) continue;
    try {
      const resolved = new URL(href, base);
      if (resolved.hostname !== base.hostname) continue;
      const path = resolved.pathname.toLowerCase();
      if (!/(contact|about|service|area|location|plumbing|hvac)/.test(path)) continue;
      const normalized = `${resolved.origin}${resolved.pathname}`.replace(/\/$/, "") || resolved.origin;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    } catch {
      continue;
    }
    if (urls.length >= 6) break;
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

function normalizeQuestion(question) {
  return String(question || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function dedupeFaqTemplates(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items || []) {
    const question = String(item?.question || "").trim();
    if (!question) continue;
    const key = normalizeQuestion(question);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      question,
      category: normalizeFaqCategory(item),
      answer: String(item?.answer || "").trim()
    });
  }
  return deduped;
}

function questionKeywords(question) {
  return String(question || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function looksLikeNavOrBoilerplate(sentence) {
  const text = String(sentence || "").toLowerCase();
  if (!text.trim()) return true;
  if (text.includes("privacy policy") || text.includes("terms of service") || text.includes("copyright")) return true;
  if (text.includes("near you") || text.includes("areas areas")) return true;
  if ((text.match(/\b(seattle|downtown|capitol hill|queen anne|belltown|greenwood|wallingford)\b/g) || []).length >= 4) return true;
  const commaCount = (text.match(/,/g) || []).length;
  if (commaCount >= 8) return true;
  return false;
}

function cleanEvidenceText(sentence) {
  return decodeHtmlEntities(String(sentence || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function receptionistStyleAnswer(answer) {
  const text = cleanEvidenceText(answer)
    .replace(/\bwe specialize in\b/gi, "We handle")
    .replace(/\bwe proudly offer\b/gi, "We offer")
    .replace(/\bour team\b/gi, "We")
    .replace(/\bcustomers\b/gi, "you")
    .replace(/\bclients\b/gi, "you");

  if (!text) return "";

  const normalized = text
    .replace(/\bcontact us today\b/gi, "give us a call")
    .replace(/\blearn more\b/gi, "we can share more details")
    .replace(/\bfor more information\b/gi, "for details")
    .replace(/\bstate-of-the-art\b/gi, "")
    .replace(/\btop-quality\b/gi, "quality")
    .replace(/\bhigh-quality\b/gi, "quality")
    .replace(/\btrust the licensed plumbers at .*? to\b/gi, "We can")
    .replace(/\byou can always count on .*? to\b/gi, "We can")
    .replace(/\bour local and reliable plumbers and technicians are just a call away for\b/gi, "We handle")
    .replace(/\bwe offer premium and affordable\b/gi, "We offer")
    .replace(/\bwe take pride in\b/gi, "We")
    .replace(/\bchoosing .*? is choosing peace of mind\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function conversationalizeFaqAnswer(question, answer) {
  const q = String(question || "").trim().toLowerCase();
  let text = cleanEvidenceText(answer);
  if (!text) return "";

  text = text
    .replace(/\bcall us right away\b/gi, "we can help you from here")
    .replace(/\bcall us immediately\b/gi, "we can help you from here")
    .replace(/\bcall us back\b/gi, "we can help you from here")
    .replace(/\bgive us a call\b/gi, "we can help with that")
    .replace(/\bcontact us today\b/gi, "we can help with that")
    .replace(/\bcontact us\b/gi, "we can help with that")
    .replace(/\bthen call\b/gi, "then we can help")
    .replace(/\.\s*we can help you from here$/i, ". We can help you from here.")
    .replace(/\s+/g, " ")
    .trim();

  if (/^what should i do\b/.test(q)) {
    return text;
  }

  if (/^(do|can|are|is|will)\b/.test(q)) {
    if (/^yes\b/i.test(text)) {
      text = text.replace(/^yes[,.]?\s*/i, "Yes, we sure do. ");
    } else if (/^no\b/i.test(text)) {
      text = text.replace(/^no[,.]?\s*/i, "No, we don't. ");
    }

    if (
      /(fix|repair|replace|install|handle|offer|service|rekey|clean|treat|upgrade)/.test(q) &&
      !/[?]$/.test(text)
    ) {
      text = `${text.replace(/[.]\s*$/,"")}. Is that something you'd like help with?`;
    }
  }

  return text;
}

function finalizeFaqAnswer(faq, evidenceAnswer) {
  const templateAnswer = String(faq?.answer || "").trim();
  if (templateAnswer) {
    return conversationalizeFaqAnswer(faq?.question, templateAnswer);
  }

  const question = String(faq?.question || "").trim().toLowerCase();
  const styled = conversationalizeFaqAnswer(question, receptionistStyleAnswer(evidenceAnswer));
  if (!styled) return "";

  if (/^(do|can|are|is|will)\b/.test(question)) {
    if (/^(yes|we can|we do|absolutely)\b/i.test(styled)) return styled;
    return `Yes, ${styled.charAt(0).toLowerCase()}${styled.slice(1)}`;
  }

  return styled;
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
  const gbpName = String(googleBusinessProfile?.name || "").trim();
  if (gbpName) return gbpName;
  const domain = domainFromWebsite(website) || domainFromEmail(ownerEmail);
  if (!domain) return "";
  return titleCaseWords(domain.replace(/\.(com|net|org|biz|co|io|us)$/i, ""));
}

function parseUsAddress(address) {
  const raw = String(address || "").trim().replace(/,\s*USA$/i, "");
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

function findEvidenceHeuristic(question, sources) {
  const keys = questionKeywords(question);
  if (!keys.length) return null;
  let best = null;
  for (const source of sources) {
    for (const sentence of source.sentences) {
      if (looksLikeNavOrBoilerplate(sentence)) continue;
      const lower = sentence.toLowerCase();
      const matches = keys.filter((key) => lower.includes(key)).length;
      const matchRatio = matches / Math.max(keys.length, 1);
      const score = Number((matchRatio * Math.min(sentence.length / 120, 1)).toFixed(2));
      if (matches >= Math.min(2, keys.length)) {
        const candidate = {
          answer: receptionistStyleAnswer(sentence),
          sourceType: source.sourceType,
          sourceUrl: source.sourceUrl,
          evidenceSnippet: cleanEvidenceText(sentence).slice(0, 200),
          sourceConfidence: score
        };
        if (!best || candidate.sourceConfidence > best.sourceConfidence) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const parsedRaw = safeJsonParse(raw);
  if (parsedRaw) return parsedRaw;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return safeJsonParse(raw.slice(start, end + 1));
  }
  return null;
}

async function extractWithAi(faqs, sources) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey || !faqs.length || !sources.length) return null;

  const sourcePayload = sources.map((source) => ({
    sourceType: source.sourceType,
    sourceUrl: source.sourceUrl,
    sentences: source.sentences.slice(0, 60)
  }));

  const prompt = {
    faqs: faqs.map((f) => ({ question: f.question, category: f.category, answer: f.answer || "" })),
    sources: sourcePayload
  };

  const instruction = [
    "You extract business FAQ answers from source text.",
    "Rules:",
    "1) Answer only when explicit evidence appears in a source sentence.",
    "2) If no explicit evidence exists, return answer as empty string.",
    "3) Return confidence from 0 to 1.",
    "4) Keep answer concise and faithful to evidence.",
    "5) Write the answer the way a friendly receptionist would say it on a call, not like website marketing copy.",
    "6) Do not use hype, slogans, exclamation points, or promotional language.",
    "7) Prefer plain spoken phrasing like 'Yes, we can help with that' or 'We can schedule that' when supported by evidence.",
    "Output strict JSON with shape:",
    '{"items":[{"question":"...","answer":"...","sourceType":"website|google_business_profile|null","sourceUrl":"...|null","evidenceSnippet":"...|null","sourceConfidence":0.0}]}'
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
    String(businessName || "").trim(),
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
    const industry = String(body.industry || "").trim();
    if (!industry) return fail(res, 400, "missing_industry", "Industry is required.");

    const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();
    const explicitWebsite = String(body.website || "").trim();
    const derivedWebsite = explicitWebsite ? "" : websiteFromEmail(ownerEmail);
    const normalizedWebsite = normalizeWebsite(explicitWebsite || derivedWebsite);

    const industryFaqRows = await pool.query(
      `SELECT question, answer, category
       FROM industry_faqs
       WHERE industry_key = $1
       ORDER BY id ASC`,
      [industry]
    );
    const defaultFaqsRaw = industryFaqRows.rowCount
      ? industryFaqRows.rows
      : (FALLBACK_INDUSTRY_FAQS[industry] || []);
    const defaultFaqs = dedupeFaqTemplates(defaultFaqsRaw);

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
        businessName: String(body.businessName || "").trim(),
        serviceArea: String(body.serviceArea || "").trim()
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
    if (gbpText.trim()) {
      sources.push({
        sourceType: "google_business_profile",
        sourceUrl: String(googleBusinessProfile?.url || googleBusinessProfile?.website || "").trim() || null,
        sentences: splitSentences(gbpText)
      });
    }

    const aiItems = await extractWithAi(defaultFaqs, sources);
    const aiByQuestion = new Map(
      Array.isArray(aiItems)
        ? aiItems
            .filter((item) => item && typeof item.question === "string")
            .map((item) => [String(item.question).trim(), item])
        : []
    );

    const retrievedAt = new Date().toISOString();
    const faqs = defaultFaqs.map((faq) => {
      const aiMatch = aiByQuestion.get(faq.question);
      if (aiMatch) {
        const confidence = Number.isFinite(Number(aiMatch.sourceConfidence)) ? Number(aiMatch.sourceConfidence) : 0;
        const answer = String(aiMatch.answer || "").trim();
        if (answer && confidence >= 0.6 && String(aiMatch.evidenceSnippet || "").trim()) {
          const cleanedEvidence = cleanEvidenceText(aiMatch.evidenceSnippet || aiMatch.answer || "");
          if (looksLikeNavOrBoilerplate(cleanedEvidence)) {
            return {
              question: faq.question,
              category: normalizeFaqCategory(faq),
              answer: "",
              isIndustryDefault: true,
              sourceType: null,
              sourceUrl: null,
              sourceRetrievedAt: null,
              evidenceSnippet: null,
              sourceConfidence: null
            };
          }
          return {
            question: faq.question,
            category: normalizeFaqCategory(faq),
            answer: finalizeFaqAnswer(faq, answer),
            isIndustryDefault: true,
            sourceType: String(aiMatch.sourceType || "").trim() || null,
            sourceUrl: String(aiMatch.sourceUrl || "").trim() || null,
            sourceRetrievedAt: retrievedAt,
            evidenceSnippet: cleanedEvidence || null,
            sourceConfidence: confidence
          };
        }
      }

      const heuristic = findEvidenceHeuristic(faq.question, sources);
      return {
        question: faq.question,
        category: normalizeFaqCategory(faq),
        answer: heuristic ? finalizeFaqAnswer(faq, heuristic.answer) : "",
        isIndustryDefault: true,
        sourceType: heuristic?.sourceType || null,
        sourceUrl: heuristic?.sourceUrl || null,
        sourceRetrievedAt: heuristic ? retrievedAt : null,
        evidenceSnippet: heuristic?.evidenceSnippet || null,
        sourceConfidence: heuristic?.sourceConfidence || null
      };
    });

    const businessName = guessBusinessName({ googleBusinessProfile, website: normalizedWebsite, ownerEmail });
    const addressText = [websiteResult.text, googleBusinessProfile?.serviceArea].filter(Boolean).join(" ");
    const labeledAddress = extractLabeledAddress(addressText);
    const addressCandidates = extractAddressCandidates(addressText);
    const parsedAddress = parseUsAddress(labeledAddress || addressCandidates[0] || googleBusinessProfile?.serviceArea || "");
    const serviceText = [
      googleBusinessProfile?.description,
      googleBusinessProfile?.services,
      websiteResult.text.slice(0, 10000)
    ].filter(Boolean).join(". ");
    const emergencyServices = inferEmergencyServices([serviceText, ...faqs.map((faq) => faq.answer)].join(". "));
    const profile = {
      businessName,
      phone: String(googleBusinessProfile?.phone || "").trim() || extractPhone(websiteResult.text),
      address1: parsedAddress.address1,
      city: parsedAddress.city,
      state: parsedAddress.state,
      zip: parsedAddress.zip,
      serviceArea: String(googleBusinessProfile?.serviceArea || "").trim(),
      businessHours: String(googleBusinessProfile?.hours || "").trim() || extractBusinessHours(websiteResult.text),
      emergencyServices,
      serviceText
    };

    return res.status(200).json({
      ok: true,
      enrichment: {
        website: normalizedWebsite || "",
        websiteAutofilled: Boolean(!explicitWebsite && derivedWebsite),
        websiteFetched: Boolean(websiteResult.ok),
        googleBusinessProfileFound: Boolean(googleBusinessProfile),
        googleBusinessProfile,
        profile,
        defaultFaqCount: defaultFaqs.length,
        faqs
      }
    });
  } catch (err) {
    return fail(res, 500, "enrichment_preview_error", err?.message || "unknown");
  }
}
