import { ensureTables, getPool } from "../../_lib/db.js";

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
