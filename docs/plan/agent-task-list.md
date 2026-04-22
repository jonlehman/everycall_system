# EveryCall Multi‑Agent Task Plan

This document is the shared task list for agents working on EveryCall. Edit freely as work progresses.  
Use the **Status** column and keep **Dependencies** accurate.

## Status Legend
- `not started`
- `in progress`
- `blocked`
- `done`

## Active Agents
- Dev A (Core Platform)
- Dev B (Telephony + Webhooks)
- Dev C (Data + Admin UX)
- Smoke Agent (Testing after each task marked done)

## Task Index
1. Foundation & Infrastructure
2. Voice Processing (MVP, no emergency dispatch)
3. SMS Alerts (Shared Number)
4. Tenant & Industry Management
5. Client Workspace UX
6. Admin Console UX
7. Security & Compliance
8. Observability & Ops
9. Testing & QA
10. Release & Rollout
11. Intake V2 (Structured Onboarding)
12. Client UI V2 (Workflow Clarity)

---

## 1) Foundation & Infrastructure
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| F1 | Confirm Vercel env vars (DATABASE_URL, OPENAI_API_KEY, TELNYX_API_KEY, APP_BASE_URL) | Dev A | done | — | Required for most flows |
| F1a | Add TELNYX_PUBLIC_KEY env var for webhook verification | Dev A | done | — | Required for Telnyx webhook verification |
| F1b | Add TELNYX_VOICE_CONNECTION_ID env var | Dev A | not started | — | Required for voice number provisioning |
| F2 | Add Telnyx webhook signature verification | Dev B | done | F1 | Uses TELNYX_PUBLIC_KEY |
| F3 | DB migrations sanity check on prod | Dev C | done | F1 | Prod columns verified & added |
| F4 | Confirm DNS + domain routing for app.everycall.io | | not started | — | Must resolve to Vercel |
| F5 | Deploy call-gateway service | Dev A | done | F1 | https://everycall-call-gateway.onrender.com |
| F6 | Deploy ai-orchestrator service | Dev A | done | F1 | Removed |
| F7 | Deploy voice-service | Dev A | done | F1 | Removed |
| F8 | Record service URLs in plan for smoke tests | Dev A | done | F5 | CALL_GATEWAY_URL set in Vercel |

## 2) Voice Processing (MVP, no emergency dispatch)
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| V1 | Define call state schema (fields collected, status) | | not started | F3 | Align with PRD |
| V2 | Persist call transcript + extracted fields | | not started | V1 | DB tables or JSON |
| V3 | Implement AI orchestrator turn flow | | not started | V1 | Single message + one question |
| V4 | Connect Voice Service (TTS) to call flow | | not started | V3 | |
| V5 | End-of-call summary generation | | not started | V2, V3 | |
| V6 | Client notification on call end (email) | | not started | V5 | |

## 3) SMS Alerts (Shared Number)
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| S1 | Store shared SMS number in system config | Dev C | done | F3 | System config field |
| S2 | Create outbound SMS API wrapper (Telnyx) | Dev B | done | F1 | Use TELNYX_API_KEY |
| S3 | Alert template(s) for appointment/call summary | Dev B | done | V5 | Implemented call summary template |
| S4 | Send SMS to tenant users after call summary | Dev B | done | S2, S3, V5 | Requires opt-in + shared number |
| S4a | Wire call summary save to SMS alerts endpoint | Dev B | done | S4 | Uses /api/v1/calls action=summary |

## 4) Tenant & Industry Management
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| T1 | Auto‑provision local voice number per tenant | Dev B | done | F1 | No toll‑free |
| T2 | Assign voice number to SIP/voice app | Dev B | done | T1 | Telnyx connection |
| T3 | Admin “Import Industry Prompt/FAQs” UX complete | | done | — | Implemented |
| T4 | Onboarding uses industry prompt + FAQs | | done | — | Implemented |

## 5) Client Workspace UX
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| C1 | Calls Inbox: filters + refresh | | done | — | Implemented |
| C2 | Dispatch Board: status + assign + due dates (now merged into Calls Inbox) | | done | — | Implemented |
| C3 | FAQ Manager: MUI table + editing | | done | — | Implemented |

## 6) Admin Console UX
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| A1 | Admin system prompts fields | | done | — | Implemented |
| A2 | Industry defaults seeding (prompts + FAQs) | | done | — | Implemented |
| A3 | Tenant manage: industry + prompt/FAQ imports | | done | — | Implemented |

## 7) Security & Compliance
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| S7-1 | Verify webhooks (Telnyx) | | not started | F2 | |
| S7-2 | Recording consent logic (if recording enabled) | | not started | V1 | |
| S7-3 | Payment data handling rules | | not started | — | No card capture |

## 8) Observability & Ops
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| O1 | Structured logging for calls + webhooks | | not started | V2 | |
| O2 | Error alerting for webhook failures | | not started | O1 | |
| O3 | Admin view for webhook errors | | not started | O2 | |

