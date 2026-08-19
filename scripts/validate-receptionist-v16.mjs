import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getDefaultPromptBlueprintSeed,
  getPromptSectionSeeds,
  renderPromptContext
} from "@everycall/contracts";

const EXPECTED_TEMPLATE_SHA256 = "b1a55953c576f4db4d47b1071b9597f37d143063d1b6ddd9596c99ca691fd70f";
const seed = getDefaultPromptBlueprintSeed();
assert.equal(seed.version, 16);
assert.equal(seed.name, "Canonical Receptionist v16");

const sections = new Map(getPromptSectionSeeds().map((section) => [section.section_id, section.default_text]));
const rawTemplate = [...sections.values()].filter(Boolean).join("\n\n");
assert.equal(crypto.createHash("sha256").update(rawTemplate).digest("hex"), EXPECTED_TEMPLATE_SHA256);

const nameRules = sections.get("name_and_phone_accuracy") || "";
assert.match(nameRules, /begin the next sentence with their first name/);
assert.match(nameRules, /no comma, dash, or pause immediately after it/);
assert.match(nameRules, /Never say "Thanks" immediately before the caller's name/);
assert.doesNotMatch(nameRules, /Thanks, FIRSTNAME/);

const closingRules = sections.get("closing") || "";
assert.match(closingRules, /Before ending any call, ask exactly: "Do you have any other questions\?"/);
assert.match(closingRules, /Only after the caller says no or clearly says they are finished, say exactly: "Thanks for calling\. Goodbye\."/);
assert.match(closingRules, /call finish_session in that same turn/);
assert.match(closingRules, /Do not wait for the caller to say goodbye/);
assert.doesNotMatch(closingRules, /caller has responded or clearly said goodbye/);

assert.match(seed.tool_definitions.data_capture.description, /ask the required other-questions checkpoint and wait/);
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
  const rendered = renderPromptContext({ ...seed, prompt_blueprint_id: "pb_canonical_receptionist_v16_test" }, profile, {
    promptMode,
    coreFactsBlock: "Hours: We are open weekdays."
  });
  assert.match(rendered.startupPrompt, /Do you have any other questions\?/);
  assert.match(rendered.startupPrompt, /Thanks for calling\. Goodbye\./);
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
    "canonical_receptionist_v16_prompt_hash",
    "smooth_first_name_usage",
    "required_other_questions_checkpoint",
    "exact_immediate_closing",
    "finish_session_preclose_answer_guard",
    "legacy_and_layered_closing_consistency"
  ]
}, null, 2));
