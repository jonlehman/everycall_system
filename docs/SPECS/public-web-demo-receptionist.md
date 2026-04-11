# SPEC: Public Website Live Demo Receptionist

## Status
- Proposed
- Owner: Platform / Marketing
- Last Updated: 2026-04-11

## Related Docs
- [PRD](/home/jonle/everycall/docs/PRD.md)
- [System Overview](/home/jonle/everycall/docs/architecture/001-system-overview.md)
- [Decisions](/home/jonle/everycall/docs/DECISIONS.md)
- [Realtime Audio](/home/jonle/everycall/docs/SPECS/realtime-audio.md)
- [Realtime Gateway Prompt Contract](/home/jonle/everycall/docs/SPECS/realtime-gateway-prompt-contract.md)
- [Knowledge System V1](/home/jonle/everycall/docs/SPECS/knowledge-system-v1.md)
- [Voice Sample API](/home/jonle/everycall/pages/api/v1/voice/sample.js)
- OpenAI Realtime WebRTC guide: https://developers.openai.com/api/docs/guides/realtime-webrtc

## Summary
EveryCall should offer a public live demo on `everycall.io` where a visitor:

1. enters a business website URL
2. waits for a very small, fast website scrape
3. talks to a demo receptionist directly in the browser
4. hears a receptionist grounded in a lightweight summary of that website

This demo must be fully separate from the live tenant system.

It must not:
- create tenants
- write tenant knowledge builds
- provision phone numbers
- write lead destinations
- touch billing
- touch the live call gateway
- mutate any existing customer configuration

The browser should act as the caller. No phone number is required.

## Product Goal
Give a visitor a fast, impressive, low-friction answer to:

`What would EveryCall sound like for my business?`

The demo is a sales tool, not a production workflow.

## Non-Goals
- Converting the public demo into a real tenant automatically
- Reusing the full tenant onboarding/build pipeline
- High-depth knowledge compilation
- Real lead capture, CRM writes, or notifications
- Realtime telephony through Telnyx
- Sharing demo content with the production tenant runtime

## Hard Separation Rules

### Required Isolation
The public demo must be isolated from the live tenant system at all of these layers:

- separate API namespace
- separate data model
- separate prompt/runtime bundle
- separate rate limits
- separate session lifecycle
- separate analytics/events
- no writes to tenant tables

### Must Not Be Used
The public demo must not call these production flows directly:

- [onboard.js](/home/jonle/everycall/pages/api/v1/tenants/onboard.js)
- [knowledge builds API](/home/jonle/everycall/pages/api/v1/knowledge/builds/index.js)
- `createKnowledgeBuild` / tenant build persistence in [knowledgeReceptionistBuilds.js](/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistBuilds.js)
- live billing APIs
- Telnyx provisioning / call-gateway paths

### Acceptable Reuse
The demo may reuse or extract safe read-only logic, such as:

- URL normalization
- website fetch hardening patterns
- OpenAI Realtime session configuration defaults
- content extraction helpers where they do not require tenant/build context

Any reuse should happen through demo-specific wrappers or extracted pure helpers, not by calling tenant workflows.

## Recommended Architecture

### Frontend
- public page on `everycall.io`
- browser-based voice conversation using OpenAI Realtime over WebRTC
- microphone input from the visitor
- remote audio played in the page
- data channel used for live transcript and state updates

### Backend
Use a demo-only backend surface, preferably in this app repo under:

- `pages/api/v1/demo/...`

If marketing remains on a separate website codebase, that frontend can call these endpoints on `app.everycall.io` or another demo API origin.

### Data Plane
Use a separate demo store:

- best: separate database
- acceptable: separate schema / tables with zero tenant overlap

Do not store demo records in tenant tables.

## User Flow

### Step 1: Enter Website
Page asks for:
- business website URL

Optional helper text:
- `We’ll do a fast scan of a few pages and build a live demo receptionist in your browser.`

### Step 2: Build Demo
Backend:
- validates URL
- creates demo session
- performs small scrape
- extracts a compact demo knowledge bundle

Frontend shows:
- `Scanning website`
- `Building demo receptionist`
- `Ready to talk`

### Step 3: Live Browser Demo
Visitor clicks:
- `Start Talking`

Browser:
- requests mic permission
- requests ephemeral Realtime session token from backend
- establishes WebRTC session to OpenAI
- streams live conversation in page

Page shows:
- listening / thinking / speaking status
- transcript stream
- end conversation button

### Step 4: Convert
After the demo:
- CTA to `Start Free Trial`
- CTA to `Schedule Demo / Onboarding Session`

Optional:
- pass only the website URL into intake as a convenience prefill
- do not persist any demo state into the live system unless the user explicitly starts onboarding

## Demo Session Lifecycle

### States
- `created`
- `scraping`
- `summarizing`
- `ready`
- `failed`
- `expired`

### TTL
- session record TTL: 1 to 24 hours
- frontend-visible readiness cache: short-lived
- transcripts/events: short-lived or not stored at all

