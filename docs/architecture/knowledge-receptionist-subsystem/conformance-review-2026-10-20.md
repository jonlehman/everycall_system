# Website knowledge design conformance review

Review date: 2026-10-20. Implementation baseline: `26d0f30`.

The website knowledge pipeline retains the original source, fact, card and published-build structure. It does not fully conform to the frozen design. The most important gaps concern factual content removed during cleanup, tenant isolation for overrides and guardrails, rollback eligibility, source-authority scoring, and the breadth of content validation before publication. These need explicit disposition before future development treats the current behavior as the intended design.

This review adds documentation only. The original frozen specifications, requirements CSV, manifest, and implementation remain unchanged.

## Scope and requirement inventory

The comparison follows website and document sources through capture, normalization, analysis, extraction, persistent artifacts, ownership controls, validation and publication. It also checks the owner-interview source interfaces where they feed the same compiler. Live speech, conversation stages, full domain-taxonomy behavior and runtime retrieval are outside the detailed review.

The frozen [Markdown matrix](v1.0/14-requirements-traceability-matrix.md) contains 161 requirement IDs. Its [CSV](v1.0/requirements-traceability.csv) contains 158. Their union contains **163 unique IDs**, all retained in the new [conformance matrix](conformance-matrix-2026-10-20.csv).

- Markdown-only IDs: `REQ-KNOW-014`, `REQ-KNOW-015`, `REQ-RULE-014`, `REQ-RULE-015`, `REQ-RUN-017`.
- CSV-only IDs: `REQ-PIPE-021`, `REQ-PIPE-022`. These require explicit source channel/authority and prohibit unconfirmed or unclassified material from outranking website operational facts.
- The original manifest reports 158 requirements. Its count and the two inventories need reconciliation without dropping decisions.

Of 101 requirements individually assigned to this pipeline review, 13 concern behavior outside its scope. This leaves 88 applicable requirements. Another 62 domain, call, runtime and prompt requirements are retained as exclusions. No whole-system conformance claim is made for those 75 excluded requirements.

| Status | Requirement count | Meaning |
| --- | ---: | --- |
| CONFORMS | 29 | Cited implementation supports the requirement. Tests and their execution limits are recorded separately. |
| PARTIAL | 41 | Important portions exist, with missing behavior or incomplete verification. |
| DEVIATES | 12 | Observed behavior conflicts with the cited frozen requirement. |
| DOCUMENTED_CHANGE | 4 | Later documentation explains a difference. This does not independently establish owner approval; some records remain Proposed. |
| UNVERIFIED | 2 | Complete acceptance evidence was not established. |
| OUT_OF_SCOPE | 75 | Retained in the inventory with no conformance verdict in this review. |

These are counts of requirements with different scope and significance, not a percentage of implementation completeness. A deterministic test cannot establish the semantic quality of every future model extraction.

Each CSV row includes the original requirement, its baseline source, current behavior, code references, supporting tests, evidence limits, documented changes, gaps and a recommended action. The [evidence record](conformance-evidence-2026-10-20.json) preserves test results, findings and SHA-256 fingerprints of 28 original design documents and inventory files.

## Design authority

