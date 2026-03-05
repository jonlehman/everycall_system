import { ensureTables, getPool } from "../../../_lib/db.js";

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
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    return { ok: true, text: textFromHtml(html).slice(0, 24000) };
  } catch {
    return { ok: false, text: "" };
  }
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .slice(0, 700);
}

function questionKeywords(question) {
  return String(question || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function findEvidenceHeuristic(question, sources) {
  const keys = questionKeywords(question);
  if (!keys.length) return null;
  for (const source of sources) {
    for (const sentence of source.sentences) {
      const lower = sentence.toLowerCase();
      const matches = keys.filter((key) => lower.includes(key)).length;
      const score = Number((matches / Math.max(keys.length, 1)).toFixed(2));
      if (matches >= Math.min(2, keys.length)) {
        return {
          answer: sentence.slice(0, 320),
          sourceType: source.sourceType,
          sourceUrl: source.sourceUrl,
          evidenceSnippet: sentence.slice(0, 200),
          sourceConfidence: score
        };
      }
    }
  }
  return null;
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
    faqs: faqs.map((f) => ({ question: f.question, category: f.category })),
    sources: sourcePayload
  };

  const instruction = [
    "You extract business FAQ answers from source text.",
    "Rules:",
    "1) Answer only when explicit evidence appears in a source sentence.",
    "2) If no explicit evidence exists, return answer as empty string.",
    "3) Return confidence from 0 to 1.",
    "4) Keep answer concise and faithful to evidence.",
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

  for (const query of queryCandidates) {
    try {
      const findUrl = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
      findUrl.searchParams.set("input", query);
      findUrl.searchParams.set("inputtype", "textquery");
      findUrl.searchParams.set("fields", "name,place_id");
      findUrl.searchParams.set("key", apiKey);
      const findResp = await fetchWithTimeout(findUrl.toString(), {}, 8000);
      const findData = await findResp.json().catch(() => null);
      const placeId = findData?.candidates?.[0]?.place_id;
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
        description: result.editorial_summary?.overview || "",
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
      `SELECT question, category
       FROM industry_faqs
       WHERE industry_key = $1
       ORDER BY id ASC`,
      [industry]
    );
    const defaultFaqs = industryFaqRows.rowCount
      ? industryFaqRows.rows
      : (FALLBACK_INDUSTRY_FAQS[industry] || []);

    const websiteResult = normalizedWebsite ? await fetchWebsiteText(normalizedWebsite) : { ok: false, text: "" };

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
    if (websiteResult.ok && websiteResult.text) {
      sources.push({
        sourceType: "website",
        sourceUrl: normalizedWebsite,
        sentences: splitSentences(websiteResult.text)
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
          return {
            question: faq.question,
            category: faq.category || "General",
            answer,
            isIndustryDefault: true,
            sourceType: String(aiMatch.sourceType || "").trim() || null,
            sourceUrl: String(aiMatch.sourceUrl || "").trim() || null,
            sourceRetrievedAt: retrievedAt,
            evidenceSnippet: String(aiMatch.evidenceSnippet || "").trim() || null,
            sourceConfidence: confidence
          };
        }
      }

      const heuristic = findEvidenceHeuristic(faq.question, sources);
      return {
        question: faq.question,
        category: faq.category || "General",
        answer: heuristic?.answer || "",
        isIndustryDefault: true,
        sourceType: heuristic?.sourceType || null,
        sourceUrl: heuristic?.sourceUrl || null,
        sourceRetrievedAt: heuristic ? retrievedAt : null,
        evidenceSnippet: heuristic?.evidenceSnippet || null,
        sourceConfidence: heuristic?.sourceConfidence || null
      };
    });

    return res.status(200).json({
      ok: true,
      enrichment: {
        website: normalizedWebsite || "",
        websiteAutofilled: Boolean(!explicitWebsite && derivedWebsite),
        websiteFetched: Boolean(websiteResult.ok),
        googleBusinessProfileFound: Boolean(googleBusinessProfile),
        googleBusinessProfile,
        defaultFaqCount: defaultFaqs.length,
        faqs
      }
    });
  } catch (err) {
    return fail(res, 500, "enrichment_preview_error", err?.message || "unknown");
  }
}
