# SPEC: Basic User Intake And Navigation

## Status
- Proposed
- Owner: Platform
- Last Updated: 2026-04-10

## Related Docs
- [SPEC: Intake Onboarding V2](/home/jonle/everycall/docs/SPECS/intake-onboarding-v2.md)
- [PRD: Tenant Intake & Onboarding](/home/jonle/everycall/docs/prd/intake-process.md)
- [PRD: Client UI](/home/jonle/everycall/docs/prd/client-ui.md)
- [app/intake/page.jsx](/home/jonle/everycall/app/intake/page.jsx)
- [pages/api/v1/tenants/onboard.js](/home/jonle/everycall/pages/api/v1/tenants/onboard.js)
- [app/client/_components/navigation.js](/home/jonle/everycall/app/client/_components/navigation.js)
- [app/client/team/page.jsx](/home/jonle/everycall/app/client/team/page.jsx)

## Summary
This spec defines the beginner-friendly EveryCall setup path for a basic user:

- they have a business phone or phone system
- they want EveryCall to answer inbound calls
- they want new leads sent to them
- they are not trying to configure advanced routing, billing, or integrations during signup

The core product promise for this user is:

1. Teach EveryCall enough about the business to answer basic questions.
2. Tell EveryCall where to send leads.
3. Forward calls to the EveryCall number.
4. Review what happened.

The product should be organized around that mental model.

## Goals
- Reduce signup friction for non-technical users.
- Collect only the information needed to create an account and define the first lead destination.
- Route no-website users into a support-assisted setup path.
- Make first-run navigation reflect user intent rather than internal system structure.
- Keep advanced setup items out of the first-run flow.

## Non-Goals
- Collecting advanced routing, billing, CRM, or integrations during signup.
- Full self-serve no-website onboarding.
- Multi-user team setup during intake.
- Replacing the existing detailed team/integrations features. This spec changes first-run language and structure, not all advanced capability.

## Primary User
A business owner or office manager who wants EveryCall to answer inbound calls from an existing business phone or phone system and send new leads to them.

## Minimum Required Data Model

### Required To Create The Account
- Business website URL
  - or `I don't have a website`
- Business name
- Lead alert email address
- Login email address
- Password

### Conditionally Collected At Signup
- Mobile number for text alerts
  - optional
  - if entered, the UI must clearly state that a confirmation SMS will be sent before text alerts are enabled

### Not Collected During Signup
- Business phone number
- Owner phone number
- Business description
  - website users should get this from website crawl
  - no-website users should get this through the support-assisted setup call
- Business hours
- Voice selection
- Integrations
- Team members

## Required To Go Live
These are the true minimum items required before EveryCall is genuinely ready to answer calls:

- EveryCall number provisioned and carrier-ready
- Knowledge base published
  - from website crawl, or
  - from support-assisted source document / setup session
- At least one active lead destination
  - email by default
  - SMS only after opt-in confirmation if used
- Customer has forwarding instructions and forwards desired calls to the EveryCall number

## Intake Flow

### Page 1: Website
Prompt:
- `What is your business website?`
- alternate path: `I don't have a website`

Behavior:
- Website remains required unless the no-website checkbox is selected.
- Do not ask for anything else on this page.
- Helper copy should explain that EveryCall uses the website to start the first knowledge base automatically.

Submit / Continue result:
- if website entered: proceed to page 2
- if no website selected: proceed to page 2

### Page 2: Business Name
Prompt:
- `What is your business name?`

Behavior:
- Single visible field
- No additional setup questions on this screen

### Page 3: Send Leads To
Prompts:
- `What email should receive new leads?`
- `What mobile number should receive text alerts?` optional

Behavior:
- Lead email is required.
- SMS number is optional.
- SMS helper copy must say that a confirmation text will be sent before alerts are enabled.
- This screen should be described in plain language as the place where EveryCall sends new leads, not as "Users" or "notifications."

### Page 4: Create Login
Prompts:
- `What is your email address?`
- `Password`
- `Confirm password`

Behavior:
- Login email should auto-fill from the lead email by default.
- User can edit it if they want login and lead email to differ.
- This is the final submit screen.

## Field Ownership

### Website
- Collected on intake page 1
- Stored on `tenant_bootstrap_profiles.website_url`
- Used to enqueue and run the initial website knowledge build

### No-Website Flag
- Collected on intake page 1
- Determines support-assisted setup path
- Should result in `bootstrapMode = setup_interview`
- Should not require business-description entry during intake

### Business Name
- Collected on intake page 2
- Stored on:
  - `tenants.name`
  - prompt profile business name
  - runtime greeting defaults

### Lead Alert Email
- Collected on intake page 3
- For v1 of this beginner flow, this should become the default owner/primary recipient email
- Stored on the owner `tenant_users.email`
- `lead_alert_email_enabled` should be enabled by default for the owner

