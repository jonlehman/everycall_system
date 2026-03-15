# 10 Overrides, Guardrails, and Business Configuration

Status: Frozen handoff baseline
## Purpose

This document defines the tenant-controlled layer that lets businesses shape runtime behavior without editing domain packs or raw compiled source artifacts.

## Configuration categories

1. hard overrides
2. temporary operational notices
3. soft guidance
4. approved answer snippets
5. dangerous-question rules
6. business call intent configuration
7. outcome-capture preferences

## Hard overrides

Hard overrides are authoritative operational facts.

### Examples
- hours
- address
- phone number
- service area
- transfer number
- holiday closure
- after-hours routing
- specific office/provider availability rule
- "do not offer same-day service in City X"

### Rules
- hard overrides outrank compiled knowledge from any approved source channel
- hard overrides may be global or scoped
- hard overrides should support effective date windows
- hard overrides should be audited and versioned

## Temporary operational notices

These are time-bound instructions that may supersede normal compiled business truth.

### Examples
- "Office closed on Friday for holiday"
- "Phones answered after hours this weekend"
- "Estimator booked out until next Tuesday"
- "Location under renovation; use alternate entrance"

### Rules
- temporary notices outrank compiled knowledge during their effective window
- expired notices should deactivate automatically
- temporary notices should be easy for tenant admins to create quickly

## Soft guidance

Soft guidance changes behavior or phrasing but is not a hard fact source.

### Examples
- preferred terminology
- preferred phrasing
- example answers
- reassurance language
- upsell guidance
- "do not mention financing unless asked"
- "always offer a callback if booking is unavailable"

### Rules
- soft guidance may not override hard facts
- soft guidance may be global or scoped
- soft guidance should be clearly labeled as non-authoritative

## Approved answer snippets

These are curated response patterns for important recurring questions.

### Examples
- "How does your estimate process work?"
- "Do you service my area?"
- "Are you accepting new patients?"
- "What happens after hours?"

### Rules
- approved answer snippets are higher priority than compiled generic answer phrasing
- they may include placeholders for runtime fields
- they may be scoped to intent/domain/subdomain

## Dangerous-question playbook

Dangerous questions are questions that require bounded handling.

### Common classes
- pricing questions without authoritative pricing
- guarantee or outcome questions
- emergency/safety questions
- regulated advice questions
- insurance/coverage questions
- legal/tax/medical interpretation questions
- service-area or availability questions with unresolved conflict

### Per-guardrail fields
- trigger patterns
- trigger intents
- risk level
- required mode
- approved response pattern
- required next step
- optional capture fields
- escalation instruction

### Rules
- dangerous-question playbook must be configurable
- dangerous-question rules must be evaluable by runtime before free-form answer generation
- dangerous-question rules may route directly to `handoff` or `emergency_redirect`

## Tenant-configurable settings

### Greeting
- business name pronunciation
- greeting phrasing
- whether to include AI disclosure in greeting
- after-hours greeting variant

### Terminology
- appointment vs visit vs consult
- estimate vs quote vs inspection
- patient vs client vs customer
- provider vs doctor vs attorney vs advisor

### Call behavior
- soft-sales intensity
- reassurance style
- whether to proactively suggest next steps
- preferred callback strategy
- when to transfer to a human

### Disclosure
- proactive
- reactive-if-asked
- tenant-provided wording

### Outcomes
- which call outcomes are preferred
- which data must be captured before close
- which outcomes are disallowed after hours

## Scope model

Overrides and guardrails may be scoped to:
- all calls for the tenant
- a domain
- a subdomain
- a location
- a provider/person
- a time window
- a caller-turn intent
- a runtime mode

## Merge order at runtime

Apply in this order:
1. hard overrides
2. temporary notices
3. dangerous-question rules / approved answer snippets
4. business call intent configuration
5. soft guidance

This sits above compiled knowledge from any source channel.


## Approval workflow for high-impact configuration changes

The architecture must support both simple and reviewed change workflows.

### Single-admin tenant default
If a tenant effectively has one trusted admin, changes may go live immediately after save, provided they are fully audited.

### Multi-user tenant reviewed mode
If a tenant has multiple admins or EveryCall policy requires review, the system should support a reviewed mode where these changes are created as drafts first:
- hard overrides
- temporary operational notices
- dangerous-question rules
- approved answer snippets
- Business Call Intent Card changes
- source-authority promotions for uploaded docs and interview-confirmed facts

In reviewed mode:
- draft changes do not affect runtime until approved
- approval should require either a second qualified tenant admin or an EveryCall admin
- rejection should preserve the draft and audit trail
- emergency notices may allow privileged immediate publish with explicit audit logging

### Required states
Recommended minimum states:
- `draft`
- `approved_live`
- `rejected`
- `expired` (for time-bound notices)

## Auditability

All override and guardrail artifacts should support:
- created_by / updated_by
- timestamps
- status
- change notes
- effective window
- optional approval workflow

## Recommended admin UX fields

Even if Codex chooses a different UI structure, the system should support editing:
- business greeting
- disclosure mode
- preferred terminology
- handoff number/strategy
- after-hours behavior
- hard hours/address/phone/service-area overrides
- dangerous-question list
- approved answer examples
- preferred next-step outcomes

## Constraints

Tenant customization must not be allowed to:
- erase hard non-invention rules
- bypass emergency routing rules when required by guardrail
- create hidden contradictory operational behavior without auditability
- weaken hard override precedence

## Suggested future extensions

Deferred but compatible:
- seasonal templates
- campaign-specific guidance
- department/routing-specific soft guidance
- CRM outcome mappings


## Source-channel business controls

Tenant/admin configuration should also support source-channel controls for non-website ingestion.

### Required controls
- upload documents into approved batches
- mark uploaded docs as operational/policy/reference when known
- launch or resume the owner/operator setup interview flow
- review setup interview completion status
- review which source channels are currently represented in the active build

### Rules
- these controls do not replace hard overrides
- uploaded docs and interview outputs still pass through the same compiler
- source approval/status should be visible to reviewers before publish
