import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

function getIndustryKey(req) {
  return String(req.query?.industryKey || "");
}

async function fetchSeedDefaults(pool, industryKey, defaultFaqs, defaultPrompts, options = {}) {
  const forcePrompt = options.forcePrompt === true;
  const inserted = { faqs: 0, prompt: 0 };
  const existingFaqs = await pool.query(
    `SELECT COUNT(*)::int AS count FROM industry_faqs WHERE industry_key = $1`,
    [industryKey]
  );
  const existingPrompt = await pool.query(
    `SELECT prompt FROM industry_prompts WHERE industry_key = $1`,
    [industryKey]
  );
  if ((existingFaqs.rows[0]?.count || 0) === 0) {
    const faqs = defaultFaqs[industryKey] || [];
    for (const faq of faqs) {
      await pool.query(
        `INSERT INTO industry_faqs (industry_key, question, answer, category)
         VALUES ($1, $2, $3, $4)`,
        [industryKey, faq.question, faq.answer, faq.category]
      );
    }
    inserted.faqs = faqs.length;
  }
  if ((forcePrompt || !existingPrompt.rowCount) && defaultPrompts[industryKey]) {
    await pool.query(
      `INSERT INTO industry_prompts (industry_key, prompt)
       VALUES ($1, $2)
       ON CONFLICT (industry_key)
       DO UPDATE SET prompt = EXCLUDED.prompt,
                     updated_at = NOW()`,
      [industryKey, defaultPrompts[industryKey]]
    );
    inserted.prompt = 1;
  }
  return inserted;
}

const DEFAULT_FAQS = {
  plumbing: [
    { question: "What should I do for a burst pipe?", answer: "Shut off the main water valve if it’s safe, then call us right away.", category: "Emergency" },
    { question: "Do you handle drain clogs and backups?", answer: "Yes. We clear clogs, inspect lines, and recommend next steps.", category: "Services" },
    { question: "Do you offer emergency plumbing?", answer: "Yes. We prioritize active leaks, flooding, and sewage issues.", category: "Emergency" }
  ],
  window_installers: [
    { question: "How long does window replacement take?", answer: "Once windows arrive, most homes are done in 1–2 days. Timing depends on the number of windows.", category: "Scheduling" },
    { question: "What is the typical lead time?", answer: "Standard windows often take a few weeks; custom windows can take longer. We confirm after measuring.", category: "Scheduling" },
    { question: "Do you replace glass only?", answer: "It depends on frame condition and window type; we confirm after an inspection.", category: "Services" }
  ],
  electrical: [
    { question: "What should I do if I smell burning or see sparks?", answer: "If safe, shut off power at the breaker and call for emergency service. If there are flames or heavy smoke, call 911 first.", category: "Emergency" },
    { question: "Do you upgrade electrical panels?", answer: "Yes. We inspect your panel and recommend upgrade options.", category: "Services" },
    { question: "Do you fix outlets and lighting issues?", answer: "Yes. We repair outlets, switches, and lighting circuits.", category: "Services" }
  ],
  hvac: [
    { question: "What should I do if I have no heat or no cooling?", answer: "Check the thermostat and filter first; if it’s still out, we can schedule priority service.", category: "Emergency" },
    { question: "How often should I change my air filter?", answer: "Most homes check monthly and replace about every 3 months; more often with pets or heavy use.", category: "Maintenance" },
    { question: "Do you offer maintenance plans?", answer: "Yes. We provide seasonal tune-ups and priority scheduling.", category: "Maintenance" }
  ],
  roofing: [
    { question: "Do you handle emergency leaks?", answer: "Yes. We can tarp and stabilize leaks quickly and schedule permanent repairs.", category: "Emergency" },
    { question: "Can you provide a temporary cover?", answer: "Yes. We can install temporary protection until full repairs are completed.", category: "Emergency" },
    { question: "Do you help with storm damage?", answer: "Yes. We inspect storm damage and provide documentation.", category: "Process" }
  ],
  landscaping: [
    { question: "How often do you mow?", answer: "Typically weekly during peak growing season; timing can vary by weather and grass type.", category: "Maintenance" },
    { question: "Do you offer seasonal cleanups?", answer: "Yes. We schedule spring/fall cleanups and ongoing maintenance.", category: "Maintenance" },
    { question: "Can you handle irrigation issues?", answer: "Yes. We diagnose and repair irrigation systems.", category: "Services" }
  ],
  cleaning: [
    { question: "Do you provide recurring cleanings?", answer: "Yes. We offer weekly, bi-weekly, and monthly plans.", category: "Maintenance" },
    { question: "Do you bring your own supplies?", answer: "Yes. We bring supplies and can use yours if requested.", category: "Services" },
    { question: "Are you pet friendly?", answer: "Yes. We use family- and pet-friendly products when possible.", category: "Process" }
  ],
  pest_control: [
    { question: "How should I prepare before treatment?", answer: "Remove or cover food, and keep pets and children away until treatment areas are dry.", category: "Preparation" },
    { question: "Do you offer one-time or recurring plans?", answer: "Yes. We offer one-time and maintenance plans based on the issue.", category: "Services" },
    { question: "How soon can you come out?", answer: "We prioritize urgent infestations and schedule as soon as possible.", category: "Scheduling" }
  ],
  garage_door: [
    { question: "Is it safe to use the door with a broken spring?", answer: "No. Broken springs are dangerous; avoid using the door and call us.", category: "Safety" },
    { question: "Do you repair broken springs?", answer: "Yes. We replace springs and tune up doors.", category: "Services" },
    { question: "Do you install or repair openers?", answer: "Yes. We repair and install new openers.", category: "Services" }
  ],
  general_contractor: [
    { question: "Do you handle permits?", answer: "Yes. We coordinate permits and required inspections for the project.", category: "Process" },
    { question: "Can you provide a project timeline?", answer: "Yes. We provide a timeline after scope review.", category: "Scheduling" },
    { question: "Do you do estimates?", answer: "Yes. We review scope and provide a detailed estimate.", category: "Pricing" }
  ],
  locksmith: [
    { question: "Do you offer emergency lockout service?", answer: "Yes. We provide emergency lockout service.", category: "Emergency" },
    { question: "What is the difference between rekeying and replacing?", answer: "Rekeying changes the key without replacing the lock; replacement is best for damaged or upgraded hardware.", category: "Services" },
    { question: "Can you rekey locks?", answer: "Yes. We rekey residential and commercial locks.", category: "Services" }
  ]
};

