# EveryCall Pricing Strategy

## Positioning

EveryCall should not compete as a cheap AI answering bot.

The product's strongest value is:

- sounding like an expert in the trade
- making callers feel understood quickly
- smoothly turning missed calls into qualified callbacks

That means EveryCall should be priced as an `AI sales receptionist for home-service businesses`, not as a commodity per-minute phone bot.

## Recommended Launch Model

### Public Launch Recommendation

Launch with a subscription plus per-valid-lead model:

- `EveryCall Core`: `$199/month + $7 per valid lead`

What this gives you:

- meaningful monthly recurring revenue
- pricing tied to customer value, not call duration
- protection against the race to the bottom
- a much clearer sales story than per-minute pricing

### Why This Is The Right Starting Point

- `$199/month` is high enough to avoid commodity positioning
- `$7 per valid lead` is easy for a contractor to understand
- a qualified project lead is typically worth far more than `$7`
- the bill stays understandable without forcing customers to think about minutes or tokens

### What To Avoid

Do not launch with:

- pure per-minute pricing
- extremely low subscription pricing like `$15-$99` unless you want to compete on price
- unlimited plans until you have a much larger usage dataset
- pure per-lead pricing with no subscription floor

## Future Tiering

Once the product is more mature, move to a 3-tier structure:

- `Core`: `$199/month + $7 per valid lead`
- `Growth`: `$349/month + $6 per valid lead`
- `Pro`: `$595/month + $5 per valid lead`

Suggested differentiation by tier:

- `Core`: single business, standard setup, standard support
- `Growth`: stronger reporting, higher-touch onboarding, priority support
- `Pro`: premium onboarding, multi-location or advanced workflow support, custom account support

For now, the simplest launch is better:

- one public plan
- one clear lead definition
- one simple billing model

## Valid Lead Definition

EveryCall should only bill for `valid leads`, not for every answered call.

### A Call Counts As A Valid Lead If All Of The Following Are True

- the caller has real project, service, quote, estimate, or callback interest
- the caller provides a usable callback number
- the call is not spam, a wrong number, or a sales/vendor solicitation
- the call is not just a general business question
- the call is not just an existing-customer support issue, unless you intentionally decide to include those later
- the lead is not a duplicate of the same caller and same opportunity inside the duplicate window

### Recommended Duplicate Rule

Do not bill a second lead when all of the following are true within `30 days`:

- same tenant
- same normalized callback number
- same project or service intent category

### Calls That Should Count

- caller wants an estimate for new windows
- caller needs plumbing work quoted
- caller wants someone to call them about a remodel project
- caller has project interest and asks for follow-up

### Calls That Should Not Count

- hours, address, or service-area questions only
- "are you open?" or "what services do you offer?" with no project interest
- existing customer billing or service-support issues
- spam
- wrong numbers
- telemarketers
- job applicants
- hangups
- calls with no usable callback information

## Customer-Facing Billing Definition

Recommended customer-facing language:

> You only pay for valid project leads: callers with real service or project interest who provide usable callback details.

Recommended fine-print definition:

> A valid lead is a new inbound caller with real project or service interest, a usable callback number, and a requested follow-up. General questions, spam, wrong numbers, duplicate callers, and non-project inquiries do not count as billable leads.

## Recommended Product Changes

To support this pricing model well, EveryCall needs explicit lead-billing logic in the product.

### 1. Canonical Lead Outcome Types

The system should classify each completed call into a clear outcome bucket such as:

- `valid_project_lead`
- `general_inquiry`
- `existing_customer_support`
- `vendor_or_sales_call`
- `spam`
- `wrong_number`
- `hangup_or_incomplete`

Only `valid_project_lead` should be billable.

### 2. Billable Lead Ledger

Create a dedicated billing ledger record for each billable lead.

Each record should include:

- tenant
- call id
- timestamp
- disposition
- billable yes/no
- billing reason
- callback number
- caller name if available
- service request
- duplicate-of id if suppressed
- billed amount
- dispute status

This should be immutable except for explicit admin review actions.

### 3. Duplicate Suppression

The system should automatically suppress duplicate billing when:

- same normalized callback number
- same tenant
- same service intent
- inside the duplicate window

The UI should show that the call was received, but not billed as a new lead.

### 4. Client Transparency

Clients need a clear reason why a lead counted.

For each billable lead, show:

- `Valid Lead`
- why it qualified
- what project/service interest was captured
- callback number
- summary
- transcript link

For each non-billable call, show the non-billable reason.

### 5. Admin Review + Dispute Controls

Admin should be able to:

- review billable lead decisions
- mark a lead as non-billable
- mark a non-billable call as billable
- record a reason for override
- see a complete audit trail

Clients should later be able to dispute a lead, but admin review is enough for launch.

### 6. Billing Report Changes

Billing should report:

- total answered calls
- total valid leads
- total non-billable calls
- duplicate-suppressed calls
- subscription charges
- lead charges
- total invoice estimate

This should be visible per month and per tenant.

### 7. Notification Alignment

Lead notifications should clearly indicate whether a call is:

- a billable valid lead
- a non-billable inquiry

That helps clients understand what they are paying for.

### 8. Test Coverage

Before launch, test at least these cases:

- valid new project lead
- general question only
- existing-customer support call
- spam call
- wrong number
- duplicate callback within 30 days
- valid lead missing callback number
- admin override from billable to non-billable

## Recommended Launch Sequence

### Phase 1

- launch with `Core: $199/month + $7 per valid lead`
- track billable leads internally
- review early customers manually

### Phase 2

- add client-visible lead billing detail
- add admin override tools
- add duplicate suppression UI

### Phase 3

- introduce `Growth` and `Pro`
- add custom/multi-location pricing

## Bottom Line

The cleanest launch pricing model is:

- `Subscription + per valid lead`

The cleanest first offer is:

- `EveryCall Core: $199/month + $7 per valid lead`

The key principle is:

- only bill for real project opportunities with usable callback details

That keeps pricing aligned to value, avoids commodity positioning, and supports a premium sales story.
