const SMARTLEAD_BASE_URL = "https://server.smartlead.ai/api/v1";

const CAMPAIGN_ENV_BY_OUTCOME = Object.freeze({
  no_answer: "SMARTLEAD_SALES_NO_ANSWER_CAMPAIGN_ID",
  voicemail: "SMARTLEAD_SALES_VOICEMAIL_CAMPAIGN_ID",
  callback_requested: "SMARTLEAD_SALES_CALLBACK_CAMPAIGN_ID",
  connected_no_demo: "SMARTLEAD_SALES_CONNECTED_CAMPAIGN_ID",
  demo_completed: "SMARTLEAD_SALES_DEMO_CAMPAIGN_ID"
});

const TERMINAL_OUTCOMES = new Set([
  "do_not_call",
  "not_interested",
  "signup_completed",
  "wrong_number"
]);

function normalizeText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return normalizeText(value, 320).toLowerCase();
}

function normalizeOutcome(value) {
  return normalizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isTruthyPermission(value) {
  return value === true || ["yes", "y", "true", "1", "allowed", "granted"].includes(
    normalizeText(value, 24).toLowerCase()
  );
}

function isSuppressed(prospect = {}) {
  const prospectStatus = normalizeOutcome(prospect.status);
  return Boolean(
    prospect.suppressed
    || prospect.do_not_call
    || prospect.doNotCall
    || prospect.email_suppressed_at
    || prospect.emailSuppressedAt
    || TERMINAL_OUTCOMES.has(prospectStatus)
  );
}

function splitName(prospect = {}) {
  const firstName = normalizeText(
    prospect.first_name
    || prospect.firstName
    || prospect.owner_first_name
    || prospect.ownerFirstName
    || prospect.contact_first_name
    || prospect.contactFirstName,
    100
  );
  const lastName = normalizeText(
    prospect.last_name
    || prospect.lastName
    || prospect.contact_last_name
    || prospect.contactLastName,
    100
  );
  if (firstName || lastName) return { firstName, lastName };

  const parts = normalizeText(prospect.contact_name || prospect.contactName, 200)
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts.shift() || "",
    lastName: parts.join(" ")
  };
}

function resolvePermission(prospect = {}) {
  if (prospect.email_permission !== undefined || prospect.emailPermission !== undefined) {
    return isTruthyPermission(prospect.email_permission ?? prospect.emailPermission);
  }
  return isTruthyPermission(
    prospect.permission_granted
    ?? prospect.permissionGranted
    ?? prospect.permission
  );
}

function getApiKey(env) {
  return normalizeText(env.SMARTLEAD_API_KEY, 1000);
}

function withApiKey(path, apiKey) {
  const url = new URL(`${SMARTLEAD_BASE_URL}${path}`);
  url.searchParams.set("api_key", apiKey);
  return url;
}

async function parseResponse(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}

