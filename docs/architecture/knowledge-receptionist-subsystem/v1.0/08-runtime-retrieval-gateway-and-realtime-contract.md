# 08 Runtime Retrieval, Gateway, and Realtime Contract

Status: Frozen handoff baseline
## Purpose

This document specifies the live-call runtime contract between:
- the EveryCall gateway
- retrieval and call-state logic
- OpenAI Realtime

## Authority split

### Gateway is authoritative for
- truth selection
- active domain/subdomain selection
- call state
- stage progression
- mode selection
- runtime bundle assembly
- override/guardrail enforcement
- handoff/callback capture rules

### OpenAI Realtime is responsible for
- natural turn-taking
- natural spoken delivery
- interruption-friendly conversational flow
- tool execution as instructed by the gateway
- sounding like a warm, concise receptionist / soft-sales assistant

## Recommended integration stance

For EveryCall phone-call use cases:
- use **server-side WebSockets** to Realtime
- keep VAD available for turn boundaries
- prefer **gateway-controlled response creation** over unrestricted model auto-response
- keep conversation continuity in Realtime, but keep authoritative business state in the gateway

## OpenAI Realtime assumptions used by this spec

This spec intentionally assumes the following current Realtime behavior:
- a Realtime session is stateful and carries a conversation across turns
- server-side phone-call agents should prefer WebSockets
- session configuration can be updated during the session
- server-side VAD can be used without automatic response creation
- the gateway may trigger bounded replies turn-by-turn
- business logic and tool orchestration should remain on the application server

These assumptions are used to justify the gateway-first architecture in this bundle.

## Core runtime objects

- `business_call_intent`
- optional `setup_interview_intent`
- active `domain_pack`
- active `subdomain_pack`
- active published `knowledge_build`
- active `knowledge_override` / `knowledge_guardrail`
- `runtime_bundle`
- `call_state`

## Runtime entry modes

### `customer_call`
Normal receptionist / soft-sales runtime.

### `setup_interview`
Owner/operator onboarding interview runtime using the Business Setup Interview Intent Card.

In `setup_interview` mode:
- the gateway should use the interview playbook, not the customer-call stage playbook
- the gateway should capture structured business facts and confirmations
- the resulting transcript and confirmed summary blocks should become approved source inputs for the compiler
- go-live should remain blocked until interview completion criteria are satisfied

## Expected turn flow

1. Caller speaks
2. Turn boundary is detected
3. Gateway transcribes/interprets the new turn context
4. Gateway resolves caller turn intent
5. Gateway selects or confirms the active domain/subdomain
6. Gateway updates stage progression
7. Gateway retrieves and ranks candidate cards
8. Gateway assembles the runtime bundle
9. Gateway chooses runtime mode
10. Gateway sends bounded response instructions to Realtime
11. Realtime speaks naturally
12. Gateway records output/state/outcome updates

## Runtime modes

### `answer`
Use when:
- intent is clear
- no critical slot is missing
- a strong bundle exists

### `partial_answer`
Use when:
- the system can answer the main point
- one non-critical detail is missing or unspecified

### `clarify`
Use when:
- exactly one critical missing slot blocks a good answer or next step
- a short clarifying question is appropriate

### `handoff`
Use when:
- uncertainty remains high
- the business prefers human follow-up
- the caller explicitly asks for a human
- a guardrail requires transfer/message-taking

### `emergency_redirect`
Use when:
- domain/subdomain/tenant guardrails mark the situation as urgent or outside safe receptionist handling

## Runtime mode rules

- ask at most one short clarifying question when clarification is needed
- prefer active domain/subdomain and active call state
- prefer location-specific facts over generic facts
- do not invent pricing, availability, guarantees, or business-specific policy
- use gateway-side state for follow-ups and stage progression
- support interruption handling
- optimize for perceived immediacy and very small bundles

## Call state model

The gateway must maintain state fields that are independent of model memory.

### Required fields
- current stage
- completed/skipped stages
- active domain/subdomain
- active service/offering
- active location
- active person/provider
- pending clarifier
- last turn intent
- last bundle ID
- captured fields
- outcome in progress
- uncertainty mode

## Stage progression

The current stage should be derived from:
- prior stage
- current turn intent
- current runtime mode
- what information is already captured
- what next-step goal the business prefers

### Example
If the caller asks:
- "Do you work in Bellevue?"
the flow may be:
- `opening` → `discover_need` → `answer_or_route` → `reassure_briefly` → `advance_next_step`

If the caller says:
- "I need to know if you take Aetna"
and the location/provider is ambiguous:
- `opening` → `discover_need` → `clarify_if_needed` → `answer_or_route` → `advance_next_step`

## Active domain/subdomain selection

### Inputs
- current caller utterance
- alias/entity matches
- prior call state
- current stage
- currently active domain/subdomain
- domain/subdomain pack intent coverage

### Decision rule
1. score candidate assignments
2. prefer the currently active assignment unless evidence for a switch is strong
3. record switch events in call state
4. ensure the runtime bundle names the active assignment explicitly

## Retrieval contract

### Retrieval objective
Return the smallest set of cards that allows Realtime to answer naturally and safely.

### Retrieval strategy
Use hybrid retrieval:
- exact and alias matching
- entity-tag and caller-phrase matching
- domain/subdomain filter
- scope filter (location/provider/offering)
- embedding similarity
- precedence and content-class weighting


