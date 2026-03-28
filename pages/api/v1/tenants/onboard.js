import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { createSession, setSessionCookie } from "../../_lib/auth.js";
import { ensureTenantBillingAccount } from "../../_lib/billing.js";
import {
  DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS,
  DEFAULT_RUNTIME_TOOL_POLICY,
  DEFAULT_RUNTIME_WORDING_DEFAULTS,
  saveBusinessCallIntent,
  saveCallOutcomeSchema,
  saveKnowledgeReadiness,
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
import { normalizePhoneNumber } from "../../_lib/phone.js";
import { normalizeCallerIdName, provisionTenantVoiceNumber } from "../../_lib/voiceProvisioning.js";

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

function isValidPhoneNumber(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  const digits = normalized.replace(/[^\d]/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function parsePayload(body) {
  const businessName = normalizeText(body.businessName);
  const businessCategory = normalizeText(body.businessCategory || body.business_category || body.industry)
    || "professional_services";
  const ownerName = normalizeText(body.ownerName);
  const ownerEmail = normalizeText(body.ownerEmail).toLowerCase();
  const ownerPhone = normalizePhoneNumber(body.ownerPhone || body.owner_phone);
  const businessPhone = normalizePhoneNumber(body.businessPhone || body.business_phone);
  const password = String(body.password || "");
  const website = normalizeText(body.website);
  const companyDescription = normalizeText(body.companyDescription || body.company_description);
  const bootstrapMode = normalizeText(body.bootstrapMode || body.bootstrap_mode) || (website ? "website_first" : "setup_interview");

  return {
    businessName,
    businessCategory,
    ownerName,
    ownerEmail,
    ownerPhone,
    businessPhone,
    password,
    website,
    companyDescription,
    primaryGoal: "Answer callers briefly and move them to the correct next step.",
    bootstrapMode,
    greetingText: normalizeText(body.greetingText || body.greeting_text)
  };
}

function validatePayload(payload) {
  const fieldErrors = {};
  if (!payload.businessName) fieldErrors.businessName = "Business name is required.";
  if (!payload.businessCategory) fieldErrors.businessCategory = "Business category is required.";
  if (!payload.ownerName) fieldErrors.ownerName = "Owner name is required.";
  if (!payload.ownerEmail) fieldErrors.ownerEmail = "Owner email is required.";
  if (!payload.businessPhone) fieldErrors.businessPhone = "Business phone is required.";
  if (!payload.password || payload.password.length < 8) fieldErrors.password = "Password must be at least 8 characters.";
  if (!payload.companyDescription) fieldErrors.companyDescription = "A short business description is required.";
  if (payload.ownerPhone && !isValidPhoneNumber(payload.ownerPhone)) fieldErrors.ownerPhone = "Enter a valid owner phone number.";
  if (payload.businessPhone && !isValidPhoneNumber(payload.businessPhone)) fieldErrors.businessPhone = "Enter a valid business phone number.";
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

function initialReadinessChecklist(payload) {
  return {
    hours_confirmed: false,
    address_confirmed: false,
    service_area_confirmed: false,
    calls_forwarded_to_receptionist: false,
    sample_calls_passed: false,
    handoff_path_tested: false,
    outcome_capture_tested: false
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
            [tenantKey, payload.businessName, payload.businessPhone || null, payload.businessCategory]
          );
          break;
        } catch (err) {
          if (err?.code !== "23505" || attempt === 49) {
            throw err;
          }
        }
      }

      const existingOwner = await client.query(
        `SELECT id
         FROM tenant_users
         WHERE email = $1
         LIMIT 1`,
        [payload.ownerEmail]
      );
      if (existingOwner.rowCount) {
        throw new Error("owner_email_already_exists");
      }
      if (payload.ownerPhone) {
        const existingOwnerPhone = await client.query(
          `SELECT id
           FROM tenant_users
           WHERE phone_number = $1
           LIMIT 1`,
          [payload.ownerPhone]
        );
        if (existingOwnerPhone.rowCount) {
          throw new Error("owner_phone_already_exists");
        }
      }

      const userRes = await client.query(
        `INSERT INTO tenant_users (tenant_key, name, email, phone_number, password_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, 'owner', 'active')
         RETURNING id`,
        [tenantKey, payload.ownerName, payload.ownerEmail, payload.ownerPhone || null, passwordHash]
      );
      ownerUserId = userRes.rows[0]?.id || null;

      await client.query(
        `INSERT INTO routing_rules (tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantKey,
          "Dispatch Team",
          "handoff_or_emergency_redirect",
          "capture_and_callback",
          "Unknown"
        ]
      );

      await client.query(
        `INSERT INTO tenant_settings (tenant_key, timezone, notes, caller_id_name)
         VALUES ($1, $2, $3, $4)`,
        [tenantKey, "America/Los_Angeles", payload.companyDescription, normalizeCallerIdName(payload.businessName)]
      );

      await ensureTenantBillingAccount(client, tenantKey);

      const bootstrapProfile = await saveTenantBootstrapProfile(client, tenantKey, {
        websiteUrl: payload.website,
        companyDescription: payload.companyDescription,
        businessCategory: payload.businessCategory,
        sourceMode: payload.bootstrapMode
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

      const readiness = await saveKnowledgeReadiness(client, tenantKey, {
        checklist: initialReadinessChecklist(payload),
        requestedGoLive: false
      }, {
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
        primaryNumber: payload.businessPhone,
        callerIdName: payload.businessName,
        actor: ownerUserId ? `tenant:${ownerUserId}` : "system:onboard",
        stage: "number_setup",
        runningStatusDetail: "Provisioning a voice number during onboarding.",
        successAuditAction: "onboarding.voice_number_provisioned",
        failureAuditAction: "onboarding.voice_number_provision_failed"
      });

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
        readiness,
        setupInterviewIntent,
        voiceProvisioning
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "owner_email_already_exists") {
      return jsonError(res, 409, "owner_email_already_exists", "That owner email is already in use.");
    }
    if (message === "owner_phone_already_exists") {
      return jsonError(res, 409, "owner_phone_already_exists", "That owner phone number is already in use.");
    }
    if (message === "domain_assignment_required") {
      return jsonError(res, 400, "domain_assignment_required", "A canonical domain/subdomain assignment is required.");
    }
    return jsonError(res, 500, "onboarding_error", message);
  }
}
