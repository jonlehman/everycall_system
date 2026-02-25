import { ensureTables, getPool, seedDemoData } from "../_lib/db.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "bobs_plumbing");
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    await seedDemoData(pool);

    const tenantKey = getTenantKey(req);

    if (req.method === "GET") {
      const counts = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'new') AS new_count,
           COUNT(*) FILTER (WHERE status = 'assigned') AS assigned_count,
           COUNT(*) FILTER (WHERE status = 'closed') AS closed_count
         FROM dispatch_queue
         WHERE tenant_key = $1`,
        [tenantKey]
      );

      return res.status(200).json({
        tenantKey,
        counts: {
          new: Number(counts.rows[0]?.new_count || 0),
          assigned: Number(counts.rows[0]?.assigned_count || 0),
          closed: Number(counts.rows[0]?.closed_count || 0)
        }
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      if (!body.id || !body.status) {
        return res.status(400).json({ error: "missing_fields" });
      }
      await pool.query(
        `UPDATE dispatch_queue SET status = $2, updated_at = NOW() WHERE tenant_key = $1 AND id = $3`,
        [tenantKey, String(body.status), Number(body.id)]
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "dispatch_error", message: err?.message || "unknown" });
  }
}
