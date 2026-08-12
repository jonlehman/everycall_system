# Decisions

## 2026-08-11
- Serialize realtime tool execution per call. Treat an exact repeated `data_capture` payload as idempotent, permit at most one capture-driven assistant continuation per caller speech turn, and discard queued continuations after an accepted `finish_session`. Attribute tool-response timing with a FIFO dispatch ledger plus response-ID maps rather than one shared pending slot. Default Telnyx outbound buffering to 400 ms (20 PCMU frames) to absorb the measured xAI chunk starvation while keeping caller barge-in queue clearing unchanged.
- Use canonical receptionist v9 as the exact supplied receptionist prompt. It keeps the seven existing tenant substitutions and adds the system-rendered `core_facts_block`. When a tenant has no pinned core facts, omit the complete “What You Know By Heart” section and both references to it. Put callback name before phone regardless of legacy configured field order.
- Store automatic “knows by heart” selection on the canonical `knowledge_build_facts` rows. Pinned facts remain vector indexed; the prompt renders `Title: spoken fact` lines within a 600-token budget. Have AI rate every fact when it is created, use an AI editorial pass to choose the strongest stable facts, run a dedicated AI atomic spoken-rewrite pass on the finalists, and then independently AI-audit each exact rendered line with a separate required marketing-language judgment. Every AI-rated stable fact with a safe complete line reaches the editor; numeric scores are evidence for AI, never a code-owned cutoff or order. Deterministic code never selects or ranks relevance; it only rejects known instruction or marketing leakage, validates rewrite semantics, and enforces tenant isolation, retrieval eligibility, hysteresis, swap and token limits, and persistence. For batch refinement after seven days or 50 calls, AI chooses and orders the complete set from all eligible incumbents and candidates, with at most three swaps. Expose the current list plus its change log only in the internal admin.
- Rewrite the single canonical `tenant_prompt_profiles.company_description` into conservative spoken register during onboarding/admin updates and the controlled existing-tenant backfill. Do not create a second tenant company-description source.
- Use canonical receptionist v8 as the exact supplied receptionist prompt, with only the seven tenant substitutions `assistant_name`, `business_name`, `lead_goal`, `company_description`, `required_contact_fields_block`, `ai_disclosure_line`, and `closing_phrase`. Send the rendered `system_prompt` to xAI unchanged; do not append transfer instructions in the gateway. Keep transfer constraints in the tool definitions and deterministic gateway validation, and keep v7 archived for rollback.
- Treat xAI caller transcription events as cumulative snapshots within one VAD speech turn. Persist the first snapshot as one caller `call_events` row and update that row as corrected or longer snapshots arrive. Collapse legacy adjacent cumulative snapshots on every transcript read so existing call detail, export, notification, analysis, summary, and knowledge-context paths present one caller line per turn.

## 2026-08-10
- Use canonical receptionist v7 to keep knowledge lookups from splitting substantive answers, require enough project understanding before offering a callback, treat a declined callback or transfer as declining only that option, and reserve `finish_session` for a clear mutual close. Enforce the existing spoken-close policy in the gateway so an early finish request leaves the call active and returns control to the assistant. Keep v6 archived for rollback.
- Use `tenant_prompt_profiles.company_description` as the only tenant-specific business description in the canonical receptionist prompt. Canonical receptionist v6 keeps that description tenant-scoped and reduces the model prompt to concise, state-based guidance while retaining grounded lookup, capture, closing, safety, and conditional transfer rules; v5 remains archived for rollback.
- Deliver the configured tenant opening verbatim with xAI `force_message` after `session.updated`, with `interruptible=true`, instead of asking the model to reproduce it from the system prompt. Keep separate sales-demo and browser-demo greeting acknowledgement contracts isolated.
- Use xAI `ara` as the default EveryCall receptionist voice, superseding the initial `luna` cutover default.
- Use only xAI-native Speech to Speech session fields on inbound calls: `server_vad`, a `0.9` activation threshold, a 200 ms silence endpoint, `reasoning.effort=high`, nested audio/transcription configuration, and streamed audio deltas.
- Prefer Grok's only supported reasoning-enabled level, `high`, to improve conversation continuity and instruction following. Use canonical receptionist prompt v6 for understanding-first discovery, direct factual answers, caller-authorized capture, and one canonical tenant company description; measure endpoint-to-first-audio latency during the canary before considering `none` again.
- Let xAI server VAD own model-side automatic response and interruption. On caller barge-in, EveryCall clears its local audio queue and Telnyx's playback queue without sending redundant OpenAI-era cancel/truncate events.
- Request only the caller's inbound Telnyx track and log endpoint-to-first-audio latency for production turn-taking verification.
- Start Telnyx's answer command before prompt retrieval, knowledge prewarming, and call-state persistence. The `call.answered` and media-stream handlers wait for the same in-flight session bootstrap instead of performing duplicate recovery.
- Use xAI's maximum documented VAD activation threshold, `0.9`, to reduce acoustic speakerphone echo being mistaken for caller barge-in. Do not disable caller interruption.

## 2026-02-28
- Use xAI Grok Realtime in `call-gateway` for voice responses (Render deployment).
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

## 2026-07-30
- Replace every realtime voice path with xAI Grok Speech to Speech and pin `grok-voice-think-fast-2.0`; keep unrelated OpenAI Responses, summaries, embeddings, and knowledge compilation unchanged.
- The inbound gateway and voice-preview API use `wss://api.x.ai/v1/realtime`; browser demos receive an xAI ephemeral client secret and connect with the `xai-client-secret.*` WebSocket subprotocol.
- Outbound sales uses a Direct SIP number registered with xAI, dials `sip:{E.164}@sip.voice.x.ai;transport=tls`, verifies signed xAI webhooks, and joins incoming calls by opening the `call_id` WebSocket. xAI has no separate accept request.
- Rename persisted `openai_call_id` to `xai_call_id` with an additive, idempotent migration and migrate queued provider-event labels from `openai` to `xai`.
- Estimate Grok realtime audio at its per-minute rate rather than applying OpenAI token rates.
