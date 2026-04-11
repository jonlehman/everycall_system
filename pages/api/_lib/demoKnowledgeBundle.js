import { z } from "zod";
import { callOpenAiJsonModel } from "@everycall/contracts";

export const DEMO_BUNDLE_EXTRACTION_VERSION = "ai_v2";

const DEMO_EXTRACTION_MODEL = String(
  process.env.OPENAI_DEMO_EXTRACTION_MODEL
  || process.env.OPENAI_BUILD_JSON_MODEL
  || "gpt-5-mini"
).trim();

const DEMO_EXTRACTION_QUESTIONS = [
  "What is the official business name shown on the website?",
  "In one short sentence, what does this business do?",
  "What are the main services or job types clearly offered?",
  "What service area or locations are clearly mentioned?",
  "What hours or availability are clearly stated?",
  "Does the site clearly say anything about emergency or after-hours service?",
  "Does the site clearly indicate residential, commercial, or both?",
  "What contact methods or contact facts are clearly shown?",
  "What receptionist-safe facts can be stated confidently to a caller?",
  "What topics should the receptionist avoid claiming because the website does not clearly support them?"
];

const demoExtractionSchema = z.object({
  businessName: z.string().min(1),
  businessSummary: z.string().min(1),
  topServices: z.array(z.string().min(1)).max(6),
  serviceArea: z.string(),
  hours: z.string(),
  emergencyAvailability: z.string(),
  customerTypes: z.array(z.string().min(1)).max(3),
  contactFacts: z.array(z.string().min(1)).max(5),
  approvedFacts: z.array(z.string().min(1)).min(3).max(10),
  unsupportedTopics: z.array(z.string().min(1)).max(8)
});

const demoExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    businessName: { type: "string" },
    businessSummary: { type: "string" },
    topServices: {
      type: "array",
      items: { type: "string" },
      maxItems: 6
    },
    serviceArea: { type: "string" },
    hours: { type: "string" },
    emergencyAvailability: { type: "string" },
    customerTypes: {
      type: "array",
      items: { type: "string" },
      maxItems: 3
    },
    contactFacts: {
      type: "array",
      items: { type: "string" },
      maxItems: 5
    },
    approvedFacts: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 10
    },
    unsupportedTopics: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    }
  },
  required: [
    "businessName",
    "businessSummary",
    "topServices",
    "serviceArea",
    "hours",
    "emergencyAvailability",
    "customerTypes",
    "contactFacts",
    "approvedFacts",
    "unsupportedTopics"
  ]
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
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

function splitTitleSegments(value) {
  return uniqueValues(
    String(value || "")
      .split(/\s+[|\-•:–—]\s+/g)
      .map((entry) => normalizeText(entry))
  );
}

function getHostnameLabel(value) {
  const hostname = normalizeText(value)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split(".")[0];
  return normalizeText(hostname).toLowerCase();
}

function getPathname(value) {
  try {
    return new URL(String(value || "")).pathname.toLowerCase();
  } catch {
    return "/";
  }
}

function looksGenericHeading(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return true;
  return [
    "home",
    "about",
    "contact",
    "services",
    "locations",
    "reviews",
    "testimonials",
    "faq",
    "blog"
  ].includes(text);
}

function looksLikeMarketingCopy(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return true;
  if (
    /\b(start free trial|free trial|try everycall|try now|book now|book online|schedule|request demo|get started|learn more|read more|click here|hear a real call|call our demo line|ready to get started)\b/i.test(text)
  ) return true;
  if (
    /\b(stop losing|only pay|want proof|no signup|required|architectural phase|next milestone|work through these items|use cases?|pricing|what missed calls cost|what to expect|common questions|what you will see|train once|callers feel taken care of|if you don't answer|it's not about being the best|where does|you do the job|experience the ai yourself|they feel they reached the right place|used to lose|captured \d+ leads)\b/i.test(text)
  ) return true;
  if (/^(new lead:|live right now\b|free call\b|best for\b)/i.test(text)) return true;
  if (/^\d+%/.test(text)) return true;
  return false;
}

