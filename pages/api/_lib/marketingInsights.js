const CLARITY_ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights";
const CLARITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GOOGLE_ADS_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_GOOGLE_ADS_API_VERSION = "v24";

const CLARITY_PROFILES = [
  {
    key: "sourceCampaign",
    dimensions: ["Source", "Medium", "Campaign"]
  },
  {
    key: "urlCampaignDevice",
    dimensions: ["URL", "Campaign", "Device"]
  },
  {
    key: "channelUrlCampaign",
    dimensions: ["Channel", "URL", "Campaign"]
  }
];

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUrlKey(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://placeholder.local");
    const host = url.hostname === "placeholder.local" ? "" : url.hostname.replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${pathname}`.toLowerCase();
  } catch {
    return raw.toLowerCase().split("?")[0].replace(/\/+$/, "") || raw.toLowerCase();
  }
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function round(value, digits = 2) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function getEnv(...names) {
  for (const name of names) {
    const value = cleanText(process.env[name]);
    if (value) return value;
  }
  return "";
}

function getClarityToken() {
  return getEnv(
    "microsoft_clarity_api_token",
    "MICROSOFT_CLARITY_API_TOKEN",
    "CLARITY_API_TOKEN",
    "MICROSOFT_CLARITY_DATA_EXPORT_TOKEN"
  );
}

function truthy(value) {
  const normalized = cleanText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function clampDays(value) {
  const numeric = Number(value || 3);
  if (!Number.isFinite(numeric)) return 3;
  return Math.min(3, Math.max(1, Math.round(numeric)));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function lastNDaysRange(days) {
  const end = new Date();
  const start = addDays(end, -(days - 1));
  return {
    startDate: formatDate(start),
    endDate: formatDate(end)
  };
}

function safeErrorMessage(error) {
  return cleanText(error?.message || error || "unknown_error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/refresh_token=[^&\s]+/g, "refresh_token=<redacted>")
    .replace(/client_secret=[^&\s]+/g, "client_secret=<redacted>")
    .slice(0, 500);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || text || response.statusText;
      throw new Error(`${response.status} ${message}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureAnalyticsCacheTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_analytics_snapshots (
      cache_key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS external_analytics_snapshots_expires_idx
    ON external_analytics_snapshots (expires_at);
  `);
}

async function readCache(pool, cacheKey) {
  const result = await pool.query(
    `SELECT payload_json, fetched_at, expires_at
     FROM external_analytics_snapshots
     WHERE cache_key = $1
     LIMIT 1`,
    [cacheKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    payload: row.payload_json,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    fresh: new Date(row.expires_at).getTime() > Date.now()
  };
}

async function writeCache(pool, cacheKey, source, payload, ttlMs) {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await pool.query(
    `INSERT INTO external_analytics_snapshots (cache_key, source, payload_json, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cache_key)
     DO UPDATE SET
       source = EXCLUDED.source,
       payload_json = EXCLUDED.payload_json,
       fetched_at = NOW(),
       expires_at = EXCLUDED.expires_at`,
    [cacheKey, source, JSON.stringify(payload), expiresAt]
  );
}

function dimensionValue(row, dimension) {
  return cleanText(row?.[dimension] ?? row?.[dimension.replace(/\s+/g, "")]);
}

function dimensionsKey(row, dimensions) {
  return dimensions.map((dimension) => dimensionValue(row, dimension)).join("\u001f");
}

function metricFieldName(metricName) {
  const name = cleanText(metricName).toLowerCase();
  if (name.includes("traffic")) return "sessions";
  if (name.includes("engagement")) return "engagementTime";
  if (name.includes("scroll")) return "scrollDepth";
  if (name.includes("dead")) return "deadClicks";
  if (name.includes("rage")) return "rageClicks";
  if (name.includes("quickback")) return "quickbacks";
  if (name.includes("script")) return "scriptErrors";
  if (name.includes("error")) return "errorClicks";
  return normalizeKey(metricName).replace(/\s+([a-z0-9])/g, (_, chr) => chr.toUpperCase());
}

function pickMetricValue(metricName, row, dimensions) {
  const dimensionSet = new Set(dimensions);
  const numericEntries = Object.entries(row || {})
    .filter(([key]) => !dimensionSet.has(key))
    .filter(([, value]) => Number.isFinite(Number(value)));

  const lowerMetric = cleanText(metricName).toLowerCase();
  const direct = numericEntries.find(([key]) => {
    const normalized = key.toLowerCase();
    if (lowerMetric.includes("traffic")) return normalized.includes("session") && !normalized.includes("bot");
    if (lowerMetric.includes("dead")) return normalized.includes("dead");
    if (lowerMetric.includes("rage")) return normalized.includes("rage");
    if (lowerMetric.includes("quickback")) return normalized.includes("quick");
    if (lowerMetric.includes("script")) return normalized.includes("script");
    if (lowerMetric.includes("error")) return normalized.includes("error");
    if (lowerMetric.includes("scroll")) return normalized.includes("scroll");
    if (lowerMetric.includes("engagement")) return normalized.includes("engagement") || normalized.includes("time");
    return normalized.includes(normalizeKey(metricName).replace(/\s+/g, ""));
  });

  if (direct) return numberValue(direct[1]);
  const fallback = numericEntries[0];
  return fallback ? numberValue(fallback[1]) : 0;
}

function parseClarityProfile(profile, rawMetrics) {
  const rowsByKey = new Map();
  const dimensions = profile.dimensions;

  for (const metricGroup of Array.isArray(rawMetrics) ? rawMetrics : []) {
    const metricName = cleanText(metricGroup?.metricName || "Metric");
    const metricField = metricFieldName(metricName);
    const rows = Array.isArray(metricGroup?.information) ? metricGroup.information : [];

    for (const row of rows) {
      const key = dimensionsKey(row, dimensions);
      if (!rowsByKey.has(key)) {
        const dimensionMap = Object.fromEntries(
          dimensions.map((dimension) => [dimension, dimensionValue(row, dimension)])
        );
        rowsByKey.set(key, {
          dimensions: dimensionMap,
          metrics: {},
          metricDetails: {}
        });
      }

      const current = rowsByKey.get(key);
      const value = pickMetricValue(metricName, row, dimensions);
      current.metrics[metricField] = numberValue(current.metrics[metricField]) + value;
      current.metricDetails[metricName] = Object.fromEntries(
        Object.entries(row || {}).filter(([keyName]) => !dimensions.includes(keyName))
      );

      if (metricField === "sessions") {
        current.metrics.botSessions = numberValue(current.metrics.botSessions) + numberValue(row?.totalBotSessionCount);
        current.metrics.users = numberValue(current.metrics.users) + numberValue(row?.distinctUserCount ?? row?.distantUserCount);
        current.metrics.pagesPerSession = numberValue(row?.PagesPerSessionPercentage ?? row?.pagesPerSessionPercentage);
      }
    }
  }

  return Array.from(rowsByKey.values()).map((row) => {
    const friction =
      numberValue(row.metrics.deadClicks) +
      numberValue(row.metrics.rageClicks) +
      numberValue(row.metrics.quickbacks) +
      numberValue(row.metrics.errorClicks) +
      numberValue(row.metrics.scriptErrors);
    return {
      ...row,
      metrics: {
        ...row.metrics,
        friction,
        frictionRate: row.metrics.sessions ? round(friction / row.metrics.sessions, 4) : 0
      }
    };
  });
}

function looksPaidGoogle(row) {
  const source = normalizeKey(row?.dimensions?.Source);
  const medium = normalizeKey(row?.dimensions?.Medium);
  const channel = normalizeKey(row?.dimensions?.Channel);
  const campaign = normalizeKey(row?.dimensions?.Campaign);
  const url = cleanText(row?.dimensions?.URL).toLowerCase();
  return (
    source.includes("google") ||
    medium.includes("cpc") ||
    medium.includes("ppc") ||
    medium.includes("paid") ||
    channel.includes("paid") ||
    url.includes("gclid=") ||
    (campaign && campaign !== "not set" && campaign !== "(not set)")
  );
}

function sortByMetric(rows, metric, limit = 10) {
  return [...rows]
    .sort((a, b) => numberValue(b?.metrics?.[metric]) - numberValue(a?.metrics?.[metric]))
    .slice(0, limit);
}

function aggregateRows(rows, dimensionName) {
  const map = new Map();
  for (const row of rows) {
    const key = cleanText(row?.dimensions?.[dimensionName]);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        dimensions: { [dimensionName]: key },
        metrics: {
          sessions: 0,
          friction: 0,
          deadClicks: 0,
          rageClicks: 0,
          quickbacks: 0,
          errorClicks: 0,
          scriptErrors: 0
        }
      });
    }
    const current = map.get(key);
    for (const metric of Object.keys(current.metrics)) {
      current.metrics[metric] += numberValue(row?.metrics?.[metric]);
    }
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    metrics: {
      ...row.metrics,
      frictionRate: row.metrics.sessions ? round(row.metrics.friction / row.metrics.sessions, 4) : 0
    }
  }));
}

function summarizeClarity(profiles) {
  const sourceCampaign = profiles.sourceCampaign?.rows || [];
  const urlCampaignDevice = profiles.urlCampaignDevice?.rows || [];
  const channelUrlCampaign = profiles.channelUrlCampaign?.rows || [];
  const paidCampaignRows = sourceCampaign.filter(looksPaidGoogle);
  const paidUrlRows = [...urlCampaignDevice, ...channelUrlCampaign].filter(looksPaidGoogle);
  const urlRows = aggregateRows(paidUrlRows.length ? paidUrlRows : urlCampaignDevice, "URL");
  const campaignRows = aggregateRows(paidCampaignRows.length ? paidCampaignRows : sourceCampaign, "Campaign")
    .filter((row) => normalizeKey(row.dimensions.Campaign) && normalizeKey(row.dimensions.Campaign) !== "not set");
  const summaryRows = sourceCampaign.length ? sourceCampaign : urlCampaignDevice;
  const totalSessions = summaryRows.reduce((sum, row) => sum + numberValue(row?.metrics?.sessions), 0);
  const totalPaidSessions = paidCampaignRows.reduce((sum, row) => sum + numberValue(row?.metrics?.sessions), 0);
  const totalFriction = summaryRows.reduce((sum, row) => sum + numberValue(row?.metrics?.friction), 0);
  const campaignValues = sourceCampaign
    .map((row) => normalizeKey(row?.dimensions?.Campaign))
    .filter((value) => value && value !== "not set");

  const warnings = [];
  if (!campaignValues.length) {
    warnings.push("Clarity did not return campaign names. Check that Google Ads final URLs carry utm_campaign values.");
  }
  if (!paidCampaignRows.length) {
    warnings.push("Clarity did not isolate obvious paid Google sessions in Source/Medium/Campaign.");
  }

  return {
    summary: {
      totalSessions,
      totalPaidSessions,
      totalFriction,
      frictionRate: totalSessions ? round(totalFriction / totalSessions, 4) : 0
    },
    campaignRows,
    urlRows,
    topCampaigns: sortByMetric(campaignRows, "sessions", 12),
    frictionCampaigns: sortByMetric(campaignRows, "friction", 12),
    topUrls: sortByMetric(urlRows, "sessions", 12),
    frictionUrls: sortByMetric(urlRows, "friction", 12),
    warnings
  };
}

async function fetchClarityProfile(profile, days, token) {
  const url = new URL(CLARITY_ENDPOINT);
  url.searchParams.set("numOfDays", String(days));
  profile.dimensions.forEach((dimension, index) => {
    url.searchParams.set(`dimension${index + 1}`, dimension);
  });
  return fetchJson(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
}

async function loadClarityInsights({ pool, days, refresh }) {
  const token = getClarityToken();
  if (!token) {
    return {
      configured: false,
      message: "MICROSOFT_CLARITY_API_TOKEN is not configured.",
      profiles: {},
      analysis: summarizeClarity({})
    };
  }

  const profiles = {};
  const errors = [];

  for (const profile of CLARITY_PROFILES) {
    const cacheKey = `clarity:${days}:${profile.key}`;
    const cached = await readCache(pool, cacheKey);
    if (cached?.fresh && !refresh) {
      profiles[profile.key] = {
        cache: {
          hit: true,
          fetchedAt: cached.fetchedAt,
          expiresAt: cached.expiresAt
        },
        rows: parseClarityProfile(profile, cached.payload?.rawMetrics || cached.payload)
      };
      continue;
    }

    try {
      const rawMetrics = await fetchClarityProfile(profile, days, token);
      await writeCache(pool, cacheKey, "microsoft_clarity", { rawMetrics }, CLARITY_CACHE_TTL_MS);
      const fresh = await readCache(pool, cacheKey);
      profiles[profile.key] = {
        cache: {
          hit: false,
          fetchedAt: fresh?.fetchedAt || new Date().toISOString(),
          expiresAt: fresh?.expiresAt || new Date(Date.now() + CLARITY_CACHE_TTL_MS).toISOString()
        },
        rows: parseClarityProfile(profile, rawMetrics)
      };
    } catch (error) {
      errors.push({
        profile: profile.key,
        message: safeErrorMessage(error)
      });
      if (cached) {
        profiles[profile.key] = {
          cache: {
            hit: true,
            stale: true,
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.expiresAt
          },
          rows: parseClarityProfile(profile, cached.payload?.rawMetrics || cached.payload)
        };
      }
    }
  }

  return {
    configured: true,
    message: errors.length ? "Some Clarity slices could not be refreshed." : "",
    errors,
    profiles,
    analysis: summarizeClarity(profiles)
  };
}

function googleAdsRequiredEnv() {
  return {
    developerToken: getEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    clientId: getEnv("GOOGLE_ADS_CLIENT_ID"),
    clientSecret: getEnv("GOOGLE_ADS_CLIENT_SECRET"),
    refreshToken: getEnv("GOOGLE_ADS_REFRESH_TOKEN"),
    customerId: getEnv("GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_ANALYSIS_CUSTOMER_ID"),
    loginCustomerId: getEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
    apiVersion: getEnv("GOOGLE_ADS_API_VERSION") || DEFAULT_GOOGLE_ADS_API_VERSION
  };
}

function googleAdsConfigured(config) {
  return Boolean(
    config.developerToken &&
      config.clientId &&
      config.clientSecret &&
      config.refreshToken &&
      config.customerId
  );
}

async function fetchGoogleAdsAccessToken(config) {
  const body = new URLSearchParams();
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  body.set("refresh_token", config.refreshToken);
  body.set("grant_type", "refresh_token");

  const response = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  const accessToken = cleanText(response?.access_token);
  if (!accessToken) {
    throw new Error("Google OAuth refresh did not return an access token");
  }
  return accessToken;
}

async function runGoogleAdsSearch(config, accessToken, query) {
  const customerId = cleanText(config.customerId).replaceAll("-", "");
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": config.developerToken,
    "Content-Type": "application/json"
  };
  if (config.loginCustomerId) {
    headers["login-customer-id"] = config.loginCustomerId.replaceAll("-", "");
  }

  return fetchJson(
    `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ query })
    }
  );
}

