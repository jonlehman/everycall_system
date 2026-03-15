# 05 Knowledge Artifacts and Schemas

Status: Frozen handoff baseline
## Purpose

This document defines the canonical artifact families used by the subsystem.

These artifacts are the stable contracts between:
- ingestion/compile jobs
- admin/client configuration
- runtime retrieval
- prompt generation
- call-state management
- QA/eval tooling

## Design rules

- Knowledge facts are atomic and evidence-backed.
- Knowledge cards are one answerable conversational unit.
- Each distinct offering should normally have its own card.
- Family cards may exist for navigation/disambiguation but are not the primary answer unit.
- Runtime bundle is compact, turn-specific, and authoritative for Realtime.
- Call state lives in the gateway, not only in model conversation memory.
- Cards should include aliases/caller phrases for retrieval.
- Hard overrides outrank compiled knowledge.

## Artifact families

| Artifact | Purpose | Created by | Used by |
|---|---|---|---|
| `domain_packs` | Shared domain behavior | admin/product | compiler, runtime, QA |
| `subdomain_packs` | Shared specialty deltas | admin/product | compiler, runtime, QA |
| `business_call_intent` | Tenant-level call mission and stage playbook | tenant/admin | prompt assembly, runtime |
| `setup_interview_intent` | Tenant-level onboarding interview mission and interview stage playbook | tenant/admin | setup interview runtime, compiler |
| `source_ref` | Captured evidence references from any approved source channel | crawl/segment jobs, upload jobs, interview jobs | compiler, QA, debugging |
| `knowledge_fact` | Atomic evidence-backed claims | compiler | card synthesis, QA |
| `knowledge_card` | Answerable conversational units | compiler | retrieval, prompting |
| `knowledge_override` | Hard operational overrides and soft guidance | tenant/admin | runtime, prompting |
| `knowledge_guardrail` | Dangerous-question handling and bounded-response rules | tenant/admin/compiler | runtime, prompting |
| `call_outcome_schema` | What structured outputs a call should leave behind | tenant/admin/domain | runtime, reporting |
| `knowledge_build` | Versioned manifest of a compiled tenant build | compiler/publisher | runtime, admin |
| `runtime_bundle` | Per-turn truth surface for Realtime | gateway | Realtime |
| `call_state` | Gateway-authoritative state for an active call | gateway | runtime orchestration |

## Common metadata fields

Most persisted artifact families should include:
- `id`
- `tenant_id` where tenant-scoped
- `build_id` where build-scoped
- `version`
- `status`
- `created_at`
- `updated_at`
- `created_by` / `updated_by` where human-authorable
- `notes` (optional)

## Universal object types

The universal schema supports the following reusable object types:

- organization
- offering
- offering_family
- policy
- process
- location
- hours
- person
- faq
- boundary
- promotion
- trust_signal
- contact_channel
- service_area

Domain/subdomain packs may introduce additional typed fields, but they should not replace the universal object types.

## Artifact detail

### 1. `domain_packs`
Canonical shared rules for a domain.

#### Required fields
- `domain_id`
- `name`
- `version`
- `status`
- `description`
- `naics_codes` (optional metadata)
- `intent_catalog`
- `entity_catalog`
- `page_type_weights`
- `content_class_biases`
- `ranking_rules`
- `boundary_rules`
- `clarification_rules`
- `default_stage_guidance`
- `default_prompt_fragments`
- `required_eval_suites`

### 2. `subdomain_packs`
Canonical deltas layered under a parent domain.

#### Required fields
- `subdomain_id`
- `parent_domain_id`
- `name`
- `version`
- `status`
- `description`
- `additional_intents`
- `additional_entities`
- `page_type_weight_deltas`
- `content_class_bias_deltas`
- `ranking_rule_deltas`
- `boundary_rule_deltas`
- `clarification_rule_deltas`
- `stage_guidance_deltas`
- `prompt_fragment_deltas`
- `required_eval_suites`

