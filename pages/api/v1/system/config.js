import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

const DEFAULT_FIELD_SCHEMA = {
  type: "object",
  properties: {
    first_name: { type: "string" },
    last_name: { type: "string" },
    callback_number: { type: "string" },
    address_line1: { type: "string" },
    address_line2: { type: "string" },
    city: { type: "string" },
    state: { type: "string" },
    postal_code: { type: "string" },
    service_request: { type: "string" },
    urgency_level: { type: "string" },
    requested_date: { type: "string" },
    requested_time: { type: "string" }
  },
  required: ["first_name", "callback_number", "service_request"]
};

function buildDefaultToolDefinitions(fieldSchema) {
  return [
    {
      type: "function",
      name: "knowledge_lookup",
      description: "Retrieve tenant knowledge relevant to the caller's question.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Caller question or topic" },
          topic: { type: "string", description: "Optional topic hint such as warranty, pricing, or service area." },
          service_tags: { type: "array", items: { type: "string" } },
          trade: { type: "string", description: "Optional trade hint such as plumbing, electrical, or hvac." }
        },
        required: ["query"]
      }
    },
    {
      type: "function",
      name: "data_capture",
      description: "Send structured call data back to the gateway.",
      parameters: fieldSchema
    },
    {
      type: "function",
      name: "end_call",
      description: "End the phone call only after you have already spoken your final closing sentence aloud.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Short reason for ending the call." }
        }
      }
    }
  ];
}

function normalizeToolDefinitions(toolDefinitions, fieldSchema) {
  const normalized = Array.isArray(toolDefinitions) && toolDefinitions.length
    ? toolDefinitions
        .filter((item) => item && typeof item === "object" && item.name !== "faq_lookup")
    : buildDefaultToolDefinitions(fieldSchema);

  const withKnowledgeLookup = normalized.some((item) => item?.name === "knowledge_lookup")
    ? normalized
    : [buildDefaultToolDefinitions(fieldSchema)[0], ...normalized];

  const seen = new Set();
  return withKnowledgeLookup.filter((item) => {
    const name = String(item?.name || "");
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
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

    if (req.method === "GET") {
      const row = await pool.query(
        `SELECT global_emergency_phrase,
                personality_prompt,
                datetime_prompt,
                numbers_symbols_prompt,
                confirmation_prompt,
                knowledge_usage_prompt,
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
      const knowledgeUsage = String(body.knowledgeUsagePrompt || "").trim();
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
      const gatewayFieldSchema = parseJsonField(body.gatewayFieldSchema) || DEFAULT_FIELD_SCHEMA;
      const gatewayToolDefinitions = normalizeToolDefinitions(parseJsonField(body.gatewayToolDefinitions), gatewayFieldSchema);
      const gatewaySessionConfig = parseJsonField(body.gatewaySessionConfig);
      const telnyxSmsNumber = String(body.telnyxSmsNumber || "").trim();
      const telnyxSmsNumberId = String(body.telnyxSmsNumberId || "").trim();
      const telnyxSmsMessagingProfileId = String(body.telnyxSmsMessagingProfileId || "").trim();
      if (!phrase) {
        return res.status(400).json({ error: "missing_phrase" });
      }
      await pool.query(
        `INSERT INTO system_config (id, global_emergency_phrase, personality_prompt, datetime_prompt, numbers_symbols_prompt, confirmation_prompt, knowledge_usage_prompt, gateway_field_schema, gateway_tool_definitions, gateway_session_config, telnyx_sms_number, telnyx_sms_number_id, telnyx_sms_messaging_profile_id)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id)
         DO UPDATE SET global_emergency_phrase = EXCLUDED.global_emergency_phrase,
                       personality_prompt = EXCLUDED.personality_prompt,
                       datetime_prompt = EXCLUDED.datetime_prompt,
                       numbers_symbols_prompt = EXCLUDED.numbers_symbols_prompt,
                       confirmation_prompt = EXCLUDED.confirmation_prompt,
                       knowledge_usage_prompt = EXCLUDED.knowledge_usage_prompt,
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
          gatewayFieldSchema || null,
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
