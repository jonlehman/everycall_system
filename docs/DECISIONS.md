# Decisions

## 2026-02-28
- Use OpenAI Realtime in `call-gateway` for voice responses (Render deployment).
- Admin/client app deployed on Vercel; call gateway on Render.
- Seed industry prompts and FAQs for consistent onboarding.
- Deterministic FAQ answers preferred over model improvisation.
- Barge-in cancels assistant speech and output audio.

## 2026-03-05
- Gateway is thin runtime: no conversational logic in code; all flow and rules live in the EveryCall system prompt.
- Gateway must never send instructions not provided by EveryCall.
- Tooling is limited to FAQ lookup and data capture; fields are defined by EveryCall schema.
- Realtime session config is admin-driven and demo-aligned (model `gpt-realtime-1.5`, voice `marin`, `server_vad` threshold `0.75`).

## 2026-03-02
- Added `docs/HISTORY.md` to preserve high-level project timeline.

## 2026-03-03
- Adopt Tailwind + shadcn/ui as the default web UI foundation (see ADR `0004-tailwind-shadcn-ui-standard.md`).
