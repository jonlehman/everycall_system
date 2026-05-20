import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueValues(values) {
  return [...new Set((values || []).map(normalizeText).filter(Boolean))];
}

function hashWithSalt(value, salt) {
  const raw = normalizeText(value);
  const normalizedSalt = normalizeText(salt);
  if (!raw || !normalizedSalt) return "";
  return crypto.createHash("sha256").update(`${normalizedSalt}|${raw}`, "utf8").digest("hex");
}

function hashDemoIp(value) {
  const salt = normalizeText(process.env.DEMO_IP_HASH_SALT || process.env.APP_SECRET || "everycall-demo");
  return hashWithSalt(value, salt);
}

function hashSarahIpCandidates(value) {
  return uniqueValues([
    process.env.CD_LEGACY_AI_IP_HASH_SALT,
    process.env.LEGACY_AI_IP_HASH_SALT,
    process.env.CREATIVE_DYNAMIC_APP_SECRET,
    process.env.APP_SECRET,
    "creative-dynamic"
  ].map((salt) => hashWithSalt(value, salt)));
}

export function normalizeMarketingIpHashes(values) {
  return uniqueValues(values).filter((value) => /^[a-f0-9]{64}$/i.test(value));
}

export function buildMarketingActivityIpFilter({ currentIp = "" } = {}) {
  const ip = normalizeText(currentIp);
  if (!ip) {
    return {
      enabled: false,
      demoIpHashes: [],
      sarahIpHashes: []
    };
  }

  return {
    enabled: true,
    demoIpHashes: normalizeMarketingIpHashes([hashDemoIp(ip)]),
    sarahIpHashes: normalizeMarketingIpHashes(hashSarahIpCandidates(ip))
  };
}

function numberValue(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function recommendationTitle(recommendation) {
  if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) return "";
  return normalizeText(recommendation.reportTitle || recommendation.projectName || recommendation.projectTitle);
}

function getCreativeDynamicPool() {
  const connectionString = normalizeText(
    process.env.CD_SITE_DATABASE_URL
    || process.env.CREATIVE_DYNAMIC_DATABASE_URL
    || process.env.CD_LEGACY_AI_DATABASE_URL
  );
  if (!connectionString) return null;

  if (!globalThis.__creativeDynamicMarketingPool) {
    globalThis.__creativeDynamicMarketingPool = new Pool({
      connectionString,
      ssl: connectionString.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30_000
    });
  }
  return globalThis.__creativeDynamicMarketingPool;
}

function aggregateSarah(items) {
  return {
    total30d: items.length,
    reportsReady: items.filter((item) => item.status === "recommendation_ready" || item.status === "email_sent").length,
    emailsSent: items.filter((item) => item.emailStatus === "sent" || item.status === "email_sent").length,
    followUps: items.filter((item) => item.followUpRequested).length
  };
}

function aggregateFencing(items) {
  return {
    total30d: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    connected: items.filter((item) => item.connected).length,
    transcripts: items.filter((item) => item.transcriptItemCount > 0).length
  };
}

