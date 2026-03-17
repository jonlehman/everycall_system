import pg from "pg";

import onboardHandler from "../pages/api/v1/tenants/onboard.js";
import { ensureTables, getPool } from "../pages/api/_lib/db.js";
import {
  createKnowledgeBuild,
  publishKnowledgeBuild
} from "../pages/api/_lib/knowledgeReceptionistBuilds.js";
import { syncCanonicalKnowledgePacks } from "../pages/api/_lib/knowledgeReceptionistPacks.js";
import { assembleKnowledgeRuntimePreview } from "../pages/api/_lib/knowledgeReceptionistPrompt.js";

const { Pool } = pg;

const TENANT_KEY = "creative_dynamic";
const WEBSITE_URL = "https://hartsservices.com/";
const SKIP_CLEANUP = ["1", "true", "yes", "on"].includes(String(process.env.SKIP_CLEANUP || "").trim().toLowerCase());
const FORCE_RECRAWL = ["1", "true", "yes", "on"].includes(String(process.env.FORCE_RECRAWL || "").trim().toLowerCase());
const WARRANTY_QUERIES = [
  "How does your warranty work?",
  "What is the Harts Forever Warranty?",
  "Does the Harts Forever Warranty apply to all services?",
  "What services qualify for the Harts Forever Warranty?"
];

const BUILD_ARTIFACT_TABLES = [
  "runtime_bundles",
  "knowledge_coverage_events",
  "knowledge_build_fact_vectors",
  "knowledge_build_card_vectors",
  "knowledge_build_cards",
  "knowledge_build_facts",
  "knowledge_build_subtopics",
  "knowledge_build_topics",
  "source_chunks",
  "source_segments",
  "source_refs",
  "source_intake_sessions",
  "tenant_active_knowledge_builds",
  "knowledge_builds"
];

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let body = undefined;
  return {
    headers,
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
      return this;
    },
    get result() {
      return { statusCode, body, headers };
    }
  };
}

async function invokeHandler(handler, { method = "GET", query = {}, body = undefined, headers = {} } = {}) {
  const req = { method, query, body, headers };
  const res = createMockRes();
  await handler(req, res);
  return res.result;
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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "EveryCall Harts Rebuild Audit"
    }
  });
  return response.text();
}

function extractLocs(xml) {
  return Array.from(String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)).map((match) => normalizeText(match[1]));
}

async function fetchSitemapInventory(rootUrl) {
  const normalizedRootUrl = rootUrl;
  const sitemapFiles = ["page-sitemap.xml", "post-sitemap.xml", "job-sitemap.xml", "local-sitemap.xml"];
  const perFileCounts = {};
  const rawUrls = [];
  for (const file of sitemapFiles) {
    const urls = extractLocs(await fetchText(`https://hartsservices.com/${file}`));
    perFileCounts[file] = urls.length;
    rawUrls.push(...urls);
  }
  const normalizedUrls = rawUrls
    .map((url) => normalizeCrawlUrl(normalizedRootUrl, url))
    .filter(Boolean);
  const uniqueUrls = Array.from(new Set(normalizedUrls));
  const skippedUrls = uniqueUrls.filter((url) => shouldSkipUrl(new URL(url)));
  return {
    per_file_counts: perFileCounts,
    unique_urls: uniqueUrls,
    skipped_urls: skippedUrls
  };
}

async function ensureTenantExists(pool) {
  const existing = await pool.query(
    `SELECT tenant_key, name
     FROM tenants
     WHERE tenant_key = $1
     LIMIT 1`,
    [TENANT_KEY]
  );
  if (existing.rowCount) {
    return { tenantKey: TENANT_KEY, created: false };
  }

  const onboardRes = await invokeHandler(onboardHandler, {
    method: "POST",
    body: {
      businessName: "Creative Dynamic",
      industry: "plumbing",
      ownerName: "Jon Lehman",
      ownerEmail: "creative.dynamic.owner@example.test",
      password: "Password123!",
      website: WEBSITE_URL,
      phone: "+14256154640",
      serviceArea: "Seattle, Bellevue, Kirkland, Redmond",
      address: "123 E Main St, Tacoma, WA 98402",
      timezone: "America/Los_Angeles",
      businessHours: "Mon-Fri 8 AM - 5 PM",
      greetingText: "hi there",
      bootstrapMode: "website_first"
    }
  });
  if (onboardRes.statusCode !== 200) {
    throw new Error(`tenant_onboard_failed:${JSON.stringify(onboardRes.body)}`);
  }
  return { tenantKey: normalizeText(onboardRes.body?.tenantKey) || TENANT_KEY, created: true };
}

