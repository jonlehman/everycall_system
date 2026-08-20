import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getDefaultPromptBlueprintSeed,
  getPromptSectionSeeds,
  renderPromptContext
} from "@everycall/contracts";

const EXPECTED_TEMPLATE_SHA256 = "5cf292fe6258b8e70e54de1491c494bd98e53c1a8e39901ab7c7e67764f3a682";
const seed = getDefaultPromptBlueprintSeed();
assert.equal(seed.version, 17);
assert.equal(seed.name, "Canonical Receptionist v17");

const sections = new Map(getPromptSectionSeeds().map((section) => [section.section_id, section.default_text]));
const rawTemplate = [...sections.values()].filter(Boolean).join("\n\n");
assert.equal(crypto.createHash("sha256").update(rawTemplate).digest("hex"), EXPECTED_TEMPLATE_SHA256);

const toolsRules = sections.get("tools") || "";
assert.match(toolsRules, /After success, continue directly with the next needed question\./);
assert.match(toolsRules, /When capture is complete, ask the required other-questions checkpoint and wait\./);
assert.match(toolsRules, /Never continue directly from data_capture to the closing\./);
assert.doesNotMatch(toolsRules, /next needed question or the closing/);

const closingRules = sections.get("closing") || "";
const finishDecision = `Only after the caller says no or clearly says they are finished, say exactly: "Thanks for calling. Goodbye." In that same turn, call finish_session.`;
assert.ok(closingRules.includes(finishDecision));
assert.match(closingRules, /The only spoken words in the closing turn are "Thanks for calling\. Goodbye\." The turn also includes the silent finish_session tool call\./);
assert.match(closingRules, /Do not wait for the caller to say goodbye after the closing\./);
assert.match(closingRules, /Never call finish_session in a turn where you asked a question\./);

assert.match(seed.tool_definitions.data_capture.description, /ask the required other-questions checkpoint and wait/);
assert.match(seed.tool_definitions.data_capture.description, /Never jump directly from data capture to the closing/);
assert.match(seed.tool_definitions.finish_session.description, /same final turn as the exact closing/);

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
  const rendered = renderPromptContext({ ...seed, prompt_blueprint_id: "pb_canonical_receptionist_v17_test" }, profile, {
    promptMode,
    coreFactsBlock: "Hours: We are open weekdays."
  });
  assert.match(rendered.startupPrompt, /When capture is complete, ask the required other-questions checkpoint and wait\./);
  assert.match(rendered.startupPrompt, /Never continue directly from data_capture to the closing\./);
  assert.ok(rendered.startupPrompt.includes(finishDecision));
  assert.doesNotMatch(rendered.startupPrompt, /A conflicting old tenant closing phrase/);
}

const finishControl = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/finishSessionControl.js")
).href);

const immediateClose = {};
finishControl.noteFinishSessionDialogueTurn(immediateClose, "assistant", "Do you have any other questions?");
assert.deepEqual(finishControl.evaluateFinishSessionRequest(immediateClose), {
  accepted: false,
  reason: "assistant_question_requires_caller_answer"
});
finishControl.noteFinishSessionDialogueTurn(immediateClose, "caller", "No, that's all.");
finishControl.noteFinishSessionDialogueTurn(immediateClose, "assistant", "Thanks for calling. Goodbye.");
assert.deepEqual(finishControl.evaluateFinishSessionRequest(immediateClose), {
  accepted: true,
  reason: "accepted"
});

const skippedCheckpoint = {};
finishControl.noteFinishSessionDialogueTurn(skippedCheckpoint, "caller", "My number is confirmed.");
finishControl.noteFinishSessionDialogueTurn(skippedCheckpoint, "assistant", "Thanks for calling. Goodbye.");
assert.deepEqual(finishControl.evaluateFinishSessionRequest(skippedCheckpoint), {
  accepted: false,
  reason: "caller_clear_finish_after_preclose_question_required"
});

const callerAskedAnotherQuestion = {};
finishControl.noteFinishSessionDialogueTurn(callerAskedAnotherQuestion, "assistant", "Do you have any other questions?");
finishControl.noteFinishSessionDialogueTurn(callerAskedAnotherQuestion, "caller", "Yes, what time do you open?");
finishControl.noteFinishSessionDialogueTurn(callerAskedAnotherQuestion, "assistant", "Thanks for calling. Goodbye.");
assert.deepEqual(finishControl.evaluateFinishSessionRequest(callerAskedAnotherQuestion), {
  accepted: false,
  reason: "caller_clear_finish_after_preclose_question_required"
});

const combinedQuestionAndClose = {};
finishControl.noteFinishSessionDialogueTurn(
  combinedQuestionAndClose,
  "assistant",
  "Do you have any other questions? Thanks for calling. Goodbye."
);
assert.equal(finishControl.evaluateFinishSessionRequest(combinedQuestionAndClose).accepted, false);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "canonical_receptionist_v17_prompt_hash",
    "data_capture_checkpoint_before_closing",
    "finish_session_immediately_after_exact_goodbye_rule",
    "legacy_and_layered_prompt_consistency",
    "finish_session_preclose_answer_guard"
  ]
}, null, 2));