function resultRows(payload) {
  return Array.isArray(payload?.results) ? payload.results : [];
}

function googleAdsNumber(value) {
  return numberValue(value);
}

function parseAdsCampaignRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const campaign = row?.campaign || {};
    const id = cleanText(campaign.id);
    const key = id || cleanText(campaign.name);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        id,
        name: cleanText(campaign.name),
        status: cleanText(campaign.status),
        channel: cleanText(campaign.advertisingChannelType),
        impressions: 0,
        clicks: 0,
        costMicros: 0,
        conversions: 0,
        conversionsValue: 0
      });
    }
    const current = map.get(key);
    current.impressions += googleAdsNumber(row?.metrics?.impressions);
    current.clicks += googleAdsNumber(row?.metrics?.clicks);
    current.costMicros += googleAdsNumber(row?.metrics?.costMicros);
    current.conversions += googleAdsNumber(row?.metrics?.conversions);
    current.conversionsValue += googleAdsNumber(row?.metrics?.conversionsValue);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    cost: round(row.costMicros / 1_000_000, 2),
    ctr: row.impressions ? round(row.clicks / row.impressions, 4) : 0,
    conversionRate: row.clicks ? round(row.conversions / row.clicks, 4) : 0,
    costPerConversion: row.conversions ? round(row.cost / row.conversions, 2) : 0
  }));
}

function parseAdsLandingPageRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const url = cleanText(row?.landingPageView?.unexpandedFinalUrl);
    const key = normalizeUrlKey(url);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        url,
        urlKey: key,
        campaignId: cleanText(row?.campaign?.id),
        campaignName: cleanText(row?.campaign?.name),
        impressions: 0,
        clicks: 0,
        costMicros: 0,
        conversions: 0
      });
    }
    const current = map.get(key);
    current.impressions += googleAdsNumber(row?.metrics?.impressions);
    current.clicks += googleAdsNumber(row?.metrics?.clicks);
    current.costMicros += googleAdsNumber(row?.metrics?.costMicros);
    current.conversions += googleAdsNumber(row?.metrics?.conversions);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    cost: round(row.costMicros / 1_000_000, 2),
    conversionRate: row.clicks ? round(row.conversions / row.clicks, 4) : 0
  }));
}

async function fetchGoogleAdsSnapshot(config, days) {
  const accessToken = await fetchGoogleAdsAccessToken(config);
  const { startDate, endDate } = lastNDaysRange(days);
  const campaignQuery = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `;
  const landingPageQuery = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      landing_page_view.unexpanded_final_url,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM landing_page_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `;

  const [campaigns, landingPages] = await Promise.all([
    runGoogleAdsSearch(config, accessToken, campaignQuery),
    runGoogleAdsSearch(config, accessToken, landingPageQuery).catch((error) => ({
      error: safeErrorMessage(error),
      results: []
    }))
  ]);

  return {
    dateRange: { startDate, endDate },
    campaigns: parseAdsCampaignRows(resultRows(campaigns)),
    landingPages: parseAdsLandingPageRows(resultRows(landingPages)),
    landingPageError: landingPages?.error || ""
  };
}

