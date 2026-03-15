# 15 Decision Ledger

Status: Draft — frozen decisions from design discussion

1. Topics/subtopics are organizational only, not the primary storage/retrieval unit.
2. Retrieval should operate on evidence-backed knowledge objects, not raw pages.
3. One knowledge card equals one answerable conversational unit.
4. Each distinct service/offering should usually have its own card.
5. Family/service-group cards are allowed but secondary.
6. The system must support many SMB verticals, not just service businesses.
7. Current marketing focus must not limit the underlying technical architecture.
8. Domain/subdomain is the correct structural model.
9. Domain stores broad shared behavior; subdomain stores only the delta.
10. EveryCall taxonomy is primary; NAICS is optional metadata.
11. There is one canonical domain pack per domain.
12. There is one canonical subdomain pack per subdomain.
13. Per-tenant provisional packs are rejected.
14. Pack maturity is represented by `new` vs `established`.
15. Tenants may have multiple domain/subdomain assignments.
16. Caller turn intent selects the active domain/subdomain at runtime.
17. Business Call Intent Card is a required artifact.
18. Business Call Intent Card is customizable per business.
19. Business Call Intent Card includes a conversation stage playbook.
20. The stage playbook is a playbook, not a rigid script.
21. Default stage set: opening, discover_need, clarify_if_needed, answer_or_route, reassure_briefly, advance_next_step, confirm_and_close.
22. Stages are ordered but skippable/revisitable.
23. Gateway tracks stage progression.
24. Gateway is authoritative for truth and state.
25. Realtime is responsible for natural conversation delivery.
26. Runtime bundle is the approved truth surface for Realtime.
27. Call state must be persisted outside model memory.
28. Approved source channels for v1 are website pages, website-linked files, owner interviews, and uploaded documents.
29. All approved source channels feed the same compiler after source capture.
30. Rebuild/build initiation is manual only.
31. Build initiation frequency is capped at once per day per tenant.
32. AI-heavy compile pipeline is acceptable.
33. Compiler must be a staged job system, not a giant live request handler.
34. Published build stays live until replacement passes validation.
35. Hard overrides outrank compiled knowledge.
36. Soft guidance and dangerous-question lists are tenant-configurable.
37. Source precedence must be explicit and deterministic.
38. Confirmed owner interview facts outrank passive public website text.
39. Uploaded first-party operational documents can outrank passive public website text when clearly authoritative.
40. Educational/blog content should not drive receptionist answers.
41. Marketing content should never be the primary fact source.
42. Prompting must enforce bounded paraphrase and non-invention.
43. Go-live requires explicit readiness checks.
44. Business Setup Interview Intent Card is required for setup-interview mode.
45. A completed setup interview can satisfy source readiness even without a website.
46. Requirements traceability matrix is mandatory to prevent loss of decisions.


## Freeze-pass decisions

- The initial EveryCall domain/subdomain seed taxonomy is frozen in the spec for v1 handoff.
- Runtime bundle size and token budgets are architecture requirements, not left open-ended.
- Hybrid retrieval behavior is required; exact storage/index implementation is left to Codex.
- Uploaded-document authority tagging and owner-interview confirmation are required before those source channels can outrank public website operational facts.
- High-impact tenant behavior changes support either immediate-save with audit or approval-required draft review.
- No remaining open architecture questions block Codex handoff; remaining items are deferred or implementation choices only.
