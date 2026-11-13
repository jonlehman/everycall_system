# Task: EveryCall Sales — rep screen v2 (state-driven dialer)

## Current authority — November 12, 2026

The owner-approved [unified paid intake and billing specification](unified-paid-intake-and-billing.md) supersedes the standalone direct-payment signup path below: Sales sends secure prefilled links into the same intake as website/pricing/demo/assisted signup. A verified existing purchase is reused; new hosted checkout collects setup payment and recurring consent. Convert one correctly bound tenant automatically, then archive obsolete demo resources, revoke replaced legacy credentials and stop unsent prospect outreach while preserving immutable history and uncertain-provider fences. Paid voice still requires validated publication/readiness. Sales reps may arrange setup appointments before payment; customer self-service booking requires payment. Preserve historical SALES-CHECKOUT requirement IDs/text, frozen amounts, recipient/mode/consent safeguards and the approved $1 live-test exception. UPIB-001–014 supplies the superseding requirements and future regression map; implementation remains pending.

**Status:** design approved 10/20. Reference mockups attached under `screens/`. Implement in the existing dialer app (Telnyx WebRTC in the browser, demo conferenced as a leg, inbound via Telnyx Call Control). Multi-user from the start: this task is the rep-facing side; admin screens are a separate task except where noted in Part 7.

## In-call keypad (owner-approved November 11, 2026)

- **SR-DTMF-01:** A connected sales call offers an accessible 12-key keypad (0–9, star, pound). Clicking a key or typing while focus is inside the open keypad sends a real destination DTMF command. Editable fields, modifier shortcuts, held-key repeats, and keys outside the keypad do not send tones. Escape closes it and returns focus to its toggle. Implementation: `InCallKeypad.jsx`, `InCallKeypad.module.css`, `DialerScreen.jsx`; regression: `test-sales-keypad-browser.mjs`.
- **SR-DTMF-02:** Route each key through the existing authenticated, owner-scoped Sales call-action API and internal gateway authorization. Under the existing per-call lock, reload the call and require a connected, non-ended destination with distinct stored prospect/operator/AI identities. Send only to the server-selected prospect leg; never accept a browser-supplied provider target or broadcast conference DTMF. Implementation: call `actions.js`, gateway `performAction`, `salesTelnyxClient.js`, `lib/salesDtmf.js`; regressions: `validate-sales-auth.mjs`, `validate-sales-call-gateway.mjs`, `validate-sales-telephony.mjs`.
- **SR-DTMF-03:** Serialize rapid keys in input order. Close, disconnect, local hangup, call change, and send failure discard unsent keys; late responses cannot restore a live call or alter a replacement keypad. Give clear failure feedback without automatically replaying uncertain keys. Each press uses a distinct UUID, passed as both the API idempotency key and provider command ID. Do not persist entered-digit history or include keys in audit details. Implementation: `CallerWorkspace.jsx`, `InCallKeypad.jsx`, provider adapter; regressions: keypad browser, dialer controller, auth and telephony validators.
- **SR-DTMF-04:** Preserve mute, recording, ringback, incoming calls, demo transitions, hangup and disposition behavior. No new dependency or schema change. Deploy the gateway helper with its ESM package boundary before relying on the UI. Offline mocks establish targeting and control behavior; a separately authorized controlled IVR call must establish audible destination acceptance. Never call imported prospects for this check.

## Local outbound ringback (owner-approved November 9, 2026)

- **SR-RB-01:** The Call-button gesture may unlock local speaker audio, but only the server's `dialing_prospect` state starts ringback. Creating a reservation, preparing the operator leg, or receiving its browser `active` event is not proof the prospect was dialed or answered. Incoming and restored connected calls stay silent.
- **SR-RB-02:** Play a moderate-volume 440/480 Hz local tone for two seconds followed by four seconds of silence. Connect only to the browser audio output; never mix it into the microphone, conference, or remote audio element. Preserve existing Telnyx call control and audio routing.
- **SR-RB-03:** Silence on observed prospect answer, terminal/failure state, explicit cancellation, provider error/disconnect, offline/navigation/page teardown, or status-fetch failure. Stops invalidate delayed audio resumes and subsequent stale polls. Existing 1.5-second polling determines answer observation latency; local ringback is progress feedback, not proof of carrier ringing. Six seconds without a fresh accepted-dial status or 90 seconds of ringing silences audio without changing the actual call.
- **SR-RB-04:** Browser autoplay denial or missing audio support must not prevent calling. Repeated status updates must not duplicate tones. Implementation: `CallerWorkspace.jsx` and `localRingback.mjs`; regressions: `scripts/test-sales-local-ringback.mjs` and `scripts/test-sales-dialer-controller.mjs`. Audible provider-call acceptance remains a separate live check.

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

## November 5 admin bulk assignment

The owner-approved admin workflow adds All/Assigned/Unassigned filtering, whole-result sorting (queue, business, contact, status, assigned rep, update time), and stable scope-bound cursor pagination. Search, totals and CSV export use the same filters and ordering. Rep-only Contacts and automatic queue claiming retain their existing behavior.

Admins may select individual rows or **all visible**, meaning every currently loaded row, then choose an active configured Sales operator and **Assign to Rep**. Existing ownership does not prohibit reassignment; configured admin callers are valid targets. Display owner names/emails, selected count and success/error feedback. Disable invalid/in-flight actions, clear selection when the dataset reloads or filters/sort change, and ignore stale list responses. Do not add a confirmation dialog. Assignment and export are limited to 5,000 records per action, with explicit errors rather than truncated output.