### Retrieval stack contract
The runtime retrieval layer must support all of the following:
- exact lexical lookup
- alias and caller-phrase lookup
- metadata filtering by tenant, domain, subdomain, location, provider, and content class
- embedding/vector similarity
- precedence-aware reranking
- warm-turn caching using current call state and recent bundle history

Codex may choose the exact storage/index technology, but the architecture requires the above retrieval behaviors.


### Retrieval output
Return:
- primary card(s)
- supporting policy/boundary card(s)
- optional next-step/process card(s)
- optional reassurance/trust card(s), if supported and useful

### Bundle size rule
The runtime bundle should normally contain only the cards needed to:
- answer
- clarify
- advance the next step

Do not dump large card sets into Realtime.


### Bundle cardinality and token budget
- normal selected card count: 2 to 4
- hard maximum selected card count: 6
- normal selected answer fact count: 3 to 8
- hard maximum selected answer fact count: 12
- soft runtime-bundle budget injected into turn instructions: about 1200 input tokens
- hard runtime-bundle budget injected into turn instructions: 1800 input tokens

If the hard budget would be exceeded, the gateway must trim in this order:
1. optional trust/reassurance cards
2. optional process/next-step support cards
3. descriptive support facts
4. non-critical supporting policy facts that are not needed for the current answer

The gateway must not trim away the primary truth needed to answer safely.


## Runtime bundle assembly

A runtime bundle should contain:
- active domain/subdomain
- detected turn intent
- current mode
- selected cards
- selected answer facts
- missing critical slots
- state delta
- response rules
- confidence score

### Response rules examples
- "Answer only from the bundle."
- "Do not invent pricing."
- "Ask for location if needed."
- "Prefer the Bellevue service-area card over the global service card."
- "Use callback capture if confidence remains low."

## Realtime session configuration strategy

### Recommended pattern
- configure the session once at call start with durable behavior
- update session-level tools/instructions only when needed
- prefer **per-turn `response.create` instructions** for bounded answering
- let the gateway decide whether the next turn should answer, clarify, hand off, or redirect

### Why
This prevents the model from drifting into:
- generic world knowledge answers
- stale assumptions from earlier turns
- unsupported promises
- excessive verbosity

## Interruption handling

The runtime must assume callers will interrupt.

### Required behavior
- stop or cancel active speech when a new caller turn begins, when supported by configuration
- ensure any partially delivered answer does not remain misleadingly "committed" in business logic
- keep gateway state authoritative even if audio playback is interrupted
- allow stage re-entry after interruption

## Follow-up questions

Follow-up turns should usually use:
- current `call_state`
- prior selected cards/bundles
- current active domain/subdomain

The runtime should avoid re-running broad search from scratch when the caller is clearly following up inside the same topic.

## Latency guidance

### Product target
- hot follow-up turns should aim for extremely fast perceived response start
- ordinary turns should begin speaking quickly enough to feel conversational, not search-like


### Architecture latency contract
The subsystem must be designed to meet these targets in normal production conditions:

- warm follow-up turn retrieval + bundle assembly: p95 <= 250 ms
- non-warm turn retrieval + bundle assembly: p95 <= 600 ms
- ordinary perceived speech start after a caller turn: p95 <= 900 ms

These are architecture targets, not guarantees against all network or provider variance.
The product should strive for near-250 ms perceived response start on hot follow-up turns whenever feasible.

### Engineering implications
- use small bundles
- cache recent state and recent top cards
- precompute embeddings/aliases
- avoid heavy live compile logic during calls
- do not hit schema migration/bootstrap on the hot path

## Tooling expectations

Realtime may be given a minimal tool set such as:
- `knowledge_lookup`
- `data_capture`
- `end_call`
- optional `handoff`/`transfer` helper

However, the gateway should remain the orchestrator of when these tools are meaningful.

## Out-of-band analysis option

Codex may optionally use out-of-band Realtime responses for parallel analysis tasks such as:
- transcription refinement
- silent QA tagging
- summarization

If used, those tasks must not pollute the main spoken conversation state.

## Runtime non-goals

The runtime is not trying to:
- act as an unbounded website search engine
- let Realtime freely reason from raw website content
- defer truth selection to the model
- replace explicit call-state tracking with prompt-only memory

## Realtime control strategy

### Session-level configuration
Use session-level configuration for durable behavior that should remain stable for the whole call, such as:
- voice
- general personality/tone
- base system contract
- tool definitions
- broad disclosure and safety stance

### Turn-level configuration
Use per-turn response creation for dynamic behavior that changes as the conversation evolves, such as:
- current mode
- current stage
- active domain/subdomain
- current runtime bundle
- current missing slots
- next-step objective

### Why this split matters
Keeping long-lived behavior in the session and short-lived business truth in turn-level instructions makes the spoken experience feel continuous while keeping truth selection deterministic.

## Recommended VAD / response pattern

For EveryCall phone-call agents, the preferred runtime pattern is:
1. let server VAD determine that the caller finished a turn
2. prevent unrestricted model auto-replies
3. let the gateway classify the turn, retrieve facts, and select mode
4. create the bounded response explicitly

This gives the gateway control over:
- truth
- stage progression
- clarification policy
- low-confidence behavior
- handoff / emergency behavior