function buildIndustryPrompt({ companyName, helpType, proRole, technicalType }) {
  return `# ROLE
<role>
You are Sarah, the friendly receptionist at ${companyName}. You answer phone calls 24/7. A customer is calling because they need ${helpType} help. Your job is to collect their information so the team can follow up.
You are a receptionist, NOT a ${proRole}. Never ask technical questions. Just gather info and schedule a callback.
</role>

# CONVERSATION STYLE
<style>
- Warm, conversational, professional but casual
- Use periods, not exclamation points
- Match the caller's energy — calm for routine, urgent for emergencies
- Keep responses to one or two short sentences max
- Use the caller's first name only once or twice — not every turn
</style>

# EXAMPLES OF WHAT TO SAY AND NOT SAY
<examples>
- Avoid: "Is it actively leaking right now?" (when they already said it's leaking)
- Use: "Okay, that sounds urgent — let's get your info so we can send someone fast."

- Avoid: Spelling back both first AND last name
- Use: Only confirm first name spelling if ambiguous. Skip last name unless it sounds very unusual.

- Avoid: Asking a question the caller already answered
- Use: Acknowledge what they told you and move to the next thing you need

- Avoid: Ignoring a direct question from the caller
- Use: Always answer the caller's question before continuing your script

- Avoid: "Do you have any other questions?" then immediately launching into the closing
- Use: Ask, wait for their answer, THEN close

- Avoid: "Got it — this evening." [pause] "Hey John, just checking in — what time works?"
- Use: "Got it — this evening works. What time would you prefer?"

- Avoid: Reading back the full address in the closing when it was already confirmed earlier
- Use: Keep the closing brief — just reference the time and say someone will call to confirm

- Avoid: "Just checking in" or "just following up" language during the call
- Use: Ask your next question directly and naturally
</examples>

# SCRIPT FLOW
<script>
Follow this order, but skip anything the caller already provided:

1. Caller's name — confirm first name spelling only if it sounds ambiguous (Jon/John, Sean/Shawn, etc.)
2. Best callback number — read it back in groups: three digits... three digits... four digits
3. Urgency — ONLY ask if they haven't already indicated it. If they said "leaking" or "flooding," it's already urgent — just acknowledge it and move on.
4. Service address — read it back to confirm. Make sure the zip code is five digits. If you only caught four or fewer, ask for the full zip.
5. Preferred timing — when do they want someone to come out. If they say a general time like "this evening," ask what time works best in the same message.

IMPORTANT: If the caller already told you something (like their problem or that it's urgent), do NOT ask about it again. Just acknowledge it naturally and move to the next item you still need.
</script>

# KEY RULES
<rules>
- Send ONE message per turn. Never send two consecutive messages. This is critical — combine your acknowledgment and next question into a single response every time.
- Ask ONE question at a time. Wait for the answer before continuing.
- If you need to confirm something AND ask a new question, confirm first, wait for the response, then ask.
- ALWAYS answer the caller's questions — never skip or ignore them. If you don't know the answer, say "Great question — I'll make sure the technician covers that when they call."
- Never repeat back information that the caller already confirmed earlier in the call. Once something is confirmed, move on.
- Never use "checking in" or "just following up" language during the call — you are actively collecting info, not following up.
- NEVER mention websites, apps, or technology
- If asked "are you AI": "I'm Sarah, ${companyName}'s automated assistant." Then continue naturally.
- NEVER make up information
- NEVER ask technical ${technicalType} questions
</rules>

# EMERGENCIES
<emergencies>
If the caller mentions active leaking, flooding, no water, or gas smell — acknowledge with urgency but vary your wording:
- "That sounds urgent — let's get you taken care of right away."
- "Okay, we'll make this a priority."
- "Let me get your info so we can send someone fast."

Gas smell: "Please leave the home immediately and call 911 first. Once you're safe, call us back."
</emergencies>

# PRICING
<pricing>
If asked about cost: "Every job is a little different — the technician will give you an accurate quote on-site. We always get approval before doing any work."
</pricing>

# BEFORE CLOSING
<pre_close>
Once you've collected everything, ask: "Do you have any other questions, or anything else I can help with?"
Wait for their answer. If they ask something, answer it. Only move to closing after they say they're all set.
</pre_close>

# CLOSING
<closing>
Keep the closing SHORT. Do not re-read information that was already confirmed earlier in the call.

If a specific time was requested:
"I've got you penciled in for [time]. Someone from our team will call you at [callback number] to confirm the details. Thanks for calling ${companyName}, [name] — talk to you soon."

If no specific time:
"Someone from our team will call you back at [callback number] within 20 minutes. Thanks for calling ${companyName}, [name] — talk to you soon."
</closing>`;
}

