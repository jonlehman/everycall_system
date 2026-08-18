# Knowledge System V1

## Purpose
Replace the tenant FAQ model with a tenant-scoped knowledge system that:
- compiles website and manual business information into structured runtime knowledge
- lets businesses review high-risk answers through `Guardrail Questions`
- gives the realtime phone AI relevant knowledge plus usage instructions, without letting this subsystem decide the final spoken answer

## User-Facing Terminology
- `Knowledge Entries`
  Human-readable business information entered by users or imported from websites/documents.
- `Guardrail Questions`
  High-risk review questions used to preview what the assistant would say for topics like warranty, emergency service, pricing, financing, insurance, and guarantees.
- `Rules`
  Business guardrails such as `must say`, `must not say`, `avoid implying`, and `escalate if`.

The user-facing product should not expose raw `knowledge_facts` by default.

## Core Principles
1. Facts are the grounded evidence layer.
2. Cards are retrieval bundles, not the source of truth.
3. Realtime AI decides what to say.
4. The knowledge subsystem retrieves and packages relevant knowledge only.
5. User feedback is preserved as events before it changes artifacts.
6. Raw facts should not be silently rewritten by AI.

## Automatic Core-Fact Pins

- `knowledge_build_facts` remains the source of truth. System-managed pin metadata identifies stable facts that may be placed directly in the receptionist prompt; there is no second tenant fact store.
- Every canonical fact remains vector indexed. The prompt-only spoken form never replaces or weakens the source fact used for lookup.
- OpenAI independently rates a new or materially changed fact on three separate axes: factual importance, expected stability, and whether the claim itself is safe to state as a fact. The importance score reflects only the meaning and caller value of the fact; marketing prose, jargon, duplicated headings, awkward grammar, and phone-unfriendly wording may not lower it. An unchanged rating-input hash reuses the saved rating without another OpenAI review.
- Deterministic selection first filters for fact-level safety, stability, and an importance score of at least 40, then sorts the remaining facts by importance. Only those top candidates receive a separate versioned spoken-register rewrite: a neutral label plus one sentence of at most 200 characters. The rewrite may paraphrase but may not add, infer, combine, or broaden facts; validators remove or reject marketing language, title duplication, new technology names, changed numbers/negations/limits, and phone-unfriendly jargon.
- Spoken rewrites must preserve narrative identity: they may not introduce first-person language when the canonical fact is third-person supplier or manufacturer copy. If the initial rewrite and one repair attempt remain unsafe, the candidate is excluded from pins while its canonical fact, factual-importance score, and fact-level safety rating remain intact; one rejected pin never fails the whole build.
- SQL orders eligible facts by score descending with stable fingerprint and fact-ID tie-breakers. Deterministic code rejects instruction or marketing leakage and unsafe semantic changes, deduplicates fingerprints, and enforces tenant isolation, a 600-token prompt budget, and a 20-fact ceiling.
- The resulting tenant/build section, selected fact IDs, rating version, and checksum are materialized in `knowledge_core_fact_prompt_sections`. Calls inject that saved block and do not run selection or scoring.
- Adding, changing, or deleting knowledge causes the next build to rerank and rematerialize the section. Deletion and reranking require no OpenAI call; only facts with changed rating inputs are scored.
- The internal admin shows active-build pins and the append-only change history. Tenants do not manually manage pins in v1.
- If an active build has no pins, the entire `What You Know By Heart` section and every sentence that refers to it are omitted. Independent canonical behavior changes remain present.
- Background build execution uses a durable token/expiry/heartbeat lease stored on `knowledge_builds`. Only the lease owner may complete, publish, or fail scheduled work, and terminal published state cannot be overwritten by a stale execution.

## Artifact Layers

### 1. Authoring Layer
What the business sees and edits:
- `knowledge_entries`
- `guardrail_questions`
- `rules`

Example entry:
- Section: `Warranties and Guarantees`
- Text: `We offer a 1-year workmanship warranty on water heater installs, but not on drain cleaning.`

### 2. Evidence Layer
What the system extracts and grounds:
- `site_pages`
- `site_sections`
- `knowledge_facts`

Facts must preserve:
- source URL
- evidence text
- confidence
- whether the fact is explicit or inferred

### 3. Runtime Layer
What retrieval returns to the phone AI:
- `knowledge_cards`
- `knowledge_overrides`
- `knowledge_guardrails`

These artifacts are optimized for retrieval, not direct user authoring.

## Data Flow
1. Crawl tenant website or ingest manual knowledge entries.
2. Normalize each source into one page-level evidence document.
3. Extract atomic `knowledge_facts` from page documents and manual entries.
4. Group facts into `knowledge_cards`.
5. Generate `guardrail_question_tests` from tenant knowledge and review templates.
6. Capture user feedback on draft answers.
7. Route feedback into one of:
   - `card_update`
   - `answer_override`
   - `guardrail`
   - `fact_correction_proposal`

