import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

function getIndustryKey(req) {
  return String(req.query?.industryKey || "");
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
           SET system_prompt = $1,
               updated_at = NOW()
           WHERE tenant_key IN (SELECT tenant_key FROM tenants WHERE industry = $2)
           RETURNING tenant_key, agent_name, company_name`,
          [prompt, industryKey]
        );
        if (updated.rowCount) {
          await pool.query(
            `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt)
             SELECT tenant_key, agent_name, company_name, $2
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
        const existing = await pool.query(
          `SELECT COUNT(*)::int AS count FROM industry_faqs WHERE industry_key = $1`,
          [industryKey]
        );
        if ((existing.rows[0]?.count || 0) > 0) {
          return res.status(200).json({ ok: true, skipped: true });
        }

        const DEFAULTS = {
          plumbing: [
            { question: "What should I do for a burst pipe?", answer: "Shut off the main water valve if safe, then call us immediately.", category: "Emergency" },
            { question: "Do you handle drain clogs and backups?", answer: "Yes. We clear clogs, inspect lines, and recommend next steps.", category: "Services" }
          ],
          window_installers: [
            { question: "Do you replace broken glass or only full windows?", answer: "We can assess glass-only replacement vs full units.", category: "Services" },
            { question: "What is the typical lead time for installation?", answer: "Lead time varies by product and scope; we confirm after measuring.", category: "Scheduling" }
          ],
          electrical: [
            { question: "What should I do if I smell burning or see sparks?", answer: "Turn off power at the breaker if safe and call us immediately.", category: "Emergency" },
            { question: "Do you upgrade electrical panels?", answer: "Yes. We inspect your panel and provide upgrade options.", category: "Services" }
          ],
          hvac: [
            { question: "What should I do if I have no heat or no cooling?", answer: "Check thermostat and breaker; if still out, call us for priority service.", category: "Emergency" },
            { question: "Do you offer maintenance plans?", answer: "Yes. We provide seasonal tune-ups and priority scheduling.", category: "Maintenance" }
          ],
          roofing: [
            { question: "Do you handle emergency leaks?", answer: "Yes. We can tarp and stabilize leaks quickly.", category: "Emergency" },
            { question: "Do you work with insurance claims?", answer: "Yes. We can document damage and provide estimates.", category: "Billing" }
          ],
          landscaping: [
            { question: "Do you offer recurring maintenance?", answer: "Yes. We offer weekly or bi-weekly maintenance plans.", category: "Maintenance" },
            { question: "Can you handle irrigation issues?", answer: "Yes. We can diagnose and repair irrigation systems.", category: "Services" }
          ],
          cleaning: [
            { question: "Do you provide recurring cleanings?", answer: "Yes. We offer weekly, bi-weekly, and monthly plans.", category: "Maintenance" },
            { question: "Do you bring your own supplies?", answer: "Yes. We bring standard supplies unless requested otherwise.", category: "Services" }
          ],
          pest_control: [
            { question: "Do you offer one-time treatments?", answer: "Yes. We offer one-time and recurring plans.", category: "Services" },
            { question: "How soon can you come out for an infestation?", answer: "We can often schedule within 24-48 hours.", category: "Scheduling" }
          ],
          garage_door: [
            { question: "Do you repair broken springs?", answer: "Yes. We can replace springs and tune up doors.", category: "Services" },
            { question: "Do you install new openers?", answer: "Yes. We install and configure new openers.", category: "Services" }
          ],
          general_contractor: [
            { question: "Do you handle permits?", answer: "Yes. We can manage permits and inspections.", category: "Process" },
            { question: "Can you provide a project timeline?", answer: "Yes. We provide a timeline after scope review.", category: "Scheduling" }
          ],
          locksmith: [
            { question: "Do you offer emergency lockout service?", answer: "Yes. We provide emergency lockout service.", category: "Emergency" },
            { question: "Can you rekey locks?", answer: "Yes. We rekey residential and commercial locks.", category: "Services" }
          ]
        };

        const faqs = DEFAULTS[industryKey] || [];
        for (const faq of faqs) {
          await pool.query(
            `INSERT INTO industry_faqs (industry_key, question, answer, category)
             VALUES ($1, $2, $3, $4)`,
            [industryKey, faq.question, faq.answer, faq.category]
          );
        }
        return res.status(200).json({ ok: true, inserted: faqs.length });
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
