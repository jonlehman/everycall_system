import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { loadIndustryKnowledgeDefaults } from "../../_lib/industryKnowledge.js";
import { compileTenantKnowledge } from "../../_lib/knowledge.js";
import { findAvailableVoiceNumber, orderVoiceNumber } from "../../_lib/telnyx.js";
import { normalizePhoneNumber } from "../../_lib/phone.js";
import { createSession, getSession, setSessionCookie } from "../../_lib/auth.js";
import { cleanupTenantByKey } from "../../_lib/tenantCleanup.js";
import crypto from "crypto";
import { createBlankGuardrailQuestionTests, createBlankKnowledgeEntries } from "../../../../lib/knowledgeTemplates.js";

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

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeKnowledgeEntries(value) {
  const seen = new Set();
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      sectionType: String(item?.sectionType || "").trim() || "general",
      title: String(item?.title || "").trim() || "General",
      contentText: String(item?.contentText || item?.content || "").trim(),
      sourceType: String(item?.sourceType || "").trim() || null,
      sourceUrl: String(item?.sourceUrl || "").trim() || null,
      sourceConfidence: Number.isFinite(Number(item?.sourceConfidence)) ? Number(item.sourceConfidence) : null
    }))
    .filter((item) => item.sectionType)
    .filter((item) => {
      const key = `${item.sectionType}::${item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeGuardrailQuestionTests(value) {
  const seen = new Set();
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      questionText: String(item?.questionText || item?.question || "").trim(),
      topic: String(item?.topic || "").trim() || null,
      riskLevel: String(item?.riskLevel || "").trim() || "high",
      answer: String(item?.answer || item?.approvedAnswer || item?.draftAnswer || "").trim(),
      sourceType: String(item?.sourceType || "").trim() || null,
      sourceUrl: String(item?.sourceUrl || "").trim() || null,
      sourceConfidence: Number.isFinite(Number(item?.sourceConfidence)) ? Number(item.sourceConfidence) : null
    }))
    .filter((item) => item.questionText)
    .filter((item) => {
      const key = item.questionText.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeSiteTopics(value) {
  const seen = new Set();
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      topicKey: String(item?.topicKey || "").trim() || null,
      parentTopicKey: String(item?.parentTopicKey || "").trim() || null,
      topicPath: String(item?.topicPath || "").trim(),
      parentTopicPath: String(item?.parentTopicPath || "").trim() || null,
      displayTitle: String(item?.displayTitle || item?.title || "").trim() || "Topic",
      topicType: String(item?.topicType || "").trim() || "page",
      summaryObjective: String(item?.summaryObjective || "").trim(),
      sourceUrl: String(item?.sourceUrl || "").trim() || null,
      sourceConfidence: Number.isFinite(Number(item?.sourceConfidence)) ? Number(item.sourceConfidence) : null,
      riskLevel: String(item?.riskLevel || "").trim() || "normal",
      metadata: item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}
    }))
    .filter((item) => item.topicPath)
    .filter((item) => {
      const key = item.topicPath.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeCoverageChecklist(value) {
  const seen = new Set();
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      checkKey: String(item?.checkKey || "").trim(),
      title: String(item?.title || "").trim() || "Coverage review",
      status: String(item?.status || "").trim() || "missing",
      coverageConfidence: Number.isFinite(Number(item?.coverageConfidence)) ? Number(item.coverageConfidence) : null,
      matchedTopicPaths: Array.isArray(item?.matchedTopicPaths)
        ? item.matchedTopicPaths.map((path) => String(path || "").trim()).filter(Boolean)
        : [],
      notes: String(item?.notes || "").trim(),
      metadata: item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}
    }))
    .filter((item) => item.checkKey)
    .filter((item) => {
      const key = item.checkKey.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parsePayload(body) {
  const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();
  const primaryGoals = normalizeStringArray(body.primaryGoals ?? body.primaryGoal);
  const servicesOffered = normalizeStringArray(body.servicesOffered);
  const phone = String(body.phone || body.primaryNumber || "").trim();
  const averageCallsPerDayRaw = body.averageCallsPerDay;
  const averageCallsPerDay = averageCallsPerDayRaw === null || averageCallsPerDayRaw === undefined || String(averageCallsPerDayRaw).trim() === ""
    ? null
    : Number(averageCallsPerDayRaw);

  const emergencyRaw = body.emergencyServices;
  const emergencyServices = emergencyRaw === true || emergencyRaw === "true" || emergencyRaw === 1 || emergencyRaw === "1";
  const qaMode = body.qaMode === true || body.qaMode === "true" || body.qaMode === 1 || body.qaMode === "1";

  return {
    businessName: String(body.businessName || "").trim(),
    industry: String(body.industry || "").trim(),
    ownerName: String(body.ownerName || "").trim(),
    ownerEmail,
    password: String(body.password || ""),
    website: String(body.website || "").trim(),
    phone,
    serviceArea: String(body.serviceArea || "").trim(),
    address: String(body.address || "").trim(),
    timezone: String(body.timezone || "America/Los_Angeles").trim() || "America/Los_Angeles",
    businessHours: String(body.businessHours || "").trim(),
    averageCallsPerDay,
    emergencyServices,
    servicesOffered,
    primaryGoals: primaryGoals.length ? primaryGoals : ["Capture missed-call leads"],
    knowledgeEntriesProvided: Array.isArray(body.knowledgeEntries),
    knowledgeEntries: normalizeKnowledgeEntries(body.knowledgeEntries),
    guardrailQuestionTestsProvided: Array.isArray(body.guardrailQuestionTests),
    guardrailQuestionTests: normalizeGuardrailQuestionTests(body.guardrailQuestionTests),
    siteTopicsProvided: Array.isArray(body.siteTopics),
    siteTopics: normalizeSiteTopics(body.siteTopics),
    coverageChecklistProvided: Array.isArray(body.coverageChecklist),
    coverageChecklist: normalizeCoverageChecklist(body.coverageChecklist),
    status: String(body.status || "active"),
    dataRegion: String(body.dataRegion || "US"),
    plan: String(body.plan || "Trial"),
    qaMode
  };
}

function validatePayload(payload) {
  const fieldErrors = {};
  if (!payload.businessName) fieldErrors.businessName = "Business name is required.";
  if (!payload.industry) fieldErrors.industry = "Industry is required.";
  if (!payload.ownerName) fieldErrors.ownerName = "Owner name is required.";
  if (!payload.ownerEmail) fieldErrors.ownerEmail = "Owner email is required.";
  if (!payload.password) fieldErrors.password = "Password is required.";
  if (!payload.serviceArea) fieldErrors.serviceArea = "Service area is required.";
  if (payload.password && payload.password.length < 8) fieldErrors.password = "Password must be at least 8 characters.";
  if (payload.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.ownerEmail)) {
    fieldErrors.ownerEmail = "Enter a valid email address.";
  }
  if (payload.servicesOffered.length < 1) fieldErrors.servicesOffered = "Select at least one service.";
  if (payload.primaryGoals.length < 1) fieldErrors.primaryGoals = "Select at least one primary goal.";
  if (payload.averageCallsPerDay !== null && (!Number.isFinite(payload.averageCallsPerDay) || payload.averageCallsPerDay < 0)) {
    fieldErrors.averageCallsPerDay = "Average calls per day must be a non-negative number.";
  }
  return fieldErrors;
}

async function findReusableIdempotentResult(pool, idempotencyKey, requestHash) {
  if (!idempotencyKey) return null;
  const row = await pool.query(
    `SELECT response_status, response_body, request_hash
     FROM onboarding_idempotency
     WHERE idempotency_key = $1
     LIMIT 1`,
    [idempotencyKey]
  );
  if (!row.rowCount) return null;
  const existing = row.rows[0];
  if (existing.request_hash !== requestHash) {
    return { conflict: true };
  }
  return {
    status: Number(existing.response_status),
    body: existing.response_body
  };
}

async function storeIdempotentResult(pool, idempotencyKey, requestHash, responseStatus, responseBody) {
  if (!idempotencyKey) return;
  await pool.query(
    `INSERT INTO onboarding_idempotency (idempotency_key, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (idempotency_key)
     DO NOTHING`,
    [idempotencyKey, requestHash, responseStatus, JSON.stringify(responseBody)]
  );
}

function buildPrompt({ businessName, industry, serviceArea, businessHours, emergency }) {
  return `# ROLE
You are the friendly receptionist for ${businessName}. You answer calls, gather caller details, and schedule a callback.

# BUSINESS CONTEXT
Industry: ${industry}
Service area: ${serviceArea || "Local metro area"}
Hours: ${businessHours || "Standard business hours"}
Emergency services: ${emergency ? "Yes" : "No"}

# BEHAVIOR
- Be warm, concise, and professional.
- Ask one question at a time.
- Confirm critical details (name, phone, address).
- Never invent pricing or scheduling details.

# CLOSING
Ask if there is anything else you can help with, then close politely.`;
}

async function resolveTenantPrompt(client, payload) {
  const industryPromptRow = await client.query(
    `SELECT prompt
     FROM industry_prompts
     WHERE industry_key = $1
     LIMIT 1`,
    [payload.industry]
  );
  const industryPrompt = String(industryPromptRow.rows[0]?.prompt || "").trim();
  if (industryPrompt) {
    return industryPrompt;
  }
  return buildPrompt({
    businessName: payload.businessName,
    industry: payload.industry,
    serviceArea: payload.serviceArea,
    businessHours: payload.businessHours,
    emergency: payload.emergencyServices
  });
}

function truncateText(value, limit = 400) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function joinKnowledgeText(primary, secondary) {
  const a = String(primary || "").trim();
  const b = String(secondary || "").trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

function buildKnowledgeEntriesFromDefaults(payload, defaults = []) {
  const bySection = new Map((defaults || []).map((entry) => [String(entry.sectionType || ""), entry]));
  const serviceSummary = [
    payload.businessName ? `${payload.businessName} is a ${payload.industry} business.` : "",
    payload.servicesOffered.length ? `Services include ${payload.servicesOffered.join(", ")}.` : ""
  ].filter(Boolean).join(" ");

  return createBlankKnowledgeEntries().map((template) => {
    const base = bySection.get(template.sectionType) || template;
    if (template.sectionType === "services_and_capabilities" && serviceSummary) {
      return {
        ...base,
        contentText: joinKnowledgeText(serviceSummary, base.contentText),
        sourceType: "intake_form"
      };
    }
    if (template.sectionType === "service_area" && payload.serviceArea) {
      return {
        ...base,
        contentText: payload.serviceArea,
        sourceType: "intake_form"
      };
    }
    if (template.sectionType === "hours_and_availability" && payload.businessHours) {
      return {
        ...base,
        contentText: payload.businessHours,
        sourceType: "intake_form"
      };
    }
    if (template.sectionType === "emergency_service" && payload.emergencyServices) {
      return {
        ...base,
        contentText: joinKnowledgeText(
          "Emergency or after-hours service may be offered. Exact availability should be confirmed before promising dispatch timing.",
          base.contentText
        ),
        sourceType: "intake_form"
      };
    }
    return base;
  });
}

function buildGuardrailQuestionTestsFromDefaults(payload, defaults = []) {
  const byQuestion = new Map((defaults || []).map((item) => [String(item.questionText || ""), item]));
  return createBlankGuardrailQuestionTests().map((template) => {
    const base = byQuestion.get(template.questionText) || template;
    if (template.topic === "service_area" && payload.serviceArea) {
      return { ...base, answer: payload.serviceArea, sourceType: "intake_form" };
    }
    if (template.topic === "availability" && payload.businessHours) {
      return { ...base, answer: payload.businessHours, sourceType: "intake_form" };
    }
    if (template.topic === "emergency_service" && payload.emergencyServices) {
      return {
        ...base,
        answer: "Emergency or after-hours service may be offered, but exact dispatch timing should be confirmed before making a promise.",
        sourceType: "intake_form"
      };
    }
    return base;
  });
}

function parseProvisioningError(err) {
  const raw = String(err?.message || err || "unknown_error").trim();
  if (raw.startsWith("telnyx_request_failed:")) {
    const [, status, ...rest] = raw.split(":");
    return {
      errorCode: `telnyx_request_failed_${status || "unknown"}`,
      errorMessage: truncateText(rest.join(":") || "Telnyx request failed.")
    };
  }
  if (raw === "TELNYX_VOICE_CONNECTION_ID missing") {
    return {
      errorCode: "missing_voice_connection_id",
      errorMessage: raw
    };
  }
  if (raw === "TELNYX_API_KEY missing") {
    return {
      errorCode: "missing_telnyx_api_key",
      errorMessage: raw
    };
  }
  return {
    errorCode: truncateText(raw.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase(), 80) || "provisioning_error",
    errorMessage: truncateText(raw)
  };
}

function intakeSkipVoiceProvisioningEnabled() {
  return String(process.env.INTAKE_SKIP_VOICE_PROVISIONING || "").trim() === "1";
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
    const validationErrors = validatePayload(payload);
    if (Object.keys(validationErrors).length) {
      return jsonError(res, 400, "invalid_payload", "Please correct the highlighted fields.", validationErrors);
    }
    const skipVoiceProvisioning = payload.qaMode && intakeSkipVoiceProvisioningEnabled();
    if (payload.qaMode) {
      const session = await getSession(req);
      if (!session || session.role !== "admin") {
        return jsonError(res, 403, "qa_mode_requires_admin", "QA intake requires an active admin session.");
      }
      if (!skipVoiceProvisioning) {
        return jsonError(res, 403, "qa_mode_disabled", "QA intake is disabled until INTAKE_SKIP_VOICE_PROVISIONING=1 is set.");
      }
    }

    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    const requestHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const existingResult = await findReusableIdempotentResult(pool, idempotencyKey, requestHash);
    if (existingResult?.conflict) {
      return jsonError(res, 409, "idempotency_key_reused", "Idempotency key was already used with a different request payload.");
    }
    if (existingResult) {
      const existingBody = existingResult.body || {};
      if (existingBody?.ok && payload.ownerEmail && !payload.qaMode) {
        const userRow = await pool.query(
          `SELECT id, tenant_key
           FROM tenant_users
           WHERE email = $1
           LIMIT 1`,
          [payload.ownerEmail]
        );
        if (userRow.rowCount) {
          const user = userRow.rows[0];
          const sessionId = await createSession({ userId: user.id, tenantKey: user.tenant_key, role: "tenant" });
          if (sessionId) setSessionCookie(res, sessionId);
        }
      }
      return res.status(existingResult.status).json(existingBody);
    }

    const industry = payload.industry;
    const industryRow = await pool.query(
      `SELECT key FROM industries WHERE key = $1 AND active = true`,
      [industry]
    );
    if (!industryRow.rowCount) {
      const responseBody = {
        ok: false,
        error: "invalid_industry",
        message: "Selected industry is invalid or inactive.",
        fieldErrors: { industry: "Select an active industry." }
      };
      await storeIdempotentResult(pool, idempotencyKey, requestHash, 400, responseBody);
      return res.status(400).json(responseBody);
    }

    let tenantKey = "";
    let ownerUserId = null;
    const baseTenantKey = payload.qaMode
      ? `intake_qa_${slugify(payload.businessName) || "tenant"}`
      : slugify(payload.businessName) || "tenant";
    const servicesOfferedText = payload.servicesOffered.join(", ");
    const primaryGoalsText = payload.primaryGoals.join(", ");
    const maxTenantKeyAttempts = payload.qaMode ? 1 : 50;

    if (payload.qaMode) {
      await cleanupTenantByKey(baseTenantKey, { releaseNumber: true });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const passwordHash = await bcrypt.hash(payload.password, 10);

      for (let attempt = 0; attempt < maxTenantKeyAttempts; attempt += 1) {
        tenantKey = attempt === 0 ? baseTenantKey : `${baseTenantKey}_${attempt + 1}`;
        await client.query("SAVEPOINT tenant_key_insert");
        try {
          await client.query(
            `INSERT INTO tenants (tenant_key, name, status, data_region, plan, primary_number, industry)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              tenantKey,
              payload.businessName,
              payload.status,
              payload.dataRegion,
              payload.plan,
              payload.phone || null,
              payload.industry
            ]
          );
          await client.query("RELEASE SAVEPOINT tenant_key_insert");
          break;
        } catch (insertErr) {
          await client.query("ROLLBACK TO SAVEPOINT tenant_key_insert");
          await client.query("RELEASE SAVEPOINT tenant_key_insert");
          if (insertErr?.code === "23505") {
            if (attempt === maxTenantKeyAttempts - 1) {
              await client.query("ROLLBACK");
              const responseBody = {
                ok: false,
                error: "tenant_key_conflict",
                message: "Could not generate a unique tenant key. Please try again."
              };
              await storeIdempotentResult(pool, idempotencyKey, requestHash, 409, responseBody);
              return res.status(409).json(responseBody);
            }
            continue;
          }
          throw insertErr;
        }
      }

      const insertedUser = await client.query(
        `INSERT INTO tenant_users (tenant_key, name, email, password_hash, role, status)
         VALUES ($1, $2, $3, $4, 'owner', 'active')
         RETURNING id`,
        [tenantKey, payload.ownerName, payload.ownerEmail, passwordHash]
      );
      ownerUserId = insertedUser.rows[0]?.id || null;

      await client.query(
        `INSERT INTO onboarding_intake (tenant_key, owner_name, owner_email, website, phone, service_area, address, timezone, business_hours, average_calls_per_day, emergency_services, services_offered, primary_goal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          tenantKey,
          payload.ownerName,
          payload.ownerEmail,
          payload.website || null,
          payload.phone || null,
          payload.serviceArea,
          payload.address,
          payload.timezone,
          payload.businessHours,
          payload.averageCallsPerDay,
          payload.emergencyServices,
          servicesOfferedText,
          primaryGoalsText
        ]
      );

      await client.query(
        `INSERT INTO routing_rules (tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantKey,
          "Dispatch Team",
          payload.emergencyServices ? "Priority Queue" : "Standard Queue",
          "Collect details and dispatch callback",
          payload.businessHours || "Weekdays 8:00 AM - 6:00 PM"
        ]
      );

      await client.query(
        `INSERT INTO tenant_settings (tenant_key, timezone, notes)
         VALUES ($1, $2, $3)`,
        [tenantKey, payload.timezone, primaryGoalsText || null]
      );

      const prompt = await resolveTenantPrompt(client, payload);

      const agentName = "Alex";
      const greetingText = `Hi, thanks for calling ${payload.businessName}. This is ${agentName}, how can I help you?`;
      const voiceType = "alloy";

      await client.query(
        `INSERT INTO agents (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override, greeting_text, voice_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantKey, agentName, payload.businessName, prompt, prompt, greetingText, voiceType]
      );

      await client.query(
        `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override, greeting_text, voice_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantKey, agentName, payload.businessName, prompt, prompt, greetingText, voiceType]
      );

      const industryDefaults = (!payload.knowledgeEntriesProvided || !payload.guardrailQuestionTestsProvided)
        ? await loadIndustryKnowledgeDefaults(client, industry)
        : { knowledgeEntries: [], guardrailQuestionTests: [] };

      const knowledgeEntries = payload.knowledgeEntriesProvided
        ? payload.knowledgeEntries
        : buildKnowledgeEntriesFromDefaults(payload, industryDefaults.knowledgeEntries);
      for (const entry of knowledgeEntries) {
        await client.query(
          `INSERT INTO knowledge_entries (tenant_key, entry_type, section_type, title, content_text, source_url, compilation_status, metadata_json, created_by_type)
           VALUES ($1, 'intake_review', $2, $3, $4, $5, 'compiled', $6::jsonb, 'tenant')`,
          [
            tenantKey,
            entry.sectionType,
            entry.title,
            entry.contentText || "",
            entry.sourceUrl || null,
            JSON.stringify({
              sourceType: entry.sourceType || null,
              sourceConfidence: entry.sourceConfidence ?? null
            })
          ]
        );
      }

      const guardrailQuestionTests = payload.guardrailQuestionTestsProvided
        ? payload.guardrailQuestionTests
        : buildGuardrailQuestionTestsFromDefaults(payload, industryDefaults.guardrailQuestionTests);
      for (const item of guardrailQuestionTests) {
        const answer = String(item.answer || "").trim();
        await client.query(
          `INSERT INTO guardrail_question_tests (tenant_key, topic, question_text, risk_level, draft_answer, approved_answer, review_status, supporting_artifacts_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            tenantKey,
            item.topic || null,
            item.questionText,
            item.riskLevel || "high",
            answer || null,
            answer || null,
            answer ? "approved" : "pending",
            JSON.stringify({
              sourceType: item.sourceType || null,
              sourceUrl: item.sourceUrl || null,
              sourceConfidence: item.sourceConfidence ?? null
            })
          ]
        );
      }

      for (const topic of payload.siteTopics) {
        await client.query(
          `INSERT INTO site_topics (tenant_key, topic_key, parent_topic_key, topic_path, parent_topic_path, display_title, topic_type, summary_objective, source_url, source_confidence, risk_level, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
          [
            tenantKey,
            topic.topicKey || slugify(topic.topicPath) || null,
            topic.parentTopicKey || null,
            topic.topicPath,
            topic.parentTopicPath || null,
            topic.displayTitle,
            topic.topicType || "page",
            topic.summaryObjective || null,
            topic.sourceUrl || null,
            topic.sourceConfidence,
            topic.riskLevel || "normal",
            JSON.stringify(topic.metadata || {})
          ]
        );
      }

      for (const item of payload.coverageChecklist) {
        await client.query(
          `INSERT INTO knowledge_coverage_checks (tenant_key, check_key, title, status, coverage_confidence, matched_topic_paths_json, notes, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)`,
          [
            tenantKey,
            item.checkKey,
            item.title,
            item.status || "missing",
            item.coverageConfidence,
            JSON.stringify(item.matchedTopicPaths || []),
            item.notes || null,
            JSON.stringify(item.metadata || {})
          ]
        );
      }

      await compileTenantKnowledge(client, tenantKey);

      await client.query(
        `INSERT INTO provisioning_jobs (tenant_key, stage, status, status_detail, provider, updated_at)
         VALUES ($1, 'workflow_seed', 'running', 'Seeding tenant workflow and defaults.', NULL, NOW()),
                ($1, 'number_setup', 'pending', 'Waiting to provision a voice number.', 'telnyx', NOW())`,
        [tenantKey]
      );

      await client.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, 'system', 'onboarding.completed', $2)`,
        [tenantKey, `industry=${industry} owner=${payload.ownerEmail}`]
      );

      await client.query(
        `UPDATE provisioning_jobs
         SET status = 'done',
             status_detail = 'Tenant workflow seeded.',
             completed_at = NOW(),
             updated_at = NOW()
         WHERE tenant_key = $1
           AND stage = 'workflow_seed'`,
        [tenantKey]
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      if (txErr?.code === "23505" && String(txErr?.constraint || "").includes("tenant_users_email_unique")) {
        const responseBody = {
          ok: false,
          error: "email_exists",
          message: "An account with this email already exists.",
          fieldErrors: { ownerEmail: "Already in use." }
        };
        await storeIdempotentResult(pool, idempotencyKey, requestHash, 409, responseBody);
        return res.status(409).json(responseBody);
      }
      throw txErr;
    } finally {
      client.release();
    }

    // Auto-provision a local voice number via Telnyx (non-blocking for core onboarding).
    let voiceStatus = "pending";
    let voiceNumber = null;
    try {
      await pool.query(
        `UPDATE provisioning_jobs
         SET status = 'running',
             status_detail = 'Searching for an available local voice number.',
             attempted_at = COALESCE(attempted_at, NOW()),
             provider = 'telnyx',
             error_code = NULL,
             error_message = NULL,
             updated_at = NOW()
         WHERE tenant_key = $1
           AND stage = 'number_setup'`,
        [tenantKey]
      );

      if (skipVoiceProvisioning) {
        await pool.query(
          `UPDATE tenants
           SET telnyx_voice_status = 'skipped',
               updated_at = NOW()
           WHERE tenant_key = $1`,
          [tenantKey]
        );
        await pool.query(
          `UPDATE provisioning_jobs
           SET status = 'done',
               status_detail = $2,
               provider = 'test',
               provider_reference = NULL,
               error_code = NULL,
               error_message = NULL,
               completed_at = NOW(),
               updated_at = NOW()
           WHERE tenant_key = $1
             AND stage = 'number_setup'`,
          [tenantKey, 'Skipped voice number provisioning in QA intake mode.']
        );
        await pool.query(
          `INSERT INTO audit_log (tenant_key, actor, action, details)
           VALUES ($1, 'system', 'provisioning.number_setup_skipped', $2)`,
          [tenantKey, 'provider=test qa_mode=true number_setup=skipped']
        );
        voiceStatus = "skipped";
      } else {
        const normalizedPrimary = normalizePhoneNumber(payload.phone || null);
        const digits = String(normalizedPrimary || "").replace(/[^\d]/g, "");
        const areaCode = digits.length >= 10 ? digits.slice(-10, -7) : null;
        let availableNumber = await findAvailableVoiceNumber({ areaCode });
        if (!availableNumber) {
          availableNumber = await findAvailableVoiceNumber();
        }
        if (availableNumber?.phoneNumber) {
          voiceNumber = availableNumber.phoneNumber;
          const connectionId = process.env.TELNYX_VOICE_CONNECTION_ID || "";
          const voiceOrder = await orderVoiceNumber({ phoneNumber: voiceNumber, connectionId });
          await pool.query(
            `UPDATE tenants
             SET telnyx_voice_number = $2,
                 telnyx_voice_order_id = $3,
                 telnyx_voice_monthly_cost_cents = $4,
                 telnyx_voice_upfront_cost_cents = $5,
                 telnyx_voice_purchased_at = NOW(),
                 telnyx_voice_status = 'active',
                 updated_at = NOW()
             WHERE tenant_key = $1`,
            [
              tenantKey,
              voiceNumber,
              voiceOrder?.data?.id || null,
              Number.isFinite(Number(availableNumber.monthlyCost)) ? Math.round(Number(availableNumber.monthlyCost) * 100) : null,
              Number.isFinite(Number(availableNumber.upfrontCost)) ? Math.round(Number(availableNumber.upfrontCost) * 100) : null
            ]
          );
          await pool.query(
            `UPDATE provisioning_jobs
             SET status = 'done',
                 status_detail = $2,
                 provider = 'telnyx',
                 provider_reference = $3,
                 error_code = NULL,
                 error_message = NULL,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE tenant_key = $1
               AND stage = 'number_setup'`,
            [tenantKey, truncateText(`Provisioned ${voiceNumber}.`), voiceOrder?.data?.id || null]
          );
          await pool.query(
            `INSERT INTO audit_log (tenant_key, actor, action, details)
             VALUES ($1, 'system', 'provisioning.number_setup_succeeded', $2)`,
            [tenantKey, `provider=telnyx phone=${voiceNumber} order_id=${voiceOrder?.data?.id || ""}`]
          );
          voiceStatus = "active";
        } else {
          await pool.query(
            `UPDATE tenants
             SET telnyx_voice_status = 'unavailable',
                 updated_at = NOW()
             WHERE tenant_key = $1`,
            [tenantKey]
          );
          await pool.query(
            `UPDATE provisioning_jobs
             SET status = 'failed',
                 status_detail = 'No voice number was available to assign.',
                 provider = 'telnyx',
                 error_code = 'no_available_number',
                 error_message = 'No local voice number was available from Telnyx.',
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE tenant_key = $1
               AND stage = 'number_setup'`,
            [tenantKey]
          );
          await pool.query(
            `INSERT INTO audit_log (tenant_key, actor, action, details)
             VALUES ($1, 'system', 'provisioning.number_setup_failed', $2)`,
            [tenantKey, 'provider=telnyx code=no_available_number']
          );
          voiceStatus = "unavailable";
        }
      }
    } catch (err) {
      const { errorCode, errorMessage } = parseProvisioningError(err);
      await pool.query(
        `UPDATE tenants
         SET telnyx_voice_status = 'failed',
             updated_at = NOW()
         WHERE tenant_key = $1`,
        [tenantKey]
      );
      await pool.query(
        `UPDATE provisioning_jobs
         SET status = 'failed',
             status_detail = $2,
             provider = 'telnyx',
             provider_reference = NULL,
             error_code = $3,
             error_message = $4,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE tenant_key = $1
           AND stage = 'number_setup'`,
        [tenantKey, 'Voice number provisioning failed.', errorCode, errorMessage]
      );
      await pool.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, 'system', 'provisioning.number_setup_failed', $2)`,
        [tenantKey, truncateText(`provider=telnyx code=${errorCode} message=${errorMessage}`, 800)]
      );
      voiceStatus = "failed";
    }

    if (ownerUserId && !payload.qaMode) {
      const sessionId = await createSession({ userId: ownerUserId, tenantKey, role: "tenant" });
      if (sessionId) setSessionCookie(res, sessionId);
    }

    const assignedVoiceNumber = voiceStatus === "active" ? voiceNumber : null;

    const successBody = {
      ok: true,
      tenantKey,
      redirectTo: payload.qaMode ? `/admin/tenants/${tenantKey}` : "/client/overview",
      provisioning: {
        voiceStatus,
        voiceNumber: assignedVoiceNumber
      }
    };
    await storeIdempotentResult(pool, idempotencyKey, requestHash, 200, successBody);
    return res.status(200).json(successBody);
  } catch (err) {
    return jsonError(res, 500, "onboarding_error", err?.message || "unknown");
  }
}
