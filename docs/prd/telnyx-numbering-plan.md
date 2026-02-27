# PRD: Telnyx Numbering Plan (Shared SMS + Per‑Tenant Voice)

## Overview
Every tenant gets a **local voice number** for inbound calls. The system uses **one shared SMS number** to send alerts to clients (not their customers). SMS does not impersonate the tenant and does not need to match the tenant voice number.

## Goals
- Provision one **local voice DID per tenant** automatically.
- Use a **single shared SMS number** for system → client alerts.
- Keep onboarding fully automatic (no manual number selection).
- If no numbers exist in requested area code, auto-select any available local number.

## Non-Goals
- No per-tenant SMS numbers.
- No toll-free numbers.
- No SMS to end customers from tenant-branded numbers.

## Functional Requirements
- **Voice (per tenant)**:
  - Search Telnyx available local numbers by area code.
  - If none available, fall back to any available local number.
  - Purchase number and attach to voice application / SIP connection.
  - Persist number and Telnyx IDs on tenant.
- **SMS (shared)**:
  - Configure one shared SMS number at system level.
  - Use it only for system → client alerts (appointments, summaries).
  - Store number + Telnyx IDs in system config.

## Data Model Additions
- `tenants.telnyx_voice_number` (E.164)
- `tenants.telnyx_voice_number_id`
- `tenants.telnyx_voice_order_id`
- `tenants.telnyx_voice_status` (available / ordered / active / failed)
- `system_config.telnyx_sms_number`
- `system_config.telnyx_sms_number_id`
- `system_config.telnyx_sms_messaging_profile_id`

## Onboarding Flow (Voice Number)
1. Read tenant area code from address/phone.
2. Telnyx `available_phone_numbers`:
   - `country_code=US`, `number_type=local`, `features=[voice]`, `area_code`.
3. If none found, repeat search without area_code.
4. Order number via `number_orders`.
5. Associate with voice connection (SIP or application).
6. Persist tenant fields + mark status active.

## SMS Flow (Shared Number)
1. Pre‑provision a single SMS number in Telnyx.
2. Attach it to a messaging profile with inbound webhooks:
   - Primary: `/api/v1/telnyx/webhooks/sms/inbound`
   - Failover: `/api/v1/telnyx/webhooks/sms/failover`
3. Store the number + profile id in `system_config`.
4. Use it for all client alert messages.

## Compliance Notes
- Shared SMS number only messages **clients** (B2B).
- 10DLC registration will apply to the shared number if it is a local US number.
- No use of tenant-branded SMS from their voice DIDs.

## Open Questions
- What exact alerts should be sent via SMS?
- Should tenants opt‑in for SMS alerts (per user)?