async function cleanupTenantBuildArtifacts(pool, tenantKey) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deletedRows = {};
    for (const tableName of BUILD_ARTIFACT_TABLES) {
      const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM ${tableName} WHERE tenant_key = $1`, [tenantKey]);
      const count = Number(countRes.rows[0]?.count || 0);
      deletedRows[tableName] = count;
      if (count > 0) {
        await client.query(`DELETE FROM ${tableName} WHERE tenant_key = $1`, [tenantKey]);
      }
    }
    await client.query("COMMIT");
    return deletedRows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function fetchSourceRefCounts(pool, tenantKey, buildId) {
  const grouped = await pool.query(
    `SELECT source_channel, source_kind, page_type, COUNT(*)::int AS source_ref_count
     FROM source_refs
     WHERE tenant_key = $1
       AND build_id = $2
     GROUP BY source_channel, source_kind, page_type
     ORDER BY source_channel, source_kind, page_type`,
    [tenantKey, buildId]
  );
  const totals = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE source_channel = 'website_page')::int AS website_pages,
        COUNT(*) FILTER (WHERE source_channel = 'website_file')::int AS website_files,
        COUNT(*)::int AS source_refs
     FROM source_refs
     WHERE tenant_key = $1
       AND build_id = $2`,
    [tenantKey, buildId]
  );
  return {
    grouped: grouped.rows,
    totals: totals.rows[0] || {}
  };
}

async function fetchBuildArtifacts(pool, tenantKey, buildId) {
  const buildRes = await pool.query(
    `SELECT build_id, status, published_at, artifact_counts_json, warnings_json, validation_summary_json
     FROM knowledge_builds
     WHERE tenant_key = $1
       AND build_id = $2
     LIMIT 1`,
    [tenantKey, buildId]
  );
  return buildRes.rows[0] || null;
}

