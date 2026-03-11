import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { normalizeFaqCategory } from "../../_lib/faqCategories.js";
import { findAvailableVoiceNumber, orderVoiceNumber } from "../../_lib/telnyx.js";
import { normalizePhoneNumber } from "../../_lib/phone.js";
import { createSession, setSessionCookie } from "../../_lib/auth.js";
import crypto from "crypto";

const BASE_FAQS = [
  {
    question: "What areas do you serve?",
    answer: "We serve the local metro area and nearby suburbs. Share your address and we will confirm coverage.",
    category: "Service Area"
  },
  {
    question: "What are your hours and availability?",
    answer: "We are available weekdays with emergency support as needed. Call for the next available slot.",
    category: "Availability"
  },
  {
    question: "Where are you located?",
    answer: "We are locally based and dispatch the nearest available team.",
    category: "Location"
  },
  {
    question: "Do you offer free estimates?",
    answer: "Yes. We provide no-obligation estimates after we review the details of your request.",
    category: "Pricing"
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept credit cards, checks, and cash. Financing may be available for larger jobs.",
    category: "Billing"
  }
];

const INDUSTRY_FAQS = {
  plumbing: [
    {
      question: "What should I do for a burst pipe?",
      answer: "Shut off the main water valve if safe to do so, then call us immediately.",
      category: "Emergency"
    },
    {
      question: "Do you handle drain clogs and backups?",
      answer: "Yes. We clear clogs, inspect lines, and recommend next steps to prevent repeat issues.",
      category: "Services"
    }
  ],
  window_installers: [
    {
      question: "Do you replace broken glass or only full windows?",
      answer: "We can assess whether a glass-only replacement is possible or if a full unit is required.",
      category: "Services"
    },
    {
      question: "What is the typical lead time for installation?",
      answer: "Lead time varies by product availability and scope. We will confirm the schedule after measuring.",
      category: "Scheduling"
    }
  ],
  electrical: [
    {
      question: "What should I do if I smell burning or see sparks?",
      answer: "Turn off power at the breaker if safe, evacuate if needed, and call us immediately.",
      category: "Emergency"
    },
    {
      question: "Do you upgrade electrical panels?",
      answer: "Yes. We can inspect your panel, confirm code requirements, and provide upgrade options.",
      category: "Services"
    }
  ],
  hvac: [
    {
      question: "What should I do if I have no heat or no cooling?",
      answer: "Check the thermostat and breaker. If it is still out, call us for priority service.",
      category: "Emergency"
    },
    {
      question: "Do you offer maintenance plans?",
      answer: "Yes. We provide seasonal tune-ups and priority scheduling for plan members.",
      category: "Maintenance"
    }
  ],
  roofing: [
    {
      question: "Do you handle emergency leaks?",
      answer: "Yes. We can tarp and stabilize leaks quickly, then schedule permanent repairs.",
      category: "Emergency"
    },
    {
      question: "Do you work with insurance claims?",
      answer: "Yes. We can document damage and provide estimates to support your claim.",
      category: "Billing"
    }
  ],
  landscaping: [
    {
      question: "Do you offer recurring maintenance?",
      answer: "Yes. We offer weekly or bi-weekly maintenance plans.",
      category: "Maintenance"
    },
    {
      question: "Can you handle irrigation issues?",
      answer: "Yes. We can diagnose and repair irrigation systems.",
      category: "Services"
    }
  ],
  cleaning: [
    {
      question: "Do you provide recurring cleanings?",
      answer: "Yes. We offer weekly, bi-weekly, and monthly service plans.",
      category: "Maintenance"
    },
    {
      question: "Do you bring your own supplies?",
      answer: "Yes. We bring standard supplies and can use client-provided products upon request.",
      category: "Services"
    }
  ],
  pest_control: [
    {
      question: "Do you offer one-time treatments?",
      answer: "Yes. We offer one-time and recurring plans depending on the issue.",
      category: "Services"
    },
    {
      question: "How soon can you come out for an infestation?",
      answer: "We prioritize urgent cases and can often schedule within 24-48 hours.",
      category: "Scheduling"
    }
  ],
  garage_door: [
    {
      question: "Do you repair broken springs?",
      answer: "Yes. We can replace springs and tune up doors for safe operation.",
      category: "Services"
    },
    {
      question: "Do you install new openers?",
      answer: "Yes. We install and configure new openers and smart controls.",
      category: "Services"
    }
  ],
  general_contractor: [
    {
      question: "Do you handle permits?",
      answer: "Yes. We can manage permits and inspections as part of the project.",
      category: "Process"
    },
    {
      question: "Can you provide a project timeline?",
      answer: "Yes. After a scope review, we provide a timeline and milestones.",
      category: "Scheduling"
    }
  ],
  locksmith: [
    {
      question: "Do you offer emergency lockout service?",
      answer: "Yes. We provide emergency lockout service and prioritize urgent calls.",
      category: "Emergency"
    },
    {
      question: "Can you rekey locks?",
      answer: "Yes. We rekey residential and commercial locks.",
      category: "Services"
    }
  ]
};

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

