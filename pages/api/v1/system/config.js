import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    if (req.method === "GET") {
      const row = await pool.query(
        `SELECT global_emergency_phrase, telnyx_sms_number, telnyx_sms_number_id, telnyx_sms_messaging_profile_id
         FROM system_config
         WHERE id = 1`
      );
      return res.status(200).json({ config: row.rows[0] || null });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const phrase = String(body.globalEmergencyPhrase || "").trim();
      const telnyxSmsNumber = String(body.telnyxSmsNumber || "").trim();
      const telnyxSmsNumberId = String(body.telnyxSmsNumberId || "").trim();
      const telnyxSmsMessagingProfileId = String(body.telnyxSmsMessagingProfileId || "").trim();
      if (!phrase) {
        return res.status(400).json({ error: "missing_phrase" });
      }

      await pool.query(
        `INSERT INTO system_config (
           id, global_emergency_phrase, telnyx_sms_number, telnyx_sms_number_id, telnyx_sms_messaging_profile_id
         )
         VALUES (1, $1, $2, $3, $4)
         ON CONFLICT (id)
         DO UPDATE SET global_emergency_phrase = EXCLUDED.global_emergency_phrase,
                       telnyx_sms_number = EXCLUDED.telnyx_sms_number,
                       telnyx_sms_number_id = EXCLUDED.telnyx_sms_number_id,
                       telnyx_sms_messaging_profile_id = EXCLUDED.telnyx_sms_messaging_profile_id,
                       updated_at = NOW()`,
        [phrase, telnyxSmsNumber, telnyxSmsNumberId, telnyxSmsMessagingProfileId]
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "system_config_error", message: err?.message || "unknown" });
  }
}