async function loadGoogleAdsInsights({ pool, days, refresh }) {
  const config = googleAdsRequiredEnv();
  if (!googleAdsConfigured(config)) {
    return {
      configured: false,
      message:
        "Google Ads join is waiting on GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, and GOOGLE_ADS_REFRESH_TOKEN in the app environment.",
      campaigns: [],
      landingPages: []
    };
  }

  const cacheKey = `google_ads:${config.customerId.replaceAll("-", "")}:${days}`;
  const cached = await readCache(pool, cacheKey);
  if (cached?.fresh && !refresh) {
    return {
      configured: true,
      cache: {
        hit: true,
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt
      },
      ...cached.payload
    };
  }

  try {
    const payload = await fetchGoogleAdsSnapshot(config, days);
    await writeCache(pool, cacheKey, "google_ads", payload, GOOGLE_ADS_CACHE_TTL_MS);
    const fresh = await readCache(pool, cacheKey);
    return {
      configured: true,
      cache: {
        hit: false,
        fetchedAt: fresh?.fetchedAt || new Date().toISOString(),
        expiresAt: fresh?.expiresAt || new Date(Date.now() + GOOGLE_ADS_CACHE_TTL_MS).toISOString()
      },
      ...payload
    };
  } catch (error) {
    return {
      configured: true,
      message: `Google Ads data unavailable: ${safeErrorMessage(error)}`,
      cache: cached
        ? {
            hit: true,
            stale: true,
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.expiresAt
          }
        : null,
      ...(cached?.payload || { campaigns: [], landingPages: [] })
    };
  }
}

