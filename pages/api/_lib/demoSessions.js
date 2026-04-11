import crypto from "node:crypto";
import { scrapeDemoWebsite } from "./demoWebsiteScraper.js";
import { buildDemoKnowledgeBundle } from "./demoKnowledgeBundle.js";

const DEMO_SESSION_TTL_HOURS = readPositiveIntEnv("DEMO_SESSION_TTL_HOURS", 24);

function readPositiveIntEnv(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeHeaderValue(value, maxLength = 240) {
  return normalizeText(value).replace(/[^\x20-\x7E]/g, "").slice(0, maxLength);
}

function createDemoSessionId() {
  return `demo_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function serializeJsonValue(value, fallback) {
  if (value === undefined) return JSON.stringify(fallback);
  return JSON.stringify(value ?? fallback);
}

function hashRequestIp(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const salt = normalizeText(process.env.DEMO_IP_HASH_SALT || process.env.APP_SECRET || "everycall-demo");
  return crypto.createHash("sha256").update(`${salt}|${raw}`, "utf8").digest("hex");
}

function buildPreviewFromBundle(bundle = {}, fallbackWebsiteUrl = "") {
  return {
    businessName: normalizeText(bundle.businessName),
    websiteUrl: normalizeText(bundle.websiteUrl) || normalizeText(fallbackWebsiteUrl),
    summary: normalizeText(bundle.summary),
    topServices: Array.isArray(bundle.topServices) ? bundle.topServices.slice(0, 4) : [],
    serviceArea: normalizeText(bundle.serviceArea),
    hours: normalizeText(bundle.hours),
    contactFacts: Array.isArray(bundle.contactFacts) ? bundle.contactFacts.slice(0, 4) : [],
    sourcePages: Array.isArray(bundle.sourcePages) ? bundle.sourcePages.slice(0, 5) : []
  };
}

function serializeDemoSession(row, { reused = false } = {}) {
  const bundle = row?.demo_bundle_json && typeof row.demo_bundle_json === "object"
    ? row.demo_bundle_json
    : {};
  const status = normalizeText(row?.status) || "created";

  return {
    demoSessionId: normalizeText(row?.demo_session_id),
    status,
    reused,
    expiresAt: row?.expires_at || null,
    preview: status === "ready" ? buildPreviewFromBundle(bundle, row?.normalized_website_url) : null,
    failure: status === "failed"
      ? {
          code: normalizeText(row?.failure_code) || "demo_build_failed",
          message: normalizeText(row?.failure_message) || "Demo build failed."
        }
      : null
  };
}

async function insertDemoSession(pool, {
  demoSessionId,
  normalizedWebsiteUrl,
  websiteOrigin,
  websiteHostname,
  requestIp,
  userAgent
}) {
  const ttlHours = Math.max(1, DEMO_SESSION_TTL_HOURS);
  const result = await pool.query(
    `INSERT INTO demo_sessions (
       demo_session_id,
       normalized_website_url,
       website_origin,
       website_hostname,
       status,
       request_ip_hash,
       user_agent,
       expires_at
     )
     VALUES ($1, $2, $3, $4, 'created', $5, $6, NOW() + ($7::text || ' hours')::interval)
     RETURNING *`,
    [
      demoSessionId,
      normalizedWebsiteUrl,
      websiteOrigin,
      websiteHostname,
      hashRequestIp(requestIp),
      normalizeHeaderValue(userAgent),
      String(ttlHours)
    ]
  );
  return result.rows[0] || null;
}

async function updateDemoSession(pool, demoSessionId, changes = {}) {
  const fields = [];
  const values = [];
  let index = 1;

  const assign = (column, value) => {
    fields.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  };

  if (changes.status !== undefined) assign("status", normalizeText(changes.status));
  if (changes.normalizedWebsiteUrl !== undefined) assign("normalized_website_url", normalizeText(changes.normalizedWebsiteUrl));
  if (changes.websiteOrigin !== undefined) assign("website_origin", normalizeText(changes.websiteOrigin));
  if (changes.websiteHostname !== undefined) assign("website_hostname", normalizeText(changes.websiteHostname));
  if (changes.businessName !== undefined) assign("business_name", normalizeText(changes.businessName) || null);
  if (changes.previewSummary !== undefined) assign("preview_summary", normalizeText(changes.previewSummary) || null);
  if (changes.demoBundle !== undefined) assign("demo_bundle_json", serializeJsonValue(changes.demoBundle, {}));
  if (changes.scrapePageCount !== undefined) assign("scrape_page_count", Number(changes.scrapePageCount || 0));
  if (changes.scrapePages !== undefined) assign("scrape_pages_json", serializeJsonValue(changes.scrapePages, []));
  if (changes.failureCode !== undefined) assign("failure_code", normalizeText(changes.failureCode) || null);
  if (changes.failureMessage !== undefined) assign("failure_message", normalizeText(changes.failureMessage) || null);
  if (changes.expiresAt !== undefined) assign("expires_at", changes.expiresAt);

  fields.push("updated_at = NOW()");
  values.push(demoSessionId);

  const result = await pool.query(
    `UPDATE demo_sessions
     SET ${fields.join(", ")}
     WHERE demo_session_id = $${values.length}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

export async function recordDemoSessionEvent(pool, demoSessionId, eventType, payload = {}) {
  await pool.query(
    `INSERT INTO demo_session_events (
       demo_session_id,
       event_type,
       payload_json
     )
     VALUES ($1, $2, $3::jsonb)`,
    [demoSessionId, normalizeText(eventType), serializeJsonValue(payload, {})]
  );
}

async function markSessionExpiredIfNeeded(pool, demoSessionId) {
  await pool.query(
    `UPDATE demo_sessions
     SET status = 'expired',
         updated_at = NOW()
     WHERE demo_session_id = $1
       AND expires_at <= NOW()
       AND status <> 'expired'`,
    [demoSessionId]
  );
}

export async function loadDemoSession(pool, demoSessionId) {
  const normalizedId = normalizeText(demoSessionId);
  if (!normalizedId) return null;
  await markSessionExpiredIfNeeded(pool, normalizedId);
  const result = await pool.query(
    `SELECT *
     FROM demo_sessions
     WHERE demo_session_id = $1
     LIMIT 1`,
    [normalizedId]
  );
  const row = result.rows[0] || null;
  return row ? serializeDemoSession(row) : null;
}

export async function loadDemoSessionRecord(pool, demoSessionId) {
  const normalizedId = normalizeText(demoSessionId);
  if (!normalizedId) return null;
  await markSessionExpiredIfNeeded(pool, normalizedId);
  const result = await pool.query(
    `SELECT *
     FROM demo_sessions
     WHERE demo_session_id = $1
     LIMIT 1`,
    [normalizedId]
  );
  return result.rows[0] || null;
}

async function findReusableReadyDemoSession(pool, normalizedWebsiteUrl) {
  const result = await pool.query(
    `SELECT *
     FROM demo_sessions
     WHERE normalized_website_url = $1
       AND status = 'ready'
       AND expires_at > NOW()
     ORDER BY updated_at DESC
     LIMIT 1`,
    [normalizeText(normalizedWebsiteUrl)]
  );
  return result.rows[0] || null;
}

export async function createAndBuildDemoSession(pool, {
  websiteUrl,
  requestIp = "",
  userAgent = ""
}) {
  const parsedUrl = new URL(String(websiteUrl || ""));
  const normalizedWebsiteUrl = parsedUrl.toString();
  const reusable = await findReusableReadyDemoSession(pool, normalizedWebsiteUrl);
  if (reusable) {
    await recordDemoSessionEvent(pool, reusable.demo_session_id, "reused", {
      normalizedWebsiteUrl
    });
    return serializeDemoSession(reusable, { reused: true });
  }

  const demoSessionId = createDemoSessionId();
  await insertDemoSession(pool, {
    demoSessionId,
    normalizedWebsiteUrl,
    websiteOrigin: parsedUrl.origin,
    websiteHostname: parsedUrl.hostname.toLowerCase(),
    requestIp,
    userAgent
  });

  await recordDemoSessionEvent(pool, demoSessionId, "created", {
    normalizedWebsiteUrl
  });

  await updateDemoSession(pool, demoSessionId, {
    status: "scraping"
  });
  await recordDemoSessionEvent(pool, demoSessionId, "scrape_started", {});

  const scrape = await scrapeDemoWebsite(normalizedWebsiteUrl);
  if (!scrape.ok) {
    await updateDemoSession(pool, demoSessionId, {
      status: "failed",
      failureCode: scrape.failureCode,
      failureMessage: scrape.failureMessage
    });
    await recordDemoSessionEvent(pool, demoSessionId, "scrape_failed", {
      failureCode: scrape.failureCode,
      failureMessage: scrape.failureMessage
    });
    return loadDemoSession(pool, demoSessionId);
  }

  await updateDemoSession(pool, demoSessionId, {
    status: "summarizing",
    normalizedWebsiteUrl: scrape.normalizedWebsiteUrl,
    websiteOrigin: scrape.websiteOrigin,
    websiteHostname: scrape.websiteHostname,
    scrapePageCount: scrape.pageCount,
    scrapePages: scrape.scrapePages
  });
  await recordDemoSessionEvent(pool, demoSessionId, "scrape_ready", {
    pageCount: scrape.pageCount,
    durationMs: scrape.durationMs
  });

  try {
    const bundle = buildDemoKnowledgeBundle(scrape);
    await updateDemoSession(pool, demoSessionId, {
      status: "ready",
      businessName: bundle.businessName,
      previewSummary: bundle.previewSummary,
      demoBundle: bundle.demoBundle,
      failureCode: null,
      failureMessage: null
    });
    await recordDemoSessionEvent(pool, demoSessionId, "ready", {
      businessName: bundle.businessName,
      sourcePageCount: scrape.pageCount
    });
  } catch (err) {
    const failureCode = normalizeText(err?.code) || "demo_bundle_failed";
    const failureMessage = normalizeText(err?.message) || "Unable to build the demo bundle.";
    await updateDemoSession(pool, demoSessionId, {
      status: "failed",
      failureCode,
      failureMessage
    });
    await recordDemoSessionEvent(pool, demoSessionId, "bundle_failed", {
      failureCode,
      failureMessage
    });
  }

  return loadDemoSession(pool, demoSessionId);
}
