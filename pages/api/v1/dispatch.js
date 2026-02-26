import { ensureTables, getPool } from "../_lib/db.js";
import { requireSession, resolveTenantKey } from "../_lib/auth.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

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
      const counts = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'new') AS new_count,
           COUNT(*) FILTER (WHERE status = 'assigned') AS assigned_count,
           COUNT(*) FILTER (WHERE status = 'closed') AS closed_count
         FROM dispatch_queue
         WHERE tenant_key = $1`,
        [tenantKey]
      );

      const items = await pool.query(
        `SELECT id, call_sid, caller_name, summary, due_at, assigned_to, status, updated_at
         FROM dispatch_queue
         WHERE tenant_key = $1
         ORDER BY due_at ASC NULLS LAST, updated_at DESC
         LIMIT 200`,
        [tenantKey]
      );

      return res.status(200).json({
        tenantKey,
        counts: {
          new: Number(counts.rows[0]?.new_count || 0),
          assigned: Number(counts.rows[0]?.assigned_count || 0),
          closed: Number(counts.rows[0]?.closed_count || 0)
        },
        items: items.rows
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      if (!body.id || !body.status) {
        return res.status(400).json({ error: "missing_fields" });
      }
      const assignedTo = body.assignedTo ? String(body.assignedTo) : null;
      const dueAt = body.dueAt ? new Date(body.dueAt) : null;
      await pool.query(
        `UPDATE dispatch_queue
         SET status = $2,
             assigned_to = $4,
             due_at = $5,
             updated_at = NOW()
         WHERE tenant_key = $1 AND id = $3`,
        [tenantKey, String(body.status), Number(body.id), assignedTo, dueAt]
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "dispatch_error", message: err?.message || "unknown" });
  }
}