### 3. `business_call_intent`
Tenant-level description of the business's phone-call mission.

#### Required fields
- `business_call_intent_id`
- `tenant_id`
- `version`
- `status`
- `primary_goal`
- `secondary_goals`
- `preferred_outcomes`
- `disallowed_outcomes`
- `tone_rules`
- `sales_style`
- `disclosure_strategy`
- `handoff_strategy`
- `after_hours_strategy`
- `conversation_stage_playbook`

### 3A. `setup_interview_intent`
Tenant-level description of the owner/operator onboarding interview mission.

#### Required fields
- `setup_interview_intent_id`
- `tenant_id`
- `version`
- `status`
- `primary_goal`
- `required_capture_categories`
- `confirmation_policy`
- `completion_criteria`
- `interview_stage_playbook`
- `pause_resume_policy`
- `review_and_confirm_policy`

### 4. `source_ref`
Captured evidence reference from any approved source channel.

#### Required fields
- `source_ref_id`
- `tenant_id`
- `build_id`
- `source_channel` (`website_page`, `website_file`, `owner_interview`, `uploaded_document`)
- `source_kind` (`html`, `pdf`, `doc`, `text`, `transcript`, `note`)
- `source_authority` (`public_website`, `business_uploaded`, `interview_confirmed`)
- `source_locator` (URL, upload reference, or interview-session reference)
- `page_type`
- `title`
- `heading_path`
- `text_span`
- `segment_index`
- `content_hash`
- `source_session_id`
- `captured_at`

### 5. `knowledge_fact`
Atomic evidence-backed claim.

#### Required fields
- `knowledge_fact_id`
- `tenant_id`
- `build_id`
- `domain_id`
- `subdomain_id` (nullable if not scoped)
- `fact_type`
- `object_type`
- `subject`
- `predicate`
- `object`
- `normalized_value`
- `confidence`
- `source_ref_ids`
- `scope`
- `content_class`

#### Usage
Facts are not normally sent directly to Realtime except for debugging or specialized flows.  
They are the raw material for `knowledge_card` synthesis and QA.

### 6. `knowledge_card`
Primary runtime retrieval unit.

#### Required fields
- `knowledge_card_id`
- `tenant_id`
- `build_id`
- `domain_id`
- `subdomain_id`
- `card_type`
- `object_type`
- `canonical_name`
- `topic_path`
- `intent_tags`
- `entity_tags`
- `aliases`
- `caller_phrases`
- `scope`
- `speakable_summary`
- `answer_facts`
- `related_card_ids`
- `source_ref_ids`
- `content_class`
- `allowed_uses`
- `risk_level`
- `quality_score`

#### Granularity rule
One card should usually represent **1–5 tightly related facts** that together answer a single conversational need.

#### Good examples
- `AC Repair`
- `Water Heater Installation`
- `New Patient Intake Policy`
- `Do you accept Aetna?`
- `Service Area: Bellevue`
- `Emergency Handling`
- `Free Estimate Process`

#### Poor examples
- entire service category page
- all services the business offers
- entire office policy manual
- vague mixed-topic page summaries

### 7. `knowledge_override`
Human-authored operational or guidance override.

#### Required fields
- `knowledge_override_id`
- `tenant_id`
- `override_type` (`hard_fact`, `temporary_notice`, `soft_guidance`, `approved_answer`)
- `scope`
- `priority`
- `status`
- `title`
- `body`
- `applies_to_intents`
- `applies_to_domains`
- `applies_to_subdomains`
- `effective_from`
- `effective_until`

### 8. `knowledge_guardrail`
Bounded-answer rule for sensitive or dangerous questions.

#### Required fields
- `knowledge_guardrail_id`
- `tenant_id`
- `guardrail_type`
- `trigger_patterns`
- `trigger_intents`
- `risk_level`
- `mode`
- `approved_response_pattern`
- `required_next_step`
- `applies_to_domains`
- `applies_to_subdomains`
- `enabled`