function normalizeFaqDrafts(value) {
  const seen = new Set();
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      question: String(item?.question || "").trim(),
      answer: String(item?.answer || "").trim(),
      category: normalizeFaqCategory(item),
      sourceType: String(item?.sourceType || "").trim() || null,
      sourceUrl: String(item?.sourceUrl || "").trim() || null,
      sourceRetrievedAt: String(item?.sourceRetrievedAt || "").trim() || null,
      sourceConfidence: Number.isFinite(Number(item?.sourceConfidence)) ? Number(item.sourceConfidence) : null
    }))
    .filter((item) => item.question)
    .filter((item) => {
      const key = item.question.toLowerCase().replace(/\s+/g, " ").trim();
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
    primaryGoals,
    faqDraftsProvided: Array.isArray(body.faqDrafts),
    faqDrafts: normalizeFaqDrafts(body.faqDrafts),
    status: String(body.status || "active"),
    dataRegion: String(body.dataRegion || "US"),
    plan: String(body.plan || "Trial")
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

    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    const requestHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const existingResult = await findReusableIdempotentResult(pool, idempotencyKey, requestHash);
    if (existingResult?.conflict) {
      return jsonError(res, 409, "idempotency_key_reused", "Idempotency key was already used with a different request payload.");
    }
    if (existingResult) {
      const existingBody = existingResult.body || {};
      if (existingBody?.ok && payload.ownerEmail) {
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
    const baseTenantKey = slugify(payload.businessName) || "tenant";
    const servicesOfferedText = payload.servicesOffered.join(", ");
    const primaryGoalsText = payload.primaryGoals.join(", ");
    const maxTenantKeyAttempts = 50;

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

      let prompt = buildPrompt({
        businessName: payload.businessName,
        industry: payload.industry,
        serviceArea: payload.serviceArea,
        businessHours: payload.businessHours,
        emergency: payload.emergencyServices
      });

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

      for (const faq of BASE_FAQS) {
        await client.query(
          `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_default)
           VALUES ($1, $2, $3, $4, false, true)`,
          [tenantKey, faq.question, faq.answer, normalizeFaqCategory(faq)]
        );
      }

      let industryFaqs = [];
      if (payload.faqDraftsProvided) {
        industryFaqs = payload.faqDrafts;
      } else {
        const industryFaqRows = await client.query(
          `SELECT question, answer, category FROM industry_faqs WHERE industry_key = $1 ORDER BY id ASC`,
          [industry]
        );
        if (industryFaqRows.rowCount) {
          const seen = new Set();
          industryFaqs = industryFaqRows.rows.filter((faq) => {
            const key = String(faq.question || "").toLowerCase().replace(/\s+/g, " ").trim();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        } else {
          industryFaqs = INDUSTRY_FAQS[industry] || [];
        }
      }
      for (const faq of industryFaqs) {
        await client.query(
          `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_industry_default, industry, source_type, source_url, source_retrieved_at, source_confidence)
           VALUES ($1, $2, $3, $4, true, true, $5, $6, $7, $8, $9)`,
          [
            tenantKey,
            faq.question,
            String(faq.answer || ""),
            normalizeFaqCategory(faq),
            industry,
            faq.sourceType || null,
            faq.sourceUrl || null,
            faq.sourceRetrievedAt || null,
            faq.sourceConfidence
          ]
        );
      }

      await client.query(
        `INSERT INTO provisioning_jobs (tenant_key, stage, status, updated_at)
         VALUES ($1, 'workflow_seed', 'running', NOW()),
                ($1, 'number_setup', 'pending', NOW())`,
        [tenantKey]
      );

      await client.query(
        `INSERT INTO audit_log (tenant_key, actor, action, details)
         VALUES ($1, 'system', 'onboarding.completed', $2)`,
        [tenantKey, `industry=${industry} owner=${payload.ownerEmail}`]
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
      const normalizedPrimary = normalizePhoneNumber(payload.phone || null);
      const digits = String(normalizedPrimary || "").replace(/[^\d]/g, "");
      const areaCode = digits.length >= 10 ? digits.slice(-10, -7) : null;
      voiceNumber = await findAvailableVoiceNumber({ areaCode });
      if (!voiceNumber) {
        voiceNumber = await findAvailableVoiceNumber();
      }
      if (voiceNumber) {
        const connectionId = process.env.TELNYX_VOICE_CONNECTION_ID || "";
        const voiceOrder = await orderVoiceNumber({ phoneNumber: voiceNumber, connectionId });
        await pool.query(
          `UPDATE tenants
           SET telnyx_voice_number = $2,
               telnyx_voice_order_id = $3,
               telnyx_voice_status = 'active',
               updated_at = NOW()
           WHERE tenant_key = $1`,
          [tenantKey, voiceNumber, voiceOrder?.data?.id || null]
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
        voiceStatus = "unavailable";
      }
    } catch (err) {
      await pool.query(
        `UPDATE tenants
         SET telnyx_voice_status = 'failed',
             updated_at = NOW()
         WHERE tenant_key = $1`,
        [tenantKey]
      );
      voiceStatus = "failed";
    }

    if (ownerUserId) {
      const sessionId = await createSession({ userId: ownerUserId, tenantKey, role: "tenant" });
      if (sessionId) setSessionCookie(res, sessionId);
    }

    const successBody = {
      ok: true,
      tenantKey,
      redirectTo: "/client/overview",
      provisioning: {
        voiceStatus,
        voiceNumber
      }
    };
    await storeIdempotentResult(pool, idempotencyKey, requestHash, 200, successBody);
    return res.status(200).json(successBody);
  } catch (err) {
    return jsonError(res, 500, "onboarding_error", err?.message || "unknown");
  }
}
