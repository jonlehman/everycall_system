import assert from "node:assert/strict";
import {
  GENERIC_PRICE_FREE_RESTATEMENT,
  applyTenantFactsToSharedPlannerRuntime,
  buildPacketProvenance,
  containsMonetaryOrRateExpression,
  createSafePricingFallbackPacket,
  deterministicAnswerPacketSchema,
  enforcePricingSafetyBoundary,
  getDefaultPromptBlueprintSeed,
  renderPromptContext,
  sanitizePricingSupport
} from "@everycall/contracts";
import {
  artifactFigureFloorReasons,
  ensurePricingSafetyArtifacts
} from "../pages/api/_lib/knowledgePricingSafety.js";

const seed = getDefaultPromptBlueprintSeed();
assert.equal(seed.version, 19);
assert.equal(seed.name, "Canonical Receptionist v19");
const profile = {
  assistant_name: "Sarah",
  business_name: "Fixture Painting",
  company_description: "We paint homes.",
  opening_line: "Thanks for calling Fixture Painting. This is Sarah. How can I help?",
  ai_disclosure_line: "I am the business's automated assistant.",
  lead_goal: "callback information",
  required_contact_fields: ["name", "phone"],
  closing_phrase: "Thanks for calling. Have a good one.",
  basic_no_tool_allowed_statement: "We paint homes."
};
for (const promptMode of ["legacy", "layered"]) {
  const withPrice = renderPromptContext({ ...seed, prompt_blueprint_id: "pb_v19_test" }, profile, {
    promptMode,
    coreFactsBlock: "Diagnostic fee: We charge an $89 diagnostic fee."
  }).startupPrompt;
  assert.match(withPrice, /A price comes from one place: What You Know By Heart\./);
  assert.match(withPrice, /If the caller says a number, it stays theirs\./);
  assert.match(withPrice, /including estimate policy/);
  assert.doesNotMatch(withPrice, /including pricing, estimates, or costs/);
  const zero = renderPromptContext({ ...seed, prompt_blueprint_id: "pb_v19_test" }, profile, {
    promptMode,
    coreFactsBlock: ""
  }).startupPrompt;
  assert.match(zero, /No price has been approved for you to state\./);
  assert.doesNotMatch(zero, /A price comes from one place: What You Know By Heart/);
}

assert.deepEqual(artifactFigureFloorReasons("Call us about $8,000"), ["decimal_digit", "currency_symbol"]);
assert.ok(artifactFigureFloorReasons("ten USD").includes("currency_code"));
assert.equal(containsMonetaryOrRateExpression("We have a 5-year warranty."), false);
assert.equal(containsMonetaryOrRateExpression("We serve a 30-mile radius."), false);
assert.equal(containsMonetaryOrRateExpression("For pricing questions, call 555-0199."), false);
assert.equal(containsMonetaryOrRateExpression("The project starts at $8,000."), true);
assert.equal(containsMonetaryOrRateExpression("Our rate is 25 per square foot."), true);

function packet(points = ["The project starts at $8,000."]) {
  return deterministicAnswerPacketSchema.parse({
    answer_packet_id: "kap_test",
    tenant_id: "tenant_test",
    build_id: "build_test",
    query_text: "I have a 2,000 square foot house.",
    runtime_mode: "answer",
    coverage: [{
      requested_coverage_item_text: "I have a 2,000 square foot house.",
      support_strength: "strong",
      used_card_ids: [],
      used_fact_ids: ["fact_price"],
      direct_answer_points: points,
      qualifiers: [], limits_or_exclusions: [], next_step_options: []
    }],
    direct_answer_points: points,
    qualifiers: [], limits_or_exclusions: [], next_step_options: [],
    unsupported_requested_items: [], used_card_ids: [], used_fact_ids: ["fact_price"],
    token_counts: { packet_tokens: 80, soft_budget_tokens: 600, hard_budget_tokens: 900 },
    metadata: {}
  });
}

