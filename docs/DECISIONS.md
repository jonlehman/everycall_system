# Decisions

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
