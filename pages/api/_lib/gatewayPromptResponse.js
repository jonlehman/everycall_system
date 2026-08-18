import { TRANSFER_RULES_PROMPT_BLOCK } from "@everycall/contracts";
import { buildPromptToolDefinitions } from "./promptBlueprints.js";

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

export function buildGatewayPromptResponse(gatewayPrompt, buildFieldSchemaFromOutcomeSchema, {
  tenantKey,
  callSid,
  includeTransferTools = false
}) {
  const runtimeProfile = gatewayPrompt.approvedConfiguration.runtime_profile || {
    session_config: {},
    tool_policy: {},
    wording_defaults: {},
    runtime_defaults: {}
  };
  const fieldSchema = buildFieldSchemaFromOutcomeSchema(
    gatewayPrompt.approvedConfiguration.call_outcome_schema,
    DEFAULT_FIELD_SCHEMA
  );
  const toolDefinitions = buildPromptToolDefinitions(gatewayPrompt.promptBlueprint, fieldSchema, {
    includeTransferTools
  });
  const promptRenderMode = gatewayPrompt.promptRenderMode || "legacy";
  const transferRulesBlock = includeTransferTools ? TRANSFER_RULES_PROMPT_BLOCK : "";
  const systemPrompt = promptRenderMode === "layered" && transferRulesBlock
    ? [gatewayPrompt.systemPrompt, transferRulesBlock].filter(Boolean).join("\n\n")
    : gatewayPrompt.systemPrompt;
  const businessDetailsLayer = promptRenderMode === "layered"
    ? [gatewayPrompt.promptLayers?.businessDetails || "", transferRulesBlock].filter(Boolean).join("\n\n")
    : (gatewayPrompt.promptLayers?.businessDetails || "");

  return {
    system_prompt: systemPrompt,
    tenant_greeting: gatewayPrompt.tenantPromptProfile?.opening_line || "",
    knowledge_runtime: {
      active_build_id: gatewayPrompt.build.build_id,
      active_domain_id: gatewayPrompt.initialCallState.active_domain_id,
      active_subdomain_id: gatewayPrompt.initialCallState.active_subdomain_id,
      runtime_entry_mode: gatewayPrompt.initialCallState.runtime_entry_mode,
      initial_call_state: gatewayPrompt.initialCallState,
      company_context_summary: gatewayPrompt.companyContextSummary || "",
      business_call_intent_summary: gatewayPrompt.businessCallIntentSummary,
      prompt_blueprint: {
        prompt_blueprint_id: gatewayPrompt.promptBlueprint?.prompt_blueprint_id,
        blueprint_key: gatewayPrompt.promptBlueprint?.blueprint_key,
        version: gatewayPrompt.promptBlueprint?.version,
        status: gatewayPrompt.promptBlueprint?.status
      },
      tenant_prompt_profile: gatewayPrompt.tenantPromptProfile || {},
      rendered_prompt_sections: gatewayPrompt.renderedPromptSections || [],
      prompt_render_mode: promptRenderMode,
      prompt_layers: {
        canonical: gatewayPrompt.promptLayers?.canonical || gatewayPrompt.systemPrompt,
        business_details: businessDetailsLayer,
        volatile: gatewayPrompt.promptLayers?.volatile || ""
      },
      approved_configuration: gatewayPrompt.approvedConfiguration,
      token_counts: gatewayPrompt.tokenCounts
    },
    field_schema: fieldSchema,
    tool_definitions: toolDefinitions,
    session_config: runtimeProfile.session_config || {},
    metadata: {
      tenantKey,
      callSid,
      transferDirectoryEnabled: Boolean(includeTransferTools),
      promptRenderMode
    }
  };
}