The server authorizes actual admin sessions, validates target eligibility, and checks both prospect row version and prior owner. A single transaction writes reassignment, audit and idempotency receipt. Lock the shared Sales mode fence before deterministic operator/prospect locks; lock contention is a retryable atomic conflict. Active calls, unsaved wrap-up, incoming routing, unresolved delivery (including paid but unconfirmed delivery), booking reservations, and pending follow-ups block the entire selection. No owner changes on any conflict.

Only `assigned_rep_user_id`, `row_version` and `updated_at` may change. Preserve consent, DNC, status, callbacks, history, payment, readiness, provider state, test-phone originals and source evidence. Existing suppression triggers must not silently reconcile protected fields during assignment. Prior reps lose prospect mutation access immediately; historical call reads remain available, while old-call outcome/checkout/booking writes and incoming matching recheck current ownership transactionally. PATCH/DELETE/notes/demo requests likewise cannot use a pre-transfer ownership check after reassignment commits.

Regression mapping: `scripts/validate-sales-assignment.mjs` covers listing/selection scope, target and role checks, preserved state, transaction rollback, audited receipts, historical writes and conflicts. Its `--postgres` mode proves native concurrent assignment/call/match/edit/delete/note/demo serialization. `scripts/test-sales-assignment-browser.mjs` covers the admin selection, filtering, global-sort requests, submit/reload/errors and stale-response behavior with mocked APIs only.

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
- **Phase stepper** in the call panel header: Dial → Talk → Demo → Close. Done = green check, current = filled, pending = outline. All four stages are always clickable to view their scripts and panels; selection does not change call state. Keep actual call progress visually marked and expose the viewed stage separately. Call controls remain tied to live call state. Text / Email signup selection and delivery are available in every phase for a selected prospect. Without an associated call, the rep must confirm the exact recipient/channel before a genuine prospect checkout request; cancel sends nothing. Keep recipient, busy, live paid-customer and server safeguards. Setup booking remains disabled until wrap-up. This November 8 owner clarification supersedes the November 7 signup gate. Actual phase changes or switching calls/prospects return the view to the current stage; ordinary polling preserves the selected view.
- Buttons are real `<button>`s; the primary action is one big button whose label changes with state. End call is always reachable, never the big one.

## Part 2 — Prospect panel

- Eyebrow: `Current prospect · attempt N` + **Remove from list** button (Part 5).
- Business name; contact name · role.
- **Numbers:** every number on the record, labeled (Cell, Shop, …), each dialable; right-align each number and its label and note. When connected, mark the connected number "on this line". Order: the number with the best history first (last connected → cell → shop). A note like "Rosa screens" next to a number comes from the last call's note field for that number.
- Chips: metro; website (external link); pitch flags from list research (e.g. "No after-hours coverage listed").
- List research (2026-10-28): CSV `ID` maps to the existing source ID (`external_ref`), which matches repeat imports. Preserve `City` separately from metro, plus `Region`, `AfterHoursClass`, `PostedHours`, `CallOpenerHook`, and `Notes`. Store the research fields in prospect metadata; `researchNotes` is separate from timestamped call notes. Admins can add/edit/view these fields and export them. Changing source ID changes the repeat-import match key and rejects a duplicate ID. An import reusing an ID with a different normalized phone or a conflicting supplied website is rejected for that row without changing the existing prospect or its history; use a unique source ID or review the existing record. Omitted research fields on partial edits or re-imports preserve stored values; explicitly blank fields clear them.
- Caller workspace shows city/region; the current prospect card omits the suggested opener and **List research** disclosure. Research remains rep preparation, never verified receptionist facts or calling-window configuration. Keep the existing `core_facts` source unchanged. Import continues to require an explicit permission mapping and timezone under the blocking policy; these research columns never imply call/email permission.
- **Notes** (READY) / **History** (TALK, DEMO): last attempt (date, time, outcome), best time (from notes), last note.
- **This call** (WRAPUP): length, demo length, your notes, transcript status, recording link. History moves below it.
- **Company at a glance** (owner-approved 2026-10-28 replacement of the rep-only facts panel): an AI-generated brief from the website download already used to prepare the Sales demo. Show **What makes them stand out** (1–2 factual sentences; omit when unsupported), **Main services** (3–5 plain-language services), and **Why customers call** (one sentence of typical needs). Keep the brief concise, with no minimum word count and at most 100 words total (owner-requested change, 2026-11-09). Receptionist `core_facts`, suggested demo questions, prompts and call behavior remain unchanged.
- Persist the brief separately as `demo_bundle_json.company_brief`; render saved content without inference. Generation uses the existing structured Responses helper, with page URLs and literal supporting quotes, and no heuristic or template summary fallback. New Sales preparations retain downloaded page lines separately from bounded AI evidence in `scrape_pages_json`.
- **2026-11-09 citation representation change:** supersede model-copied URL/quote generation with `{text,evidenceId}`. The server partitions the existing budgeted evidence into nonoverlapping contiguous passages of at most 1,000 characters, retaining exact words, punctuation and encoded entities. It prefers sentence/word boundaries, marks clipped context explicitly, and never crosses source pages or the budgeter’s omitted-middle separator. These are bounded transport excerpts, not independent facts or new knowledge artifacts; the AI must select one passage supporting its whole claim and must not treat a clipped fragment as a complete assertion. No evidence text is duplicated or expanded beyond the existing evidence budget.
- A generation-only strict schema enumerates snapshot-bound passage IDs once through a shared definition. IDs bind source hash, page identity, offset and literal text; unknown, altered or stale IDs and model-supplied URL/quote overrides fail closed. The server resolves selected IDs to `{text,sourceUrl,quote}` and applies the existing stored schema, quote/source checks, section counts, word limits and duplicate checks. Existing ready briefs remain readable. This removes quote-copying failures; it does not prove semantic entailment of AI prose or substitute a heuristic summary. Preserve model selection, single attempt, output cap, cancellation, leases and publication boundaries.
- Brief requests retain the configured model and use `minimal` reasoning for original `gpt-5`, `gpt-5-mini`, and `gpt-5-nano` names and dated snapshots, which reject `none`. Other models and shared-helper callers retain their existing defaults; compatibility does not change evidence, validation, timeout or retry limits.
- Existing ready demos expose **Generate brief**, which reuses their saved website evidence without recrawling, modifying the tenant, or replacing the demo. Older Sales captures retain only title/description/headings/excerpts; if they cannot support the required services and summary, show unavailable. Pending generation has an exclusive, recoverable lease; retries cannot overwrite a newer capture or changed website. Ready briefs are reused. Brief failures do not change demo readiness.
- Each new brief attempt records a server-generated `attemptRef` and ISO `generatedAt` timestamp in the existing JSON. Unavailable results preserve existing status/reason contracts and add an allowlisted `diagnostic` with code, stage and optional numeric counts, validation paths, HTTP status, known provider error code or known request parameter. The screen shows a curated explanation and reference even when the endpoint returns HTTP 200, and retains them on reload. Legacy failures remain retryable without fabricated diagnostics. Request failures show safe session/access/retry guidance; they do not imply generation finished.
- Failure categories distinguish model timeout/network/provider rejection, incomplete or malformed/schema-invalid output, unsupported quotations, word count, duplicate services, insufficient evidence and unexpected runner errors. Keep all existing evidence budgets, quote checks, service counts, word limits, source guards and AI-only generation rules. Log `sales_company_brief_failed` only after the guarded write succeeds, with the matching reference and safe fields. A superseded attempt does not emit a current failure event. Logger failure cannot prevent the saved result from reaching the caller. Never persist or log raw exceptions, stacks, prompts, provider bodies, model output, quoted evidence, claim text, credentials or contact details in diagnostics.