function looksLikeHostnameDecoratedTitle(value, hostnameLabel) {
  const text = normalizeText(value);
  const label = normalizeText(hostnameLabel).toLowerCase();
  if (!text || !label) return false;
  const lowered = text.toLowerCase();
  return (
    lowered.endsWith(`- ${label}`)
    || lowered.endsWith(`– ${label}`)
    || lowered.endsWith(`— ${label}`)
    || lowered.endsWith(`| ${label}`)
    || lowered.endsWith(`: ${label}`)
    || lowered === label
    || lowered === `- ${label}`
    || lowered === `– ${label}`
    || lowered === `— ${label}`
    || lowered === `| ${label}`
  );
}

function looksLikeCorporateOrBrandStructureCopy(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /\b(customer-facing brand|dba|doing business as|llc|inc\.?|corp\.?|corporation|licensed and insured contractor)\b/i.test(text);
}

function looksLikeFormTitleNoise(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /\b(service request form|request form|contact form|estimate request|schedule service|book service)\b/i.test(text);
}

function looksLikeEmergencyMarketingSlogan(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /\b(always ready when you need us most|we'?re always ready when you need us most)\b/i.test(text);
}

function shouldRejectDemoFact(value, { hostnameLabel = "" } = {}) {
  const text = normalizeText(value);
  if (!text) return true;
  if (looksLikeMarketingCopy(text)) return true;
  if (looksLikeFormTitleNoise(text)) return true;
  if (looksLikeCorporateOrBrandStructureCopy(text)) return true;
  if (looksLikeEmergencyMarketingSlogan(text)) return true;
  if (looksLikeHostnameDecoratedTitle(text, hostnameLabel)) return true;
  return false;
}

function sanitizeDemoList(values, options = {}) {
  return uniqueValues(values).filter((value) => !shouldRejectDemoFact(value, options));
}

function sanitizeSummary(summary, fallbackSummary, options = {}) {
  const text = normalizeText(summary);
  if (!text) return normalizeText(fallbackSummary);
  if (shouldRejectDemoFact(text, options)) return normalizeText(fallbackSummary);
  return text;
}

function sanitizeHours(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (shouldRejectDemoFact(text)) return "";
  if (/\b24\/7\b/i.test(text) && !/\b(hours?|open|available|daily)\b/i.test(text)) {
    return "";
  }
  return text;
}

function cleanBusinessNameCandidate(value) {
  return normalizeText(value)
    .replace(/^welcome to\s+/i, "")
    .replace(/^about(?: us)?\s*[|\-•:–—]?\s*/i, "")
    .replace(/^contact(?: us)?\s*[|\-•:–—]?\s*/i, "")
    .replace(/\s+[|\-•:–—]\s+(home|contact|about|services)$/i, "")
    .trim();
}

function looksLikeBusinessDescriptor(value) {
  const text = normalizeText(value);
  if (!text) return false;
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 2 || wordCount > 10) return false;
  if (looksGenericHeading(text) || looksLikeMarketingCopy(text)) return false;
  if (/^[\W_]+$/.test(text)) return false;
  return true;
}

function getRootMeta(scrape) {
  const rootPage = scrape.pages?.[0] || {};
  return rootPage.meta && typeof rootPage.meta === "object" ? rootPage.meta : {};
}

function sameIgnoringCase(left, right) {
  return normalizeText(left).toLowerCase() === normalizeText(right).toLowerCase();
}

