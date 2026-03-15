# 07 Source Precedence, Conflicts, and Content Classification

Status: Frozen handoff baseline
## Purpose

This document defines how the subsystem decides:
- which source is more trustworthy when content overlaps
- how to handle contradictions
- how to classify content for receptionist use
- what content may inform answers, and with what priority

## Global precedence order

From highest to lowest:

1. Tenant hard override
2. Tenant temporary operational notice
3. Tenant approved answer snippet / dangerous-question rule
4. Confirmed owner/operator interview facts
5. Uploaded first-party operational/policy documents
6. Dedicated website policy/contact/location/hours page
7. Dedicated website service detail / provider bio / FAQ page
8. Website service-area / geo landing page
9. Website home / about / generic marketing page
10. Blog / article / educational page
11. Testimonial / slogan-only content

## Source-origin precedence notes

- private, business-provided sources outrank passive public website text when they clearly speak to the same fact
- interview-confirmed facts outrank uploaded docs unless the uploaded doc is a more specific and clearly authoritative operational record for that exact fact
- uploaded documents should be classified before precedence is applied; a marketing brochure should not outrank a policy page just because it was uploaded
- within the same source-origin tier, apply question-specific and page-type precedence rules

## Why precedence exists

Business websites frequently contain contradictions such as:
- hours differing between footer and contact page
- service-area statements differing between geo pages and home page blurbs
- marketing claims overstating operational reality
- outdated downloadable PDFs
- generic blog content sounding more authoritative than true policy pages

The compiler and runtime must not improvise through these conflicts.

## Question-specific precedence

### Hours / address / phone / office location
Prefer:
1. hard overrides
2. temporary notices
3. dedicated location/contact/hours pages
4. structured footer/header contact blocks
5. generic pages mentioning the information

### Pricing / financing / warranty / insurance / forms / referral / scheduling rules
Prefer:
1. hard overrides
2. approved answer snippets or guardrails
3. dedicated policy/process pages
4. FAQ pages
5. service pages mentioning the topic incidentally
6. marketing pages

### Service capability ("Do you offer/fix/treat X?")
Prefer:
1. hard overrides if present
2. dedicated service-detail pages
3. FAQ or service-family pages
4. geo/service pages
5. generic marketing pages
6. educational/blog content only for contextual backup, not primary truth

### Service area / city coverage
Prefer:
1. hard overrides
2. service-area / geo pages
3. service pages with explicit location coverage
4. contact/location pages when clearly scoped
5. generic home-page blurbs

### Person / provider / staff facts
Prefer:
1. hard overrides
2. provider/staff pages
3. location pages that explicitly attach the person to that location
4. generic team/about pages
5. blog content mentioning the person

## Conflict resolution rules

When sources conflict:
1. higher-precedence source wins
2. explicit statement beats implied statement
3. matching location/provider/service beats generic statement
4. matching active domain/subdomain beats unrelated scope
5. newer published build beats older build
6. if conflict remains unresolved, do not state it as fact

## Conflict severity levels

### Low
Minor wording disagreement, no operational risk.

Example:
- "call today" vs "contact us to schedule"

### Medium
Potential answer inconsistency but not highly risky.

Example:
- one page says "same-day appointments available" and another says "availability varies"

### High
Operational or trust-sensitive contradiction.

Examples:
- conflicting hours
- conflicting service-area coverage
- conflicting accepted insurance
- conflicting emergency availability

### Critical
Potentially harmful or serious business-risk contradiction.

Examples:
- regulated advice boundary differs by page
- urgent/emergency routing differs
- incompatible location/provider identity or phone number

## Runtime rule for unresolved conflict

If a contradiction remains unresolved after precedence:
- do not present the disputed fact as settled
- switch mode to `clarify`, `handoff`, or bounded `partial_answer`
- log the contradiction in feedback/QA telemetry

## Content classes

### `operational_core`
Primary receptionist material.

**Examples**
- hours
- locations
- services
- providers/staff
- service areas
- booking/scheduling steps
- financing
- warranty
- forms
- contact methods

**Runtime usage**
Primary truth source for receptionist answers.

### `policy_boundary`
Restrictions, exclusions, route rules, urgent handling.

**Examples**
- what the business does not do
- after-hours policy
- referral requirements
- age limitations
- emergency instructions
- "before the tank only"
- "does not service portable AC units"

**Runtime usage**
High-priority truth source. Used for safe/accurate boundary handling.

### `descriptive`
Useful explanation but not primary operational truth.

**Examples**
- what a service is
- what to expect during installation
- how a procedure generally works

**Runtime usage**
May support answers when operational content is already aligned, but should not override policy.

### `marketing`
Persuasive but low-truth-priority content.

**Examples**
- awards
- slogans
- "we care more"
- "best in town"
- generic value language

**Runtime usage**
May influence tone seasoning only. Never primary truth source.

### `educational`
Informational article/blog content.

**Examples**
- symptom explainers
- how-to articles
- technical explainers
- thought-leadership posts

**Runtime usage**
Generally not used for receptionist answers unless the caller explicitly asks what the business source materials say about a topic. Never primary source for policy or operational commitments.

## Classification heuristics

### Strong signals for `operational_core`
- contact info blocks
- schedule/booking language
- office/service-area details
- service lists
- provider bios
- pricing/financing pages
- service detail pages

### Strong signals for `policy_boundary`
- exclusions
- not offered / not treated / not covered wording
- required forms/referrals
- urgent care or emergency language
- cancellation/reschedule rules

### Strong signals for `educational`
- article/blog layout
- publication dates
- broad educational headings
- informational tone not tied to business operations

## Suppression rules

The compiler should suppress or downgrade:
- repeated boilerplate CTAs
- repeated footer slogans
- repeated testimonial snippets
- repeated "why choose us" blocks
- repeated contact blocks once canonical operational facts are already captured

## Examples

### Example 1: hours conflict
- Footer: "Open 24/7"
- Contact page: "Office hours Mon–Fri 8–5"
- After-hours page: "Phones answered after hours"

Resolution:
- contact/after-hours pages beat footer slogan
- build operational answer around office hours + after-hours answering policy
- do not collapse to "open 24/7"

### Example 2: service-area conflict
- Home page says "serving all of Puget Sound"
- geo page lists only specific cities
- override says service area excludes one city temporarily

Resolution:
- hard override wins
- geo pages beat generic marketing claim
- generic broad claim should not expand the operational service area

### Example 3: educational conflict
- Blog post explains a procedure generically
- policy page states the business does not offer it

Resolution:
- policy boundary wins
- blog content should not create an offering card
