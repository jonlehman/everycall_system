import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  getDefaultPromptBlueprintSeed,
  getPromptSectionSeeds,
  renderPromptContext
} from "@everycall/contracts";

const EXPECTED_TEMPLATE_SHA256 = "03a2fd57e21e8f3dea70f660d6e5d8922b6b4cf32228ca4870682232b2fca943";
const EXPECTED_NONEMPTY_SECTION_IDS = [
  "role_objective",
  "business_context",
  "core_facts",
  "personality_tone",
  "core_behavioral_rules",
  "adjacent_requests",
  "lead_capture_rules",
  "name_and_phone_accuracy",
  "tools",
  "audio_conversation_safety",
  "closing"
];

const seed = getDefaultPromptBlueprintSeed();
assert.equal(seed.version, 15);
assert.equal(seed.name, "Canonical Receptionist v15");
const sections = getPromptSectionSeeds();
const nonemptySections = sections.filter((section) => section.default_text);
assert.deepEqual(nonemptySections.map((section) => section.section_id), EXPECTED_NONEMPTY_SECTION_IDS);
const rawTemplate = nonemptySections.map((section) => section.default_text).join("\n\n");
assert.equal(crypto.createHash("sha256").update(rawTemplate).digest("hex"), EXPECTED_TEMPLATE_SHA256);
assert.equal(rawTemplate.length, 12001);
assert.match(rawTemplate, /^Role & Objective/);
assert.match(rawTemplate, /You are \{assistant_name\}, the live phone receptionist for \{business_name\}\./);
assert.match(rawTemplate, /You are the receptionist, not the technician, estimator, or expert\./);
assert.match(rawTemplate, /Let the caller feel they reached the right place through recognition, not assertion\./);
assert.match(rawTemplate, /Call knowledge_lookup with no speech or text\.\nAfter the lookup returns/);
assert.match(rawTemplate, /After the lookup returns, engage immediately and warmly\./);
assert.match(rawTemplate, /Offer the callback as one short question in one sentence/);
assert.match(rawTemplate, /Emit a function-call-only response with no speech or text of any kind\./);
assert.match(rawTemplate, /Call finish_session only after you have spoken the closing AND the caller has responded or clearly said goodbye\./);

const profile = {
  assistant_name: "Sarah",
  business_name: "Fixture Business",
  company_description: "We provide fixture services.",
  opening_line: "Thanks for calling Fixture Business. This is Sarah. How can I help?",
  ai_disclosure_line: "I am the business's automated assistant.",
  lead_goal: "callback information",
  required_contact_fields: ["caller name", "callback number"],
  closing_phrase: "Thanks for calling. Have a great day.",
  basic_no_tool_allowed_statement: "We provide fixture services."
};
const secondProfile = {
  ...profile,
  assistant_name: "Alex",
  business_name: "Other Business",
  company_description: "We provide other services.",
  opening_line: "Thanks for calling Other Business. This is Alex. How can I help?",
  basic_no_tool_allowed_statement: "We provide other services."
};

const blueprint = { ...seed, prompt_blueprint_id: "pb_canonical_receptionist_v15_test" };
const legacy = renderPromptContext(blueprint, profile, {
  promptMode: "legacy",
  coreFactsBlock: "Hours: We are open weekdays."
});
assert.doesNotMatch(legacy.startupPrompt, /\{[a-z0-9_]+\}/i);
assert.match(legacy.startupPrompt, /You are Sarah, the live phone receptionist for Fixture Business\./);
assert.match(legacy.startupPrompt, /State these from memory, rephrased in your own spoken words: Hours:/);

const layered = renderPromptContext(blueprint, profile, {
  promptMode: "layered",
  coreFactsBlock: "Hours: We are open weekdays."
});
const secondLayered = renderPromptContext(blueprint, secondProfile, {
  promptMode: "layered",
  coreFactsBlock: "Service area: We serve Tacoma."
});
assert.equal(layered.promptLayers.canonical, secondLayered.promptLayers.canonical);
assert.doesNotMatch(layered.promptLayers.canonical, /Fixture Business|Sarah|\{[a-z0-9_]+\}/i);
assert.match(layered.promptLayers.businessDetails, /Business name: Fixture Business/);
assert.match(layered.promptLayers.businessDetails, /What You Know By Heart/);
assert.equal(layered.promptLayers.volatile, "");
assert.ok(Buffer.byteLength(layered.promptLayers.canonical, "utf8") / 4 >= 1024);

for (const promptMode of ["legacy", "layered"]) {
  const withoutFacts = renderPromptContext(blueprint, profile, { promptMode, coreFactsBlock: "" });
  assert.doesNotMatch(withoutFacts.startupPrompt, /What You Know By Heart/);
  assert.doesNotMatch(withoutFacts.startupPrompt, /approved facts in What You Know By Heart/);
}

console.log(JSON.stringify({
  ok: true,
  checked: [
    "canonical_receptionist_v15_exact_condensed_template",
    "legacy_variable_injection",
    "layered_shared_prefix_and_business_details",
    "zero_fact_reference_hygiene",
    "silent_tool_and_finish_session_rules"
  ]
}, null, 2));
