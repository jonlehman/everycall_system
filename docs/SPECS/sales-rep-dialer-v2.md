# Task: EveryCall Sales — rep screen v2 (state-driven dialer)

**Status:** design approved 10/20. Reference mockups attached under `screens/`. Implement in the existing dialer app (Telnyx WebRTC in the browser, demo conferenced as a leg, inbound via Telnyx Call Control). Multi-user from the start: this task is the rep-facing side; admin screens are a separate task except where noted in Part 7.

---

## October 28 presentation update

The updated HTML package in `docs/Sales Design/` adds Contacts navigation and the shared callback-picker presentation. Apply it over the existing workspace and backend behavior with these owner-approved clarifications:

- Keep **Company at a glance** and its existing generation flow; the package's receptionist-facts panel is superseded by the company-brief decision below.
- Outcomes unlock at dialing, including unanswered calls. Saving still follows the existing completed-call outcome contract.
- Not-prepped contacts belong in Contacts, with calling disabled, and remain excluded from the dial queue. The owner approved the narrow API visibility change to include all of the authenticated rep's assigned prospects; assignment and queue-readiness boundaries remain enforced.
- The initial presentation refresh deferred callback saving/clearing before a call, Add/restore contacts, global counts/sorting, and all-phone search. The owner subsequently authorized these workflows on October 28; the completion contract below supersedes that initial scope restriction.

## October 28 paid-customer clarification

Paid customers may be called manually and scheduled for follow-up callbacks. Payment status remains intact; all other calling and scheduling safeguards still apply. Paid customers do not enter fresh prospect rotation, but an explicit due callback may place them in the rep queue. Later call outcomes remain truthful and a new do-not-call request still blocks future calls. This supersedes the reference mockup’s Paid call-button restriction.

## October 28 Contacts workflow completion

- Contacts supports server-side search, metro/status filtering, whole-result status counts, and newest-activity ordering with deterministic pagination. Phone search compares normalized partial digits against primary and every additional number. The incoming-unknown search uses the same Contacts search contract.
- Add prospect collects business/contact, labeled phone numbers, website, explicit permission, and timezone. It assigns the authenticated rep and queues the existing demo-preparation process when eligible. Creating an unprepared record does not authorize dialing.
- A removed prospect stays assigned to its rep and appears under Removed. Put back in list restores its list state while preserving all consent, DNC/suppression, readiness, phone-test, and active-call protections. Legacy removed records whose owner was cleared require administrator handling.
- The shared callback picker saves or clears the prospect callback directly before a call, with version checks and no fabricated call history. During a call, selections remain a draft saved by the existing outcome action. The existing callback-priority queue rules apply.
- Existing admin list consumers retain their listing contract. Every new read and mutation preserves authenticated rep ownership, audit/idempotency behavior, and server validation.

## What this replaces

