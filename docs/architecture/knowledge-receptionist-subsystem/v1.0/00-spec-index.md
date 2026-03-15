# EveryCall Knowledge & Realtime Receptionist Subsystem Spec Bundle

Status: Frozen handoff baseline — Codex implementation input
Version: 1.0  
Audience: Product, architecture, Codex CLI implementation, QA

## Freeze-pass note

This version is the **frozen handoff baseline** for Codex CLI implementation of the subsystem architecture.

For Codex handoff purposes:
- there are **no remaining open product or architecture questions** that block implementation
- remaining deferred items are explicitly listed in `16-open-questions-and-deferred-items.md`
- bounded implementation choices that Codex may decide are also explicitly listed in `16-open-questions-and-deferred-items.md`
- this bundle is intended to be implemented without reopening already-settled design decisions

## Purpose

This spec bundle defines the complete architecture of the **knowledge / call-guidance subsystem** for EveryCall.

This subsystem covers:

1. Business knowledge ingestion from approved sources (website pages, website-linked files, owner interview, and uploaded documents)
2. Business-specific call structure and information-retrieval structure configuration
3. Instruction generation for OpenAI Realtime
4. Gateway-side information retrieval during live calls
5. Gateway-side call-state and conversation-stage management
6. Governance: overrides, guardrails, rebuilds, readiness, QA, and versioning

## Product intent

EveryCall is a **broad receptionist / soft-sales technology**.  
Its current marketing focus may be narrower, but the subsystem must support multiple business verticals.

At the highest level, the system should act as:

> A receptionist / soft sales assistant that answers the phone, makes the caller feel welcome, determines what they need, helps move them toward the business's product or service, captures the lead, and advances the call to the correct next step.

## Canonical principles already decided

- Topics/subtopics are **organizational**, not the primary storage/retrieval unit.
- The primary retrieval unit is an **evidence-backed knowledge card**.
- One knowledge card represents **one answerable conversational unit**.
- Each distinct service/offering should normally have its own card.
- Domain behavior is shared through **one canonical domain pack per domain**.
- Subdomain behavior is shared through **one canonical subdomain pack per subdomain**.
- No per-tenant provisional packs.
- Tenants may belong to multiple domain/subdomain combinations.
- Caller turn intent selects the active domain/subdomain at runtime.
- A **Business Call Intent Card** is required and is customizable per business.
- The Business Call Intent Card contains a **conversation stage playbook**.
- The gateway is authoritative for **truth, bundle assembly, mode selection, and call state**.
- OpenAI Realtime handles the **natural conversation layer**.
- Approved ingestion channels for v1 are **website pages**, **website-linked downloadable files**, **owner interview sessions**, and **uploaded documents**.
- All approved source channels are normalized into the same compiler path after source capture.
- Build/rebuild execution is **manual** and rate-limited.
- Hard overrides win over compiled knowledge from any source channel.

## Document map

| File | Purpose |
|---|---|
| `00-spec-index.md` | Master index and governing overview |
| `01-product-purpose-and-scope.md` | Product scope, goals, non-goals, constraints |
| `02-core-concepts-and-glossary.md` | Canonical terms and definitions |
| `03-domain-subdomain-model.md` | Domain taxonomy and multi-domain runtime model |
| `04-business-call-intent-and-stage-playbooks.md` | Business-level call goals and stage playbook |
| `05-knowledge-artifacts-and-schemas.md` | Artifact model and schema contracts |
| `06-ingestion-and-compilation-pipeline.md` | Multi-source ingestion-to-build compiler specification |
| `07-source-precedence-conflicts-and-content-classification.md` | Truth precedence and source class rules |
| `08-runtime-retrieval-gateway-and-realtime-contract.md` | Live-call runtime architecture |
| `09-prompting-and-instruction-generation.md` | Prompt contract for Realtime |
| `10-overrides-guardrails-and-business-configuration.md` | Tenant controls and guardrails |
| `11-go-live-rebuild-versioning-and-admin-workflows.md` | Operational lifecycle and readiness |
| `12-testing-evals-and-acceptance.md` | QA/eval and acceptance framework |
| `13-current-codebase-integration-notes.md` | Integration notes for current EveryCall codebase |
| `14-requirements-traceability-matrix.md` | Requirement inventory and mapping |
| `15-decision-ledger.md` | Frozen decisions from design discussion |
| `16-open-questions-and-deferred-items.md` | Unresolved/deferred items |
| `17-end-to-end-walkthroughs.md` | End-to-end scenarios across multiple verticals |
| `18-spec-completeness-checklist.md` | Final completeness gate before Codex handoff |

## Completeness rule

This bundle is considered frozen and handoff-ready only when:

- every material design decision is represented in `14-requirements-traceability-matrix.md`
- every requirement maps to a spec file
- every requirement has a verification method
- every unresolved issue is either decided or listed in `16-open-questions-and-deferred-items.md`

## Recommended implementation sequence

1. Freeze glossary and artifact schemas
2. Freeze domain/subdomain model, Business Call Intent Card, and Business Setup Interview Intent Card
3. Freeze ingest/compile pipeline
4. Freeze runtime bundle/call-state contract
5. Freeze prompt contract and guardrail rules
6. Freeze readiness, rebuild, versioning, and QA
7. Review end-to-end walkthroughs against the current codebase
8. Run completeness checklist and close open questions
9. Implement staged jobs and runtime orchestration in existing codebase

## Handoff rule

Codex may choose implementation details and code integration patterns, but may not overturn architecture decisions locked in this bundle unless those decisions are first updated here.