## Page-Level Source Documents
- Website pages and uploaded documents are presented to the build-time AI as whole page-level documents, not arbitrary line groups. Separate source lines are document structure, not separate candidate facts.
- Visible nonempty lines are retained regardless of character or word count, and their line breaks remain in the document. Cleanup may remove executable/style content and explicit legal/call-to-action boilerplate, but may not use a generic minimum-length rule.
- Page provenance is sufficient. The legacy `source_segments` and `source_chunks` tables remain for schema compatibility, but new builds write one row per source to each and mark the chunk as `page_document`.
- `KNOWLEDGE_BUILD_SOURCE_PAGE_TOKEN_BUDGET` defaults to 12,000 estimated tokens. Only a source that exceeds that budget is truncated; the compiler keeps the beginning and end, records truncation metadata, and inserts an internal omission marker that may never be treated as evidence.
- Cross-page request batching remains independent: summaries, site-wide topic inventory, and fact/card extraction continue to batch multiple page documents under their existing stage budgets.

## Feedback Routing
Every edit/comment becomes a `knowledge_feedback_event` first.

The classifier may route feedback to:
- `card_update`
  Example: regroup plumbing warranty examples ahead of HVAC examples.
- `answer_override`
  Example: prefer saying `water heaters and repipes` when the caller asks about plumbing warranty.
- `guardrail`
  Example: never imply all repairs are covered.
- `fact_correction_proposal`
  Example: this warranty is no longer offered.

### Safety Rule
- `knowledge_facts` are protected.
- AI may propose fact corrections, but should not silently mutate facts.
- Auto-application is allowed for low-risk card updates, overrides, and guardrails.
- Fact corrections should require explicit review or re-compilation.

## Runtime Contract
The knowledge subsystem should not decide final conversational context.
The realtime phone AI remains responsible for:
- understanding the live conversation
- deciding what details matter
- composing the spoken answer

The knowledge subsystem is responsible for:
- retrieval
- packaging relevant artifacts
- returning usage instructions and guardrails

### Retrieval Request
```json
{
  "tenantKey": "harts",
  "question": "How does your warranty work?",
  "topicHint": "warranty",
  "tradeHint": "plumbing",
  "serviceHint": "water_heater",
  "conversationStage": "answering_question",
  "limit": 6
}
```

### Retrieval Response
```json
{
  "cards": [],
  "facts": [],
  "overrides": [],
  "guardrails": [],
  "usageInstructions": [
    "Use only the grounded knowledge below.",
    "Prefer trade-relevant examples.",
    "Do not generalize beyond explicit evidence.",
    "If coverage is unclear, offer a callback instead of guessing."
  ]
}
```

## Table Roles
- `site_crawls`
  One crawl run per tenant website.
- `site_pages`
  Normalized page inventory.
- `site_sections`
  Cleaned sections used for extraction.
- `knowledge_entries`
  Human-authored or imported knowledge input.
- `knowledge_facts`
  Atomic claims grounded in sections or manual entries.
- `knowledge_cards`
  Runtime retrieval bundles.
- `knowledge_card_facts`
  Card-to-fact joins.
- `knowledge_overrides`
  Preferred phrasing for a topic/trade/service.
- `knowledge_guardrails`
  Must-say, must-not-say, avoid-implying, escalate-if instructions.
- `knowledge_feedback_events`
  Raw user feedback plus routing decision.
- `guardrail_question_tests`
  High-risk question previews with draft or approved answers.

All tables above are tenant-scoped unless a later template system is added explicitly.

## Review Surfaces
The product should prioritize these views:

### 1. Knowledge
Human-readable entries grouped by:
- services offered
- emergency service
- service area
- hours and availability
- pricing and fees
- warranties and guarantees
- financing
- insurance
- exclusions
- scheduling and cancellations
- maintenance plans

### 2. Guardrail Questions
Review high-risk questions and see:
- draft answer
- approved answer, if any
- supporting facts/cards
- source links
- confidence

### 3. Ask the Assistant
Freeform question test surface showing:
- retrieval payload
- answer preview
- supporting knowledge
- warnings when evidence is weak

### 4. Rules
Manage guardrails and escalations separately from factual content.

## Non-Goals
- The subsystem does not choose the final spoken answer.
- The subsystem does not replace the phone AI's judgment about relevance.
- The system should not force businesses to author raw technical card fields.

## Rollout Direction
This system replaces the current FAQ-centric knowledge model.
The old FAQ model should not shape the new storage design.
During implementation, temporary compatibility layers may exist, but they are transitional only.