- The current "Sales calls" page: a vertical stack of equal-weight cards (Prospect details / Call & demo / Wrap up), five peer call buttons (Call · Mute · Start Receptionist · End Receptionist · End Call), status badges in three places, a "Help prospect sign up" button, an outcome dropdown, a notes textarea with a separate Save.
- Problems being fixed:
  - Built for the rare case. Most dials never become a conversation, but every dial paid the full page tax (End Call → dropdown → notes → Save).
  - A linear call flow drawn as flat peer buttons.
  - Status scattered across Ready / Permission / Not Started / Receptionist badges plus a collapsed "Calling status" and a microphone explainer paragraph.
  - "Talking points" rendered website marketing copy (and on the Atlantic Plumbing demo record, Creative Dynamic's copy).
  - Call history hidden behind a collapse.
  - No session counters; sign-up action vague.

## Reference files

- `screens/01-ready.html` — state READY (before dial)
- `screens/02-talk.html` — state TALK (connected, rep talking)
- `screens/03-demo.html` — state DEMO (receptionist leg live, rep muted)
- `screens/04-wrapup.html` — state WRAPUP (call ended; close actions + outcome)
- `screens/05-incoming-matched.html` — READY with the incoming-call strip, caller matched to a record
- `screens/05b-incoming-unknown-strip.html` — the strip only, caller not matched
- These are static HTML reference mockups. They are the visual and copy spec: match layout, hierarchy, labels, button placement, and copy. Implement with the app's component stack; do not ship the mockups. All script text inside them is placeholder and must be admin-editable (Part 7).
- Fixture data in the mockups (Atlantic Plumbing, Alex Morgan, the 425-230-01xx numbers, Rosa, Cascade Drain & Sewer, 503-555-01xx) is demo data only.

---

## Part 1 — Screen structure (every state)

- One viewport at 1280×800 and up: no page scroll during a call. Below ~900px wide the prospect panel stacks above the call panel.
- **Header:** brand · Today counters (dials · conversations · demos · paid) · "N ready to call" · rep name · Sign out. Counters are per rep, per local day. Remove "Refresh prospects" (the queue refills itself, Part 5).
- **Incoming-call strip:** full width, directly under the header, present only while a call is ringing in (Part 6). Not a corner toast.
- **Body:** prospect panel (left, 320–380px) + call panel (right, fluid).
- **Footer:** the outcome bar, fixed, identical in every state (Part 4).
- **One status pill** in the call panel header replaces every badge and the mic paragraph. Examples: `Ready · mic live · browser audio OK` / `On call 01:12 · mic live · cell` / `On call 03:42 · demo 00:51 · your mic is muted` / `Call ended · 9:14`.
- **Phase stepper** in the call panel header: Dial → Talk → Demo → Close. Done = green check, current = filled, pending = outline.
- Buttons are real `<button>`s; the primary action is one big button whose label changes with state. End call is always reachable, never the big one.

## Part 2 — Prospect panel

- Eyebrow: `Current prospect · attempt N` + **Remove from list** button (Part 5).
- Business name; contact name · role.
- **Numbers:** every number on the record, labeled (Cell, Shop, …), each dialable. When connected, mark the connected number "on this line". Order: the number with the best history first (last connected → cell → shop). A note like "Rosa screens" next to a number comes from the last call's note field for that number.
- Chips: metro; website (external link); pitch flags from list research (e.g. "No after-hours coverage listed").
- List research (2026-10-28): CSV `ID` maps to the existing source ID (`external_ref`), which matches repeat imports. Preserve `City` separately from metro, plus `Region`, `AfterHoursClass`, `PostedHours`, `CallOpenerHook`, and `Notes`. Store the research fields in prospect metadata; `researchNotes` is separate from timestamped call notes. Admins can add/edit/view these fields and export them. Changing source ID changes the repeat-import match key and rejects a duplicate ID. An import reusing an ID with a different normalized phone or a conflicting supplied website is rejected for that row without changing the existing prospect or its history; use a unique source ID or review the existing record. Omitted research fields on partial edits or re-imports preserve stored values; explicitly blank fields clear them.
- Caller workspace shows city/region and the suggested opener, with a collapsed **List research** section for after-hours classification, posted hours, and research notes. Treat all as rep preparation, never as verified receptionist facts or calling-window configuration. Keep the existing `core_facts` source unchanged. Import continues to require an explicit permission mapping and timezone under the blocking policy; these research columns never imply call/email permission.
- **Before you dial** (READY) / **History** (TALK, DEMO): last attempt (date, time, outcome), best time (from notes), last note.
- **This call** (WRAPUP): length, demo length, your notes, transcript status, recording link. History moves below it.
- **Company at a glance** (owner-approved 2026-10-28 replacement of the rep-only facts panel): an AI-generated brief from the website download already used to prepare the Sales demo. Show **What makes them stand out** (1–2 factual sentences; omit when unsupported), **Main services** (3–5 plain-language services), and **Why customers call** (one sentence of typical needs). Aim for 75–100 words total. Receptionist `core_facts`, suggested demo questions, prompts and call behavior remain unchanged.
- Persist the brief separately as `demo_bundle_json.company_brief`; render saved content without inference. Generation uses the existing structured Responses helper, with page URLs and literal supporting quotes, and no heuristic or template summary fallback. New Sales preparations retain downloaded page lines separately from bounded AI evidence in `scrape_pages_json`.
- Existing ready demos expose **Generate brief**, which reuses their saved website evidence without recrawling, modifying the tenant, or replacing the demo. Older Sales captures retain only title/description/headings/excerpts; if they cannot support the required services and summary, show unavailable. Pending generation has an exclusive, recoverable lease; retries cannot overwrite a newer capture or changed website. Ready briefs are reused. Brief failures do not change demo readiness.

### Company brief requirement mapping

This is a Sales presentation artifact, not a receptionist knowledge card or published tenant build. It changes no frozen requirement text, source authority, tenant override, or publication contract.

| Preserved requirement | Implementation boundary | Regression |
|---|---|---|
| REQ-PIPE-005, REQ-PIPE-006 | `prepareSalesDemoProfile` retains Sales download page lines/headings; `companyBriefEvidence` budgets a copy only. | `validate-sales-company-brief.mjs`: unchanged stored evidence, legacy capture support, input immutability. |
| REQ-KNOW-007, REQ-PIPE-009 | Separate brief has a source hash and AI-written claims with page URLs and supporting quotations. It does not substitute for canonical source refs. | AI helper invocation and quote-grounding rejection regressions. |
| REQ-RULE-001, REQ-RULE-012 | Sales website brief never enters receptionist facts/prompts, overrides, or authority evaluation; prompt excludes unsupported marketing superiority. | Original `core_facts` and remaining demo bundle stay byte-equivalent across enrichment. |
| REQ-PIPE-016 | Generating a brief touches only the Sales profile JSON field; tenant build publication and demo readiness remain unchanged. | Failure/retry, exclusive lease, stale capture, changed website and ready-reuse regressions. |

## Part 3 — Call panel by state

### READY (`01-ready.html`)
- Primary: `Call cell · <number>` (green). Secondary: `Call shop · <number>` (green outline). Tertiary, right-aligned: `Skip for now` → moves the prospect to the end of today's queue, no attempt logged.
- Script card: **Opener** · **If he's interested** (+ "then press Start demo") · **If voicemail** (uses first name; voicemail is left manually — no voicemail drop).
- Footer outcomes disabled; Remove from list on the card still works.

### TALK (`02-talk.html`)
- Entered when the far end answers. Call timer starts; status pill names the connected number.
- Primary: `Start demo — hand to the AI Receptionist` (amber). Secondary: `Mute`. `End call` (red outline, right-aligned).
- Script card: discovery questions · **The hand-off** — exact copy: *"I can show you in about two minutes. I'll put our AI receptionist on — she already knows everything from the main pages of your website. Ask her anything a customer would ask your receptionist."* · two objection responses side by side · **No time right now** (→ set Call back ▾ while he's on the line) · **You got the dispatcher** (note name + best time).
- **Notes textarea** ("Notes — carry into the wrap-up"): one field, persists across TALK → DEMO → WRAPUP, prefills the footer note.

### DEMO (`03-demo.html`)
- Start demo: conference the temp-tenant receptionist leg in, mute the rep's mic, start the demo timer in the status pill.
- Primary: `End demo — put me back on` (amber): drop the receptionist leg, unmute the rep, return to TALK (post-demo). Secondary: `Unmute me` (override while the demo runs; toggles). `End call`.
- **While you listen** card: the same notes textarea · **If he stalls, unmute and suggest one** — chips generated from the by-heart facts (Part 7), with the after-hours ask styled as the pitch · **When he's heard enough** exit line.
- No live transcript (not available during the call). Caption: "Transcript arrives after the call."

### WRAPUP (`04-wrapup.html`)
- Entered on End call (either side hangs up). Status pill `Call ended · m:ss`.
- Two close cards side by side:
  1. **Send the checkout link** — Text / Email toggle. "Text to" defaults to the cell on record; hint when none. `Send link` → Stripe Checkout session ($100 setup, first month included) → SMS via Telnyx or email → outcome auto-set to Link sent → send logged on the call record.
  2. **Book 15 minutes with Jon** — slot pills from a live Outlook calendar read (next 4 open 15-minute slots + More…); `Invite to` = owner email; `Book <slot>` → calendar event with the prospect as attendee. Event body: business, contact, numbers, paid/unpaid at booking time, link to the call record.
- **Script · Close** card, plus the one-line decline fallback ("Jon can take it at the start of your setup call").
- Left panel **This call**: length, demo length, your notes, "Transcript — processing" until it lands, Recording link.

## Part 4 — Outcome bar (footer, every state)

- Buttons, in order: `No answer` · `Voicemail` · `Call back ▾` · `Not interested` · `Do not call ▾` · `Demo done` · `Link sent` · `Paid — set by Stripe` (display only, dashed, never clickable). Then a one-line note input, then `Save & next →`.
- Enabled from the moment a call is dialed; disabled in READY.
- `Save & next` is disabled until the call has ended. Then one click = save outcome + note + load the next prospect. It never waits for transcript processing.
- Semantics:
  - **No answer** — attempt +1, stays in list.
  - **Voicemail** — attempt +1, logged as voicemail. Manual voicemail; no drop.
  - **Call back ▾** — picker: Later today / Tomorrow AM / Tomorrow PM / explicit date-time input. Stores `callback_at`. When `callback_at` arrives, the prospect moves to the top of that rep's list.
  - **Not interested** — status `dnc(not_interested)`. Permanent.
  - **Do not call ▾** — reason: bad number / asked not to be called / out of business → `dnc(<reason>)`. Permanent.
  - **Demo done** — conversation + demo, no commitment yet. Stays in list; the rep sets Call back if a time was agreed.
  - **Link sent** — set automatically by Send link; selectable manually if the link went out another way.
  - **Paid** — set only by the Stripe webhook; never by the rep. The header "paid" counter counts this.
- DNC must survive list re-import: dedupe on normalized phone + website domain; a DNC match never re-enters any queue.

## Part 5 — Queue, prep, callbacks, removal

- The rep queue contains only prospects whose temp tenant is built and ready. Not-prepped prospects never render on the rep side. Prep runs 10 ahead; refill when the ready count drops to 9. "N ready to call" in the header is that count.
- Queue order: callbacks due (by `callback_at`) → inbound returns ("Returned your call") → fresh, in list order.
- **Remove from list** → status `removed(attempts_exhausted)`. Distinct from DNC: re-importable in a later campaign. (Jon may merge this into Do not call ▾ — if so, add "too many attempts" as a reason and drop the card button.)
- Soft prompt: at attempt `REMOVE_PROMPT_AT` (config, default 4) with no conversation, the eyebrow reads "N attempts, no conversation — remove?" next to the Remove button. Never automatic.
- Temp tenant lifecycle: built from the main pages for the demo; kept while the prospect is in the list, callbacks included; no time-based expiry. On **Paid** → the full build (up to 500 pages) kicks off and the tenant becomes the real tenant. On DNC / removed → tenant may be deleted.

## Part 6 — Incoming calls

- Inbound to the outbound caller-ID number: Telnyx Call Control answers, rings the rep in the browser, and the strip appears under the header (`05-incoming-matched.html`, `05b-incoming-unknown-strip.html`).
- **Matched** (caller ID = a number on a prospect record): strip shows business · number · contact, context line ("Returning your call — you left a voicemail Oct 16"), `Take call` (green primary) and `Send to AI Receptionist`. `Take call` connects the rep, swaps the caller in as the current prospect (TALK state), and puts the prospect the rep was about to dial back at the top of the list.
- **Unknown:** strip shows the number and "not in your list". `Take call` first; inline search (business name or number) and `Add as new prospect` with a website field. Creating with a website starts the temp-tenant build immediately.
- **Rep mid-call:** the strip shows but has no Take button. The call routes to EveryCall's own receptionist (immediately when mid-call; after 15s unanswered otherwise), which takes a message and creates a return-call item at the top of that rep's queue, labeled "Returned your call".
- `Send to AI Receptionist` = the same routing, on demand.

## Part 7 — Scripts and generated prompts

- All script text in the mockups is placeholder. Store scripts per phase as admin-editable content: `opener`, `if_interested`, `if_voicemail`, `talk_discovery`, `handoff`, `objections[]`, `no_time`, `gatekeeper`, `while_you_listen`, `exit_line`, `close`, `close_decline`. Template variables: `{first_name}`, `{business_name}`, `{rep_name}`, `{rep_phone}`, `{cell}`, `{shop}`.
- v1 may be a config file if the admin UI isn't ready; the "Edit scripts" link in the call panel targets whatever exists.
- Suggested-ask chips in DEMO are generated from the by-heart facts: one per fact category present (hours, service area, services) plus the after-hours ask whenever the site has no after-hours answer. The after-hours chip gets the amber style.

## Part 8 — Payment, booking, activation

- Checkout: Stripe Checkout, $100 setup including the first month. Paid = the completed-checkout webhook → outcome Paid, counter +1, full build kicks off.
- **Nothing activates unpaid.** If unpaid at the setup call, Jon takes the card at the start of the call (same Stripe product, same webhook).
- Booking is not gated on payment. The invite body carries paid/unpaid so it's visible before the call.
- Earliest bookable slot = now + `FULL_BUILD_LEAD_MINUTES` (config). Set it once full-build time is measured.
- Text delivery: SMS via Telnyx to the cell on record; fall back to email when there is no cell. Don't offer Text when the only number is a shop line.
- Setup-call owner is Jon for now; make the calendar owner a config (`SETUP_CALL_OWNER`) so a second rep's calendar can be used later.

## Part 9 — Data and async

- Call record: prospect, rep, numbers dialed, connect time, demo start/end, end time, outcome, note, live notes, `link_sent_at`, `booked_at`, `paid_at`, transcript (attached async), recording URL.
- Transcript (and facts-used, if the gateway reports it) arrives after the call; attach to the call record when ready. The UI shows "Processing" and updates in place. Never block Save & next.
- Mic: Start demo mutes, End demo unmutes, Mute/Unmute override; the state is shown only in the status pill.

## Part 10 — Acceptance

1. READY → Call cell → no answer → `No answer` → next prospect loads. Three clicks, no scroll, no dropdown.
2. TALK → Start demo mutes the rep and adds the receptionist leg; End demo drops the leg and unmutes; the status pill reflects each change; Unmute override works mid-demo.
3. Notes typed in TALK persist through DEMO and prefill the footer note in WRAPUP.
4. Call back with an explicit date-time → the prospect is at the top of the rep's list at that time.
5. Not interested / Do not call → the prospect never re-enters any queue, including after a list re-import containing the same phone or domain.
6. Remove from list → `removed(attempts_exhausted)`; a later re-import is allowed.
7. Send link (Text) → Stripe session created, SMS delivered, outcome shows Link sent; webhook → Paid. The rep cannot set Paid from the UI.
8. Book → Outlook event created with the prospect as attendee; body shows paid/unpaid; offered slots are live and ≥ `FULL_BUILD_LEAD_MINUTES` out.
9. Incoming matched → strip with correct context; Take call → TALK with that prospect; the interrupted prospect is at the top of the list.
10. Incoming unknown → Take call works; Add as new prospect with a website → temp-tenant build starts immediately.
11. Incoming while mid-call → no Take button; routes to EveryCall's receptionist; "Returned your call" item at the top of the queue afterward.
12. Not-prepped prospects never render on the rep side; the ready count refills at 9.
13. Save & next is disabled until call end and never waits for the transcript; the transcript attaches later and updates in place.
14. Header counters are per rep per day and correct after each outcome.
15. 1280×800: no page scroll in any state; ≤900px: panels stack.

## Open with Jon

- Merge Remove from list into Do not call ▾, or keep them distinct (default: distinct).
- Take call swaps the current prospect out (default: yes).
- `FULL_BUILD_LEAD_MINUTES` — measure the full build first.
- Demo done: stays in list with no callback unless the rep sets one (default).


## Implementation authority and preserved constraints

This is the owner-approved October 20 design. The package's HTML screens are reference material, not deployed application assets. Keep Remove from list distinct from Do not call; taking an incoming call swaps the current prospect; Demo done remains eligible without an implicit callback.

This design explicitly supersedes the July 28 Sales decisions about the 30-day demo expiry, the old 11-row warm queue, and the signup-only handoff. It does not amend the frozen knowledge subsystem requirements: original source bytes, tenant ownership, provenance, pricing authority, reviewed publication, and cross-tenant isolation remain governed by their existing requirement IDs. Payment authorizes the full build and real-tenant conversion; production voice additionally requires the existing knowledge-publication and service-readiness gates.

Provider-backed actions require actual configured providers. Calendar slots, messages, payment outcomes, transcript completion, and bookings must never be simulated in production. Stripe is the only authority for Paid. Missing external setup is an explicit unavailable state.

## Reversible owner-phone testing — October 28 addition

The owner requested an admin control to test the Sales caller using desk `+14252300121` and cell `+14256154640`, with safe restoration of original contact numbers. This adds phone testing only; the original permission, DNC, calling-window, payment, and knowledge requirements remain in force. Deployment and enabling the control are separate actions; the default is off.

| Requirement | Behavior and implementation | Regression |
| --- | --- | --- |
| SALES-PHONE-TEST-001 | Admin Settings offers status, enable, and restore. Sales sessions cannot read or mutate the control. Mode changes and privacy-safe audits commit together. | `validate-sales-auth.mjs`; audit rollback in `validate-sales-phone-test-mode.mjs` |
| SALES-PHONE-TEST-002 | Enable saves the primary phone and complete structured number list in dedicated private columns, substitutes the two owner numbers, and preserves source identity and unrelated metadata. Repeated enable cannot overwrite backups. Restore reinstates exact saved values and clears backups. Both transitions increment row versions. | Exact JSON restoration, repeat enable, serialization privacy, stale editor tests |
| SALES-PHONE-TEST-003 | A singleton database lock serializes transitions with call reservation, inbound insertion, phone writes, checkout reservation, and booking reservation. Switching is blocked by active calls, pending incoming calls, unresolved checkout delivery, or booking reservations. Authoritative call insertion rejects stale destinations and freezes destination and mode for the call. | Active-call fence, stale dial, immutable destination, deterministic checkout/booking interleaving, uncertain-delivery fence |
| SALES-PHONE-TEST-004 | Adding/importing prospects, editing phones, and removing/deleting prospects are blocked while testing. Other permitted edits retain existing behavior. DNC lookup and registration use saved original identities; testing grants no call permission and bypasses no calling hours. | Mutation guards, original-identity DNC, unchanged ineligible prospects |
| SALES-PHONE-TEST-005 | Caller workspace and prospect rows identify owner test numbers. Test dispositions and notes remain in call history but do not update real prospect outcomes, callback scheduling, DNC, or followups. Rep metrics exclude test calls. | Test disposition without DNC/followup effects; existing Sales v2 regression |
| SALES-PHONE-TEST-006 | Checkout and setup booking are unavailable for test calls, including after restore. Incoming Sales calls are hung up while test mode is active because shared numbers cannot identify a prospect. Existing paid transactions and unrelated campaigns are unaffected; this feature is not a provider or payment sandbox. | Test checkout rejection before/after restore; checkout/booking reservation interleaving; inbound hangup without matching |

Migration `0057_sales_phone_test_mode.sql` installs the columns and guards and participates in explicit schema readiness. Native PostgreSQL concurrent lock scheduling and a real browser/provider canary remain separate release verification; disposable tests never call real contacts or send messages.
