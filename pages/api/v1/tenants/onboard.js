import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { createSession, setSessionCookie } from "../../_lib/auth.js";
import { getSharedSmsNumber } from "../../_lib/alerts.js";
import { ensureTenantBillingAccount, normalizeBillingInterval } from "../../_lib/billing.js";
import {
  DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS,
  DEFAULT_RUNTIME_TOOL_POLICY,
  DEFAULT_RUNTIME_WORDING_DEFAULTS,
  saveBusinessCallIntent,
  saveCallOutcomeSchema,
  saveKnowledgeRuntimeProfile
} from "../../_lib/knowledgeReceptionistConfig.js";
import { saveTenantPromptProfile } from "../../_lib/promptBlueprints.js";
import {
  inferKnowledgeAssignmentsForIndustry,
  resolveTenantDomainAssignments,
  syncCanonicalKnowledgePacks
} from "../../_lib/knowledgeReceptionistPacks.js";
import { saveSetupInterviewIntent } from "../../_lib/knowledgeReceptionistSetupInterview.js";
import { saveTenantBootstrapProfile } from "../../_lib/tenantBootstrapProfiles.js";
import { enqueueKnowledgeBuild } from "../../_lib/knowledgeReceptionistBuilds.js";
import { normalizePhoneNumber } from "../../_lib/phone.js";
import { createDefaultTenantBusinessHours, saveTenantBusinessHours } from "../../_lib/tenantBusinessHours.js";
import { sendTelnyxSms } from "../../_lib/telnyx.js";
import { normalizeCallerIdName, provisionTenantVoiceNumber } from "../../_lib/voiceProvisioning.js";
import { normalizeMarketingAttribution } from "../../../../lib/intakeMarketingAttribution.js";

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function jsonError(res, status, error, message, fieldErrors = undefined) {
  return res.status(status).json({
    ok: false,
    error,
    message,
    ...(fieldErrors ? { fieldErrors } : {})
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function isValidPhoneNumber(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  const digits = normalized.replace(/[^\d]/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDefaultUserName(email, fallback) {
  const localPart = String(email || "").split("@")[0] || "";
  const humanized = titleCaseWords(localPart.replace(/[._-]+/g, " "));
  return humanized || fallback;
}

async function findExistingUserByEmail(client, email) {
  if (!email) return null;
  const result = await client.query(
    `SELECT id
     FROM tenant_users
     WHERE email = $1
     LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
}

async function findExistingUserByPhone(client, phoneNumber) {
  if (!phoneNumber) return null;
  const result = await client.query(
    `SELECT id
     FROM tenant_users
     WHERE phone_number = $1
     LIMIT 1`,
    [phoneNumber]
  );
  return result.rows[0] || null;
}

async function createTenantUser(client, {
  tenantKey,
  name,
  email,
  phoneNumber = null,
  passwordHash = null,
  role = "owner",
  status = "active",
  leadAlertEmailEnabled = false,
  leadAlertSmsEnabled = false
}) {
  const result = await client.query(
    `INSERT INTO tenant_users (
       tenant_key,
       name,
       email,
       phone_number,
       password_hash,
       role,
       status,
       lead_alert_sms_enabled,
       lead_alert_email_enabled
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      tenantKey,
      name,
      email,
      phoneNumber || null,
      passwordHash,
      role,
      status,
      Boolean(leadAlertSmsEnabled),
      Boolean(leadAlertEmailEnabled)
    ]
  );
  return result.rows[0]?.id || null;
}

async function sendInitialSmsOptInRequest(pool, { tenantKey, userId, phoneNumber }) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!pool || !tenantKey || !userId || !normalizedPhone) {
    return { ok: false, skipped: true };
  }

  const fromNumber = await getSharedSmsNumber(pool);
  if (!fromNumber) {
    return { ok: false, skipped: true, reason: "sms_number_missing" };
  }

  const text = "EveryCall by Creative Dynamic: Reply YES to confirm SMS new lead alerts. Message frequency may vary. Msg&data rates may apply. Consent is not a condition of purchase. Reply HELP for help. Reply STOP to opt out.";
  const smsResult = await sendTelnyxSms({ from: fromNumber, to: normalizedPhone, text });
  const providerMessageId = String(smsResult?.data?.id || smsResult?.id || "").trim() || null;

  await pool.query(
    `UPDATE tenant_users
     SET sms_opt_in_status = 'pending',
         sms_opt_in_requested_at = NOW(),
         sms_opt_in_confirmed_at = NULL,
         updated_at = NOW()
     WHERE tenant_key = $1
       AND id = $2`,
    [tenantKey, userId]
  );

  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, 'system:onboard', 'onboarding.sms_opt_in_requested', $2)`,
    [
      tenantKey,
      `user_id=${userId} phone_number=${normalizedPhone} provider_message_id=${providerMessageId || ""}`
    ]
  );

  return {
    ok: true,
    providerMessageId
  };
}

function parsePayload(body) {
  const businessName = normalizeText(body.businessName);
  const businessCategory = normalizeText(body.businessCategory || body.business_category || body.industry)
    || "professional_services";
  const leadEmail = normalizeEmail(body.leadEmail || body.lead_email);
  const leadPhone = normalizePhoneNumber(body.leadPhone || body.lead_phone || body.smsAlertPhone || body.sms_alert_phone);
  const loginEmail = normalizeEmail(body.loginEmail || body.login_email || body.ownerEmail || body.owner_email);
  const password = String(body.password || "");
  const requestedBootstrapMode = normalizeText(body.bootstrapMode || body.bootstrap_mode);
  const noWebsite = Boolean(
    body.noWebsite === true
    || body.no_website === true
    || String(body.noWebsite || body.no_website || "").trim().toLowerCase() === "true"
  );
  const website = noWebsite ? "" : normalizeText(body.website);
  const bootstrapMode = requestedBootstrapMode || (website ? "website_first" : "setup_interview");
  const marketingAttribution = normalizeMarketingAttribution(body.marketingAttribution || body.marketing_attribution);

  return {
    businessName,
    businessCategory,
    leadEmail,
    leadPhone,
    loginEmail,
    password,
    website,
    companyDescription: "",
    primaryGoal: "Answer callers briefly and move them to the correct next step.",
    bootstrapMode,
    greetingText: normalizeText(body.greetingText || body.greeting_text),
    marketingAttribution
  };
}

function validatePayload(payload) {
  const fieldErrors = {};
  if (!payload.businessName) fieldErrors.businessName = "Business name is required.";
  if (!payload.businessCategory) fieldErrors.businessCategory = "Business category is required.";
  if (!payload.leadEmail) fieldErrors.leadEmail = "Lead email is required.";
  if (!payload.loginEmail) fieldErrors.loginEmail = "Login email is required.";
  if (!payload.password || payload.password.length < 8) fieldErrors.password = "Password must be at least 8 characters.";
  if (payload.bootstrapMode !== "setup_interview" && !payload.website) {
    fieldErrors.website = "Website URL is required unless you choose the no-website path.";
  }
  if (payload.leadPhone && !isValidPhoneNumber(payload.leadPhone)) fieldErrors.leadPhone = "Enter a valid mobile number for SMS alerts.";
  if (!inferKnowledgeAssignmentsForIndustry(payload.businessCategory).length) {
    fieldErrors.businessCategory = "Choose the business category that fits best.";
  }
  return fieldErrors;
}

function defaultBusinessIntent(payload) {
  const primaryGoal = payload.primaryGoal || "Answer callers briefly and move them to the correct next step.";
  return {
    status: "approved_live",
    primaryGoal,
    secondaryGoals: [],
    preferredOutcomes: ["callback_request", "message_taken", "transfer"],
    disallowedOutcomes: ["technical_advice", "invented_pricing"],
    toneRules: [
      "Be clear, short, and helpful on every turn.",
      "Answer direct questions before continuing the script.",
      "Ask one question at a time."
    ],
    salesStyle: {
      style: "service_forward",
      hard_sell_disallowed: true
    },
    disclosureStrategy: {
      mode: "bounded_default",
      phrase: DEFAULT_RUNTIME_WORDING_DEFAULTS.ai_disclosure
    },
    handoffStrategy: {
      preferred_outcome: "callback_request",
      allow_transfer: true
    },
    afterHoursStrategy: {
      mode: "capture_and_callback",
      phrase: "I can take your details so the team can follow up."
    },
    greetingConfig: {
      business_name: payload.businessName
    },
    terminologyPreferences: {}
  };
}

function resolveInitialBillingSelection(marketingAttribution = {}) {
  const planCode = normalizeText(marketingAttribution?.planInterest || marketingAttribution?.plan_interest).toLowerCase();
  const billingCycle = normalizeText(marketingAttribution?.billingCycle || marketingAttribution?.billing_cycle).toLowerCase();
  return {
    planCode: planCode || null,
    billingInterval: billingCycle ? normalizeBillingInterval(billingCycle) : null
  };
}

function defaultRuntimeProfile(payload) {
  return {
    companyDescription: payload.companyDescription,
    greetingText: payload.greetingText || `Thanks for calling ${payload.businessName}. How can I help?`,
    sessionConfig: undefined,
    toolPolicy: DEFAULT_RUNTIME_TOOL_POLICY,
    wordingDefaults: DEFAULT_RUNTIME_WORDING_DEFAULTS,
    runtimeDefaults: {
      ...DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS,
      after_hours_mode: "capture_and_callback"
    }
  };
}

function defaultCallOutcomeSchema(payload, assignments) {
  const assignment = assignments[0] || { domainId: "service_business", subdomainId: null };
  return {
    status: "approved_live",
    domainScope: [assignment.domainId],
    subdomainScope: assignment.subdomainId ? [assignment.subdomainId] : [],
    outcomeTypes: ["callback_request", "message_taken", "transfer"],
    requiredFieldsByOutcome: {
      callback_request: ["first_name", "callback_number", "service_request"],
      message_taken: ["first_name", "callback_number", "service_request"],
      transfer: ["first_name", "callback_number"]
    },
    optionalFieldsByOutcome: {
      callback_request: ["last_name", "address_line1", "city", "state", "postal_code", "requested_date", "requested_time"],
      message_taken: ["last_name", "requested_date", "requested_time"],
      transfer: ["service_request"]
    },
    summaryTemplate: `${payload.businessName} call outcome: {{outcome_type}}`,
    validationRules: ["callback_number_required_for_contactable_outcomes"],
    metadata: {
      bootstrap_source: "tenant_onboard"
    }
  };
}

export default async function handler(req, res) {
  const pool = getPool();
  if (!pool) {
    return jsonError(res, 500, "database_unavailable", "Database is unavailable.");
  }

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return jsonError(res, 405, "method_not_allowed", "Method not allowed.");
    }

    await ensureTables(pool);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const payload = parsePayload(body);
    const fieldErrors = validatePayload(payload);
    if (Object.keys(fieldErrors).length) {
      return jsonError(res, 400, "invalid_payload", "Please correct the highlighted fields.", fieldErrors);
    }

    const client = await pool.connect();
    let tenantKey = "";
    let ownerUserId = null;
    let leadRecipientUserId = null;
    let smsOptInTargetUserId = null;
    try {
      await client.query("BEGIN");
      await syncCanonicalKnowledgePacks(client);

      const passwordHash = await bcrypt.hash(payload.password, 10);
      const baseTenantKey = slugify(payload.businessName) || "tenant";

      for (let attempt = 0; attempt < 50; attempt += 1) {
        tenantKey = attempt === 0 ? baseTenantKey : `${baseTenantKey}_${attempt + 1}`;
        try {
          await client.query(
            `INSERT INTO tenants (tenant_key, name, status, data_region, plan, primary_number, industry)
             VALUES ($1, $2, 'active', 'US', 'Growth', $3, $4)`,
            [tenantKey, payload.businessName, null, payload.businessCategory]
          );
          break;
        } catch (err) {
          if (err?.code !== "23505" || attempt === 49) {
            throw err;
          }
        }
      }

      const existingLoginUser = await findExistingUserByEmail(client, payload.loginEmail);
      if (existingLoginUser) {
        throw new Error("login_email_already_exists");
      }
      if (payload.leadEmail && payload.leadEmail !== payload.loginEmail) {
        const existingLeadUser = await findExistingUserByEmail(client, payload.leadEmail);
        if (existingLeadUser) {
          throw new Error("lead_email_already_exists");
        }
      }
      if (payload.leadPhone) {
        const existingLeadPhone = await findExistingUserByPhone(client, payload.leadPhone);
        if (existingLeadPhone) {
          throw new Error("lead_phone_already_exists");
        }
      }

      const sharedLeadDestination = payload.loginEmail === payload.leadEmail;
      const ownerName = buildDefaultUserName(payload.loginEmail, "Primary Contact");
      ownerUserId = await createTenantUser(client, {
        tenantKey,
        name: ownerName,
        email: payload.loginEmail,
        phoneNumber: sharedLeadDestination ? payload.leadPhone : null,
        passwordHash,
        role: "owner",
        status: "active",
        leadAlertEmailEnabled: sharedLeadDestination,
        leadAlertSmsEnabled: sharedLeadDestination && Boolean(payload.leadPhone)
      });

      if (!sharedLeadDestination) {
        const recipientName = buildDefaultUserName(payload.leadEmail, "Lead Alerts");
        leadRecipientUserId = await createTenantUser(client, {
          tenantKey,
          name: recipientName,
          email: payload.leadEmail,
          phoneNumber: payload.leadPhone || null,
          passwordHash: null,
          role: "viewer",
          status: "active",
          leadAlertEmailEnabled: true,
          leadAlertSmsEnabled: Boolean(payload.leadPhone)
        });
      }

      smsOptInTargetUserId = sharedLeadDestination
        ? ownerUserId
        : leadRecipientUserId;

      await client.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, 'system:onboard', 'onboarding.lead_destination_initialized', $2)`,
        [
          tenantKey,
          `lead_email=${payload.leadEmail} sms_phone=${payload.leadPhone || ""} shared_destination=${sharedLeadDestination ? "true" : "false"}`
        ]
      );

      await client.query(
        `INSERT INTO routing_rules (tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantKey,
          "Dispatch Team",
          "handoff_or_emergency_redirect",
          "capture_and_callback",
          "Mon-Fri 7:00 AM - 8:00 PM"
        ]
      );

      await client.query(
        `INSERT INTO tenant_settings (tenant_key, timezone, notes, caller_id_name)
         VALUES ($1, $2, $3, $4)`,
        [tenantKey, "America/Los_Angeles", payload.companyDescription, normalizeCallerIdName(payload.businessName)]
      );

      await saveTenantBusinessHours(
        client,
        tenantKey,
        createDefaultTenantBusinessHours("America/Los_Angeles"),
        { timezone: "America/Los_Angeles", syncRoutingDisplayText: true }
      );

      const initialBillingSelection = resolveInitialBillingSelection(payload.marketingAttribution);
      await ensureTenantBillingAccount(client, tenantKey, {
        ...(initialBillingSelection.planCode ? { plan_code: initialBillingSelection.planCode } : {}),
        ...(initialBillingSelection.billingInterval ? { billing_interval: initialBillingSelection.billingInterval } : {})
      });

      const bootstrapProfile = await saveTenantBootstrapProfile(client, tenantKey, {
        websiteUrl: payload.website,
        companyDescription: payload.companyDescription,
        businessCategory: payload.businessCategory,
        sourceMode: payload.bootstrapMode,
        marketingAttribution: payload.marketingAttribution
      });

      const assignments = await resolveTenantDomainAssignments(
        client,
        tenantKey,
        inferKnowledgeAssignmentsForIndustry(payload.businessCategory)
      );
      if (!assignments.length) {
        throw new Error("domain_assignment_required");
      }

      const promptProfile = await saveTenantPromptProfile(client, tenantKey, {
        business_name: payload.businessName,
        company_description: payload.companyDescription
      }, {
        role: "tenant",
        user_id: ownerUserId
      });

      const businessCallIntent = await saveBusinessCallIntent(client, tenantKey, defaultBusinessIntent(payload), {
        role: "tenant",
        user_id: ownerUserId
      });

      const runtimeProfile = await saveKnowledgeRuntimeProfile(client, tenantKey, defaultRuntimeProfile(payload), {
        role: "tenant",
        user_id: ownerUserId
      });

      const callOutcomeSchema = await saveCallOutcomeSchema(client, tenantKey, defaultCallOutcomeSchema(payload, assignments), {
        role: "tenant",
        user_id: ownerUserId
      });

      let setupInterviewIntent = null;
      if (payload.bootstrapMode === "setup_interview" || !payload.website) {
        setupInterviewIntent = await saveSetupInterviewIntent(client, tenantKey, {
          status: "approved_live",
          primaryGoal: `Collect and confirm business facts for ${payload.businessName}.`,
          requiredCaptureCategories: ["business_overview", "services", "hours", "service_area", "handoff_paths"]
        });
      }

      await client.query("COMMIT");

      const sessionId = ownerUserId
        ? await createSession({ userId: ownerUserId, tenantKey, role: "tenant" })
        : null;
      if (sessionId) {
        setSessionCookie(res, sessionId);
      }

      const voiceProvisioning = await provisionTenantVoiceNumber({
        pool,
        tenantKey,
        primaryNumber: payload.leadPhone,
        callerIdName: payload.businessName,
        actor: ownerUserId ? `tenant:${ownerUserId}` : "system:onboard",
        stage: "number_setup",
        runningStatusDetail: "Provisioning a voice number during onboarding.",
        successAuditAction: "onboarding.voice_number_provisioned",
        failureAuditAction: "onboarding.voice_number_provision_failed"
      });

      let initialKnowledgeBuild = null;
      if (payload.website) {
        try {
          initialKnowledgeBuild = await enqueueKnowledgeBuild(pool, tenantKey, {
            buildKind: "website_base",
            websiteUrl: payload.website,
            assignments
          });
        } catch (knowledgeBuildErr) {
          console.error("initial_knowledge_build_enqueue_failed", {
            tenantKey,
            error: String(knowledgeBuildErr?.message || "unknown")
          });
        }
      }

      let smsOptInRequest = null;
      if (payload.leadPhone && smsOptInTargetUserId) {
        try {
          smsOptInRequest = await sendInitialSmsOptInRequest(pool, {
            tenantKey,
            userId: smsOptInTargetUserId,
            phoneNumber: payload.leadPhone
          });
        } catch (smsError) {
          smsOptInRequest = {
            ok: false,
            error: String(smsError?.message || "unknown")
          };
          console.error("initial_sms_opt_in_request_failed", {
            tenantKey,
            error: smsOptInRequest.error
          });
        }
      }

      return res.status(200).json({
        ok: true,
        tenantKey,
        bootstrapMode: payload.bootstrapMode,
        bootstrapProfile,
        promptProfile,
        assignments,
        businessCallIntent,
        runtimeProfile,
        callOutcomeSchema,
        setupInterviewIntent,
        voiceProvisioning,
        initialKnowledgeBuild,
        leadDestination: {
          email: payload.leadEmail,
          phoneNumber: payload.leadPhone || null,
          loginEmail: payload.loginEmail,
          separateRecipientCreated: payload.leadEmail !== payload.loginEmail
        },
        smsOptInRequest
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "login_email_already_exists") {
      return jsonError(res, 409, "login_email_already_exists", "That login email is already in use.", {
        loginEmail: "That login email is already in use."
      });
    }
    if (message === "lead_email_already_exists") {
      return jsonError(res, 409, "lead_email_already_exists", "That lead email is already in use.", {
        leadEmail: "That lead email is already in use."
      });
    }
    if (message === "lead_phone_already_exists") {
      return jsonError(res, 409, "lead_phone_already_exists", "That mobile number is already in use.", {
        leadPhone: "That mobile number is already in use."
      });
    }
    if (message === "domain_assignment_required") {
      return jsonError(res, 400, "domain_assignment_required", "A canonical domain/subdomain assignment is required.");
    }
    return jsonError(res, 500, "onboarding_error", message);
  }
}
