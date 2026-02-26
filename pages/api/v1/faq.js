import { ensureTables, getPool } from "../_lib/db.js";
import { requireSession, resolveTenantKey } from "../_lib/auth.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

const INDUSTRY_FAQS = {
  plumber: [
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
  electrician: [
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
  general: []
};

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, getTenantKey(req));

    if (req.method === "GET") {
      const rows = await pool.query(
        `SELECT id, question, answer, category, deletable, is_default, is_industry_default, industry, updated_at
         FROM faqs
         WHERE tenant_key = $1
         ORDER BY id ASC`,
        [tenantKey]
      );
      return res.status(200).json({ faqs: rows.rows });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      if (body.action === "seedIndustry") {
        const industry = String(body.industry || "general");
        const items = INDUSTRY_FAQS[industry] || [];
        if (!items.length) {
          return res.status(200).json({ ok: true, added: 0 });
        }

        let added = 0;
        for (const item of items) {
          const exists = await pool.query(
            `SELECT 1 FROM faqs WHERE tenant_key = $1 AND question = $2 LIMIT 1`,
            [tenantKey, item.question]
          );
          if (exists.rowCount) {
            continue;
          }
          await pool.query(
            `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_industry_default, industry)
             VALUES ($1, $2, $3, $4, true, true, $5)`,
            [tenantKey, item.question, item.answer, item.category, industry]
          );
          added += 1;
        }

        return res.status(200).json({ ok: true, added });
      }

      const question = String(body.question || "").trim();
      const answer = String(body.answer || "").trim();
      if (!question || !answer) {
        return res.status(400).json({ error: "missing_fields" });
      }

      const category = String(body.category || "General").trim();
      const id = body.id ? Number(body.id) : null;

      if (id) {
        await pool.query(
          `UPDATE faqs
           SET question = $3, answer = $4, category = $5, updated_at = NOW()
           WHERE tenant_key = $1 AND id = $2`,
          [tenantKey, id, question, answer, category]
        );
        return res.status(200).json({ ok: true, id });
      }

      const inserted = await pool.query(
        `INSERT INTO faqs (tenant_key, question, answer, category, deletable)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [tenantKey, question, answer, category]
      );

      return res.status(200).json({ ok: true, id: inserted.rows[0]?.id });
    }

    if (req.method === "DELETE") {
      const id = Number(req.query?.id);
      if (!id) {
        return res.status(400).json({ error: "missing_id" });
      }
      const row = await pool.query(
        `SELECT deletable FROM faqs WHERE tenant_key = $1 AND id = $2`,
        [tenantKey, id]
      );
      if (!row.rowCount || !row.rows[0].deletable) {
        return res.status(403).json({ error: "not_deletable" });
      }
      await pool.query(`DELETE FROM faqs WHERE tenant_key = $1 AND id = $2`, [tenantKey, id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "faq_error", message: err?.message || "unknown" });
  }
}