export async function smartleadRequest(path, {
  method = "GET",
  body,
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  const apiKey = getApiKey(env);
  if (!apiKey) {
    throw new Error("smartlead_api_key_missing");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("smartlead_fetch_unavailable");
  }

  const response = await fetchImpl(withApiKey(path, apiKey), {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    const providerMessage = normalizeText(
      data?.message
      || data?.error
      || data?.errors?.[0]?.message
      || response.statusText,
      300
    );
    throw new Error(`smartlead_request_failed:${response.status}:${providerMessage || "unknown"}`);
  }
  return data;
}

export function resolveSmartleadCampaign(outcome, env = process.env) {
  const normalizedOutcome = normalizeOutcome(outcome);
  const envName = CAMPAIGN_ENV_BY_OUTCOME[normalizedOutcome];
  if (!envName) return null;
  const campaignId = Number.parseInt(normalizeText(env[envName], 30), 10);
  if (!Number.isFinite(campaignId) || campaignId <= 0) return null;
  return { outcome: normalizedOutcome, campaignId, envName };
}

export function buildSmartleadLead(prospect = {}, outcome = "") {
  const { firstName, lastName } = splitName(prospect);
  const email = normalizeEmail(
    prospect.contact_email
    || prospect.contactEmail
    || prospect.email
  );
  return {
    email,
    first_name: firstName,
    last_name: lastName,
    company_name: normalizeText(
      prospect.business_name
      || prospect.businessName
      || prospect.company_name
      || prospect.companyName,
      200
    ),
    phone_number: normalizeText(
      prospect.phone
      || prospect.phone_number
      || prospect.phoneNumber
      || prospect.phone_e164
      || prospect.phoneE164,
      60
    ),
    website: normalizeText(
      prospect.website_url
      || prospect.websiteUrl
      || prospect.website,
      500
    ),
    custom_fields: {
      everycall_prospect_id: normalizeText(prospect.id || prospect.prospect_id || prospect.prospectId, 120),
      everycall_call_outcome: normalizeOutcome(outcome)
    }
  };
}

export async function addProspectToSmartleadCampaign({
  prospect,
  outcome,
  fetchImpl,
  env = process.env
}) {
  const campaign = resolveSmartleadCampaign(outcome, env);
  if (!campaign) {
    return { ok: true, routed: false, reason: "campaign_not_configured" };
  }
  const lead = buildSmartleadLead(prospect, outcome);
  if (!lead.email) {
    return { ok: true, routed: false, reason: "email_missing" };
  }
  if (!resolvePermission(prospect)) {
    return { ok: true, routed: false, reason: "permission_not_granted" };
  }
  if (isSuppressed(prospect)) {
    return { ok: true, routed: false, reason: "prospect_suppressed" };
  }

  const result = await smartleadRequest(`/campaigns/${campaign.campaignId}/leads`, {
    method: "POST",
    body: {
      lead_list: [lead],
      settings: {
        ignore_global_block_list: false,
        ignore_unsubscribe_list: false,
        ignore_duplicate_leads_in_other_campaign: false,
        ignore_community_bounce_list: false,
        return_lead_ids: true
      }
    },
    fetchImpl,
    env
  });
  return {
    ok: true,
    routed: true,
    campaignId: campaign.campaignId,
    leadId: Array.isArray(result?.lead_ids) ? result.lead_ids[0] || null : null,
    result
  };
}

export async function pauseSmartleadLead({
  campaignId,
  leadId,
  fetchImpl,
  env = process.env
}) {
  const normalizedCampaignId = Number.parseInt(String(campaignId || ""), 10);
  const normalizedLeadId = Number.parseInt(String(leadId || ""), 10);
  if (!Number.isFinite(normalizedCampaignId) || !Number.isFinite(normalizedLeadId)) {
    return { ok: true, paused: false, reason: "provider_ids_missing" };
  }
  const result = await smartleadRequest(
    `/campaigns/${normalizedCampaignId}/leads/${normalizedLeadId}/pause`,
    { method: "POST", fetchImpl, env }
  );
  return { ok: true, paused: true, campaignId: normalizedCampaignId, leadId: normalizedLeadId, result };
}

export async function globallySuppressSmartleadLead({
  prospect,
  fetchImpl,
  env = process.env
}) {
  const leadId = Number.parseInt(String(prospect.smartlead_lead_id || prospect.smartleadLeadId || ""), 10);
  if (Number.isFinite(leadId) && leadId > 0) {
    const result = await smartleadRequest(`/leads/${leadId}/unsubscribe`, {
      method: "POST",
      fetchImpl,
      env
    });
    return { ok: true, suppressed: true, method: "unsubscribe", leadId, result };
  }

  const email = normalizeEmail(prospect.contact_email || prospect.contactEmail || prospect.email);
  if (!email) {
    return { ok: true, suppressed: false, reason: "email_missing" };
  }
  const result = await smartleadRequest("/leads/block-list", {
    method: "POST",
    body: { emails: [email] },
    fetchImpl,
    env
  });
  return { ok: true, suppressed: true, method: "block_list", email, result };
}

export async function routeSalesOutcomeToSmartlead({
  prospect,
  outcome,
  fetchImpl,
  env = process.env
}) {
  const normalizedOutcome = normalizeOutcome(outcome);
  if (!normalizedOutcome) {
    return { ok: true, routed: false, reason: "outcome_missing" };
  }

  if (normalizedOutcome === "do_not_call") {
    return globallySuppressSmartleadLead({ prospect, fetchImpl, env });
  }

  if (TERMINAL_OUTCOMES.has(normalizedOutcome)) {
    return pauseSmartleadLead({
      campaignId: prospect.smartlead_campaign_id || prospect.smartleadCampaignId,
      leadId: prospect.smartlead_lead_id || prospect.smartleadLeadId,
      fetchImpl,
      env
    });
  }

  return addProspectToSmartleadCampaign({
    prospect,
    outcome: normalizedOutcome,
    fetchImpl,
    env
  });
}

export const SALES_SMARTLEAD_OUTCOMES = Object.freeze({
  campaignOutcomes: Object.keys(CAMPAIGN_ENV_BY_OUTCOME),
  terminalOutcomes: Array.from(TERMINAL_OUTCOMES)
});
