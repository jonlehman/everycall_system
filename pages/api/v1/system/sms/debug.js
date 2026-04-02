import { ensureTables, getPool } from "../../../_lib/db.js";
import { requireSession } from "../../../_lib/auth.js";

function normalizeText(value) {
  return String(value || "").trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    const [configRow, healthRows, failoverRows, deliveryRows] = await Promise.all([
      pool.query(
        `SELECT telnyx_sms_number, telnyx_sms_number_id, telnyx_sms_messaging_profile_id
         FROM system_config
         WHERE id = 1`
      ),
      pool.query(
        `SELECT tenant_key, destination, status, last_attempted_at, last_succeeded_at,
                last_failed_at, last_error_code, last_error_message, updated_at
         FROM notification_channel_health
         WHERE channel = 'sms'
         ORDER BY updated_at DESC
         LIMIT 10`
      ),
      pool.query(
        `SELECT tenant_key, destination, provider_message_id, reason, created_at
         FROM sms_failover_events
         ORDER BY created_at DESC
         LIMIT 10`
      ),
      pool.query(
        `SELECT tenant_key, destination, status, provider_reference, last_error_code,
                last_error_message, attempted_at, delivered_at, updated_at
         FROM lead_notification_deliveries
         WHERE channel = 'sms'
         ORDER BY updated_at DESC
         LIMIT 10`
      )
    ]);

    return res.status(200).json({
      ok: true,
      config: configRow.rows[0] || null,
      runtime: {
        telnyxApiKeyConfigured: Boolean(process.env.TELNYX_API_KEY),
        telnyxPublicKeyConfigured: Boolean(normalizeText(process.env.TELNYX_PUBLIC_KEY))
      },
      recentHealth: healthRows.rows || [],
      recentFailovers: failoverRows.rows || [],
      recentDeliveries: deliveryRows.rows || []
    });
  } catch (err) {
    return res.status(500).json({ error: "system_sms_debug_error", message: err?.message || "unknown" });
  }
}
