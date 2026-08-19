import assert from "node:assert/strict";
import {
  getDefaultPromptBlueprintSeed,
  getPromptSectionSeeds,
  renderPromptContext
} from "@everycall/contracts";

await import("./validate-receptionist-v13.mjs");

const V14_ADJACENT_LOOKUP_RULES = `- Call knowledge_lookup in a function-call-only response with no speech or text.
  Do not speak until the tool result has been returned.
- When the result arrives, respond directly to the caller's situation and
  answer from the confirmed information. Never announce or narrate the lookup.`;
const V14_SILENT_LOOKUP_RULES = `When starting knowledge_lookup:
- ABSOLUTE SILENCE: the response containing the tool call must contain only
  the function call, with no audio or text of any kind
- do not produce a preamble, acknowledgment, transition, process comment, or
  filler before the result; wait for the tool result before speaking
- when the result arrives, answer the caller directly and naturally
- start with the useful answer, not a process comment or generic acknowledgment`;

const seed = getDefaultPromptBlueprintSeed();
assert.equal(seed.version, 14);
assert.equal(seed.name, "Canonical Receptionist v14");
assert.equal(seed.tool_definitions.knowledge_lookup.behavior_mode, "SILENT");
assert.match(seed.tool_definitions.knowledge_lookup.description, /^Silently look up/);

const sections = new Map(getPromptSectionSeeds().map((section) => [section.section_id, section.default_text]));
const canonicalText = [...sections.values()].join("\n\n");
assert.ok(sections.get("adjacent_requests").includes(V14_ADJACENT_LOOKUP_RULES));
assert.ok(sections.get("tools").includes(V14_SILENT_LOOKUP_RULES));
assert.doesNotMatch(canonicalText, /Use a bare holding phrase|spoken while the lookup runs/);
assert.doesNotMatch(canonicalText, /give a very short natural preamble/);
assert.doesNotMatch(canonicalText, /I'll check what guidance we have/);

const rendered = renderPromptContext({ ...seed, prompt_blueprint_id: "pb_canonical_receptionist_v14_test" }, {
  assistant_name: "Sarah",
  business_name: "Fixture Business",
  company_description: "We provide fixture services.",
  opening_line: "Thanks for calling Fixture Business. This is Sarah. How can I help?",
  ai_disclosure_line: "I am the business's automated assistant.",
  lead_goal: "callback information",
  required_contact_fields: ["name", "phone"],
  closing_phrase: "Thanks for calling. Have a great day.",
  basic_no_tool_allowed_statement: "We provide fixture services."
}, {
  promptMode: "layered",
  coreFactsBlock: "Service area: We serve the fixture area."
});
assert.match(rendered.promptLayers.canonical, /wait for the tool result before speaking/);
assert.doesNotMatch(rendered.promptLayers.canonical, /Use a bare holding phrase/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "canonical_receptionist_v14_silent_lookup_rules",
    "knowledge_lookup_tool_is_silent",
    "lookup_filler_rules_removed"
  ]
}, null, 2));
