import {
  buildBusinessHoursDisplayText,
  createBusinessHoursConfig,
  createDefaultWeeklyHours,
  parseLegacyBusinessHoursText,
  weeklyHoursToRegularPeriods
} from "../../../lib/businessHours.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toJson(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

async function getTenantTimezone(db, tenantKey) {
  const result = await db.query(
    `SELECT timezone
     FROM tenant_settings
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return normalizeText(result.rows?.[0]?.timezone) || "America/Los_Angeles";
}

function hydrateBusinessHoursRow(row, timezone) {
  if (!row) return null;
  const regularHours = Array.isArray(row.regular_hours_json) ? row.regular_hours_json : [];
  const specialHours = Array.isArray(row.special_hours_json) ? row.special_hours_json : [];
  const moreHours = Array.isArray(row.more_hours_json) ? row.more_hours_json : [];
  return createBusinessHoursConfig({
    timezone: normalizeText(row.timezone) || timezone,
    source: normalizeText(row.source) || "manual",
    openStatus: normalizeText(row.open_status) || "OPEN",
    regularHours,
    specialHours,
    moreHours,
    displayText: normalizeText(row.display_text),
    externalSource: asObject(row.external_source_json || {})
  }, timezone);
}

export async function loadTenantBusinessHours(db, tenantKey, options = {}) {
  const timezone = normalizeText(options.timezone) || await getTenantTimezone(db, tenantKey);
  const [hoursResult, routingResult] = await Promise.all([
    db.query(
      `SELECT tenant_key,
              timezone,
              source,
              open_status,
              regular_hours_json,
              special_hours_json,
              more_hours_json,
              display_text,
              external_source_json,
              last_synced_at,
              updated_at
       FROM tenant_business_hours
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    ),
    db.query(
      `SELECT business_hours
       FROM routing_rules
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    )
  ]);

  const existing = hydrateBusinessHoursRow(hoursResult.rows?.[0] || null, timezone);
  if (existing) {
    return {
      ...existing,
      lastSyncedAt: hoursResult.rows?.[0]?.last_synced_at || null,
      updatedAt: hoursResult.rows?.[0]?.updated_at || null
    };
  }

  const legacyText = normalizeText(options.legacyBusinessHours || routingResult.rows?.[0]?.business_hours || "");
  const config = legacyText
    ? parseLegacyBusinessHoursText(legacyText, timezone)
    : createBusinessHoursConfig({
      timezone,
      weeklyHours: createDefaultWeeklyHours(),
      displayText: buildBusinessHoursDisplayText(createDefaultWeeklyHours())
    }, timezone);

  await saveTenantBusinessHours(db, tenantKey, config, {
    syncRoutingDisplayText: !legacyText || legacyText !== config.displayText
  });

  return config;
}

export async function saveTenantBusinessHours(db, tenantKey, input, options = {}) {
  const timezone = normalizeText(options.timezone) || await getTenantTimezone(db, tenantKey);
  const config = createBusinessHoursConfig(input, timezone);
  const displayText = normalizeText(config.displayText) || buildBusinessHoursDisplayText(config.weeklyHours);
  const externalSource = asObject(input?.externalSource || input?.external_source);
  const lastSyncedAt = input?.lastSyncedAt || input?.last_synced_at || null;

  await db.query(
    `INSERT INTO tenant_business_hours (
       tenant_key,
       timezone,
       source,
       open_status,
       regular_hours_json,
       special_hours_json,
       more_hours_json,
       display_text,
       external_source_json,
       last_synced_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET
       timezone = EXCLUDED.timezone,
       source = EXCLUDED.source,
       open_status = EXCLUDED.open_status,
       regular_hours_json = EXCLUDED.regular_hours_json,
       special_hours_json = EXCLUDED.special_hours_json,
       more_hours_json = EXCLUDED.more_hours_json,
       display_text = EXCLUDED.display_text,
       external_source_json = EXCLUDED.external_source_json,
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = NOW()`,
    [
      tenantKey,
      config.timezone,
      config.source,
      config.openStatus,
      toJson(config.regularHours, []),
      toJson(config.specialHours, []),
      toJson(config.moreHours, []),
      displayText,
      toJson(externalSource, {}),
      lastSyncedAt
    ]
  );

  if (options.syncRoutingDisplayText !== false) {
    await db.query(
      `INSERT INTO routing_rules (tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours)
       VALUES ($1, 'Dispatch Team', 'Immediate Transfer', 'Collect details and dispatch callback', $2)
       ON CONFLICT (tenant_key)
       DO UPDATE SET business_hours = EXCLUDED.business_hours,
                     updated_at = NOW()`,
      [tenantKey, displayText]
    );
  }

  return {
    ...config,
    displayText
  };
}

export function createDefaultTenantBusinessHours(timezone = "America/Los_Angeles") {
  const weeklyHours = createDefaultWeeklyHours();
  return {
    timezone,
    source: "manual",
    openStatus: "OPEN",
    weeklyHours,
    regularHours: weeklyHoursToRegularPeriods(weeklyHours),
    specialHours: [],
    moreHours: [],
    displayText: buildBusinessHoursDisplayText(weeklyHours)
  };
}
