# 18 Spec Completeness Checklist

Status: Frozen handoff baseline — checklist passed

## Purpose

This checklist is the last gate before handing the subsystem architecture to Codex CLI for implementation. It was reviewed and checked during the freeze pass.

## 1. Structural completeness

- [x] All docs referenced in `00-spec-index.md` exist
- [x] All artifact families listed in `05` have schema files
- [x] All schema files have matching example files
- [x] The requirements traceability matrix is updated
- [x] The decision ledger reflects the latest architectural decisions
- [x] Deferred items are listed in `16` rather than floating informally

## 2. Product completeness

- [x] Product purpose and scope are explicit
- [x] Domain/subdomain model is explicit
- [x] Business Call Intent Card is defined and required before go-live
- [x] Stage playbook is defined and customizable per tenant
- [x] Call outcome schema is defined
- [x] Approved multi-source ingestion boundary is explicit for v1
- [x] Business Setup Interview Intent Card is defined when setup-interview mode is used

## 3. Data-contract completeness

- [x] `domain_packs` are defined
- [x] `subdomain_packs` are defined
- [x] `business_call_intent` is defined
- [x] `source_ref` is defined
- [x] `knowledge_fact` is defined
- [x] `knowledge_card` is defined
- [x] `knowledge_override` is defined
- [x] `knowledge_guardrail` is defined
- [x] `call_outcome_schema` is defined
- [x] `knowledge_build` is defined
- [x] `runtime_bundle` is defined
- [x] `call_state` is defined

## 4. Compiler completeness

- [x] Source intake across website/upload/interview channels is defined
- [x] Segmentation / cleanup is defined
- [x] Source typing is defined
- [x] Atomic claim extraction is defined
- [x] Fact normalization is defined
- [x] Card synthesis is defined
- [x] Alias / caller phrase generation is defined
- [x] Conflict resolution is defined
- [x] Embedding generation is defined
- [x] QA analysis is defined
- [x] Publish / rollback is defined

## 5. Runtime completeness

- [x] Gateway / Realtime authority split is explicit
- [x] Runtime modes are explicit
- [x] Stage progression rules are explicit
- [x] Domain/subdomain activation rules are explicit
- [x] Runtime bundle assembly is explicit
- [x] Low-confidence behavior is explicit
- [x] Handoff behavior is explicit
- [x] Emergency behavior is explicit
- [x] Interruption handling expectations are explicit

## 6. Governance completeness

- [x] Hard overrides are defined
- [x] Soft guidance is defined
- [x] Dangerous-question playbook is defined
- [x] Go-live checklist is defined
- [x] Manual rebuild policy is defined
- [x] Pack maturity (`new` vs `established`) is defined
- [x] Tenant-level business configuration is defined

## 7. Validation completeness

- [x] At least one single-domain walkthrough exists
- [x] At least one multi-domain walkthrough exists
- [x] At least one regulated / bounded domain walkthrough exists
- [x] At least one override-precedence walkthrough exists
- [x] At least one dangerous-question walkthrough exists
- [x] Acceptance/evals doc includes verification methods

## 8. Codex handoff readiness

- [x] The spec states what Codex must preserve
- [x] The spec states what Codex may choose
- [x] The spec maps onto the current codebase
- [x] The spec avoids forcing a full rewrite
- [x] The implementation phases are ordered

## Final rule

If any unchecked item would require Codex to make a product or architecture decision that the team already intended to make, the bundle is not ready for handoff.


## Freeze-pass result

Checklist status: **passed**.

Deferred items listed in `16-open-questions-and-deferred-items.md` are accepted post-v1 deferrals and do not block Codex handoff.
