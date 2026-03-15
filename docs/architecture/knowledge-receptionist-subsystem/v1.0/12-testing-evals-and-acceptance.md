# 12 Testing, Evals, and Acceptance

Status: Frozen handoff baseline
## Purpose

This document defines how EveryCall verifies that the subsystem is:
- technically correct
- behaviorally safe
- retrieval-effective
- broad enough across target verticals
- ready for tenant go-live

## Test layers

### 1. Schema / contract tests
Validate:
- JSON schema validity
- required fields present
- enum/range constraints
- example objects validate against schema
- backward-compatible changes where expected

### 2. Compiler pipeline tests
Validate:
- crawl scope enforcement
- source capture across website/upload/interview channels
- segmentation/boilerplate suppression
- source typing
- claim extraction persistence
- fact/card synthesis rules
- conflict detection
- build publish lifecycle

### 3. Retrieval tests
Validate:
- alias matching
- caller phrase matching
- hybrid retrieval quality
- location/provider scoping
- precedence effects
- low false-positive retrieval for unrelated cards

### 4. Prompt tests
Validate:
- prompt contains required layers
- prompt contains current mode/stage
- prompt never omits truth boundaries
- dangerous-question injections appear when required
- disclosure behavior follows tenant config

### 5. Simulated call tests
Validate:
- stage progression
- follow-up question continuity
- clarifier limit behavior
- next-step movement
- handoff behavior
- interruption recovery
- low-confidence handling

### 6. Operational workflow tests
Validate:
- manual rebuild rate-limits
- go-live gating
- publish/rollback
- audit logging
- override precedence
- pack maturity handling

## Required eval categories

### A. Single-domain business
Example:
- one plumbing business or one dermatology office

### B. Multi-domain business
Example:
- HVAC + plumbing + electrical company

### C. Conflicting website content
Example:
- service area or hours contradiction that should be resolved or blocked

### D. Override-heavy tenant
Example:
- hard operational overrides plus temporary closure notice plus approved answer snippets

### E. Dangerous-question coverage
Example:
- pricing without pricing on site
- regulated advice question
- emergency language

### F. Multi-source build
Example:
- website + uploaded documents + owner interview contributing to one build
- precedence where owner-confirmed interview facts and uploaded operational docs outrank passive public site text

## Cross-vertical acceptance set

The architecture should be evaluated with at least one representative tenant/site profile from:
- service business
- medical office
- professional services firm
- specialty business such as window installer or med spa

The goal is not to prove every vertical is production-ready on day one.  
The goal is to prove the **subsystem architecture** can support them.

## Acceptance criteria themes

### Knowledge quality
- cards represent answerable units
- evidence traceability exists
- distinct offerings are not merged into vague blobs
- conflict resolution behaves predictably

### Runtime behavior
- the assistant answers from the bundle
- clarifies minimally
- does not guess
- proposes an appropriate next step
- respects active domain/subdomain
- keeps follow-up context through call state

### Administrative control
- hard overrides win
- dangerous questions follow playbook
- manual rebuild flow behaves correctly
- go-live cannot occur while blockers remain

## Suggested evaluation datasets

### Retrieval dataset
A curated set of caller-style queries for each representative domain/subdomain.

Example fields:
- query text
- expected turn intent
- expected domain/subdomain
- expected top card(s)
- must-not-return card(s)

### Simulated call dataset
A set of multi-turn scripts or scripted caller goals.

Example fields:
- initial caller goal
- expected stage path
- expected mode changes
- expected captured fields
- expected outcome

### Guardrail dataset
A set of risky or ambiguous prompts with expected bounded handling.

## Key metrics

### Compile metrics
- sources captured
- segments created
- facts created
- cards created
- high-severity conflicts
- low-confidence cards
- publish blockers

### Retrieval metrics
- top-1 / top-k relevance on eval set
- alias hit rate
- scoped-card precision
- contradiction-affected retrieval rate

### Runtime metrics
- clarification rate
- low-confidence handoff rate
- successful next-step rate
- follow-up continuity success
- unsafe-answer rate
- perceived latency

### Operational metrics
- rebuild success rate
- rollback frequency
- override usage rate
- go-live blocker frequency

## Required regression suites

Every significant change should re-run:
- schema validation
- retrieval eval set
- dangerous-question eval set
- representative multi-turn call simulations
- precedence/override tests

## Go-live acceptance recommendation

A tenant using a `new` pack should require:
- full simulated call review
- dangerous-question review
- manual approval

A tenant using an `established` pack may use a lighter review path, but still needs:
- successful build
- no critical blockers
- operational fields confirmed

## Reserved flexibility for Codex

Codex may choose:
- exact test runner/framework
- exact scoring thresholds
- exact simulation harness

What must remain true:
- requirements are testable
- evals exist at compiler, retrieval, runtime, and operational levels
- go-live depends on passing more than just a successful crawl


### Setup interview dataset
A set of onboarding interview transcripts/scripts with expected:
- captured fields
- required confirmation points
- completion status
- resulting source-channel outputs
