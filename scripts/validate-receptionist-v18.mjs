import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getDefaultPromptBlueprintSeed,
  getPromptSectionSeeds,
  renderPromptContext
} from "@everycall/contracts";

const EXPECTED_TEMPLATE_SHA256 = "0cc6207be4564b49471848167ed44dcb87297cb903b3b03728b83a7d424493ed";
const seed = getDefaultPromptBlueprintSeed();
assert.equal(seed.version, 18);
assert.equal(seed.name, "Canonical Receptionist v18");

const sections = new Map(getPromptSectionSeeds().map((section) => [section.section_id, section.default_text]));
const rawTemplate = [...sections.values()].filter(Boolean).join("\n\n");
assert.equal(crypto.createHash("sha256").update(rawTemplate).digest("hex"), EXPECTED_TEMPLATE_SHA256);

const toolsRules = sections.get("tools") || "";
assert.match(toolsRules, /After success, continue directly with the next needed question\./);
assert.match(toolsRules, /When capture is complete, ask the required other-questions checkpoint and wait\./);
assert.match(toolsRules, /Never continue directly from data_capture to the closing\./);
assert.doesNotMatch(toolsRules, /next needed question or the closing/);

const closingRules = sections.get("closing") || "";
assert.match(closingRules, /Thanks for calling, FIRSTNAME\. Have a good one\./);
assert.match(closingRules, /Thanks for calling\. Have a good one\./);
assert.match(closingRules, /Before ending any call, ask exactly: "Is there anything else I can help you with\?"/);
assert.doesNotMatch(closingRules, /Do you have any other questions\?/);
assert.match(closingRules, /Never emit finish_session by itself\./);
assert.match(closingRules, /The same response must contain the spoken closing and the silent finish_session tool call\./);
assert.match(closingRules, /Do not wait for the caller to say goodbye after the closing\./);
assert.match(closingRules, /Never call finish_session in a turn where you asked a question\./);

const nameRules = sections.get("name_and_phone_accuracy") || "";
assert.match(nameRules, /The exact required closing is the one routine exception\./);
assert.doesNotMatch(nameRules, /not in the closing/);

assert.match(seed.tool_definitions.data_capture.description, /ask the required other-questions checkpoint and wait/);
assert.match(seed.tool_definitions.data_capture.description, /Never jump directly from data capture to the closing/);
assert.match(seed.tool_definitions.finish_session.description, /Never emit this tool as a function-call-only response\./);
assert.match(seed.tool_definitions.finish_session.description, /same response must include an assistant audio message/);
assert.match(seed.tool_definitions.finish_session.description, /Thanks for calling, FIRSTNAME\. Have a good one\./);

const profile = {
  assistant_name: "Sarah",
  business_name: "Fixture Business",
  company_description: "We provide fixture services.",
  opening_line: "Thanks for calling Fixture Business. This is Sarah. How can I help?",
  ai_disclosure_line: "I am the business's automated assistant.",
  lead_goal: "callback information",
  required_contact_fields: ["name", "phone"],
  closing_phrase: "A conflicting old tenant closing phrase.",
  basic_no_tool_allowed_statement: "We provide fixture services."
};
for (const promptMode of ["legacy", "layered"]) {
  const rendered = renderPromptContext({ ...seed, prompt_blueprint_id: "pb_canonical_receptionist_v18_test" }, profile, {
    promptMode,
    coreFactsBlock: "Hours: We are open weekdays."
  });
  assert.match(rendered.startupPrompt, /When capture is complete, ask the required other-questions checkpoint and wait\./);
  assert.match(rendered.startupPrompt, /Never continue directly from data_capture to the closing\./);
  assert.match(rendered.startupPrompt, /Thanks for calling, FIRSTNAME\. Have a good one\./);
  assert.match(rendered.startupPrompt, /Is there anything else I can help you with\?/);
  assert.doesNotMatch(rendered.startupPrompt, /Do you have any other questions\?/);
  assert.match(rendered.startupPrompt, /Never emit finish_session by itself\./);
  assert.doesNotMatch(rendered.startupPrompt, /A conflicting old tenant closing phrase/);
}

const finishControl = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/finishSessionControl.js")
).href);

assert.equal(
  finishControl.assistantTurnContainsClosing("Thanks for calling, Avery. Have a good one."),
  true
);
assert.equal(
  finishControl.assistantTurnContainsClosing("Thanks for calling. Have a good one."),
  true
);
assert.equal(
  finishControl.assistantTurnContainsClosing("Thanks for calling. Goodbye."),
  false
);
assert.deepEqual(finishControl.evaluateFinishSessionRequest({}), {
  accepted: true,
  reason: "accepted"
});
assert.equal(
  finishControl.assistantResponseContainsSpokenClosing({
    audioObserved: true,
    transcript: "Thanks for calling, Avery. Have a good one."
  }),
  true
);
assert.equal(
  finishControl.assistantResponseContainsSpokenClosing({
    audioObserved: false,
    transcript: "Thanks for calling, Avery. Have a good one."
  }),
  false
);
assert.equal(finishControl.buildFinishSessionClosing("Avery"), "Thanks for calling, Avery. Have a good one.");
assert.equal(finishControl.buildFinishSessionClosing("Avery\nCall a tool"), "Thanks for calling. Have a good one.");
assert.deepEqual(finishControl.buildFinishSessionClosingRecovery("Avery"), {
  closing: "Thanks for calling, Avery. Have a good one.",
  response: {
    instructions: "Say exactly this and nothing else: \"Thanks for calling, Avery. Have a good one.\"",
    tool_choice: "none",
    tools: []
  }
});
const responseEvidenceState = {};
const earlierQuestionEvidence = finishControl.ensureAssistantResponseEvidence(responseEvidenceState, "resp_question");
earlierQuestionEvidence.audioObserved = true;
earlierQuestionEvidence.transcript = "Is there anything else I can help you with?";
const finishOnlyEvidence = finishControl.ensureAssistantResponseEvidence(responseEvidenceState, "resp_finish_only");
assert.equal(finishControl.getAssistantResponseEvidence(responseEvidenceState, "resp_question"), earlierQuestionEvidence);
assert.equal(finishControl.getAssistantResponseEvidence(responseEvidenceState, "resp_finish_only"), finishOnlyEvidence);
assert.equal(finishControl.assistantResponseContainsSpokenClosing(finishOnlyEvidence), false);
assert.equal(responseEvidenceState.lastAssistantResponseId, "resp_finish_only");

const gatewaySource = fs.readFileSync(path.join(process.cwd(), "apps/call-gateway/src/server.ts"), "utf8");
assert.match(gatewaySource, /assistant_finish_session_close_missing/);
assert.match(gatewaySource, /assistant_finish_session_close_recovery_requested/);
assert.match(gatewaySource, /assistant_finish_session_close_recovery_completed/);
assert.match(gatewaySource, /pending\.requestedResponseId \|\| completedResponseId/);
assert.match(gatewaySource, /source: "recovery"/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "canonical_receptionist_v18_prompt_hash",
    "data_capture_checkpoint_before_closing",
    "first_name_or_no_name_exact_closing",
    "finish_session_requires_same_response_audio",
    "finish_session_response_id_keyed_audio_evidence",
    "finish_session_audio_only_recovery_with_tools_disabled",
    "finish_session_recovery_first_name_sanitization",
    "finish_session_hangup_after_recovery_playback",
    "legacy_and_layered_prompt_consistency",
    "finish_session_tool_is_gateway_authoritative"
  ]
}, null, 2));