### 9. `call_outcome_schema`
Defines what structured result the business wants from calls.

#### Required fields
- `call_outcome_schema_id`
- `tenant_id`
- `domain_scope`
- `subdomain_scope`
- `outcome_types`
- `required_fields_by_outcome`
- `optional_fields_by_outcome`
- `summary_template`
- `validation_rules`

### 10. `knowledge_build`
Versioned manifest for a compiled tenant build.

#### Required fields
- `build_id`
- `tenant_id`
- `status`
- `version`
- `domain_assignments`
- `source_snapshot_id`
- `source_channels`
- `artifact_counts`
- `quality_summary`
- `warnings`
- `published_at`
- `supersedes_build_id`

### 11. `runtime_bundle`
Gateway-generated per-turn truth surface.

#### Required fields
- `runtime_bundle_id`
- `call_id`
- `turn_id`
- `tenant_id`
- `active_domain_id`
- `active_subdomain_id`
- `detected_turn_intent`
- `selected_card_ids`
- `selected_cards`
- `state_delta`
- `missing_slots`
- `mode`
- `response_rules`
- `confidence`
- `created_at`

#### Runtime design rule
The bundle should be **small enough to keep turn latency low**, while still giving Realtime:
- the approved facts
- the current mode
- the next-step constraints
- the relevant state context

### 12. `call_state`
Gateway-authoritative state for an active call.

#### Required fields
- `call_id`
- `tenant_id`
- `active_domain_id`
- `active_subdomain_id`
- `current_stage_id`
- `completed_stage_ids`
- `skipped_stage_ids`
- `active_location_id`
- `active_person_id`
- `active_offering_id`
- `last_turn_intent`
- `last_runtime_bundle_id`
- `pending_clarifier`
- `captured_fields`
- `outcome_in_progress`
- `uncertainty_mode`
- `last_updated_at`

## Artifact relationships

### Compile-time relationships
- many `source_ref` → many `knowledge_fact`
- many `knowledge_fact` → one `knowledge_card`
- many `knowledge_card` → one `knowledge_build`

### Runtime relationships
- one `business_call_intent` + one active `domain_pack` + one active `subdomain_pack` + one `knowledge_build` + tenant `knowledge_override` / `knowledge_guardrail` → one `runtime_bundle`
- one `runtime_bundle` updates one `call_state`

## Required schema files

The following JSON schema files are part of this bundle:
- `schemas/domain_pack.schema.json`
- `schemas/subdomain_pack.schema.json`
- `schemas/business_call_intent.schema.json`
- `schemas/source_ref.schema.json`
- `schemas/knowledge_fact.schema.json`
- `schemas/knowledge_card.schema.json`
- `schemas/knowledge_override.schema.json`
- `schemas/knowledge_guardrail.schema.json`
- `schemas/call_outcome_schema.schema.json`
- `schemas/knowledge_build.schema.json`
- `schemas/runtime_bundle.schema.json`
- `schemas/call_state.schema.json`

## Required example files

The bundle should include example instances for the most important artifacts:
- `examples/business_call_intent.example.json`
- `examples/domain_pack.example.json`
- `examples/subdomain_pack.example.json`
- `examples/source_ref.example.json`
- `examples/knowledge_fact.example.json`
- `examples/knowledge_card.example.json`
- `examples/knowledge_override.example.json`
- `examples/knowledge_guardrail.example.json`
- `examples/call_outcome_schema.example.json`
- `examples/knowledge_build.example.json`
- `examples/runtime_bundle.example.json`
- `examples/call_state.example.json`

## Reserved flexibility for implementation

Codex may choose:
- normalized relational tables
- JSON columns
- document-style persistence
- mixed storage

What must remain true:
- the logical artifact boundaries above must exist
- runtime bundle and call state must be explicit
- facts and cards must remain separable
- source evidence must remain traceable
