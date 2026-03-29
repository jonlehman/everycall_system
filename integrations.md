# EveryCall Integrations Strategy

## Goal

EveryCall should integrate around the thing it already does best:

- answer inbound calls well
- capture structured caller data
- classify whether a call is a valid lead
- hand the result to the business quickly

The integration layer should not be built around minutes, raw transcripts, or deep CRM replacement. It should be built around completed-call outcomes.

## Core Principle

Send every completed call to integrations.

Do not send only leads.

The downstream payload should always include a clear classification block so external systems can decide what to do with the call.

The only canonical outbound `classification.type` values should be:

- `project_inquiry`
- `general_inquiry`
- `existing_customer_support`
- `vendor_or_sales`
- `spam`
- `wrong_number`
- `hangup_or_incomplete`
- `other_non_billable`

Billability should not be encoded into `type`.

Instead, use separate flags:

- `is_valid_lead`
- `is_billable_lead`

This keeps the model cleaner:

- `project_inquiry` can still be non-billable if it is a duplicate
- `project_inquiry` can still be non-valid if required fields are missing
- downstream systems can filter by both operational type and billing state

This is cleaner than maintaining separate delivery paths for leads vs non-leads. It also keeps the system transparent for customers, billing, and audit.

## Why This Is The Right Model

- the integration work is almost the same whether a call is a lead or not
- customers often still want non-lead calls recorded in their systems
- downstream tools can filter on `type` and `is_valid_lead`
- billing can still count only valid billable leads
- support and debugging are easier when every completed call follows the same outbound path

## Current Internal Integrations

These are the integrations EveryCall already depends on or should treat as core platform dependencies:

- `Telnyx` for voice numbers, call ingress, SMS, and delivery callbacks
- `OpenAI Realtime` for voice conversation
- `Stripe` for subscription billing
- `Email provider` for lead and call notifications
- `Worker` for async delivery, retries, and side effects

These should remain internal platform integrations, not customer-facing setup choices.

## Customer-Facing Integration Priorities

### 1. Outbound Webhooks

This should be the first customer-facing integration.

Why:

- it covers the long tail of customer workflows immediately
- it gives advanced customers a direct way to receive call outcomes
- it becomes the foundation for Zapier, Make, and custom middleware

The webhook should be outbound-only at launch.

### 2. Zapier

Zapier should be next because it gives non-technical customers a self-serve path into:

- Google Sheets
- HubSpot
- Gmail
- Slack
- many small-business CRMs and tools

The Zap should start from the same outbound webhook/event contract rather than introducing a separate internal model.

### 3. Make

Make should follow immediately after Zapier or in parallel.

It is especially useful for:

- agencies
- advanced automations
- multi-step routing
- lower-cost operational workflows

### 4. ServiceTitan

This is the highest-priority native CRM/field-service integration for home-service businesses.

Best fit for:

- plumbing
- HVAC
- electrical
- other service businesses already running dispatch and sales workflows in ServiceTitan

### 5. Jobber

Jobber is a strong native target for SMB service businesses and should be near the top of the roadmap.

### 6. HubSpot

HubSpot matters for sales-heavy contractors, remodelers, window installers, and any business using a more formal sales pipeline.

### 7. Housecall Pro

This is worth supporting, but after ServiceTitan and Jobber.

### 8. Calendar Integrations Later

Do not prioritize Google Calendar or Outlook until EveryCall has a real booking and scheduling product.

For now, EveryCall is stronger as:

- a sales receptionist
- a lead-capture system
- a callback and follow-up generator

not as a booking platform.

## Recommended Roadmap

### Phase 1

- outbound webhooks
- worker-owned retry and audit trail
- all completed calls delivered with classification

### Phase 2

- Zapier
- Make
- admin connection management
- per-tenant field mapping

### Phase 3

- ServiceTitan
- Jobber
- HubSpot

### Phase 4

- Housecall Pro
- scheduling/calendar only if product scope expands there intentionally

## Contract Tightening For Build

This document is intended to be implementation-ready, not just directional.

That means the build should not improvise these rules:

