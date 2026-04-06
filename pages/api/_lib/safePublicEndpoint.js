import dns from "dns/promises";
import net from "net";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

function normalizeText(value) {
  return String(value || "").trim();
}

function isLocalDevelopmentHost(hostname) {
  const normalized = normalizeText(hostname).toLowerCase();
  if (!normalized) return false;
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "::1";
}

function isBlockedHostname(hostname) {
  const normalized = normalizeText(hostname).toLowerCase();
  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  if (normalized === "metadata" || normalized === "metadata.google.internal") return true;
  if (normalized === "169.254.169.254") return true;
  return false;
}

function isBlockedIpAddress(address) {
  const normalized = normalizeText(address).toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIpAddress(normalized.slice(7));
  }
  const version = net.isIP(normalized);
  if (version === 4) {
    const parts = normalized.split(".").map((item) => Number.parseInt(item, 10));
    if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item) || item < 0 || item > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe80:")) return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    return false;
  }
  return true;
}

function buildProtocolError() {
  return Object.assign(new Error("Endpoint URL must use HTTPS."), { statusCode: 400 });
}

function buildPublicTargetError() {
  return Object.assign(new Error("Endpoint URL must target a public host."), { statusCode: 400 });
}

function buildResolveError() {
  return Object.assign(new Error("Endpoint URL host could not be resolved."), { statusCode: 400 });
}

function parseEndpointUrl(value) {
  const text = normalizeText(value);
  if (!text) {
    throw Object.assign(new Error("Endpoint URL is required."), { statusCode: 400 });
  }
  try {
    return new URL(text);
  } catch {
    throw Object.assign(new Error("Endpoint URL is invalid."), { statusCode: 400 });
  }
}

async function assertPublicTarget(url) {
  const allowLocalDevelopmentHost = process.env.NODE_ENV !== "production" && isLocalDevelopmentHost(url.hostname);
  if (url.protocol !== "https:" && !(allowLocalDevelopmentHost && url.protocol === "http:")) {
    throw buildProtocolError();
  }
  if (allowLocalDevelopmentHost) {
    return url;
  }
  if (isBlockedHostname(url.hostname)) {
    throw buildPublicTargetError();
  }
  if (net.isIP(url.hostname)) {
    if (isBlockedIpAddress(url.hostname)) {
      throw buildPublicTargetError();
    }
    return url;
  }
  let addresses = [];
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw buildResolveError();
  }
  if (!Array.isArray(addresses) || !addresses.length) {
    throw buildResolveError();
  }
  if (addresses.some((entry) => isBlockedIpAddress(entry?.address))) {
    throw buildPublicTargetError();
  }
  return url;
}

export async function validateSafePublicEndpointUrl(value) {
  const url = parseEndpointUrl(value);
  await assertPublicTarget(url);
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      redirect: "manual",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSafePublicEndpointResponse(url, options = {}) {
  let nextUrl = parseEndpointUrl(url).toString();
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const maxRedirects = Number(options.maxRedirects || DEFAULT_MAX_REDIRECTS) || DEFAULT_MAX_REDIRECTS;
  const fetchOptions = { ...options };
  delete fetchOptions.timeoutMs;
  delete fetchOptions.maxRedirects;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeUrl = await assertPublicTarget(parseEndpointUrl(nextUrl));
    const response = await fetchWithTimeout(safeUrl.toString(), fetchOptions, timeoutMs);
    if (response.status >= 300 && response.status < 400) {
      const location = normalizeText(response.headers.get("location"));
      if (!location) {
        throw Object.assign(new Error("Redirect response did not include a location header."), {
          requestUrl: safeUrl.toString()
        });
      }
      nextUrl = new URL(location, safeUrl).toString();
      continue;
    }
    return {
      response,
      finalUrl: safeUrl.toString()
    };
  }

  throw Object.assign(new Error("Endpoint redirect limit exceeded."), {
    requestUrl: nextUrl
  });
}