function extractBusinessNameHeuristic(scrape) {
  const rootPage = scrape.pages?.[0] || {};
  const rootMeta = getRootMeta(scrape);
  const hostnameLabel = getHostnameLabel(scrape.websiteHostname || scrape.normalizedWebsiteUrl);
  const rawCandidates = [
    { value: rootMeta.ogSiteName, sourceWeight: 100 },
    { value: rootMeta.applicationName, sourceWeight: 95 },
    ...splitTitleSegments(rootPage.title).map((value) => ({ value, sourceWeight: 80 })),
    ...splitTitleSegments(rootMeta.ogTitle).map((value) => ({ value, sourceWeight: 76 })),
    ...((Array.isArray(rootPage.headings) ? rootPage.headings.slice(0, 3) : []).map((value) => ({ value, sourceWeight: 70 }))),
    ...((scrape.pages || []).flatMap((page) => splitTitleSegments(page.title)).slice(0, 6).map((value) => ({ value, sourceWeight: 60 })))
  ];

  const normalizedCandidates = [];
  const seen = new Set();
  for (const entry of rawCandidates) {
    const cleaned = cleanBusinessNameCandidate(entry.value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedCandidates.push({
      value: cleaned,
      sourceWeight: Number(entry.sourceWeight || 0)
    });
  }

  let bestCandidate = "";
  let bestScore = -Infinity;

  for (const candidateEntry of normalizedCandidates) {
    const candidate = candidateEntry.value;
    const wordCount = candidate.split(/\s+/).length;
    if (wordCount < 1 || wordCount > 8) continue;
    if (looksGenericHeading(candidate)) continue;
    if (looksLikeMarketingCopy(candidate)) continue;
    let score = candidateEntry.sourceWeight;
    if (wordCount >= 2) score += 25;
    if (wordCount >= 3 && wordCount <= 6) score += 10;
    if (wordCount === 1) score -= 10;
    if (candidate.toLowerCase() === hostnameLabel) score -= 40;
    if (candidate.toLowerCase().replace(/\s+/g, "") === hostnameLabel) score -= 35;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) return bestCandidate;

  const hostname = normalizeText(scrape.websiteHostname || new URL(scrape.normalizedWebsiteUrl).hostname);
  return hostname
    .replace(/^www\./i, "")
    .split(".")[0]
    .split(/[-_]+/g)
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : "")
    .join(" ")
    .trim() || "This Business";
}

function findFirstMatchingLine(lines, predicate) {
  for (const line of lines || []) {
    if (predicate(line)) return line;
  }
  return "";
}

function collectAllLines(scrape) {
  return uniqueValues((scrape.pages || []).flatMap((page) => Array.isArray(page.lines) ? page.lines : []));
}

function extractServiceArea(lines) {
  return findFirstMatchingLine(lines, (line) => {
    if (looksLikeMarketingCopy(line)) return false;
    return /\b(serving|service area|service areas|located in|based in|throughout)\b/i.test(line);
  });
}

function extractHours(lines) {
  return findFirstMatchingLine(lines, (line) => {
    const text = normalizeText(line);
    if (!text || looksLikeMarketingCopy(text)) return false;
    if (/\bafter hours\b/i.test(text) && !/\b(open|closed|hours?:)\b/i.test(text)) return false;
    if (/\b24\/7\b/i.test(text)) {
      return /\b(hours?|open|available|support|daily|emergency service)\b/i.test(text);
    }
    const hasDayToken = /\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\b/i.test(text);
    const hasHoursWord = /\b(hours?|open|closed)\b/i.test(text);
    const hasTimeToken = /\b\d{1,2}:\d{2}\s?(?:am|pm)?\b/i.test(text)
      || /\b\d{1,2}\s?(?:am|pm)\b/i.test(text);
    return (hasDayToken || hasHoursWord) && hasTimeToken;
  });
}

function extractTitleDescriptors(scrape, businessName) {
  const hostnameLabel = getHostnameLabel(scrape.websiteHostname || scrape.normalizedWebsiteUrl);
  const candidates = [];
  for (const page of scrape.pages || []) {
    const pathname = getPathname(page.url);
    if (/\/(pricing|impact|call-demo|demo|blog|privacy|terms)\b/.test(pathname)) continue;
    for (const segment of splitTitleSegments(page.title)) {
      const cleaned = cleanBusinessNameCandidate(segment);
      if (!looksLikeBusinessDescriptor(cleaned)) continue;
      if (sameIgnoringCase(cleaned, businessName)) continue;
      if (shouldRejectDemoFact(cleaned, { hostnameLabel })) continue;
      candidates.push(cleaned);
    }
  }
  return uniqueValues(candidates);
}

