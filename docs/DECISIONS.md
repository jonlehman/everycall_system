# Decisions

## 2026-08-19
- Canonical Receptionist v15 replaces the accumulated canonical rule text with the owner-approved condensed template. Preserve its exact generic wording as the source of truth, keep tenant values and the persisted `What You Know By Heart` block in the Business Details layer, keep the per-call volatile layer empty, and retain silent-only `knowledge_lookup` and `data_capture` tool schemas. Adjacent-request engagement begins only after lookup returns, and every callback offer is one short question followed by a wait for explicit consent.
- Canonical Receptionist v14 makes `knowledge_lookup` fully silent. The response containing the tool call is function-call-only; after the fast lookup returns, the receptionist starts with the useful answer. Remove spoken lookup preambles, process narration, transitions, and latency filler.
- Canonical Receptionist v13 keeps every v12 behavior and tenant binding, replaces realistic name examples with a first-name-plus-spelled-surname protocol, limits later address to first name only, and removes realistic assistant-name literals from the generic rule layer.
- Typical assistant turns target about 25 spoken words: answer once, stop, do not narrate internal actions, and never repeat already confirmed contact data in the close. The full Realtime acceptance battery must report an average below 30 assistant words per turn.
- Remove the older “confirm both back” and no-workflow detail-recap instructions because phone and surname already have explicit confirmation steps. `data_capture` is silent-only; after it succeeds, continue directly to the next question or the first-name-plus-closing-phrase close.
- Treat the early “Got it—a cracked pane” interruption in the second 8/19 WVG call as a single VAD observation. v13 does not change turn-detection thresholds; revisit them only if the pattern recurs.
- Canonical Receptionist v12 keeps the hashed pre-Grok OpenAI baseline and all v11 rules, replaces the conflicting bare lookup preamble with acknowledge-while-looking-up behavior, closes the implicit “anything else / otherwise” closing loophole, and gives caller names the same confirm-and-preserve discipline as phone numbers.
- Treat implicit invitations to add, share, or ask something as unanswered assistant questions in the gateway `finish_session` guard, even when the model omits a question mark.
- Score `What You Know By Heart` facts with the v3 universal caller-question taxonomy. Broad repairs/service, estimate policy, service area, hours, emergency availability, and main service lines outrank brands, product catalogs, rebates, and implementation details. Unchanged v3 rating-input hashes are still reused without another OpenAI review.
- Require v6 spoken pins to use safe first-person business voice. If changing the subject to “we” would attribute a supplier or manufacturer claim to the tenant, omit that pin while retaining its canonical fact for lookup.
- When website ingest cannot confirm broad repair/service coverage, create one pending five-question owner confirmation. Store confirmed answers as first-party setup-interview evidence and compile them in a versioned overlay build; never infer the missing answers from deterministic line parsing.
- Require website-generated company descriptions and persisted no-tool statements to end at sentence boundaries. Website ingest writes first-person `we/our/us` descriptions and rejects an invalid snapshot instead of storing truncated or third-person text.

## 2026-08-18
- Compile each website page or uploaded document as one page-level AI evidence document rather than arbitrary five-line chunks. Preserve every nonempty visible line regardless of length, retain line breaks, and keep provenance at the source-page level. Bound genuinely oversized sources at 12,000 estimated tokens by retaining the beginning and end with explicit truncation metadata; keep the existing cross-page summary, topic, and artifact request budgets unchanged. The legacy `source_segments` and `source_chunks` tables remain compatibility containers with one page-document row per source.
- Rate `What You Know By Heart` importance from the fact's actual meaning and caller value only. Keep stability and fact-level safety as separate eligibility gates, and assess marketing language, jargon, duplicated headings, or other writing defects only in the post-ranking spoken-register rewrite. A failed rewrite may exclude a pin but may not erase its factual-importance score.
- Bound generated company descriptions at the last complete sentence within 320 characters, reject dangling conjunctions or prepositions, and refresh both the company description and persisted no-tool statement together when a website build is published.
- Serialize knowledge-build cron and manual runners with a durable row lease containing a unique token, owner, expiry, and heartbeat. Do not use PostgreSQL session advisory locks because production uses Neon's transaction-pooled endpoint.
- Require the active lease token for scheduled ready/publish/failure transitions. A stale or duplicate worker may not overwrite a terminal build, especially a build that is already published.
- Treat an unsafe spoken-register rewrite as a fact-local exclusion: keep the canonical fact for embeddings and lookup, remove it from prompt pins, record a warning, and continue the build. v6 rewrites use first-person business voice and require an explicit model safety decision before changing a third-person canonical subject to “we.”

## 2026-08-17
- Keep the restored OpenAI canonical receptionist v3 prompt byte-for-byte unchanged for tenants without pinned core facts. Canonical v10 adds only a conditional `What You Know By Heart` section, one matching memory allowance, and one lookup exception; the validation suite reconstructs and hashes the v3 baseline to prevent unrelated prompt drift.
- Rate a fact for `What You Know By Heart` only when its canonical content, relevant qualifiers, or tenant scoring context changes. Reuse the saved OpenAI rating for an identical rating-input hash; never periodically ask OpenAI to reconsider unchanged facts.
- Materialize the tenant/build `What You Know By Heart` section from a deterministic score-descending database order, a stable hash tie-breaker, a 600-token budget, and a 20-fact ceiling. Rebuild it only during a knowledge change/backfill or an explicit administrative action; there is no scheduled or call-count-driven refinement.

## 2026-02-28
- Use OpenAI Realtime in `call-gateway` for voice responses (Render deployment).
- Admin/client app deployed on Vercel; call gateway on Render.
- Seed industry prompts and structured knowledge starters for consistent onboarding.
- Grounded knowledge retrieval is preferred over model improvisation.
- Barge-in cancels assistant speech and output audio.