### Expiration
Expired demo sessions should be deleted by cleanup job or lazy cleanup.

## Small-Scrape Design

### Why A Separate Scrape Path
The current knowledge build crawler is too heavy for a public demo:

- default `80` pages
- default `12` files
- `90s` crawl deadline

That is appropriate for tenant setup, not a marketing demo.

### Demo Crawl Limits
Recommended demo defaults:

- max HTML pages: `5`
- max downloadable files: `0`
- max crawl depth: `1`
- same-origin only
- fetch timeout per page: `4s`
- total crawl deadline: `15s`
- root fetch retries: `2`
- skip PDFs and files entirely for v1

### Page Selection Heuristics
Always include:
- home page

Then prefer pages containing:
- `/about`
- `/services`
- `/service`
- `/contact`
- `/locations`
- `/faq`
- `/hours`

Ignore:
- blog archives
- policy pages
- cart / checkout
- login / portal pages
- search result pages
- obvious app/admin pages

### Extraction Goal
Produce a compact demo bundle, not a full knowledge system.

Example target output:

```json
{
  "businessName": "Lake Washington Windows",
  "websiteUrl": "https://example.com",
  "summary": "Window cleaning and exterior service company serving the Seattle area.",
  "topServices": [
    "Window cleaning",
    "Gutter cleaning",
    "Pressure washing"
  ],
  "serviceArea": "Seattle metro area",
  "hours": "Mon-Fri 8 AM to 5 PM",
  "contactFacts": [
    "Free estimates available",
    "Residential and commercial service"
  ],
  "sourcePages": [
    { "url": "https://example.com/", "title": "Home" },
    { "url": "https://example.com/services", "title": "Services" }
  ]
}
```

### Extraction Method
Recommended approach:

1. deterministic HTML extraction
2. compact structured summarization with a small text model
3. strict JSON schema for the final demo bundle

This is faster and simpler than running the full layered knowledge-build compiler.

## Realtime Demo Runtime

### Transport
Use browser-to-OpenAI WebRTC for the live demo.

Why:
- no phone number needed
- low latency
- browser mic/speaker support
- no need to relay audio through your backend

### Backend Responsibility
Backend should:
- validate demo session is `ready`
- create a Realtime session token / ephemeral auth flow
- build the demo instructions
- return what the browser needs to start the session

### Frontend Responsibility
Frontend should:
- request microphone access
- create `RTCPeerConnection`
- add local audio track
- open data channel
- connect using backend-provided token/session handshake
- render transcript and state changes

### Session Limits
Recommended:
- max demo duration: `3 minutes`
- one active realtime session per demo session
- hard timeout at the browser and server level

## Demo Prompt Design

### Separate Prompt
Use a dedicated demo-only system prompt.

Do not reuse the live tenant prompt contract verbatim.

### Demo Prompt Requirements
The demo assistant should:
- act like an EveryCall receptionist
- answer based only on the compact scraped demo bundle
- be short, friendly, and natural
- say when information is not available
- avoid pretending to have full production knowledge
- avoid real operational promises like dispatching, booking, or submitting jobs

### Demo Prompt Requirements Example
- `You are a demo receptionist generated from a short website scan.`
- `Only answer using the provided demo business summary and facts.`
- `If the website summary does not support an answer, say this is only a brief demo and the full system would be trained more deeply during setup.`
- `Do not claim that you booked an appointment, sent a lead, or contacted staff.`
- `Do not collect or store sensitive information.`

### Tooling
Recommended for v1:
- no tools

Everything needed for the demo should be in the demo bundle loaded into the Realtime session.

Optional later:
- simple `end_demo` or `show_cta` event via data channel

## Demo API Surface

### `POST /api/v1/demo/sessions`
Creates a demo session and starts scrape/summarization.

Request:

```json
{
  "websiteUrl": "https://example.com"
}
```

Response:

```json
{
  "ok": true,
  "demoSessionId": "demo_123",
  "status": "scraping"
}
```

### `GET /api/v1/demo/sessions/:demoSessionId`
Returns status and, when ready, the safe demo summary.

Response:

```json
{
  "ok": true,
  "demoSessionId": "demo_123",
  "status": "ready",
  "preview": {
    "businessName": "Example Co.",
    "summary": "..."
  }
}
```

### `POST /api/v1/demo/realtime/token`
Creates the browser Realtime session handshake for a ready demo session.

Request:

```json
{
  "demoSessionId": "demo_123"
}
```

Response:

```json
{
  "ok": true,
  "demoSessionId": "demo_123",
  "session": {
    "clientSecret": "..."
  }
}
```

Implementation details may vary depending on the final Realtime auth flow, but the public frontend should never receive your normal API secret.

### `POST /api/v1/demo/events`
Optional analytics endpoint for:
- scrape started
- scrape ready
- mic granted
- session connected
- first turn completed
- CTA clicked

## Suggested Backend Files

