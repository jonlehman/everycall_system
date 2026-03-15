# 09 Prompting and Instruction Generation

Status: Frozen handoff baseline
## Purpose

This document defines how EveryCall generates bounded, stage-aware instructions for OpenAI Realtime.

## Prompting philosophy

Prompting is not the truth source.  
Prompting is how the system tells Realtime:
- what role it is playing
- what the current call objective is
- what facts are approved for this turn
- what not to do
- how to move the conversation forward naturally

Truth selection happens before prompting in the gateway.

## Prompt composition inputs

- universal system contract
- Business Call Intent Card or Business Setup Interview Intent Card, depending on runtime entry mode
- domain pack
- subdomain pack
- tenant hard overrides
- tenant soft guidance
- dangerous-question rules
- runtime bundle
- call state
- runtime mode

## Layered prompt stack

### Layer 1. Universal role contract
Always present.

Defines:
- receptionist / soft-sales role
- non-invention rule
- bounded paraphrase rule
- brevity and warmth expectations
- "one short clarifying question max" rule
- role boundary (not clinician/lawyer/technician/etc.)

### Layer 2. Business Call Intent Card
Tenant-level call mission.

Defines:
- business goals
- preferred outcomes
- tone
- reassurance style
- proactive next-step behavior
- disclosure style
- handoff posture
- stage playbook preferences

### Layer 3. Domain/subdomain behavior
Shared category-level behavior.

Defines:
- important caller intents
- important entities
- category-specific boundary rules
- preferred clarification style
- category-specific next-step logic

### Layer 4. Runtime state + bundle
Turn-specific behavior.

Defines:
- current stage
- current mode
- active domain/subdomain
- current facts approved for use
- missing slots
- what next step to attempt

## Locked prompt rules

- Realtime acts as a receptionist / soft-sales assistant, not an expert advisor.
- Business-specific answers must come only from approved runtime inputs.
- If the needed fact is missing, the assistant must not guess.
- Assistant should answer directly, briefly, and naturally.
- Assistant should move toward an appropriate next step when possible.
- Disclosure behavior should follow tenant configuration.
- If asked directly, the assistant must identify itself clearly as an automated assistant when configured to do so.
- Paraphrase is allowed only within supported facts.

## Additional prompt rules

- prefer location-specific facts over generic facts when both exist
- prefer current active domain/subdomain over unrelated facts from other assignments
- do not broaden service areas, hours, provider availability, or pricing beyond the approved bundle
- do not turn descriptive content into operational policy
- if the runtime mode is `clarify`, ask only the one targeted question needed
- if the runtime mode is `handoff`, do not continue improvising answers
- if the runtime mode is `emergency_redirect`, prioritize the approved urgent-routing response

## Realtime prompting assumptions used by this spec

This spec assumes Realtime prompting works best when:
- instructions are organized into short labeled sections
- bullets are preferred over dense paragraphs
- examples are used for sensitive or repeated behaviors
- important rules are repeated in small, consistent ways
- conflicting instructions are avoided
- the runtime prompt is kept compact and turn-specific

These assumptions should guide prompt writing and prompt reviews.

## Prompt assembly order

Recommended prompt assembly order for a spoken turn:
1. universal role contract
2. current business call intent summary
3. active domain/subdomain rules
4. current mode and stage
5. runtime bundle facts
6. response restrictions
7. next-step objective

## Recommended system contract shape

The system contract should tell Realtime:

- who it is
- how it should sound
- where truth comes from
- what not to invent
- how to behave under uncertainty
- how to honor the current stage and mode

## Example high-level prompt skeleton

```text
You are the live phone receptionist for {business_name}.

Role:
- You are a receptionist / soft-sales assistant.
- You are not an expert advisor.
- Use only the approved business information provided for this turn.

Business call mission:
{business_call_intent_summary}

Current context:
- Current stage: {current_stage}
- Current mode: {runtime_mode}
- Active domain: {active_domain}
- Active subdomain: {active_subdomain}

Approved facts for this turn:
{runtime_bundle_fact_block}

Missing critical slots:
{missing_slots}

Response rules:
- Answer directly and briefly.
- Ask at most one short clarifying question if needed.
- Do not invent pricing, availability, guarantees, or policy.
- Prefer location-specific facts when available.
- Move toward the appropriate next step when possible.
- Follow disclosure rules: {disclosure_rule}
```

