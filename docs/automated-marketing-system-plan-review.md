# Live Telemarketing + In-Call AI Demo — Plan Review

**Status:** Implemented in code; provider configuration and live canary pending

**Date:** July 28, 2026

**Scope:** Human-led outbound calls, an on-demand EveryCall receptionist inside the same call, assisted signup, and email follow-up.

## Implementation Status

The repository now contains the isolated sales tables and migration, admin console and APIs, rolling demo worker, browser WebRTC client, dedicated sales call gateway, Telnyx/OpenAI webhook handling, assisted-signup handoff, Smartlead jobs/webhook, cron processing, and validation suite.

Static, database-backed, API, and browser checks are complete. A live Telnyx/OpenAI canary remains an operational release gate because dedicated provider credentials and webhook secrets are not present in the local verification environment.
The scheduled sales worker is default-off behind `SALES_OUTBOUND_ENABLED` until that migration and canary are complete, and the isolated gateway requires a manual drained deployment.

## Executive Review

The revised concept is stronger than the ringless-voicemail plan.

The telemarketer remains the salesperson and stays live throughout. The AI is brought into the existing call only when the prospect wants proof. After the demo, the telemarketer continues the conversation and can guide an interested prospect through the normal EveryCall signup while both people are still on the phone.

The implemented architecture is:

```text
Telemarketer browser \
                     Telnyx sales conference
Prospect phone ------/

Prepared AI standby leg -- joins the conference when "Start Demo" is pressed
```

Telnyx should own the conference and every call leg. This gives the application deterministic controls for joining the already-prepared AI, pausing or removing it when the demonstration ends, and recovering if the AI disconnects. The telemarketer remains live and unmuted throughout the demonstration.

OpenAI's Realtime SIP interface can receive the temporary AI call leg and run the receptionist configured for that prospect. Telnyx can originate calls to phone numbers or SIP addresses and programmatically place participants into a conference.

This is an integration pattern inferred from the documented capabilities and should be proven with a short technical spike before the full dialer is built.

## What Changes From the Earlier Plan

- Slybroadcast and ringless voicemail leave the primary workflow.
- The initial contact is a live, manually initiated call from a real telemarketer.
- The AI does not place the sales call or speak unless the demo is deliberately started.
- The operator uses browser audio only; there is no business-phone fallback.
- The AI runtime is prepared as soon as **Call** is pressed and waits silently outside the sales conference.
- Smartlead remains useful for follow-up email, but its messages must be rewritten around live-call outcomes.
- The 15-number rotating demo pool is not required for the in-call demo.
- The existing demo-profile builder and production onboarding flow remain useful.
- Trial length remains a configurable product decision; this plan does not change it from 30 to 14 days.

If EveryCall later offers a private callback demo after the sales call, the permanent number pool can return as a separate feature. It should not be part of the first live-call version.

## Isolation From Existing EveryCall Systems

This should be built as an additive outbound-sales subsystem. It should not change the behavior or call path of either the production EveryCall receptionist or the existing public web demo.

### Production EveryCall

- Keep production tenant numbers, inbound routing, call gateway, tenant prompts, and tenant data unchanged.
- Give the sales dialer its own Telnyx Call Control application, webhook path, service configuration, call records, and worker queue.
- Do not write prepared sales demos into production tenant or knowledge tables.
- The only intentional handoff is **Start Setup**: a secure prefilled invitation enters the existing intake, after which normal onboarding creates and builds the real tenant.

### Existing Public Web Demo

- Keep its visitor-facing interface, API routes, browser voice sessions, rate limits, and demo records unchanged.
- Reuse pure website-fetching, extraction, prompt-building, and demo-knowledge helpers where practical.
- Store outbound-sales demo profiles and session state separately rather than placing them in public-demo records or queues.
- Production onboarding must still rebuild the company's knowledge; neither sales-demo nor public-demo artifacts are promoted into production.

### Shared-Capacity Protection

Sales preparation and calls must have separate concurrency limits and failure boundaries so a large queue cannot delay inbound customer calls or public demos. Production traffic takes priority if provider or worker capacity is constrained.

