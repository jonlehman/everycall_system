# Task: EveryCall Sales — rep screen v2 (state-driven dialer)

**Status:** design approved 10/20. Reference mockups attached under `screens/`. Implement in the existing dialer app (Telnyx WebRTC in the browser, demo conferenced as a leg, inbound via Telnyx Call Control). Multi-user from the start: this task is the rep-facing side; admin screens are a separate task except where noted in Part 7.

---

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
- **What the AI Receptionist knows about them:** the temp tenant's pinned by-heart facts, rendered `Label: spoken sentence`, from the same `core_facts` block the receptionist prompt uses. One source — never a second copy. Caption per state as in the mockups.

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