const priceFact = {
  coverage_item_text: "I have a 2,000 square foot house.",
  knowledge_fact_id: "fact_price",
  fact_role: "answer",
  claim_text: "The project starts at $8,000.",
  support_type: "source_backed",
  similarity: 0.9,
  topic_name: "Pricing",
  subtopic_name: null,
  qualifiers: [], boundary_notes: [], next_steps: [], source_ref_ids: [], source_chunk_ids: [], card_ids: [], metadata: {}
};
const sanitizerDb = {
  async query(sql) {
    if (sql.includes("FROM kb_candidates candidate")) return { rows: [{
      support_id: "fact_price",
      value_json: {
        suppression_required: true,
        pricing_kind: "conditional",
        topic: "exterior repaint pricing",
        drivers: ["prep condition"],
        spoken: "Prep condition is one of the details that affects the cost.",
        figure_free: true
      },
      id: 1
    }] };
    if (sql.includes("FROM kb_pricing_safety_artifacts")) return { rows: [] };
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  }
};
const sanitized = await sanitizePricingSupport(sanitizerDb, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  cardResultsByCoverageItem: { "I have a 2,000 square foot house.": [] },
  factResultsByCoverageItem: { "I have a 2,000 square foot house.": [priceFact] }
});
assert.equal(sanitized.factResultsByCoverageItem["I have a 2,000 square foot house."][0].claim_text, "Prep condition is one of the details that affects the cost.");
assert.equal(JSON.stringify(sanitized).includes("$8,000"), false);

const cardOnlyCoverage = "What does an exterior repaint cost?";
const cardOnly = await sanitizePricingSupport({
  async query(sql) {
    if (sql.includes("FROM kb_pricing_safety_artifacts")) return { rows: [{
      support_id: "card_price",
      value_json: {
        suppression_required: true,
        pricing_kind: "conditional",
        topic: "exterior repaint pricing",
        drivers: ["prep condition"],
        spoken: "Prep condition is one of the details that affects the cost.",
        figure_free: true
      },
      id: 2
    }] };
    throw new Error(`unexpected card-only query: ${sql.slice(0, 80)}`);
  }
}, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  cardResultsByCoverageItem: { [cardOnlyCoverage]: [{
    coverage_item_text: cardOnlyCoverage,
    knowledge_card_id: "card_price",
    canonical_name: "Exterior repaint prices",
    summary: "Projects run from $8,000 to $20,000.",
    support_summary: "Projects run from $8,000 to $20,000.",
    similarity: 0.91,
    source_ref_ids: [], source_chunk_ids: [], fact_ids: [], metadata: {}
  }] },
  factResultsByCoverageItem: {}
});
assert.equal(cardOnly.cardResultsByCoverageItem[cardOnlyCoverage][0].summary, "Prep condition is one of the details that affects the cost.");
assert.equal(JSON.stringify(cardOnly).includes("$8,000"), false, "card-only coverage must be sanitized");

const provenance = buildPacketProvenance({
  packet: packet(),
  coverageItemOrigins: new Map([["I have a 2,000 square foot house.", "caller"]]),
  cardResultsByCoverageItem: { "I have a 2,000 square foot house.": [] },
  factResultsByCoverageItem: { "I have a 2,000 square foot house.": [{
    ...priceFact,
    metadata: { pricing_origin: "website_or_upload", pricing_source_hash: "source-hash" }
  }] }
});
assert.equal(provenance["/query_text"].origin, "caller", "caller provenance must win even when its text equals a support string");
const blocked = enforcePricingSafetyBoundary({ packet: packet(), provenance });
assert.equal(blocked.replaced, true);
assert.deepEqual(blocked.packet.direct_answer_points, [GENERIC_PRICE_FREE_RESTATEMENT]);
assert.equal(JSON.stringify(blocked.packet).includes("$8,000"), false);
assert.deepEqual(deterministicAnswerPacketSchema.parse(createSafePricingFallbackPacket(packet())), blocked.packet);

const authorized = buildPacketProvenance({
  packet: packet(["We charge an $89 diagnostic fee."]),
  coverageItemOrigins: new Map([["I have a 2,000 square foot house.", "caller"]]),
  cardResultsByCoverageItem: { "I have a 2,000 square foot house.": [] },
  factResultsByCoverageItem: { "I have a 2,000 square foot house.": [{
    ...priceFact,
    claim_text: "We charge an $89 diagnostic fee.",
    knowledge_fact_id: "tenant-price",
    metadata: { pricing_origin: "tenant_authorized", pricing_source_hash: "tenant-hash" }
  }] }
});
assert.equal(enforcePricingSafetyBoundary({ packet: packet(["We charge an $89 diagnostic fee."]), provenance: authorized }).replaced, false);
const unapproved = Object.fromEntries(Object.entries(authorized).map(([path, value]) => [path, {
  ...value,
  origin: value.origin === "tenant_authorized" ? "tenant_unapproved" : value.origin
}]));
assert.equal(enforcePricingSafetyBoundary({ packet: packet(["We charge an $89 diagnostic fee."]), provenance: unapproved }).replaced, true);

