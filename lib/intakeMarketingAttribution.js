export const INTAKE_MARKETING_ATTRIBUTION_STORAGE_KEY = "everycall:intake:marketing-attribution";

const KNOWN_QUERY_PARAM_KEYS = new Set([
  "ref_page",
  "ref_cta",
  "plan_interest",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
  "msclkid"
]);

const STRUCTURAL_OBJECT_KEYS = new Set([
  "refpage",
  "ref_page",
  "refcta",
  "ref_cta",
  "planinterest",
  "plan_interest",
  "utmsource",
  "utm_source",
  "utmmedium",
  "utm_medium",
  "utmcampaign",
  "utm_campaign",
  "utmcontent",
  "utm_content",
  "utmterm",
  "utm_term",
  "gclid",
  "fbclid",
  "msclkid",
  "utm",
  "clickids",
  "click_ids",
  "extraqueryparams",
  "extra_query_params"
]);

const EXTRA_QUERY_DENYLIST = ["token", "session", "password", "secret", "auth", "code"];
const MAX_KNOWN_VALUE_LENGTH = 512;
const MAX_EXTRA_QUERY_KEYS = 20;
const MAX_EXTRA_QUERY_KEY_LENGTH = 64;
const MAX_EXTRA_QUERY_VALUE_LENGTH = 512;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeString(value, maxLength = MAX_KNOWN_VALUE_LENGTH) {
  const candidate = firstValue(value);
  if (candidate == null || typeof candidate === "object") return "";
  const trimmed = String(candidate).trim();
  if (!trimmed) return "";
  return trimmed.slice(0, maxLength);
}

function pickFirstMeaningful(values, maxLength = MAX_KNOWN_VALUE_LENGTH) {
  for (const value of values) {
    const normalized = normalizeString(value, maxLength);
    if (normalized) return normalized;
  }
  return "";
}

function hasOwnKeys(value) {
  return Boolean(value) && Object.keys(value).length > 0;
}

function isUrlSearchParams(value) {
  return typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams;
}

function looksSensitiveExtraKey(key) {
  const lowerKey = String(key || "").toLowerCase();
  return EXTRA_QUERY_DENYLIST.some((token) => lowerKey.includes(token));
}

function normalizeExtraKey(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, MAX_EXTRA_QUERY_KEY_LENGTH);
}

function normalizeExtraQueryParams(extraCandidates = []) {
  const normalized = {};
  const seenKeys = new Set();

  for (const [rawKey, rawValue] of extraCandidates) {
    if (Object.keys(normalized).length >= MAX_EXTRA_QUERY_KEYS) break;

    const key = normalizeExtraKey(rawKey);
    if (!key) continue;

    const lowerKey = key.toLowerCase();
    if (seenKeys.has(lowerKey)) continue;
    if (KNOWN_QUERY_PARAM_KEYS.has(lowerKey)) continue;
    if (STRUCTURAL_OBJECT_KEYS.has(lowerKey)) continue;
    if (looksSensitiveExtraKey(lowerKey)) continue;

    const value = normalizeString(rawValue, MAX_EXTRA_QUERY_VALUE_LENGTH);
    if (!value) continue;

    seenKeys.add(lowerKey);
    normalized[key] = value;
  }

  return normalized;
}

function buildMarketingAttribution(values = {}, extraCandidates = []) {
  const refPage = normalizeString(values.refPage);
  const refCta = normalizeString(values.refCta);
  const planInterest = normalizeString(values.planInterest);
  const utm = {};
  const clickIds = {};

  const utmSource = normalizeString(values.utmSource);
  const utmMedium = normalizeString(values.utmMedium);
  const utmCampaign = normalizeString(values.utmCampaign);
  const utmContent = normalizeString(values.utmContent);
  const utmTerm = normalizeString(values.utmTerm);
  const gclid = normalizeString(values.gclid);
  const fbclid = normalizeString(values.fbclid);
  const msclkid = normalizeString(values.msclkid);

  if (utmSource) utm.source = utmSource;
  if (utmMedium) utm.medium = utmMedium;
  if (utmCampaign) utm.campaign = utmCampaign;
  if (utmContent) utm.content = utmContent;
  if (utmTerm) utm.term = utmTerm;

  if (gclid) clickIds.gclid = gclid;
  if (fbclid) clickIds.fbclid = fbclid;
  if (msclkid) clickIds.msclkid = msclkid;

  const extraQueryParams = normalizeExtraQueryParams(extraCandidates);
  const result = {};

  if (refPage) result.refPage = refPage;
  if (refCta) result.refCta = refCta;
  if (planInterest) result.planInterest = planInterest;
  if (hasOwnKeys(utm)) result.utm = utm;
  if (hasOwnKeys(clickIds)) result.clickIds = clickIds;
  if (hasOwnKeys(extraQueryParams)) result.extraQueryParams = extraQueryParams;

  return result;
}