- one canonical outbound classification enum
- one defined delivery guarantee model
- one explicit artifact policy
- one versioned payload contract
- one set of outbound webhook headers
- per-connector filters and launch defaults

## Integration Architecture

## Canonical Object

The system should integrate around a canonical `Completed Call` object.

It should always include:

- tenant identity
- call identity
- caller details
- captured structured fields
- summary
- classification
- billing-related lead flags
- optional artifacts

This object is more useful than a pure `Lead` object because:

- not every completed call is a lead
- customers may still want all calls in their CRM or workflow system
- billing can still filter only the billable subset

## Classification Block

Each outbound payload should include a classification block derived from the stored call decision fields.

Recommended fields:

- `type`
- `is_valid_lead`
- `is_billable_lead`
- `decision_reason`
- `duplicate_of_call_sid`

Canonical outbound `type` values:

- `project_inquiry`
- `general_inquiry`
- `existing_customer_support`
- `vendor_or_sales`
- `spam`
- `wrong_number`
- `hangup_or_incomplete`
- `other_non_billable`

These should map cleanly from the existing call fields, but the outbound enum should be normalized even if the stored `lead_outcome_type` is more granular.

Examples:

- `callback_request`, `estimate_request`, `quote_request`, `consultation_request`, `appointment_request`, `project_request`, `service_request`, and similar lead-like outcomes map to `project_inquiry`
- `general_inquiry`, `general_question`, or `question_only` map to `general_inquiry`
- `existing_customer_support` maps to `existing_customer_support`
- `vendor_or_sales`, `sales_call`, or `vendor` map to `vendor_or_sales`
- `hangup`, `hangup_incomplete`, or similar map to `hangup_or_incomplete`

These should map from the existing stored fields:

- `lead_outcome_type`
- `lead_is_valid`
- `lead_is_billable`
- `lead_decision_reason`
- `lead_duplicate_of_call_sid`

Recommended `decision_reason` values should also stay canonical and machine-readable, for example:

- `explicit_project_lead`
- `inferred_project_lead`
- `duplicate_recent_lead`
- `general_inquiry_only`
- `missing_callback_number`
- `no_project_intent_detected`
- `explicit_non_lead_outcome`

## Delivery Model

All outbound integrations should be delivered by the worker, not inline in the gateway or synchronous request path.

Why:

- retries and backoff belong in the async tier
- integrations will fail occasionally
- call completion should not block on CRM or webhook latency
- delivery outcomes should be tracked separately from call storage

Recommended flow:

1. call completes
2. call summary and structured fields are persisted
3. classification is evaluated
4. worker enqueues outbound integration deliveries
5. each configured connector receives the same completed-call payload
6. delivery results are stored with retry state and audit history

## Delivery Guarantees

The delivery model should be explicit:

- external delivery is `at least once` per configured connector
- retries and manual replays are expected behavior
- delivery ordering is not guaranteed across different calls
- delivery ordering is not guaranteed across different connectors
- for a single call + connector pair, deliveries are serialized by attempt number

## When `call.completed` Is Emitted

`call.completed` should be emitted only after:

1. the call has reached a terminal completed state
2. the call row is persisted
3. structured call fields are persisted
4. summary finalization is complete
5. classification is complete

The external event should not be emitted before summary and classification are available.

If summary or classification fails internally:

- the finalization job should retry with backoff
- no external `call.completed` should be emitted until finalization succeeds
- after max retry exhaustion, the job should move to dead-letter / admin review
- replay after operator resolution should then emit the normal `call.completed` event

This keeps the external contract clean and avoids sending partial payloads that downstream systems cannot trust.

## Event Identity And Replay Semantics

Use two identifiers:

- `event_id`: the logical identity of the completed-call event
- `delivery_id`: the identity of a specific outbound attempt

Rules:

- `event_id` stays the same across automatic retries and manual replays
- `delivery_id` changes on every attempt
- `attempt_number` increments on every retry or replay for a given connector delivery

This gives EveryCall:

- stable logical dedupe at the event level
- precise observability at the delivery-attempt level

## Required Platform Pieces

### Connection Records

Each tenant integration connection should store:

