import { getPool } from "../../_lib/db.js";
import { assembleKnowledgeGatewayPrompt, buildFieldSchemaFromOutcomeSchema } from "../../_lib/knowledgeReceptionistPrompt.js";

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

function buildToolDefinitions(fieldSchema) {
  return [
    {
      type: "function",
      name: "knowledge_lookup",
      description: "Ask the gateway for a deterministic answer packet based on approved tenant knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The caller's current question or follow-up." }
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

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "method_not_allowed");
  }

  const token = String(req.headers["x-everycall-internal"] || "");
  if (!process.env.CALL_SUMMARY_TOKEN || token !== process.env.CALL_SUMMARY_TOKEN) {
    return fail(res, 401, "unauthorized");
  }

  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable");
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const tenantKey = String(body.tenantKey || "").trim();
    const callSid = String(body.callSid || "").trim();
    if (!tenantKey || !callSid) {
      return fail(res, 400, "missing_tenant_or_call");
    }

    const gatewayPrompt = await assembleKnowledgeGatewayPrompt(pool, tenantKey, {
      callSid,
      runtimeEntryMode: "customer_call"
    });

    const runtimeProfile = gatewayPrompt.approvedConfiguration.runtime_profile || {
      greeting_text: "",
      session_config: {},
      tool_policy: {},
      wording_defaults: {},
      runtime_defaults: {}
    };
    const fieldSchema = buildFieldSchemaFromOutcomeSchema(
      gatewayPrompt.approvedConfiguration.call_outcome_schema,
      DEFAULT_FIELD_SCHEMA
    );

    return res.status(200).json({
      system_prompt: gatewayPrompt.systemPrompt,
      tenant_greeting: runtimeProfile?.greeting_text || "",
      knowledge_runtime: {
        active_build_id: gatewayPrompt.build.build_id,
        active_domain_id: gatewayPrompt.initialCallState.active_domain_id,
        active_subdomain_id: gatewayPrompt.initialCallState.active_subdomain_id,
        runtime_entry_mode: gatewayPrompt.initialCallState.runtime_entry_mode,
        initial_call_state: gatewayPrompt.initialCallState,
        tenant_persona: gatewayPrompt.tenantPersona,
        business_call_intent_summary: gatewayPrompt.businessCallIntentSummary,
        approved_configuration: gatewayPrompt.approvedConfiguration,
        token_counts: gatewayPrompt.tokenCounts
      },
      field_schema: fieldSchema,
      tool_definitions: buildToolDefinitions(fieldSchema),
      session_config: runtimeProfile.session_config || {},
      metadata: {
        tenantKey,
        callSid
      }
    });
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required");
    }
    if (message === "no_active_build") {
      return fail(res, 409, "no_active_build");
    }
    if (message === "build_not_found") {
      return fail(res, 404, "build_not_found");
    }
    return fail(res, 500, "prompt_fetch_error", { message });
  }
}