async function fetchSpecificLocatorStats(pool, tenantKey, buildId) {
  const queryRes = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE source_locator ILIKE '%forever-warranty%')::int AS forever_warranty_count,
        COUNT(*) FILTER (WHERE source_locator ILIKE '%financing%')::int AS financing_count,
        COUNT(*) FILTER (WHERE page_type = 'service_area')::int AS service_area_count,
        COUNT(*) FILTER (WHERE page_type = 'faq')::int AS faq_count
     FROM source_refs
     WHERE tenant_key = $1
       AND build_id = $2`,
    [tenantKey, buildId]
  );
  const locatorRows = await pool.query(
    `SELECT source_locator, source_channel, page_type
     FROM source_refs
     WHERE tenant_key = $1
       AND build_id = $2
       AND (
         source_locator ILIKE '%forever-warranty%'
         OR source_locator ILIKE '%financing%'
         OR page_type IN ('service_area', 'faq')
       )
     ORDER BY source_locator`,
    [tenantKey, buildId]
  );
  return {
    counts: queryRes.rows[0] || {},
    rows: locatorRows.rows || []
  };
}

async function fetchBuildSourceLocators(pool, tenantKey, buildId) {
  const res = await pool.query(
    `SELECT source_locator
     FROM source_refs
     WHERE tenant_key = $1
       AND build_id = $2
     ORDER BY source_locator`,
    [tenantKey, buildId]
  );
  return (res.rows || []).map((row) => normalizeText(row.source_locator)).filter(Boolean);
}

async function fetchFactDetails(pool, tenantKey, buildId, factIds) {
  const uniqueFactIds = Array.from(new Set((factIds || []).map((item) => normalizeText(item)).filter(Boolean)));
  if (!uniqueFactIds.length) return [];
  const res = await pool.query(
    `SELECT knowledge_fact_id, fact_role, claim_text
     FROM knowledge_build_facts
     WHERE tenant_key = $1
       AND build_id = $2
       AND knowledge_fact_id = ANY($3::text[])`,
    [tenantKey, buildId, uniqueFactIds]
  );
  const byId = new Map((res.rows || []).map((row) => [row.knowledge_fact_id, row]));
  return uniqueFactIds.map((factId) => {
    const row = byId.get(factId);
    return row
      ? { fact_id: row.knowledge_fact_id, fact_role: row.fact_role, claim_text: row.claim_text }
      : { fact_id: factId, fact_role: null, claim_text: null };
  });
}

async function fetchCardNames(pool, tenantKey, buildId, cardIds) {
  const uniqueCardIds = Array.from(new Set((cardIds || []).map((item) => normalizeText(item)).filter(Boolean)));
  if (!uniqueCardIds.length) return [];
  const res = await pool.query(
    `SELECT knowledge_card_id, canonical_name, card_role, topic_path
     FROM knowledge_build_cards
     WHERE tenant_key = $1
       AND build_id = $2
       AND knowledge_card_id = ANY($3::text[])`,
    [tenantKey, buildId, uniqueCardIds]
  );
  const byId = new Map((res.rows || []).map((row) => [row.knowledge_card_id, row]));
  return uniqueCardIds.map((cardId) => {
    const row = byId.get(cardId);
    return row
      ? { card_id: row.knowledge_card_id, canonical_name: row.canonical_name, card_role: row.card_role, topic_path: row.topic_path }
      : { card_id: cardId, canonical_name: null, card_role: null, topic_path: null };
  });
}

async function runWarrantyPreviewQueries(pool, tenantKey, buildId) {
  const outputs = [];
  for (const query of WARRANTY_QUERIES) {
    const preview = await assembleKnowledgeRuntimePreview(pool, tenantKey, {
      query,
      runtimeEntryMode: "customer_call"
    });
    outputs.push({
      query,
      selected_cards: await fetchCardNames(pool, tenantKey, buildId, preview.answerPacket.used_card_ids),
      used_facts: await fetchFactDetails(pool, tenantKey, buildId, preview.answerPacket.used_fact_ids),
      support_by_coverage_item: (preview.answerPacket.coverage || []).map((item) => ({
        requested_coverage_item_text: item.requested_coverage_item_text,
        support_strength: item.support_strength,
        used_card_ids: item.used_card_ids,
        used_fact_ids: item.used_fact_ids,
        direct_answer_points: item.direct_answer_points,
        qualifiers: item.qualifiers,
        limits_or_exclusions: item.limits_or_exclusions,
        next_step_options: item.next_step_options
      })),
      direct_answer_points: preview.answerPacket.direct_answer_points,
      qualifiers: preview.answerPacket.qualifiers,
      limits_or_exclusions: preview.answerPacket.limits_or_exclusions,
      next_step_options: preview.answerPacket.next_step_options,
      unsupported_requested_items: preview.answerPacket.unsupported_requested_items,
      runtime_mode: preview.answerPacket.runtime_mode,
      packet_tokens: preview.answerPacket.token_counts?.packet_tokens || 0
    });
  }
  return outputs;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL missing");
  }
  process.env.KNOWLEDGE_RECEPTIONIST_DISABLE_BUILD_RATE_LIMIT = "true";
  console.error("phase:db_probe");

  const probePool = new Pool({ connectionString: databaseUrl });
  try {
    await probePool.query("SELECT 1");
  } finally {
    await probePool.end();
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("shared_pool_unavailable");
  }

  console.error("phase:ensure_tables_and_packs");
  await ensureTables(pool);
  await syncCanonicalKnowledgePacks(pool);

  console.error("phase:ensure_tenant");
  const tenant = await ensureTenantExists(pool);
  let deletedRows = {};
  if (!SKIP_CLEANUP) {
    console.error("phase:cleanup_build_artifacts");
    deletedRows = await cleanupTenantBuildArtifacts(pool, tenant.tenantKey);
  }
  console.error("phase:fetch_sitemap_inventory");
  const sitemapInventory = await fetchSitemapInventory(WEBSITE_URL);
  console.error("phase:reset_pool_before_long_build");
  await pool.end();
  globalThis.__everycallPool = null;
  const buildPool = new Pool({ connectionString: databaseUrl });

  console.error("phase:create_build");
  const created = await createKnowledgeBuild(buildPool, tenant.tenantKey, {
    websiteUrl: WEBSITE_URL,
    forceRescrape: FORCE_RECRAWL
  });
  const buildId = normalizeText(created?.build?.build_id);
  if (!buildId) {
    throw new Error("build_id_missing");
  }

  console.error("phase:publish_build");
  const published = await publishKnowledgeBuild(buildPool, tenant.tenantKey, buildId);
  console.error("phase:query_results");
  const build = await fetchBuildArtifacts(buildPool, tenant.tenantKey, buildId);
  const sourceRefCounts = await fetchSourceRefCounts(buildPool, tenant.tenantKey, buildId);
  const buildSourceLocators = await fetchBuildSourceLocators(buildPool, tenant.tenantKey, buildId);
  const locatorStats = await fetchSpecificLocatorStats(buildPool, tenant.tenantKey, buildId);
  console.error("phase:warranty_preview_queries");
  const warrantyPreviewResults = await runWarrantyPreviewQueries(buildPool, tenant.tenantKey, buildId);
  const includedLocatorSet = new Set(buildSourceLocators);
  const missingSitemapUrls = sitemapInventory.unique_urls.filter((url) => !includedLocatorSet.has(url));
  const includedSitemapUrls = sitemapInventory.unique_urls.filter((url) => includedLocatorSet.has(url));

  const output = {
    tenant: tenant,
    deleted_rows: deletedRows,
    sitemap_inventory: {
      per_file_counts: sitemapInventory.per_file_counts,
      total_unique_urls: sitemapInventory.unique_urls.length,
      skipped_urls_by_page_filter: sitemapInventory.skipped_urls.length
    },
    comparison: {
      pages_included_from_sitemap_inventory: includedSitemapUrls.length,
      pages_missing_from_sitemap_inventory: missingSitemapUrls.length,
      sample_missing_urls: missingSitemapUrls.slice(0, 100)
    },
    build: {
      build_id: buildId,
      create_status: created?.status || null,
      publish_result: published,
      build_row: build,
      source_ref_counts: sourceRefCounts,
      locator_stats: locatorStats
    },
    warranty_preview_results: warrantyPreviewResults
  };

  console.log(JSON.stringify(output, null, 2));
  await buildPool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
