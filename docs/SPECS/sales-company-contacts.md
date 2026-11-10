# Sales company editing and contacts

Status: Owner requested November 9, 2026; shared company phones and selected-contact delivery defaults explicitly confirmed. This extends the Sales v2 specification and preserves its calling, payment, phone-test, source-authority and publication constraints.

## Behavior and authority

Every Sales company row and Current prospect has an Edit action opening a separate page. Sales reps edit only assigned companies; administrators retain company-management access. Business fields are business name, website, category, competitor, source ID, city, region, metro, after-hours classification, posted hours, opener hook, research notes, pitch flags, timezone and lead-delivery email. Calling/email permissions remain explicit consent fields. Assignment, outcomes, callbacks, removal, permanent suppression, Paid and build/publication state retain their existing workflows.

The company editor presents Business details, Company phone numbers, People at this company, Contact permissions and Company activity as separate tabs. Arrow Left/Right (with wrapping), Home and End select and focus tabs; narrow screens can scroll the tab bar. Panels remain mounted with one shared draft. Save and Cancel apply to the whole company, and save errors remain visible outside the panels. Native validation reveals and focuses the first invalid field even when its tab was inactive.

Each company has at least one active contact and exactly one active default contact. Contacts have optional first/last names, email and editable title suggestions, independent decision-maker/influencer flags, and zero or more typed/labeled phones. Shared company phones coexist with personal phones. At least one active company/contact phone remains required. Removing a contact archives it and its phones; removing the default requires choosing its replacement in the same save. The role flags grant no call or message permission.

The dialer initializes the default contact and allows another active contact before calling. Available phones belong to that contact or are shared company channels. Reservation freezes the chosen person, phone, actual dial destination and test mode. Scripts, current-call context and call history use that snapshot. Old calls lacking a snapshot display **Contact not recorded**. Default changes and later contact edits never rewrite recorded call identity.

Selected contacts provide the initial signup text/email and setup invitation defaults. An existing commercial checkout keeps its original recipient/channel and is reused; this feature does not create additional commercial sessions or a new multi-recipient delivery model. Booking reservations retain their attendee/provider payload for retries. Test checkout always uses the designated test recipient and isolated Stripe credentials regardless of selected person.

Changing the default email identity clears the legacy company email-permission flag. Retaining an already checked checkbox is not fresh consent: explicit reconfirmation must bind the exact new default contact ID and normalized email. Existing email suppression is never cleared by switching contacts. Smartlead opt-out matching includes active/archived contacts and their actually observed prior emails; an email edit retains that identity for delayed opt-outs without inventing historical addresses or starting new campaigns.

## API and compatibility contract

GET `/api/v1/admin/sales/prospects/:id` adds `contacts`, `sharedNumbers`, `defaultContactId`, `editCapabilities` and `callbackTarget` to the existing prospect DTO. Contacts use `{id,firstName,lastName,displayName,title,email,notes,decisionMaker,influencer,numbers}`. Numbers use `{id,phoneE164,type,label,isTest}`; types remain `cell`, `shop`, `other`.

PATCH on the same endpoint requires `expectedRowVersion`, allows only editor business/contact fields and always applies the company-editor allowlist even if a client omits `editorMode`. The normal request includes `editorMode:"company_contacts"`, a full active `contacts`/`sharedNumbers` snapshot and `defaultContactId`; omitted existing items are archived. New draft IDs begin `new_` and are mapped to server IDs atomically. `emailPermissionConfirmation:{contactId,email}` binds fresh permission to a changed default email. Unknown/system fields are rejected. Same-request retries use the existing idempotency key. Ownership is rechecked under locks before a receipt can replay.

One transaction covers validation, contact/number changes, default replacement, compatibility projections, version increment, audit and idempotency receipt. The config-mode lock, actor lock and company lock follow existing Sales ordering. Active calls and unresolved incoming/delivery/booking work block company editing with an actionable reason. Calls validate person and number again inside the reservation transaction; same-key retries preserve the original call and reject changed target IDs.

Legacy company name/email/role fields project the default contact. The complete active phone aggregate remains in `numbers_json` for existing clients. Normalized phone writes update that aggregate in the same transaction. Legacy full name, discrepant owner first name and unknown phone JSON attributes remain stored. Old CSV imports update their designated legacy contact additively and preserve additional contacts/default choices. CSV export adds `contacts_json`, `shared_numbers_json`, `default_contact_id`, and `phone_test_mode`; test exports cannot be reimported as real identities.

Callbacks record their selected person/phone snapshot. Archived or changed phone identity requires a new selection; company-only historical callbacks do not invent a historical person. Incoming unique personal numbers can identify a contact, shared numbers identify only the company, and multi-company matches require clarification rather than choosing the most recently edited company.

## Contact notes memo

Owner requested November 10, 2026: every contact in People at this company has a separate Notes memo. Store it as PostgreSQL `TEXT NOT NULL DEFAULT ''` on the contact. The multiline textarea can be resized vertically and has no character limit. Preserve whitespace, Unicode and newlines exactly; no trimming or truncation. The existing request transport size limit still rejects oversized requests explicitly. Existing/new contacts start empty. Explicit `notes:""` clears; omitted notes preserve the existing contact memo for older editor/import clients. Reject non-string or NUL-containing notes explicitly.

