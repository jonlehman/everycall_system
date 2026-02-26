import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

function getIndustryKey(req) {
  return String(req.query?.industryKey || "");
}

async function fetchSeedDefaults(pool, industryKey, defaultFaqs, defaultPrompts) {
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
  if (!existingPrompt.rowCount && defaultPrompts[industryKey]) {
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

const DEFAULT_PROMPTS = {
  plumbing: `# INDUSTRY CONTEXT\nYou represent a plumbing service. Focus on leaks, clogs, water heaters, fixtures, and emergency shutoff guidance.\n\n# SERVICES TO LIST IF ASKED\n- Leak detection and repair\n- Drain cleaning and backups\n- Water heater repair or replacement\n- Fixture repair/installation (faucets, toilets)\n- Emergency response for active leaks\n\n# EMERGENCY CUES\nBurst pipe, active flooding, sewage backup, gas smell. Prioritize and collect address + callback quickly.`,
  electrical: `# INDUSTRY CONTEXT\nYou represent an electrical service. Focus on safety, outages, panel issues, and scheduling a licensed electrician.\n\n# SERVICES TO LIST IF ASKED\n- Panel upgrades\n- Outlet/switch repairs\n- Lighting and wiring\n- Troubleshooting outages\n- EV charger installs\n\n# EMERGENCY CUES\nSparks, burning smell, hot outlets/panels, loss of power. If there is flame or heavy smoke, advise 911 first.`,
  hvac: `# INDUSTRY CONTEXT\nYou represent HVAC service for heating and cooling. Emphasize diagnostics, maintenance, and system reliability.\n\n# SERVICES TO LIST IF ASKED\n- No heat/no cool troubleshooting\n- System repair and replacement\n- Seasonal maintenance\n- Thermostat and airflow issues\n- Filter and efficiency guidance\n\n# EMERGENCY CUES\nNo heat in extreme cold, no cooling in extreme heat, unusual smells or smoke. Prioritize service.`,
  roofing: `# INDUSTRY CONTEXT\nYou represent a roofing contractor. Focus on leak protection, inspection, repairs, and replacements.\n\n# SERVICES TO LIST IF ASKED\n- Leak repair and roof inspection\n- Storm damage assessments\n- Replacement estimates\n- Temporary protection (tarping)\n\n# EMERGENCY CUES\nActive leak or storm damage. Schedule inspection and advise temporary protection.`,
  landscaping: `# INDUSTRY CONTEXT\nYou represent a landscaping service. Focus on maintenance, cleanups, and seasonal scheduling.\n\n# SERVICES TO LIST IF ASKED\n- Mowing and lawn maintenance\n- Seasonal cleanups\n- Irrigation troubleshooting\n- Pruning and bed maintenance\n\n# SCHEDULING\nExplain that mowing frequency varies by season and growth rates.`,
  cleaning: `# INDUSTRY CONTEXT\nYou represent a cleaning service. Focus on recurring schedules, deep cleans, and what’s included.\n\n# SERVICES TO LIST IF ASKED\n- Standard recurring cleanings\n- Deep cleans and move-out cleans\n- Supply preferences and access notes\n\n# IMPORTANT\nConfirm home size, frequency, and access instructions. Avoid quoting exact prices.`,
  pest_control: `# INDUSTRY CONTEXT\nYou represent pest control. Focus on safety, treatment cadence, and preparation.\n\n# SERVICES TO LIST IF ASKED\n- Treatment for common pests (ants, rodents, roaches)\n- Preventive maintenance plans\n- Guidance for pets and prep\n\n# PREP\nRemind customers to remove/cover food and keep pets away until treatment areas are dry.`,
  garage_door: `# INDUSTRY CONTEXT\nYou represent garage door repair. Focus on safety, springs, openers, and alignment issues.\n\n# SERVICES TO LIST IF ASKED\n- Broken spring replacement\n- Opener troubleshooting\n- Off-track or uneven door repair\n- Annual maintenance/tune-ups\n\n# EMERGENCY CUES\nDoor stuck open, broken spring, or door falling risk. Advise not to operate the door.`,
  general_contractor: `# INDUSTRY CONTEXT\nYou represent a general contractor for remodels and renovations. Focus on scope, permits, and timelines.\n\n# SERVICES TO LIST IF ASKED\n- Remodels and additions\n- Kitchen/bath renovations\n- Permit coordination\n- Project timeline planning\n\n# IMPORTANT\nCollect project scope, address, and best contact for estimates.`,
  locksmith: `# INDUSTRY CONTEXT\nYou represent a locksmith. Focus on lockouts, rekeying, and security upgrades.\n\n# SERVICES TO LIST IF ASKED\n- Emergency lockouts\n- Rekeying and lock replacement\n- Key duplication\n- Smart lock installs\n\n# EMERGENCY CUES\nLocked out, broken key in lock, unsafe entry. Prioritize quick dispatch.`,
  window_installers: `# INDUSTRY CONTEXT\nYou represent a window replacement service. Focus on measurements, timelines, and installation types.\n\n# SERVICES TO LIST IF ASKED\n- Window replacement and glass options\n- Install timelines and scheduling\n- Warranty questions\n\n# IMPORTANT\nLead times vary; standard windows often take several weeks, custom windows longer.`
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
          const resp = await fetchSeedDefaults(pool, row.key, DEFAULT_FAQS, DEFAULT_PROMPTS);
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