- connector type
- auth details or webhook endpoint
- encrypted secret material or OAuth tokens
- enabled flag
- field mapping config
- test-connection status
- reconnect-required status
- created/updated timestamps
- last successful delivery
- last failure

Rules:

- stored secrets must be encrypted at rest
- OAuth connectors must support refresh-token handling
- each connector should support a `test connection` action
- connectors that need operator action should expose a clear reconnect state

### Delivery Ledger

Every outbound delivery attempt should be recorded with:

- tenant
- connector
- call sid
- event id
- delivery id
- event type
- attempt number
- request timestamp
- response status
- response body summary
- success or failure state
- next retry timestamp if applicable

### Idempotency

Each outbound delivery should include a stable event id so connector targets can safely dedupe retries.

### Retry Policy

Use backoff retries for transient failures and dead-letter terminal failures for admin review.

### Signature Verification

For inbound callbacks from external providers, verify signatures whenever supported.

For outbound webhooks from EveryCall, sign payloads with an HMAC secret so customer endpoints can verify authenticity.

## Artifact Policy

The external payload should distinguish between required call data and optional artifacts.

Required:

- `summary`

Optional:

- `transcript`
- `transcript_url`
- `recording_url`

Rules:

- `summary` is always required on `call.completed`
- `transcript` is optional and should be omitted by default
- `transcript_url` is preferred over inline transcript for large payloads or native connectors
- `recording_url` is optional and should not be assumed available
- native CRM connectors should default to `summary` only
- webhooks, Zapier, and Make can optionally receive transcript content when explicitly enabled

This keeps payloads smaller, reduces privacy surface area, and avoids making raw transcript delivery the center of the integration model.

## Outbound Event Model

## Primary Event

The first required outbound event should be:

- `call.completed`

This event should be emitted for every completed call, not just valid leads.

## Optional Future Events

These can be added later if needed:

- `call.classification_updated`
- `call.delivery_failed`
- `lead.override_updated`
- `knowledge.build_published`

But they should be optional. The core contract should work with `call.completed` alone.

## Schema Versioning

Every outbound payload should include:

- `event_type`
- `event_version`

Rules:

- `event_type` is the stable semantic event name, for example `call.completed`
- `event_version` starts at `1`
- any backward-incompatible payload change requires a new `event_version`
- additive optional fields do not require a version bump

Payload discipline rules:

- timestamps must be ISO 8601 UTC strings
- phone numbers must be normalized to E.164 where possible
- required fields must always be present
- nullable fields should be explicit `null`, not omitted arbitrarily

## Webhook Headers

Outbound webhook deliveries should include these headers:

- `X-EveryCall-Event-Id`
- `X-EveryCall-Delivery-Id`
- `X-EveryCall-Event-Type`
- `X-EveryCall-Event-Version`
- `X-EveryCall-Timestamp`
- `X-EveryCall-Delivery-Attempt`
- `X-EveryCall-Signature`

Recommended signature model:

- `X-EveryCall-Timestamp` contains the Unix timestamp used in signing
- `X-EveryCall-Signature` is an HMAC SHA-256 over `${timestamp}.${raw_body}`
- the signing secret is connector-specific

## Recommended Payload

```json
{
  "event_id": "evt_01JXYZ...",
  "delivery_id": "del_01JXYZ...",
  "event_type": "call.completed",
  "event_version": 1,
  "occurred_at": "2026-03-29T21:19:49.000Z",
  "tenant": {
    "tenant_key": "creative_dynamic",
    "name": "Creative Dynamic"
  },
  "call": {
    "call_sid": "v3:2aQpZs9kCtzaQDz83gLA9hdP1T91DRB8GV9XrcL01MUbvgB-12R9nA",
    "from_number": "+12143581234",
    "to_number": "+14254375379",
    "status": "completed",
    "received_at": "2026-03-29T21:17:26.000Z",
    "completed_at": "2026-03-29T21:19:49.000Z",
    "summary": "Custom app troubleshooting: Fix error messages in lead collection and distribution application."
  },
  "caller": {
    "first_name": "John",
    "last_name": null,
    "callback_number": "+12143581234",
    "service_request": "Troubleshooting custom app giving error messages on lead collection and distribution",
    "address_line1": null,
    "address_line2": null,
    "city": null,
    "state": null,
    "postal_code": null
  },
  "classification": {
    "type": "project_inquiry",
    "is_valid_lead": true,
    "is_billable_lead": true,
    "decision_reason": "explicit_project_lead",
    "duplicate_of_call_sid": null
  },
  "artifacts": {
    "transcript": null,
    "transcript_url": null,
    "recording_url": null,
    "app_url": "https://app.everycall.io/client/calls"
  }
}
```

