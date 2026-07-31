# Outbound Sales In-Call AI Demo

## Purpose

Provide an admin-only, human-led browser dialer that can bring a prepared EveryCall receptionist into an active sales call without muting the operator or changing production inbound and public-demo behavior.

## Invariants

- A human explicitly starts every outbound call.
- The operator remains connected and unmuted for the whole call.
- The AI is an incoming receptionist demonstration, never an outbound sales bot.
- `Start Demo` may run only after the prospect is connected and the AI standby is fully ready.
- Sales records, demo bundles, credentials, webhooks, and provider calls remain isolated from production tenant calls and public-demo records.
- Website-derived text is reference data, not trusted instructions. The demo has no tools and cannot book, dispatch, notify staff, submit a lead, or take payment data.
- Every provider webhook and command is correlated and idempotent. Supported webhook signatures are mandatory.

## Preparation

CSV import requires a business name, phone number, explicit permission value, and
an IANA timezone while the default missing-timezone policy is `block`. A missing
timezone is accepted only when `SALES_CALL_MISSING_TIMEZONE_POLICY=allow`.
Email permission is stored separately. Suppressed, do-not-call, or ineligible
prospects cannot enter the active calling queue.

The warm queue contains the current prospect plus the next 10 eligible records. A background job uses the existing safe website-demo extraction helpers to create an isolated sales demo bundle. Successful bundles expire after 30 days; failures remain visible and require retry or skip.

## Call Lifecycle

1. The console creates a `sales_call_sessions` row and asks the Telnyx browser SDK to call the displayed prospect number.
2. A dedicated Telnyx Credential Connection and WebSocket credential park that operator leg rather than dialing the prospect itself.
3. The sales gateway verifies the signature, sales connection, parked state, current prospect eligibility, and ready demo.
4. The gateway creates a conference anchored to the operator, then concurrently dials the prospect and a private xAI SIP standby.
5. The xAI webhook is signature-verified and nonce-correlated to the call. The gateway accepts the Realtime call with the prepared prompt and opens its server monitor while automatic responses remain disabled.
6. `AI Ready` requires the accepted xAI session and the Telnyx AI leg to be connected. The AI remains outside the human conference.
7. `Start Demo` joins that existing leg, confirms the participant, enables responses, and says exactly: `Thanks for calling [business name]. How can I help you?`
8. `Pause AI` cancels the current response and clears provider output audio. `End Demo` removes and hangs up only the AI leg. `End Call` tears down all remaining provider resources.

The gateway fails closed when the operator leg is not parked or belongs to the wrong sales connection. Provider errors are persisted and surfaced without removing the human operator from an already active conversation.

## Assisted Signup

`Start Setup` creates an invitation with safe prefill data and emails a short-lived link. Raw tokens are never returned to the sales-console browser or stored in the database; only a one-way token hash is persisted. Opening the link is refresh-safe. Successful existing onboarding consumes it once, creates the tenant through the normal transaction, and updates sales progress.

The prospect reviews the prefill, creates their own password, accepts the normal terms, and submits the existing intake. The sales console polls progress from link sent through account ready. Production knowledge and number provisioning remain the existing onboarding system's responsibility.

## Follow-Up

Recording an outcome advances the queue and creates a durable follow-up job. Smartlead receives only configured, permissioned, unsuppressed email branches. Replies, bounces, and unsubscribes are deduplicated and update email state without silently changing phone eligibility. `do_not_call` and completed signup are terminal sales outcomes.

## Operations

- Vercel hosts the console, admin APIs, maintenance cron, and signup handoff.
- The maintenance cron is inert unless `SALES_OUTBOUND_ENABLED=true`, so code can deploy before the migration and provider canary without starting background work.
- Render hosts one isolated `everycall-sales-call-gateway` instance.
- Telnyx uses a dedicated sales Call Control Application plus a separate parked-operator Credential Connection; Telnyx and xAI use only dedicated `SALES_*` credentials.
- Live provider readiness requires a controlled canary after secrets, webhook URLs, and the parked WebSocket credential are configured.
- Trial duration is outside this feature and continues to use the existing product setting.