### Company brief requirement mapping

This is a Sales presentation artifact, not a receptionist knowledge card or published tenant build. It changes no frozen requirement text, source authority, tenant override, or publication contract.

| Preserved requirement | Implementation boundary | Regression |
|---|---|---|
| REQ-PIPE-005, REQ-PIPE-006 | `prepareSalesDemoProfile` retains Sales download page lines/headings; `companyBriefEvidence` budgets a copy only. | `validate-sales-company-brief.mjs`: unchanged stored evidence, legacy capture support, input immutability. |
| REQ-KNOW-007, REQ-PIPE-009 | Separate brief has a source hash and AI-written claims with server-resolved page URLs and literal supporting quotations. Generation-only passage IDs preserve the stored v1 contract and do not substitute for canonical source refs. Safe diagnostic codes identify rejected output without retaining it. | Actual helper request schema/enum checks; unknown/altered/stale ID and URL/quote override rejection; source isolation; exact entity/punctuation hydration; bounded nonoverlapping passages and omitted-middle separation; schema/length/duplicate failure categorization and source/secret redaction. Explicit semantic-entailment limitation fixture. |
| REQ-RULE-001, REQ-RULE-012 | Sales website brief never enters receptionist facts/prompts, overrides, or authority evaluation; prompt excludes unsupported marketing superiority. | Original `core_facts` and remaining demo bundle stay byte-equivalent across enrichment. |
| REQ-PIPE-016 | Generating a brief touches only the Sales profile JSON field; tenant build publication and demo readiness remain unchanged. Diagnostics are an observational extension of that rep-only JSON. | Failure/retry, diagnostic persistence/reload, logger failure, exclusive lease, superseded-runner/log suppression, stale capture, changed website and ready-reuse regressions; controller HTTP 200 failure/pending/retry UI. |

## Part 3 — Call panel by state

### READY (`01-ready.html`)
- Primary: `Call cell · <number>` (green). Secondary: `Call shop · <number>` (green outline). Tertiary, right-aligned: `Skip for now` → moves the prospect to the end of today's queue, no attempt logged.
- Script card: **Opener** · **If he's interested** (+ "then press Start demo") · **If voicemail** (uses first name; voicemail is left manually — no voicemail drop).
- Footer outcomes disabled; Remove from list on the card still works.

