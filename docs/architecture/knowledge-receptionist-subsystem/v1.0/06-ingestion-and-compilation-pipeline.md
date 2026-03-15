# 06 Source Ingestion and Compilation Pipeline

Status: Frozen handoff baseline
## Purpose

This document specifies the source-to-build compiler that converts approved tenant business sources into a published EveryCall knowledge build.

## Pipeline rule

The compiler is a staged job system.  
It must not run as one giant live request-path handler.

## Operating model

- build initiation is manual only
- build initiation frequency is limited to once per tenant per day
- raw sources are persisted
- repeated boilerplate should be suppressed, not blindly flattened into one block
- AI may be used heavily at multiple stages
- deterministic rules still govern precedence, versioning, and publication
- the current live build remains active until the replacement passes validation

## Compiler inputs

### Required inputs
- tenant identifier
- one or more approved source-intake descriptors
- active domain/subdomain assignments
- tenant overrides and dangerous-question rules currently on file
- current published build, if any

### Optional inputs
- allowed root website URL(s)
- crawl include/exclude rules
- custom sitemap hints
- uploaded-document batch references
- completed owner interview session references
- preferred legal/business name spelling
- known service-area locations
- prior build diff baseline

## Approved source channels

### Included for v1
- HTML pages on the website
- first-party downloadable resources linked from the website
- files directly retrievable from within the approved crawl scope
- completed owner/operator interview transcripts and confirmed summaries
- uploaded documents provided by the business through the admin/client system

### Excluded for v1
- third-party profiles
- social media
- review sites
- external resources outside approved upload/crawl scope
- authenticated portals unless deliberately exposed inside approved scope


## Source authority and confirmation model

All approved source inputs must carry both a **source channel** and an **authority class** before final precedence is applied.

### Required authority classes
- `website_public_page`
- `website_public_downloadable`
- `owner_interview_unconfirmed`
- `owner_interview_confirmed`
- `uploaded_first_party_operational`
- `uploaded_first_party_policy`
- `uploaded_first_party_reference`
- `uploaded_first_party_marketing`
- `uploaded_unclassified_pending_review`

### Authority rules
- `owner_interview_unconfirmed` content may be compiled for draft/reference use but may not outrank website operational facts
- `owner_interview_confirmed` requires either an explicit confirmation stage inside the setup interview or explicit admin/owner review after the interview
- `uploaded_unclassified_pending_review` content may be ingested, indexed, and reviewed, but it may not outrank website operational facts until classified
- uploaded docs must be tagged as operational, policy, reference, or marketing before they can receive higher precedence than public website content
- authority tagging is part of build review and must be visible before publish


## Pipeline stages

### Stage 1. Source intake job
**Goal**  
Capture the approved source materials for this build.

**Input**
- source-intake manifest
- website scope settings where applicable
- uploaded-document references where applicable
- completed owner interview session references where applicable
- daily build eligibility check

**Process**
- for website sources: fetch pages, follow allowed links, collect downloadable files
- for uploaded documents: capture file contents, upload metadata, and current authority tag state
- for owner interviews: capture transcript, confirmed summary blocks, structured interview outputs, and confirmation status
- store raw fetch/import results, status codes, and metadata

**Output**
- `source_intake_sessions`
- source inventory
- fetch/import warnings and errors

**Failure policy**
- partial source intake may continue if minimum viable coverage is met
- unrecoverable source-intake failure blocks downstream publish

### Stage 2. Source capture and normalization
**Goal**  
Persist raw source materials and normalize them into a unified source inventory.

**Output**
- stable `source_ref` candidates
- source metadata
- content hashes
- duplicate-source detection

### Stage 3. Cleanup and segmentation
**Goal**  
Convert raw pages/files into usable, traceable segments.

**Rules**
- preserve page title and heading structure
- preserve source/file boundaries
- suppress boilerplate blocks that repeat at high frequency
- keep CTA blocks recognizable rather than merging them into unrelated content
- retain segment-to-source traceability

**Output**
- `source_segments`
- segment text
- heading path
- source linkage
- repeated-block annotations

### Stage 4. Source typing
**Goal**  
Classify each source or source segment into a receptionist-relevant page/source type.

**Primary page/source types**
- home
- service_detail
- service_area
- location
- faq
- policy
- person_provider
- contact
- blog_article
- promotion
- downloadable_resource
- owner_interview_transcript
- uploaded_operational_doc
- uploaded_reference_doc
- unknown_mixed

**AI role**
AI classification is allowed and encouraged here because semantic understanding matters more than DOM heuristics alone.

**Output**
- typed sources
- page-type confidence
- page-type review warnings

### Stage 5. Atomic claim extraction
**Goal**  
Extract only small, supported claims from typed segments.

**Extraction rules**
- every extracted claim must map to one or more source segments
- claims must be written as supportable facts, not broad summaries
- unsupported inference is forbidden
- marketing claims may be extracted but tagged as marketing
- educational/advisory claims should be tagged accordingly and de-prioritized
- interview-confirmed facts may carry higher source authority than passive public website text
- interview-confirmed facts may carry higher source authority than passive public website text

**Examples of valid claims**
- "The office is open Monday through Friday."
- "The business offers AC repair."
- "Free estimates are available."
- "A referral is required for this visit type."
- "The business serves Bellevue."

**Output**
- claim candidates
- evidence links
- extraction confidence

