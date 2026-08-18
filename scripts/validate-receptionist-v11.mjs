import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDefaultPromptBlueprintSeed, TRANSFER_RULES_PROMPT_BLOCK } from "@everycall/contracts";
import { buildGatewayPromptResponse } from "../pages/api/_lib/gatewayPromptResponse.js";

const finishControl = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/finishSessionControl.js")
).href);
const knowledgeRuntime = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/knowledgeRuntime.js")
).href);

const dialogue = {};
finishControl.noteFinishSessionDialogueTurn(
  dialogue,
  "assistant",
  "Would you like me to have someone call you back?"
);
assert.deepEqual(finishControl.evaluateFinishSessionRequest(dialogue), {
  accepted: false,
  reason: "assistant_question_requires_caller_answer"
});
finishControl.noteFinishSessionDialogueTurn(dialogue, "caller", "Yes, please.");
finishControl.noteFinishSessionDialogueTurn(
  dialogue,
  "assistant",
  "I have your number as 206-555-0199. Did I get that right?"
);
assert.deepEqual(finishControl.evaluateFinishSessionRequest(dialogue), {
  accepted: false,
  reason: "assistant_question_requires_caller_answer"
});
finishControl.noteFinishSessionDialogueTurn(dialogue, "caller", "Yes, that's right.");
finishControl.noteFinishSessionDialogueTurn(
  dialogue,
  "assistant",
  "Thanks for calling. Someone will follow up soon. Have a great day."
);
assert.deepEqual(finishControl.evaluateFinishSessionRequest(dialogue), {
  accepted: false,
  reason: "caller_response_after_closing_required"
});
finishControl.noteFinishSessionDialogueTurn(dialogue, "caller", "Thanks, goodbye.");
assert.deepEqual(finishControl.evaluateFinishSessionRequest(dialogue), {
  accepted: true,
  reason: "accepted"
});

const combinedQuestionAndClose = {};
finishControl.noteFinishSessionDialogueTurn(
  combinedQuestionAndClose,
  "assistant",
  "Anything else you'd like me to add? Thanks for calling, and have a great day."
);
assert.equal(finishControl.evaluateFinishSessionRequest(combinedQuestionAndClose).accepted, false);
assert.equal(finishControl.assistantTurnContainsQuestion("Did I get that right?"), true);
assert.equal(finishControl.assistantTurnContainsQuestion("Thanks for calling. Have a great day."), false);

const gatewayPrompt = {
  approvedConfiguration: { runtime_profile: { session_config: {} }, call_outcome_schema: {} },
  build: { build_id: "build_test" },
  businessCallIntentSummary: "Test calls",
  initialCallState: { active_domain_id: null, active_subdomain_id: null, runtime_entry_mode: "customer_call" },
  promptBlueprint: getDefaultPromptBlueprintSeed(),
  promptLayers: { canonical: "CANONICAL", businessDetails: "BUSINESS", volatile: "" },
  promptRenderMode: "layered",
  renderedPromptSections: [],
  systemPrompt: "CANONICAL\n\nBUSINESS",
  tenantPromptProfile: { opening_line: "Hello" },
  tokenCounts: {}
};
const layeredGatewayPayload = buildGatewayPromptResponse(
  gatewayPrompt,
  () => ({ type: "object", properties: {}, required: [] }),
  { tenantKey: "tenant_test", callSid: "call_test", includeTransferTools: true }
);
assert.equal(layeredGatewayPayload.system_prompt.endsWith(TRANSFER_RULES_PROMPT_BLOCK), true);
assert.equal(layeredGatewayPayload.knowledge_runtime.prompt_layers.business_details.endsWith(TRANSFER_RULES_PROMPT_BLOCK), true);
assert.equal(knowledgeRuntime.buildGatewaySessionInstructions(layeredGatewayPayload), layeredGatewayPayload.system_prompt);
const legacyGatewayPayload = buildGatewayPromptResponse(
  { ...gatewayPrompt, promptRenderMode: "legacy", promptLayers: { canonical: gatewayPrompt.systemPrompt, businessDetails: "", volatile: "" } },
  () => ({ type: "object", properties: {}, required: [] }),
  { tenantKey: "tenant_test", callSid: "call_test_legacy", includeTransferTools: true }
);
assert.equal(legacyGatewayPayload.system_prompt.includes(TRANSFER_RULES_PROMPT_BLOCK), false);
assert.equal(knowledgeRuntime.buildGatewaySessionInstructions(legacyGatewayPayload).endsWith(TRANSFER_RULES_PROMPT_BLOCK), true);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "finish_session_rejects_question_turn",
    "finish_session_requires_post_closing_caller_turn",
    "finish_session_accepts_after_goodbye",
    "transfer_rules_live_in_layer_2_without_runtime_duplication"
  ]
}, null, 2));