function extractTopServices(scrape, businessName) {
  const hostnameLabel = getHostnameLabel(scrape.websiteHostname || scrape.normalizedWebsiteUrl);
  const titleDescriptors = extractTitleDescriptors(scrape, businessName);
  const headings = uniqueValues(
    (scrape.pages || [])
      .filter((page) => !/\/(pricing|impact|call-demo|demo|blog|privacy|terms)\b/.test(getPathname(page.url)))
      .flatMap((page) => Array.isArray(page.headings) ? page.headings : [])
  );
  const candidates = [];

  for (const descriptor of titleDescriptors) {
    candidates.push(descriptor);
  }

  if (candidates.length < 2) {
    for (const heading of headings) {
      const text = cleanBusinessNameCandidate(heading);
      if (!looksLikeBusinessDescriptor(text)) continue;
      if (sameIgnoringCase(text, businessName)) continue;
      if (shouldRejectDemoFact(text, { hostnameLabel })) continue;
      const wordCount = text.split(/\s+/).length;
      if (wordCount > 8) continue;
      candidates.push(text);
      if (uniqueValues(candidates).length >= 4) break;
    }
  }

  return uniqueValues(candidates).slice(0, 4);
}

function extractContactFacts(lines) {
  const facts = [];
  for (const line of lines || []) {
    if (shouldRejectDemoFact(line)) continue;
    if (/\b(free estimate|free estimates|residential|commercial|licensed|insured|same-day|family-owned|locally owned|emergency service|financing)\b/i.test(line)) {
      facts.push(line);
    }
    if (facts.length >= 4) break;
  }
  return uniqueValues(facts).slice(0, 4);
}

function selectSummaryLine(rootMeta, rootLines, allLines) {
  const metadataCandidates = uniqueValues([
    rootMeta.description,
    rootMeta.ogDescription,
    rootMeta.twitterDescription
  ]);

  for (const candidate of metadataCandidates) {
    const words = candidate.split(/\s+/).length;
    if (words < 6 || words > 36) continue;
    if (/\b(cookie|privacy|terms|copyright|log in|sign in|start free trial|get started)\b/i.test(candidate)) continue;
    return candidate;
  }

  const candidates = uniqueValues([
    ...(rootLines || []),
    ...(allLines || [])
  ]);
  for (const candidate of candidates) {
    const words = candidate.split(/\s+/).length;
    if (words < 6 || words > 28) continue;
    if (looksLikeMarketingCopy(candidate)) continue;
    if (/\b(cookie|privacy|terms|copyright|log in|sign in)\b/i.test(candidate)) continue;
    return candidate;
  }
  return "";
}

function buildFallbackSummary({ businessName, topServices, serviceArea }) {
  const servicePhrase = topServices.length
    ? topServices.slice(0, 3).join(", ")
    : "services";
  if (serviceArea) {
    return `${businessName} provides ${servicePhrase}. ${serviceArea}`;
  }
  return `${businessName} provides ${servicePhrase}.`;
}

function collectGroundingFacts({ rootMeta, topServices, serviceArea, hours, contactFacts, rootLines }) {
  const candidates = uniqueValues([
    rootMeta.description,
    rootMeta.ogDescription,
    ...topServices,
    serviceArea,
    hours,
    ...contactFacts,
    ...(rootLines || [])
  ]);

  return candidates.filter((value) => {
    const text = normalizeText(value);
    if (!text) return false;
    if (shouldRejectDemoFact(text)) return false;
    if (/\b(cookie|privacy|terms|copyright|log in|sign in)\b/i.test(text)) return false;
    if (/^(new lead:|free call\b|live right now\b)/i.test(text)) return false;
    if (/^\w+,\s+\w+\s+\d{1,2}\b/.test(text)) return false;
    if (/\b(ready for service|estimate request|callback am|callback pm)\b/i.test(text)) return false;
    if (/\b(a fast scan of a few public pages|leads while you worked|a short preview|live browser conversation|your live transcript)\b/i.test(text)) return false;
    if (/source:/i.test(text)) return false;
    if (/\b(never miss another opportunity|every lead gets captured|every call gets answered|used to lose|captured \d+ leads)\b/i.test(text)) return false;
    if (/\b\d+x\b/i.test(text)) return false;
    return true;
  }).slice(0, 12);
}

