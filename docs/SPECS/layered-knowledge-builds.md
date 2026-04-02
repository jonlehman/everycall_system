# SPEC: Layered Knowledge Builds

## Status
- Proposed
- Owner: Platform
- Last Updated: 2026-04-02

## Scope
Define the next version of the knowledge-build pipeline so website crawling and document updates are split into separate workflows, while runtime still uses one published knowledge base.

This spec also adds a new document-source type:
- a single web page imported as a document-style source

The intent is:
- website knowledge is built automatically from intake
- document changes do not require re-crawling the website
- document-layer content continues to override conflicting website content

## Goals
- Split `website build` and `document build` into separate user actions and separate source lifecycles.
- Automatically create the initial website knowledge base from onboarding intake.
- Keep one published runtime build so retrieval and the live receptionist stay simple.
- Preserve current override behavior where uploaded documents outrank website content.
- Add a `single web page as document` source that fetches only that exact page and does not crawl child links.
- Make larger websites cheaper and faster to maintain after the initial crawl.

## Non-Goals
- No change to the live runtime contract of `one active build per tenant`.
- No multi-build runtime merging on every call.
- No Google Business Profile ingestion in this phase.
- No user-facing source-diff UI in this phase.
- No document approval workflow redesign beyond what is needed for the split.

## Problem Statement
Today, the knowledge build pipeline combines:
- `websiteUrl`
- `uploadedDocumentIds`
- `setupInterviewSessionIds`

into one build request in:
- [index.js](/home/jonle/everycall/pages/api/v1/knowledge/builds/index.js)
- [knowledgeReceptionistBuilds.js](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistBuilds.js)

That means:
- every document update is tied to the website build lifecycle
- larger websites are expensive to rebuild repeatedly
- the intake website source and the maintenance-page document sources are not operationally distinct

The current source-authority model is already compatible with layered builds:
- uploaded first-party policy and operational sources outrank website sources in [knowledgeReceptionistBuilds.js](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistBuilds.js)
- compiler selection already prioritizes uploaded documents ahead of website pages in [knowledgeReceptionistCompiler.js](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistCompiler.js)

So this work should split source lifecycles without changing the core authority model.

## User-Facing Model

### Website Base
The website base is the crawled website knowledge built from the tenant's main website URL.

Characteristics:
- created automatically from onboarding intake
- can be rebuilt manually later
- may crawl many pages
- forms the baseline knowledge layer

### Document Overlay
The document overlay is the set of approved document-style sources applied on top of the website base.

Document-style sources include:
- uploaded file document (`pdf`, `txt`)
- future inline/manual document if retained
- single web page imported as a document

Characteristics:
- built independently from website crawling
- should be fast
- overrides conflicting website facts

### Published Knowledge Base
The live knowledge base remains one published runtime artifact. It is composed from:
- the current website base
- the current approved document overlay

This is the only build the live runtime should read.

## Required Product Behavior

### 1. Intake Auto-Builds Website Knowledge
After onboarding captures a website URL, the system should:
1. create or enqueue a `website_base` build automatically
2. build website knowledge from that URL
3. publish the resulting composite knowledge base if no document overlay exists yet

This should happen without requiring the new tenant to visit the knowledge page first.

### 2. Knowledge Maintenance Splits Website and Documents
The knowledge page should have two clearly separated actions:

Website:
- show current website URL
- show website build status
- allow `Rebuild Website`

Documents:
- show approved document sources
- allow new file uploads
- allow new single-page imports
- allow `Apply Documents`

The user should not have to rebuild the website in order to apply document changes.

### 3. Single Web Page as Document
The document workflow must support adding a specific URL as a document-style source.

Rules:
- fetch only the exact page URL provided
- do not crawl links from that page
- extract only that page's content
- classify it as a document-layer source, not a website crawl page
- give it document-layer source authority so it can override website content

Intended use cases:
- service-area page
- pricing page
- holiday-hours page
- policy page
- hidden or rarely linked operational page

### 4. Document Sources Override Website Sources
When facts conflict:
- document-layer sources must continue to win over website public pages
- policy and operational document sources should remain highest among tenant-managed public sources

This should continue to be implemented by source authority and compile priority, not by deleting website facts.

## Architecture Overview

### Recommended Build Kinds
Extend `knowledge_builds` with explicit build lineage:
- `legacy_combined`
- `website_base`
- `document_overlay`
- `composite`

Definitions:
- `website_base`: crawl + compile the tenant website only
- `document_overlay`: process approved document-layer sources only
- `composite`: final compiled build assembled from website base plus document overlay

