"use client";

import { useId } from "react";
import { SALES_CONTACT_TITLES, SALES_COMPANY_EDIT_FIELDS, SALES_PHONE_TYPES } from "../../../lib/salesCompanyContacts";
import { DisabledHint, HintButton, HintInput, disabledReasons } from "./DisabledHint";
import styles from "./CompanyContactEditor.module.css";

const TITLES = [...SALES_CONTACT_TITLES, "Dispatcher"];
const BUSINESS_FIELDS = [
  ["businessName", "Business name", 300], ["websiteUrl", "Website", 1000],
  ["businessCategory", "Business category", 160], ["competitorName", "Current provider or competitor", 300],
  ["externalRef", "Source ID", 240], ["city", "City", 120], ["region", "State or region", 160],
  ["metro", "Metro area", 120], ["timezone", "Time zone", 100], ["leadDeliveryEmail", "Lead delivery email", 320, "email"],
  ["afterHoursClass", "After-hours classification", 240], ["postedHours", "Posted business hours", 2000, "textarea"],
  ["callOpenerHook", "Call opener", 4000, "textarea"], ["researchNotes", "Research notes", 8000, "textarea"],
];
export const COMPANY_EDIT_FIELDS = SALES_COMPANY_EDIT_FIELDS;
export function newDraftId() { return `new_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`; }
export function companyDefaultEmail(company) {
  return String(company.contacts?.find((contact) => contact.id === company.defaultContactId)?.email || "").trim().toLowerCase();
}
export function companyEditorNextDraft(previous, next) {
  const email = companyDefaultEmail(next);
  if (companyDefaultEmail(previous) !== email) {
    return { ...next, emailPermission: false, emailPermissionConfirmation: undefined };
  }
  if (!next.emailPermission) return { ...next, emailPermissionConfirmation: undefined };
  if (!previous.emailPermission || previous.emailPermissionConfirmation) {
    return { ...next, emailPermissionConfirmation: { contactId: next.defaultContactId, email } };
  }
  return next;
}
export function companyEditorDraft(prospect) {
  return {
    ...Object.fromEntries(BUSINESS_FIELDS.map(([key]) => [key, prospect[key] ?? ""])),
    pitchFlags: (prospect.pitchFlags || []).join("\n"),
    permissionGranted: Boolean(prospect.permissionGranted), emailPermission: Boolean(prospect.emailPermission),
    contacts: (prospect.contacts || []).map((contact) => ({ ...contact, numbers: (contact.numbers || []).map((number) => ({ ...number })) })),
    sharedNumbers: (prospect.sharedNumbers || []).map((number) => ({ ...number })),
    defaultContactId: prospect.defaultContactId || "",
  };
}
export function companyEditorPayload(draft, rowVersion) {
  return { editorMode: "company_contacts", expectedRowVersion: rowVersion, ...draft,
    pitchFlags: draft.pitchFlags.split("\n").map((flag) => flag.trim()).filter(Boolean),
    contacts: draft.contacts.map(({ id, firstName, lastName, displayName, title, email, decisionMaker, influencer, numbers }) => ({ id, firstName, lastName, displayName, title, email, decisionMaker, influencer, numbers: numbers.map(phonePayload) })),
    sharedNumbers: draft.sharedNumbers.map(phonePayload),
  };
}
function phonePayload({ id, phoneE164, type, label }) { return { id, phoneE164, type, label }; }
function Field({ label, value, onChange, reason, type = "text", ...props }) {
  return <label className={`${styles.field} ${type === "textarea" ? styles.wide : ""}`}><span>{label}</span>
    {type === "textarea" ? <DisabledHint disabled={Boolean(reason)} reason={reason} input><textarea {...props} aria-label={label} className={reason ? styles.lockedControl : ""} value={value} disabled={Boolean(reason)} onChange={(event) => onChange(event.target.value)} /></DisabledHint>
      : <HintInput {...props} aria-label={label} type={type} value={value} disabled={Boolean(reason)} disabledReason={reason} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}
function Check({ label, checked, onChange, reason }) {
  return <label className={styles.check}><HintInput aria-label={label} type="checkbox" checked={checked} disabled={Boolean(reason)} disabledReason={reason} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
function PhoneEditor({ numbers, onChange, reason, label }) {
  return <div className={styles.phones}>
    <div className={styles.sectionHeading}><h3>{label}</h3><HintButton type="button" className={styles.button} disabled={Boolean(reason)} disabledReason={reason} onClick={() => onChange([...numbers, { id: newDraftId(), phoneE164: "", type: "cell", label: "" }])}>Add phone</HintButton></div>
    {!numbers.length && <p className={styles.muted}>No phone numbers added.</p>}
    {numbers.map((number, index) => {
      const update = (key, value) => onChange(numbers.map((item) => item.id === number.id ? { ...item, [key]: value } : item));
      return <div className={styles.phoneRow} key={number.id}>
        <Field label={`Phone ${index + 1}${number.isTest ? " · test destination" : ""}`} type="tel" value={number.phoneE164 || ""} onChange={(value) => update("phoneE164", value)} reason={reason} autoComplete="off" placeholder="+1 503 555 0123" />
        <label className={styles.field}><span>Phone type</span><DisabledHint disabled={Boolean(reason)} reason={reason} input><select aria-label={`Phone ${index + 1} type`} className={reason ? styles.lockedControl : ""} value={number.type || "other"} disabled={Boolean(reason)} onChange={(event) => update("type", event.target.value)}>{SALES_PHONE_TYPES.map((type) => <option key={type} value={type}>{{ cell: "Mobile", shop: "Office / shop", other: "Other" }[type]}</option>)}</select></DisabledHint></label>
        <Field label="Phone label" value={number.label || ""} onChange={(value) => update("label", value)} reason={reason} maxLength={120} placeholder="e.g. Home" />
        <HintButton type="button" className={`${styles.button} ${styles.danger}`} aria-label={`Remove phone ${index + 1}`} disabled={Boolean(reason)} disabledReason={reason} onClick={() => onChange(numbers.filter((item) => item.id !== number.id))}>Remove</HintButton>
      </div>;
    })}
  </div>;
}
export default function CompanyContactForm({ draft, onChange, prospect, saving = false, activeSection, tabPrefix }) {
  const titlesId = useId();
  const panel = (id) => tabPrefix ? { id: `${tabPrefix}-panel-${id}`, role: "tabpanel", "aria-labelledby": `${tabPrefix}-tab-${id}`, tabIndex: 0, hidden: activeSection !== id } : {};
  const capabilities = prospect.editCapabilities || {};
  const reason = disabledReasons(saving && "Wait for this company to finish saving.", capabilities.canEdit !== true && (capabilities.reason || "Company editing is unavailable. Reload the page to check access."));
  const phoneReason = disabledReasons(reason, (prospect.phoneTestMode || capabilities.canEditPhones !== true) && (capabilities.phoneReason || (prospect.phoneTestMode ? "Turn off phone test mode to edit phone numbers." : "Phone number editing is unavailable.")));
  const update = (key, value) => onChange({ ...draft, [key]: value });
  const updateContact = (id, key, value) => update("contacts", draft.contacts.map((contact) => contact.id === id ? { ...contact, [key]: value } : contact));
  const defaultEmail = companyDefaultEmail(draft);
  const changedEmail = defaultEmail !== companyDefaultEmail(prospect);
  return <>
    {reason && <p className={styles.notice} role="status">{reason}</p>}
    {phoneReason && phoneReason !== reason && <p className={styles.notice}> {phoneReason} Contact names, emails, titles, and roles can still be updated.</p>}
    <section className={styles.section} aria-labelledby="company-details-heading" {...panel("details")}><div className={styles.sectionHeading}><div><h2 id="company-details-heading">Business details</h2><p className={styles.muted}>Company information and sales research.</p></div></div>
      <div className={styles.grid}>{BUSINESS_FIELDS.map(([key, label, maxLength, type]) => <Field key={key} label={label} value={draft[key]} onChange={(value) => update(key, value)} maxLength={maxLength} type={type} required={key === "businessName"} reason={reason} />)}
      <Field label="Pitch notes — one per line" type="textarea" value={draft.pitchFlags} onChange={(value) => update("pitchFlags", value)} reason={reason} />
      </div>
    </section>
    <section className={styles.section} aria-labelledby="shared-phones-heading" {...panel("phones")}><h2 id="shared-phones-heading">Company phone numbers</h2><p className={styles.muted}>Shared business lines are available when calling any contact at this company.</p><PhoneEditor label="Shared numbers" numbers={draft.sharedNumbers} onChange={(value) => update("sharedNumbers", value)} reason={phoneReason} /></section>
    <section className={styles.section} aria-labelledby="company-contacts-heading" {...panel("people")}><div className={styles.sectionHeading}><div><h2 id="company-contacts-heading">People at this company</h2><p className={styles.muted}>Choose a default contact. Each person can have their own phone numbers.</p></div><HintButton type="button" className={styles.button} disabled={Boolean(phoneReason)} disabledReason={phoneReason} onClick={() => { const contact = { id: newDraftId(), firstName: "", lastName: "", displayName: "", title: "", email: "", decisionMaker: false, influencer: false, numbers: [] }; onChange({ ...draft, contacts: [...draft.contacts, contact], defaultContactId: draft.defaultContactId || contact.id }); }}>Add contact</HintButton></div>
      <datalist id={titlesId}>{TITLES.map((title) => <option key={title} value={title} />)}</datalist>
      {draft.contacts.map((contact, index) => {
        const isDefault = contact.id === draft.defaultContactId;
        const archiveReason = disabledReasons(phoneReason, draft.contacts.length === 1 && "Keep at least one contact at this company.", isDefault && "Choose another default contact before archiving this contact.");
        return <article key={contact.id} className={styles.contact} aria-label={`Contact ${index + 1}`}><div className={styles.sectionHeading}><h3>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.displayName || `Contact ${index + 1}`} {isDefault && <span className={styles.badge}>Default contact</span>}</h3><HintButton type="button" className={`${styles.button} ${styles.danger}`} disabled={Boolean(archiveReason)} disabledReason={archiveReason} onClick={() => update("contacts", draft.contacts.filter((item) => item.id !== contact.id))}>Archive contact</HintButton></div>
          <div className={styles.grid}>
            <Field label="First name" value={contact.firstName || ""} onChange={(value) => updateContact(contact.id, "firstName", value)} reason={reason} maxLength={120} />
            <Field label="Last name" value={contact.lastName || ""} onChange={(value) => updateContact(contact.id, "lastName", value)} reason={reason} maxLength={120} />
            <Field label="Title — choose or type your own" list={titlesId} value={contact.title || ""} onChange={(value) => updateContact(contact.id, "title", value)} reason={reason} maxLength={100} />
            <Field label="Email" type="email" value={contact.email || ""} onChange={(value) => updateContact(contact.id, "email", value)} reason={reason} maxLength={320} />
          </div>
          <div className={styles.checks}><Check label="Decision maker" checked={Boolean(contact.decisionMaker)} onChange={(value) => updateContact(contact.id, "decisionMaker", value)} reason={reason} /><Check label="Influencer" checked={Boolean(contact.influencer)} onChange={(value) => updateContact(contact.id, "influencer", value)} reason={reason} />
          <label className={styles.check}><HintInput aria-label="Default company contact" type="radio" name="defaultContact" checked={isDefault} disabled={Boolean(reason)} disabledReason={reason} onChange={() => update("defaultContactId", contact.id)} />Default company contact</label></div>
          <PhoneEditor label="Personal phone numbers" numbers={contact.numbers || []} onChange={(value) => updateContact(contact.id, "numbers", value)} reason={phoneReason} />
        </article>;
      })}
      <p className={styles.muted}>Decision maker and influencer roles do not grant permission to call or email.</p>
    </section>
    <section className={styles.section} aria-labelledby="company-permissions-heading" {...panel("permissions")}><h2 id="company-permissions-heading">Contact permissions</h2><p className={styles.muted}>Record permission separately from a person’s role. Do-not-call and suppression rules still apply.</p><p className={styles.muted}>Email permission applies to {defaultEmail || "the default contact’s email address"}. {changedEmail ? "The recipient changed. Confirm permission again for this email address." : "Choosing a contact for a signup link does not grant marketing email permission."}</p><div className={styles.checks}><Check label="Permission to call recorded" checked={draft.permissionGranted} onChange={(value) => update("permissionGranted", value)} reason={reason} /><Check label="Permission to email recorded" checked={draft.emailPermission} onChange={(value) => update("emailPermission", value)} reason={reason} /></div></section>
  </>;
}