function normalizeMarketingAttributionFromSearchParams(searchParams) {
  const known = {};
  const extraCandidates = [];
  const seenKeys = new Set();

  for (const [rawKey, rawValue] of searchParams.entries()) {
    const key = normalizeExtraKey(rawKey);
    if (!key) continue;

    const lowerKey = key.toLowerCase();
    if (seenKeys.has(lowerKey)) continue;
    seenKeys.add(lowerKey);

    if (lowerKey === "ref_page") known.refPage = rawValue;
    else if (lowerKey === "ref_cta") known.refCta = rawValue;
    else if (lowerKey === "plan_interest") known.planInterest = rawValue;
    else if (lowerKey === "utm_source") known.utmSource = rawValue;
    else if (lowerKey === "utm_medium") known.utmMedium = rawValue;
    else if (lowerKey === "utm_campaign") known.utmCampaign = rawValue;
    else if (lowerKey === "utm_content") known.utmContent = rawValue;
    else if (lowerKey === "utm_term") known.utmTerm = rawValue;
    else if (lowerKey === "gclid") known.gclid = rawValue;
    else if (lowerKey === "fbclid") known.fbclid = rawValue;
    else if (lowerKey === "msclkid") known.msclkid = rawValue;
    else extraCandidates.push([key, rawValue]);
  }

  return buildMarketingAttribution(known, extraCandidates);
}

function normalizeMarketingAttributionFromObject(input) {
  const source = asObject(input);
  const utm = asObject(source.utm);
  const clickIds = asObject(source.clickIds || source.click_ids);
  const explicitExtras = asObject(source.extraQueryParams || source.extra_query_params);
  const extraCandidates = Object.entries(explicitExtras);

  for (const [key, value] of Object.entries(source)) {
    const lowerKey = String(key || "").trim().toLowerCase();
    if (!lowerKey) continue;
    if (STRUCTURAL_OBJECT_KEYS.has(lowerKey)) continue;
    if (KNOWN_QUERY_PARAM_KEYS.has(lowerKey)) continue;
    extraCandidates.push([key, value]);
  }

  return buildMarketingAttribution(
    {
      refPage: pickFirstMeaningful([source.refPage, source.ref_page]),
      refCta: pickFirstMeaningful([source.refCta, source.ref_cta]),
      planInterest: pickFirstMeaningful([source.planInterest, source.plan_interest]),
      utmSource: pickFirstMeaningful([source.utmSource, source.utm_source, utm.source]),
      utmMedium: pickFirstMeaningful([source.utmMedium, source.utm_medium, utm.medium]),
      utmCampaign: pickFirstMeaningful([source.utmCampaign, source.utm_campaign, utm.campaign]),
      utmContent: pickFirstMeaningful([source.utmContent, source.utm_content, utm.content]),
      utmTerm: pickFirstMeaningful([source.utmTerm, source.utm_term, utm.term]),
      gclid: pickFirstMeaningful([source.gclid, clickIds.gclid]),
      fbclid: pickFirstMeaningful([source.fbclid, clickIds.fbclid]),
      msclkid: pickFirstMeaningful([source.msclkid, clickIds.msclkid])
    },
    extraCandidates
  );
}

export function normalizeMarketingAttribution(input) {
  if (isUrlSearchParams(input)) {
    return normalizeMarketingAttributionFromSearchParams(input);
  }
  return normalizeMarketingAttributionFromObject(input);
}

export function isEmptyMarketingAttribution(input) {
  return !hasOwnKeys(normalizeMarketingAttribution(input));
}