The live pointer in `tenant_active_knowledge_builds` should still point to the current `composite` build.

### Source Layers
Conceptually, the system should treat sources as two layers:

1. Website layer
- `website_page`
- `website_file`

2. Document layer
- `uploaded_document`
- `document_web_page`
- optional future `document_text`

The document layer should be reusable without recrawling the website layer.

## Data Model Changes

### `knowledge_builds`
Add:
- `build_kind TEXT NOT NULL DEFAULT 'legacy_combined'`
- `base_build_id TEXT NULL`
- `overlay_build_id TEXT NULL`
- `composite_parent_build_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb`
- `source_fingerprint_json JSONB NOT NULL DEFAULT '{}'::jsonb`

Purpose:
- identify build role
- preserve lineage
- support document-only rebuilds

### `uploaded_documents`
Extend the existing uploaded-document model to support multiple source kinds.

Add:
- `source_kind TEXT NOT NULL DEFAULT 'file_upload'`
- `source_locator TEXT NULL`
- `fetch_status TEXT NULL`
- `fetch_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `content_fingerprint TEXT NULL`

Supported `source_kind` values:
- `file_upload`
- `single_page_url`
- optional future `inline_text`

Rules:
- `file_upload` uses existing file/body handling
- `single_page_url` stores the URL in `source_locator`
- extracted text is still stored as the normalized document body

### Optional Source-Set Table
If reuse becomes complex, add:
- `knowledge_source_sets`

Suggested fields:
- `source_set_id`
- `tenant_key`
- `source_layer` = `website` or `documents`
- `fingerprint`
- `status`
- `metadata_json`
- `created_at`

Purpose:
- identify reusable source snapshots
- make document-only rebuilds deterministic

This is optional in phase 1, but likely useful by phase 2.

## API Changes

### Onboarding
After successful onboarding in:
- [onboard.js](/home/jonle/everycall/pages/api/v1/tenants/onboard.js)

enqueue:
- a `website_base` build using the submitted website URL

### Knowledge Builds API
Current build creation accepts a mixed source payload in:
- [index.js](/home/jonle/everycall/pages/api/v1/knowledge/builds/index.js)

Recommended update:
- keep the existing endpoint
- add `buildKind`

Accepted values:
- `website_base`
- `document_overlay`
- `composite`

Behavior:
- `website_base`
  - requires `websiteUrl`
  - ignores document source IDs unless explicitly requested for compatibility
- `document_overlay`
  - requires approved document-layer source IDs or uses all approved document-layer sources by default
  - does not recrawl website
- `composite`
  - normally system-created, not directly user-created

### Uploaded Documents API
Extend:
- [uploaded-documents.js](/home/jonle/everycall/pages/api/v1/knowledge/uploaded-documents.js)

to accept:
- `sourceKind`
- `sourceLocator`

Examples:

File upload:
```json
{
  "document": {
    "title": "Warranty Sheet",
    "documentClass": "policy",
    "sourceKind": "file_upload",
    "filename": "warranty.pdf",
    "mimeType": "application/pdf",
    "fileBase64": "..."
  }
}
```

Single page import:
```json
{
  "document": {
    "title": "Holiday Hours Page",
    "documentClass": "operational",
    "sourceKind": "single_page_url",
    "sourceLocator": "https://example.com/holiday-hours"
  }
}
```

For `single_page_url`:
- fetch the page
- extract text
- save it as a document-style source
- do not crawl child links

## Build Pipeline Changes

### Current Pipeline
Current build entry:
- [createKnowledgeBuild](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistBuilds.js)

Current behavior:
- if `websiteUrl` exists, collect website sources
- if `uploadedDocumentIds` exist, collect uploaded documents
- combine all discovered source items
- compile one build

### Target Pipeline

#### A. Website Base Build
Input:
- `websiteUrl`
- optional assignments

Process:
1. crawl website
2. persist website source items
3. compile website-only artifacts
4. mark build `website_base`

Result:
- reusable website source refs and compiled artifacts

#### B. Document Overlay Build
Input:
- approved document-layer source IDs

Process:
1. load existing approved document sources
2. for `single_page_url`, fetch only that page and extract text
3. persist document-layer source items
4. compile document-only artifacts
5. mark build `document_overlay`

Result:
- reusable document overlay source refs and compiled artifacts

#### C. Composite Build
Input:
- current website base build
- current document overlay build, if any

Process:
1. reuse website source refs / summaries / artifacts
2. reuse document source refs / summaries / artifacts
3. compile final card/fact outputs into one composite build
4. publish composite build

Result:
- one runtime-ready published build

## Runtime Behavior
Runtime should remain unchanged operationally:
- [knowledgeReceptionistPrompt.js](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistPrompt.js)
- [tenant_active_knowledge_builds](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistBuilds.js)

Requirements:
- runtime reads one `active_build_id`
- that build should be the latest published `composite`
- retrieval does not need to know about source layering

This keeps the live phone path simple and low-risk.

## Source Authority and Precedence
Document-layer sources should continue to override website sources through source authority.

Recommended precedence order within tenant-managed sources:
1. `owner_interview_confirmed`
2. `uploaded_first_party_policy`
3. `uploaded_first_party_operational`
4. `document_web_page_policy`
5. `document_web_page_operational`
6. `website_public_downloadable`
7. `website_public_page`
8. `uploaded_first_party_reference`
9. `owner_interview_unconfirmed`
10. `uploaded_first_party_marketing`

Implementation note:
- a single-page document import should not be treated as `website_public_page`
- it should be treated as a document-layer first-party source because the tenant explicitly selected it

## UI Changes

### Knowledge Page
Update:
- [page.jsx](/home/jonle/everycall/app/client/receptionist/knowledge/page.jsx)

New structure:

#### Website Base
- current website URL
- website build status
- last website build time
- `Rebuild Website`

#### Documents
- uploaded file sources
- single-page document sources
- approval state
- `Apply Documents`

#### Live Status
- live website base version
- live document overlay version
- published composite version

### Document Add Flow
Document input modes:
- `Upload File`
- `Add Web Page`

`Add Web Page` fields:
- page title
- document class
- page URL

The page should clarify:
- only this page will be imported
- linked pages will not be crawled

## Migration Strategy

### Existing Builds
Do not rewrite historical builds aggressively.

Migration approach:
- existing builds become `legacy_combined`
- runtime continues to support them
- the first new website rebuild creates the tenant's first `website_base`
- the first new document apply creates the tenant's first `document_overlay`
- the first composite publish becomes the new active runtime build

### Existing Uploaded Documents
Existing uploaded documents should migrate to:
- `source_kind = file_upload`

No content rewrite required.

### Existing Active Tenants
For tenants already live:
- keep current active build until a new layered composite is published
- do not force a rebuild during migration

## Rollout Phases

### Phase 1: Product Workflow Split
- add `buildKind`
- split website and document actions in the UI
- add `single_page_url` document source
- keep the existing internals mostly intact where possible

Goal:
- user-visible separation
- minimal migration risk

### Phase 2: Reusable Website Base
- persist and reuse website-only source snapshots
- document-only builds stop recrawling website
- composite build becomes explicit

Goal:
- performance and cost savings

### Phase 3: Intake Auto-Build
- onboarding automatically enqueues website base build
- tenant lands in product with website knowledge already processing or ready

Goal:
- remove manual first build step

## Acceptance Criteria
1. Onboarding with a website URL automatically creates a website build job.
2. Knowledge maintenance page clearly separates website rebuilds from document applies.
3. Uploaded files can be applied without re-crawling the website.
4. A single web page can be imported as a document source without crawling child links.
5. Single-page document imports override conflicting website content the same way uploaded documents do.
6. Runtime still reads one published active build only.
7. Existing tenants with legacy builds continue to work until they rebuild into the new model.
8. For large websites, document-only updates do not re-run the website crawl.

## Implementation Anchors
Primary files likely to change:
- [onboard.js](/home/jonle/everycall/pages/api/v1/tenants/onboard.js)
- [index.js](/home/jonle/everycall/pages/api/v1/knowledge/builds/index.js)
- [uploaded-documents.js](/home/jonle/everycall/pages/api/v1/knowledge/uploaded-documents.js)
- [page.jsx](/home/jonle/everycall/app/client/receptionist/knowledge/page.jsx)
- [knowledgeReceptionistBuilds.js](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistBuilds.js)
- [knowledgeReceptionistCompiler.js](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistCompiler.js)
- [knowledgeReceptionistConfig.js](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistConfig.js)

## Open Questions
- Should `Apply Documents` always use all approved document-layer sources, or allow selecting a subset?
- Should a website rebuild automatically produce a new composite using the current approved documents, or require an explicit follow-up publish?
- Should document overlays be one rolling overlay build, or versioned per apply action?
- Should single-page document imports be allowed from external domains, or restricted to the tenant's main domain by default?

## Recommended Default Answers
- Apply all approved document-layer sources by default.
- A website rebuild should automatically produce a fresh composite using current approved documents.
- Keep document overlays versioned per apply action.
- Restrict single-page document imports to the tenant's main website origin in phase 1 unless explicitly relaxed by admin settings.
