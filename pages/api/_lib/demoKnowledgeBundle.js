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
      .split(/\s+[|\-•:]\s+/g)
      .map((entry) => normalizeText(entry))
  );
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

function extractBusinessName(scrape) {
  const rootPage = scrape.pages?.[0] || {};
  const candidates = uniqueValues([
    ...splitTitleSegments(rootPage.title),
    ...(Array.isArray(rootPage.headings) ? rootPage.headings.slice(0, 3) : []),
    ...((scrape.pages || []).flatMap((page) => splitTitleSegments(page.title)).slice(0, 6))
  ]);

  for (const candidate of candidates) {
    const wordCount = candidate.split(/\s+/).length;
    if (wordCount < 2 || wordCount > 8) continue;
    if (looksGenericHeading(candidate)) continue;
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
  return findFirstMatchingLine(lines, (line) => /\b(serving|service area|service areas|located in|based in|throughout)\b/i.test(line));
}

function extractHours(lines) {
  return findFirstMatchingLine(lines, (line) => /\b(hours|monday|mon-|mon |tuesday|tue-|wednesday|wed-|thursday|thu-|friday|fri-|saturday|sat-|sunday|sun-)\b/i.test(line));
}

function extractTopServices(scrape) {
  const headings = uniqueValues((scrape.pages || []).flatMap((page) => Array.isArray(page.headings) ? page.headings : []));
  const candidates = [];

  for (const heading of headings) {
    const text = normalizeText(heading);
    if (!text || looksGenericHeading(text)) continue;
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 8) continue;
    if (/^(why choose|why us|learn more|get started|request|book|schedule)/i.test(text)) continue;
    candidates.push(text);
  }

  return uniqueValues(candidates).slice(0, 4);
}

function extractContactFacts(lines) {
  const facts = [];
  for (const line of lines || []) {
    if (/\b(free estimate|free estimates|residential|commercial|licensed|insured|same-day|family-owned|locally owned|emergency service|financing)\b/i.test(line)) {
      facts.push(line);
    }
    if (facts.length >= 4) break;
  }
  return uniqueValues(facts).slice(0, 4);
}

function selectSummaryLine(rootLines, allLines) {
  const candidates = uniqueValues([...(rootLines || []), ...(allLines || [])]);
  for (const candidate of candidates) {
    const words = candidate.split(/\s+/).length;
    if (words < 6 || words > 28) continue;
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

export function buildDemoKnowledgeBundle(scrape) {
  const pages = Array.isArray(scrape?.pages) ? scrape.pages : [];
  if (!pages.length) {
    throw Object.assign(new Error("No website pages were available for the demo."), {
      code: "demo_content_not_found"
    });
  }

  const businessName = extractBusinessName(scrape);
  const allLines = collectAllLines(scrape);
  const rootLines = Array.isArray(pages[0]?.lines) ? pages[0].lines : [];
  const topServices = extractTopServices(scrape);
  const serviceArea = extractServiceArea(allLines);
  const hours = extractHours(allLines);
  const contactFacts = extractContactFacts(allLines);
  const summary = selectSummaryLine(rootLines, allLines)
    || buildFallbackSummary({ businessName, topServices, serviceArea });
  const groundingFacts = uniqueValues([
    ...topServices,
    serviceArea,
    hours,
    ...contactFacts,
    ...allLines.slice(0, 8)
  ]).slice(0, 12);

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