### New API Routes
- [pages/api/v1/demo/sessions/index.js](/home/jonle/everycall/pages/api/v1/demo/sessions/index.js)
- [pages/api/v1/demo/sessions/[demoSessionId].js](/home/jonle/everycall/pages/api/v1/demo/sessions/[demoSessionId].js)
- [pages/api/v1/demo/realtime/token.js](/home/jonle/everycall/pages/api/v1/demo/realtime/token.js)
- [pages/api/v1/demo/events.js](/home/jonle/everycall/pages/api/v1/demo/events.js)

### New Internal Helpers
- [pages/api/_lib/demoSessions.js](/home/jonle/everycall/pages/api/_lib/demoSessions.js)
- [pages/api/_lib/demoWebsiteScraper.js](/home/jonle/everycall/pages/api/_lib/demoWebsiteScraper.js)
- [pages/api/_lib/demoKnowledgeBundle.js](/home/jonle/everycall/pages/api/_lib/demoKnowledgeBundle.js)
- [pages/api/_lib/demoRealtimeSession.js](/home/jonle/everycall/pages/api/_lib/demoRealtimeSession.js)

## Suggested Frontend Files

If implemented in this repo for internal preview:
- [app/demo/page.jsx](/home/jonle/everycall/app/demo/page.jsx)
- [app/demo/demo.css](/home/jonle/everycall/app/demo/demo.css)

If implemented in the separate marketing site:
- create the equivalent `Try It Live` page there
- call the demo APIs from that frontend

## Data Model

### `demo_sessions`
Suggested fields:
- `demo_session_id`
- `normalized_website_url`
- `website_origin`
- `status`
- `business_name`
- `preview_summary`
- `demo_bundle_json`
- `failure_code`
- `failure_message`
- `request_ip_hash`
- `user_agent`
- `created_at`
- `updated_at`
- `expires_at`

### `demo_session_events`
Suggested fields:
- `demo_session_event_id`
- `demo_session_id`
- `event_type`
- `payload_json`
- `created_at`

### Storage Rules
- no `tenant_id`
- no writes to tenant tables
- short retention only

## Security And Abuse Controls

### SSRF / Crawl Safety
Must block:
- localhost
- private IP ranges
- link-local addresses
- internal admin hosts
- non-http/https protocols
- unusual ports unless explicitly allowed

Must enforce:
- same-origin crawling only
- redirect validation
- content-length limits
- byte limits
- deadline limits

### Public Abuse Controls
- per-IP rate limit
- per-domain rate limit
- per-session duration cap
- concurrent session limit
- short cache TTL
- bot protection on the marketing form if abuse appears

### Cost Controls
- cache demo bundles by normalized domain for a short time
- one scrape per domain per short window
- no downloadable files in v1
- no full production retrieval stack
- hard cap on demo session duration

## Failure Handling

### Common Failure Cases
- website blocks crawler with 403
- slow or broken site
- no useful business text found
- browser mic denied
- Realtime session creation fails

### Required UX
Do not dead-end the user.

If website scrape fails:
- show a clear error
- explain the site may be down or blocking the scan
- offer CTA to schedule a live walkthrough
- optionally offer a generic sample receptionist demo

If mic access fails:
- explain mic is required for live voice
- optionally allow text-only fallback later

## Conversion Path

### Required Rule
The demo does not create or update a tenant.

### Allowed Convenience
If the user clicks `Start Free Trial`, you may prefill intake with the website URL as a query param or client-side handoff only.

That prefill must not:
- write demo artifacts into tenant records
- seed tenant knowledge automatically from demo data
- merge demo transcripts or summaries into production

The real tenant onboarding should still perform its own real website build.

## Rollout Plan

### Phase 1: Backend Demo Scrape + Demo Bundle
- create demo tables
- create demo session API
- implement fast crawler
- implement compact summarizer
- return ready/failed state

### Phase 2: Browser Voice Demo
- add WebRTC frontend
- add ephemeral Realtime token endpoint
- add transcript + session states
- add session timeout / end controls

### Phase 3: Marketing Polish
- loading states
- clearer error handling
- CTA handoff to intake
- analytics events
- optional caching by domain

### Phase 4: Hardening
- rate limits
- domain/IP protections
- cleanup jobs
- monitoring
- cost dashboards

## Recommended First Build Scope
For v1, ship this exact slice:

- public page with URL field
- scrape max 5 pages
- generate compact demo bundle
- live browser voice demo via WebRTC
- no phone number
- no tools
- no tenant creation
- no production knowledge writes
- CTA to trial or book onboarding

This is the smallest version that still delivers the “wow” moment.

## Open Questions
- Should blocked websites fall back to a generic EveryCall sample demo automatically?
- Should the public demo show transcript text live, or keep the page cleaner with voice-first only?
- Should demo sessions be stored in the current app database or a separate demo database?
- Should the marketing site call the app backend directly, or should a dedicated demo service be deployed?

## Recommendation
Build the public demo as a separate demo product surface that borrows EveryCall’s voice and receptionist behavior, but not its tenant data path.

That gives you:
- a strong sales experience
- minimal risk to the live customer system
- much lower complexity than trying to route the public web demo through the production tenant architecture
