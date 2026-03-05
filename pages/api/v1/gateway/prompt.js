import { ensureTables, getPool } from "../../_lib/db.js";
import { composePromptForTenant } from "../../_lib/agentConfig.js";

const DEFAULT_SESSION_CONFIG = {
  model: "gpt-realtime-1.5",
  voice: "marin",
  max_output_tokens: 4096,
  turn_detection: {
    type: "server_vad",
    threshold: 0.75,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
    idle_timeout_ms: null,
    create_response: true,
    interrupt_response: true
  },
  transcription_model: "gpt-4o-mini-transcribe",
  noise_reduction: "far_field",
  input_audio_format: "g711_ulaw",
  output_audio_format: "g711_ulaw"
};

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
      name: "faq_lookup",
      description: "Lookup tenant FAQ answers for caller questions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Caller question or topic" },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["query"]
      }
    },
    {
      type: "function",
      name: "data_capture",
      description: "Send structured call data back to the gateway.",
      parameters: fieldSchema
    }
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const token = String(req.headers["x-everycall-internal"] || "");
  if (!process.env.CALL_SUMMARY_TOKEN || token !== process.env.CALL_SUMMARY_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const tenantKey = String(body.tenantKey || "").trim();
    const callSid = String(body.callSid || "").trim();
    if (!tenantKey || !callSid) {
      return res.status(400).json({ error: "missing_tenant_or_call" });
    }

    const prompt = await composePromptForTenant(tenantKey);
    const agentRow = await pool.query(
      `SELECT greeting_text FROM agents WHERE tenant_key = $1 LIMIT 1`,
      [tenantKey]
    );
    const tenantGreeting = agentRow.rows[0]?.greeting_text || "";

    const faqRows = await pool.query(
      `SELECT id, question, answer, category FROM faqs WHERE tenant_key = $1 ORDER BY id ASC`,
      [tenantKey]
    );
    const tenantFaqs = faqRows.rows.map((row) => ({
      id: String(row.id),
      question: row.question,
      answer: row.answer,
      tags: row.category ? [row.category] : []
    }));

    const systemConfigRow = await pool.query(
      `SELECT gateway_field_schema, gateway_tool_definitions, gateway_session_config
       FROM system_config WHERE id = 1`
    );
    const systemConfig = systemConfigRow.rows[0] || {};

    const fieldSchema = systemConfig.gateway_field_schema || DEFAULT_FIELD_SCHEMA;
    const toolDefinitions = systemConfig.gateway_tool_definitions || buildDefaultToolDefinitions(fieldSchema);
    const sessionConfig = systemConfig.gateway_session_config || DEFAULT_SESSION_CONFIG;

    return res.status(200).json({
      system_prompt: prompt,
      tenant_greeting: tenantGreeting,
      tenant_faqs: tenantFaqs,
      field_schema: fieldSchema,
      tool_definitions: toolDefinitions,
      session_config: sessionConfig,
      metadata: { tenantKey, callSid }
    });
  } catch (err) {
    return res.status(500).json({ error: "prompt_payload_error", message: err?.message || "unknown" });
  }
}
