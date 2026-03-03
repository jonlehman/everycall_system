# Project History (Condensed)

This is a high‑level timeline generated from git history and current docs. It is intended to capture major technical shifts and behavioral changes rather than every commit.

## 2026‑03‑02
- Added collaboration docs and specs (`docs/PRD.md`, `docs/SPECS/*`, `docs/DECISIONS.md`, `docs/TESTS.md`, `docs/RUNBOOK.md`).

## 2026‑03‑03
- Merged Dispatch Board into Calls Inbox and centralized dispatch follow-ups on the Calls screen.

## 2026‑02‑28
- Realtime voice tuning: multiple VAD/pacing adjustments to reduce latency and interruptions.
- Added realtime model logging and transcript capture improvements.
- Unified prompt preview and single‑use greeting placement.
- Began deterministic control in call‑gateway: FAQ routing, pre‑close control, barge‑in handling.
- Seeded prompt tone changes (less urgent, more empathetic) and added common FAQ categories across industries.
- Added tone overrides for Realtime voice (warm, non‑announcer).

## 2026‑02‑27
- Telnyx streaming integration: bidirectional audio, RTP handling, OpenAI Realtime streaming.
- Stored realtime transcripts in DB; combined transcripts in call details.
- Added voice samples and greeting/voice controls in client.
- TeXML gather flow adjustments and logging improvements.

## 2026‑02‑26
- Switched call‑gateway to Telnyx voice webhooks.
- Added Telnyx SMS inbound/outbound and opt‑in UI.
- Seeded industry prompts and FAQs; added seed‑all flow.
- Added system prompt fields and prompt composition from system + industry + tenant.
- Deployment scaffolding and Docker build fixes for services.

## 2026‑02‑25
- Next.js app migration to App Router.
- Built admin/client UI: tenants, FAQs, routing, dispatch board, auth flows.
- Added onboarding intake flow and tenant tooling.

## 2026‑02‑23 to 2026‑02‑24
- Initial monorepo scaffold with core services.
- Twilio inbound flow (later replaced by Telnyx).
- Prompt config UI and persistence in Postgres.

## Notes
- Production deployment split: Vercel for admin/client app, Render for call‑gateway.
- Current focus: deterministic call flow controls, FAQ fidelity, and natural audio behavior.
