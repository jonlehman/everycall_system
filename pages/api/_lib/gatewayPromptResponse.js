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

export function buildToolDefinitions(fieldSchema) {
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

export function buildGatewayPromptResponse(gatewayPrompt, buildFieldSchemaFromOutcomeSchema, {
  tenantKey,
  callSid
}) {
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

  return {
    system_prompt: gatewayPrompt.systemPrompt,
    tenant_greeting: runtimeProfile?.greeting_text || "",
    knowledge_runtime: {
      active_build_id: gatewayPrompt.build.build_id,
      active_domain_id: gatewayPrompt.initialCallState.active_domain_id,
      active_subdomain_id: gatewayPrompt.initialCallState.active_subdomain_id,
      runtime_entry_mode: gatewayPrompt.initialCallState.runtime_entry_mode,
      initial_call_state: gatewayPrompt.initialCallState,
      company_context_summary: gatewayPrompt.companyContextSummary || "",
      tenant_persona: gatewayPrompt.tenantPersona,
      business_call_intent_summary: gatewayPrompt.businessCallIntentSummary,
      prompt_layers: gatewayPrompt.promptLayers,
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
  };
}
