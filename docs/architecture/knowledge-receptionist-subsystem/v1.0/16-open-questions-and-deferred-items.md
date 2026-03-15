# 16 Open Questions and Deferred Items

Status: Frozen handoff baseline — no blocking open questions

## Handoff conclusion

For Codex handoff purposes, there are **no remaining open product or architecture questions** that block implementation of this subsystem.

Items that were previously open have been resolved in this freeze pass or converted into bounded implementation freedom for Codex.

## Resolved in the freeze pass

1. **Initial EveryCall taxonomy seed** is now defined in `03-domain-subdomain-model.md`.
2. **Runtime bundle size and token budget** are now defined in `08-runtime-retrieval-gateway-and-realtime-contract.md`.
3. **Retrieval stack contract** is now defined as hybrid lexical + vector + metadata filtering + precedence-aware reranking in `08-runtime-retrieval-gateway-and-realtime-contract.md`.
4. **Call outcome schema scope model** is defined as tenant-scoped with optional domain/subdomain scoping in `05-knowledge-artifacts-and-schemas.md`.
5. **Approval workflow for high-impact overrides/guardrails/business-call-intent changes** is defined in `10-overrides-guardrails-and-business-configuration.md` and `11-go-live-rebuild-versioning-and-admin-workflows.md`.
6. **Uploaded-document authority tagging and owner-interview confirmation review** are defined in `06-ingestion-and-compilation-pipeline.md`, `07-source-precedence-conflicts-and-content-classification.md`, and `10-overrides-guardrails-and-business-configuration.md`.

## Deferred items

These items are intentionally deferred and do not block this handoff version:

- multilingual runtime support
- regulated-domain launch policies and compliance runbooks
- deeper scheduling / CRM native integrations
- pronunciation tooling
- out-of-band runtime QA analytics beyond initial scope

## Bounded implementation freedom reserved for Codex

Codex may choose the exact implementation for these items as long as the architectural rules in this bundle remain true:

- exact vector/index technology
- exact queue/job framework
- exact cache implementation and eviction strategy
- exact admin UI layout for review/diff/approval screens
- exact storage mechanism for pack files versus database-backed pack records
- exact retrieval scoring formulas and evaluation thresholds
- exact test runner and simulation harness

## Rule

If a future change would alter the subsystem's architecture, runtime contract, truth precedence, or artifact model, that change must be made in the spec bundle first rather than silently during implementation.
