import { performance } from "node:perf_hooks";
import { validateSafePublicEndpointUrl } from "./safePublicEndpoint.js";

const MAX_DEMO_HTML_PAGES = readPositiveIntEnv("DEMO_MAX_HTML_PAGES", 5);
const DEMO_FETCH_TIMEOUT_MS = readPositiveIntEnv("DEMO_FETCH_TIMEOUT_MS", 4000);
const DEMO_CRAWL_DEADLINE_MS = readPositiveIntEnv("DEMO_CRAWL_DEADLINE_MS", 15000);
const DEMO_INITIAL_FETCH_MAX_ATTEMPTS = readPositiveIntEnv("DEMO_INITIAL_FETCH_MAX_ATTEMPTS", 3);
const DEMO_INITIAL_FETCH_RETRY_DELAY_MS = readPositiveIntEnv("DEMO_INITIAL_FETCH_RETRY_DELAY_MS", 500);
const DEMO_MAX_HTML_BYTES = readPositiveIntEnv("DEMO_MAX_HTML_BYTES", 750 * 1024);
const DEMO_MAX_REDIRECTS = 5;
const DEFAULT_DEMO_FETCH_USER_AGENT = String(
  process.env.DEMO_FETCH_USER_AGENT
  || "EveryCall Demo Build"
).trim();

