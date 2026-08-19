import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getDefaultPromptBlueprintSeed,
  getPromptSectionSeeds,
  validateTenantPromptProfile
} from "@everycall/contracts";
import {
  callerFaqConfirmationIds,
  callerFaqSummaryBlocks,
  normalizeCallerFaqAnswers
} from "../pages/api/_lib/knowledgeCallerFaqConfirmation.js";

await import("./validate-receptionist-v11.mjs");

const seed = getDefaultPromptBlueprintSeed();
assert.equal(seed.version, 12);
assert.equal(seed.name, "Canonical Receptionist v12");
const sections = new Map(getPromptSectionSeeds().map((section) => [section.section_id, section.default_text]));

assert.equal(sections.get("adjacent_requests"), `# Adjacent Requests
When a caller asks for something in the same line of work as the business but
not plainly covered by What You Know By Heart:
- Engage immediately and warmly — the topic is what we do; never treat it as
  foreign. You may say things like "doors are exactly what we work on."
- Do not claim we offer the specific service, quote details, or promise an
  outcome until knowledge_lookup confirms it.
- Respond to the caller's situation first with one short substantive sentence
  and call knowledge_lookup at the same time, so the check runs while you're
  speaking. Use a bare holding phrase only when you have nothing substantive
  to say first.
- Name the caller's actual problem or type of work in that first sentence.
  Generic sympathy such as "that sounds frustrating" is not specific enough
  by itself.
- If the lookup can't confirm the specific service, say so plainly and offer
  a callback so the team can answer — that's a good outcome, not a failure.`);
assert.match(sections.get("tools"), /your first sentence should respond to what the caller actually said/);
assert.match(sections.get("tools"), /never speak a holding phrase and the answer back-to-back/);
assert.doesNotMatch(sections.get("tools"), /give a very short natural preamble/);
assert.match(sections.get("closing"), /Never answer your own question with "otherwise\.\.\."/);
assert.match(sections.get("name_and_phone_accuracy"), /Thanks,\n  John Lyman —/);
assert.match(sections.get("name_and_phone_accuracy"), /ask them to spell it/);
assert.match(sections.get("name_and_phone_accuracy"), /never re-derive or re-spell it later in the call/);
assert.match(sections.get("name_and_phone_accuracy"), /Do not tell the caller to say it slowly/);
assert.match(sections.get("lead_capture_rules"), /never use the same sentence shape twice in one call/);

const validProfile = {
  assistant_name: "Sarah",
  business_name: "Example Glass",
  company_description: "We install and repair residential glass.",
  opening_line: "Thanks for calling Example Glass. How can I help?",
  ai_disclosure_line: "I am the business's automated assistant.",
  lead_goal: "callback information",
  required_contact_fields: ["name", "phone"],
  closing_phrase: "Thanks for calling.",
  basic_no_tool_allowed_statement: "We install and repair residential glass."
};
assert.equal(validateTenantPromptProfile(validProfile).valid, true);
assert.deepEqual(validateTenantPromptProfile({
  ...validProfile,
  company_description: "We install glass and",
  basic_no_tool_allowed_statement: "We install glass and"
}).errors.slice(-2), [
  "company_description_sentence_punctuation_required",
  "basic_no_tool_allowed_statement_sentence_punctuation_required"
]);

const finishControl = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/finishSessionControl.js")
).href);
for (const invitation of [
  "If there's anything else you want them to know, you can share it now. Otherwise, thanks for calling.",
  "Anything else you want to add before we wrap up.",
  "Feel free to ask anything else before we finish."
]) {
  assert.equal(finishControl.assistantTurnContainsQuestion(invitation), true, invitation);
}

const gatewaySource = await fs.readFile(new URL("../apps/call-gateway/src/server.ts", import.meta.url), "utf8");
assert.match(gatewaySource, /response\.audio\.delta/);
assert.match(gatewaySource, /response\.function_call_arguments\.done/);
assert.match(gatewaySource, /function_call_output/);

const answers = normalizeCallerFaqAnswers({
  repairs_service: "We repair residential glass.",
  estimates: "We provide free estimates.",
  service_area: "We serve Chelan and Douglas Counties.",
  hours: "We are open weekdays from 8 to 5.",
  emergency: "Not sure"
});
const blocks = callerFaqSummaryBlocks(answers);
assert.equal(blocks.length, 4);
assert.doesNotMatch(blocks.map((block) => block.summaryText).join(" "), /Not sure/i);
assert.deepEqual(callerFaqConfirmationIds("tenant_one"), callerFaqConfirmationIds("tenant_one"));
assert.notDeepEqual(callerFaqConfirmationIds("tenant_one"), callerFaqConfirmationIds("tenant_two"));
await assert.rejects(async () => normalizeCallerFaqAnswers({ repairs_service: "We repair glass." }), /caller_faq_answer_required:estimates/);

const promptProfileSource = await fs.readFile(new URL("../pages/api/_lib/promptBlueprints.js", import.meta.url), "utf8");
assert.match(promptProfileSource, /Write in first-person business voice using we, our, or us/);
assert.match(promptProfileSource, /company_description_snapshot_invalid/);
const buildsSource = await fs.readFile(new URL("../pages/api/_lib/knowledgeReceptionistBuilds.js", import.meta.url), "utf8");
assert.match(buildsSource, /syncCallerFaqConfirmationState/);
assert.match(buildsSource, /source_artifact_stage_no_model_completed_sources/);
const compilerSource = await fs.readFile(new URL("../pages/api/_lib/knowledgeReceptionistCompiler.js", import.meta.url), "utf8");
const coreFactsSource = await fs.readFile(new URL("../pages/api/_lib/knowledgeCoreFacts.js", import.meta.url), "utf8");
assert.doesNotMatch(compilerSource, /uniqueItems/);
assert.match(compilerSource, /model_completed_sources/);
assert.match(compilerSource, /known_by_heart_creation_rating_v1/);
assert.match(compilerSource, /A fact centered on one named brand/);
assert.match(coreFactsSource, /known_by_heart_set_selector_v4/);
assert.match(coreFactsSource, /known_by_heart_fact_set_deduplication/);
assert.match(coreFactsSource, /Remove semantic duplicates/);
assert.match(coreFactsSource, /knowledge_core_fact_prompt_sections/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "canonical_receptionist_v12_exact_rules",
    "old_lookup_preamble_removed",
    "implicit_invitation_finish_guard",
    "profile_sentence_boundary_validation",
    "same_response_audio_and_tool_events_supported",
    "one_time_faq_confirmation_pipeline",
    "first_person_company_snapshot_validation",
    "ai_curated_stored_known_by_heart_section",
    "all-fallback_artifact_publish_block"
  ]
}, null, 2));