function indexClarityCampaigns(clarity) {
  const rows = clarity?.analysis?.campaignRows || clarity?.analysis?.topCampaigns || [];
  const map = new Map();
  for (const row of rows) {
    const campaign = cleanText(row?.dimensions?.Campaign);
    const key = normalizeKey(campaign);
    if (key) map.set(key, row);
  }
  return map;
}

function indexClarityUrls(clarity) {
  const rows = clarity?.analysis?.urlRows || clarity?.analysis?.topUrls || [];
  const map = new Map();
  for (const row of rows) {
    const url = cleanText(row?.dimensions?.URL);
    const key = normalizeUrlKey(url);
    if (key) map.set(key, row);
  }
  return map;
}

function joinCampaigns(ads, clarity) {
  const clarityCampaigns = indexClarityCampaigns(clarity);
  return (ads?.campaigns || [])
    .map((campaign) => {
      const clarityRow =
        clarityCampaigns.get(normalizeKey(campaign.name)) ||
        clarityCampaigns.get(normalizeKey(campaign.id));
      const sessions = numberValue(clarityRow?.metrics?.sessions);
      const friction = numberValue(clarityRow?.metrics?.friction);
      const signal =
        !sessions && campaign.clicks
          ? "No Clarity match"
          : friction > 0
            ? "Friction"
            : campaign.conversions > 0
              ? "Converting"
              : campaign.clicks > 0
                ? "Traffic"
                : "Quiet";
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        channel: campaign.channel,
        ads: campaign,
        clarity: clarityRow || null,
        sessionsPerClick: campaign.clicks ? round(sessions / campaign.clicks, 4) : 0,
        frictionPerClick: campaign.clicks ? round(friction / campaign.clicks, 4) : 0,
        signal
      };
    })
    .sort((a, b) => numberValue(b.ads.costMicros) - numberValue(a.ads.costMicros));
}

function joinLandingPages(ads, clarity) {
  const clarityUrls = indexClarityUrls(clarity);
  return (ads?.landingPages || [])
    .map((page) => {
      const clarityRow = clarityUrls.get(page.urlKey);
      const sessions = numberValue(clarityRow?.metrics?.sessions);
      const friction = numberValue(clarityRow?.metrics?.friction);
      return {
        url: page.url,
        campaignName: page.campaignName,
        ads: page,
        clarity: clarityRow || null,
        sessionsPerClick: page.clicks ? round(sessions / page.clicks, 4) : 0,
        frictionPerClick: page.clicks ? round(friction / page.clicks, 4) : 0
      };
    })
    .sort((a, b) => numberValue(b.ads.costMicros) - numberValue(a.ads.costMicros))
    .slice(0, 12);
}