## 9) Testing & QA
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| Q1 | Smoke test against deployed services | Smoke Agent | done | F8 | Smoke passed against Render URLs |
| Q2 | Regression checklist (admin + client flows) | Dev A | done | — | Added docs/plan/regression-checklist.md |

## 10) Release & Rollout
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| R1 | Staging rollout plan | Dev A | done | V6, S4 | docs/plan/staging-rollout.md |
| R2 | Production rollout checklist | Dev A | done | R1 | docs/plan/production-rollout.md |

## 11) Intake V2 (Structured Onboarding)
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| I1 | Intake v2 technical spec approved | Dev A | done | — | docs/SPECS/intake-onboarding-v2.md |
| I2 | Intake v2 delivery plan approved | Dev A | done | I1 | docs/plan/intake-v2-delivery.md |
| I3 | Intake v2 test matrix approved | Smoke Agent | done | I1 | docs/TESTS-intake-v2.md |
| I4 | Migration ADR proposed (schema + rollout strategy) | Dev C | done | I1 | docs/adr/0002-intake-v2-migration.md |
| I5 | DB schema: forwarding status columns added | Dev C | done | I4 | Added in pages/api/_lib/db.js |
| I6 | DB schema: idempotency storage added | Dev C | done | I4 | Added onboarding_idempotency table + index |
| I7 | API: onboarding request validation hardened | Dev A | done | I1, I5 | Required arrays + field errors implemented |
| I8 | API: onboarding transaction boundary implemented | Dev A | done | I5 | Rollback-safe writes implemented |
| I9 | API: owner session created on onboarding success | Dev A | done | I8 | Session cookie set post-commit |
| I10 | API: tenant key collision strategy implemented | Dev A | done | I8 | suffix strategy `_2`, `_3` implemented |
| I11 | API: canonical response shape + error codes | Dev A | done | I7, I8, I9 | Includes `redirectTo` + provisioning block |
| I12 | UI: intake payload aligned to v2 contract | Dev B | done | I1 | sends `primaryGoals`, validates required arrays |
| I13 | UI: success activation panel + forwarding guidance | Dev B | done | I9, I11 | Shows EveryCall number and routing instruction |
| I14 | UI/API: forwarding acknowledgment persistence | Dev B | done | I5, I13 | `/api/v1/tenants/forwarding-status` implemented |
| I15 | Tests: API integration suite for intake v2 | Smoke Agent | done | I11 | Passed on production at commit 4966b73 |
| I16 | Tests: E2E onboarding -> authenticated redirect | Smoke Agent | done | I13, I14 | Passed on production at commit 4966b73 |
| I17 | Regression checklist onboarding section updated | Dev A | done | I15, I16 | docs/plan/regression-checklist.md updated |
| I18 | Staging rollout + 24h monitoring for intake v2 | Dev A | in progress | I17 | Production tests passed; monitoring window active |

## 12) Client UI V2 (Workflow Clarity)
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| CU1 | Client UI v2 technical spec approved | Dev A | done | — | docs/SPECS/client-ui-v2.md |
| CU2 | Client UI v2 delivery plan approved | Dev A | done | CU1 | docs/plan/client-ui-v2-delivery.md |
| CU3 | Client UI v2 test matrix approved | Smoke Agent | done | CU1 | docs/TESTS-client-ui-v2.md |
| CU4 | Client UI v2 ADR proposed | Dev C | done | CU1 | docs/adr/0003-client-ui-v2-delivery-contract.md |
| CU5 | Shared page shell + status feedback pattern | Dev B | done | CU1 | Added reusable ClientPage scaffold + status styles |
| CU6 | Overview screen aligned to workflow contract | Dev B | done | CU5 | Triage-focused overview with primary/secondary actions |
| CU7 | Calls Inbox aligned to filter/detail workflow | Dev B | done | CU5 | Uses shared scaffold, clear filters, explicit load/error states |
| CU8 | FAQ + Routing screens aligned to save-state standards | Dev B | done | CU5 | Shared scaffold + explicit load/save/delete states |
| CU9 | Settings + Team screens aligned to role matrix | Dev B | done | CU5 | Shared scaffold + clear actions/status on Settings/Team |
| CU10 | API error envelope and role checks hardened | Dev A | done | CU1 | Settings/Team/FAQ/Routing envelopes + validation updated |
| CU11 | Owner setup checklist with deep links | Dev B | done | CU6, CU8, CU9 | `/client/setup` now shows actionable deep-linked checklist |
| CU12 | Client UI v2 API + E2E test execution | Smoke Agent | done | CU6, CU7, CU8, CU9, CU10 | Passed on production at commit ce4aea2 |
| CU13 | Regression checklist updated for client-ui v2 | Dev A | done | CU12 | docs/plan/regression-checklist.md updated |
| CU14 | Staging rollout + 7-day monitoring | Dev A | done | CU13 | Monitoring window completed; stale workflow retired on 2026-04-22. |
