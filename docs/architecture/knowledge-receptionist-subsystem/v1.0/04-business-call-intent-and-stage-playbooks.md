# 04 Business Call Intent and Stage Playbooks

Status: Frozen handoff baseline
## Purpose

This document defines the tenant-specific behavior layer that answers:

**"What should a successful phone call feel like for this business?"**

This layer is separate from domain/subdomain behavior and separate from knowledge retrieval.  
It tells the system how to behave as a receptionist / soft-sales assistant for a specific business.

This document also defines the separate **Business Setup Interview Intent Card** used when the system interviews the owner/operator to collect business knowledge and onboarding configuration.

## Business Call Intent Card

Required per tenant before go-live.

### Purpose
Defines what success on a call means for that business.

### Minimum contents
- primary goal
- secondary goals
- preferred outcomes
- disallowed outcomes
- tone rules
- soft-sales posture
- disclosure strategy
- handoff strategy
- after-hours strategy
- conversation stage playbook

### Recommended additional contents
- preferred terminology
- preferred brevity level
- reassurance style
- proactive next-step policy
- which data should be captured before close
- global do-not-say guidance
- escalation thresholds
- AI identity/disclosure wording

## Business Call Intent Card model

### Stable business-level mission
This answers:
- what the business wants the assistant to accomplish
- how assertive or gentle the assistant should be
- what next steps matter most
- how to behave under uncertainty

### Example goals
- welcome callers and make them feel heard
- determine what the caller needs
- answer factual questions when the website supports it
- build confidence that the business can help
- move toward booking, consultation, estimate, callback, transfer, or message-taking
- capture structured information that helps the business follow up

### Example disallowed outcomes
- make unsupported promises
- improvise pricing
- act like a clinician/lawyer/technician
- be robotic or overly verbose
- end the call without a next step when one is appropriate

## Conversation stage playbook

The playbook is a **goal-oriented structure**, not a rigid script.

### Why stages exist
The stages give the call a repeatable shape:
- welcome
- understand
- answer
- reassure
- advance
- close

This reduces the risk that the assistant:
- answers correctly but fails to guide the call
- captures details without warmth
- sounds robotic
- skips the next step

### Universal default stages
1. `opening`
2. `discover_need`
3. `clarify_if_needed`
4. `answer_or_route`
5. `reassure_briefly`
6. `advance_next_step`
7. `confirm_and_close`

### Core rules
- stages are ordered, but skippable and revisitable
- stages are not scripts; they are execution goals
- the gateway tracks stage progression
- reassurance must remain within supported facts
- calls should normally end with a clear next step or clean close
- the stage playbook is customizable per business

## Stage definition contract

Each stage definition must include:
- `stage_id`
- `name`
- `purpose`
- `when_to_enter`
- `required_inputs`
- `recommended_actions`
- `disallowed_actions`
- `exit_conditions`
- `success_criteria`
- `mandatory_or_optional`
- `max_questions`
- `next_possible_stages`

## Detailed stage guidance

### 1. `opening`
**Purpose**  
Open warmly, identify the business, and invite the caller to explain the need.

**Required inputs**
- business name
- greeting style
- disclosure style if proactive disclosure is enabled

**Recommended actions**
- greet briefly
- identify the business
- ask how to help

**Disallowed**
- long disclaimers
- long menu-like intros
- forcing a rigid script when the caller is already speaking

**Success criteria**
- caller understands they reached the business
- caller has a clear opening to state their need

### 2. `discover_need`
**Purpose**  
Identify the caller's primary need, question, or requested next step.

**Recommended actions**
- listen for service/product/provider/location cues
- identify the likely turn intent
- detect whether the need sounds informational, booking-oriented, urgent, or out of scope

**Success criteria**
- a primary caller need is identified or a clarifier is clearly required

### 3. `clarify_if_needed`
**Purpose**  
Ask only the minimum clarifying question(s) needed to answer or proceed.

**Recommended actions**
- ask one concise question when a critical slot is missing
- focus on missing location, service type, provider, urgency, or customer status only when needed

**Disallowed**
- interrogating the caller
- asking for data that is not needed yet

**Success criteria**
- enough information is available to answer or advance the call

### 4. `answer_or_route`
**Purpose**  
Answer directly from the approved knowledge bundle or route to the correct bounded mode.

**Recommended actions**
- answer directly first when possible
- switch to route/handoff/emergency mode when required
- keep the answer short, specific, and conversational

**Success criteria**
- the caller's immediate question or routing need is handled

### 5. `reassure_briefly`
**Purpose**  
Provide a brief confidence-building signal that the caller is in the right place, without making unsupported promises.

**Recommended actions**
- use supported phrasing such as:
  - "Yes, that's something we help with."
  - "You're in the right place for that."
  - "We do work with customers on that kind of issue."