Notes are private Sales operator context, independent of company research notes, role/default/phone fields and consent. Phone-test mode permits memo edits under the same metadata rules. Existing assignment, version, idempotency, pending-work, archive and email-consent guards remain authoritative. Legacy CSV/source enrichment preserves memos; full contact CSV includes them. Call, checkout and booking identity/provider snapshots exclude notes. Migration 0062 is an additive constant-default column with a separately reviewed bounded online runner; it does not inherit 0061 pricing activation/drain gates.

## Source-based contact enrichment

Owner-authorized maintenance can add people explicitly named in saved company research or matching website captures. A privately reviewed manifest binds each name and optional title to exact source-path quotations, a source fingerprint and the expected company version. Keep first-name-only people when a surname is not explicit; exclude customers/review authors and uncertain affiliations. Titles must be supported in a name-containing passage. This preserves SALES-CONTACT-002/004/007/008 and does not grant role flags or communication permission.

`scripts/backfill-sales-company-contacts.mjs` defaults to a dry run. Apply adds contacts atomically per company with a system audit receipt, preserves existing contacts/defaults/phones and all protected company fields, and increments the company version only when adding contacts. It rechecks pending work after acquiring the company lock, blocks phone testing/stale evidence or versions, and rolls back unexpected trigger changes. Repeated identical runs reuse audit receipts; partial/fuzzy identities are held for review. No source capture, tenant knowledge or publication changes are part of this operation.

## Migration and phone testing

`0059_sales_company_contacts.sql` adds normalized contact/number tables, deferred same-company default constraints, a retained identity ledger, callback context, immutable call identity protection, and checkout/booking/incoming snapshots. The migration locks the existing Sales config row and rejects active calls, missing or malformed original backups, mode/backup mismatches or inconsistent substituted destinations.

Backfill uses saved real primary/list values whenever phone testing is active. Shop/ambiguous legacy numbers remain shared; explicitly classified cell numbers belong to the legacy contact. Unknown source phone attributes remain in private legacy JSON. Migration and ordinary metadata edits never overwrite the exact saved primary/list backups. Contact/phone additions, archives and phone edits remain blocked while testing; permitted name/title/email/flag edits remain possible. Safe DTOs mask contact/shared/callback destinations with effective test phones and never expose private originals. Call test flags remain immutable after restore.

The retained phone/domain ledger includes recoverable historical non-test call destinations. DNC lookup/registration covers all retained identities, including archived numbers and prior domains, so changing the default, removing a contact or importing a list cannot weaken permanent company suppression.

## Requirement mapping and verification

| ID | Requirement | Implementation | Regression |
|---|---|---|---|
| SALES-CONTACT-001 | Separate full business/contact editor from every company entry point; retain assigned-company authorization. | Sales editor route/components; prospect GET/PATCH and owned mutation wrapper | `test-sales-company-editor-browser.mjs`; `validate-sales-auth.mjs` |
| SALES-CONTACT-002 | Multiple contacts and shared phones, independent role flags, exactly one same-company active default; archive without history loss. | Migration 0059; `salesCompanyContacts.js` | `validate-sales-company-contacts.mjs` on native PostgreSQL |
| SALES-CONTACT-003 | Bind selected contact and phone at reservation and keep immutable identity in calls/history/scripts. | Call reservation, call views and dialer | Native contacts/delivery suites; real controller fixture |
| SALES-CONTACT-004 | Preserve phone-test originals, effective-destination privacy, exact restoration and original-identity DNC. | Migration/preflight, contact guards and serializer, retained identity ledger | Native contacts suite; `validate-sales-phone-test-mode.mjs` |
| SALES-CONTACT-005 | Selected contact initializes first checkout/booking recipient; preserve immutable commercial checkout identity, provider retry payload and test isolation. | Checkout/calendar reservation and UI | `test-sales-contact-delivery.mjs`; existing checkout/auth fixtures |
| SALES-CONTACT-006 | Callback identity changes and ambiguous incoming numbers require explicit selection; no invented historical person. | Callback target serializer; incoming matcher | Native contacts/delivery suites; controller fixture |
| SALES-CONTACT-007 | Preserve legacy/import/source identities and support full contact CSV export without promoting test destinations. | Import/export and compatibility projections | Native contacts suite; Sales database regression |
| SALES-CONTACT-008 | Default email changes do not transfer consent; explicit reconfirmation binds the new email/contact. | Aggregate validation and editor checkbox | Native contacts suite; retained editor browser fixture |
| SALES-CONTACT-009 | Website edits reuse Sales-only invalidation; no tenant knowledge, overrides, source authority, validated publication or paid activation changes. | Existing Sales demo invalidation/preparation path | Native contacts website-stale assertion; existing knowledge inventory validation |
| SALES-CONTACT-010 | Per-contact expandable Notes memo, lossless long text, empty default and explicit clear; old-client/import preservation; existing guards and snapshot privacy. | Migration 0062; contact aggregate/save; shared company form and payload | Native/PGlite contacts; browser editor; delivery/backfill; scoped0062 native migration fixture |

This feature preserves original `SALES-PHONE-TEST-001`–`006` and their explicit checkout supersession, `SALES-CHECKOUT-*`, and `SALES-UI-DISABLED-*`. It does not amend frozen knowledge requirements `REQ-RULE-001`, `REQ-OVR-005`, `REQ-PIPE-003`, `REQ-PIPE-016`, `REQ-OPS-004` or `REQ-OPS-009`: Sales research/contact fields are operator context, tenant overrides retain authority, tenant rebuilds remain manual, and existing validated publication/readiness gates remain authoritative. The frozen inventory is unchanged.