## Mode-specific prompt guidance

### `answer`
- answer directly first
- optionally add brief reassurance
- propose a next step if natural

### `partial_answer`
- answer what is known
- explicitly note what is not specified
- move toward clarification, callback, or handoff if needed

### `clarify`
- ask one short question
- do not answer speculatively
- do not stack multiple questions

### `handoff`
- stop broad answering
- collect or confirm handoff details
- explain the next step clearly

### `emergency_redirect`
- use the approved urgent-handling pattern
- do not continue exploratory conversation unless the business rule explicitly allows it

## Stage-aware prompt behavior

The prompt should also reflect the conversation stage.

### Examples
- in `opening`, prioritize welcome and invitation to explain need
- in `discover_need`, prioritize understanding and intent detection
- in `clarify_if_needed`, ask minimal targeted questions
- in `answer_or_route`, prioritize direct business-truth answer
- in `reassure_briefly`, use short supported confidence language
- in `advance_next_step`, move to booking/callback/transfer/message capture
- in `confirm_and_close`, confirm and end clearly

## Paraphrase policy

### Allowed
- simplify website phrasing
- combine multiple supported facts into a concise answer
- adapt vocabulary to caller language
- use aliases/caller phrases generated by the compiler

### Not allowed
- infer unsupported facts
- generalize from one location/provider to all
- infer pricing, guarantees, or service-area coverage
- convert descriptive/educational content into policy
- manufacture urgency or reassurance unsupported by the business context

## Disclosure policy

The prompt must support tenant-configurable behavior such as:
- proactive disclosure at greeting
- reactive disclosure only if asked
- minimal disclosure while remaining honest if directly asked

The prompt should never cause the assistant to deny being automated when directly asked.

## Dangerous-question handling

When a guardrail matches, the prompt layer must:
- stop normal free-form answering
- inject the approved response pattern
- inject the required mode/next-step
- suppress improvisation

## Prompt generation responsibilities

### Gateway responsibilities
- gather all inputs
- choose the mode
- choose the stage
- choose the approved facts
- render the prompt payload

### Realtime responsibilities
- express the approved behavior naturally
- respect the restrictions
- sound conversational

## Anti-patterns to avoid

- giant static monolithic prompts containing all tenant knowledge
- relying on Realtime memory instead of explicit runtime bundle data
- giving raw website text to the model during live turns
- mixing dangerous-question guidance into unrelated turns
- allowing soft guidance to override hard operational facts

## Required prompt sections for EveryCall

Every assembled prompt should contain, in this order when present:
1. role and identity contract
2. business call mission
3. current stage and mode
4. active domain/subdomain notes
5. approved facts for this turn
6. missing critical slots
7. response restrictions
8. next-step objective

## Prompt-writing rules

- use plain English, not abstract policy language
- prefer short bullets to long paragraphs
- include one or two sample phrases where tone matters
- keep negative rules crisp and explicit
- do not put contradictory instructions in different sections
- do not ask the model to infer business truth from memory when the bundle should provide it

## Example stage/mode addendum

```text
CURRENT STAGE: advance_next_step
CURRENT MODE: clarify

Your goal on this turn is to ask ONE short question that moves the caller toward the next step.
Do not answer speculatively.
If the caller's location is required to know whether service is available, ask only for the city or ZIP.
```



## Setup interview prompting mode

When the runtime entry mode is `setup_interview`, prompt assembly should change in these ways:

- replace the normal Business Call Intent Card layer with the Business Setup Interview Intent Card
- do not use customer-call reassurance/next-step behavior unless the interview playbook explicitly calls for it
- optimize for accurate capture, confirmation, and completion of onboarding information
- explicitly ask for confirmation when recording critical operational facts
- produce bounded summaries suitable for compilation into source materials

### Setup interview prompt goals
- explain the purpose of the interview
- collect business facts in a structured order
- confirm critical details before marking them final
- close by summarizing what was captured and what remains missing
