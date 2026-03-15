# 13 Current Codebase Integration Notes

Status: Frozen handoff baseline
## Purpose

This document is written specifically for Codex CLI.  
It explains how the new subsystem architecture likely maps onto the current EveryCall codebase without forcing a single exact implementation pattern.

## Current-state summary from prior review

The current codebase is already close to the target product in several ways:
- multi-tenant architecture exists
- admin and client portals exist
- knowledge artifacts already exist in some form
- a separate Express/WebSocket call gateway already exists
- prompt payload assembly already exists
- website enrichment already exists, but is overly concentrated in a large handler
- non-website ingestion (uploads/interview) now needs to be folded into the same build pipeline
- non-website ingestion (uploads/interview) now needs to be folded into the same build pipeline

The biggest current weaknesses called out earlier were:
- schema creation/migration occurring on live request paths
- giant website-enrichment path doing too much in one handler
- retrieval still mostly rule/scoring based, with wording mismatch risk
- drift risk from mixed routing/surface patterns

## Likely module mapping

### `preview.js`
Current role: website crawl + enrichment preview.  
Target role: thin coordinator / kickoff endpoint for staged source-intake / compile jobs.

**Recommended changes**
- move heavy work into background jobs/staged workers
- stop doing all enrichment in one request path
- broaden from website-only orchestration to source-intake orchestration
- persist intermediate artifacts
- leave preview UI support as a consumer of staged outputs

### `knowledge.js`
Current role: knowledge compile/load logic.  
Target role: primary compiler/publisher orchestration layer.

**Recommended changes**
- formalize artifact generation:
  - facts
  - cards
  - overrides
  - guardrails
  - builds
- own publish/rollback semantics
- validate against schema contracts

### `knowledgeReview.js`
Current role: review/feedback/routing logic.  
Target role: retrieval QA, preview/eval runner, and possibly hybrid-retrieval helper layer.

**Recommended changes**
- evolve from deterministic scoring-only into hybrid retrieval orchestration
- expose eval/testing surfaces
- surface contradiction and coverage analysis
- support review queues for unresolved conflicts

### `prompt.js`
Current role: gateway prompt payload assembly.  
Target role: layered prompt builder for Realtime.

**Recommended changes**
- assemble prompt from:
  - universal contract
  - Business Call Intent Card
  - domain/subdomain pack
  - hard overrides
  - soft guidance
  - dangerous-question rules
  - runtime bundle
  - current call state / mode
- stop shipping oversized tenant knowledge dumps when a runtime bundle is sufficient

### `server.ts`
Current role: live Telnyx/OpenAI runtime.  
Target role: authoritative gateway runtime orchestrator.

**Recommended changes**
- own call state explicitly
- own stage progression
- own active domain/subdomain resolution
- own runtime mode selection
- own runtime bundle assembly
- coordinate interruption behavior
- keep Realtime as the natural speech layer, not the truth selector

### `industryKnowledge.js`
Current role: industry-level knowledge seeds/defaults.  
Target role: domain/subdomain pack registry or its admin loader.

**Recommended changes**
- evolve into canonical domain/subdomain pack storage/management
- stop treating industry seeds as loose onboarding data only
- version packs explicitly

### `db.js`
Current role: schema bootstrap in live paths.  
Target role: migration/bootstrap only outside latency-sensitive request paths.

**Recommended changes**
- remove ensure/migrate behavior from normal hot paths
- shift migration/bootstrap to deploy/startup/admin workflows

## Data-model integration direction

The current runtime artifacts already align surprisingly well with the new spec:
- `knowledge_facts`
- `knowledge_cards`
- `knowledge_overrides`
- `knowledge_guardrails`

Additional first-class artifacts should likely be introduced:
- `domain_packs`
- `subdomain_packs`
- `business_call_intent`
- `setup_interview_intent`
- `call_outcome_schema`
- `knowledge_builds`
- `source_refs`
- `call_state` (or equivalent persisted/replicated state)
- `runtime_bundles` (persist optionally for debugging/evals)

## Suggested implementation phases

### Phase 1. Contracts first
- add schema files and validation
- add artifact table/shape support
- add domain/subdomain pack registry
- add Business Call Intent Card support
- add Business Setup Interview Intent Card support

### Phase 2. Compiler refactor
- split preview/enrichment flow into jobs
- persist crawl sources and segments
- normalize fact/card pipeline
- implement build publish lifecycle

### Phase 3. Runtime refactor
- add explicit call state
- add active domain/subdomain resolution
- add runtime bundle assembly
- add mode selection and stage progression

### Phase 4. Prompt refactor
- move to layered prompt assembly
- reduce giant knowledge payloads
- inject mode/stage/bundle instructions

### Phase 5. QA / go-live
- add eval harness
- add go-live gating screens/checks
- add rebuild/publish/rollback workflow

## Recommended boundaries between architecture and implementation freedom

### Must preserve
- staged compiler jobs
- explicit artifact families
- gateway-authoritative state and truth selection
- Business Call Intent Card
- domain/subdomain model
- hard override precedence
- manual rebuild/publish lifecycle

### Codex may choose
- queue technology
- exact database representation
- exact caching layer
- exact embedding/index library
- whether runtime bundles are persisted or generated ephemerally
- exact API route structure for admin/client operations

## Hot-path warnings for Codex

Do not:
- leave schema creation/migration on live request paths
- let prompt assembly degenerate into dumping all knowledge
- rely on model memory instead of explicit call state
- keep the giant crawl/enrichment handler as the main architecture
- treat blog/educational content as first-class runtime truth

## Helpful migration path

A practical low-risk migration path is:
1. keep existing live system intact
2. add new artifact contracts and validation in parallel
3. compile new-style builds alongside old knowledge paths
4. add a runtime feature flag to use bundle-based retrieval for selected tenants
5. move more tenants over as evals pass

## Final note to Codex

This spec does **not** require a full rewrite of EveryCall.  
It requires a formalization and staged refactor of the knowledge subsystem so that:
- build-time logic is cleaner
- runtime truth is bounded
- tenant behavior is configurable
- the system can broaden to more verticals without collapsing into ad hoc rules