function readPositiveIntEnv(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim();
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

function parseHtmlAttributes(tagText) {
  const attributes = {};
  for (const match of String(tagText || "").matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const key = String(match[1] || "").toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (!key || !value) continue;
    attributes[key] = decodeHtmlEntities(normalizeText(value));
  }
  return attributes;
}

function cleanLineText(value) {
  return decodeHtmlEntities(normalizeText(value))
    .replace(/\s+/g, " ")
    .replace(/\s*([|>])+?\s*/g, " ")
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

export function normalizeDemoWebsiteUrlInput(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  url.hash = "";
  return url.toString();
}

export async function validateDemoWebsiteUrl(value) {
  try {
    const normalized = normalizeDemoWebsiteUrlInput(value);
    if (!normalized) {
      throw Object.assign(new Error("A public website URL is required."), {
        code: "website_url_invalid",
        statusCode: 400
      });
    }
    return await validateSafePublicEndpointUrl(normalized);
  } catch (err) {
    throw Object.assign(new Error(String(err?.message || "Endpoint URL is invalid.")), {
      code: "website_url_invalid",
      statusCode: Number(err?.statusCode || 400) || 400
    });
  }
}

function extractTagTextList(html, tagName) {
  return Array.from(String(html || "").matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi")))
    .map((match) => cleanLineText(match[1].replace(/<[^>]+>/g, " ")))
    .filter(Boolean);
}

function extractMetaMap(html) {
  const meta = {
    description: "",
    ogTitle: "",
    ogDescription: "",
    ogSiteName: "",
    applicationName: "",
    twitterTitle: "",
    twitterDescription: ""
  };

  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseHtmlAttributes(match[0]);
    const content = cleanLineText(attributes.content || "");
    if (!content) continue;

    const nameKey = String(attributes.name || "").toLowerCase();
    const propertyKey = String(attributes.property || "").toLowerCase();

    if (nameKey === "description" && !meta.description) meta.description = content;
    if (nameKey === "application-name" && !meta.applicationName) meta.applicationName = content;
    if (nameKey === "twitter:title" && !meta.twitterTitle) meta.twitterTitle = content;
    if (nameKey === "twitter:description" && !meta.twitterDescription) meta.twitterDescription = content;
    if (propertyKey === "og:title" && !meta.ogTitle) meta.ogTitle = content;
    if (propertyKey === "og:description" && !meta.ogDescription) meta.ogDescription = content;
    if (propertyKey === "og:site_name" && !meta.ogSiteName) meta.ogSiteName = content;
  }

  return meta;
}

function looksLikeBoilerplate(line) {
  const text = normalizeText(line).toLowerCase();
  if (!text) return true;
  if (text.includes("privacy policy") || text.includes("terms of service")) return true;
  if (text.includes("cookie policy") || text.includes("copyright")) return true;
  if (text.includes("book online") || text.includes("call today")) return true;
  if (text.includes("all rights reserved")) return true;
  return false;
}

export function extractStructuredPageContent(html) {
  const source = String(html || "");
  const title = cleanLineText(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const meta = extractMetaMap(source);
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || source;
  const stripped = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");

  const headings = uniqueValues([
    ...extractTagTextList(stripped, "h1"),
    ...extractTagTextList(stripped, "h2"),
    ...extractTagTextList(stripped, "h3")
  ]).slice(0, 12);

  const lines = decodeHtmlEntities(
    stripped
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(main|article|section|header|footer|nav|aside|form|address|div|p|ul|ol|li|table|tr|td|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<(main|article|section|header|footer|nav|aside|form|address|div|p|ul|ol|li|table|tr|td|h1|h2|h3|h4|h5|h6)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\n+/)
    .map(cleanLineText)
    .filter((line) => line && !looksLikeBoilerplate(line));

  return {
    title,
    meta,
    headings,
    lines,
    text: lines.join("\n")
  };
}

function normalizeCrawlUrl(baseOrigin, href) {
  try {
    const resolved = new URL(href, baseOrigin);
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    if (resolved.origin !== new URL(baseOrigin).origin) return null;
    resolved.hash = "";
    resolved.search = "";
    let pathname = resolved.pathname.replace(/\/{2,}/g, "/");
    pathname = pathname.replace(/\/index\.(html?|php|asp|aspx)$/i, "/");
    pathname = pathname.replace(/\/$/, "") || "/";
    return `${resolved.origin}${pathname}`;
  } catch {
    return null;
  }
}

function shouldSkipUrl(url) {
  const path = String(url.pathname || "").toLowerCase();
  return /\.(jpg|jpeg|png|webp|svg|gif|pdf|xml|zip|mp4|mp3|mov|avi|webm|woff2?|ttf|eot|css|js|json)$/i.test(path)
    || /\/(wp-json|cart|checkout|login|account|portal|admin|dashboard|blog|privacy|terms|policy|policies|search)\b/.test(path);
}

function scoreDemoLink(urlText) {
  const url = new URL(urlText);
  const path = String(url.pathname || "/").toLowerCase();
  let score = 0;
  if (path === "/" || path === "") score += 1000;
  if (/\/(services?|service)\b/.test(path)) score += 160;
  if (/\/(about|about-us|company)\b/.test(path)) score += 120;
  if (/\/(contact|contact-us|get-in-touch)\b/.test(path)) score += 90;
  if (/\/(locations?|service-area|service-areas)\b/.test(path)) score += 80;
  if (/\/(faq|faqs|hours)\b/.test(path)) score += 70;
  score -= Math.max(0, path.split("/").filter(Boolean).length - 1) * 8;
  score -= path.length;
  return score;
}

function extractLinkInventory(baseUrl, html) {
  const source = String(html || "");
  const seen = new Set();
  const pageLinks = [];
  for (const match of source.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    const rawHref = normalizeText(match[1]);
    const normalized = normalizeCrawlUrl(baseUrl, rawHref);
    if (!normalized || seen.has(normalized)) continue;
    const url = new URL(normalized);
    if (shouldSkipUrl(url)) continue;
    seen.add(normalized);
    pageLinks.push(normalized);
  }
  return pageLinks;
}

async function fetchWithTimeout(url, timeoutMs = DEMO_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": DEFAULT_DEMO_FETCH_USER_AGENT,
        "accept": "text/html,application/xhtml+xml"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSafeResponse(url, { allowedOrigin = null, timeoutMs = DEMO_FETCH_TIMEOUT_MS, maxRedirects = DEMO_MAX_REDIRECTS } = {}) {
  let nextUrl = String(url || "");
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeUrl = await validateSafePublicEndpointUrl(nextUrl);
    if (allowedOrigin && new URL(safeUrl).origin !== allowedOrigin) {
      throw new Error("website_redirect_origin_not_allowed");
    }
    const response = await fetchWithTimeout(safeUrl, timeoutMs);
    if (response.status >= 300 && response.status < 400) {
      const location = normalizeText(response.headers.get("location"));
      if (!location) {
        throw new Error("website_redirect_missing_location");
      }
      const redirected = new URL(location, safeUrl).toString();
      if (allowedOrigin && new URL(redirected).origin !== allowedOrigin) {
        throw new Error("website_redirect_origin_not_allowed");
      }
      nextUrl = redirected;
      continue;
    }
    return {
      response,
      finalUrl: safeUrl
    };
  }
  throw new Error("website_redirect_limit_exceeded");
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

function formatWebsiteFetchFailureReason(failure = {}) {
  const reason = normalizeText(failure.failureReason || "").toLowerCase();
  const status = Number(failure.status || 0);
  if (reason.startsWith("http_")) {
    const code = Number.parseInt(reason.slice(5), 10);
    if (Number.isFinite(code) && code === 403) {
      return "HTTP 403 (your site is either down or is preventing EveryCall from crawling it)";
    }
    return Number.isFinite(code) ? `HTTP ${code}` : reason;
  }
  if (Number.isFinite(status) && status > 0) {
    if (status === 403) {
      return "HTTP 403 (your site is either down or is preventing EveryCall from crawling it)";
    }
    return `HTTP ${status}`;
  }
  if (reason === "aborterror") return "Request timed out";
  if (reason === "website_response_too_large") return "Response exceeded the website fetch size limit";
  if (reason === "website_redirect_origin_not_allowed") return "Redirect left the approved website origin";
  if (reason === "website_redirect_limit_exceeded") return "Redirect limit exceeded";
  if (reason === "website_redirect_missing_location") return "Redirect response missing location";
  return cleanLineText(reason) || "Fetch failed";
}

async function fetchDemoWebsitePage(url, options = {}) {
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
        meta: {},
        headings: [],
        lines: [],
        text: ""
      };
    }

    const contentType = normalizeText(response.headers.get("content-type")).toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return {
        ok: false,
        status: response.status,
        failureReason: "website_response_not_html",
        url: finalUrl,
        html: "",
        title: "",
        meta: {},
        headings: [],
        lines: [],
        text: ""
      };
    }

    const html = (await readResponseBufferWithLimit(response, DEMO_MAX_HTML_BYTES)).toString("utf8");
    const structured = extractStructuredPageContent(html);
    return {
      ok: true,
      status: response.status,
      url: finalUrl,
      html,
      title: structured.title,
      meta: structured.meta,
      headings: structured.headings,
      lines: structured.lines,
      text: structured.text
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      failureReason: normalizeText(err?.name || err?.message || "fetch_failed") || "fetch_failed",
      url: String(url || ""),
      html: "",
      title: "",
      meta: {},
      headings: [],
      lines: [],
      text: ""
    };
  }
}

function createStoredPageSummary(page) {
  return {
    url: page.url,
    title: page.title,
    description: normalizeText(page.meta?.description || page.meta?.ogDescription || ""),
    headings: Array.isArray(page.headings) ? page.headings.slice(0, 6) : [],
    excerpt: Array.isArray(page.lines) ? page.lines.slice(0, 2).join(" ") : ""
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

export async function scrapeDemoWebsite(inputUrl) {
  const startedAt = performance.now();
  const normalizedInput = await validateDemoWebsiteUrl(inputUrl);

  const rootFailures = [];
  let rootPage = null;

  for (let attempt = 1; attempt <= DEMO_INITIAL_FETCH_MAX_ATTEMPTS; attempt += 1) {
    const result = await fetchDemoWebsitePage(normalizedInput, { timeoutMs: DEMO_FETCH_TIMEOUT_MS });
    if (result.ok) {
      rootPage = result;
      break;
    }
    rootFailures.push(formatWebsiteFetchFailureReason(result));
    if (attempt < DEMO_INITIAL_FETCH_MAX_ATTEMPTS) {
      await sleep(DEMO_INITIAL_FETCH_RETRY_DELAY_MS);
    }
  }

  if (!rootPage) {
    const lastFailure = rootFailures[rootFailures.length - 1] || "Fetch failed";
    return {
      ok: false,
      failureCode: "website_fetch_failed",
      failureMessage: `Website fetch failed after ${DEMO_INITIAL_FETCH_MAX_ATTEMPTS} attempts: ${lastFailure}`
    };
  }

  const crawlOrigin = new URL(rootPage.url).origin;
  const pages = [rootPage];
  const visited = new Set([rootPage.url]);
  const deadlineAt = performance.now() + DEMO_CRAWL_DEADLINE_MS;

  const candidateLinks = extractLinkInventory(rootPage.url, rootPage.html)
    .filter((url) => !visited.has(url))
    .sort((left, right) => scoreDemoLink(right) - scoreDemoLink(left));

  for (const candidateUrl of candidateLinks) {
    if (pages.length >= MAX_DEMO_HTML_PAGES) break;
    if (performance.now() >= deadlineAt) break;
    visited.add(candidateUrl);
    const page = await fetchDemoWebsitePage(candidateUrl, {
      allowedOrigin: crawlOrigin,
      timeoutMs: DEMO_FETCH_TIMEOUT_MS
    });
    if (!page.ok) continue;
    pages.push(page);
  }

  return {
    ok: true,
    normalizedWebsiteUrl: rootPage.url,
    websiteOrigin: crawlOrigin,
    websiteHostname: new URL(rootPage.url).hostname.toLowerCase(),
    pageCount: pages.length,
    pages,
    scrapePages: pages.map(createStoredPageSummary),
    durationMs: Math.round(performance.now() - startedAt)
  };
}