function summarizeAds(ads) {
  const campaigns = ads?.campaigns || [];
  const totals = campaigns.reduce(
    (acc, campaign) => ({
      impressions: acc.impressions + numberValue(campaign.impressions),
      clicks: acc.clicks + numberValue(campaign.clicks),
      cost: acc.cost + numberValue(campaign.cost),
      conversions: acc.conversions + numberValue(campaign.conversions)
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
  );
  return {
    ...totals,
    cost: round(totals.cost, 2),
    ctr: totals.impressions ? round(totals.clicks / totals.impressions, 4) : 0,
    conversionRate: totals.clicks ? round(totals.conversions / totals.clicks, 4) : 0,
    costPerConversion: totals.conversions ? round(totals.cost / totals.conversions, 2) : 0
  };
}

function buildRecommendations({ clarity, ads, joinedCampaigns, joinedLandingPages }) {
  const recommendations = [];
  const clarityWarnings = clarity?.analysis?.warnings || [];
  for (const warning of clarityWarnings) {
    recommendations.push({ tone: "warning", text: warning });
  }

  const unmatchedSpend = joinedCampaigns
    .filter((row) => row.signal === "No Clarity match")
    .reduce((sum, row) => sum + numberValue(row.ads.cost), 0);
  if (unmatchedSpend > 0) {
    recommendations.push({
      tone: "warning",
      text: `$${round(unmatchedSpend, 2)} in recent Google Ads spend did not match a Clarity campaign row. Tighten UTMs before trusting campaign-level joins.`
    });
  }

  const highFriction = joinedLandingPages.find((row) => numberValue(row.clarity?.metrics?.friction) > 0);
  if (highFriction) {
    recommendations.push({
      tone: "action",
      text: `Review ${highFriction.url || highFriction.campaignName}: Clarity shows interaction friction on paid traffic.`
    });
  }

  if (ads?.configured === false) {
    recommendations.push({
      tone: "setup",
      text: "Copy the read-only Google Ads API credentials into everycall_system to enable the spend and conversion join."
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      tone: "ok",
      text: "No obvious paid-traffic friction stood out in the current Clarity window."
    });
  }

  return recommendations.slice(0, 6);
}

export async function loadMarketingInsights({ pool, days: rawDays, refresh: rawRefresh }) {
  const days = clampDays(rawDays);
  const refresh = truthy(rawRefresh);
  await ensureAnalyticsCacheTable(pool);

  const [clarity, googleAds] = await Promise.all([
    loadClarityInsights({ pool, days, refresh }),
    loadGoogleAdsInsights({ pool, days, refresh })
  ]);

  const joinedCampaigns = joinCampaigns(googleAds, clarity);
  const joinedLandingPages = joinLandingPages(googleAds, clarity);
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    window: {
      days,
      clarityUtcWindow: `last_${days}_day${days === 1 ? "" : "s"}`,
      googleAdsDateRange: googleAds?.dateRange || lastNDaysRange(days)
    },
    sources: {
      clarity: {
        configured: Boolean(clarity.configured),
        message: clarity.message || "",
        errors: clarity.errors || []
      },
      googleAds: {
        configured: Boolean(googleAds.configured),
        message: googleAds.message || "",
        landingPageError: googleAds.landingPageError || ""
      }
    },
    cache: {
      clarity: Object.fromEntries(
        Object.entries(clarity.profiles || {}).map(([key, value]) => [key, value.cache || null])
      ),
      googleAds: googleAds.cache || null
    },
    summary: {
      clarity: clarity.analysis.summary,
      googleAds: summarizeAds(googleAds)
    },
    clarity: {
      topCampaigns: clarity.analysis.topCampaigns,
      frictionCampaigns: clarity.analysis.frictionCampaigns,
      topUrls: clarity.analysis.topUrls,
      frictionUrls: clarity.analysis.frictionUrls
    },
    googleAds: {
      campaigns: googleAds.campaigns || [],
      landingPages: googleAds.landingPages || []
    },
    joined: {
      campaigns: joinedCampaigns,
      landingPages: joinedLandingPages
    }
  };

  report.recommendations = buildRecommendations({
    clarity,
    ads: googleAds,
    joinedCampaigns,
    joinedLandingPages
  });

  return report;
}
