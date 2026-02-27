import bcrypt from "bcryptjs";
import { ensureTables, getPool } from "../../_lib/db.js";
import { findAvailableVoiceNumber, orderVoiceNumber } from "../../_lib/telnyx.js";
import { normalizePhoneNumber } from "../../_lib/phone.js";

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
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const businessName = String(body.businessName || "").trim();
    const ownerName = String(body.ownerName || "").trim();
    const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();
    const industry = String(body.industry || "").trim();
    const password = String(body.password || "");

    if (!businessName || !ownerName || !ownerEmail || !industry || !password) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const industryRow = await pool.query(
      `SELECT key FROM industries WHERE key = $1 AND active = true`,
      [industry]
    );
    if (!industryRow.rowCount) {
      return res.status(400).json({ error: "invalid_industry" });
    }

    const emailExists = await pool.query(`SELECT 1 FROM tenant_users WHERE email = $1 LIMIT 1`, [ownerEmail]);
    if (emailExists.rowCount) {
      return res.status(409).json({ error: "email_exists" });
    }

    let tenantKey = String(body.tenantKey || "").trim();
    if (!tenantKey) {
      tenantKey = slugify(businessName) || `tenant_${Date.now()}`;
    }

    const existingTenant = await pool.query(`SELECT 1 FROM tenants WHERE tenant_key = $1`, [tenantKey]);
    if (existingTenant.rowCount) {
      return res.status(200).json({ ok: true, tenantKey, existing: true });
    }

    const status = String(body.status || "active");
    const dataRegion = String(body.dataRegion || "US");
    const plan = String(body.plan || "Trial");
    const primaryNumber = body.primaryNumber ? String(body.primaryNumber) : null;
    const serviceArea = String(body.serviceArea || "").trim();
    const address = String(body.address || "").trim();
    const timezone = String(body.timezone || "America/Los_Angeles");
    const businessHours = String(body.businessHours || "").trim();
    const averageCallsPerDay = body.averageCallsPerDay ? Number(body.averageCallsPerDay) : null;
    const emergencyServices = Boolean(body.emergencyServices);
    const servicesOffered = String(body.servicesOffered || "").trim();
    const primaryGoal = String(body.primaryGoal || "").trim();

    await pool.query(
      `INSERT INTO tenants (tenant_key, name, status, data_region, plan, primary_number, industry)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantKey, businessName, status, dataRegion, plan, primaryNumber, industry]
    );

    // Auto-provision a local voice number via Telnyx.
    let voiceNumber = null;
    let voiceOrder = null;
    try {
      const normalizedPrimary = normalizePhoneNumber(primaryNumber);
      const digits = String(normalizedPrimary || "").replace(/[^\d]/g, "");
      const areaCode = digits.length >= 10 ? digits.slice(-10, -7) : null;
      voiceNumber = await findAvailableVoiceNumber({ areaCode });
      if (!voiceNumber) {
        voiceNumber = await findAvailableVoiceNumber();
      }
      if (voiceNumber) {
        const connectionId = process.env.TELNYX_VOICE_CONNECTION_ID || "";
        voiceOrder = await orderVoiceNumber({ phoneNumber: voiceNumber, connectionId });
        await pool.query(
          `UPDATE tenants
           SET telnyx_voice_number = $2,
               telnyx_voice_order_id = $3,
               telnyx_voice_status = 'active',
               updated_at = NOW()
           WHERE tenant_key = $1`,
          [tenantKey, voiceNumber, voiceOrder?.data?.id || null]
        );
      } else {
        await pool.query(
          `UPDATE tenants
           SET telnyx_voice_status = 'unavailable',
               updated_at = NOW()
           WHERE tenant_key = $1`,
          [tenantKey]
        );
      }
    } catch (err) {
      await pool.query(
        `UPDATE tenants
         SET telnyx_voice_status = 'failed',
             updated_at = NOW()
         WHERE tenant_key = $1`,
        [tenantKey]
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO tenant_users (tenant_key, name, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'owner', 'active')`,
      [tenantKey, ownerName, ownerEmail, passwordHash]
    );

    await pool.query(
      `INSERT INTO onboarding_intake (tenant_key, owner_name, owner_email, phone, service_area, address, timezone, business_hours, average_calls_per_day, emergency_services, services_offered, primary_goal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [tenantKey, ownerName, ownerEmail, body.phone || null, serviceArea, address, timezone, businessHours, averageCallsPerDay, emergencyServices, servicesOffered, primaryGoal]
    );

    await pool.query(
      `INSERT INTO routing_rules (tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        tenantKey,
        "Dispatch Team",
        emergencyServices ? "Priority Queue" : "Standard Queue",
        "Collect details and dispatch callback",
        businessHours || "Weekdays 8:00 AM - 6:00 PM"
      ]
    );

    await pool.query(
      `INSERT INTO tenant_settings (tenant_key, timezone, notes)
       VALUES ($1, $2, $3)`,
      [tenantKey, timezone, primaryGoal || null]
    );

    let prompt = buildPrompt({
      businessName,
      industry,
      serviceArea,
      businessHours,
      emergency: emergencyServices
    });

    await pool.query(
      `INSERT INTO agents (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override)
       VALUES ($1, 'Alex', $2, $3, $4)`,
      [tenantKey, businessName, prompt, prompt]
    );

    await pool.query(
      `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override)
       VALUES ($1, 'Alex', $2, $3, $4)`,
      [tenantKey, businessName, prompt, prompt]
    );

    for (const faq of BASE_FAQS) {
      await pool.query(
        `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_default)
         VALUES ($1, $2, $3, $4, false, true)`,
        [tenantKey, faq.question, faq.answer, faq.category]
      );
    }

    let industryFaqs = [];
    const industryFaqRows = await pool.query(
      `SELECT question, answer, category FROM industry_faqs WHERE industry_key = $1 ORDER BY id ASC`,
      [industry]
    );
    if (industryFaqRows.rowCount) {
      industryFaqs = industryFaqRows.rows;
    } else {
      industryFaqs = INDUSTRY_FAQS[industry] || [];
    }
    for (const faq of industryFaqs) {
      await pool.query(
        `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_industry_default, industry)
         VALUES ($1, $2, $3, $4, true, true, $5)`,
        [tenantKey, faq.question, faq.answer, faq.category, industry]
      );
    }

    await pool.query(
      `INSERT INTO provisioning_jobs (tenant_key, stage, status, updated_at)
       VALUES ($1, 'workflow_seed', 'running', NOW()),
              ($1, 'number_setup', 'pending', NOW())`,
      [tenantKey]
    );

    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, 'system', 'onboarding.completed', $2)`,
      [tenantKey, `industry=${industry} owner=${ownerEmail}`]
    );

    return res.status(200).json({ ok: true, tenantKey });
  } catch (err) {
    return res.status(500).json({ error: "onboarding_error", message: err?.message || "unknown" });
  }
}
