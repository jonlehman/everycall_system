import { ensureTables, getPool } from "../../_lib/db.js";
import { composePromptForTenant } from "../../_lib/agentConfig.js";
import { loadTenantKnowledge } from "../../_lib/knowledge.js";
import { getSetupReadiness } from "../../_lib/setupReadiness.js";

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
      name: "knowledge_lookup",
      description: "Retrieve tenant knowledge relevant to the caller's question.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Caller question or topic" },
          topic: { type: "string", description: "Optional topic hint such as warranty, pricing, or service area." },
          service_tags: { type: "array", items: { type: "string" } }
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
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          if (item.name !== "faq_lookup") {
            return item;
          }
          return {
            ...item,
            name: "knowledge_lookup",
            description: "Retrieve tenant knowledge relevant to the caller's question."
          };
        })
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

    const readiness = await getSetupReadiness(pool, tenantKey);
    if (!readiness.enabled) {
      return res.status(403).json({
        error: "assistant_disabled",
        message: "Assistant is disabled until setup is complete and enabled.",
        reasons: readiness.reasons,
        checks: readiness.checks
      });
    }

    const prompt = await composePromptForTenant(tenantKey);
    const agentRow = await pool.query(
      `SELECT greeting_text FROM agents WHERE tenant_key = $1 LIMIT 1`,
      [tenantKey]
    );
    const tenantGreeting = agentRow.rows[0]?.greeting_text || "";

    const knowledge = await loadTenantKnowledge(pool, tenantKey, { includeEmptyTemplates: true });

    const systemConfigRow = await pool.query(
      `SELECT gateway_field_schema, gateway_tool_definitions, gateway_session_config
       FROM system_config WHERE id = 1`
    );
    const systemConfig = systemConfigRow.rows[0] || {};

    const fieldSchema = systemConfig.gateway_field_schema || DEFAULT_FIELD_SCHEMA;
    const toolDefinitions = normalizeToolDefinitions(systemConfig.gateway_tool_definitions, fieldSchema);
    const sessionConfig = systemConfig.gateway_session_config || DEFAULT_SESSION_CONFIG;

    return res.status(200).json({
      system_prompt: prompt,
      tenant_greeting: tenantGreeting,
      tenant_knowledge: {
        entries: knowledge.knowledgeEntries
          .filter((entry) => String(entry.contentText || "").trim())
          .map((entry) => ({
            id: entry.id ? String(entry.id) : undefined,
            title: entry.title,
            section_type: entry.sectionType,
            content: entry.contentText,
            tags: [entry.sectionType].filter(Boolean),
            source_url: entry.sourceUrl || null
          })),
        guardrail_questions: knowledge.guardrailQuestionTests
          .filter((item) => String(item.answer || "").trim())
          .map((item) => ({
            id: item.id ? String(item.id) : undefined,
            topic: item.topic || null,
            question: item.questionText,
            answer: item.answer,
            risk_level: item.riskLevel || "high",
            tags: [item.topic].filter(Boolean),
            source_url: item.sourceUrl || null
          })),
        overrides: knowledge.overrides
          .filter((item) => String(item.preferredAnswer || "").trim())
          .map((item) => ({
            id: item.id ? String(item.id) : undefined,
            topic: item.topic,
            trade: item.trade,
            service_tags: Array.isArray(item.serviceTags) ? item.serviceTags : [],
            trigger_text: item.triggerText,
            preferred_answer: item.preferredAnswer
          })),
        guardrails: knowledge.guardrails
          .filter((item) => String(item.instructionText || "").trim())
          .map((item) => ({
            id: item.id ? String(item.id) : undefined,
            rule_type: item.ruleType,
            topic: item.topic,
            trade: item.trade,
            service_tags: Array.isArray(item.serviceTags) ? item.serviceTags : [],
            severity: item.severity || "high",
            instruction: item.instructionText
          })),
        usage_instructions: Array.isArray(knowledge.usageInstructions) ? knowledge.usageInstructions : []
      },
      field_schema: fieldSchema,
      tool_definitions: toolDefinitions,
      session_config: sessionConfig,
      metadata: { tenantKey, callSid }
    });
  } catch (err) {
    return res.status(500).json({ error: "prompt_payload_error", message: err?.message || "unknown" });
  }
}
