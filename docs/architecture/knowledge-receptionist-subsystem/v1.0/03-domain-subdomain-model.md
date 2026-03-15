# 03 Domain / Subdomain Model

Status: Frozen handoff baseline
## Purpose

This document defines the EveryCall business taxonomy model used to control:
- shared domain behavior
- specialty-level subdomain deltas
- multi-domain tenant assignment
- runtime domain/subdomain activation per caller turn

## Core decisions

- EveryCall maintains its own primary taxonomy.
- NAICS 2022 may be stored as optional metadata only.
- A domain stores what is common across the broad category.
- A subdomain stores only the delta relative to the domain.
- Domain content must not be duplicated into subdomain records.
- Subdomain content must not replace domain content; it layers on top.
- There is exactly one canonical domain pack per domain.
- There is exactly one canonical subdomain pack per subdomain.
- Packs have a maturity status: `new` or `established`.
- Tenants may be assigned multiple domain/subdomain combinations.
- Caller turn intent selects the active domain/subdomain at runtime.

## Why EveryCall taxonomy is primary

NAICS is useful for:
- onboarding hints
- analytics
- reporting
- clustering similar customers

NAICS is not sufficient as the primary runtime taxonomy because EveryCall's runtime needs are driven by:
- caller intents
- receptionist behaviors
- domain-specific risk boundaries
- retrieval relevance
- conversation structure

Therefore:
- **EveryCall taxonomy** = system of record for runtime behavior
- **NAICS** = optional mapped metadata

## Taxonomy structure

### Domain
A **domain** is the broadest reusable layer of shared receptionist behavior for a category of business.

A domain contains:
- shared caller intent families
- shared entity types
- shared page-type preferences
- shared ranking rules
- shared safety / boundary rules
- shared default prompt fragments
- shared QA expectations

Examples:
- `medical`
- `legal`
- `accounting`
- `service_business`
- `dental`
- `therapy_practice`

### Subdomain
A **subdomain** is the specialty-level delta layered beneath a domain.

A subdomain contains only:
- additional or specialized intents
- additional entities
- extraction deltas
- ranking deltas
- boundary deltas
- prompt deltas
- QA deltas

Examples:
- `medical.primary_care`
- `medical.dermatology`
- `service_business.plumbing`
- `service_business.hvac`
- `legal.estate_planning`
- `accounting.cpa_firm`

## Domain vs subdomain decision rule

Create a separate subdomain when at least one of these is true:
- caller questions are materially different
- important entity types are materially different
- risk boundaries are materially different
- retrieval ranking priorities are materially different
- stage-playbook recommendations are materially different
- go-live eval cases would need a materially different dataset

Do **not** create a separate subdomain merely because:
- marketing language differs slightly
- the business offers a custom branded package
- the website uses unusual terminology but the underlying behavior is similar

## Domain pack contract

A domain pack is a canonical shared behavior record. It is compiler and runtime behavior, not tenant data.

### Required fields
- `domain_id`
- `name`
- `version`
- `status`
- `naics_codes` (optional metadata)
- `description`
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
- `created_at`
- `updated_at`

### Required design rules
- domain packs may not contain tenant facts
- domain packs may not contain subdomain-only fields
- domain packs should remain as stable as possible across many tenants
- domain packs may define defaults that subdomains can extend or override

## Subdomain pack contract

A subdomain pack is a canonical delta record layered on top of its parent domain pack.

### Required fields
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
- `created_at`
- `updated_at`

### Required design rules
- a subdomain may only store the delta relative to its parent domain
- subdomain records must not duplicate parent domain content
- effective runtime behavior is composed, not copied
- subdomain overrides should be explicit and field-scoped

## Pack maturity

### `new`
Use when:
- the pack is valid and canonical
- the pack has not yet been broadly field-tested
- stricter QA/go-live checks apply
- review intensity is higher

### `established`
Use when:
- the pack has passed the required acceptance criteria across sufficient tenants or evaluation volume
- regression behavior is stable
- default retrieval/prompt assumptions are considered production-ready

