const MAX_WEBSITE_PAGES = 500;
const MAX_WEBSITE_FILES = 25;
const CRAWL_BATCH_SIZE = 4;
const FETCH_TIMEOUT_MS = 8000;
const ROOT_URL = "https://hartsservices.com/";

function normalizeText(value) {
  return String(value || "").trim();
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
  if (/\b(policy|policies|terms|privacy|new-patient|insurance|financing|payment|warranty|guarantee)\b/.test(path)) return "policy";
  if (/\/blog\b/.test(path)) return "blog_article";
  if (/\/(services?|repair|replacement|installation)\b/.test(path)) return "service_detail";
  return "unknown_mixed";
}

function extractLocs(xml) {
  return Array.from(String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)).map((match) => normalizeText(match[1]));
}

function extractLinks(baseUrl, html, predicate) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    const normalized = normalizeCrawlUrl(baseUrl, match[1]);
    if (!normalized) continue;
    const parsed = new URL(normalized);
    if (predicate(parsed)) {
      links.push(normalized);
    }
  }
  return Array.from(new Set(links));
}

function extractInternalLinks(baseUrl, html) {
  return extractLinks(baseUrl, html, (url) => !shouldSkipUrl(url) && !isDownloadableUrl(url));
}

function extractDownloadableLinks(baseUrl, html) {
  return extractLinks(baseUrl, html, (url) => isDownloadableUrl(url));
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

async function fetchPage(url) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return { ok: false, url, status: response.status, html: "" };
    }
    return {
      ok: true,
      url,
      status: response.status,
      html: await response.text()
    };
  } catch {
    return { ok: false, url, status: null, html: "" };
  }
}

async function crawlWebsiteSources(rootUrl) {
  const normalizedRootUrl = normalizeWebsiteUrl(rootUrl);
  const firstPage = await fetchPage(normalizedRootUrl);
  if (!firstPage.ok) {
    throw new Error(`website_fetch_failed:${normalizedRootUrl}:${firstPage.status}`);
  }

  const pages = [firstPage.url];
  const pageTypeByUrl = new Map([[firstPage.url, classifyPageType(new URL(firstPage.url))]]);
  const visited = new Set([firstPage.url]);
  const queue = extractInternalLinks(normalizedRootUrl, firstPage.html).slice(0, MAX_WEBSITE_PAGES * 2);
  const discovered = new Set([firstPage.url, ...queue]);
  const downloadableQueue = extractDownloadableLinks(normalizedRootUrl, firstPage.html).slice(0, MAX_WEBSITE_FILES * 2);
  const downloadableSeen = new Set(downloadableQueue);
  const failures = [];

  while (queue.length && pages.length < MAX_WEBSITE_PAGES) {
    const batch = queue.splice(0, CRAWL_BATCH_SIZE);
    const results = await Promise.all(batch.map((url) => fetchPage(url)));
    for (const result of results) {
      if (!result.ok) {
        failures.push({ url: result.url, status: result.status });
        continue;
      }
      if (visited.has(result.url) || !result.html) continue;
      visited.add(result.url);
      pages.push(result.url);
      pageTypeByUrl.set(result.url, classifyPageType(new URL(result.url)));
      for (const url of extractInternalLinks(normalizedRootUrl, result.html)) {
        discovered.add(url);
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
    const results = await Promise.all(batch.map((url) => fetchPage(url)));
    for (const result of results) {
      if (!result.ok) {
        failures.push({ url: result.url, status: result.status });
        continue;
      }
      files.push(result.url);
      if (files.length >= MAX_WEBSITE_FILES) break;
    }
  }

  return {
    pages,
    files,
    discovered: Array.from(discovered),
    pageTypeByUrl,
    failures
  };
}

async function fetchSitemapInventory(rootUrl) {
  const sitemapFiles = ["page-sitemap.xml", "post-sitemap.xml", "job-sitemap.xml", "local-sitemap.xml"];
  const perFileCounts = {};
  const rawUrls = [];
  for (const file of sitemapFiles) {
    const response = await fetchWithTimeout(`https://hartsservices.com/${file}`);
    const urls = extractLocs(await response.text());
    perFileCounts[file] = urls.length;
    rawUrls.push(...urls);
  }
  const normalizedUrls = rawUrls
    .map((url) => normalizeCrawlUrl(rootUrl, url))
    .filter(Boolean);
  const uniqueUrls = Array.from(new Set(normalizedUrls));
  const skippedUrls = uniqueUrls.filter((url) => shouldSkipUrl(new URL(url)));
  return {
    perFileCounts,
    uniqueUrls,
    skippedUrls
  };
}

const crawl = await crawlWebsiteSources(ROOT_URL);
const sitemap = await fetchSitemapInventory(ROOT_URL);
const pageSet = new Set(crawl.pages);
const fileSet = new Set(crawl.files);
const includedSitemapUrls = sitemap.uniqueUrls.filter((url) => pageSet.has(url) || fileSet.has(url));
const missingSitemapUrls = sitemap.uniqueUrls.filter((url) => !pageSet.has(url) && !fileSet.has(url));
const serviceAreaPages = crawl.pages.filter((url) => classifyPageType(new URL(url)) === "service_area");
const faqPages = crawl.pages.filter((url) => classifyPageType(new URL(url)) === "faq");
const pageTypeCounts = crawl.pages.reduce((acc, url) => {
  const key = classifyPageType(new URL(url));
  acc[key] = Number(acc[key] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  crawl: {
    website_pages: crawl.pages.length,
    website_files: crawl.files.length,
    discovered_urls: crawl.discovered.length,
    all_pages: crawl.pages,
    all_files: crawl.files,
    page_type_counts: pageTypeCounts,
    crawl_failures: crawl.failures,
    service_area_pages: serviceAreaPages,
    faq_pages: faqPages,
    forever_warranty_included: pageSet.has("https://hartsservices.com/forever-warranty"),
    financing_included: Array.from(pageSet).some((url) => url.includes("/financing")),
    sample_pages: crawl.pages.slice(0, 50),
    sample_files: crawl.files.slice(0, 25)
  },
  sitemap: {
    per_file_counts: sitemap.perFileCounts,
    total_unique_urls: sitemap.uniqueUrls.length,
    skipped_urls_by_page_filter: sitemap.skippedUrls.length,
    pages_included_from_sitemap_inventory: includedSitemapUrls.length,
    pages_missing_from_sitemap_inventory: missingSitemapUrls.length,
    sample_missing_urls: missingSitemapUrls.slice(0, 200)
  }
}, null, 2));