### Stage 6. Fact normalization
**Goal**  
Convert extracted claims into structured `knowledge_fact` records.

**Normalization tasks**
- assign fact type
- assign object type
- normalize booleans, lists, and structured values
- attach scope
- attach domain/subdomain
- attach content class

**Output**
- `knowledge_facts`

### Stage 7. Card synthesis
**Goal**  
Group related facts into answerable conversational units.

**Synthesis rules**
- one card = one answerable conversational unit
- distinct offerings get distinct cards
- separate policy from service capability when possible
- separate location from service when the answer patterns differ
- create family cards only when useful for broad navigation/disambiguation

**Output**
- `knowledge_cards`

### Stage 8. Alias, caller-phrase, and interview-summary generation
**Goal**  
Generate natural caller-language retrieval hooks.

**Rules**
- translate website/document/interview language into likely caller phrasing
- include plain-English paraphrases
- include short variants and synonyms
- do not create aliases that imply unsupported services or policies

**Output**
- aliases
- caller phrases
- entity tags

### Stage 9. Conflict resolution
**Goal**  
Resolve or quarantine contradictions before publish.

**Rules**
- apply precedence deterministically first
- explicit beats implied
- scoped beats generic
- unresolved contradictions should create warnings and may block publish depending on severity

**Output**
- resolved cards/facts
- conflict review items
- blocked publish reasons where applicable

### Stage 10. Embedding generation
**Goal**  
Generate retrieval assets for hybrid search.

**Recommended inputs to embed**
- card canonical name
- speakable summary
- aliases
- caller phrases
- selected answer facts

**Output**
- `knowledge_embeddings`

### Stage 11. QA analysis
**Goal**  
Assess readiness and likely runtime quality.

**Checks**
- schema validity
- contradiction count
- low-confidence cards
- coverage gaps
- dangerous-question coverage
- required operational fields presence
- likely unanswered caller questions
- pack/domain consistency
- diff vs previous build

**Output**
- quality summary
- warnings
- blockers
- publish recommendation

### Stage 12. Build publish
**Goal**  
Promote the new build to active status if it passes validation.

**Rules**
- publish is explicit
- current build remains live until new build is promoted
- publish creates immutable build/version metadata
- rollback must remain possible

## Persistence model by stage

| Stage | Primary artifacts written |
|---|---|
| Crawl | `crawl_sources`, crawl manifest |
| Capture | source inventory |
| Cleanup/segment | `source_segments`, segment metadata |
| Page typing | typed segments/sources |
| Claim extraction | claim candidates |
| Fact normalization | `knowledge_facts` |
| Card synthesis | `knowledge_cards` |
| Alias generation | retrieval metadata |
| Conflict resolution | conflict ledger / resolutions |
| Embeddings | `knowledge_embeddings` |
| QA analysis | quality report |
| Publish | `knowledge_builds`, active build pointer |

## AI usage guidance

AI-first processing is acceptable because:
- the source-ingestion pipeline is offline/manual
- semantic classification and extraction quality matter more than cheap heuristics
- the business accepts higher per-build cost in exchange for stronger knowledge quality

### Deterministic control points that must remain outside AI judgment
- crawl scope enforcement
- rebuild rate limiting
- precedence ordering
- publish/rollback state transitions
- schema validation
- go-live gating
- override precedence

## Failure handling

### Retryable failures
- transient fetch errors
- extraction model timeout
- embedding generation timeout
- temporary downstream dependency outage

### Non-retryable or blocking failures
- invalid crawl scope
- no minimum viable source coverage
- schema-invalid output after retries
- unresolved high-severity conflicts
- missing mandatory operational data when required for publish

## Minimum viable source coverage

Codex may choose the exact thresholding mechanism, but the system should check at least:
- root/home page captured
- contact/location page captured if it exists
- at least one service/offering page captured if the site clearly contains one
- business-identifying pages captured
- enough content exists to produce a non-trivial build

## Publish gating summary

A build cannot be published when any of the following are true:
- schema validation fails
- no viable runtime cards are produced
- required hard-override placeholders remain unresolved for go-live
- unresolved high-severity contradictions remain
- the build is linked to the wrong tenant/domain scope
- the build failed required QA/eval checks

## Logging and traceability

Each stage should log:
- stage start and finish
- stage input counts
- stage output counts
- warnings/errors
- model identifiers used for AI stages
- retry count
- operator-visible summary

## Reserved implementation freedom

Codex may choose:
- job queue implementation
- worker topology
- intermediate storage model
- retry backoff strategy
- concurrency limits

What must remain true:
- staged jobs
- persisted intermediate artifacts
- manual rebuild policy
- publish only after validation
- no giant all-in-one live request handler


## Channel-specific rules

### Website pages and website-linked files
- remain subject to crawl scope rules
- should preserve URL/file provenance
- public marketing content remains lower authority than private business-provided sources

### Owner interview sessions
- must run under the Business Setup Interview Intent Card
- should persist raw transcript plus confirmed summary blocks
- should tag confirmed answers as `interview_confirmed`
- incomplete interviews must not be treated as finalized truth
- a completed interview may produce a build even without a website

### Uploaded documents
- must preserve original filename and upload metadata
- should be typed into operational/policy/reference categories where possible
- may outrank public website material when the uploaded document is clearly first-party operational content
- should follow the same extraction, normalization, and card-synthesis stages after capture
