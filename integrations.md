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

The downstream payload should always include a clear classification block so external systems can decide what to do with the call:

- `valid lead`
- `non-billable inquiry`
- `existing customer support`
- `spam`
- `wrong number`
- `duplicate lead`

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

## Integration Architecture

## Canonical Object

The system should integrate around a canonical `Completed Call` object.

It should always include:

- tenant identity
- call identity
- caller details
- captured structured fields
- summary
- transcript
- classification
- billing-related lead flags

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

Recommended `type` values:

- `valid_lead`
- `general_inquiry`
- `existing_customer_support`
- `vendor_or_sales`
- `spam`
- `wrong_number`
- `hangup_or_incomplete`
- `other`

These should map cleanly from the existing call fields:

- `lead_outcome_type`
- `lead_is_valid`
- `lead_is_billable`
- `lead_decision_reason`
- `lead_duplicate_of_call_sid`

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

## Required Platform Pieces

### Connection Records

Each tenant integration connection should store:

- connector type
- auth details or webhook endpoint
- enabled flag
- field mapping config
- created/updated timestamps
- last successful delivery
- last failure

### Delivery Ledger

Every outbound delivery attempt should be recorded with:

- tenant
- connector
- call sid
- event id
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

## Recommended Payload

```json
{
  "event_id": "evt_01JXYZ...",
  "event_type": "call.completed",
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
    "type": "valid_lead",
    "is_valid_lead": true,
    "is_billable_lead": true,
    "decision_reason": "explicit_project_lead",
    "duplicate_of_call_sid": null
  },
  "artifacts": {
    "transcript": "Assistant: ...",
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
- containing structured caller data, summary, transcript, and classification

That gives the product:

- simpler architecture
- cleaner auditability
- better customer trust
- easier CRM and automation integrations
- enough flexibility to support lead billing without hiding non-lead calls