function buildHeuristicDemoKnowledgeBundle(scrape) {
  const pages = Array.isArray(scrape?.pages) ? scrape.pages : [];
  if (!pages.length) {
    throw Object.assign(new Error("No website pages were available for the demo."), {
      code: "demo_content_not_found"
    });
  }

  const businessName = extractBusinessNameHeuristic(scrape);
  const hostnameLabel = getHostnameLabel(scrape.websiteHostname || scrape.normalizedWebsiteUrl);
  const rootMeta = getRootMeta(scrape);
  const allLines = collectAllLines(scrape);
  const rootLines = Array.isArray(pages[0]?.lines) ? pages[0].lines : [];
  const topServices = sanitizeDemoList(extractTopServices(scrape, businessName), { hostnameLabel }).slice(0, 4);
  const serviceArea = extractServiceArea(allLines);
  const hours = sanitizeHours(extractHours(allLines));
  const contactFacts = sanitizeDemoList(extractContactFacts(allLines), { hostnameLabel }).slice(0, 4);
  const fallbackSummary = buildFallbackSummary({ businessName, topServices, serviceArea });
  const summary = sanitizeSummary(
    selectSummaryLine(rootMeta, rootLines, allLines),
    fallbackSummary,
    { hostnameLabel }
  ) || fallbackSummary;
  const groundingFacts = collectGroundingFacts({
    rootMeta,
    topServices,
    serviceArea,
    hours,
    contactFacts,
    rootLines
  });

  const demoBundle = {
    extractionVersion: DEMO_BUNDLE_EXTRACTION_VERSION,
    extractionMethod: "heuristic_fallback",
    extractionQuestions: DEMO_EXTRACTION_QUESTIONS,
    businessName,
    websiteUrl: scrape.normalizedWebsiteUrl,
    websiteOrigin: scrape.websiteOrigin,
    summary,
    topServices,
    serviceArea,
    hours,
    contactFacts,
    groundingFacts,
    unsupportedTopics: [],
    sourcePages: pages.map((page) => ({
      url: page.url,
      title: normalizeText(page.title) || new URL(page.url).hostname
    }))
  };

  return {
    businessName,
    previewSummary: summary,
    demoBundle
  };
}

function truncateLineList(lines, maxItems) {
  return uniqueValues(lines).slice(0, maxItems);
}

function buildExtractionSourceDocument(scrape) {
  const pages = Array.isArray(scrape?.pages) ? scrape.pages : [];
  const blocks = [];

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const isRoot = index === 0;
    const headings = truncateLineList(page.headings || [], isRoot ? 8 : 5);
    const lines = truncateLineList(page.lines || [], isRoot ? 30 : 18);
    const metaParts = [
      normalizeText(page.meta?.description),
      normalizeText(page.meta?.ogTitle),
      normalizeText(page.meta?.ogDescription),
      normalizeText(page.meta?.ogSiteName),
      normalizeText(page.meta?.applicationName)
    ].filter(Boolean);

    blocks.push([
      `PAGE ${index + 1}${isRoot ? " (homepage)" : ""}`,
      `URL: ${normalizeText(page.url)}`,
      `TITLE: ${normalizeText(page.title) || "-"}`,
      metaParts.length ? `META: ${metaParts.join(" | ")}` : "META: -",
      headings.length ? `HEADINGS:\n- ${headings.join("\n- ")}` : "HEADINGS: -",
      lines.length ? `BODY LINES:\n- ${lines.join("\n- ")}` : "BODY LINES: -"
    ].join("\n"));
  }

  return blocks.join("\n\n");
}

function buildExtractionSystemPrompt() {
  return [
    "You extract receptionist-ready business facts from a small crawl of a company's public website.",
    "Answer only from the provided source material.",
    "Do not guess from the domain name alone.",
    "Prefer official business name wording shown in page titles, hero headings, logos referenced in metadata, and repeated branded headings.",
    "Ignore CTA copy, signup prompts, privacy-policy text, blog chrome, admin text, and unrelated marketing widgets.",
    "Do not use page-form titles, hostname-decorated page titles, legal-entity ownership statements, or generic emergency slogans as services, summaries, or approved facts.",
    "For anything not clearly supported by the website, return an empty string or empty array instead of guessing.",
    "Write short receptionist-safe outputs that can be used directly in a prompt."
  ].join("\n");
}

