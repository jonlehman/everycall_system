# EveryCall Multi‑Agent Task Plan

This document is the shared task list for agents working on EveryCall. Edit freely as work progresses.  
Use the **Status** column and keep **Dependencies** accurate.

## Status Legend
- `not started`
- `in progress`
- `blocked`
- `done`

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

---

## 1) Foundation & Infrastructure
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| F1 | Confirm Vercel env vars (DATABASE_URL, OPENAI_API_KEY, TELNYX_API_KEY, APP_BASE_URL) | | not started | — | Required for most flows |
| F2 | Add Telnyx webhook signature verification | | not started | F1 | Use TELNYX_API_KEY |
| F3 | DB migrations sanity check on prod | | not started | F1 | Ensure new columns exist |
| F4 | Confirm DNS + domain routing for app.everycall.io | | not started | — | Must resolve to Vercel |

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
| S1 | Store shared SMS number in system config | | not started | F3 | System config field |
| S2 | Create outbound SMS API wrapper (Telnyx) | | not started | F1 | Use TELNYX_API_KEY |
| S3 | Alert template(s) for appointment/call summary | | not started | V5 | |
| S4 | Send SMS to tenant users after call summary | | not started | S2, S3, V5 | Opt‑in rules TBD |

## 4) Tenant & Industry Management
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| T1 | Auto‑provision local voice number per tenant | | not started | F1 | No toll‑free |
| T2 | Assign voice number to SIP/voice app | | not started | T1 | Telnyx connection |
| T3 | Admin “Import Industry Prompt/FAQs” UX complete | | done | — | Implemented |
| T4 | Onboarding uses industry prompt + FAQs | | done | — | Implemented |

## 5) Client Workspace UX
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| C1 | Calls Inbox: filters + refresh | | done | — | Implemented |
| C2 | Dispatch Board: status + assign + due dates | | done | — | Implemented |
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
| Q1 | Smoke test against deployed services | | blocked | F1 | Needs service URLs |
| Q2 | Regression checklist (admin + client flows) | | not started | — | |

## 10) Release & Rollout
| ID | Task | Owner | Status | Dependencies | Notes |
|---|---|---|---|---|---|
| R1 | Staging rollout plan | | not started | V6, S4 | |
| R2 | Production rollout checklist | | not started | R1 | |
