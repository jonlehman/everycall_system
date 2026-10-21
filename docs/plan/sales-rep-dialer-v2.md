# Sales rep dialer v2 implementation and acceptance

Design: owner-approved October 20, preserved in [the full specification](../SPECS/sales-rep-dialer-v2.md). Baseline: `0694c45`. Implementation and release evidence below must be updated from actual results; design approval does not establish provider acceptance.

## Preserved boundaries

- Sales operators access only their own queue, calls, notes, deliveries, booking requests and incoming-call claims. Administrative scripts remain admin-editable.
- Telnyx controls the conference and provider call state. Browser state cannot authorize another rep's call or manufacture a completed attempt.
- Only a verified, paid Stripe webhook establishes Paid. Payment permits real-tenant conversion and a full build; knowledge review/publication and voice readiness remain separate gates.
- Demo facts, displayed facts and suggested asks share the stored `core_facts` source. Preserve raw captures, tenant corrections, source authority, monetary authorization and the 163 frozen knowledge requirements.
- Keep unrelated worker edits, artifacts and the supplied ZIP outside the release unless a specific reviewed feature patch requires a worker change.

## Defaults

- Remove from list remains distinct from permanent DNC.
- Taking an incoming call replaces the current prospect and restores the interrupted record to the top of the rep's queue.
- Demo done does not invent a callback.
- `REMOVE_PROMPT_AT=4`; removal is never automatic.
- `FULL_BUILD_LEAD_MINUTES=360` is the initial measured production setting. Re-measure after compiler or workload changes.

## Full-build timing measurement

Read-only production measurement on October 20 used 11 completed website-base builds, with 10–138 captured sources. Duration was build creation to the last persisted compiler-stage completion timestamp, including queueing, retries and recovery. Minimum was 2.10 minutes; p95 was 184.73 minutes; maximum was 308.19 minutes. The maximum had 20 execution attempts; the 138-source build took 61.28 minutes with eight attempts. The initial six-hour lead exceeds the longest observed completed build and includes a margin. This is historical end-to-end evidence, not a synthetic 500-page benchmark or an execution-time guarantee. Booking always checks the configured lead against server time and live calendar availability.

## Acceptance ledger

The IDs below map in order to the original 15 acceptance items; their full text remains in the approved specification.

| ID | Acceptance boundary | Evidence |
|---|---|---|
| EC-SALES2-01 | Three-click no-answer disposition and next prospect | Real controller/browser + SQL disposition tests pass; provider no-answer remains a live canary |
| EC-SALES2-02 | Demo conference, automatic mute/unmute and override | Conference command and real controller mute/override tests pass; audible provider check outstanding |
| EC-SALES2-03 | One notes value survives Talk, Demo and Wrapup | Real controller Talk → Demo → Wrapup note persistence passes |
| EC-SALES2-04 | Explicit callbacks rise to the rep's queue when due | PGlite/native PostgreSQL due-callback ordering and future-callback preparation regressions pass |
| EC-SALES2-05 | DNC survives phone/domain re-import | Phone/domain DNC import tests and signed STOP/UNSUBSCRIBE persistence pass |
| EC-SALES2-06 | Removed prospects may enter a later campaign | SQL remove/reimport test passes; distinct removal status retained |
| EC-SALES2-07 | Checkout delivery, webhook Paid and rep rejection | Simulated Stripe/send/webhook, native delayed-response delivery race and real paid activation pass; live delivery/payment outstanding |
| EC-SALES2-08 | Live Outlook slots, lead time and attendee invitation | Graph-provider fixtures cover live-read shape, lead, contention and attendee body; production Microsoft authorization missing |
| EC-SALES2-09 | Matched incoming call swaps prospect and preserves queue | Matched inbound command/controller swap tests pass; owned caller-ID routing configuration pending release |
| EC-SALES2-10 | Unknown incoming call can be answered and added | Two-unknown-caller identity/controller and website preparation tests pass |
| EC-SALES2-11 | Mid-call and unanswered calls reach receptionist and return queue | Branded AI fallback/message tests pass; sparse return and hangup persistence independently checked; audible canary outstanding |
| EC-SALES2-12 | Ready-only rep queue and automatic prep refill | Ready-only ownership, refill and genuinely unprepared replacement tests pass on native PostgreSQL |
| EC-SALES2-13 | End-gated Save & next and asynchronous transcript | Real controller end gate, notes and async artifacts plus read-only record browser tests pass |
| EC-SALES2-14 | Rep-local-day counters and webhook-owned Paid count | SQL local-day counters and verified-webhook Paid authority tests pass |
| EC-SALES2-15 | All states fit 1280×800; panels stack below 900px | Eight fixture states × four widths pass; actual Next1280×800/390 error-banner and auth checks pass |

## Release evidence

Implementation and independent Astra review completed. Review exposed and verified fixes for Stripe delivery races, legitimate paid-build authority, sparse unknown-return queues, future callback preparation, exact public checkout return, permanent signed opt-outs, two unknown caller identity, and read-only call record access.

Local evidence: full existing Sales suite and workspace typecheck pass. Real Next disposable-database QA passes public checkout200/no employee header; protected pages redirect; Sales own GET200/other GET403; admin other GET200/PATCH403; unrelated admin API401; admin and read-only call pages never initialize WebRTC; 1280×800 and390px have no horizontal overflow and no page exceptions. Native PostgreSQL and PGlite pass the new queue/payment tests. Provider calls are simulated in those tests.

Migration0056 was applied alone with an atomic receipt and schema readiness verified against the independently pinned production database. All three old Render services retired before migration. The approved owned Sales number ending0639 now routes to the dedicated Sales application, preserving its SMS profile. Both Sales connection capacity ceilings are20; actual concurrent audible capacity remains untested. Default incoming rep is the existing active Sales user11. Production app deployment and public acceptance follow this stopped transition.

The sole legacy ready demo was named Atlantic Plumbing Demo but pointed to Creative Dynamic's website. That fixture is quarantined as `removed(invalid_demo_fixture)` without DNC or deletion; its record/history remain available for correction. Generic website summaries are excluded from fallback `core_facts`; explicit canonical facts remain untouched. This fixes the misleading business context without inventing a replacement website. No live checkout, prospect SMS/email, calendar invitation or audible call has been performed by these automated checks. Runtime Graph credentials are absent; booking remains explicitly unavailable until the owner authorizes Calendars.ReadWrite for the configured mailbox.