### TALK (`02-talk.html`)
- Entered when the far end answers. Call timer starts; status pill names the connected number.
- Primary: `Start demo — hand to the AI Receptionist` (amber). Secondary: `Mute`. `End call` (red outline, right-aligned).
- Script card: discovery questions · **The hand-off** — exact copy: *"I can show you in about two minutes. I'll put our AI receptionist on — she already knows everything from the main pages of your website. Ask her anything a customer would ask your receptionist."* · two objection responses side by side · **No time right now** (→ set Call back ▾ while he's on the line) · **You got the dispatcher** (note name + best time).
- **Notes textarea** ("Notes — carry into the wrap-up"): one shared field below all stage and prospect content, available in Dial, Talk, Demo and Close, persisting through wrap-up. It starts 150px tall and can be resized vertically.

### DEMO (`03-demo.html`)
- Start demo: conference the temp-tenant receptionist leg in, mute the rep's mic, start the demo timer in the status pill.
- Primary: `End demo — put me back on` (amber): drop the receptionist leg, unmute the rep, return to TALK (post-demo). Secondary: `Unmute me` (override while the demo runs; toggles). `End call`.
- **While you listen** card: **If he stalls, unmute and suggest one** — chips generated from the by-heart facts (Part 7), with the after-hours ask styled as the pitch · **When he's heard enough** exit line.
- No live transcript (not available during the call). Caption: "Transcript arrives after the call."

### WRAPUP (`04-wrapup.html`)
- Entered on End call (either side hangs up). Status pill `Call ended · m:ss`.
- Two close cards side by side:
  1. **Send the checkout link** — Text / Email toggle, also available by opening Close before wrap-up. "Text to" defaults to the cell on record; hint when none. `Send link` is available before, during and after calling. Before an associated call exists, confirm with the rep and use a prospect checkout context; never create a synthetic call. `Send link` → Stripe Checkout session ($100 setup, first month included) → SMS via Telnyx or email → outcome auto-set to Link sent → send logged on the checkout and on an associated real call when present. Test links remain isolated from real outcomes/payment. Channel choice and sending never change the actual call phase.
  2. **Book 15 minutes with Jon** — slot pills from a live Outlook calendar read (next 4 open 15-minute slots + More…); `Invite to` = owner email; `Book <slot>` → calendar event with the prospect as attendee. Event body: business, contact, numbers, paid/unpaid at booking time, link to the call record.
- **Script · Close** card, plus the one-line decline fallback ("Jon can take it at the start of your setup call").
- Left panel **This call**: length, demo length, your notes, "Transcript — processing" until it lands, Recording link.

## Part 4 — Notes and outcomes (inline, every dialer state)

- Buttons, in order: `No answer` · `Voicemail` · `Call back ▾` · `Not interested` · `Do not call ▾` · `Demo done` · `Link sent` · `Paid — set by Stripe` (display only, dashed, never clickable). `Save & next →` follows the outcome controls. All controls sit directly below the shared Notes textarea in one section at the bottom of the Dial/Talk/Demo/Close column, after all stage content. No separate “Note for next time” input or fixed/sticky viewport footer remains; the section scrolls with the content on desktop and mobile. Contacts is excluded.
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

1. READY → Call cell → no answer → `No answer` → next prospect loads. Three clicks, no dropdown; inline outcomes may require scrolling.
2. TALK → Start demo mutes the rep and adds the receptionist leg; End demo drops the leg and unmutes; the status pill reflects each change; Unmute override works mid-demo.
3. Notes typed in any stage persist across Dial, Talk, Demo and Close, remain editable in WRAPUP and are submitted with Save & next.
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

## November 8 signup availability and test checkout supersession

The owner explicitly authorized sending signup links before the first call, with a confirmation to the Sales rep, and sending Stripe **TEST** checkout links in phone test mode with **no real charge**. These requirements supersede the November 7 signup wrap-up gate and only the checkout prohibition in SALES-PHONE-TEST-006 above. Original booking, inbound, suppression, source/knowledge and publication requirements remain in force.

| Requirement | Behavior | Regression |
| --- | --- | --- |
| SALES-CHECKOUT-001 | Text/Email can be selected in every phase. Send from a selected prospect before a call, or from the real call during/after it. Booking remains wrap-up-only. No artificial call or dial count. | Dialer screen/controller; Sales v2 SQL |
| SALES-CHECKOUT-002 | Without a current call, show channel and exact destination in a rep confirmation. Cancel makes no request; confirm submits once while busy. Server requires confirmation, expected live/test mode and exact recipient, rejects stale mode/phone changes before effects, and separates idempotency receipts by mode. | Controller cancel/confirm/dedupe; API auth; mode/recipient mismatch SQL |
| SALES-CHECKOUT-003 | Reserve checkout under mode/current-owner locks and original-identity DNC/permission/recipient guards. Reuse existing same-prospect/same-mode checkout across standalone and later calls; preserve immutable Stripe metadata association, delivery idempotency and uncertainty fences. | Standalone→call and call A→standalone→call B; stale DNC registry; pending assignment/mode change |
| SALES-CHECKOUT-004 | Verified live Stripe events strictly match checkout, prospect, nullable call identity, amount/currency and live mode. Only live payment sets Paid and queues existing activation. Standalone live payments count once in the rep's Paid metric without adding a call. | Nullable webhook mismatch/replay; Paid counters |
| SALES-CHECKOUT-005 | Test identity is immutable in the database. Stripe creation requires a separate test key and livemode=false. Test SMS goes only to the fixed test cell; test email goes to authenticated rep email or explicit deployment override. Display the exact destination and no-charge test label. Test calls remain test after restore. | Provider-stub test credential/mode/recipient checks; controller test labels/destinations; SQL mode constraint |
| SALES-CHECKOUT-006 | A dedicated test-signature endpoint validates strict test identity and records test completion only. Test rows cannot acquire paid_at, tenant_key or activation state. No real paid status, real call outcome, Paid counter, conversion or build changes. Paid customers may exercise test checkout safely. | Signed test webhook tamper/wrong key/mode/identity/replay; database isolation and counters |

`0058_sales_prospect_checkout.sql` permits nullable call context, adds immutable `is_test`, and permits one standalone checkout per prospect/mode while retaining existing per-call uniqueness. Old call-bound rows backfill as live. Apply the reviewed migration before application deployment; runtime readiness never applies it. Production rollout uses the maintenance/drain/suspend procedure in the Runbook. The activation/build/publication pipeline is unchanged.

## November 8 disabled-control explanations

This owner-requested UI addition explains existing Sales workspace restrictions. It does not change calling, consent, contact ownership, phone test, checkout/payment, setup booking, or provider authorization rules.

| Requirement | Behavior and implementation | Regression |
| --- | --- | --- |
| SALES-UI-DISABLED-001 | Every rendered disabled control in the `/sales` caller, Contacts, Add prospect, callback picker, script editor, login and sign-out has a specific explanation on hover and keyboard focus. Multiple applicable blockers may be shown. Dialing uses the server's exact `callBlockedReason`, including calling-window details, without inferring local policy. | `test-sales-dialer-browser.mjs`: calling window, browser readiness, active call, demo readiness, busy and phone test restrictions; contact loading/pagination and form saving |
| SALES-UI-DISABLED-002 | Native disabled attributes, fieldset inheritance and existing predicates/handlers remain authoritative. Setup children explain the inherited call-phase restriction alongside missing slot/email requirements. Read-only checkout destinations explain their fixed recipient while retaining native focus and text selection. | Native disabled assertions, disabled keyboard activation has no effect, inherited fieldset slot/input checks, live paid/test checkout and recipient checks |
| SALES-UI-DISABLED-003 | Disabled wrappers are keyboard-focusable and linked to descriptions. Tooltips support Escape, persistent hover/focus and movement onto the tooltip; portals stay within the viewport above scrolling cards and inline actions. Enabled controls remove disabled explanations. | Hover/focus, description linkage, Escape without focus movement, hover after blur, reason removal, mobile bounds and existing 8-state × 4-viewport layout checks |

Implementation is scoped to `DisabledHint`, the caller's local `Button`, and explicit controls in the listed screens; unrelated admin management controls are unchanged. No provider-backed actions are exercised by these local browser fixtures.

## 2026-11-09 — Shared inline notes and outcomes

| Requirement | Behavior | Regression evidence |
| --- | --- | --- |
| SALES-UI-NOTES-001 | One Notes textarea and all outcome/Save actions follow all stage content inside the Dial/Talk/Demo/Close column in normal scroll flow across Dial, Talk, Demo, Close and wrap-up; no viewport footer or duplicate note input. Notes default to 150px tall. Contacts remains separate. | `test-sales-dialer-browser.mjs`: 8 states × 4 viewport layout checks, stage browsing, scroll reachability and note persistence. |
| SALES-UI-NOTES-002 | Retain the existing shared note state and save handler, including interrupted-call wrap-up drafts and live-note persistence. | `test-sales-dialer-browser.mjs`: notes through demo/wrap-up and saved payload; `test-sales-dialer-controller.mjs`: original draft restoration and outcome payload. |

## 2026-11-10 — Saved note history

| ID | Requirement | Validation |
| --- | --- | --- |
| SALES-UI-NOTES-003 | The company Notes/History card displays every nonempty saved call note and company note, newest first, with a short date label. Call notes use the outcome entry time, falling back to the call start/creation time for legacy records. Preserve line breaks; undated legacy prospect notes show “Undated”; avoid repeating a projected last note or a call-linked mirrored company note. Keep compact call attempts, best time and return message. | `test-sales-note-history.mjs`; `test-sales-dialer-browser.mjs`: complete history beyond 100 entries, date order differing from call order, multiline text, blanks, legacy dates, projected duplicates, and selected company browsing. |
| SALES-UI-NOTES-004 | Queue and selected Contacts detail loads provide complete lightweight saved-note history under their existing company/operator scopes. Keep full call/transcript history bounded to its existing 100 rows. Contacts detail call records normalize into the same history display as queue records. | `test-sales-note-history.mjs`: repository DTO and normalizer checks for both administrator and operator queries. |


## 2026-11-10 — Close cards and editable signup text recipient

The owner requested oldest-first saved notes, an introduction-email card after Signup link and Setup call, and an editable signup Text to destination. This supersedes only the newest-first ordering in SALES-UI-NOTES-003 and the saved-cell-only SMS wording in the Close/integration sections above. Preserve their historical requirement text. No schema, pricing, payment, consent, production activation or knowledge publication change is authorized.

| ID | Requirement | Regression |
| --- | --- | --- |
| SALES-UI-NOTES-005 | Sort dated saved notes by entry date/time ascending, oldest first. Keep undated legacy notes at the end, retaining deterministic source order for ties and undated items. Preserve complete history, dates, scopes and duplicate handling from SALES-UI-NOTES-003–004. | `test-sales-note-history.mjs`; `test-sales-dialer-browser.mjs` |
| SALES-CLOSE-001 | Close contains 1 Signup link, 2 Setup call, then 3 Introduction email. Put Send email in the third card, explaining the editable introduction to the selected contact and replies to the rep. Preserve existing modal and all sending gates. | `test-sales-dialer-browser.mjs`; existing introduction-email/controller suites |
| SALES-CHECKOUT-007 | Before live checkout reservation, Text to defaults to the selected contact cell but accepts a different valid mobile destination, including when no cell is saved. Normalize conventional phone formatting; reject malformed input. Submit that destination through both checkout routes and deliver to it. Reset the draft across company/contact/call changes. An override changes this checkout only, not saved contact phone data. | `test-sales-prospect-checkout.mjs`; browser/controller fixtures |
| SALES-CHECKOUT-008 | Validate selected company/contact/version and any supplied number ID under existing locks. Bind a saved number ID only to its exact phone; manual destinations retain no number ID. Reserve actual recipient and phone snapshot in existing columns; preserve company/mode reservation, original recipient retries, at-most-once delivery and uncertainty fences, suppression/recipient DNC, permissions, quiet hours and call scopes. Test destinations remain fixed and uneditable; alternate test phones fail closed. | `test-sales-prospect-checkout.mjs`; `test-sales-dialer-controller.mjs` |


## November 10 — Ram’s dispositions and adjustable signup charge

Owner requested eight visible disposition buttons: Reached voicemail — no opportunity to leave message; Left voicemail; Bad number; DND; Potential (opportunity but not now); Prospect (interested); Customer; Follow up. The owner explicitly confirmed DND permanently blocks calls and an editable signup charge of $1 and up. This supersedes the earlier single-selection footer/button presentation and fixed $100 charge for newly reserved signup links; existing outcomes and reserved links retain their historical meaning.

| Requirement | Behavior | Regression evidence |
| --- | --- | --- |
| SALES-DISPOSITION-001 | Allow one or more of Ram’s eight buttons to toggle independently, retain the full normalized selection on the call, and require explicit Save & next. Preserve selections and notes across stage browsing and interrupted wrap-up. Historical scalar outcomes remain readable. | Disposition, browser and real-controller fixtures. |
| SALES-DISPOSITION-002 | Preserve a legacy scalar outcome for existing queues, jobs and reports. Both voicemail labels map to voicemail; Potential, Prospect and Customer map to connected_no_demo. Follow up maps to callback_requested; DND to do_not_call; Bad number to wrong_number. Permanent suppression takes precedence over callback scheduling, followed by Customer, Prospect and Potential. Retain all chosen labels even when a higher-priority workflow applies. | Outcome repository and callback/DNC regressions. |
| SALES-DISPOSITION-003 | DND and Bad number retain existing permanent company suppression and retained-identity DNC behavior. Follow up requires a callback date/time unless a permanent suppression selection overrides it. Customer is a sales disposition and cannot grant Paid, activation, payment or knowledge publication. Test call dispositions do not alter real company eligibility or create follow-up work. | Transactional suppression, callback, test isolation and Stripe authority fixtures. |
| SALES-DISPOSITION-004 | Approved November 11 extension: add exact visible labels Not Interested, Hang Up and No Answer while retaining all eight original labels, independent multi-selection and explicit Save. Reuse not_interested and no_answer historical meanings; store hang_up in call metadata.dispositions and derive connected_no_demo. Hang Up is a saved disposition only and invokes no telephony action. Not Interested retains permanent suppression ahead of Follow up; DND and Bad number still take priority. | `validate-sales-dialer-v2.mjs`: metadata persistence, mapping and suppression priority; `test-sales-dialer-browser.mjs`: coexistence, independent toggling, explicit save and no call action. |
| SALES-DISPOSITION-005 | Approved November 11 follow-up: add Dead Air and Left Message alongside the existing disposition buttons, for thirteen unique visible labels. The owner corrected the request after refreshing: do not duplicate existing Hang Up or Not Interested. Persist dead_air and left_message independently from all existing tags, including voicemail_left. Either new tag alone derives connected_no_demo and keeps its ordinary saved-outcome workflow; existing selections retain their scalar priority, suppression and callback behavior. Neither new tag ends a call, saves automatically, grants Paid or clears existing suppression. Preserve both tags in history and interrupted wrap-up drafts. | `validate-sales-dialer-v2.mjs`: distinct persistence/history, neutral mapping, callback and suppression priority; browser/controller/call-record fixtures: unique labels, independent toggles, explicit save, no call action and restored drafts/history. |
| SALES-CHECKOUT-009 | A rep may edit a new signup charge in USD, default $100, minimum $1, to cent precision. Validate exact integer cents server-side and enforce the application ceiling of $999,999.99. Display the chosen price in checkout copy and confirmation. Reset unreserved price drafts when delivery identity changes. | Price input, payload and boundary fixtures. |
| SALES-CHECKOUT-010 | Reserve the exact charge with the checkout identity before provider work; retries, existing links and changed UI values cannot alter it. Historical links remain $100. Database constraints and an immutable amount guard protect the reserved value. Stripe creation uses this amount, and payment webhooks validate it along with existing identity, currency and mode checks. Preserve test-only completion and all recipient/provider uncertainty fences. | SQL amount constraints, exact Stripe payload, webhook mismatch/replay and immutable-retry fixtures. |
| SALES-CHECKOUT-011 | For a new live custom-price reservation, verify the existing Stripe account has an enabled live endpoint at the exact canonical HTTPS webhook URL, subscribed to both supported Checkout completion events or all events. Use bounded endpoint pagination and an actual SDK timeout with retries disabled, outside database locks. Under reservation locks, require successful readiness only for a new non-$100 live row. Lookup failure cannot break existing links/retries or default-$100 checkout. Never expose provider credentials or endpoint objects. The owner requested live pricing only for now: new custom test reservations remain unavailable, while historical test reservations retain their frozen amount. | `test-sales-checkout-readiness.mjs`; Sales v2 provider/race fixtures |

**Approved disposition supersession, November 11:** SALES-DISPOSITION-004 expands the eight-label presentation in SALES-DISPOSITION-001 to eleven labels. Original requirements above remain historical text; all other selection, save and workflow rules remain in force.

**Approved follow-up supersession, November 11:** SALES-DISPOSITION-005 expands the eleven-label presentation to thirteen unique labels. It preserves the existing Hang Up and Not Interested identities and behavior; no duplicate buttons or replacement meanings are introduced.

**Approved UI supersession, November 10:** The owner's later clarification limits new UI selections to $100 standard signup and $1 live test (a real charge that activates signup when paid). This supersedes only SALES-CHECKOUT-009's free-entry control; retain its original text above, server amount validation/API compatibility, default/reset behavior and exact frozen historical amounts. The disabled selector displays a nonpreset historical amount unchanged. Test-mode new checkout remains $100. `DialerScreen.jsx`, `test-sales-dialer-browser.mjs` and `test-sales-dialer-controller.mjs` cover two-option selection, $1 confirmation/payload, locked gates and a historical $12.34 reservation.

**URL-semantics correction, November 10:** Production inspection proved the existing enabled live endpoint has the exact canonical HTTPS origin/path and both events, plus a query string unused by the signature-verified handler. SALES-CHECKOUT-011 now compares parsed origin and exact pathname, preserving that query rather than requiring byte-equal URL text. Reject userinfo, fragments and decoded case-insensitive deployment-routing keys (`dpl`, plus defensive `__vdpl`, `x-deployment-id`, `__deployment` and `__next*` aliases). All other requirements stay in force; no alternate host, rewrite path or event relaxation is introduced. `test-sales-checkout-readiness.mjs` covers query compatibility/redaction, routing-pin rejection and unchanged bounds. `test-sales-prospect-checkout.mjs` proves a query-bearing endpoint creates an exact $1 fixture checkout and that a pinned endpoint creates no reservation or provider effect.

EveryCall retains a conservative application ceiling of $999,999.99 and the owner-authorized $1 minimum. Stripe card-payment limits vary by network; the eight-digit USD limit in its current documentation applies to other payment methods. See [Stripe’s currency and charge limits](https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts). Migration 0061 and its exact rollout must pass independent critical review before application. The migration also adds a default-false custom-pricing gate. While disabled, new non-$100 reservations are rejected before provider work and the price control remains fixed at $100. Deploy the amount-aware checkout and webhook code first, verify the canonical production alias, and activate custom pricing only after old checkout invocations have retired. Existing custom reservations and payment validation retain their frozen amount regardless of gate state. Once custom-price links exist, rollback must retain amount-aware checkout and webhook handlers until those links and provider events are safely resolved.

## Admin sales call report (2026-11-13)

| ID | Requirement | Regression evidence |
| --- | --- | --- |
| SALES-REPORT-001 | Operations → Sales → Rep reporting gives platform admins access to every Sales call session through stable newest-first pagination, including historical date windows and All time. Sales-role sessions cannot read reports, CSV exports, or transcripts. Preserve the existing reporting response fields and admin boundary. | Sales auth and reporting API fixtures. |
| SALES-REPORT-002 | Filter UTC creation-date cohorts by rep, direction, live/test mode, recorded outcome, call state, and business/contact/number/call-ID search. Default to 30 days, all directions, and live calls only. Label inbound caller numbers separately from outbound dialed numbers. All-time charts use monthly UTC buckets; bounded date ranges use daily buckets. Aggregates and charts cover the complete matching cohort, never only the visible page. | Reporting fixture: UTC, test segregation, direction/number semantics, full aggregates and microsecond/tied-time pagination. |
| SALES-REPORT-003 | Show call identifiers, rep/current business context, dial-time contact snapshot, state, AI state, selected dispositions, notes, saved timestamps, and elapsed session/connected/demo durations. Missing or unfinished durations remain absent and are excluded from averages. Expand a call to read stored transcript text. Show recording availability without publishing recording URLs. Use an explicit safe field contract; exclude arbitrary metadata, private phone backups, provider payloads, credentials, control tokens and raw provider errors. | Safe-field/transcript and duration regressions; real component browser fixture. |
| SALES-REPORT-004 | Provide activity over time, rep session/connection/demo comparison, outcome distribution, and connected-duration distribution with readable data and metric definitions. Sessions can include attempts before dialing; timestamp-based connected/demo counts and recorded outcomes must not imply verified revenue or conversion. | Aggregate fixture and accessible desktop/mobile browser checks. |
| SALES-REPORT-005 | Export every filtered call field and note as CSV, independent of visible pagination, up to 2,000 matching rows. Refuse larger exports with clear narrowing guidance; never silently truncate. Escape quotes/newlines and neutralize spreadsheet formulas. Transcripts remain available in expanded details rather than CSV. Report, transcript and export responses use private no-store caching. | API export bounds, formula/escaping and download regressions. |
| SALES-REPORT-006 | Add a UTC daily session timeline with every day in the applied date window selectable, including empty days. All time derives day bounds from actual matching session history. Preserve all non-date filters; select sessions by overlap with the chosen day, including sessions created before the range, rather than the table's creation cohort. Keep day selection and complete daily data independent of table pagination. Show separate rep lanes with actual recorded start/end intervals clipped at midnight; creation-only/missing/invalid durations remain distinct points, never invented talk time. Compute end-to-next-start gaps using the per-rep maximum end frontier across overlaps; highlight gaps ≥5 minutes and expose smaller gaps and exact UTC timestamps accessibly. Suppress uncertain gaps after unresolved timing and do not attribute combined unassigned calls to one rep. A prior terminal session whose persisted update proves closure before the day need not invalidate that day, but its duration remains unknown. Never imply a recorded gap proves a break. Provide activity fitting and 5-minute detail scrolling. Bound each day to 10,000 sessions with explicit refusal, preserving the admin guard and private no-store response. | `test-sales-report-timeline.mjs` real-handler/PGlite and interval checks; `test-sales-report-browser.mjs` day selection, races, pagination independence, accessible data and desktop/mobile. |


### SALES-REPORT-006 correction — Pacific timeline and observed gaps (2026-11-13)

The owner requested Pacific time and correction of excessive gold areas. This explicitly supersedes only the UTC timeline portions of SALES-REPORT-006 above; its original text is retained. The timeline day selector, overlap boundaries, axis, tooltips, summaries and exact data use `America/Los_Angeles`, with PST/PDT labels and independently resolved local midnights for 23/25-hour DST days. All-time day bounds derive from Pacific session dates. Applied date strings select Pacific calendar days for this graph; other charts, creation-cohort table and CSV retain UTC semantics.

Only observed sessions overlapping the selected day establish the rep's gap frontier. A prior-day ending cannot create a leading midnight-to-first-call gap, and no trailing gap is inferred. Keep unresolved prior timing suppression and maximum end frontiers across overlaps. Show actual internal gaps ≥5 minutes with pale fill, a thin amber indicator and explicit duration; preserve long real gaps and smaller gap data without capping. Filters can hide other calls, so gaps remain between matching calls, never confirmed breaks. Implementation: `getSalesReportDay`, `salesReportTimeline`, `SalesDayTimeline`; regressions: `test-sales-report-timeline.mjs` (Pacific boundaries/DST, leading-gap exclusion and internal-gap preservation), `test-sales-report-browser.mjs` (Pacific labels, subtle gap styling, responsive exact data), and unchanged main reporting tests.

### SALES-REPORT-006 supersession — Telnyx source and coverage (2026-11-13)

The owner explicitly requested replacing the daily graph's internal session timing with Telnyx records. This supersedes the source and creation-only fallback portions of SALES-REPORT-006 and its corrections above; retain their original text. Main report charts, table and CSV remain EveryCall session records with UTC semantics. No lifecycle, schema or authorization changes are authorized by this requirement.

The daily API reads Telnyx `GET /v2/detail_records`, `filter[record_type]=call-control`, with Pacific-day `started_at` bounds and a second query for completed records crossing midnight (`started_at < dayStart`, `finished_at > dayStart`). Bars use only provider `started_at` / `finished_at`. Local history supplies day-selection bounds, filters, business details and rep attribution, never replacement clock values. Require the configured Sales call-control application ID for provider queries and exclude other connections before role/identity attribution; include the application ID in cache keys. Join exact `telnyx_leg_id` / saved prospect leg or exact `telnyx_session_id` / saved prospect session across history before filters. Reject conflicting/multiply assigned identities and directions; exclude known operator and AI legs/sessions. A unique Sales session can own multiple related provider records: preserve each record and its lineage, flag prospect-leg ambiguity, and do not count them as additional Sales sessions. Never match by phone number or approximate time. Unmatched inbound records are not attributed to a rep.

Expose source, original retrieval time, provider IDs, match method, returned-page coverage, related/ambiguous/unmatched records, excluded operator/AI counts and local sessions without a match. A successful paginated read is not proof that every call was captured. Current-day/ongoing records may not yet be present; the referenced endpoint does not establish a guaranteed finalization delay or retention window. Do not invent either guarantee. Missing credentials, timeouts, rate limits, malformed/changing/repeated pages and page bounds produce explicit unavailable/partial states, never internal-time fallback. An unavailable read returns 503 so an older open client cannot present it as an empty day. Suppress interval estimates for current-day data, partial retrieval, missing/ambiguous/unmatched records, invalid timing and prior unresolved local sessions. Also send legacy-compatible `prior.uncertain` per rep so older clients honor that fence. Even allowed intervals describe only returned filtered records, never inactivity or breaks.

Bound requests to 50 rows/page, 40 total pages, 6 seconds/request and 20 seconds/read; reject oversized bodies above 2 MiB/page. Use only the existing server-side `SALES_TELNYX_API_KEY` and required `SALES_TELNYX_CALL_CONTROL_APP_ID` from the Sales gateway, GET requests to the fixed Telnyx host, no redirects or provider writes. A bounded 30-second process-local cache coalesces reads, with original `retrievedAt` shown; no provider payloads, phone numbers or secrets enter the browser or logs. Local reconciliation remains capped at 10,000 rows. Requirements map to `salesTelnyxRecords.js`, `getSalesReportDay`, the admin route and `SalesDayTimeline`; regressions are `test-sales-report-timeline.mjs`, the provider-shaped browser fixture, and unchanged `test-sales-reporting.mjs`.
