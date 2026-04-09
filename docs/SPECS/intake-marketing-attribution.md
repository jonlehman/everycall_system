# SPEC: Intake Marketing Attribution & Query Params

## Status
- Proposed
- Owner: Platform
- Last Updated: 2026-04-09

## Related Docs
- [SPEC: Intake Onboarding V2](/home/jonle/everycall/docs/SPECS/intake-onboarding-v2.md)
- [PRD: Tenant Intake & Onboarding](/home/jonle/everycall/docs/prd/intake-process.md)
- [EveryCall Website Marketing Brief](/home/jonle/everycall/docs/marketing-site-brief.md)

## Summary
The marketing site should be able to append optional attribution and CTA context to `/intake` links. The intake flow should accept those params, preserve them during onboarding, and persist them as onboarding metadata without affecting the success of tenant creation.

This is an attribution and context feature only. It is not a billing-selection or pricing-enforcement feature.

## Current Codebase Reality
- [app/intake/page.jsx](/home/jonle/everycall/app/intake/page.jsx) is a client component and currently does not parse or preserve any intake query params.
- [pages/api/v1/tenants/onboard.js](/home/jonle/everycall/pages/api/v1/tenants/onboard.js) currently accepts only onboarding fields and does not accept marketing attribution.
- [onboarding_intake](/home/jonle/everycall/pages/api/_lib/db.js#L448) exists in schema but is not used by the live onboarding flow.
- [tenant_bootstrap_profiles](/home/jonle/everycall/pages/api/_lib/db.js#L469) is already written during onboarding through [tenantBootstrapProfiles.js](/home/jonle/everycall/pages/api/_lib/tenantBootstrapProfiles.js) and is the correct persistence point for this feature.
- Intake v2 explicitly keeps billing workflows out of scope in [intake-onboarding-v2.md](/home/jonle/everycall/docs/SPECS/intake-onboarding-v2.md).

## Goals
- Capture optional marketing-site query params on `/intake`.
- Preserve them through step navigation, refresh, and final onboarding submit.
- Persist them on the created tenant as structured onboarding metadata.
- Accept unknown future params safely without breaking intake.

## Non-Goals
- Billing plan selection or billing setup changes during intake.
- Multi-touch attribution, first-touch attribution, or campaign reporting architecture.
- Retrofitting or reviving `onboarding_intake` as part of this change.
- Requiring the marketing site to always provide params.

## Supported Query Params

### Known Params
- `ref_page`
- `ref_cta`
- `plan_interest`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `gclid`
- `fbclid`
- `msclkid`

### Unknown Future Params
Unknown params should not fail intake. They may be stored in a bounded `extraQueryParams` object if they pass safety rules.

## Behavior Rules
- All params are optional.
- Intake must work normally when no params are present.
- Missing, blank, malformed, or unknown params must never block onboarding.
- `plan_interest` is informational metadata in v1.
- `plan_interest` does not alter billing state, plan code, Stripe setup, or tenant pricing in v1.
- If a future intake UI introduces a real plan chooser, `plan_interest` may become a preselection hint then. That is not part of this change.
- Do not hardcode current `ref_page` or `ref_cta` values as strict enums.

## Normalized Payload Shape
The intake page should submit a nested object named `marketingAttribution`.

```json
{
  "marketingAttribution": {
    "refPage": "pricing.html",
    "refCta": "pricing_growth",
    "planInterest": "growth",
    "utm": {
      "source": "google",
      "medium": "cpc",
      "campaign": "spring_test",
      "content": null,
      "term": null
    },
    "clickIds": {
      "gclid": "abc123",
      "fbclid": null,
      "msclkid": null
    },
    "extraQueryParams": {}
  }
}
```

### Normalization Rules
- Parse from the current `/intake` URL query string.
- Treat keys case-insensitively for recognition.
- Preserve only the first value for repeated params.
- Trim whitespace from all string values.
- Convert empty strings to `null` or omit them.
- Do not reject unknown string values for `refPage`, `refCta`, or `planInterest`.
- Keep `planInterest` as the raw string provided after normalization.

## Frontend Implementation

### Files
- [app/intake/page.jsx](/home/jonle/everycall/app/intake/page.jsx)

### Required Behavior
1. Parse query params on first load of the intake page.
2. Build a normalized `marketingAttribution` object.
3. Store it in React state for the current intake session.
4. Mirror it to `sessionStorage` so refreshes do not lose it.
5. On submit, include it in the existing `POST /api/v1/tenants/onboard` request body.
6. Clear the stored client-side attribution after successful onboarding response.

### Persistence During the Multi-Step Flow
The current intake is a client-side multi-step flow in one page, so preserving attribution in:
- component state
- plus `sessionStorage`

is sufficient for v1.

### Recommended Storage Key
- `everycall:intake:marketing-attribution`

### No New UI Requirement
There does not need to be any visible attribution UI in intake v1.

### `plan_interest` Handling in the UI
- Capture and preserve it.
- Do not show, enforce, or bind it to billing configuration.
- Do not add a fake or hidden plan selector just to satisfy this field.

## API Implementation

### Files
- [pages/api/v1/tenants/onboard.js](/home/jonle/everycall/pages/api/v1/tenants/onboard.js)

### Request Contract Change
Extend the onboarding payload parser to accept optional:

```json
{
  "marketingAttribution": {
    "...": "..."
  }
}
```

### Validation Rules
- `marketingAttribution` is optional.
- If present, it must be normalized into safe strings and objects.
- Invalid shapes should be ignored or reduced to an empty object, not rejected with a fatal onboarding error.
- Core onboarding fields remain the only required inputs.

### Recommended Server Normalization
The server should defensively re-normalize `marketingAttribution` rather than trusting the client shape.

## Persistence Model

### Recommended Table
- [tenant_bootstrap_profiles](/home/jonle/everycall/pages/api/_lib/db.js#L469)

### Why
- The live onboarding flow already persists this table.
- It is a better fit than `tenants` for bootstrapping metadata.
- It avoids reviving stale `onboarding_intake` behavior.
- It keeps attribution attached to the onboarding origin rather than billing or runtime behavior.

### Schema Change
Add:

```sql
ALTER TABLE tenant_bootstrap_profiles
ADD COLUMN IF NOT EXISTS marketing_attribution_json JSONB NOT NULL DEFAULT '{}'::jsonb;
```

### Helper Changes
Extend [tenantBootstrapProfiles.js](/home/jonle/everycall/pages/api/_lib/tenantBootstrapProfiles.js) to:
- normalize `marketing_attribution_json`
- return it from `loadTenantBootstrapProfile`
- upsert it from `saveTenantBootstrapProfile`

### Suggested Stored Shape
```json
{
  "refPage": "pricing.html",
  "refCta": "pricing_growth",
  "planInterest": "growth",
  "utm": {
    "source": "google",
    "medium": "cpc",
    "campaign": "spring_test",
    "content": null,
    "term": null
  },
  "clickIds": {
    "gclid": "abc123",
    "fbclid": null,
    "msclkid": null
  },
  "extraQueryParams": {
    "foo": "bar"
  }
}
```

## Safety Rules For Unknown Future Params
Unknown params may be stored only in `extraQueryParams`.

### Suggested Limits
- maximum unknown keys stored: `20`
- maximum key length: `64`
- maximum value length per key: `512`

### Suggested Denylist For Unknown Keys
Do not persist unknown keys that look like secrets or auth flows, such as:
- `token`
- `session`
- `password`
- `secret`
- `auth`
- `code`

Known keys listed in this spec are exempt from the unknown-key denylist because they are handled explicitly.

## What This Change Should Not Do
- It should not change `tenants.plan_code`.
- It should not call billing APIs.
- It should not create a Stripe checkout session.
- It should not alter `tenant_billing_accounts`.
- It should not make onboarding fail when the marketing site sends unexpected params.

## Implementation Touchpoints

### 1. Intake UI
- [app/intake/page.jsx](/home/jonle/everycall/app/intake/page.jsx)
- Add query-param parsing, normalization, `sessionStorage` persistence, and request-body inclusion.

### 2. Onboarding API
- [pages/api/v1/tenants/onboard.js](/home/jonle/everycall/pages/api/v1/tenants/onboard.js)
- Accept and re-normalize `marketingAttribution`.
- Pass it to bootstrap-profile persistence.

### 3. Bootstrap Profile Persistence
- [pages/api/_lib/tenantBootstrapProfiles.js](/home/jonle/everycall/pages/api/_lib/tenantBootstrapProfiles.js)
- Extend normalization, load, and save helpers.

### 4. Schema Bootstrap
- [pages/api/_lib/db.js](/home/jonle/everycall/pages/api/_lib/db.js)
- Add `marketing_attribution_json` to `tenant_bootstrap_profiles`.

## Acceptance Criteria
1. Visiting `/intake` with no query params behaves exactly as it does now.
2. Visiting `/intake?ref_page=pricing.html&ref_cta=pricing_growth&plan_interest=growth` does not change visible intake behavior, but the normalized attribution is retained through submit.
3. Refreshing the intake page before submit does not lose captured attribution.
4. On successful onboarding, attribution is persisted in `tenant_bootstrap_profiles.marketing_attribution_json`.
5. Unknown future params do not break onboarding.
6. Unknown future params can be stored safely in `extraQueryParams` within configured limits.
7. `plan_interest` does not alter billing or plan state in v1.
8. Missing or malformed attribution never blocks tenant creation.

## Recommended Example

### Example Intake URL
```text
/intake?ref_page=pricing.html&ref_cta=pricing_growth&plan_interest=growth&utm_source=google&utm_medium=cpc&utm_campaign=spring_test&gclid=abc123
```

### Expected Result
- The intake form renders normally.
- Onboarding submit includes `marketingAttribution`.
- Tenant is created normally.
- Bootstrap profile stores the normalized attribution object.
- No billing state is changed from the presence of `plan_interest`.

## Open Follow-Up, Not In Scope For This Spec
- Add attribution visibility to admin tenant detail pages.
- Add reporting or export for marketing attribution.
- Use `plan_interest` to preselect a real plan chooser if intake later gains one.
- Decide whether `onboarding_intake` should be retired or repurposed separately.