function serializeSarah(row) {
  const recommendation = row.recommendation_json && typeof row.recommendation_json === "object"
    ? row.recommendation_json
    : {};
  const extracted = row.extracted_intake_json && typeof row.extracted_intake_json === "object"
    ? row.extracted_intake_json
    : {};
  const title = recommendationTitle(recommendation) || "Sarah AI intake";
  const email = normalizeEmail(row.visitor_email);
  const name = normalizeText(row.visitor_name);
  const company = normalizeText(row.visitor_company);

  return {
    id: normalizeText(row.id),
    source: "sarah_intake",
    sourceLabel: "Sarah AI intake",
    title,
    subtitle: company || normalizeText(row.source_page) || "Creative Dynamic AI page",
    contactName: name,
    contactEmail: email,
    status: normalizeText(row.status) || "started",
    emailStatus: normalizeText(row.email_status),
    followUpRequested: Boolean(extracted.followUpRequested),
    transcriptItemCount: numberValue(row.transcript_item_count),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function serializeFencing(row) {
  const connected = Boolean(row.connected);
  const transcriptItemCount = numberValue(row.transcript_item_count);
  return {
    id: normalizeText(row.demo_session_id),
    source: "fencing_demo",
    sourceLabel: "Fencing live demo",
    title: normalizeText(row.business_name) || normalizeText(row.normalized_website_url) || "Website demo",
    subtitle: normalizeText(row.normalized_website_url),
    contactName: normalizeText(row.contact_name),
    contactEmail: normalizeEmail(row.contact_email),
    contactPhone: normalizeText(row.contact_phone),
    status: normalizeText(row.status) || "created",
    connected,
    transcriptItemCount,
    sourcePage: normalizeText(row.source_page),
    sourceUrl: normalizeText(row.source_url),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    href: `/admin/demo-sessions?session=${encodeURIComponent(normalizeText(row.demo_session_id))}`
  };
}

export async function loadSarahMarketingActivity({
  limit = 50,
  excludedIpHashes = [],
  excludeMissingIpHash = false,
  excludeRepeatIpHashMin = 0
} = {}) {
  const pool = getCreativeDynamicPool();
  if (!pool) {
    return {
      configured: false,
      message: "Set CD_SITE_DATABASE_URL to include Creative Dynamic Sarah intakes.",
      items: [],
      summary: aggregateSarah([])
    };
  }

  const values = [Math.min(Math.max(Number(limit) || 50, 1), 500)];
  const excludedHashes = normalizeMarketingIpHashes(excludedIpHashes);
  let ipFilterClause = "";
  if (excludedHashes.length) {
    values.push(excludedHashes);
    ipFilterClause = `AND (request_ip_hash IS NULL OR NOT (request_ip_hash = ANY($${values.length}::text[])))`;
  }
  if (excludeMissingIpHash) {
    ipFilterClause = `${ipFilterClause} AND request_ip_hash IS NOT NULL AND request_ip_hash <> ''`;
  }
  const repeatMin = Number(excludeRepeatIpHashMin || 0);
  if (Number.isFinite(repeatMin) && repeatMin > 1) {
    values.push(Math.round(repeatMin));
    ipFilterClause = `${ipFilterClause}
       AND (
         request_ip_hash IS NULL
         OR request_ip_hash NOT IN (
           SELECT request_ip_hash
           FROM legacy_ai_interactions
           WHERE created_at >= NOW() - INTERVAL '30 days'
             AND (
               COALESCE(source_page, '') ILIKE '%legacy-software-ai-integration%'
               OR COALESCE(source_page, '') ILIKE '%ai-workflow-consulting%'
             )
             AND request_ip_hash IS NOT NULL
             AND request_ip_hash <> ''
           GROUP BY request_ip_hash
           HAVING COUNT(*) >= $${values.length}
         )
       )`;
  }

  const result = await pool.query(
    `SELECT id,
            status,
            source_page,
            visitor_email,
            visitor_name,
            visitor_company,
            extracted_intake_json,
            recommendation_json,
            email_status,
            created_at,
            updated_at,
            jsonb_array_length(COALESCE(transcript_items_json, '[]'::jsonb)) AS transcript_item_count
     FROM legacy_ai_interactions
     WHERE created_at >= NOW() - INTERVAL '30 days'
       AND (
         COALESCE(source_page, '') ILIKE '%legacy-software-ai-integration%'
         OR COALESCE(source_page, '') ILIKE '%ai-workflow-consulting%'
       )
       ${ipFilterClause}
     ORDER BY created_at DESC
     LIMIT $1`,
    values
  );

  const items = result.rows.map(serializeSarah);
  return {
    configured: true,
    message: "",
    items,
    summary: aggregateSarah(items)
  };
}

export async function loadFencingDemoMarketingActivity(pool, { limit = 50, excludedIpHashes = [] } = {}) {
  const values = [Math.min(Math.max(Number(limit) || 50, 1), 500)];
  const excludedHashes = normalizeMarketingIpHashes(excludedIpHashes);
  let ipFilterClause = "";
  if (excludedHashes.length) {
    values.push(excludedHashes);
    ipFilterClause = `AND (d.request_ip_hash IS NULL OR NOT (d.request_ip_hash = ANY($${values.length}::text[])))`;
  }

  const result = await pool.query(
    `SELECT d.demo_session_id,
            d.normalized_website_url,
            d.status,
            d.contact_name,
            d.contact_phone,
            d.contact_email,
            d.source_page,
            d.source_url,
            d.business_name,
            d.created_at,
            d.updated_at,
            jsonb_array_length(COALESCE(d.transcript_items_json, '[]'::jsonb)) AS transcript_item_count,
            EXISTS (
              SELECT 1
              FROM demo_session_events e
              WHERE e.demo_session_id = d.demo_session_id
                AND e.event_type = 'realtime_token_created'
            ) AS connected
     FROM demo_sessions d
     WHERE d.created_at >= NOW() - INTERVAL '30 days'
       AND (
         d.source_label = 'fencing_contractors'
         OR d.source_page IN ('/fencing-contractors.html', 'fencing-contractors.html', '/fencing-contractors')
         OR COALESCE(d.source_url, '') ILIKE '%/fencing-contractors%'
       )
       ${ipFilterClause}
     ORDER BY d.created_at DESC
     LIMIT $1`,
    values
  );

  const items = result.rows.map(serializeFencing);
  return {
    configured: true,
    message: "",
    items,
    summary: aggregateFencing(items)
  };
}

export function mergeMarketingActivity(sarahItems, fencingItems, limit = 60) {
  return [...sarahItems, ...fencingItems]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, Math.min(Math.max(Number(limit) || 60, 1), 100));
}