### SMS Alert Mobile Number
- Collected on intake page 3
- Stored on the owner `tenant_users.phone_number`
- Must not become fully active SMS alerting until opt-in is confirmed
- Recommended initial state:
  - save phone number
  - `lead_alert_sms_enabled = false`
  - `sms_opt_in_status = not_requested`
  - immediately prompt / send opt-in after account creation

### Login Email
- Collected on intake page 4
- Auto-filled from lead alert email
- Editable
- Stored on the owner `tenant_users.email`

### Password
- Collected on intake page 4
- Stored as hashed password on the owner `tenant_users.password_hash`

## Success Screen Behavior

The success state should stop being a generic "workspace ready" panel and instead become a "what to do next" setup state.

### Website Path Success
Show:
- account created confirmation
- EveryCall number status
- website build status
- short instruction:
  - `Forward calls from your phone system to this EveryCall number`
- next actions:
  - `Review Basics`
  - `Watch Knowledge Build`
  - `Confirm Lead Destinations`

### No-Website Path Success
Show:
- account created confirmation
- EveryCall number status
- clear message that support will help create the initial knowledge source
- modal or blocking prompt to schedule the setup call
- support CTA should be the primary action

Calendly target:
- `https://calendly.com/jonlehman/everycall-setup`

Recommended modal language:
- `No website? We'll help you get set up.`
- `Since you do not have a website yet, the fastest path is a short setup call with support. Pick a time that works for you and we'll help configure your sales receptionist correctly.`

### Forwarding Instruction
This should be explicit on the success screen, not buried in another page:

- `Forward desired calls from your business phone system to this EveryCall number.`

This is instruction, not a required form field.

## First-Run Navigation Model

### Problem With Current Labels
Current primary navigation is:
- Dashboard
- Calls
- Sales Receptionist
- Users
- Account

For a beginner, `Users` and `Integrations` are internal/admin concepts. The user is really thinking:
- where do my leads go?
- where do I teach it about my business?
- where do I see calls?

### Recommended Primary Navigation
- `Get Started`
- `Calls`
- `Receptionist`
- `Send Leads To`
- `Account`

### Recommended Meanings
- `Get Started`
  - first-run checklist
  - setup progress
  - forwarding instruction
  - current build / readiness state
- `Calls`
  - recent calls
  - call details
  - follow-up work
- `Receptionist`
  - Basics
  - Knowledge
- `Send Leads To`
  - Email alerts
  - Text alerts
  - CRM / integrations as advanced or secondary
- `Account`
  - general settings
  - billing
  - support

### Short-Term Rename Plan
If full IA changes are too large for one pass, the minimum rename improvement is:

- Primary nav:
  - keep `Dashboard` for now or change to `Get Started` for first-run tenants
  - keep `Calls`
  - keep `Sales Receptionist` or shorten to `Receptionist`
  - change `Users` to `Send Leads To`
  - keep `Account`

- Account subnav:
  - keep `General`
  - rename `Integrations` to `CRM / Integrations`
  - keep `Billing`
  - keep `Support`

## Beginner Setup Sequence
After signup, the product should guide the user through this exact order:

1. `Forward calls to your EveryCall number`
2. `Review Basics`
3. `Review Knowledge`
4. `Confirm where new leads should go`
5. `Review Calls`

The first-run landing page should reinforce that sequence.

## Recommended Implementation Notes

### Intake
- Replace current 2-step intake with 4 simple single-purpose pages.
- Do not show a multi-step sidebar/timeline.
- Keep one primary question per screen.

### Owner User Creation
- Onboard should create the owner user from the login email.
- The same owner user should act as the default lead destination.
- Lead alert email should be enabled by default.

### SMS Alert Behavior
- If SMS number is present, store it on the owner record.
- Do not enable SMS lead alerts until opt-in is confirmed.
- The first-run flow should surface the opt-in step clearly.

### No-Website Path
- No-website intake should not force the user to invent business-description copy.
- Support setup should create the initial approved knowledge source.
- The success modal should push directly to scheduling that support call.

### Dashboard / Get Started
- New tenants should not land cold on an analytics-heavy dashboard.
- First-run users should land on a setup-oriented page until minimum setup is complete.

## Acceptance Criteria
1. A beginner user can complete signup without entering phone-system details, business hours, routing rules, or integrations.
2. Website users can create an account with:
   - website
   - business name
   - lead email
   - optional SMS number
   - login email
   - password
3. No-website users can create an account and are immediately routed into a support-assisted setup path.
4. Lead destination language is visible during signup and not hidden behind "Users" terminology.
5. SMS collection clearly states that a confirmation text is required before alerts are enabled.
6. The success state clearly shows the EveryCall number and forwarding instruction.
7. The app navigation uses beginner-friendly language tied to user intent.
