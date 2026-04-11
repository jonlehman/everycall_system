import crypto from "node:crypto";
import { scrapeDemoWebsite } from "./demoWebsiteScraper.js";
import { buildDemoKnowledgeBundle, DEMO_BUNDLE_EXTRACTION_VERSION } from "./demoKnowledgeBundle.js";

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

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/\s+/g, " ").slice(0, 60);
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

function normalizeTranscriptItems(items) {
  if (!Array.isArray(items)) return [];
  const output = [];

  for (const item of items) {
    const role = normalizeText(item?.role).toLowerCase();
    const text = normalizeText(item?.text || item?.transcript);
    if (!["assistant", "user"].includes(role) || !text) continue;

    output.push({
      role,
      text,
      itemId: normalizeText(item?.itemId || item?.item_id) || null,
      createdAt: normalizeText(item?.createdAt || item?.created_at) || new Date().toISOString()
    });
  }

  return output.slice(0, 200);
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
    contact: {
      name: normalizeText(row?.contact_name),
      phone: normalizeText(row?.contact_phone),
      email: normalizeEmail(row?.contact_email)
    },
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
  userAgent,
  contactName,
  contactPhone,
  contactEmail,
  reusedFromDemoSessionId = null
}) {
  const ttlHours = Math.max(1, DEMO_SESSION_TTL_HOURS);
  const result = await pool.query(
    `INSERT INTO demo_sessions (
       demo_session_id,
       normalized_website_url,
       website_origin,
       website_hostname,
       status,
       contact_name,
       contact_phone,
       contact_email,
       reused_from_demo_session_id,
       request_ip_hash,
       user_agent,
       expires_at
     )
     VALUES ($1, $2, $3, $4, 'created', $5, $6, $7, $8, $9, $10, NOW() + ($11::text || ' hours')::interval)
     RETURNING *`,
    [
      demoSessionId,
      normalizedWebsiteUrl,
      websiteOrigin,
      websiteHostname,
      normalizeText(contactName) || null,
      normalizePhone(contactPhone) || null,
      normalizeEmail(contactEmail) || null,
      normalizeText(reusedFromDemoSessionId) || null,
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
  if (changes.contactName !== undefined) assign("contact_name", normalizeText(changes.contactName) || null);
  if (changes.contactPhone !== undefined) assign("contact_phone", normalizePhone(changes.contactPhone) || null);
  if (changes.contactEmail !== undefined) assign("contact_email", normalizeEmail(changes.contactEmail) || null);
  if (changes.reusedFromDemoSessionId !== undefined) assign("reused_from_demo_session_id", normalizeText(changes.reusedFromDemoSessionId) || null);
  if (changes.businessName !== undefined) assign("business_name", normalizeText(changes.businessName) || null);
  if (changes.previewSummary !== undefined) assign("preview_summary", normalizeText(changes.previewSummary) || null);
  if (changes.demoBundle !== undefined) assign("demo_bundle_json", serializeJsonValue(changes.demoBundle, {}));
  if (changes.scrapePageCount !== undefined) assign("scrape_page_count", Number(changes.scrapePageCount || 0));
  if (changes.scrapePages !== undefined) assign("scrape_pages_json", serializeJsonValue(changes.scrapePages, []));
  if (changes.transcriptItems !== undefined) assign("transcript_items_json", serializeJsonValue(normalizeTranscriptItems(changes.transcriptItems), []));
  if (changes.failureCode !== undefined) assign("failure_code", normalizeText(changes.failureCode) || null);
  if (changes.failureMessage !== undefined) assign("failure_message", normalizeText(changes.failureMessage) || null);
  if (changes.expiresAt !== undefined) assign("expires_at", changes.expiresAt);

  if (!fields.length) {
    return loadDemoSessionRecord(pool, demoSessionId);
  }

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
  const row = await loadDemoSessionRecord(pool, demoSessionId);
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
       AND COALESCE(demo_bundle_json->>'extractionVersion', '') = $2
       AND expires_at > NOW()
     ORDER BY updated_at DESC
     LIMIT 1`,
    [normalizeText(normalizedWebsiteUrl), DEMO_BUNDLE_EXTRACTION_VERSION]
  );
  return result.rows[0] || null;
}

export async function saveDemoSessionTranscript(pool, demoSessionId, transcriptItems) {
  const existing = await loadDemoSessionRecord(pool, demoSessionId);
  if (!existing) return null;

  const normalizedItems = normalizeTranscriptItems(transcriptItems);
  const updated = await updateDemoSession(pool, demoSessionId, {
    transcriptItems: normalizedItems
  });

  await recordDemoSessionEvent(pool, demoSessionId, "transcript_saved", {
    transcriptItemCount: normalizedItems.length
  });

  return updated;
}

export async function createAndBuildDemoSession(pool, {
  websiteUrl,
  requestIp = "",
  userAgent = "",
  contactName = "",
  contactPhone = "",
  contactEmail = ""
}) {
  const parsedUrl = new URL(String(websiteUrl || ""));
  const normalizedWebsiteUrl = parsedUrl.toString();
  const reusable = await findReusableReadyDemoSession(pool, normalizedWebsiteUrl);

  const demoSessionId = createDemoSessionId();
  await insertDemoSession(pool, {
    demoSessionId,
    normalizedWebsiteUrl,
    websiteOrigin: parsedUrl.origin,
    websiteHostname: parsedUrl.hostname.toLowerCase(),
    requestIp,
    userAgent,
    contactName,
    contactPhone,
    contactEmail,
    reusedFromDemoSessionId: reusable?.demo_session_id || null
  });

  await recordDemoSessionEvent(pool, demoSessionId, "created", {
    normalizedWebsiteUrl,
    contactName: normalizeText(contactName) || null,
    contactPhone: normalizePhone(contactPhone) || null,
    contactEmail: normalizeEmail(contactEmail) || null
  });

  if (reusable) {
    await updateDemoSession(pool, demoSessionId, {
      status: "ready",
      websiteOrigin: reusable.website_origin,
      websiteHostname: reusable.website_hostname,
      businessName: reusable.business_name,
      previewSummary: reusable.preview_summary,
      demoBundle: reusable.demo_bundle_json,
      scrapePageCount: reusable.scrape_page_count,
      scrapePages: reusable.scrape_pages_json,
      failureCode: null,
      failureMessage: null
    });
    await recordDemoSessionEvent(pool, demoSessionId, "reused_from", {
      sourceDemoSessionId: reusable.demo_session_id,
      normalizedWebsiteUrl
    });
    return loadDemoSession(pool, demoSessionId);
  }

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
    const bundle = await buildDemoKnowledgeBundle(scrape);
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
      sourcePageCount: scrape.pageCount,
      extractionMethod: normalizeText(bundle.demoBundle?.extractionMethod),
      extractionVersion: normalizeText(bundle.demoBundle?.extractionVersion)
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

export async function listAdminDemoSessions(pool) {
  const result = await pool.query(
    `SELECT demo_session_id,
            normalized_website_url,
            status,
            contact_name,
            contact_phone,
            contact_email,
            business_name,
            preview_summary,
            failure_code,
            failure_message,
            created_at,
            updated_at,
            jsonb_array_length(COALESCE(transcript_items_json, '[]'::jsonb)) AS transcript_item_count
     FROM demo_sessions
     ORDER BY created_at DESC
     LIMIT 200`
  );

  return result.rows.map((row) => ({
    demoSessionId: normalizeText(row.demo_session_id),
    websiteUrl: normalizeText(row.normalized_website_url),
    status: normalizeText(row.status),
    contactName: normalizeText(row.contact_name),
    contactPhone: normalizePhone(row.contact_phone),
    contactEmail: normalizeEmail(row.contact_email),
    businessName: normalizeText(row.business_name),
    previewSummary: normalizeText(row.preview_summary),
    failureCode: normalizeText(row.failure_code),
    failureMessage: normalizeText(row.failure_message),
    transcriptItemCount: Number(row.transcript_item_count || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }));
}

export async function loadAdminDemoSessionDetail(pool, demoSessionId) {
  const session = await loadDemoSessionRecord(pool, demoSessionId);
  if (!session) return null;

  const eventsResult = await pool.query(
    `SELECT event_type, payload_json, created_at
     FROM demo_session_events
     WHERE demo_session_id = $1
     ORDER BY created_at ASC`,
    [normalizeText(demoSessionId)]
  );

  const demoBundle = session.demo_bundle_json && typeof session.demo_bundle_json === "object"
    ? session.demo_bundle_json
    : {};

  return {
    demoSessionId: normalizeText(session.demo_session_id),
    status: normalizeText(session.status),
    websiteUrl: normalizeText(session.normalized_website_url),
    websiteOrigin: normalizeText(session.website_origin),
    websiteHostname: normalizeText(session.website_hostname),
    businessName: normalizeText(session.business_name),
    previewSummary: normalizeText(session.preview_summary),
    contactName: normalizeText(session.contact_name),
    contactPhone: normalizePhone(session.contact_phone),
    contactEmail: normalizeEmail(session.contact_email),
    reusedFromDemoSessionId: normalizeText(session.reused_from_demo_session_id),
    scrapePageCount: Number(session.scrape_page_count || 0),
    scrapePages: Array.isArray(session.scrape_pages_json) ? session.scrape_pages_json : [],
    sourcePages: Array.isArray(demoBundle.sourcePages) ? demoBundle.sourcePages : [],
    transcriptItems: normalizeTranscriptItems(Array.isArray(session.transcript_items_json) ? session.transcript_items_json : []),
    failureCode: normalizeText(session.failure_code),
    failureMessage: normalizeText(session.failure_message),
    createdAt: session.created_at || null,
    updatedAt: session.updated_at || null,
    events: eventsResult.rows.map((row) => ({
      eventType: normalizeText(row.event_type),
      payload: row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {},
      createdAt: row.created_at || null
    }))
  };
}
