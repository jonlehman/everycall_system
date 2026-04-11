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

function extractBusinessName(scrape) {
  const rootPage = scrape.pages?.[0] || {};
  const rootMeta = getRootMeta(scrape);
  const candidates = uniqueValues([
    rootMeta.ogSiteName,
    rootMeta.applicationName,
    ...splitTitleSegments(rootPage.title),
    ...splitTitleSegments(rootMeta.ogTitle),
    ...(Array.isArray(rootPage.headings) ? rootPage.headings.slice(0, 3) : []),
    ...((scrape.pages || []).flatMap((page) => splitTitleSegments(page.title)).slice(0, 6))
  ]);

  for (const candidate of candidates) {
    const wordCount = candidate.split(/\s+/).length;
    if (wordCount < 1 || wordCount > 8) continue;
    if (looksGenericHeading(candidate)) continue;
    if (looksLikeMarketingCopy(candidate)) continue;
    return candidate;
  }

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
  const candidates = [];
  for (const page of scrape.pages || []) {
    const pathname = getPathname(page.url);
    if (/\/(pricing|impact|call-demo|demo|blog|privacy|terms)\b/.test(pathname)) continue;
    for (const segment of splitTitleSegments(page.title)) {
      if (!looksLikeBusinessDescriptor(segment)) continue;
      if (sameIgnoringCase(segment, businessName)) continue;
      candidates.push(segment);
    }
  }
  return uniqueValues(candidates);
}

function extractTopServices(scrape, businessName) {
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
      const text = normalizeText(heading);
      if (!looksLikeBusinessDescriptor(text)) continue;
      if (sameIgnoringCase(text, businessName)) continue;
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
    if (looksLikeMarketingCopy(line)) continue;
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
    if (looksLikeMarketingCopy(text)) return false;
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

export function buildDemoKnowledgeBundle(scrape) {
  const pages = Array.isArray(scrape?.pages) ? scrape.pages : [];
  if (!pages.length) {
    throw Object.assign(new Error("No website pages were available for the demo."), {
      code: "demo_content_not_found"
    });
  }

  const businessName = extractBusinessName(scrape);
  const rootMeta = getRootMeta(scrape);
  const allLines = collectAllLines(scrape);
  const rootLines = Array.isArray(pages[0]?.lines) ? pages[0].lines : [];
  const topServices = extractTopServices(scrape, businessName);
  const serviceArea = extractServiceArea(allLines);
  const hours = extractHours(allLines);
  const contactFacts = extractContactFacts(allLines);
  const summary = selectSummaryLine(rootMeta, rootLines, allLines)
    || buildFallbackSummary({ businessName, topServices, serviceArea });
  const groundingFacts = collectGroundingFacts({
    rootMeta,
    topServices,
    serviceArea,
    hours,
    contactFacts,
    rootLines
  });

  const demoBundle = {
    businessName,
    websiteUrl: scrape.normalizedWebsiteUrl,
    websiteOrigin: scrape.websiteOrigin,
    summary,
    topServices,
    serviceArea,
    hours,
    contactFacts,
    groundingFacts,
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