This may add new code and infrastructure to the EveryCall repository, and a few pure helpers may be extracted for reuse. Those changes must remain behavior-preserving for the two existing systems and be covered by regression tests.

## Browser-Only Call Path

Use the Telnyx WebRTC SDK inside the sales console for every operator call.

Advantages:

- the prospect record, call controls, and audio are in one screen
- the system knows exactly when the telemarketer, prospect, and AI are connected
- `Start Demo`, `Pause AI`, `End Demo`, participant, and hangup controls are reliable
- no dependency on a separate desk phone, PBX, or business-phone call path
- easier event logging and support

The application should connect the telemarketer first, then dial the prospect. The prospect should never answer into silence while the telemarketer's leg is still being established.

References:

- [Telnyx WebRTC browser calling](https://developers.telnyx.com/development/webrtc/js-sdk/tutorials/make-your-first-call)
- [Telnyx outbound dial API](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Telnyx conferencing](https://developers.telnyx.com/docs/voice/programmable-voice/conferencing-demo)
- [Telnyx conference controls](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)

## End-to-End Workflow

### 1. Prepare the Prospect

The CSV import creates the prospect record and applies permission and suppression rules.

Before the call, the system:

- validates the telephone number and local calling time
- checks all applicable suppression and do-not-call states
- builds the temporary company demo from the CSV and website
- shows the business name, contact, website facts, prior activity, and permission state
- marks the receptionist as `Demo Ready`

The telemarketer should not place the call until the demo is ready. That preserves the central promise: the prospect can hear proof immediately when interested.

The implemented operational calling window defaults to 08:00 (inclusive) through
20:00 (exclusive) in each prospect's IANA timezone. It is configurable with
`SALES_CALL_WINDOW_START_LOCAL` and `SALES_CALL_WINDOW_END_LOCAL`; equal values
allow calls all day. Missing timezones are rejected during CSV import by default
and can be accepted only with `SALES_CALL_MISSING_TIMEZONE_POLICY=allow`.
Supplied invalid timezones are always rejected.

The temporary demo remains isolated from real tenant data, consistent with the existing [public demo specification](./SPECS/public-web-demo-receptionist.md).

#### Rolling Warm Demo Queue

The system should prepare demos ahead of the telemarketer rather than waiting for each call.

Recommended starting behavior:

- keep the current prospect and the next 10 prospects in `Demo Ready` state
- browse and build those company demos in the background
- use a small concurrency limit so the system does not hit many websites at once
- replenish the warm queue whenever the telemarketer advances to the next prospect
- show `Preparing`, `Ready`, or `Build failed` beside each upcoming record
- allow a failed website build to be retried or skipped without stopping the calling session

The warm-queue size should be configurable later, but 10 prepared prospects should be enough for the first version.

#### Demo Retention

Store each prepared website-derived demo bundle for 30 days from its successful build.

During that period, the same demo can be reused for a callback or another sales attempt without browsing the website again. After 30 days, mark it stale and rebuild it before the next demonstration.

Only the prepared company data persists for the month. A fresh OpenAI Realtime connection and AI call leg are created for each sales call, placed in standby, and removed when that sales call ends.

### 2. Place the Human Call

The telemarketer sees one prospect at a time and presses **Call**.

The system:

1. creates a sales-call record and asks the browser softphone to place the displayed call
2. receives the operator leg in a parked state on a dedicated Telnyx sales credential
3. verifies the parked state and creates the Telnyx conference around the connected operator
4. simultaneously dials the prospect and the OpenAI SIP endpoint for a private standby AI leg
5. accepts and fully configures the OpenAI Realtime session with the prepared prospect demo
6. opens the server-control WebSocket but does not ask the AI to speak
7. keeps the AI leg parked and isolated from the sales conference
8. joins the answered prospect to the conference
9. displays `AI Preparing` and then `AI Ready`

This should be a manual click-to-call workflow, not a predictive or unattended dialer.

The prospect's ring time becomes useful AI preparation time, so the standby leg should normally be ready before the sales conversation reaches the demonstration. If the call reaches voicemail, is not answered, or ends without a demo, the system tears down the unused standby AI leg.

### 3. Bring In the AI Demo

When it is time to demonstrate the receptionist, the telemarketer presses **Start Demo**.

At that point, setup is already complete. The button performs only the final handoff:

1. joins the existing standby AI leg to the Telnyx sales conference
2. waits for confirmation that the participant joined
3. instructs the already-configured AI to deliver the greeting
4. keeps the telemarketer fully connected and unmuted

The receptionist opens normally:

> “Thanks for calling [business name]. How can I help you?”

During the demo:

- the prospect and AI can speak naturally
- the telemarketer can hear both sides
- the telemarketer remains unmuted and can interject, redirect the demonstration, or resume the sales conversation at any time
- the receptionist uses only the approved temporary demo facts
- it stays within current EveryCall boundaries: answer questions, collect lead details conversationally, and explain the next step
- it does not claim to book appointments, dispatch technicians, submit real leads, or notify staff
- it asks one question at a time and keeps replies to one or two short sentences

References:

- [OpenAI Realtime SIP guide](https://developers.openai.com/api/docs/guides/realtime-sip)
- [OpenAI Realtime architecture overview](https://developers.openai.com/api/docs/guides/realtime)
- [Current demo session builder](../pages/api/_lib/demoRealtimeSession.js)
- [EveryCall product requirements](./PRD.md)
- [Marketing claim guardrails](./marketing-site-brief.md)

### 4. Pause or End the AI Demo

Because the telemarketer never leaves the conversation, the controls should be **Pause AI** and **End Demo**, rather than “Take Back.”

**Pause AI** immediately cancels or suppresses the current AI response while leaving all three participants connected. **End Demo**:

1. stop any current AI response
2. remove the AI participant
3. show that only the human conversation remains

The telemarketer can then ask what the prospect thought and continue the sales conversation.

If the standby AI errors, disconnects, exceeds its time limit, or cannot join promptly, the telemarketer remains live. The system removes the failed AI leg, shows a visible error, and may rebuild standby once while the human conversation continues.

### 5. Complete Signup While Still on the Call

If the prospect wants to proceed, the telemarketer presses **Start Setup**.

The sales console creates a pending signup and prefills safe fields:

- business name
- website
- confirmed contact or login email
- confirmed lead-delivery email
- business category, when known
- marketing attribution tying the signup to the prospect and sales call

The system then emails a short-lived, single-use signup link. SMS can be an optional delivery channel only when that channel is permitted.

The prospect opens the link while still on the call, reviews or edits the prefilled information, creates their own password, accepts the required terms and consents, and submits the existing EveryCall intake.

The telemarketer's screen should show simple progress:

```text
Link sent -> Opened -> Submitted -> Number provisioning -> Account ready
```

This is assisted signup, not account creation on the prospect's behalf. The telemarketer should never ask the prospect to say a password or payment-card number aloud.

After the prospect submits, the existing onboarding process remains responsible for:

- creating the real tenant and login
- starting the real knowledge build
- provisioning the real receptionist number
- establishing the configured trial and billing state
- starting the guided production setup

The temporary demo is not promoted into production. Production is rebuilt through the normal workflow.

Relevant implementation surfaces:

- [Existing intake page](../app/intake/page.jsx)
- [Existing onboarding API](../pages/api/v1/tenants/onboard.js)
- [Account and trial lifecycle](./prd/account-management-billing.md)

### 6. Choose the Outcome and Follow Up

When the call ends, the telemarketer selects or confirms an outcome:

- no answer
- voicemail
- wrong number
- callback requested
- not interested
- do not call
- connected, no demo
- demo completed
- signup link sent
- signup completed

Smartlead receives only the follow-up branch appropriate to the selected outcome. A do-not-call or broader opt-out immediately suppresses all affected channels. Signup stops sales outreach.

The new email sequence should be written only after these outcome branches are finalized.

## Sales Console

The first version needs one clear working screen:

```text
Prospect
  business, contact, number, website, local time
  permission and suppression status
  concise website-derived talking points
  demo status

Call
  Call
  AI Standby: Preparing / Ready
  Start Demo
  Pause AI
  End Demo
  End Call

Conversion
  Start Setup
  Send Signup Link
  Mark Outcome
  Add Note
```

`Start Demo` remains disabled until:

- the demo profile is ready
- the prospect is connected
- the standby AI leg is connected and fully configured

## Provider Responsibilities

| Component | Responsibility |
| --- | --- |
| EveryCall sales service | Separately isolated prospect queue, CSV eligibility, call state, demo preparation, signup invitations, and outcome routing |
| Telnyx | Outbound calls, browser operator leg, parked AI standby leg, conference, participant controls, caller ID, and call webhooks |
| OpenAI Realtime | Preconfigured standby AI session and live receptionist interaction using the prepared prospect demo |
| Smartlead | Outcome-driven email follow-up, replies, bounces, and unsubscribes |
| Existing EveryCall onboarding | Real tenant, login, knowledge build, receptionist number, trial, and guided go-live |

Slybroadcast has no role in this version.

## High-Level Call States

```text
queued
  -> demo_preparing
  -> ready_to_call
  -> connecting_browser

call_started
  -> dialing_prospect -> prospect_connected
  -> preparing_ai_standby -> ai_standby_ready

prospect_connected + ai_standby_ready
  -> Start Demo
  -> ai_live
  -> demo_ended
  -> signup_pending
  -> signup_completed
  -> closed
```

Terminal outcomes such as `no_answer`, `voicemail`, `not_interested`, `do_not_call`, and `failed` branch from the appropriate point.

Every provider command and webhook must be idempotent, signature-verified when supported, and correlated to the internal call session.

## Recommended Build Order

### Phase 1 — Technical Spike

- use a separate sales Telnyx application, webhook route, and test configuration
- create a Telnyx conference
- connect the browser softphone
- start the parked OpenAI SIP leg at the same time Telnyx dials the prospect
- fully configure the Realtime session and hold it silent in standby
- verify the ready leg can join the conference without reconnecting or rebuilding
- verify three-way conversation, telemarketer interjection, pause, end-demo, teardown, and failure behavior
- measure **Call**-to-`AI Ready` and **Start Demo**-to-first-greeting latency
- verify the spike does not route through or alter the production inbound gateway or public-demo sessions

This spike answers the highest-risk technical question before building the sales console.

### Phase 2 — Human Dialer

- CSV import and eligibility filters
- prospect queue and rolling preparation of the next 10 demos
- 30-day demo retention, reuse, expiry, and rebuild
- separate sales records, worker queue, and concurrency limits
- browser-only softphone and calling controls
- call outcomes and follow-up routing

### Phase 3 — In-Call AI Demo

- temporary AI-leg creation
- demo prompt and fact bundle
- `Start Demo`, `Pause AI`, and `End Demo`
- hard duration limit and automatic human recovery
- no production tools or data writes

### Phase 4 — Assisted Signup

- pending-signup record
- secure, expiring prefill link
- safe intake prefill
- live progress events in the sales console
- unchanged submission into the existing onboarding API

### Phase 5 — Follow-Up and Pilot

- rewrite Smartlead branches for actual call outcomes
- run a small, manually reviewed cohort
- measure connect rate, demo acceptance, demo completion, signup-link completion, first real inbound call, and paid conversion

## Decisions and Remaining Choices

1. The operator confirms both the login email and lead-delivery email before sending assisted signup.
2. Pending signup links default to 60 minutes and are configurable.
3. Whether a callback demo-number pool is still desirable after the in-call version works remains open.
4. Whether the trial stays at 30 days or later changes to 14 days remains tabled.
5. The exact Smartlead follow-up copy for each call outcome remains open; no campaign is activated merely by this build.

## Overall Assessment

The recommended system is a Telnyx-controlled, human-first conference using browser audio only. Pressing **Call** prepares the AI standby leg while the prospect's phone rings. The salesperson remains live throughout, and **Start Demo** only joins the already-configured receptionist and starts its greeting.

The conversion flow should end in a secure, prefilled invitation to the existing intake. That allows the telemarketer to guide setup during the call while preserving the prospect's control over credentials and final submission.

The next step is the controlled Phase 1 provider canary. It must validate the remaining external link with real credentials: holding a configured OpenAI Realtime SIP leg in silent standby and then joining it to the Telnyx conference with minimal delay. Pilot traffic should remain disabled until that canary passes.
