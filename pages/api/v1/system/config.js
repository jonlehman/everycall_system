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
        `SELECT global_emergency_phrase,
                personality_prompt,
                datetime_prompt,
                numbers_symbols_prompt,
                confirmation_prompt,
                COALESCE(knowledge_usage_prompt, faq_usage_prompt) AS knowledge_usage_prompt,
                faq_usage_prompt,
                gateway_field_schema,
                gateway_tool_definitions,
                gateway_session_config,
                telnyx_sms_number,
                telnyx_sms_number_id,
                telnyx_sms_messaging_profile_id
         FROM system_config WHERE id = 1`
      );
      const config = row.rows[0] || null;
      return res.status(200).json({ config });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const phrase = String(body.globalEmergencyPhrase || "").trim();
      const personality = String(body.personalityPrompt || "").trim();
      const dateTime = String(body.dateTimePrompt || "").trim();
      const numbersSymbols = String(body.numbersSymbolsPrompt || "").trim();
      const confirmation = String(body.confirmationPrompt || "").trim();
      const knowledgeUsage = String(body.knowledgeUsagePrompt || body.faqUsagePrompt || "").trim();
      const parseJsonField = (value) => {
        if (!value) return null;
        if (typeof value === "object") return value;
        if (typeof value === "string") {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        }
        return null;
      };
      const gatewayFieldSchema = parseJsonField(body.gatewayFieldSchema);
      const gatewayToolDefinitions = parseJsonField(body.gatewayToolDefinitions);
      const gatewaySessionConfig = parseJsonField(body.gatewaySessionConfig);
      const telnyxSmsNumber = String(body.telnyxSmsNumber || "").trim();
      const telnyxSmsNumberId = String(body.telnyxSmsNumberId || "").trim();
      const telnyxSmsMessagingProfileId = String(body.telnyxSmsMessagingProfileId || "").trim();
      if (!phrase) {
        return res.status(400).json({ error: "missing_phrase" });
      }
      await pool.query(
        `INSERT INTO system_config (id, global_emergency_phrase, personality_prompt, datetime_prompt, numbers_symbols_prompt, confirmation_prompt, knowledge_usage_prompt, faq_usage_prompt, gateway_field_schema, gateway_tool_definitions, gateway_session_config, telnyx_sms_number, telnyx_sms_number_id, telnyx_sms_messaging_profile_id)
         VALUES (1, $1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id)
         DO UPDATE SET global_emergency_phrase = EXCLUDED.global_emergency_phrase,
                       personality_prompt = EXCLUDED.personality_prompt,
                       datetime_prompt = EXCLUDED.datetime_prompt,
                       numbers_symbols_prompt = EXCLUDED.numbers_symbols_prompt,
                       confirmation_prompt = EXCLUDED.confirmation_prompt,
                       knowledge_usage_prompt = EXCLUDED.knowledge_usage_prompt,
                       faq_usage_prompt = EXCLUDED.faq_usage_prompt,
                       gateway_field_schema = EXCLUDED.gateway_field_schema,
                       gateway_tool_definitions = EXCLUDED.gateway_tool_definitions,
                       gateway_session_config = EXCLUDED.gateway_session_config,
                       telnyx_sms_number = EXCLUDED.telnyx_sms_number,
                       telnyx_sms_number_id = EXCLUDED.telnyx_sms_number_id,
                       telnyx_sms_messaging_profile_id = EXCLUDED.telnyx_sms_messaging_profile_id,
                       updated_at = NOW()`,
        [
          phrase,
          personality,
          dateTime,
          numbersSymbols,
          confirmation,
          knowledgeUsage,
          gatewayFieldSchema,
          gatewayToolDefinitions,
          gatewaySessionConfig,
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