## Field Mapping Strategy

Do not make each native integration invent its own call model.

Instead:

- map the canonical completed-call object into each destination
- let tenants optionally choose which fields flow into which destination fields
- keep defaults opinionated and simple

Examples:

- ServiceTitan:
  - create or update contact
  - create opportunity or lead note
  - store EveryCall classification and summary
- Jobber:
  - create client or request
  - attach summary and callback details
- HubSpot:
  - create contact
  - create note or activity
  - optionally create deal if `is_valid_lead = true`
- Webhooks:
  - send full payload
- Zapier / Make:
  - expose all top-level fields for mapping

## Per-Connector Filters

The internal system should treat every completed call as integration-eligible.

Connector deliveries should still support filtering so native business systems do not get polluted by junk traffic.

Each connection should support at least:

- `include_types`
- `include_non_billable`
- `include_duplicates`
- `include_transcript`

Recommended filter behavior:

- `include_types` filters on canonical `classification.type`
- `include_non_billable = false` suppresses calls where `is_billable_lead = false`
- `include_duplicates = false` suppresses calls with `duplicate_of_call_sid != null`
- `include_transcript = true` enables transcript or transcript URL delivery when available

## Launch Defaults By Connector

### Outbound Webhooks

- `include_types`: all
- `include_non_billable`: true
- `include_duplicates`: true
- `include_transcript`: false

These are for advanced customers and middleware, so the default should be broad and transparent.

### Zapier / Make

- `include_types`: all
- `include_non_billable`: true
- `include_duplicates`: true
- `include_transcript`: false

These platforms are often used as routing layers, so broad delivery is still the right default.

### Native CRM Connectors

For `ServiceTitan`, `Jobber`, and `HubSpot`, launch defaults should be more conservative:

- `include_types`: `project_inquiry`
- `include_non_billable`: false
- `include_duplicates`: false
- `include_transcript`: false

This keeps CRMs cleaner by default while still allowing customers to broaden delivery later.

## What Not To Build First

Do not start with:

- deep bidirectional CRM sync
- importing large CRM datasets back into EveryCall
- dispatch-state synchronization
- invoice, payment, or quote integrations
- calendar booking before scheduling is a real product feature
- connector-specific business logic embedded in the gateway

That work is expensive, fragile, and not necessary to prove the product.

## Admin and Client UX Requirements

To support integrations cleanly, the product should eventually expose:

- connection setup per tenant
- connector health
- recent successful and failed deliveries
- event replay
- per-call delivery status
- clear call classification labels in the Calls UI

For launch, the most important pieces are:

- connection enable/disable
- last success / last failure
- retry visibility

## Billing Relationship

Integrations should send every call, but billing should still count only valid billable leads.

That separation is important:

- integrations are operational
- billing is financial

A call can be:

- delivered to a CRM
- visible to the customer
- non-billable

That is normal and should be expected.

## Recommended Launch Decision

If only one integration surface ships first, it should be:

- signed outbound webhooks for `call.completed`

And the rule should be:

- send every completed call
- always include classification fields
- let the receiver decide what to do with non-lead calls

## Bottom Line

EveryCall should integrate around `completed calls`, not just `leads`.

The first integration contract should be:

- one outbound `call.completed` event
- delivered for every completed call
- containing structured caller data, summary, and classification
- optionally containing transcript artifacts when enabled

That gives the product:

- simpler architecture
- cleaner auditability
- better customer trust
- easier CRM and automation integrations
- enough flexibility to support lead billing without hiding non-lead calls