**Disallowed**
- guarantees
- technical certainty beyond the evidence
- exaggerated sales language

**Success criteria**
- caller receives a brief confidence-building cue and the call maintains momentum

### 6. `advance_next_step`
**Purpose**  
Move the call toward the appropriate business outcome.

**Possible next steps**
- schedule
- request estimate
- consultation request
- callback
- message-taking
- transfer
- intake capture
- emergency routing
- explain what happens next

**Success criteria**
- one concrete next step is proposed or executed

### 7. `confirm_and_close`
**Purpose**  
Confirm the agreed next step and close the call clearly and warmly.

**Recommended actions**
- confirm captured details when relevant
- confirm what will happen next
- thank the caller

**Success criteria**
- caller knows the outcome and next step
- the call ends cleanly

## Mandatory vs optional stage behavior

### Mandatory on most calls
- `opening`
- `discover_need`
- `answer_or_route`
- `advance_next_step`
- `confirm_and_close`

### Optional or conditional
- `clarify_if_needed`
- `reassure_briefly`

## Stage progression model

The gateway, not Realtime alone, is the authoritative owner of stage state.

### Gateway-tracked fields
- current stage
- completed stages
- skipped stages
- pending clarifier
- stage switch reason
- stage success status

### Transition rules
- transitions may be driven by caller input or runtime mode
- interruption may cause stage re-entry
- the system may skip directly from discovery to route/handoff if required
- the system may return from next-step discussion to answer mode if the caller asks a new question

## Tenant customization model

Businesses may customize:
- greeting tone
- stage order preferences where safe
- whether reassurance is proactive or only situational
- how strongly the assistant should push toward a next step
- what next steps are preferred
- what fields must be captured before close
- whether AI disclosure is proactive, reactive, or minimal

Businesses may not customize:
- truth boundaries
- hard override precedence
- out-of-scope handling safety rules
- core non-invention rule

## Relationship to domain/subdomain packs

The Business Call Intent Card answers:
- how the business wants calls to feel
- what success looks like
- how next steps should be prioritized

Domain/subdomain packs answer:
- what kinds of caller intents exist
- what entities matter
- what boundaries apply
- how retrieval/ranking should work

Both are required. Neither replaces the other.


## Business Setup Interview Intent Card

Used when the main system places the tenant into **setup interview mode** instead of normal caller-receptionist mode.

### Purpose
Guide a structured phone interview with the owner/operator so the system can capture business truth and onboarding preferences before go-live.

### Why it exists
Some businesses will not want to rely only on a website.  
The setup interview provides a first-party, business-confirmed source channel that can feed the same compiler used for websites and uploaded documents.

### Minimum contents
- interview mission
- required capture categories
- confirmation policy
- completion criteria
- interview stage playbook
- allowed follow-up depth
- escalation / pause-and-resume behavior

### Output expectations
A completed setup interview should produce:
- raw transcript
- structured captured fields
- confirmed summary blocks
- source refs tagged as `owner_interview`
- compile eligibility signal for knowledge-build generation

### Default setup interview stages
1. `intro_and_consent`
2. `business_identity_and_contact_basics`
3. `offerings_and_service_scope`
4. `locations_service_areas_and_hours`
5. `policies_processes_and_boundaries`
6. `dangerous_questions_and_exclusions`
7. `call_behavior_and_next_step_preferences`
8. `review_and_confirm`
9. `completion`

### Core rules
- this playbook is separate from live customer-call stages
- the main system selects it explicitly
- completion should require confirmation of critical operational fields
- interview answers may be compiled into knowledge artifacts the same way website/document content is compiled
- a completed setup interview may satisfy source-readiness requirements even if no website is used

## Setup interview stage guidance

### `intro_and_consent`
Explain that the call is collecting business information to configure the system correctly.

### `business_identity_and_contact_basics`
Capture business name, contact points, key locations, transfer numbers, and who should receive follow-up.

### `offerings_and_service_scope`
Capture what the business offers, common caller needs, and what the business does not offer.

### `locations_service_areas_and_hours`
Capture office locations, service areas, hours, after-hours behavior, and location-specific nuances.

### `policies_processes_and_boundaries`
Capture appointment/estimate flow, insurance/financing/referral constraints where relevant, and other operational rules.

### `dangerous_questions_and_exclusions`
Capture the questions that should trigger special handling and the approved direction for those questions.

### `call_behavior_and_next_step_preferences`
Capture the desired soft-sales posture, reassurance style, preferred next steps, and what should be collected before ending a customer call.

### `review_and_confirm`
Read back the critical captured facts in compact form and ask for confirmation or correction.

### `completion`
Mark the interview as complete only when the required fields and confirmation steps have been satisfied.
