import crypto from "node:crypto";
import { scrapeDemoWebsite } from "./demoWebsiteScraper.js";
import {
  buildDemoKnowledgeBundle,
  DEMO_BUNDLE_EXTRACTION_VERSION
} from "./demoKnowledgeBundle.js";
import { inferKnowledgeAssignmentsForIndustry } from "./knowledgeReceptionistPacks.js";

export const SALES_DEMO_TTL_DAYS = 30;
export const SALES_WARM_QUEUE_SIZE = 11;
export const SALES_OUTCOMES = Object.freeze([
  "no_answer",
  "voicemail",
  "wrong_number",
  "callback_requested",
  "not_interested",
  "do_not_call",
  "connected_no_demo",
  "demo_completed",
  "signup_link_sent",
  "signup_completed"
]);

const ACTIVE_CALL_QUEUE_STATUSES = new Set(["queued", "ready_to_call"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMPORT_ROWS = 5000;
const MAX_NOTE_LENGTH = 5000;
const DEFAULT_SIGNUP_INVITE_TTL_MINUTES = 60;
const DEFAULT_SALES_CALL_WINDOW_START_LOCAL = "08:00";
const DEFAULT_SALES_CALL_WINDOW_END_LOCAL = "20:00";
const SALES_SIGNUP_CATEGORY_ALIASES = Object.freeze({
  appliance_repair: "service_business",
  appliance_repair_service: "service_business",
  appliance_service: "service_business",
  appliance_services: "service_business"
});

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function salesError(code, message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

export function normalizeSalesText(value, maxLength = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeOptionalEmail(value) {
  const email = normalizeSalesText(value, 320).toLowerCase();
  if (!email) return null;
  if (!EMAIL_PATTERN.test(email)) {
    throw salesError("invalid_email", `Invalid email address: ${email}`);
  }
  return email;
}

function normalizeWebsite(value) {
  const input = normalizeSalesText(value, 1000);
  if (!input) return null;
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw salesError("invalid_website_url", `Invalid website URL: ${input}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    throw salesError("invalid_website_url", `Invalid website URL: ${input}`);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeSalesTimezone(value) {
  const timezone = normalizeSalesText(value, 100);
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone })
      .resolvedOptions()
      .timeZone;
  } catch {
    throw salesError("invalid_timezone", `Invalid IANA timezone: ${timezone}`);
  }
}

export function getSalesMissingTimezonePolicy(env = process.env) {
  return normalizeSalesText(
    env?.SALES_CALL_MISSING_TIMEZONE_POLICY,
    20
  ).toLowerCase() === "allow" ? "allow" : "block";
}

export function normalizeSalesPhone(value, { defaultCountryCode = "1" } = {}) {
  const raw = normalizeSalesText(value, 80);
  if (!raw) {
    throw salesError("phone_required", "Phone number is required.");
  }
  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!hasPlus && digits.length === 10 && defaultCountryCode) {
    digits = `${String(defaultCountryCode).replace(/\D/g, "")}${digits}`;
  }
  if (digits.length < 8 || digits.length > 15) {
    throw salesError("invalid_phone", `Invalid phone number: ${raw}`);
  }
  return `+${digits}`;
}

export function parseSalesPermission(value) {
  if (value === true || value === false) return value;
  const normalized = normalizeSalesText(value, 20).toLowerCase();
  if (["yes", "y", "true", "1", "permitted"].includes(normalized)) return true;
  if (["no", "n", "false", "0", "not permitted"].includes(normalized)) return false;
  throw salesError(
    "permission_required",
    "Each prospect must include an explicit yes/no permission value."
  );
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = normalizeSalesText(value, 20).toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return fallback;
}

function normalizeHeaderName(value) {
  return normalizeSalesText(value, 200)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseSalesProspectCsv(csvText) {
  const input = String(csvText ?? "");
  if (!input.trim()) {
    throw salesError("csv_required", "CSV content is required.");
  }

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) {
    throw salesError("csv_invalid", "CSV contains an unterminated quoted field.");
  }
  row.push(field);
  if (row.some((value) => String(value).trim())) rows.push(row);
  if (rows.length < 2) {
    throw salesError("csv_empty", "CSV must contain a header and at least one prospect.");
  }

  const headers = rows[0].map(normalizeHeaderName);
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) {
    throw salesError("csv_duplicate_headers", "CSV headers must be unique.");
  }

  return rows.slice(1)
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function readAlias(record, aliases) {
  for (const alias of aliases) {
    if (record?.[alias] !== undefined && record?.[alias] !== null && String(record[alias]).trim() !== "") {
      return record[alias];
    }
  }
  return "";
}

function normalizeRecordKeys(record) {
  const output = {};
  for (const [key, value] of Object.entries(record && typeof record === "object" ? record : {})) {
    output[normalizeHeaderName(key)] = value;
  }
  return output;
}

export function normalizeSalesImportRecord(record, {
  defaultCountryCode = "1",
  rowNumber = null,
  env = process.env
} = {}) {
  const source = normalizeRecordKeys(record);
  const businessName = normalizeSalesText(readAlias(source, [
    "business_name", "business", "company_name", "company", "shop_name"
  ]), 300);
  if (!businessName) {
    throw salesError("business_name_required", "Business name is required.");
  }

  const phoneE164 = normalizeSalesPhone(readAlias(source, [
    "phone_e164", "phone", "phone_number", "telephone", "business_phone"
  ]), { defaultCountryCode });
  const permissionGranted = parseSalesPermission(readAlias(source, [
    "permission_granted", "permission", "permitted", "has_permission", "permission_yes_no"
  ]));
  const websiteUrl = normalizeWebsite(readAlias(source, [
    "website_url", "website", "url", "business_website"
  ]));
  const externalRef = normalizeSalesText(readAlias(source, [
    "external_ref", "external_id", "record_id", "id"
  ]), 240) || null;
  const sourceKeyInput = externalRef
    ? `external:${externalRef.toLowerCase()}`
    : `prospect:${phoneE164}|${websiteUrl || ""}`;
  const sourceKey = crypto.createHash("sha256").update(sourceKeyInput, "utf8").digest("hex");
  const emailPermissionInput = readAlias(source, [
    "email_permission", "email_permitted", "permission_to_email", "email_permission_yes_no"
  ]);
  const contactName = normalizeSalesText(readAlias(source, [
    "contact_name", "owner_name", "full_name"
  ]), 240) || null;
  const explicitOwnerFirstName = normalizeSalesText(readAlias(source, [
    "owner_first_name", "first_name", "owner", "contact_first_name"
  ]), 120) || null;

  const timezone = normalizeSalesTimezone(readAlias(source, [
    "timezone", "time_zone", "tz"
  ]));
  if (!timezone && getSalesMissingTimezonePolicy(env) === "block") {
    throw salesError(
      "timezone_required",
      "Timezone is required while SALES_CALL_MISSING_TIMEZONE_POLICY is block."
    );
  }

  return {
    sourceKey,
    externalRef,
    businessName,
    ownerFirstName: explicitOwnerFirstName
      || normalizeSalesText(contactName?.split(/\s+/)[0], 120)
      || null,
    contactName,
    contactEmail: normalizeOptionalEmail(readAlias(source, [
      "contact_email", "email", "login_email"
    ])),
    emailPermission: emailPermissionInput === ""
      ? permissionGranted
      : parseSalesPermission(emailPermissionInput),
    leadDeliveryEmail: normalizeOptionalEmail(readAlias(source, [
      "lead_delivery_email", "lead_email", "notification_email"
    ])),
    phoneE164,
    websiteUrl,
    businessCategory: normalizeSalesText(readAlias(source, [
      "business_category", "category", "industry"
    ]), 160) || null,
    competitorName: normalizeSalesText(readAlias(source, [
      "competitor_name", "competitor", "top_competitor"
    ]), 300) || null,
    timezone,
    permissionGranted,
    suppressed: normalizeBoolean(readAlias(source, ["suppressed"]), false),
    suppressionReason: normalizeSalesText(readAlias(source, [
      "suppression_reason", "suppressed_reason"
    ]), 500) || null,
    doNotCall: normalizeBoolean(readAlias(source, ["do_not_call", "dnc"]), false),
    rowNumber
  };
}

export function normalizeSalesImportRecords(records, options = {}) {
  if (!Array.isArray(records)) {
    throw salesError("records_required", "Prospect records must be an array.");
  }
  if (!records.length) {
    throw salesError("records_required", "At least one prospect record is required.");
  }
  if (records.length > MAX_IMPORT_ROWS) {
    throw salesError("too_many_records", `A single import is limited to ${MAX_IMPORT_ROWS} records.`);
  }

  const valid = [];
  const errors = [];
  records.forEach((record, index) => {
    try {
      valid.push(normalizeSalesImportRecord(record, {
        ...options,
        rowNumber: index + 2
      }));
    } catch (error) {
      errors.push({
        rowNumber: index + 2,
        code: error?.code || "invalid_record",
        message: error?.message || "Invalid prospect record."
      });
    }
  });
  return { valid, errors };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function json(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value ?? fallback);
}

async function withTransaction(pool, callback) {
  if (!pool?.connect) {
    return callback(pool);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function parseLocalClock(value, fallback) {
  const normalized = normalizeSalesText(value, 20);
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return parseLocalClock(fallback, "00:00");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return parseLocalClock(fallback, "00:00");
  }
  return {
    label: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    minutes: (hours * 60) + minutes
  };
}

export function evaluateSalesCallingWindow(timezone, {
  now = new Date(),
  env = process.env
} = {}) {
  const start = parseLocalClock(
    env?.SALES_CALL_WINDOW_START_LOCAL,
    DEFAULT_SALES_CALL_WINDOW_START_LOCAL
  );
  const end = parseLocalClock(
    env?.SALES_CALL_WINDOW_END_LOCAL,
    DEFAULT_SALES_CALL_WINDOW_END_LOCAL
  );
  const missingTimezonePolicy = getSalesMissingTimezonePolicy(env);
  const inputTimezone = normalizeSalesText(timezone, 100);
  if (!inputTimezone) {
    const allowed = missingTimezonePolicy === "allow";
    return {
      allowed,
      timezone: null,
      localTime: null,
      startLocal: start.label,
      endLocal: end.label,
      missingTimezonePolicy,
      validationSkipped: allowed,
      reasonCode: allowed ? "timezone_missing_allowed" : "timezone_required",
      reason: allowed ? null : "Add an IANA timezone before placing this call."
    };
  }

  let canonicalTimezone;
  try {
    canonicalTimezone = new Intl.DateTimeFormat("en-US", {
      timeZone: inputTimezone
    }).resolvedOptions().timeZone;
  } catch {
    return {
      allowed: false,
      timezone: inputTimezone,
      localTime: null,
      startLocal: start.label,
      endLocal: end.label,
      missingTimezonePolicy,
      validationSkipped: false,
      reasonCode: "timezone_invalid",
      reason: "Correct the prospect's IANA timezone before placing this call."
    };
  }

  const instant = now instanceof Date ? now : new Date(now);
  const safeInstant = Number.isNaN(instant.getTime()) ? new Date() : instant;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: canonicalTimezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(safeInstant);
  const localHour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const localMinute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const localMinutes = (localHour * 60) + localMinute;
  const localTime = `${String(localHour).padStart(2, "0")}:${String(localMinute).padStart(2, "0")}`;
  const allowed = start.minutes === end.minutes
    || (
      start.minutes < end.minutes
        ? localMinutes >= start.minutes && localMinutes < end.minutes
        : localMinutes >= start.minutes || localMinutes < end.minutes
    );
  return {
    allowed,
    timezone: canonicalTimezone,
    localTime,
    startLocal: start.label,
    endLocal: end.label,
    missingTimezonePolicy,
    validationSkipped: false,
    reasonCode: allowed ? null : "outside_calling_window",
    reason: allowed
      ? null
      : `Configured calling window is ${start.label}-${end.label} local time; it is currently ${localTime} in ${canonicalTimezone}.`
  };
}

function prospectPreparationBlock(row) {
  if (!row?.permission_granted) {
    return {
      code: "permission_not_granted",
      reason: "Permission is not granted for this prospect."
    };
  }
  if (row?.do_not_call) {
    return {
      code: "do_not_call",
      reason: "This prospect is marked do not call."
    };
  }
  if (row?.suppressed) {
    return {
      code: "prospect_suppressed",
      reason: normalizeSalesText(row?.suppression_reason, 500)
        || "This prospect is suppressed."
    };
  }
  if (!ACTIVE_CALL_QUEUE_STATUSES.has(normalizeSalesText(row?.status, 60).toLowerCase())) {
    return {
      code: "prospect_not_in_calling_queue",
      reason: "This prospect is not in an active calling-queue state."
    };
  }
  return null;
}

function demoStatus(row) {
  const current = normalizeSalesText(row?.demo_status, 60) || "not_prepared";
  if (current === "ready" && row?.demo_expires_at && new Date(row.demo_expires_at).getTime() <= Date.now()) {
    return "stale";
  }
  return current;
}

function localTimeForZone(timezone) {
  const normalized = normalizeSalesText(timezone, 100);
  if (!normalized) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: normalized,
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date());
  } catch {
    return null;
  }
}

function serializeProspect(row) {
  if (!row) return null;
  const prospectMetadata = asObject(row.metadata_json);
  const salesSkip = asObject(prospectMetadata.salesSkip);
  const preparationBlock = prospectPreparationBlock(row);
  const callingWindow = evaluateSalesCallingWindow(row.timezone);
  const callBlock = preparationBlock || (!callingWindow.allowed
    ? { code: callingWindow.reasonCode, reason: callingWindow.reason }
    : null);
  const effectiveDemoStatus = demoStatus(row);
  const demoBundle = effectiveDemoStatus === "ready" ? asObject(row.demo_bundle) : {};
  const topServices = asArray(demoBundle.topServices)
    .map((value) => normalizeSalesText(value, 200))
    .filter(Boolean)
    .slice(0, 5);
  const contactFacts = asArray(demoBundle.contactFacts)
    .map((value) => normalizeSalesText(value, 300))
    .filter(Boolean)
    .slice(0, 5);
  const talkingPoints = [
    normalizeSalesText(demoBundle.summary, 1000),
    topServices.length ? `Services: ${topServices.join(", ")}` : "",
    normalizeSalesText(demoBundle.serviceArea, 300)
      ? `Service area: ${normalizeSalesText(demoBundle.serviceArea, 300)}`
      : "",
    normalizeSalesText(demoBundle.hours, 300)
      ? `Hours: ${normalizeSalesText(demoBundle.hours, 300)}`
      : "",
    ...contactFacts
  ].filter(Boolean);
  return {
    prospectId: normalizeSalesText(row.prospect_id, 200),
    externalRef: normalizeSalesText(row.external_ref, 240) || null,
    businessName: normalizeSalesText(row.business_name, 300),
    ownerFirstName: normalizeSalesText(row.owner_first_name, 120) || null,
    contactName: normalizeSalesText(row.contact_name, 240) || null,
    contactEmail: normalizeSalesText(row.contact_email, 320).toLowerCase() || null,
    emailPermission: Boolean(row.email_permission),
    emailSuppressedAt: row.email_suppressed_at || null,
    emailSuppressionReason: normalizeSalesText(row.email_suppression_reason, 500) || null,
    smartleadLeadId: normalizeSalesText(row.smartlead_lead_id, 240) || null,
    smartleadCampaignId: normalizeSalesText(row.smartlead_campaign_id, 240) || null,
    smartleadStatus: normalizeSalesText(row.smartlead_status, 120) || null,
    lastEmailEventAt: row.last_email_event_at || null,
    leadDeliveryEmail: normalizeSalesText(row.lead_delivery_email, 320).toLowerCase() || null,
    phoneE164: normalizeSalesText(row.phone_e164, 40),
    websiteUrl: normalizeSalesText(row.website_url, 1000) || null,
    businessCategory: normalizeSalesText(row.business_category, 160) || null,
    competitorName: normalizeSalesText(row.competitor_name, 300) || null,
    timezone: normalizeSalesText(row.timezone, 100) || null,
    localTime: localTimeForZone(row.timezone),
    permissionGranted: Boolean(row.permission_granted),
    suppressed: Boolean(row.suppressed),
    suppressionReason: normalizeSalesText(row.suppression_reason, 500) || null,
    doNotCall: Boolean(row.do_not_call),
    preparationEligible: !preparationBlock,
    eligible: !callBlock,
    callBlockedCode: callBlock?.code || null,
    callBlockedReason: callBlock?.reason || null,
    callingWindow,
    queuePosition: Number(row.queue_position || 0),
    status: normalizeSalesText(row.status, 60) || "queued",
    lastOutcome: normalizeSalesText(row.last_outcome, 80) || null,
    lastOutcomeAt: row.last_outcome_at || null,
    skippedReason: normalizeSalesText(salesSkip.reason, 500) || null,
    skippedAt: salesSkip.skippedAt || null,
    demo: {
      demoProfileId: normalizeSalesText(row.demo_profile_id, 200) || null,
      status: effectiveDemoStatus,
      previewSummary: effectiveDemoStatus === "ready"
        ? normalizeSalesText(row.demo_preview_summary, 1000) || null
        : null,
      talkingPoints,
      talkingPointDetails: {
        summary: normalizeSalesText(demoBundle.summary, 1000) || null,
        topServices,
        serviceArea: normalizeSalesText(demoBundle.serviceArea, 300) || null,
        hours: normalizeSalesText(demoBundle.hours, 300) || null,
        contactFacts
      },
      businessName: normalizeSalesText(row.demo_business_name, 300) || null,
      failureCode: normalizeSalesText(row.demo_failure_code, 120) || null,
      failureMessage: normalizeSalesText(row.demo_failure_message, 1000) || null,
      expiresAt: row.demo_expires_at || null,
      updatedAt: row.demo_updated_at || null
    },
    rowVersion: Number(row.row_version || 1),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

const PROSPECT_WITH_DEMO_SELECT = `
  SELECT p.*,
         d.demo_profile_id,
         d.status AS demo_status,
         d.business_name AS demo_business_name,
         d.preview_summary AS demo_preview_summary,
         d.demo_bundle_json AS demo_bundle,
         d.failure_code AS demo_failure_code,
         d.failure_message AS demo_failure_message,
         d.expires_at AS demo_expires_at,
         d.updated_at AS demo_updated_at
  FROM sales_prospects p
  LEFT JOIN sales_demo_profiles d ON d.prospect_id = p.prospect_id`;

const SIGNUP_INVITATION_PROGRESS_SELECT = `
  SELECT i.invitation_id, i.prospect_id, i.sales_call_id, i.status,
         i.delivery_email, i.expires_at, i.sent_at, i.opened_at,
         i.consumed_at, i.submitted_at, i.converted_tenant_key,
         i.revoked_at, i.created_at, i.updated_at,
         t.tenant_key AS linked_tenant_key,
         t.status AS tenant_status,
         t.telnyx_voice_number,
         t.telnyx_voice_status,
         provisioning.status AS provisioning_job_status,
         provisioning.status_detail AS provisioning_status_detail,
         provisioning.error_code AS provisioning_error_code,
         provisioning.error_message AS provisioning_error_message
  FROM sales_signup_invitations i
  LEFT JOIN tenants t
    ON t.tenant_key = i.converted_tenant_key
  LEFT JOIN LATERAL (
    SELECT pj.status, pj.status_detail, pj.error_code, pj.error_message
    FROM provisioning_jobs pj
    WHERE pj.tenant_key = i.converted_tenant_key
      AND pj.stage = 'number_setup'
    ORDER BY pj.updated_at DESC, pj.id DESC
    LIMIT 1
  ) provisioning ON TRUE`;

export async function importSalesProspects(pool, {
  records,
  adminUserId,
  defaultCountryCode = "1",
  env = process.env
}) {
  const normalized = normalizeSalesImportRecords(records, {
    defaultCountryCode,
    env
  });
  const imported = [];

  await withTransaction(pool, async (db) => {
    for (const record of normalized.valid) {
      const prospectId = createId("sales_prospect");
      const result = await db.query(
        `INSERT INTO sales_prospects (
           prospect_id, source_key, external_ref, business_name, owner_first_name,
           contact_name, contact_email, email_permission, email_suppressed_at,
           email_suppression_reason, lead_delivery_email, phone_e164, website_url,
           business_category, competitor_name, timezone, permission_granted,
           permission_recorded_at, suppressed, suppression_reason, suppressed_at,
           do_not_call, do_not_call_at, status, imported_by_admin_user_id
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, CASE WHEN $16 THEN NOW() ELSE NULL END,
           CASE WHEN $16 THEN COALESCE($17, 'suppressed') ELSE NULL END,
           $9, $10, $11,
           $12, $13, $14, $15,
           NOW(), $16, $17, CASE WHEN $16 THEN NOW() ELSE NULL END,
           $18, CASE WHEN $18 THEN NOW() ELSE NULL END,
           CASE WHEN $18 THEN 'do_not_call' WHEN $16 THEN 'suppressed' ELSE 'queued' END,
           $19
         )
         ON CONFLICT (source_key)
         DO UPDATE SET
           external_ref = COALESCE(EXCLUDED.external_ref, sales_prospects.external_ref),
           business_name = EXCLUDED.business_name,
           owner_first_name = COALESCE(EXCLUDED.owner_first_name, sales_prospects.owner_first_name),
           contact_name = COALESCE(EXCLUDED.contact_name, sales_prospects.contact_name),
           contact_email = COALESCE(EXCLUDED.contact_email, sales_prospects.contact_email),
           email_permission = EXCLUDED.email_permission,
           email_suppressed_at = CASE
             WHEN sales_prospects.suppressed OR EXCLUDED.suppressed
               THEN COALESCE(
                 sales_prospects.email_suppressed_at,
                 EXCLUDED.email_suppressed_at,
                 NOW()
               )
             ELSE sales_prospects.email_suppressed_at
           END,
           email_suppression_reason = CASE
             WHEN sales_prospects.suppressed OR EXCLUDED.suppressed
               THEN COALESCE(
                 sales_prospects.email_suppression_reason,
                 EXCLUDED.email_suppression_reason,
                 'suppressed'
               )
             ELSE sales_prospects.email_suppression_reason
           END,
           lead_delivery_email = COALESCE(EXCLUDED.lead_delivery_email, sales_prospects.lead_delivery_email),
           phone_e164 = EXCLUDED.phone_e164,
           website_url = COALESCE(EXCLUDED.website_url, sales_prospects.website_url),
           business_category = COALESCE(EXCLUDED.business_category, sales_prospects.business_category),
           competitor_name = COALESCE(EXCLUDED.competitor_name, sales_prospects.competitor_name),
           timezone = COALESCE(EXCLUDED.timezone, sales_prospects.timezone),
           permission_granted = EXCLUDED.permission_granted,
           permission_recorded_at = NOW(),
           suppressed = sales_prospects.suppressed OR EXCLUDED.suppressed,
           suppression_reason = COALESCE(sales_prospects.suppression_reason, EXCLUDED.suppression_reason),
           suppressed_at = CASE
             WHEN sales_prospects.suppressed OR EXCLUDED.suppressed
               THEN COALESCE(sales_prospects.suppressed_at, NOW())
             ELSE NULL
           END,
           do_not_call = sales_prospects.do_not_call OR EXCLUDED.do_not_call,
           do_not_call_at = CASE
             WHEN sales_prospects.do_not_call OR EXCLUDED.do_not_call
               THEN COALESCE(sales_prospects.do_not_call_at, NOW())
             ELSE NULL
           END,
           status = CASE
             WHEN sales_prospects.do_not_call OR EXCLUDED.do_not_call THEN 'do_not_call'
             WHEN sales_prospects.suppressed OR EXCLUDED.suppressed THEN 'suppressed'
             ELSE sales_prospects.status
           END,
           imported_by_admin_user_id = EXCLUDED.imported_by_admin_user_id,
           row_version = sales_prospects.row_version + 1,
           updated_at = NOW()
         RETURNING prospect_id, (xmax = 0) AS inserted`,
        [
          prospectId,
          record.sourceKey,
          record.externalRef,
          record.businessName,
          record.ownerFirstName,
          record.contactName,
          record.contactEmail,
          record.emailPermission,
          record.leadDeliveryEmail,
          record.phoneE164,
          record.websiteUrl,
          record.businessCategory,
          record.competitorName,
          record.timezone,
          record.permissionGranted,
          record.suppressed || record.doNotCall,
          record.suppressionReason || (record.doNotCall ? "do_not_call" : null),
          record.doNotCall,
          Number(adminUserId)
        ]
      );
      imported.push({
        rowNumber: record.rowNumber,
        prospectId: result.rows[0]?.prospect_id,
        inserted: Boolean(result.rows[0]?.inserted)
      });
      await invalidateSalesDemoIfWebsiteChanged(db, result.rows[0]?.prospect_id);
    }
  });

  return {
    receivedCount: records.length,
    importedCount: imported.length,
    insertedCount: imported.filter((item) => item.inserted).length,
    updatedCount: imported.filter((item) => !item.inserted).length,
    rejectedCount: normalized.errors.length,
    imported,
    errors: normalized.errors
  };
}

export async function listSalesProspects(pool, {
  limit = 100,
  afterQueuePosition = 0,
  status = "",
  eligibleOnly = false,
  search = ""
} = {}) {
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
  const values = [Number(afterQueuePosition) || 0];
  const where = ["p.queue_position > $1"];

  if (normalizeSalesText(status, 60)) {
    values.push(normalizeSalesText(status, 60));
    where.push(`p.status = $${values.length}`);
  }
  if (eligibleOnly) {
    where.push("p.permission_granted = TRUE");
    where.push("p.suppressed = FALSE");
    where.push("p.do_not_call = FALSE");
    where.push("p.status IN ('queued', 'ready_to_call')");
  }
  if (normalizeSalesText(search, 200)) {
    values.push(`%${normalizeSalesText(search, 200)}%`);
    where.push(`(
      p.business_name ILIKE $${values.length}
      OR p.contact_name ILIKE $${values.length}
      OR p.phone_e164 ILIKE $${values.length}
      OR p.website_url ILIKE $${values.length}
    )`);
  }
  values.push(eligibleOnly ? 250 : safeLimit);

  const query = `${PROSPECT_WITH_DEMO_SELECT}
    WHERE ${where.join(" AND ")}
    ORDER BY p.queue_position ASC
    LIMIT $${values.length}`;
  const prospects = [];
  const queryValues = [...values];
  const pageLimit = Number(queryValues.at(-1));
  for (let page = 0; page < (eligibleOnly ? 20 : 1); page += 1) {
    const result = await pool.query(query, queryValues);
    prospects.push(
      ...result.rows
        .map(serializeProspect)
        .filter((prospect) => !eligibleOnly || prospect.eligible)
    );
    if (
      prospects.length >= safeLimit
      || result.rows.length < pageLimit
      || !result.rows.length
    ) {
      break;
    }
    queryValues[0] = Number(result.rows.at(-1)?.queue_position || queryValues[0]);
  }
  prospects.splice(safeLimit);
  return {
    prospects,
    nextQueuePosition: prospects.length === safeLimit
      ? prospects[prospects.length - 1]?.queuePosition || null
      : null
  };
}

export async function getSalesProspect(pool, prospectId) {
  const id = normalizeSalesText(prospectId, 200);
  if (!id) return null;
  const result = await pool.query(
    `${PROSPECT_WITH_DEMO_SELECT}
     WHERE p.prospect_id = $1
     LIMIT 1`,
    [id]
  );
  return serializeProspect(result.rows[0]);
}

export async function getSalesProspectDetail(pool, prospectId) {
  const prospect = await getSalesProspect(pool, prospectId);
  if (!prospect) return null;
  const [notes, calls, invitations, profile] = await Promise.all([
    pool.query(
      `SELECT sales_prospect_note_id, sales_call_id, body, created_by_admin_user_id, created_at
       FROM sales_prospect_notes
       WHERE prospect_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [prospect.prospectId]
    ),
    pool.query(
      `SELECT *
       FROM sales_call_sessions
       WHERE prospect_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [prospect.prospectId]
    ),
    pool.query(
      `${SIGNUP_INVITATION_PROGRESS_SELECT}
       WHERE i.prospect_id = $1
       ORDER BY i.created_at DESC
       LIMIT 100`,
      [prospect.prospectId]
    ),
    pool.query(
      `SELECT *
       FROM sales_demo_profiles
       WHERE prospect_id = $1
       LIMIT 1`,
      [prospect.prospectId]
    )
  ]);

  return {
    ...prospect,
    demoProfile: serializeDemoProfile(profile.rows[0]),
    notes: notes.rows.map((row) => ({
      noteId: row.sales_prospect_note_id,
      salesCallId: row.sales_call_id || null,
      body: row.body,
      createdByAdminUserId: row.created_by_admin_user_id
        ? Number(row.created_by_admin_user_id)
        : null,
      createdAt: row.created_at || null
    })),
    calls: calls.rows.map(serializeSalesCallSession),
    signupInvitations: invitations.rows.map(serializeSignupInvitation)
  };
}

export async function updateSalesProspect(pool, prospectId, changes = {}) {
  const id = normalizeSalesText(prospectId, 200);
  const existing = await getSalesProspect(pool, id);
  if (!existing) throw salesError("prospect_not_found", "Prospect not found.", 404);
  const broadSuppressionRequested = (
    (changes.suppressed !== undefined && normalizeBoolean(changes.suppressed))
    || (changes.doNotCall !== undefined && normalizeBoolean(changes.doNotCall))
  );

  const assignments = [];
  const values = [];
  const assign = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (changes.businessName !== undefined) {
    const value = normalizeSalesText(changes.businessName, 300);
    if (!value) throw salesError("business_name_required", "Business name is required.");
    assign("business_name", value);
  }
  if (changes.ownerFirstName !== undefined) assign("owner_first_name", normalizeSalesText(changes.ownerFirstName, 120) || null);
  if (changes.contactName !== undefined) assign("contact_name", normalizeSalesText(changes.contactName, 240) || null);
  if (changes.contactEmail !== undefined) assign("contact_email", normalizeOptionalEmail(changes.contactEmail));
  if (changes.emailPermission !== undefined) {
    assign("email_permission", parseSalesPermission(changes.emailPermission));
  }
  if (changes.emailSuppressed !== undefined) {
    const emailSuppressed = broadSuppressionRequested
      ? true
      : normalizeBoolean(changes.emailSuppressed);
    assignments.push(`email_suppressed_at = ${emailSuppressed ? "COALESCE(email_suppressed_at, NOW())" : "NULL"}`);
    if (!emailSuppressed && changes.emailSuppressionReason === undefined) {
      assignments.push("email_suppression_reason = NULL");
    }
  }
  if (changes.emailSuppressionReason !== undefined) {
    assign("email_suppression_reason", normalizeSalesText(changes.emailSuppressionReason, 500) || null);
  }
  if (changes.leadDeliveryEmail !== undefined) assign("lead_delivery_email", normalizeOptionalEmail(changes.leadDeliveryEmail));
  if (changes.phoneE164 !== undefined) assign("phone_e164", normalizeSalesPhone(changes.phoneE164));
  if (changes.websiteUrl !== undefined) assign("website_url", normalizeWebsite(changes.websiteUrl));
  if (changes.businessCategory !== undefined) assign("business_category", normalizeSalesText(changes.businessCategory, 160) || null);
  if (changes.competitorName !== undefined) assign("competitor_name", normalizeSalesText(changes.competitorName, 300) || null);
  if (changes.timezone !== undefined) assign("timezone", normalizeSalesTimezone(changes.timezone));
  if (changes.permissionGranted !== undefined) {
    assign("permission_granted", parseSalesPermission(changes.permissionGranted));
    assignments.push("permission_recorded_at = NOW()");
  }
  if (changes.suppressed !== undefined) {
    const suppressed = broadSuppressionRequested;
    assign("suppressed", suppressed);
    assignments.push(`suppressed_at = ${suppressed ? "COALESCE(suppressed_at, NOW())" : "NULL"}`);
  }
  if (changes.suppressionReason !== undefined) {
    assign("suppression_reason", normalizeSalesText(changes.suppressionReason, 500) || null);
  }
  if (changes.doNotCall !== undefined) {
    const doNotCall = normalizeBoolean(changes.doNotCall);
    assign("do_not_call", doNotCall);
    assignments.push(`do_not_call_at = ${doNotCall ? "COALESCE(do_not_call_at, NOW())" : "NULL"}`);
    if (doNotCall) {
      if (changes.suppressed === undefined) {
        assignments.push("suppressed = TRUE");
        assignments.push("suppressed_at = COALESCE(suppressed_at, NOW())");
      }
      if (changes.suppressionReason === undefined) {
        assignments.push("suppression_reason = COALESCE(suppression_reason, 'do_not_call')");
      }
      assignments.push("status = 'do_not_call'");
    }
  }
  if (broadSuppressionRequested && changes.emailSuppressed === undefined) {
    assignments.push("email_suppressed_at = COALESCE(email_suppressed_at, NOW())");
  }
  if (broadSuppressionRequested && changes.emailSuppressionReason === undefined) {
    assignments.push(
      `email_suppression_reason = COALESCE(
        email_suppression_reason,
        ${changes.doNotCall !== undefined && normalizeBoolean(changes.doNotCall)
          ? "'do_not_call'"
          : "'suppressed'"}
      )`
    );
  }
  if (
    changes.status !== undefined
    && !(changes.doNotCall !== undefined && normalizeBoolean(changes.doNotCall))
  ) {
    assign("status", normalizeSalesText(changes.status, 60) || "queued");
  }

  if (!assignments.length) return existing;
  assignments.push("row_version = row_version + 1");
  assignments.push("updated_at = NOW()");
  values.push(id);
  await pool.query(
    `UPDATE sales_prospects
     SET ${assignments.join(", ")}
     WHERE prospect_id = $${values.length}`,
    values
  );
  if (changes.websiteUrl !== undefined) {
    await invalidateSalesDemoIfWebsiteChanged(pool, id);
  }
  return getSalesProspect(pool, id);
}

export async function getSalesProspectByNormalizedEmail(pool, email) {
  const normalizedEmail = normalizeOptionalEmail(email);
  if (!normalizedEmail) return null;
  const result = await pool.query(
    `${PROSPECT_WITH_DEMO_SELECT}
     WHERE LOWER(p.contact_email) = $1
     ORDER BY p.updated_at DESC
     LIMIT 1`,
    [normalizedEmail]
  );
  return serializeProspect(result.rows[0]);
}

export async function updateSalesProspectEmailState(pool, email, changes = {}) {
  const normalizedEmail = normalizeOptionalEmail(email);
  if (!normalizedEmail) {
    throw salesError("contact_email_required", "A contact email is required.");
  }
  const assignments = [];
  const values = [];
  const assign = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (changes.emailPermission !== undefined) {
    assign("email_permission", parseSalesPermission(changes.emailPermission));
  }
  if (changes.emailSuppressed !== undefined) {
    const suppressed = normalizeBoolean(changes.emailSuppressed);
    assignments.push(`email_suppressed_at = ${suppressed ? "COALESCE(email_suppressed_at, NOW())" : "NULL"}`);
    if (!suppressed && changes.emailSuppressionReason === undefined) {
      assignments.push("email_suppression_reason = NULL");
    }
  }
  if (changes.emailSuppressionReason !== undefined) {
    assign("email_suppression_reason", normalizeSalesText(changes.emailSuppressionReason, 500) || null);
  }
  if (changes.smartleadLeadId !== undefined) {
    assign("smartlead_lead_id", normalizeSalesText(changes.smartleadLeadId, 240) || null);
  }
  if (changes.smartleadCampaignId !== undefined) {
    assign("smartlead_campaign_id", normalizeSalesText(changes.smartleadCampaignId, 240) || null);
  }
  if (changes.smartleadStatus !== undefined) {
    assign("smartlead_status", normalizeSalesText(changes.smartleadStatus, 120) || null);
  }
  if (changes.lastEmailEventAt !== undefined) {
    assign("last_email_event_at", changes.lastEmailEventAt || null);
  }
  if (!assignments.length) return getSalesProspectByNormalizedEmail(pool, normalizedEmail);
  assignments.push("row_version = row_version + 1");
  assignments.push("updated_at = NOW()");
  values.push(normalizedEmail);
  const result = await pool.query(
    `UPDATE sales_prospects
     SET ${assignments.join(", ")}
     WHERE LOWER(contact_email) = $${values.length}
     RETURNING prospect_id`,
    values
  );
  if (!result.rowCount) {
    throw salesError("prospect_not_found", "Prospect not found.", 404);
  }
  return getSalesProspectByNormalizedEmail(pool, normalizedEmail);
}

function serializeDemoProfile(row) {
  if (!row) return null;
  const status = normalizeSalesText(row.status, 60) || "not_prepared";
  const expired = status === "ready"
    && row.expires_at
    && new Date(row.expires_at).getTime() <= Date.now();
  const usable = status === "ready" && !expired;
  return {
    demoProfileId: row.demo_profile_id,
    prospectId: row.prospect_id,
    status: expired ? "stale" : status,
    sourceWebsiteUrl: row.source_website_url || null,
    normalizedWebsiteUrl: row.normalized_website_url || null,
    websiteOrigin: row.website_origin || null,
    websiteHostname: row.website_hostname || null,
    businessName: usable ? row.business_name || null : null,
    previewSummary: usable ? row.preview_summary || null : null,
    demoBundle: usable ? asObject(row.demo_bundle_json) : {},
    scrapePageCount: usable ? Number(row.scrape_page_count || 0) : 0,
    scrapePages: usable ? asArray(row.scrape_pages_json) : [],
    extractionVersion: row.extraction_version || null,
    buildAttempts: Number(row.build_attempts || 0),
    failureCode: row.failure_code || null,
    failureMessage: row.failure_message || null,
    buildStartedAt: row.build_started_at || null,
    buildCompletedAt: row.build_completed_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function invalidateSalesDemoIfWebsiteChanged(pool, prospectId) {
  await pool.query(
    `UPDATE sales_demo_profiles d
     SET status = 'stale',
         source_website_url = p.website_url,
         normalized_website_url = NULL,
         website_origin = NULL,
         website_hostname = NULL,
         business_name = NULL,
         preview_summary = NULL,
         demo_bundle_json = '{}'::jsonb,
         scrape_page_count = 0,
         scrape_pages_json = '[]'::jsonb,
         extraction_version = NULL,
         failure_code = NULL,
         failure_message = NULL,
         expires_at = NULL,
         updated_at = NOW()
     FROM sales_prospects p
     WHERE d.prospect_id = p.prospect_id
       AND p.prospect_id = $1
       AND d.source_website_url IS DISTINCT FROM p.website_url`,
    [normalizeSalesText(prospectId, 200)]
  );
}

export async function getReadySalesDemoProfile(pool, prospectId) {
  const result = await pool.query(
    `SELECT *
     FROM sales_demo_profiles
     WHERE prospect_id = $1
       AND status = 'ready'
       AND expires_at > NOW()
     LIMIT 1`,
    [normalizeSalesText(prospectId, 200)]
  );
  return serializeDemoProfile(result.rows[0]);
}

export async function markExpiredSalesDemoProfiles(pool) {
  const result = await pool.query(
    `UPDATE sales_demo_profiles
     SET status = 'stale',
         normalized_website_url = NULL,
         website_origin = NULL,
         website_hostname = NULL,
         business_name = NULL,
         preview_summary = NULL,
         demo_bundle_json = '{}'::jsonb,
         scrape_page_count = 0,
         scrape_pages_json = '[]'::jsonb,
         extraction_version = NULL,
         updated_at = NOW()
     WHERE status = 'ready'
       AND expires_at IS NOT NULL
       AND expires_at <= NOW()
     RETURNING demo_profile_id`
  );
  return { expiredCount: Number(result.rowCount || 0) };
}

export async function enqueueSalesDemoJob(pool, {
  prospectId,
  adminUserId = null,
  force = false
}) {
  const prospect = await getSalesProspect(pool, prospectId);
  if (!prospect) throw salesError("prospect_not_found", "Prospect not found.", 404);
  if (!prospect.preparationEligible) {
    throw salesError("prospect_not_eligible", "Prospect is not eligible for demo preparation.", 409);
  }
  if (!prospect.websiteUrl) {
    await pool.query(
      `INSERT INTO sales_demo_profiles (
         demo_profile_id, prospect_id, status, failure_code, failure_message,
         build_completed_at
       )
       VALUES ($1, $2, 'failed', 'website_required', 'A website is required to prepare a demo.', NOW())
       ON CONFLICT (prospect_id)
       DO UPDATE SET
         status = 'failed',
         failure_code = 'website_required',
         failure_message = 'A website is required to prepare a demo.',
         build_completed_at = NOW(),
         expires_at = NULL,
         updated_at = NOW()`,
      [createId("sales_demo"), prospect.prospectId]
    );
    throw salesError("website_required", "A website is required to prepare a demo.", 409);
  }

  if (!force && prospect.demo.status === "ready") {
    return {
      enqueued: false,
      reused: true,
      prospectId: prospect.prospectId,
      demoStatus: "ready",
      expiresAt: prospect.demo.expiresAt
    };
  }

  if (force) {
    await pool.query(
      `UPDATE sales_demo_jobs
       SET status = 'canceled',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE prospect_id = $1
         AND status = 'queued'`,
      [prospect.prospectId]
    );
  }

  const jobId = createId("sales_demo_job");
  const result = await pool.query(
    `INSERT INTO sales_demo_jobs (
       sales_demo_job_id, prospect_id, status, requested_by_admin_user_id
     )
     VALUES ($1, $2, 'queued', $3)
     ON CONFLICT (prospect_id) WHERE status IN ('queued', 'leased')
     DO NOTHING
     RETURNING *`,
    [jobId, prospect.prospectId, adminUserId ? Number(adminUserId) : null]
  );

  if (!result.rowCount) {
    const existing = await pool.query(
      `SELECT *
       FROM sales_demo_jobs
       WHERE prospect_id = $1
         AND status IN ('queued', 'leased')
       ORDER BY created_at DESC
       LIMIT 1`,
      [prospect.prospectId]
    );
    return {
      enqueued: false,
      reused: true,
      prospectId: prospect.prospectId,
      job: serializeDemoJob(existing.rows[0])
    };
  }

  await pool.query(
    `INSERT INTO sales_demo_profiles (
       demo_profile_id, prospect_id, status, source_website_url
     )
     VALUES ($1, $2, 'queued', $3)
     ON CONFLICT (prospect_id)
     DO UPDATE SET
       status = CASE
         WHEN sales_demo_profiles.status = 'ready'
          AND sales_demo_profiles.expires_at > NOW()
           THEN sales_demo_profiles.status
         ELSE 'queued'
       END,
       source_website_url = EXCLUDED.source_website_url,
       updated_at = NOW()`,
    [createId("sales_demo"), prospect.prospectId, prospect.websiteUrl]
  );

  return {
    enqueued: true,
    reused: false,
    prospectId: prospect.prospectId,
    job: serializeDemoJob(result.rows[0])
  };
}

function serializeDemoJob(row) {
  if (!row) return null;
  return {
    jobId: row.sales_demo_job_id,
    prospectId: row.prospect_id,
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    availableAt: row.available_at || null,
    lockedAt: row.locked_at || null,
    lockedBy: row.locked_by || null,
    completedAt: row.completed_at || null,
    lastErrorCode: row.last_error_code || null,
    lastErrorMessage: row.last_error_message || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function enqueueWarmSalesDemoQueue(pool, {
  currentProspectId = "",
  adminUserId = null,
  size = SALES_WARM_QUEUE_SIZE
} = {}) {
  const safeSize = Math.min(25, Math.max(1, Number(size) || SALES_WARM_QUEUE_SIZE));
  let queueFloor = 0;
  const currentId = normalizeSalesText(currentProspectId, 200);
  if (currentId) {
    const currentResult = await pool.query(
      `SELECT queue_position
       FROM sales_prospects
       WHERE prospect_id = $1
       LIMIT 1`,
      [currentId]
    );
    if (!currentResult.rowCount) {
      throw salesError("prospect_not_found", "Current prospect not found.", 404);
    }
    queueFloor = Math.max(0, Number(currentResult.rows[0].queue_position || 1) - 1);
  }

  const candidates = await pool.query(
    `SELECT p.prospect_id
     FROM sales_prospects p
     WHERE p.queue_position > $1
       AND p.permission_granted = TRUE
       AND p.suppressed = FALSE
       AND p.do_not_call = FALSE
       AND p.status IN ('queued', 'ready_to_call')
     ORDER BY p.queue_position ASC
     LIMIT $2`,
    [queueFloor, safeSize]
  );

  const jobs = [];
  for (const row of candidates.rows) {
    try {
      const prospect = await getSalesProspect(pool, row.prospect_id);
      if (prospect?.demo?.status === "failed") {
        jobs.push({
          enqueued: false,
          reused: false,
          prospectId: row.prospect_id,
          skipped: true,
          reason: "manual_retry_required"
        });
        continue;
      }
      jobs.push(await enqueueSalesDemoJob(pool, {
        prospectId: row.prospect_id,
        adminUserId
      }));
    } catch (error) {
      jobs.push({
        enqueued: false,
        reused: false,
        prospectId: row.prospect_id,
        error: {
          code: error?.code || "demo_enqueue_failed",
          message: error?.message || "Unable to enqueue demo preparation."
        }
      });
    }
  }
  return {
    requestedSize: safeSize,
    candidateCount: candidates.rowCount,
    enqueuedCount: jobs.filter((item) => item.enqueued).length,
    jobs
  };
}

export async function claimSalesDemoJobs(pool, {
  workerId,
  limit = 1,
  leaseMinutes = 15
}) {
  const normalizedWorkerId = normalizeSalesText(workerId, 200);
  if (!normalizedWorkerId) throw salesError("worker_id_required", "Worker ID is required.");
  const safeLimit = Math.min(3, Math.max(1, Number(limit) || 1));
  const safeLeaseMinutes = Math.min(60, Math.max(1, Number(leaseMinutes) || 15));

  return withTransaction(pool, async (db) => {
    await db.query(
      `UPDATE sales_demo_jobs
       SET status = 'queued',
           locked_at = NULL,
           locked_by = NULL,
           available_at = NOW(),
           updated_at = NOW()
       WHERE status = 'leased'
         AND locked_at < NOW() - ($1::text || ' minutes')::interval`,
      [String(safeLeaseMinutes)]
    );
    const result = await db.query(
      `WITH claimable AS (
         SELECT sales_demo_job_id
         FROM sales_demo_jobs
         WHERE status = 'queued'
           AND available_at <= NOW()
           AND attempts < max_attempts
         ORDER BY available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE sales_demo_jobs j
       SET status = 'leased',
           attempts = j.attempts + 1,
           locked_at = NOW(),
           locked_by = $2,
           updated_at = NOW()
       FROM claimable
       WHERE j.sales_demo_job_id = claimable.sales_demo_job_id
       RETURNING j.*`,
      [safeLimit, normalizedWorkerId]
    );
    return result.rows.map(serializeDemoJob);
  });
}

export async function prepareSalesDemoProfile(pool, prospectId) {
  const prospect = await getSalesProspect(pool, prospectId);
  if (!prospect) throw salesError("prospect_not_found", "Prospect not found.", 404);
  if (!prospect.preparationEligible) {
    throw salesError("prospect_not_eligible", "Prospect is not eligible for demo preparation.", 409);
  }
  if (!prospect.websiteUrl) {
    throw salesError("website_required", "A website is required to prepare a demo.", 409);
  }

  const profileId = prospect.demo.demoProfileId || createId("sales_demo");
  await pool.query(
    `INSERT INTO sales_demo_profiles (
       demo_profile_id, prospect_id, status, source_website_url,
       build_attempts, build_started_at, failure_code, failure_message
     )
     VALUES ($1, $2, 'preparing', $3, 1, NOW(), NULL, NULL)
     ON CONFLICT (prospect_id)
     DO UPDATE SET
       status = 'preparing',
       source_website_url = EXCLUDED.source_website_url,
       normalized_website_url = NULL,
       website_origin = NULL,
       website_hostname = NULL,
       business_name = NULL,
       preview_summary = NULL,
       demo_bundle_json = '{}'::jsonb,
       scrape_page_count = 0,
       scrape_pages_json = '[]'::jsonb,
       extraction_version = NULL,
       build_attempts = sales_demo_profiles.build_attempts + 1,
       build_started_at = NOW(),
       failure_code = NULL,
       failure_message = NULL,
       expires_at = NULL,
       updated_at = NOW()`,
    [profileId, prospect.prospectId, prospect.websiteUrl]
  );

  try {
    const scrape = await scrapeDemoWebsite(prospect.websiteUrl);
    if (!scrape.ok) {
      throw salesError(
        scrape.failureCode || "website_fetch_failed",
        scrape.failureMessage || "Website fetch failed.",
        422
      );
    }
    const built = await buildDemoKnowledgeBundle(scrape);
    const bundle = asObject(built?.demoBundle);
    const result = await pool.query(
      `UPDATE sales_demo_profiles
       SET status = 'ready',
           normalized_website_url = $2,
           website_origin = $3,
           website_hostname = $4,
           business_name = $5,
           preview_summary = $6,
           demo_bundle_json = $7::jsonb,
           scrape_page_count = $8,
           scrape_pages_json = $9::jsonb,
           extraction_version = $10,
           failure_code = NULL,
           failure_message = NULL,
           build_completed_at = NOW(),
           expires_at = NOW() + INTERVAL '30 days',
           updated_at = NOW()
       WHERE prospect_id = $1
       RETURNING *`,
      [
        prospect.prospectId,
        scrape.normalizedWebsiteUrl,
        scrape.websiteOrigin,
        scrape.websiteHostname,
        normalizeSalesText(built?.businessName, 300) || prospect.businessName,
        normalizeSalesText(built?.previewSummary, 2000) || normalizeSalesText(bundle.summary, 2000),
        json(bundle, {}),
        Number(scrape.pageCount || 0),
        json(scrape.scrapePages, []),
        normalizeSalesText(bundle.extractionVersion, 120) || DEMO_BUNDLE_EXTRACTION_VERSION
      ]
    );
    await pool.query(
      `UPDATE sales_prospects
       SET status = CASE WHEN status = 'queued' THEN 'ready_to_call' ELSE status END,
           row_version = row_version + 1,
           updated_at = NOW()
       WHERE prospect_id = $1`,
      [prospect.prospectId]
    );
    return serializeDemoProfile(result.rows[0]);
  } catch (error) {
    const code = normalizeSalesText(error?.code, 120) || "demo_build_failed";
    const message = normalizeSalesText(error?.message, 1000) || "Unable to build the sales demo.";
    await pool.query(
      `UPDATE sales_demo_profiles
       SET status = 'failed',
           normalized_website_url = NULL,
           website_origin = NULL,
           website_hostname = NULL,
           business_name = NULL,
           preview_summary = NULL,
           demo_bundle_json = '{}'::jsonb,
           scrape_page_count = 0,
           scrape_pages_json = '[]'::jsonb,
           extraction_version = NULL,
           failure_code = $2,
           failure_message = $3,
           build_completed_at = NOW(),
           expires_at = NULL,
           updated_at = NOW()
       WHERE prospect_id = $1`,
      [prospect.prospectId, code, message]
    );
    throw salesError(code, message, Number(error?.statusCode || 500) || 500);
  }
}

async function completeSalesDemoJob(pool, jobId, result) {
  await pool.query(
    `UPDATE sales_demo_jobs
     SET status = 'completed',
         completed_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         updated_at = NOW()
     WHERE sales_demo_job_id = $1`,
    [jobId]
  );
  return result;
}

async function failSalesDemoJob(pool, job, error) {
  const exhausted = Number(job.attempts || 0) >= Number(job.maxAttempts || 3);
  const retryDelaySeconds = Math.min(900, 30 * (2 ** Math.max(0, Number(job.attempts || 1) - 1)));
  await pool.query(
    `UPDATE sales_demo_jobs
     SET status = $2,
         available_at = CASE
           WHEN $2 = 'queued' THEN NOW() + ($3::text || ' seconds')::interval
           ELSE available_at
         END,
         completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END,
         locked_at = NULL,
         locked_by = NULL,
         last_error_code = $4,
         last_error_message = $5,
         updated_at = NOW()
     WHERE sales_demo_job_id = $1`,
    [
      job.jobId,
      exhausted ? "failed" : "queued",
      String(retryDelaySeconds),
      normalizeSalesText(error?.code, 120) || "demo_build_failed",
      normalizeSalesText(error?.message, 1000) || "Demo build failed."
    ]
  );
}

export async function processSalesDemoJobs(pool, {
  workerId,
  limit = 1
}) {
  const idempotencyCleanup = await pool.query(
    `DELETE FROM sales_idempotency_keys
     WHERE expires_at <= NOW()`
  );
  const expiry = await markExpiredSalesDemoProfiles(pool);
  const jobs = await claimSalesDemoJobs(pool, { workerId, limit });
  const results = [];
  for (const job of jobs) {
    try {
      const profile = await prepareSalesDemoProfile(pool, job.prospectId);
      await completeSalesDemoJob(pool, job.jobId, profile);
      results.push({ jobId: job.jobId, prospectId: job.prospectId, ok: true, profile });
    } catch (error) {
      await failSalesDemoJob(pool, job, error);
      results.push({
        jobId: job.jobId,
        prospectId: job.prospectId,
        ok: false,
        error: {
          code: error?.code || "demo_build_failed",
          message: error?.message || "Demo build failed."
        }
      });
    }
  }
  return {
    expiredCount: expiry.expiredCount,
    expiredIdempotencyKeyCount: Number(idempotencyCleanup.rowCount || 0),
    claimedCount: jobs.length,
    results
  };
}

export async function addSalesProspectNote(pool, {
  prospectId,
  salesCallId = null,
  body,
  adminUserId
}) {
  const normalizedBody = normalizeSalesText(body, MAX_NOTE_LENGTH);
  if (!normalizedBody) throw salesError("note_required", "Note text is required.");
  const prospect = await getSalesProspect(pool, prospectId);
  if (!prospect) throw salesError("prospect_not_found", "Prospect not found.", 404);
  const normalizedSalesCallId = normalizeSalesText(salesCallId, 200) || null;
  if (normalizedSalesCallId) {
    const callMatch = await pool.query(
      `SELECT 1
       FROM sales_call_sessions
       WHERE sales_call_id = $1
         AND prospect_id = $2
       LIMIT 1`,
      [normalizedSalesCallId, prospect.prospectId]
    );
    if (!callMatch.rowCount) {
      throw salesError(
        "sales_call_prospect_mismatch",
        "The selected sales call does not belong to this prospect.",
        409
      );
    }
  }
  const noteId = createId("sales_note");
  const result = await pool.query(
    `INSERT INTO sales_prospect_notes (
       sales_prospect_note_id, prospect_id, sales_call_id, body, created_by_admin_user_id
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      noteId,
      prospect.prospectId,
      normalizedSalesCallId,
      normalizedBody,
      Number(adminUserId)
    ]
  );
  const row = result.rows[0];
  return {
    noteId: row.sales_prospect_note_id,
    prospectId: row.prospect_id,
    salesCallId: row.sales_call_id || null,
    body: row.body,
    createdByAdminUserId: row.created_by_admin_user_id
      ? Number(row.created_by_admin_user_id)
      : null,
    createdAt: row.created_at || null
  };
}

export async function skipSalesProspect(pool, {
  prospectId,
  reason = "",
  adminUserId
}) {
  const prospect = await getSalesProspect(pool, prospectId);
  if (!prospect) throw salesError("prospect_not_found", "Prospect not found.", 404);
  if (prospect.status === "skipped") return prospect;
  const demoUnusable = prospect.demo.status === "failed" || !prospect.websiteUrl;
  if (!demoUnusable) {
    throw salesError(
      "sales_demo_not_skippable",
      "Only a prospect with a failed or unusable demo can be skipped.",
      409
    );
  }
  const normalizedReason = normalizeSalesText(reason, 500)
    || normalizeSalesText(prospect.demo.failureMessage, 500)
    || (prospect.websiteUrl ? "Demo preparation failed." : "No usable website was supplied.");
  const skippedAt = new Date().toISOString();
  await pool.query(
    `UPDATE sales_prospects
     SET status = 'skipped',
         metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb,
         row_version = row_version + 1,
         updated_at = NOW()
     WHERE prospect_id = $1`,
    [
      prospect.prospectId,
      json({
        salesSkip: {
          reason: normalizedReason,
          skippedAt,
          skippedByAdminUserId: Number(adminUserId) || null
        }
      }, {})
    ]
  );
  return getSalesProspect(pool, prospect.prospectId);
}

function serializeSalesOperatorSettings(row) {
  if (!row) return null;
  return {
    adminUserId: Number(row.admin_user_id),
    telnyxTelephonyCredentialId: row.telnyx_telephony_credential_id || null,
    displayName: row.display_name || null,
    callerIdNumber: row.caller_id_number || null,
    active: Boolean(row.active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function getSalesOperatorSettings(pool, adminUserId) {
  const result = await pool.query(
    `SELECT *
     FROM sales_operator_settings
     WHERE admin_user_id = $1
     LIMIT 1`,
    [Number(adminUserId)]
  );
  return serializeSalesOperatorSettings(result.rows[0]);
}

export async function upsertSalesOperatorSettings(pool, adminUserId, input = {}) {
  const actorId = Number(adminUserId);
  if (!actorId) throw salesError("admin_user_required", "Admin user is required.", 403);
  const credentialId = normalizeSalesText(
    input.telnyxTelephonyCredentialId ?? input.telnyx_telephony_credential_id,
    240
  ) || null;
  const displayName = normalizeSalesText(input.displayName ?? input.display_name, 200) || null;
  const callerIdInput = normalizeSalesText(input.callerIdNumber ?? input.caller_id_number, 80);
  const callerIdNumber = callerIdInput ? normalizeSalesPhone(callerIdInput) : null;
  const active = input.active === undefined ? true : normalizeBoolean(input.active);
  const result = await pool.query(
    `INSERT INTO sales_operator_settings (
       admin_user_id, telnyx_telephony_credential_id, display_name, caller_id_number, active
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (admin_user_id)
     DO UPDATE SET
       telnyx_telephony_credential_id = EXCLUDED.telnyx_telephony_credential_id,
       display_name = EXCLUDED.display_name,
       caller_id_number = EXCLUDED.caller_id_number,
       active = EXCLUDED.active,
       updated_at = NOW()
     RETURNING *`,
    [actorId, credentialId, displayName, callerIdNumber, active]
  );
  return serializeSalesOperatorSettings(result.rows[0]);
}

export async function createSalesCallSession(pool, input = {}) {
  const prospectId = normalizeSalesText(input.prospectId || input.prospect_id, 200);
  if (!prospectId) throw salesError("prospect_id_required", "Prospect ID is required.");
  const prospect = await getSalesProspect(pool, prospectId);
  if (!prospect) throw salesError("prospect_not_found", "Prospect not found.", 404);
  if (!prospect.eligible) {
    throw salesError(
      prospect.callBlockedCode === "outside_calling_window"
        || prospect.callBlockedCode === "timezone_required"
        || prospect.callBlockedCode === "timezone_invalid"
        ? "prospect_calling_window_blocked"
        : "prospect_not_eligible",
      prospect.callBlockedReason || "Prospect is not eligible to be called.",
      409,
      prospect.callingWindow
    );
  }
  if (prospect.demo.status !== "ready") {
    throw salesError("sales_demo_not_ready", "The prospect demo must be ready before calling.", 409);
  }
  const adminUserId = Number(input.adminUserId || input.admin_user_id || 0) || null;
  const idempotencyKey = normalizeSalesText(input.idempotencyKey || input.idempotency_key, 240) || null;
  const salesCallId = normalizeSalesText(input.salesCallId || input.sales_call_id, 200)
    || createId("sales_call");

  const result = await pool.query(
    `INSERT INTO sales_call_sessions (
       sales_call_id, prospect_id, admin_user_id, state, conference_id, conference_name,
       operator_call_control_id, operator_leg_id, operator_session_id,
       prospect_call_control_id, prospect_leg_id, prospect_session_id,
       ai_telnyx_call_control_id, ai_telnyx_leg_id, ai_telnyx_session_id,
       openai_call_id, ai_state, provider_error_code, provider_error_message,
       started_at, connected_at, demo_started_at, demo_ended_at, ended_at,
       idempotency_key, metadata_json
     )
     VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9,
       $10, $11, $12,
       $13, $14, $15,
       $16, $17, $18, $19,
       $20, $21, $22, $23, $24,
       $25, $26::jsonb
     )
     ON CONFLICT (admin_user_id, idempotency_key)
       WHERE admin_user_id IS NOT NULL AND idempotency_key IS NOT NULL AND idempotency_key <> ''
     DO UPDATE SET updated_at = sales_call_sessions.updated_at
     RETURNING *`,
    [
      salesCallId,
      prospectId,
      adminUserId,
      normalizeSalesText(input.state, 80) || "created",
      normalizeSalesText(input.conferenceId || input.conference_id, 240) || null,
      normalizeSalesText(input.conferenceName || input.conference_name, 240) || null,
      normalizeSalesText(input.operatorCallControlId || input.operator_call_control_id, 240) || null,
      normalizeSalesText(input.operatorLegId || input.operator_leg_id, 240) || null,
      normalizeSalesText(input.operatorSessionId || input.operator_session_id, 240) || null,
      normalizeSalesText(input.prospectCallControlId || input.prospect_call_control_id, 240) || null,
      normalizeSalesText(input.prospectLegId || input.prospect_leg_id, 240) || null,
      normalizeSalesText(input.prospectSessionId || input.prospect_session_id, 240) || null,
      normalizeSalesText(input.aiTelnyxCallControlId || input.ai_telnyx_call_control_id, 240) || null,
      normalizeSalesText(input.aiTelnyxLegId || input.ai_telnyx_leg_id, 240) || null,
      normalizeSalesText(input.aiTelnyxSessionId || input.ai_telnyx_session_id, 240) || null,
      normalizeSalesText(input.openaiCallId || input.openai_call_id, 240) || null,
      normalizeSalesText(input.aiState || input.ai_state, 80) || null,
      normalizeSalesText(input.providerErrorCode || input.provider_error_code, 160) || null,
      normalizeSalesText(input.providerErrorMessage || input.provider_error_message, 1000) || null,
      input.startedAt || input.started_at || null,
      input.connectedAt || input.connected_at || null,
      input.demoStartedAt || input.demo_started_at || null,
      input.demoEndedAt || input.demo_ended_at || null,
      input.endedAt || input.ended_at || null,
      idempotencyKey,
      json(asObject(input.metadata || input.metadata_json), {})
    ]
  );
  if (result.rows[0]?.prospect_id !== prospectId) {
    throw salesError(
      "idempotency_key_conflict",
      "This idempotency key was already used for a different sales call.",
      409
    );
  }
  return serializeSalesCallSession(result.rows[0]);
}

export function serializeSalesCallSession(row) {
  if (!row) return null;
  return {
    salesCallId: row.sales_call_id,
    prospectId: row.prospect_id,
    adminUserId: row.admin_user_id ? Number(row.admin_user_id) : null,
    state: row.state,
    conferenceId: row.conference_id || null,
    conferenceName: row.conference_name || null,
    operatorCallControlId: row.operator_call_control_id || null,
    operatorLegId: row.operator_leg_id || null,
    operatorSessionId: row.operator_session_id || null,
    prospectCallControlId: row.prospect_call_control_id || null,
    prospectLegId: row.prospect_leg_id || null,
    prospectSessionId: row.prospect_session_id || null,
    aiTelnyxCallControlId: row.ai_telnyx_call_control_id || null,
    aiTelnyxLegId: row.ai_telnyx_leg_id || null,
    aiTelnyxSessionId: row.ai_telnyx_session_id || null,
    openaiCallId: row.openai_call_id || null,
    aiState: row.ai_state || null,
    providerErrorCode: row.provider_error_code || null,
    providerErrorMessage: row.provider_error_message || null,
    outcome: row.outcome || null,
    outcomeNotes: row.outcome_notes || null,
    outcomeRecordedAt: row.outcome_recorded_at || null,
    startedAt: row.started_at || null,
    connectedAt: row.connected_at || null,
    demoStartedAt: row.demo_started_at || null,
    demoEndedAt: row.demo_ended_at || null,
    endedAt: row.ended_at || null,
    idempotencyKey: row.idempotency_key || null,
    metadata: asObject(row.metadata_json),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function getSalesCallSession(pool, salesCallId) {
  const result = await pool.query(
    `SELECT *
     FROM sales_call_sessions
     WHERE sales_call_id = $1
     LIMIT 1`,
    [normalizeSalesText(salesCallId, 200)]
  );
  return serializeSalesCallSession(result.rows[0]);
}

const SALES_CALL_UPDATE_COLUMNS = Object.freeze({
  state: ["state", 80],
  conferenceId: ["conference_id", 240],
  conferenceName: ["conference_name", 240],
  operatorCallControlId: ["operator_call_control_id", 240],
  operatorLegId: ["operator_leg_id", 240],
  operatorSessionId: ["operator_session_id", 240],
  prospectCallControlId: ["prospect_call_control_id", 240],
  prospectLegId: ["prospect_leg_id", 240],
  prospectSessionId: ["prospect_session_id", 240],
  aiTelnyxCallControlId: ["ai_telnyx_call_control_id", 240],
  aiTelnyxLegId: ["ai_telnyx_leg_id", 240],
  aiTelnyxSessionId: ["ai_telnyx_session_id", 240],
  openaiCallId: ["openai_call_id", 240],
  aiState: ["ai_state", 80],
  providerErrorCode: ["provider_error_code", 160],
  providerErrorMessage: ["provider_error_message", 1000]
});

export async function updateSalesCallSession(pool, salesCallId, changes = {}) {
  const assignments = [];
  const values = [];
  const assign = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };
  for (const [property, [column, maxLength]] of Object.entries(SALES_CALL_UPDATE_COLUMNS)) {
    const snakeProperty = property.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
    if (changes[property] !== undefined || changes[snakeProperty] !== undefined) {
      const value = changes[property] !== undefined ? changes[property] : changes[snakeProperty];
      assign(column, normalizeSalesText(value, maxLength) || null);
    }
  }
  const timestampFields = {
    startedAt: "started_at",
    connectedAt: "connected_at",
    demoStartedAt: "demo_started_at",
    demoEndedAt: "demo_ended_at",
    endedAt: "ended_at"
  };
  for (const [property, column] of Object.entries(timestampFields)) {
    const snakeProperty = property.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
    if (changes[property] !== undefined || changes[snakeProperty] !== undefined) {
      assign(column, changes[property] !== undefined ? changes[property] : changes[snakeProperty]);
    }
  }
  if (changes.metadata !== undefined || changes.metadata_json !== undefined) {
    values.push(json(asObject(changes.metadata ?? changes.metadata_json), {}));
    assignments.push(`metadata_json = metadata_json || $${values.length}::jsonb`);
  }
  if (!assignments.length) return getSalesCallSession(pool, salesCallId);
  assignments.push("updated_at = NOW()");
  values.push(normalizeSalesText(salesCallId, 200));
  const result = await pool.query(
    `UPDATE sales_call_sessions
     SET ${assignments.join(", ")}
     WHERE sales_call_id = $${values.length}
     RETURNING *`,
    values
  );
  if (!result.rowCount) throw salesError("sales_call_not_found", "Sales call not found.", 404);
  return serializeSalesCallSession(result.rows[0]);
}

export async function recordSalesCallEvent(pool, {
  salesCallId,
  provider,
  eventId,
  type,
  payload = {},
  occurredAt = null
}) {
  const normalizedSalesCallId = normalizeSalesText(salesCallId, 200);
  const normalizedProvider = normalizeSalesText(provider, 80);
  const normalizedEventId = normalizeSalesText(eventId, 240);
  const normalizedType = normalizeSalesText(type, 160);
  if (!normalizedSalesCallId || !normalizedProvider || !normalizedEventId || !normalizedType) {
    throw salesError(
      "sales_call_event_invalid",
      "Sales call ID, provider, event ID, and event type are required.",
      400
    );
  }
  const result = await pool.query(
    `INSERT INTO sales_call_events (
       sales_call_id, provider, event_id, type, payload_json, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()))
     ON CONFLICT (provider, event_id)
     DO NOTHING
     RETURNING *`,
    [
      normalizedSalesCallId,
      normalizedProvider,
      normalizedEventId,
      normalizedType,
      json(asObject(payload), {}),
      occurredAt
    ]
  );
  if (result.rowCount) {
    return { inserted: true, event: result.rows[0] };
  }
  const existing = await pool.query(
    `SELECT *
     FROM sales_call_events
     WHERE provider = $1 AND event_id = $2
     LIMIT 1`,
    [normalizedProvider, normalizedEventId]
  );
  return { inserted: false, event: existing.rows[0] || null };
}

export async function recordSalesCallOutcome(pool, {
  salesCallId,
  outcome,
  notes = ""
}) {
  const normalizedOutcome = normalizeSalesText(outcome, 80).toLowerCase();
  if (!SALES_OUTCOMES.includes(normalizedOutcome)) {
    throw salesError("invalid_call_outcome", "Call outcome is not supported.");
  }
  const normalizedNotes = normalizeSalesText(notes, MAX_NOTE_LENGTH) || null;
  return withTransaction(pool, async (db) => {
    const normalizedSalesCallId = normalizeSalesText(salesCallId, 200);
    const existing = await db.query(
      `SELECT sales_call_id, prospect_id, outcome
       FROM sales_call_sessions
       WHERE sales_call_id = $1
       FOR UPDATE`,
      [normalizedSalesCallId]
    );
    if (!existing.rowCount) {
      throw salesError("sales_call_not_found", "Sales call not found.", 404);
    }
    const updated = await db.query(
      `UPDATE sales_call_sessions
       SET outcome = $2,
           outcome_notes = $3,
           outcome_recorded_at = NOW(),
           state = CASE WHEN state = 'ended' THEN state ELSE 'closed' END,
           ended_at = COALESCE(ended_at, NOW()),
           updated_at = NOW()
       WHERE sales_call_id = $1
       RETURNING *`,
      [normalizedSalesCallId, normalizedOutcome, normalizedNotes]
    );
    const row = updated.rows[0];
    await db.query(
      `UPDATE sales_prospects
       SET last_outcome = $2,
           last_outcome_at = NOW(),
           status = $2,
           do_not_call = CASE WHEN $2 = 'do_not_call' THEN TRUE ELSE do_not_call END,
           do_not_call_at = CASE WHEN $2 = 'do_not_call' THEN COALESCE(do_not_call_at, NOW()) ELSE do_not_call_at END,
           suppressed = CASE WHEN $2 = 'do_not_call' THEN TRUE ELSE suppressed END,
           suppressed_at = CASE WHEN $2 = 'do_not_call' THEN COALESCE(suppressed_at, NOW()) ELSE suppressed_at END,
           suppression_reason = CASE WHEN $2 = 'do_not_call' THEN COALESCE(suppression_reason, 'do_not_call') ELSE suppression_reason END,
           email_suppressed_at = CASE WHEN $2 = 'do_not_call' THEN COALESCE(email_suppressed_at, NOW()) ELSE email_suppressed_at END,
           email_suppression_reason = CASE WHEN $2 = 'do_not_call' THEN COALESCE(email_suppression_reason, 'do_not_call') ELSE email_suppression_reason END,
           row_version = row_version + 1,
           updated_at = NOW()
       WHERE prospect_id = $1`,
      [row.prospect_id, normalizedOutcome]
    );
    await db.query(
      `INSERT INTO sales_followup_jobs (
         sales_followup_job_id, prospect_id, sales_call_id, outcome
       )
       SELECT $1, $2, $3, $4
       WHERE NOT EXISTS (
         SELECT 1
         FROM sales_followup_jobs
         WHERE prospect_id = $2
           AND sales_call_id = $3
           AND outcome = $4
       )
       ON CONFLICT (prospect_id, sales_call_id, outcome)
         WHERE status IN ('queued', 'leased')
       DO NOTHING`,
      [createId("sales_followup"), row.prospect_id, row.sales_call_id, normalizedOutcome]
    );
    return serializeSalesCallSession(row);
  });
}

function hashSignupToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function signupTokenSecret() {
  const secret = normalizeSalesText(process.env.SALES_SIGNUP_TOKEN_SECRET, 2000);
  if (secret.length < 32) {
    throw salesError(
      "signup_token_secret_not_configured",
      "Signup invitation token signing requires a dedicated secret of at least 32 characters.",
      503
    );
  }
  return secret;
}

export function normalizeSalesSignupBusinessCategory(value) {
  const normalized = normalizeSalesText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return null;
  const canonical = SALES_SIGNUP_CATEGORY_ALIASES[normalized] || normalized;
  return inferKnowledgeAssignmentsForIndustry(canonical).length
    ? canonical
    : null;
}

function safeSignupPrefill(prospect, input = {}) {
  const contactEmail = normalizeOptionalEmail(input.contactEmail ?? prospect.contactEmail);
  const leadDeliveryEmail = normalizeOptionalEmail(
    input.leadDeliveryEmail ?? prospect.leadDeliveryEmail ?? contactEmail
  );
  if (!contactEmail) {
    throw salesError("contact_email_required", "A confirmed contact email is required.");
  }
  if (!leadDeliveryEmail) {
    throw salesError("lead_delivery_email_required", "A confirmed lead-delivery email is required.");
  }
  return {
    businessName: normalizeSalesText(prospect.businessName, 300),
    website: normalizeWebsite(prospect.websiteUrl),
    loginEmail: contactEmail,
    leadEmail: leadDeliveryEmail,
    businessCategory: normalizeSalesSignupBusinessCategory(prospect.businessCategory),
    marketingAttribution: {
      refPage: "sales_console",
      refCta: "assisted_signup",
      utm: {
        source: "outbound_sales",
        medium: "live_call"
      },
      extraQueryParams: {
        sales_prospect_id: prospect.prospectId,
        sales_call_id: normalizeSalesText(input.salesCallId, 200) || ""
      }
    }
  };
}

export async function createSalesSignupInvitation(pool, {
  prospectId,
  salesCallId = null,
  contactEmail,
  leadDeliveryEmail,
  adminUserId,
  expiresInMinutes,
  idempotencyKey,
  appBaseUrl = ""
}) {
  const prospect = await getSalesProspect(pool, prospectId);
  if (!prospect) throw salesError("prospect_not_found", "Prospect not found.", 404);
  const safePrefill = safeSignupPrefill(prospect, {
    contactEmail,
    leadDeliveryEmail,
    salesCallId
  });
  const baseUrl = normalizeSalesText(appBaseUrl, 1000).replace(/\/+$/, "");
  try {
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid_protocol");
  } catch {
    throw salesError(
      "sales_app_base_url_invalid",
      "A valid HTTP or HTTPS app base URL is required.",
      503
    );
  }
  const normalizedSalesCallId = normalizeSalesText(salesCallId, 200) || null;
  if (normalizedSalesCallId) {
    const callMatch = await pool.query(
      `SELECT 1
       FROM sales_call_sessions
       WHERE sales_call_id = $1
         AND prospect_id = $2
       LIMIT 1`,
      [normalizedSalesCallId, prospect.prospectId]
    );
    if (!callMatch.rowCount) {
      throw salesError(
        "sales_call_prospect_mismatch",
        "The selected sales call does not belong to this prospect.",
        409
      );
    }
  }
  const configuredTtl = Number.parseInt(
    String(process.env.SALES_SIGNUP_INVITE_TTL_MINUTES || ""),
    10
  );
  const defaultTtl = Number.isFinite(configuredTtl) && configuredTtl > 0
    ? configuredTtl
    : DEFAULT_SIGNUP_INVITE_TTL_MINUTES;
  const ttlMinutes = Math.min(
    7 * 24 * 60,
    Math.max(15, Number(expiresInMinutes) || defaultTtl)
  );
  const normalizedIdempotencyKey = normalizeSalesText(idempotencyKey, 240);
  if (!normalizedIdempotencyKey) {
    throw salesError("idempotency_key_required", "Idempotency-Key header is required.", 400);
  }
  const actorId = Number(adminUserId);
  const creationIdempotencyHash = crypto
    .createHash("sha256")
    .update(`${actorId}|${normalizedIdempotencyKey}`, "utf8")
    .digest("hex");
  const creationRequestHash = hashSalesIdempotencyRequest({
    prospectId: prospect.prospectId,
    salesCallId: normalizedSalesCallId,
    safePrefill,
    ttlMinutes
  });
  const token = crypto
    .createHmac("sha256", signupTokenSecret())
    .update(`sales-signup|${actorId}|${prospect.prospectId}|${normalizedIdempotencyKey}`, "utf8")
    .digest("base64url");
  const tokenHash = hashSignupToken(token);
  const invitationId = createId("sales_invite");
  const result = await pool.query(
    `INSERT INTO sales_signup_invitations (
       invitation_id, prospect_id, sales_call_id, token_hash,
       creation_idempotency_hash, creation_request_hash, safe_prefill_json,
       status, delivery_email, expires_at, created_by_admin_user_id
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb,
       'pending', $8, NOW() + ($9::text || ' minutes')::interval, $10
     )
     ON CONFLICT (creation_idempotency_hash)
     DO UPDATE SET updated_at = sales_signup_invitations.updated_at
     RETURNING *, (xmax = 0) AS inserted`,
    [
      invitationId,
      prospect.prospectId,
      normalizedSalesCallId,
      tokenHash,
      creationIdempotencyHash,
      creationRequestHash,
      json(safePrefill, {}),
      safePrefill.loginEmail,
      String(ttlMinutes),
      actorId
    ]
  );
  if (result.rows[0]?.creation_request_hash !== creationRequestHash) {
    throw salesError(
      "idempotency_key_conflict",
      "This idempotency key was already used for a different signup invitation.",
      409
    );
  }
  return {
    invitation: serializeSignupInvitation(result.rows[0]),
    token,
    signupUrl: `${baseUrl}/intake?salesInvite=${encodeURIComponent(token)}`,
    replayed: !Boolean(result.rows[0]?.inserted)
  };
}

function effectiveInvitationStatus(row) {
  if (!row) return "";
  if (row.revoked_at) return "revoked";
  if (row.submitted_at) return "submitted";
  if (row.consumed_at) return "opened";
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  return normalizeSalesText(row.status, 60) || "pending";
}

function serializeSignupInvitation(row) {
  if (!row) return null;
  const convertedTenantKey = row.converted_tenant_key || null;
  const hasProgressProjection = Object.prototype.hasOwnProperty.call(
    row,
    "linked_tenant_key"
  );
  const linkedTenantKey = row.linked_tenant_key || null;
  const tenantStatus = normalizeSalesText(row.tenant_status, 80).toLowerCase();
  const voiceNumber = normalizeSalesText(row.telnyx_voice_number, 80) || null;
  const voiceStatus = normalizeSalesText(row.telnyx_voice_status, 80).toLowerCase();
  const provisioningJobStatus = normalizeSalesText(
    row.provisioning_job_status,
    80
  ).toLowerCase();
  const provisioningFailed = Boolean(convertedTenantKey && hasProgressProjection) && (
    !linkedTenantKey
    || ["failed", "unavailable", "released"].includes(voiceStatus)
    || ["failed", "error", "canceled", "cancelled"].includes(provisioningJobStatus)
  );
  const provisioningComplete = Boolean(
    convertedTenantKey
    && hasProgressProjection
    && linkedTenantKey
    && voiceNumber
    && !provisioningFailed
    && (
      ["done", "completed", "succeeded", "success"].includes(provisioningJobStatus)
      || ["active", "active_confirmed"].includes(voiceStatus)
      || !provisioningJobStatus
    )
  );
  const provisioningStatus = !convertedTenantKey || !hasProgressProjection
    ? null
    : provisioningFailed
      ? "failed"
      : provisioningComplete
        ? "completed"
        : "provisioning";
  const accountStatus = !convertedTenantKey || !hasProgressProjection
    ? null
    : provisioningFailed || (tenantStatus && tenantStatus !== "active")
      ? "attention_required"
      : provisioningComplete && tenantStatus === "active"
        ? "account_ready"
        : "provisioning";
  return {
    invitationId: row.invitation_id,
    prospectId: row.prospect_id,
    salesCallId: row.sales_call_id || null,
    status: effectiveInvitationStatus(row),
    deliveryEmail: row.delivery_email,
    expiresAt: row.expires_at || null,
    sentAt: row.sent_at || null,
    openedAt: row.opened_at || null,
    consumedAt: row.consumed_at || null,
    submittedAt: row.submitted_at || null,
    convertedTenantKey,
    provisioningStatus,
    provisioningStatusDetail: normalizeSalesText(row.provisioning_status_detail, 500) || null,
    provisioningErrorCode: normalizeSalesText(row.provisioning_error_code, 160) || null,
    provisioningErrorMessage: normalizeSalesText(row.provisioning_error_message, 500) || null,
    accountStatus,
    attentionRequired: accountStatus === "attention_required",
    provisionedNumber: provisioningComplete ? voiceNumber : null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function getSalesSignupInvitation(pool, invitationId) {
  const result = await pool.query(
    `${SIGNUP_INVITATION_PROGRESS_SELECT}
     WHERE i.invitation_id = $1
     LIMIT 1`,
    [normalizeSalesText(invitationId, 200)]
  );
  return serializeSignupInvitation(result.rows[0]);
}

export async function markSalesSignupInvitationSent(pool, invitationId) {
  const result = await pool.query(
    `UPDATE sales_signup_invitations
     SET status = CASE WHEN status = 'pending' THEN 'sent' ELSE status END,
         sent_at = COALESCE(sent_at, NOW()),
         updated_at = NOW()
     WHERE invitation_id = $1
       AND revoked_at IS NULL
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING invitation_id, prospect_id, sales_call_id, status, delivery_email,
               expires_at, sent_at, opened_at, consumed_at, submitted_at,
               converted_tenant_key, revoked_at, created_at, updated_at`,
    [normalizeSalesText(invitationId, 200)]
  );
  if (!result.rowCount) {
    throw salesError(
      "signup_invitation_unavailable",
      "This signup invitation is no longer available.",
      410
    );
  }
  return serializeSignupInvitation(result.rows[0]);
}

export async function claimSalesSignupInvitationDelivery(pool, invitationId) {
  const result = await pool.query(
    `UPDATE sales_signup_invitations
     SET status = 'sending',
         updated_at = NOW()
     WHERE invitation_id = $1
       AND sent_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND (
         status = 'pending'
         OR (
           status = 'sending'
           AND updated_at < NOW() - INTERVAL '5 minutes'
         )
       )
     RETURNING invitation_id`,
    [normalizeSalesText(invitationId, 200)]
  );
  return Boolean(result.rowCount);
}

export async function completeSalesSignupInvitationDelivery(pool, invitationId) {
  const result = await pool.query(
    `UPDATE sales_signup_invitations
     SET status = 'sent',
         sent_at = COALESCE(sent_at, NOW()),
         updated_at = NOW()
     WHERE invitation_id = $1
       AND revoked_at IS NULL
     RETURNING invitation_id`,
    [normalizeSalesText(invitationId, 200)]
  );
  if (!result.rowCount) {
    throw salesError("signup_invitation_not_found", "Signup invitation not found.", 404);
  }
  return getSalesSignupInvitation(pool, invitationId);
}

export async function releaseSalesSignupInvitationDelivery(pool, invitationId) {
  await pool.query(
    `UPDATE sales_signup_invitations
     SET status = 'pending',
         updated_at = NOW()
     WHERE invitation_id = $1
       AND status = 'sending'
       AND sent_at IS NULL`,
    [normalizeSalesText(invitationId, 200)]
  );
}

export async function openSalesSignupPrefill(pool, rawToken) {
  const token = normalizeSalesText(rawToken, 500);
  if (token.length < 32) {
    throw salesError("signup_invitation_not_found", "Signup invitation not found.", 404);
  }
  const tokenHash = hashSignupToken(token);
  const result = await pool.query(
    `UPDATE sales_signup_invitations
     SET status = 'opened',
         opened_at = COALESCE(opened_at, NOW()),
         updated_at = NOW()
     WHERE token_hash = $1
       AND consumed_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND status IN ('pending', 'sent', 'opened')
     RETURNING invitation_id, safe_prefill_json, expires_at`,
    [tokenHash]
  );
  if (result.rowCount) {
    return {
      invitationId: result.rows[0].invitation_id,
      prefill: asObject(result.rows[0].safe_prefill_json),
      expiresAt: result.rows[0].expires_at || null
    };
  }
  const existing = await pool.query(
    `SELECT consumed_at, revoked_at, expires_at
     FROM sales_signup_invitations
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  if (!existing.rowCount) {
    throw salesError("signup_invitation_not_found", "Signup invitation not found.", 404);
  }
  throw salesError(
    "signup_invitation_unavailable",
    "This signup invitation has expired or has already been submitted.",
    410
  );
}

export async function validateSalesSignupInvitationForOnboarding(client, {
  rawToken,
  forUpdate = true
}) {
  const token = normalizeSalesText(rawToken, 500);
  if (token.length < 32) {
    throw salesError("signup_invitation_not_found", "Signup invitation not found.", 404);
  }
  const result = await client.query(
    `SELECT invitation_id, prospect_id, sales_call_id, safe_prefill_json, expires_at
     FROM sales_signup_invitations
     WHERE token_hash = $1
       AND consumed_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND status IN ('pending', 'sent', 'opened')
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [hashSignupToken(token)]
  );
  if (!result.rowCount) {
    throw salesError(
      "signup_invitation_unavailable",
      "This signup invitation has expired or has already been submitted.",
      410
    );
  }
  const row = result.rows[0];
  return {
    invitationId: row.invitation_id,
    prospectId: row.prospect_id,
    salesCallId: row.sales_call_id || null,
    prefill: asObject(row.safe_prefill_json),
    expiresAt: row.expires_at || null
  };
}

export async function completeSalesSignupInvitation(client, {
  rawToken,
  tenantKey
}) {
  const normalizedTenantKey = normalizeSalesText(tenantKey, 240);
  if (!normalizedTenantKey) {
    throw salesError("tenant_key_required", "Tenant key is required.", 400);
  }
  const invitation = await validateSalesSignupInvitationForOnboarding(client, {
    rawToken,
    forUpdate: true
  });
  const result = await client.query(
    `UPDATE sales_signup_invitations
     SET status = 'submitted',
         consumed_at = NOW(),
         submitted_at = NOW(),
         converted_tenant_key = $2,
         updated_at = NOW()
     WHERE invitation_id = $1
       AND consumed_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > NOW()
     RETURNING invitation_id, prospect_id, sales_call_id, status, delivery_email,
               expires_at, sent_at, opened_at, consumed_at, submitted_at,
               converted_tenant_key, revoked_at, created_at, updated_at`,
    [invitation.invitationId, normalizedTenantKey]
  );
  if (!result.rowCount) {
    throw salesError(
      "signup_invitation_unavailable",
      "This signup invitation has expired or has already been submitted.",
      410
    );
  }
  const completed = result.rows[0];
  await client.query(
    `UPDATE sales_prospects
     SET status = 'signup_completed',
         last_outcome = 'signup_completed',
         last_outcome_at = NOW(),
         row_version = row_version + 1,
         updated_at = NOW()
     WHERE prospect_id = $1`,
    [completed.prospect_id]
  );
  if (completed.sales_call_id) {
    await client.query(
      `UPDATE sales_call_sessions
       SET outcome = 'signup_completed',
           outcome_recorded_at = COALESCE(outcome_recorded_at, NOW()),
           state = CASE WHEN ended_at IS NULL THEN 'signup_completed' ELSE state END,
           updated_at = NOW()
       WHERE sales_call_id = $1`,
      [completed.sales_call_id]
    );
  }
  await client.query(
    `INSERT INTO sales_followup_jobs (
       sales_followup_job_id, prospect_id, sales_call_id, outcome
     )
     VALUES ($1, $2, $3, 'signup_completed')
     ON CONFLICT (prospect_id, sales_call_id, outcome)
       WHERE status IN ('queued', 'leased')
     DO NOTHING`,
    [
      createId("sales_followup"),
      completed.prospect_id,
      completed.sales_call_id
    ]
  );
  return serializeSignupInvitation(completed);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashSalesIdempotencyRequest(value) {
  return crypto.createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export async function runSalesIdempotentMutation(pool, {
  adminUserId,
  scope,
  idempotencyKey,
  request
}, callback) {
  const actorId = Number(adminUserId);
  const normalizedScope = normalizeSalesText(scope, 160);
  const normalizedKey = normalizeSalesText(idempotencyKey, 240);
  if (!actorId) throw salesError("admin_user_required", "Admin user is required.", 403);
  if (!normalizedKey) {
    throw salesError("idempotency_key_required", "Idempotency-Key header is required.", 400);
  }
  const requestHash = hashSalesIdempotencyRequest(request);
  await pool.query(
    `DELETE FROM sales_idempotency_keys
     WHERE admin_user_id = $1
       AND scope = $2
       AND idempotency_key = $3
       AND expires_at <= NOW()`,
    [actorId, normalizedScope, normalizedKey]
  );
  const claimed = await pool.query(
    `INSERT INTO sales_idempotency_keys (
       admin_user_id, scope, idempotency_key, request_hash, state
     )
     VALUES ($1, $2, $3, $4, 'processing')
     ON CONFLICT (admin_user_id, scope, idempotency_key)
     DO NOTHING
     RETURNING sales_idempotency_id`,
    [actorId, normalizedScope, normalizedKey, requestHash]
  );
  if (!claimed.rowCount) {
    const existing = await pool.query(
      `SELECT request_hash, state, response_status, response_json
       FROM sales_idempotency_keys
       WHERE admin_user_id = $1
         AND scope = $2
         AND idempotency_key = $3
       LIMIT 1`,
      [actorId, normalizedScope, normalizedKey]
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== requestHash) {
      throw salesError(
        "idempotency_key_conflict",
        "This idempotency key was already used for a different request.",
        409
      );
    }
    if (row.state === "completed") {
      return {
        replayed: true,
        status: Number(row.response_status || 200),
        body: asObject(row.response_json)
      };
    }
    throw salesError(
      "idempotency_in_progress",
      "A request with this idempotency key is still in progress.",
      409
    );
  }

  try {
    const response = await callback();
    const status = Number(response?.status || 200);
    const body = asObject(response?.body ?? response);
    await pool.query(
      `UPDATE sales_idempotency_keys
       SET state = 'completed',
           response_status = $4,
           response_json = $5::jsonb,
           completed_at = NOW()
       WHERE admin_user_id = $1
         AND scope = $2
         AND idempotency_key = $3`,
      [actorId, normalizedScope, normalizedKey, status, json(body, {})]
    );
    return { replayed: false, status, body };
  } catch (error) {
    await pool.query(
      `DELETE FROM sales_idempotency_keys
       WHERE admin_user_id = $1
         AND scope = $2
         AND idempotency_key = $3
         AND state = 'processing'`,
      [actorId, normalizedScope, normalizedKey]
    );
    throw error;
  }
}

export { salesError };
