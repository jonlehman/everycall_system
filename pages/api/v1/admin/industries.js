import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";
import {
  applyIndustryKnowledgeToTenant,
  loadIndustryKnowledgeDefaults,
  saveIndustryKnowledgeDefaults,
  seedIndustryKnowledgeDefaults
} from "../../_lib/industryKnowledge.js";

function getIndustryKey(req) {
  return String(req.query?.industryKey || "");
}

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
- Keep a steady, warm, lightly playful tone; do not sound like an announcer
- Keep responses to one or two short sentences max
- Use contractions and natural phrasing
- Use the caller's first name only once or twice — not every turn
- Avoid step-by-step or interview-like phrasing (no "let's start with" or "next")
</style>

# SCRIPT FLOW
<script>
Follow this order, but skip anything the caller already provided:
1. Caller's name — confirm first name spelling only if it sounds ambiguous
2. Best callback number — read it back in groups: three digits... three digits... four digits
3. Urgency — only ask if they haven't already indicated it
4. Service address — read it back to confirm
5. Preferred timing — if they say a general time like "this evening," ask what time works best
</script>

# KEY RULES
<rules>
- Send ONE message per turn
- Ask ONE question at a time
- ALWAYS answer the caller's questions before continuing
- Never repeat back information that the caller already confirmed
- Never use "checking in" or "just following up" language during the call
- Keep the flow conversational, not like a checklist
- NEVER mention websites, apps, or technology
- If asked "are you AI": "I'm Sarah, ${companyName}'s automated assistant."
- NEVER make up information
- NEVER ask technical ${technicalType} questions
</rules>

# EMERGENCIES
<emergencies>
If the caller mentions something urgent, acknowledge it warmly and prioritize the request.
Gas smell: "Please leave the home immediately and call 911 first. Once you're safe, call us back."
</emergencies>

# PRICING
<pricing>
If asked about cost: "Every job is a little different — the technician will give you an accurate quote after reviewing the situation."
</pricing>

# BEFORE CLOSING
<pre_close>
Once you've collected everything, ask: "Do you have any other questions, or anything else I can help with?"
Wait for their answer before closing.
</pre_close>

# CLOSING
<closing>
Keep the closing short. Do not re-read information that was already confirmed earlier.
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

async function seedIndustryDefaults(db, industryKey, options = {}) {
  const force = options.force === true;
  const inserted = {
    knowledgeEntries: 0,
    guardrailQuestionTests: 0,
    prompt: 0
  };

  const knowledgeInserted = await seedIndustryKnowledgeDefaults(db, industryKey, { force });
  inserted.knowledgeEntries = knowledgeInserted.knowledgeEntries;
  inserted.guardrailQuestionTests = knowledgeInserted.guardrailQuestionTests;

  const existingPrompt = await db.query(
    `SELECT prompt
     FROM industry_prompts
     WHERE industry_key = $1`,
    [industryKey]
  );
  if ((force || !existingPrompt.rowCount) && DEFAULT_PROMPTS[industryKey]) {
    await db.query(
      `INSERT INTO industry_prompts (industry_key, prompt)
       VALUES ($1, $2)
       ON CONFLICT (industry_key)
       DO UPDATE SET prompt = EXCLUDED.prompt,
                     updated_at = NOW()`,
      [industryKey, DEFAULT_PROMPTS[industryKey]]
    );
    inserted.prompt = 1;
  }

  return inserted;
}

