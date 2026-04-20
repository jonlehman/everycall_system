import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";
import {
  DEFAULT_BILLING_PLANS,
  DEFAULT_TRIAL_DAYS,
  normalizeBillingPlanCatalogBindings,
  normalizeBillingPlans
} from "../../_lib/billing.js";

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
        `SELECT global_emergency_phrase, default_trial_days, billing_plans_json,
                telnyx_sms_number, telnyx_sms_number_id, telnyx_sms_messaging_profile_id
         FROM system_config
         WHERE id = 1`
      );
      const config = row.rows[0] || null;
      return res.status(200).json({
        config: config
          ? {
              ...config,
              default_trial_days: Number(config.default_trial_days || DEFAULT_TRIAL_DAYS),
              billing_plans_json: normalizeBillingPlans(config.billing_plans_json)
            }
          : {
              global_emergency_phrase: "",
              default_trial_days: DEFAULT_TRIAL_DAYS,
              billing_plans_json: normalizeBillingPlans(DEFAULT_BILLING_PLANS),
              telnyx_sms_number: "",
              telnyx_sms_number_id: "",
              telnyx_sms_messaging_profile_id: ""
            }
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const phrase = String(body.globalEmergencyPhrase || "").trim();
      const defaultTrialDays = Number(body.defaultTrialDays || DEFAULT_TRIAL_DAYS);
      const billingPlans = normalizeBillingPlanCatalogBindings(body.billingPlans || DEFAULT_BILLING_PLANS);
      const telnyxSmsNumber = String(body.telnyxSmsNumber || "").trim();
      const telnyxSmsNumberId = String(body.telnyxSmsNumberId || "").trim();
      const telnyxSmsMessagingProfileId = String(body.telnyxSmsMessagingProfileId || "").trim();
      if (!phrase) {
        return res.status(400).json({ error: "missing_phrase" });
      }
      if (!Number.isInteger(defaultTrialDays) || defaultTrialDays < 1 || defaultTrialDays > 365) {
        return res.status(400).json({ error: "invalid_default_trial_days" });
      }

      await pool.query(
        `INSERT INTO system_config (
           id, global_emergency_phrase, default_trial_days, billing_plans_json,
           telnyx_sms_number, telnyx_sms_number_id, telnyx_sms_messaging_profile_id
         )
         VALUES (1, $1, $2, $3::jsonb, $4, $5, $6)
         ON CONFLICT (id)
         DO UPDATE SET global_emergency_phrase = EXCLUDED.global_emergency_phrase,
                       default_trial_days = EXCLUDED.default_trial_days,
                       billing_plans_json = EXCLUDED.billing_plans_json,
                       telnyx_sms_number = EXCLUDED.telnyx_sms_number,
                       telnyx_sms_number_id = EXCLUDED.telnyx_sms_number_id,
                       telnyx_sms_messaging_profile_id = EXCLUDED.telnyx_sms_messaging_profile_id,
                       updated_at = NOW()`,
        [
          phrase,
          defaultTrialDays,
          JSON.stringify(billingPlans),
          telnyxSmsNumber,
          telnyxSmsNumberId,
          telnyxSmsMessagingProfileId
        ]
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "system_config_error", message: err?.message || "unknown" });
  }
}