const overlayDb = {
  async query(sql) {
    if (sql.includes("FROM kb_tenant_facts")) return { rows: [{
      id: "tenant-price", category: "pricing", subject_text: "diagnostic fee",
      canonical_text: "We charge an $89 diagnostic fee.", title: "Diagnostic fee",
      qualifiers_json: [], boundaries_json: [], price_authorized_by_tenant: true,
      effective_score: 1, created_at: new Date().toISOString()
    }] };
    if (sql.includes("FROM kb_candidates candidate")) return { rows: [] };
    throw new Error(`unexpected overlay query: ${sql.slice(0, 100)}`);
  }
};
const overlaid = await applyTenantFactsToSharedPlannerRuntime(overlayDb, "tenant_test", "What is the diagnostic fee?", {
  answerPacket: packet(["We offer diagnostic visits."]),
  cardResultsByCoverageItem: { "I have a 2,000 square foot house.": [] },
  factResultsByCoverageItem: { "I have a 2,000 square foot house.": [{ ...priceFact, claim_text: "We offer diagnostic visits." }] }
});
assert.equal(overlaid.factResultsByCoverageItem["I have a 2,000 square foot house."][0].metadata.pricing_origin, "tenant_authorized");
assert.ok(overlaid.answerPacket.direct_answer_points.includes("We charge an $89 diagnostic fee."));

const inserts = [];
const artifactDb = {
  async query(sql, values = []) {
    if (sql.includes("SELECT candidate.*")) return { rows: [{
      id: "candidate_false_negative", target_id: "candidate_false_negative",
      canonical_text: "This job is about double a standard repaint.", spoken_text: "",
      title: "Project pricing", quantities_json: [], qualifiers_json: [], boundaries_json: [],
      source_refs_json: [{ source_ref_id: "src_one" }]
    }] };
    if (sql.includes("SELECT * FROM knowledge_build_cards")) return { rows: [] };
    if (sql.includes("SELECT target_type, target_id")) return { rows: [] };
    if (sql.includes("FROM source_refs")) return { rows: [{
      source_ref_id: "src_one", source_channel: "website", source_kind: "page",
      source_authority: "website_public_page", url: "https://example.com/pricing",
      title: "Pricing", content_hash: "content-one"
    }] };
    if (sql.includes("INSERT INTO kb_pricing_safety_artifacts")) { inserts.push(values); return { rowCount: 1, rows: [] }; }
    if (sql.includes("INSERT INTO kb_tenant_notices")) return { rowCount: 1, rows: [] };
    throw new Error(`unexpected artifact query: ${sql.slice(0, 100)}`);
  }
};
const modelCaller = async ({ system }) => {
  if (system.includes("primary classifier")) return { model: "classifier", parsed: { items: [{ target_id: "candidate:candidate_false_negative", verdict: "clear", pricing_kind: "none" }] } };
  if (system.includes("independent source verifier")) return { model: "source-verifier", parsed: { items: [{ target_id: "candidate:candidate_false_negative", verdict: "price", pricing_kind: "conditional" }] } };
  if (system.includes("Write one useful")) return { model: "restatement", parsed: { topic: "project pricing", drivers: ["scope of work"], spoken: "The scope of the work is one detail that affects the cost." } };
  if (system.includes("Independently inspect")) return { model: "restatement-verifier", parsed: { verdict: "clear" } };
  throw new Error("unexpected model call");
};
await ensurePricingSafetyArtifacts(artifactDb, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  modelCaller,
  classifierModel: "classifier",
  sourceVerifierModel: "source-verifier",
  restatementModel: "restatement",
  restatementVerifierModel: "restatement-verifier"
});
assert.equal(inserts.length, 1);
assert.equal(JSON.parse(inserts[0][4]).suppression_required, true, "independent source verifier must catch a classifier false negative");
assert.equal(inserts[0][5], "classifier");
assert.equal(inserts[0][8], "source-verifier");
assert.equal(inserts[0][11], "restatement");
assert.equal(inserts[0][14], "restatement-verifier");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "blueprint_v19_pricing_rule_and_zero_state",
    "artifact_and_boundary_floors_are_distinct",
    "support_sanitization_removes_source_price",
    "card_only_coverage_is_sanitized",
    "whole_packet_contract_valid_fallback",
    "tenant_authorized_and_unapproved_origins",
    "shared_gateway_tenant_fact_overlay_authorization",
    "independent_source_verifier_catches_classifier_false_negative"
  ]
}, null, 2));
