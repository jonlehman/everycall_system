import assert from "node:assert/strict";
import {
  getDefaultPromptBlueprintSeed,
  getPromptSectionSeeds,
  renderPromptContext
} from "@everycall/contracts";

await import("./validate-receptionist-v12.mjs");

const V13_CONCISION_RULES = `- One idea per sentence. A typical turn is one or two short sentences —
  around 25 spoken words. A substantive answer may take three sentences,
  never more.
- After you answer, stop. Do not restate the answer, summarize what we could
  do, or add a second version of the same offer.
- Offer a callback in one sentence — not an offer sentence plus a question
  sentence that repeats it.
- Do not narrate internal actions ("let me note that down," "I'll check what
  guidance we have"). Just do them.
- Never re-confirm anything already confirmed. Once the number is confirmed,
  do not repeat it — including in the close. Close with the caller's first
  name and the closing phrase, nothing recapped.`;
const V14_NO_NARRATION_RULE = `- Do not narrate internal actions. Just do them.`;
const V13_NAME_RULES = `- After the caller gives their name, repeat the first name back and ask them
  to spell the last name unless they already spelled it. (Shape: "Thanks,
  FIRSTNAME — and how do you spell your last name?")
- Capture the surname exactly as spelled. If they gave no surname, don't ask
  for one unless the callback needs it.
- After that, address the caller by first name only. Never speak the surname
  aloud again — it lives in the captured data, spelled as confirmed.`;
const V13_ONE_BEAT_RULE = `- During callback capture and closing, do one thing per turn: offer the callback, OR ask for one detail, OR confirm, OR close. Never combine these in one turn.
  (Wrong: "Would you like a callback? If so, what's your name?" — two beats.
  Ask the callback question, stop, and wait for the answer.)`;

const seed = getDefaultPromptBlueprintSeed();
assert.ok(seed.version >= 13);
assert.equal(seed.name, `Canonical Receptionist v${seed.version}`);
assert.match(seed.tool_definitions.data_capture.description, /Call this tool silently\. Never speak a lead-in, status update, or acknowledgment/);
assert.equal(seed.tool_definitions.data_capture.behavior_mode, "SILENT");
const sections = new Map(getPromptSectionSeeds().map((section) => [section.section_id, section.default_text]));
const canonicalText = [...sections.values()].join("\n\n");

if (seed.version < 14) {
  assert.ok(sections.get("personality_tone").includes(V13_CONCISION_RULES));
} else {
  assert.ok(sections.get("personality_tone").includes(V14_NO_NARRATION_RULE));
  assert.doesNotMatch(sections.get("personality_tone"), /I'll check what guidance we have/);
}
assert.ok(sections.get("name_and_phone_accuracy").includes(V13_NAME_RULES));
assert.ok(sections.get("lead_capture_rules").includes(V13_ONE_BEAT_RULE));
assert.doesNotMatch(canonicalText, /Be concise, but not abrupt|Keep most replies to one or two short sentences/);
assert.doesNotMatch(canonicalText, /John (?:Lyman|Layman|Lehman)/i);
assert.doesNotMatch(canonicalText, /Sarah MUST|Sarah’s primary|After that, Sarah|but Sarah/);
assert.doesNotMatch(canonicalText, /\b(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]\d{3}[ .-]\d{4}\b/);
assert.doesNotMatch(canonicalText, /briefly confirm both back|simply confirm the captured details/);
assert.match(sections.get("closing"), /Close with the caller's first name and the closing phrase, nothing recapped\./);
assert.match(sections.get("closing"), /Do not narrate the close or say you are wrapping up\./);
assert.match(sections.get("closing"), /The closing turn contains only the caller's first name and the closing phrase\. No lead-in or status update\./);
assert.match(sections.get("tools"), /emit the tool call silently, with no spoken lead-in, acknowledgment, or status update/);

const profile = {
  assistant_name: "Sarah",
  business_name: "Fixture Business",
  company_description: "We provide fixture services.",
  opening_line: "Thanks for calling Fixture Business. This is Sarah. How can I help?",
  ai_disclosure_line: "I am the business's automated assistant.",
  lead_goal: "callback information",
  required_contact_fields: ["name", "phone"],
  closing_phrase: "Thanks for calling. Have a great day.",
  basic_no_tool_allowed_statement: "We provide fixture services."
};
for (const promptMode of ["legacy", "layered"]) {
  const rendered = renderPromptContext({ ...seed, prompt_blueprint_id: `pb_canonical_receptionist_v${seed.version}_test` }, profile, {
    promptMode,
    coreFactsBlock: "Service area: We serve the fixture area."
  });
  assert.doesNotMatch(rendered.startupPrompt, /John (?:Lyman|Layman|Lehman)/i);
  assert.match(rendered.startupPrompt, /FIRSTNAME/);
  if (promptMode === "layered") {
    assert.doesNotMatch(rendered.promptLayers.canonical, /Fixture Business|Sarah/);
  }
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "canonical_receptionist_v13_exact_rules",
    "superseded_concision_rules_removed",
    "realistic_name_and_phone_examples_removed",
    "generic_canonical_layer_contains_no_tenant_identity",
    "data_capture_is_silent_only"
  ]
}, null, 2));
