# ADR 0005: Knowledge System Replaces FAQs

- Status: proposed
- Date: 2026-03-12
- Owners: platform
- Related: `docs/SPECS/knowledge-system-v1.md`

## Context
The current FAQ model is too narrow for large service-business websites and too rigid for runtime answer composition. Business knowledge is distributed across service pages, warranty pages, pricing pages, financing pages, service-area pages, and manual operator input. A flat FAQ table cannot reliably represent that knowledge or support high-confidence answer review.

## Decision
Adopt a tenant-scoped knowledge system to replace FAQs as the primary knowledge model.

The new architecture has:
1. A human-readable authoring layer (`knowledge_entries`, Rules, Guardrail Questions).
2. A grounded evidence layer (`site_pages`, `site_sections`, `knowledge_facts`).
3. A runtime retrieval layer (`knowledge_cards`, `knowledge_overrides`, `knowledge_guardrails`).

The knowledge subsystem retrieves and packages relevant artifacts, but the realtime phone AI remains responsible for deciding what to say in context.

## Consequences
### Positive
- Better coverage for large or complex websites.
- Cleaner separation between facts, phrasing, and safety rules.
- Review focuses on risky answers instead of raw FAQ rows.
- Supports both website-rich businesses and businesses with minimal online presence.

### Negative
- Replaces a broad set of existing FAQ assumptions across intake, admin, client UI, readiness, and prompt payloads.
- Requires new review surfaces and retrieval APIs.
- Introduces more internal artifact types than the current FAQ table.

## Rollout Direction
1. Add schema and spec scaffolding for the knowledge model.
2. Build authoring and compilation flows around knowledge entries and website crawls.
3. Add guardrail question review and runtime retrieval payloads.
4. Remove FAQ storage and runtime dependency once the knowledge path is complete.

## Alternatives Considered
1. Improve the existing FAQ system incrementally.
- Rejected because it preserves the wrong source-of-truth model.
2. Treat website extraction output as direct prompt text only.
- Rejected because it lacks structure, reviewability, and safe feedback routing.
