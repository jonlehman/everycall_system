# SPEC: Public Web Demo API Contract

## Status
- Proposed for initial implementation
- Last Updated: 2026-04-11

## Related Docs
- [Public Web Demo Receptionist](/home/jonle/everycall/docs/SPECS/public-web-demo-receptionist.md)
- [Public Web Demo Data Model](/home/jonle/everycall/docs/SPECS/public-web-demo-data-model.md)

## Purpose
Define the concrete API contract for the public EveryCall website demo subsystem.

This API is intentionally separate from tenant onboarding, tenant knowledge builds, billing, and live call handling.

## Base Path
- `/api/v1/demo`

## Common Response Rules
- All responses are JSON.
- `ok: false` is used for request or server errors.
- `status` describes the demo session lifecycle state when a session exists.

## Session States
- `created`
- `scraping`
- `summarizing`
- `ready`
- `failed`
- `expired`

## `POST /api/v1/demo/sessions`
Creates a demo session and runs the first lightweight scrape/build inline.

### Request

```json
{
  "websiteUrl": "https://example.com"
}
```

### Validation Rules
- `websiteUrl` is required.
- URL must point to a public `https` target.
- Bare domains may be normalized to `https://...`.
- Private IPs, localhost, and internal hosts must be rejected.

### Success Response

```json
{
  "ok": true,
  "demoSessionId": "demo_123",
  "status": "ready",
  "reused": false,
  "preview": {
    "businessName": "Example Co.",
    "websiteUrl": "https://example.com/",
    "summary": "Example Co. provides exterior cleaning services in the Seattle area.",
    "topServices": [
      "Window cleaning",
      "Gutter cleaning"
    ],
    "serviceArea": "Seattle area",
    "hours": "Mon-Fri 8 AM to 5 PM",
    "contactFacts": [
      "Free estimates available"
    ],
    "sourcePages": [
      {
        "url": "https://example.com/",
        "title": "Home"
      }
    ]
  }
}
```

### Failure Response For Invalid Input

```json
{
  "ok": false,
  "error": "website_url_invalid",
  "message": "A public website URL is required."
}
```

### Success Response When Demo Build Fails

```json
{
  "ok": true,
  "demoSessionId": "demo_123",
  "status": "failed",
  "reused": false,
  "failure": {
    "code": "website_fetch_failed",
    "message": "Website fetch failed after 3 attempts: HTTP 403 (your site is either down or is preventing EveryCall from crawling it)"
  }
}
```

### Notes
- The first implementation runs the scrape/build inline during this request.
- Later versions may return early with `scraping` and finish asynchronously.
- Reuse of a recent ready session for the same normalized website is allowed.

## `GET /api/v1/demo/sessions/:demoSessionId`
Returns the current state of an existing public demo session.

### Success Response When Ready

```json
{
  "ok": true,
  "demoSessionId": "demo_123",
  "status": "ready",
  "preview": {
    "businessName": "Example Co.",
    "websiteUrl": "https://example.com/",
    "summary": "Example Co. provides exterior cleaning services in the Seattle area."
  }
}
```

### Success Response When Failed

```json
{
  "ok": true,
  "demoSessionId": "demo_123",
  "status": "failed",
  "failure": {
    "code": "website_fetch_failed",
    "message": "Website fetch failed after 3 attempts: HTTP 403 (your site is either down or is preventing EveryCall from crawling it)"
  }
}
```

### Not Found Response

```json
{
  "ok": false,
  "error": "demo_session_not_found",
  "message": "Demo session not found."
}
```

## Reserved For Next Slice

### `POST /api/v1/demo/realtime/token`
- Creates the browser Realtime session handshake for a ready demo session.
- Must never expose the normal OpenAI secret to the browser.

### `POST /api/v1/demo/events`
- Optional analytics/event intake for the public demo frontend.

## Rate Limiting
Recommended initial scopes:
- per-IP on `POST /sessions`
- per-domain on `POST /sessions`
- lighter per-IP limit on `GET /sessions/:id`

## Security Rules
- same-origin crawl only after the first successful website fetch
- hard byte limits on HTML reads
- hard per-page and total crawl deadlines
- no downloadable files in v1
- no writes to tenant tables