## 2026-03-05
- Gateway is thin runtime: no conversational logic in code; all flow and rules live in the EveryCall system prompt.
- Gateway must never send instructions not provided by EveryCall.
- Tooling is limited to knowledge lookup and data capture; fields are defined by EveryCall schema.
- Realtime session config is admin-driven and demo-aligned (model `gpt-realtime-1.5`, voice `marin`, `server_vad` threshold `0.75`).

## 2026-03-12
- Replace the FAQ-centric tenant knowledge model with a tenant-scoped knowledge system built around knowledge entries, grounded facts, retrieval cards, overrides, guardrails, and Guardrail Questions.
- Keep final conversational relevance and wording decisions in the realtime phone AI; the knowledge subsystem retrieves and packages relevant knowledge only.

## 2026-03-02
- Added `docs/HISTORY.md` to preserve high-level project timeline.

## 2026-03-03
- Adopt Tailwind + shadcn/ui as the default web UI foundation (see ADR `0004-tailwind-shadcn-ui-standard.md`).

## 2026-04-20
- Standard EveryCall subscription pricing is code-owned in `lib/standardBillingPlans.js`. The public website can mirror it, but the app billing catalog is the source of truth.
- Stripe Customer Portal is the supported self-serve surface for subscription changes.
- EveryCall enforces one active plan per billing cycle:
  - the current cycle keeps its existing plan, included-call allowance, and overage rate
  - a customer-initiated plan change is stored as a pending change and takes effect on the next renewal
  - mid-cycle prorations are disabled for plan changes
  - the app must recognize both direct Stripe subscription price swaps and Stripe-created subscription schedules for future-dated portal changes

## 2026-06-22
- Use `gpt-realtime-2` as the default OpenAI Realtime voice-agent model for new runtime profiles and demos.
- `call-gateway` auto-selects the Realtime 2 nested session schema for `gpt-realtime-2` and preserves a legacy schema rollback path via `OPENAI_REALTIME_API_SHAPE=legacy`.
- Existing tenant runtime profiles with explicit legacy model overrides are migrated deliberately rather than silently rewritten.

## 2026-07-14
- Use `gpt-realtime-2.1` as the default OpenAI Realtime voice-agent model for new runtime profiles and the live web demo; the production gateway consumes the model from each admin/runtime-profile `session_config` payload.
- Treat `gpt-realtime-2.1` as part of the Realtime 2 schema family: keep the nested session shape and `OPENAI_REALTIME_API_SHAPE=auto` rather than introducing a new API-shape branch.
- Preserve a deliberate tenant/runtime-profile pin to `gpt-realtime-1.5` plus `OPENAI_REALTIME_API_SHAPE=legacy` as the explicit operational rollback; the gateway environment variable controls API shape, not the model.
- Canary coverage must include alphanumeric recognition, silence and background-noise handling, and interruption behavior in addition to the existing gateway, tool, and audio checks.

## 2026-07-28
- Build the live telemarketing demo as an additive outbound-sales subsystem. It has separate sales tables, provider credentials, Telnyx connection and webhook service, and must not route through the production inbound gateway or public-demo session records.
- Use a browser-only, human-initiated Telnyx WebRTC call. The dedicated sales credential must park the operator leg; only then may the isolated sales gateway create the conference and concurrently dial the prospect and the OpenAI SIP standby leg.
- Keep the human operator connected and unmuted throughout. `Start Demo` joins an already accepted and configured AI standby; it does not build or reconnect the receptionist.
- Keep prepared sales demo bundles for 30 days and maintain the current prospect plus 10 upcoming prospects as the warm queue.
- Treat phone eligibility and Smartlead email suppression as separate channel states. Record outcomes durably and route eligible email follow-up asynchronously.
- Assisted signup sends a short-lived, single-use prefilled link to the prospect. The prospect creates their own password and submits through the existing onboarding transaction; sales-demo artifacts are never promoted into tenant data.

## 2026-08-17
- Canonical Receptionist v11 preserves the restored pre-Grok OpenAI prompt and its by-heart accommodations, then adds the reviewed callback-consent, one-action-per-turn, phone-confirmation, closing/`finish_session`, and light-humor rules.
- The gateway enforces the closing invariant independently of the model: `finish_session` is rejected when the latest assistant turn asks a question or when no later caller turn follows the closing.
- Render Realtime prompts as a byte-stable canonical layer, one contiguous Business Details layer, and an empty volatile layer. `OPENAI_REALTIME_LAYERED_PROMPT_ENABLED=false` is the rollback; layered rendering is the default after the v11 comparative battery produced an 82.01% cross-tenant cache hit on the second layered call.
- Realtime prompt caching remains automatic and best-effort. Record cached input tokens and per-response/cumulative hit rates, but do not send the Responses-only `prompt_cache_key` field in a Realtime session.
- Prompt assembly is read-only with respect to AI generation: both the company-description/no-tool snapshot and the AI-curated What You Know By Heart block are generated and stored during knowledge publication, then loaded verbatim at call startup.
- Persist `basic_no_tool_allowed_statement` on the tenant prompt profile and refresh it only when a website build is published, never during call prompt loading.
- Score only new or materially changed canonical facts. After the saved scores are sorted, run the eligible candidate set through one versioned AI curation pass to remove semantic duplicates and choose distinct caller-useful facts, then rewrite each selected fact into a versioned spoken label and sentence. Store the finished block and selected fact IDs before call time; canonical claims remain authoritative for embeddings and lookup.