Pack maturity changes QA and rollout policy, not the conceptual model.


## Initial seeded EveryCall taxonomy for v1 handoff

This bundle freezes an **initial seed taxonomy** so Codex does not need to invent one during implementation.

The seed list is intentionally small enough to manage, but broad enough to support cross-vertical architecture.

### Seed domains
- `service_business`
- `medical`
- `dental`
- `therapy_practice`
- `legal`
- `accounting`
- `professional_services`
- `wellness_beauty`
- `real_estate_property`
- `education_training`
- `retail_showroom`

### Example seeded subdomains
- `service_business.plumbing`
- `service_business.hvac`
- `service_business.electrical`
- `service_business.roofing`
- `service_business.window_installation`
- `service_business.garage_door`
- `service_business.locksmith`
- `service_business.cleaning`
- `service_business.pest_control`
- `service_business.landscaping`
- `service_business.general_contracting`
- `medical.primary_care`
- `medical.dermatology`
- `medical.pediatrics`
- `medical.chiropractic`
- `dental.general_dentistry`
- `dental.orthodontics`
- `therapy_practice.individual_therapy`
- `therapy_practice.couples_therapy`
- `legal.estate_planning`
- `legal.family_law`
- `legal.personal_injury`
- `accounting.cpa_firm`
- `accounting.bookkeeping`
- `accounting.tax_prep`
- `professional_services.managed_it_services`
- `professional_services.marketing_agency`
- `professional_services.business_consulting`
- `wellness_beauty.med_spa`
- `wellness_beauty.salon`
- `real_estate_property.property_management`
- `real_estate_property.brokerage`
- `education_training.tutoring`
- `education_training.music_lessons`
- `retail_showroom.showroom_appointments`

### Taxonomy freeze rule
- this seed taxonomy is the starting EveryCall registry for implementation
- it is **extensible**, but Codex should not collapse it into NAICS or invent a different primary taxonomy
- future domains/subdomains may be added through the pack registry without changing the architectural model


## Tenant assignment model

A tenant may have one or more active domain/subdomain assignments.

### Example
A business may be assigned:
- `service_business.hvac`
- `service_business.plumbing`
- `service_business.electrical`

A medical group may be assigned:
- `medical.primary_care`
- `medical.dermatology`

## Runtime activation model

The system resolves active behavior per turn.

### Effective runtime composition
1. universal core
2. Business Call Intent Card
3. active domain pack
4. active subdomain pack
5. published tenant knowledge build
6. tenant overrides and guardrails
7. runtime bundle
8. gateway call state

### Runtime activation inputs
- current caller utterance
- call history
- current call state
- active provider/location/service if already known
- retrieved entities and alias matches
- prior turn intent

### Runtime activation algorithm
1. score candidate domain/subdomain pairs from the utterance and state
2. prefer currently active domain/subdomain unless the new utterance strongly indicates a switch
3. if a switch occurs, log the switch reason in call state
4. use the active domain/subdomain to constrain retrieval and prompt behavior
5. continue to allow follow-up questions to resolve within the active domain until evidence indicates otherwise

## Multi-domain tenant rules

- a tenant may have multiple domain/subdomain assignments
- each assignment may have its own eval status
- one Business Call Intent Card may sit above multiple assignments
- overrides may be global or scoped to a specific domain/subdomain
- the runtime bundle must always identify the active domain and subdomain explicitly

## Recommended initial taxonomy strategy

For v1:
- keep the list intentionally small
- prefer fewer, better-tested subdomains over a long shallow list
- use domain creation only when there are meaningful runtime differences
- prefer subdomains for specialty deltas inside an established domain

## Open implementation decision reserved for Codex

Codex may choose whether domain/subdomain IDs live in:
- lookup tables with foreign keys
- JSON-config records loaded at boot
- versioned pack files synced into a database

What must remain true:
- one canonical pack per domain
- one canonical pack per subdomain
- effective behavior must be compositional
- active domain/subdomain must be explicit at runtime
