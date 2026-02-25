import { ensureTables, getPool, seedDemoData } from "../../_lib/db.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    await seedDemoData(pool);

    if (req.method === "GET") {
      const row = await pool.query(`SELECT global_emergency_phrase FROM system_config WHERE id = 1`);
      return res.status(200).json({ config: row.rows[0] || null });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const phrase = String(body.globalEmergencyPhrase || "").trim();
      if (!phrase) {
        return res.status(400).json({ error: "missing_phrase" });
      }
      await pool.query(
        `INSERT INTO system_config (id, global_emergency_phrase)
         VALUES (1, $1)
         ON CONFLICT (id)
         DO UPDATE SET global_emergency_phrase = EXCLUDED.global_emergency_phrase,
                       updated_at = NOW()`,
        [phrase]
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "system_config_error", message: err?.message || "unknown" });
  }
}