The [frozen index](v1.0/00-spec-index.md#L104) permits implementation choices while prohibiting unrecorded changes to locked architecture. The [implementation freedom](v1.0/16-open-questions-and-deferred-items.md#L29) covers mechanisms such as indexing, queue technology and exact retrieval scoring; it does not waive source authority, evidence preservation, artifact contracts or publication requirements.

The review uses the frozen bundle and both original inventories as the baseline, with later decisions as separately identified changes. It does not rewrite the baseline to match current code.

| Later record | Current interpretation |
| --- | --- |
| [Whole-page evidence decision](../../DECISIONS.md#L58) and [current source-page contract](../../SPECS/knowledge-system-v1.md#L84) | Normal pages/documents are processed as whole evidence documents. Oversized documents have a recorded 12,000-token budget and beginning/end retention. Legacy segment/chunk tables remain compatibility containers. This explains page-level provenance and segmentation changes, not arbitrary deletion of factual lines. |
| [Durable lease and fencing decisions](../../DECISIONS.md#L61) | Row leases and fenced transactional publication protect builds under retries and overlapping workers. |
| [Tenant-owned fact decision](../../DECISIONS.md#L29) | Rescans may flag tenant selections but may not silently rewrite or remove their approved values. |
| [Layered builds specification](../../SPECS/layered-knowledge-builds.md#L3) | It describes automatic initial builds/publication and excludes a source-diff UI, while retaining one published runtime build. Its status is Proposed; it does not alone prove approval of departures from the frozen manual/review model. |
| [Later prompt and Live brief decisions](../../DECISIONS.md#L129) | They explain changes at the stored-knowledge-to-runtime boundary. Detailed voice conformance remains outside this review. |

## Preserved design

- Sources, facts and cards remain separate artifacts; topics organize knowledge rather than replace evidence-backed answer units.
- Website, uploaded-document and owner-interview inputs enter shared compilation after capture. Complete four-channel acceptance is still unverified.
- Builds have staged persistence, execution leases, retry checkpoints and transactional active-pointer publication. Passing lease and transaction fixtures support these mechanisms.
- Tenant-owned manual facts and selections have dedicated database protections. The Part 9 fixture passes; these protections are distinct from the override/guardrail ID issue below.
- Whole-page evidence handling, short-line retention, fresh-rescan request behavior and explicit oversized-document budgets have targeted passing tests.

## Priority gaps

### Tenant boundaries for operational overrides and guardrails

`REQ-OVR-001`, `REQ-OVR-003`.

The authenticated save routes accept caller-supplied artifact IDs. The corresponding globally unique-ID upserts and returning lookups do not enforce the current tenant on conflict. An owner/admin who knows another tenant's artifact ID can change that tenant's override or guardrail and receive the row. See [override save](../../../pages/api/_lib/knowledgeReceptionistConfig.js#L510), [guardrail save](../../../pages/api/_lib/knowledgeReceptionistConfig.js#L587), and the [override API](../../../pages/api/v1/knowledge/overrides.js#L34).

An isolated PGlite execution reproduced both mutations using the actual save functions, with the table-readiness assertion bypassed for the fixture. Tenant ownership must be enforced before update and readback, with regression coverage for foreign IDs.

### Factual text removed before analysis and persistence

`REQ-PIPE-005`, `REQ-PIPE-007`, `REQ-SCOPE-001`.

The [cleanup filter](../../../pages/api/_lib/knowledgeReceptionistBuilds.js#L600) removes entire lines containing call-to-action phrases. A factual office-hours sentence ending with "call today for an appointment" disappears before source projection and extraction. An independent extractor fixture also removes "We repair heat pumps. Call today."

The [website source projection](../../../pages/api/_lib/knowledgeReceptionistBuilds.js#L2237) retains cleaned/budgeted text rather than the original fetched HTML. Its stored evidence cannot recover a factual line already discarded by cleanup. The frozen raw-capture requirement therefore remains only partly satisfied on this path. The later page-budget decision explains recorded truncation of oversized sources, not this phrase-based loss.

Preserve factual spans while suppressing identified boilerplate, and retain a recoverable original capture if the raw-evidence contract is to remain unchanged. The existing source-page validator passes but does not cover mixed factual/CTA sentences.

### Rollback can activate an ineligible build

`REQ-OPS-004`, `REQ-OPS-013`.

[Rollback](../../../pages/api/_lib/knowledgeReceptionistBuilds.js#L5291) loads target status but does not require a previously published, known-good target before preparation and active-pointer mutation. A `qa_blocked` target was activated in an isolated execution of the real rollback body and SQL, with catalog, Live brief and asset preparation helpers stubbed successful.

This proves the missing lifecycle guard. It does not establish that every failed build can pass real preparation. Enforce the required eligible target before preparation and preserve normal publication blockers during rollback.

### Source-authority scoring weakens confirmation and classification rules

`REQ-PIPE-022`, `REQ-RULE-007`, `REQ-RULE-012`.

The [source-precedence helper](../../../packages/contracts/src/knowledgeSourcePrecedence.ts#L27) gives an operational website fixture a metadata score of `0.02` and an unclassified uploaded operational fixture `0.10`. Negative educational/marketing contributions collapse to zero because aggregation starts at zero. These mechanics weaken the frozen classification/confirmation prerequisite and content penalties.

The isolated helper test proves the scores, not a complete retrieval outcome or spoken answer. Restore the required eligibility/authority behavior and test conflicting same-fact sources, or explicitly resolve the requirement change. Exact scoring formulas are implementation freedom; the source-authority rules they must preserve are not.

### Conflict resolution and readiness are incomplete

`REQ-PIPE-013`, `REQ-PIPE-015`, `REQ-RULE-004`, `REQ-RULE-009`, `REQ-OPS-001`, `REQ-OPS-005`, `REQ-OPS-006`, `REQ-OPS-007`.

The [compiler consolidation](../../../pages/api/_lib/knowledgeReceptionistCompiler.js#L2638) keys claims by their text, allowing different values of the same operational fact to remain separate. The inspected [validation path](../../../pages/api/_lib/knowledgeReceptionistBuilds.js#L3599) checks artifact presence and selected runtime/budget/latency mechanics; it does not establish the frozen general contradiction, topic coverage, dangerous-question and sample-call acceptance gates.

Existing gates must be acknowledged: build creation requires a domain; prompt assembly requires active knowledge; v20 admission adds callback-role confirmation and a materialized brief. [Setup readiness](../../../pages/api/_lib/clientSetupStatus.js#L463) also checks phone, published knowledge and service access. These are narrower than the frozen checklist. This is source-review evidence, not a full model-generated contradiction simulation.

Resolve the remaining content-validation and readiness requirements explicitly. Specific by-heart safety protections do not certify general cross-source conflict resolution.

## Other departures and incomplete capabilities

| Area | Evidence and effect | Required disposition |
| --- | --- | --- |
| Nested relative links | The [crawler](../../../pages/api/_lib/knowledgeReceptionistBuilds.js#L1081) passes the site origin when analyzing later pages. A relative `details` link on `/services/` resolves to `/details` instead of `/services/details`, potentially missing approved pages or downloads. Actual helper output and caller arguments support this; no external crawl was run. | Resolve against the fetched page URL while retaining origin/scope checks; add nested-page and downloadable-file fixtures. |
| Daily rebuild limit | [assertBuildRateLimit](../../../pages/api/_lib/knowledgeReceptionistBuilds.js#L1917) is a no-op. Two isolated calls make zero database queries. No reviewed decision explicitly removes the frozen daily cap. | Restore atomic enforcement or record an explicit product decision changing the cap. |
| Structured facts and object types | The active [fact construction](../../../pages/api/_lib/knowledgeReceptionistCompiler.js#L2655) uses generic fact/support types and null structured values; [cards](../../../pages/api/_lib/knowledgeReceptionistCompiler.js#L2757) use a generic answer-unit type. This only partly implements the frozen semantic normalization/object contract. | Implement meaningful normalization and object types, or approve and document a replacement contract. |
| Configurable approval mode | Current save paths expose draft/approved statuses and audit, but no tenant/org review-required policy and distinct approver transition was evidenced. The [frozen workflow](v1.0/10-overrides-guardrails-and-business-configuration.md#L178) requires that capability. Immediate save with audit is permitted where review is not required. | Implement the missing configurable mode; do not describe this as bypass of an existing enabled policy. |
| Live request schema creation | [Gateway prompt](../../../pages/api/v1/gateway/prompt.js#L34) calls [ensureTables](../../../pages/api/_lib/db.js#L29), which performs DDL on the first call per process. The in-memory readiness flag suppresses repeat work within that process; it does not move migration off the live path. | Separate migration/deployment schema work from ordinary request handling. |
| Source-channel inventory | [Build metadata](../../../pages/api/_lib/knowledgeReceptionistBuilds.js#L4763) derives included channels from requested input, so a website request can list `website_file` without a captured downloadable source. | Derive the completed inventory from captured inputs and expose exclusions/failures. |
| Acceptance evidence | The [legacy cutover harness](../../../scripts/validate-knowledge-receptionist-cutover.mjs#L20) imports a missing readiness endpoint. Complete cross-vertical and interview-only/website-plus-upload acceptance results were not established. | Repair and run a safe isolated acceptance suite; preserve the narrower scope of current passing tests. |

## Verification record

These existing offline validators passed against the reviewed source:

| Validator | What the result supports |
| --- | --- |
| `scripts/validate-knowledge-source-pages.mjs` | Whole-page normalization, short-line retention and explicit page-budget mechanics covered by its fixtures. |
| `scripts/validate-knowledge-rescan-fresh.mjs` | Fresh website-rescan flags and separate overlay request behavior. |
| `scripts/validate-knowledge-build-leases.mjs` | Claim, heartbeat, release and stale-worker fencing mechanics. |
| `scripts/validate-knowledge-build-transactions.mjs` | Draft retry, preserved blockers, lease fencing, profile conflicts and atomic publication mechanics in its fixtures. |
| `scripts/validate-knows-by-heart-part9.mjs` | Protected manual selections, ownership guards and associated deterministic catalog mechanics. |

Additional isolated fixtures reproduced factual-line deletion, no-op daily limiting, relative-link resolution, source-authority scores, cross-tenant configuration writes and rollback status admission. Some fixtures extract private function bodies or stub successful preparation; the [evidence record](conformance-evidence-2026-10-20.json) states those boundaries. No production database, live crawl, paid model request or audible call was used. Full four-channel, cross-vertical and model-semantic acceptance is not certified by these results.

## Keeping future work aligned

Before changing this pipeline, load the frozen index, ingestion pipeline, artifact schemas, source-precedence rules and operational lifecycle alongside the later decisions. The standard root bootstrap currently names only the five core app documents, so it does not explicitly require this detailed design read.

For each future change, identify the affected requirement IDs, the current implementation/test evidence, and whether the change preserves a requirement or intentionally alters it. A renamed module or different index technology can be an implementation choice. Changing source authority, dropping evidence, changing artifact meaning or weakening publication gates requires an explicit design disposition.

The next implementation work should first address tenant isolation, factual-line preservation and rollback eligibility. Then reconcile source authority, conflict/readiness gates and the documented/proposed lifecycle changes. Update the baseline only after deciding the intended behavior; do not update specifications merely to declare the existing implementation compliant.
