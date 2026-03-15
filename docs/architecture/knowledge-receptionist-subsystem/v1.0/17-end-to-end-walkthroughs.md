# 17 End-to-End Walkthroughs

Status: Draft — implementation walkthroughs

## Purpose

This document gives Codex and QA a set of concrete, end-to-end examples showing how the subsystem should behave from crawl through live-call handling. These are not merely examples; they are completeness checks. If the architecture cannot cleanly explain these walkthroughs, the spec is missing something.

## Walkthrough 1 — Single-domain service business

### Business
A plumbing company serving Bellevue and Renton.

### Ingestion
- customer manually triggers website crawl
- site pages are captured and segmented
- service pages produce cards like `Drain Cleaning`, `Hydro Jetting`, `Water Heater Repair`
- service-area pages produce `Service Area: Bellevue` and `Service Area: Renton` cards
- financing page produces a policy card

### Business Call Intent
- primary goal: welcome callers and move them toward service or callback
- preferred outcomes: schedule, callback, capture lead
- reassurance is proactive but brief

### Live call
Caller: “My water heater is leaking. Do you work in Bellevue?”

### Runtime
- active domain: `service_business`
- active subdomain: `plumbing`
- turn intent: service_capability + service_area_question
- bundle includes:
  - `Water Heater Repair` card
  - `Service Area: Bellevue` card
  - `Emergency / Urgent Water Heater Guidance` card if present

### Expected answer shape
- yes/no service capability answer
- city coverage answer
- brief reassurance
- next step: offer estimate, callback, or live transfer based on tenant config

## Walkthrough 2 — Multi-domain service business

### Business
A company offering HVAC, plumbing, and electrical services.

### Tenant assignment
- `service_business.hvac`
- `service_business.plumbing`
- `service_business.electrical`

### Live call sequence
Turn 1: “My AC is not cooling.”
Turn 2: “Also, do you install EV chargers?”

### Runtime expectations
Turn 1:
- activate `service_business.hvac`
- retrieve AC repair cards

Turn 2:
- detect strong switch to electrical
- log switch reason in call state
- activate `service_business.electrical`
- retrieve EV charger installation card

### Required behavior
- follow-up continuity should remain natural
- domain switch must be explicit in call state
- the assistant should not answer the EV charger question from HVAC knowledge

## Walkthrough 3 — Medical office

### Business
A primary care clinic with provider bios, insurance page, and new-patient page.

### Tenant assignment
- `medical.primary_care`

### Business Call Intent
- warm front-desk style
- answer operational questions
- move toward appointment, callback, or message-taking
- do not diagnose

### Live call
Caller: “Do you take Aetna, and are you accepting new patients?”

### Runtime
- active domain: `medical`
- active subdomain: `primary_care`
- turn intent: insurance_question + new_patient_question
- bundle includes:
  - `Accepted Insurance` policy card
  - `New Patients` policy/process card
  - optional `Location` card if needed

### Expected answer shape
- operational answer only
- no medical advice
- if provider/location specificity is required, ask one short clarifier
- next step: appointment/callback/message based on tenant config

## Walkthrough 4 — Professional services firm

### Business
A CPA firm offering bookkeeping, tax prep, and payroll.

### Tenant assignment
- `accounting.cpa_firm`

### Live call
Caller: “Do you handle small-business bookkeeping, and how do consultations work?”

### Runtime
- retrieve `Bookkeeping Service` card
- retrieve `Consultation Process` card
- optionally retrieve `Industries Served` card if it materially helps

### Expected answer shape
- yes/no capability answer
- concise process explanation
- confidence-building reassurance
- next step: consultation request or callback

## Walkthrough 5 — Website conflict plus hard override

### Business
A window installer whose site still says Saturday hours on one page, but tenant hard override says closed Saturdays.

### Runtime rule
Hard override wins.

### Live call
Caller: “Are you open this Saturday?”

### Expected behavior
- answer from hard override, not the lower-priority compiled public-site card
- no mention of conflicting website text
- optionally route to callback or Monday follow-up

## Walkthrough 6 — Dangerous question playbook

### Business
A plumbing company with no on-site pricing.

### Guardrail
“What will it cost?” should not trigger invented estimates.

### Live call
Caller: “How much to replace my water heater?”

### Expected behavior
- do not invent price
- use approved pricing uncertainty pattern
- move toward estimate, callback, or onsite evaluation

## Walkthrough 7 — Stage-playbook customization

### Business
A law firm that wants a calmer, intake-first tone and no proactive reassurance until after conflict-check style questions.

### Required behavior
- same universal stages still exist
- tenant stage playbook changes when reassurance appears and how strong next-step prompting is
- truth boundaries remain unchanged

## What these walkthroughs validate

These scenarios jointly validate:
- single-domain behavior
- multi-domain switching
- business-call-intent behavior
- stage progression
- policy vs service answers
- override precedence
- dangerous-question handling
- broad cross-vertical applicability


## Walkthrough 8 — Owner interview only onboarding

### Business
A new consulting firm with no meaningful website yet.

### Setup
- main system selects `setup_interview` runtime entry mode
- Business Setup Interview Intent Card runs through onboarding stages
- transcript and confirmed summaries are stored as `owner_interview` source refs
- compiler generates facts/cards from interview output only

### Expected readiness behavior
- no website is required
- go-live remains blocked until interview completion criteria are met
- once interview-derived build is published and readiness items pass, the tenant can be enabled

## Walkthrough 9 — Website plus uploaded policy documents

### Business
A dermatology clinic with a website plus uploaded PDF packet for accepted insurance and new-patient forms.

### Ingestion
- customer triggers build using website + uploaded docs
- uploaded docs are typed as operational/policy docs
- insurance and forms facts are extracted from uploaded docs and website pages

### Expected precedence behavior
- uploaded operational docs outrank incidental website mentions when conflicts exist
- public blog content does not overrule either source