const DEFAULT_PROMPTS = {
  plumbing: buildIndustryPrompt({
    companyName: "Bob's Plumbing",
    helpType: "plumbing",
    proRole: "plumber",
    technicalType: "plumbing"
  }),
  window_installers: buildIndustryPrompt({
    companyName: "Bob's Window Installers",
    helpType: "window installation",
    proRole: "window installer",
    technicalType: "window installation"
  }),
  electrical: buildIndustryPrompt({
    companyName: "Bob's Electrical",
    helpType: "electrical",
    proRole: "electrician",
    technicalType: "electrical"
  }),
  hvac: buildIndustryPrompt({
    companyName: "Bob's HVAC",
    helpType: "HVAC",
    proRole: "HVAC technician",
    technicalType: "HVAC"
  }),
  roofing: buildIndustryPrompt({
    companyName: "Bob's Roofing",
    helpType: "roofing",
    proRole: "roofer",
    technicalType: "roofing"
  }),
  landscaping: buildIndustryPrompt({
    companyName: "Bob's Landscaping",
    helpType: "landscaping",
    proRole: "landscaper",
    technicalType: "landscaping"
  }),
  cleaning: buildIndustryPrompt({
    companyName: "Bob's Cleaning",
    helpType: "cleaning",
    proRole: "cleaner",
    technicalType: "cleaning"
  }),
  pest_control: buildIndustryPrompt({
    companyName: "Bob's Pest Control",
    helpType: "pest control",
    proRole: "pest control technician",
    technicalType: "pest control"
  }),
  garage_door: buildIndustryPrompt({
    companyName: "Bob's Garage Door",
    helpType: "garage door",
    proRole: "garage door technician",
    technicalType: "garage door"
  }),
  general_contractor: buildIndustryPrompt({
    companyName: "Bob's General Contracting",
    helpType: "general contracting",
    proRole: "contractor",
    technicalType: "general contracting"
  }),
  locksmith: buildIndustryPrompt({
    companyName: "Bob's Locksmith",
    helpType: "locksmith",
    proRole: "locksmith",
    technicalType: "locksmith"
  })
};

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    const mode = String(req.query?.mode || "").toLowerCase();
    const industryKey = getIndustryKey(req);

    if (req.method === "GET") {
      if (mode === "prompt" && industryKey) {
        const row = await pool.query(
          `SELECT industry_key, prompt, updated_at
           FROM industry_prompts
           WHERE industry_key = $1`,
          [industryKey]
        );
        return res.status(200).json({ prompt: row.rows[0] || null });
      }

      if (mode === "faqs" && industryKey) {
        const rows = await pool.query(
          `SELECT id, question, answer, category
           FROM industry_faqs
           WHERE industry_key = $1
           ORDER BY id ASC`,
          [industryKey]
        );
        return res.status(200).json({ faqs: rows.rows });
      }

      const rows = await pool.query(
        `SELECT key, name, active
         FROM industries
         ORDER BY name ASC`
      );
      return res.status(200).json({ industries: rows.rows });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};

      if (mode === "industry") {
        const key = String(body.key || "").trim();
        const name = String(body.name || "").trim();
        const active = body.active !== false;
        if (!key || !name) {
          return res.status(400).json({ error: "missing_fields" });
        }
        await pool.query(
          `INSERT INTO industries (key, name, active)
           VALUES ($1, $2, $3)
           ON CONFLICT (key)
           DO UPDATE SET name = EXCLUDED.name,
                         active = EXCLUDED.active`,
          [key, name, active]
        );
        return res.status(200).json({ ok: true });
      }

      if (mode === "clone") {
        const sourceKey = String(body.sourceKey || "").trim();
        const targetKey = String(body.targetKey || "").trim();
        const replace = body.replace !== false;
        if (!sourceKey || !targetKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const sourceExists = await pool.query(`SELECT 1 FROM industries WHERE key = $1`, [sourceKey]);
        const targetExists = await pool.query(`SELECT 1 FROM industries WHERE key = $1`, [targetKey]);
        if (!sourceExists.rowCount || !targetExists.rowCount) {
          return res.status(404).json({ error: "industry_not_found" });
        }
        if (replace) {
          await pool.query(`DELETE FROM industry_faqs WHERE industry_key = $1`, [targetKey]);
          await pool.query(`DELETE FROM industry_prompts WHERE industry_key = $1`, [targetKey]);
        }
        await pool.query(
          `INSERT INTO industry_faqs (industry_key, question, answer, category)
           SELECT $1, question, answer, category
           FROM industry_faqs
           WHERE industry_key = $2`,
          [targetKey, sourceKey]
        );
        await pool.query(
          `INSERT INTO industry_prompts (industry_key, prompt)
           SELECT $1, prompt
           FROM industry_prompts
           WHERE industry_key = $2
           ON CONFLICT (industry_key)
           DO UPDATE SET prompt = EXCLUDED.prompt,
                         updated_at = NOW()`,
          [targetKey, sourceKey]
        );
        return res.status(200).json({ ok: true });
      }

      if (mode === "applyprompt") {
        if (!industryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const promptRow = await pool.query(
          `SELECT prompt FROM industry_prompts WHERE industry_key = $1`,
          [industryKey]
        );
        if (!promptRow.rowCount) {
          return res.status(404).json({ error: "missing_prompt" });
        }
        const prompt = promptRow.rows[0].prompt;
        const updated = await pool.query(
          `UPDATE agents
           SET tenant_prompt_override = $1,
               system_prompt = $1,
               updated_at = NOW()
           WHERE tenant_key IN (SELECT tenant_key FROM tenants WHERE industry = $2)
           RETURNING tenant_key, agent_name, company_name`,
          [prompt, industryKey]
        );
        if (updated.rowCount) {
          await pool.query(
            `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override)
             SELECT tenant_key, agent_name, company_name, $2, $2
             FROM agents
             WHERE tenant_key IN (SELECT tenant_key FROM tenants WHERE industry = $1)`,
            [industryKey, prompt]
          );
        }
        return res.status(200).json({ ok: true, updated: updated.rowCount });
      }

      if (mode === "applyfaqs") {
        if (!industryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const faqs = await pool.query(
          `SELECT question, answer, category
           FROM industry_faqs
           WHERE industry_key = $1
           ORDER BY id ASC`,
          [industryKey]
        );
        if (!faqs.rowCount) {
          return res.status(404).json({ error: "missing_faqs" });
        }
        const tenants = await pool.query(
          `SELECT tenant_key FROM tenants WHERE industry = $1`,
          [industryKey]
        );
        for (const tenant of tenants.rows) {
          await pool.query(
            `DELETE FROM faqs
             WHERE tenant_key = $1 AND is_industry_default = true AND industry = $2`,
            [tenant.tenant_key, industryKey]
          );
          for (const faq of faqs.rows) {
            await pool.query(
              `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_industry_default, industry)
               VALUES ($1, $2, $3, $4, true, true, $5)`,
              [tenant.tenant_key, faq.question, faq.answer, faq.category, industryKey]
            );
          }
        }
        return res.status(200).json({ ok: true, updated: tenants.rowCount });
      }

      if (mode === "seeddefaults") {
        const industryKey = String(body.industryKey || "").trim();
        if (!industryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const inserted = await fetchSeedDefaults(pool, industryKey, DEFAULT_FAQS, DEFAULT_PROMPTS);
        return res.status(200).json({ ok: true, inserted });
      }

      if (mode === "seedall") {
        const rows = await pool.query(`SELECT key FROM industries ORDER BY key ASC`);
        const summary = [];
        for (const row of rows.rows) {
          const resp = await fetchSeedDefaults(pool, row.key, DEFAULT_FAQS, DEFAULT_PROMPTS, {
            forcePrompt: true
          });
          summary.push({ industryKey: row.key, inserted: resp });
        }
        return res.status(200).json({ ok: true, count: rows.rowCount, summary });
      }

      if (mode === "prompt") {
        const prompt = String(body.prompt || "").trim();
        if (!industryKey || !prompt) {
          return res.status(400).json({ error: "missing_fields" });
        }
        await pool.query(
          `INSERT INTO industry_prompts (industry_key, prompt)
           VALUES ($1, $2)
           ON CONFLICT (industry_key)
           DO UPDATE SET prompt = EXCLUDED.prompt,
                         updated_at = NOW()`,
          [industryKey, prompt]
        );
        return res.status(200).json({ ok: true });
      }

      if (mode === "faqs") {
        const question = String(body.question || "").trim();
        const answer = String(body.answer || "").trim();
        const category = String(body.category || "General").trim() || "General";
        if (!industryKey || !question || !answer) {
          return res.status(400).json({ error: "missing_fields" });
        }
        await pool.query(
          `INSERT INTO industry_faqs (industry_key, question, answer, category)
           VALUES ($1, $2, $3, $4)`,
          [industryKey, question, answer, category]
        );
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "unsupported_mode" });
    }

    if (req.method === "DELETE") {
      if (mode === "faqs") {
        const id = Number(req.query?.id || 0);
        if (!id) {
          return res.status(400).json({ error: "missing_id" });
        }
        await pool.query(`DELETE FROM industry_faqs WHERE id = $1`, [id]);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "unsupported_mode" });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "admin_industries_error", message: err?.message || "unknown" });
  }
}