async function cloneIndustryConfig(db, sourceKey, targetKey, replace = true) {
  const knowledge = await loadIndustryKnowledgeDefaults(db, sourceKey);
  const promptRow = await db.query(
    `SELECT prompt
     FROM industry_prompts
     WHERE industry_key = $1`,
    [sourceKey]
  );

  if (replace) {
    await db.query(`DELETE FROM industry_knowledge_entries WHERE industry_key = $1`, [targetKey]);
    await db.query(`DELETE FROM industry_guardrail_question_templates WHERE industry_key = $1`, [targetKey]);
    await db.query(`DELETE FROM industry_prompts WHERE industry_key = $1`, [targetKey]);
  }

  await saveIndustryKnowledgeDefaults(db, targetKey, knowledge.knowledgeEntries, knowledge.guardrailQuestionTests);
  if (promptRow.rowCount) {
    await db.query(
      `INSERT INTO industry_prompts (industry_key, prompt)
       VALUES ($1, $2)
       ON CONFLICT (industry_key)
       DO UPDATE SET prompt = EXCLUDED.prompt,
                     updated_at = NOW()`,
      [targetKey, promptRow.rows[0].prompt]
    );
  }
}

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

      if (mode === "knowledge" && industryKey) {
        const knowledge = await loadIndustryKnowledgeDefaults(pool, industryKey);
        return res.status(200).json({
          knowledgeEntries: knowledge.knowledgeEntries,
          guardrailQuestionTests: knowledge.guardrailQuestionTests
        });
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
        const [sourceExists, targetExists] = await Promise.all([
          pool.query(`SELECT 1 FROM industries WHERE key = $1`, [sourceKey]),
          pool.query(`SELECT 1 FROM industries WHERE key = $1`, [targetKey])
        ]);
        if (!sourceExists.rowCount || !targetExists.rowCount) {
          return res.status(404).json({ error: "industry_not_found" });
        }
        await cloneIndustryConfig(pool, sourceKey, targetKey, replace);
        return res.status(200).json({ ok: true });
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

      if (mode === "knowledge") {
        if (!industryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        await saveIndustryKnowledgeDefaults(
          pool,
          industryKey,
          Array.isArray(body.knowledgeEntries) ? body.knowledgeEntries : [],
          Array.isArray(body.guardrailQuestionTests) ? body.guardrailQuestionTests : []
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
           RETURNING tenant_key`,
          [prompt, industryKey]
        );
        if (updated.rowCount) {
          await pool.query(
            `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override, greeting_text, voice_type)
             SELECT tenant_key, agent_name, company_name, $2, $2, greeting_text, voice_type
             FROM agents
             WHERE tenant_key IN (SELECT tenant_key FROM tenants WHERE industry = $1)`,
            [industryKey, prompt]
          );
        }
        return res.status(200).json({ ok: true, updated: updated.rowCount });
      }

      if (mode === "importprompt") {
        const targetTenant = String(body.tenantKey || "").trim();
        if (!industryKey || !targetTenant) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const promptRow = await pool.query(
          `SELECT prompt FROM industry_prompts WHERE industry_key = $1`,
          [industryKey]
        );
        if (!promptRow.rowCount) {
          return res.status(404).json({ error: "missing_prompt" });
        }
        const updated = await pool.query(
          `UPDATE agents
           SET tenant_prompt_override = $1,
               system_prompt = $1,
               updated_at = NOW()
           WHERE tenant_key = $2
           RETURNING tenant_key`,
          [promptRow.rows[0].prompt, targetTenant]
        );
        if (updated.rowCount) {
          await pool.query(
            `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override, greeting_text, voice_type)
             SELECT tenant_key, agent_name, company_name, $2, $2, greeting_text, voice_type
             FROM agents
             WHERE tenant_key = $1`,
            [targetTenant, promptRow.rows[0].prompt]
          );
        }
        return res.status(200).json({ ok: true, updated: updated.rowCount || 0 });
      }

      if (mode === "applyknowledge") {
        if (!industryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const tenants = await pool.query(
          `SELECT tenant_key
           FROM tenants
           WHERE industry = $1`,
          [industryKey]
        );
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const tenant of tenants.rows) {
            await applyIndustryKnowledgeToTenant(client, tenant.tenant_key, industryKey);
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
        return res.status(200).json({ ok: true, updated: tenants.rowCount });
      }

      if (mode === "importknowledge") {
        const targetTenant = String(body.tenantKey || "").trim();
        if (!industryKey || !targetTenant) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await applyIndustryKnowledgeToTenant(client, targetTenant, industryKey);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
        return res.status(200).json({ ok: true, updated: 1 });
      }

      if (mode === "seeddefaults") {
        const targetIndustryKey = String(body.industryKey || "").trim();
        if (!targetIndustryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const inserted = await seedIndustryDefaults(pool, targetIndustryKey);
        return res.status(200).json({ ok: true, inserted });
      }

      if (mode === "seedall") {
        const rows = await pool.query(`SELECT key FROM industries ORDER BY key ASC`);
        const summary = [];
        for (const row of rows.rows) {
          const inserted = await seedIndustryDefaults(pool, row.key, { force: true });
          summary.push({ industryKey: row.key, inserted });
        }
        return res.status(200).json({ ok: true, count: rows.rowCount, summary });
      }

      return res.status(400).json({ error: "unsupported_mode" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "admin_industries_error", message: err?.message || "unknown" });
  }
}