function buildExtractionUserPrompt(scrape) {
  return [
    `Website URL: ${normalizeText(scrape.normalizedWebsiteUrl)}`,
    "",
    "Answer this questionnaire from the website content below:",
    ...DEMO_EXTRACTION_QUESTIONS.map((question, index) => `${index + 1}. ${question}`),
    "",
    "Return structured JSON with these rules:",
    "- businessName: official business name",
    "- businessSummary: one short sentence, 12-30 words",
    "- topServices: short list of clearly offered services or job types",
    "- serviceArea: short phrase or empty string",
    "- hours: short phrase or empty string",
    "- emergencyAvailability: short phrase or empty string",
    "- customerTypes: any of residential, commercial, both, or empty array",
    "- contactFacts: short contact-related facts clearly shown on the site",
    "- approvedFacts: 3-10 receptionist-safe facts clearly supported by the site",
    "- unsupportedTopics: things the receptionist should avoid claiming because they are not clearly supported",
    "",
    "Website source:",
    buildExtractionSourceDocument(scrape)
  ].join("\n");
}

async function extractDemoKnowledgeWithAi(scrape) {
  const result = await callOpenAiJsonModel({
    model: DEMO_EXTRACTION_MODEL,
    system: buildExtractionSystemPrompt(),
    user: buildExtractionUserPrompt(scrape),
    schema: demoExtractionSchema,
    jsonSchemaName: "demo_website_business_extract",
    jsonSchema: demoExtractionJsonSchema,
    maxOutputTokens: 1800,
    promptCacheKey: `demo_extract:${DEMO_BUNDLE_EXTRACTION_VERSION}:${normalizeText(scrape.websiteHostname || scrape.normalizedWebsiteUrl).toLowerCase()}`
  });

  const hostnameLabel = getHostnameLabel(scrape.websiteHostname || scrape.normalizedWebsiteUrl);
  const fallbackBundle = buildHeuristicDemoKnowledgeBundle(scrape);
  const parsed = result.parsed;
  const businessName = normalizeText(parsed.businessName) || extractBusinessNameHeuristic(scrape);
  const summary = sanitizeSummary(parsed.businessSummary, fallbackBundle.previewSummary, { hostnameLabel }) || fallbackBundle.previewSummary;
  const topServices = sanitizeDemoList(parsed.topServices || [], { hostnameLabel }).slice(0, 6);
  const serviceArea = normalizeText(parsed.serviceArea);
  const hours = sanitizeHours(parsed.hours);
  const emergencyAvailability = normalizeText(parsed.emergencyAvailability);
  const customerTypes = uniqueValues(parsed.customerTypes || []).slice(0, 3);
  const contactFacts = sanitizeDemoList(parsed.contactFacts || [], { hostnameLabel }).slice(0, 5);
  const approvedFacts = sanitizeDemoList(parsed.approvedFacts || [], { hostnameLabel }).slice(0, 10);
  const unsupportedTopics = uniqueValues(parsed.unsupportedTopics || []).slice(0, 8);

  return {
    businessName,
    previewSummary: summary,
    demoBundle: {
      extractionVersion: DEMO_BUNDLE_EXTRACTION_VERSION,
      extractionMethod: "ai_questionnaire",
      extractionModel: result.model,
      extractionQuestions: DEMO_EXTRACTION_QUESTIONS,
      extractionUsage: result.usage,
      businessName,
      websiteUrl: scrape.normalizedWebsiteUrl,
      websiteOrigin: scrape.websiteOrigin,
      summary,
      topServices,
      serviceArea,
      hours,
      emergencyAvailability,
      customerTypes,
      contactFacts,
      groundingFacts: approvedFacts,
      approvedFacts,
      unsupportedTopics,
      sourcePages: (scrape.pages || []).map((page) => ({
        url: page.url,
        title: normalizeText(page.title) || new URL(page.url).hostname
      }))
    }
  };
}

export async function buildDemoKnowledgeBundle(scrape) {
  try {
    return await extractDemoKnowledgeWithAi(scrape);
  } catch {
    return buildHeuristicDemoKnowledgeBundle(scrape);
  }
}
