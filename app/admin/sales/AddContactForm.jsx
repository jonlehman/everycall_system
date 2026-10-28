"use client";
import { useState } from "react";
import styles from "./DialerScreen.module.css";

// One form for Contacts and a caller who has already been taken in the browser.
export default function AddContactForm({ onSave, onCancel, initialPhone = "", initialValues = {}, requireWebsite = false, busy = false }) {
  const knownPermission = initialValues.permission ?? initialValues.permissionGranted;
  const [form, setForm] = useState({ businessName: initialValues.businessName || "", contactName: initialValues.contactName || "", phone: initialPhone, phoneType: initialValues.phoneType || initialValues.numbers?.find((number) => number.phoneE164 === initialPhone)?.type || "other", shop: "", website: initialValues.website || initialValues.websiteUrl || "", permission: typeof knownPermission === "boolean" ? knownPermission ? "yes" : "no" : "", timezone: initialValues.timezone || "" });
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const field = (key) => ({ value: form[key], onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })) });
  return <form className={styles.addContactForm} aria-label="Add prospect" onSubmit={async (event) => {
    event.preventDefault();
    if (saving || busy) return;
    setSaving(true); setError("");
    try {
      await onSave({
        business_name: form.businessName.trim(), contact_name: form.contactName.trim(),
        phone: form.phone.trim(),
        numbers: [{ phoneE164: form.phone.trim(), type: form.phoneType, label: form.phoneType === "cell" ? "Cell" : form.phoneType === "shop" ? "Shop" : "Phone" }, ...(form.shop.trim() ? [{ phoneE164: form.shop.trim(), type: "shop", label: "Shop" }] : [])],
        website: form.website.trim(), permission: form.permission === "yes", timezone: form.timezone.trim(),
      });
      onCancel?.();
    } catch (err) { setError(err.message || "Could not add this prospect."); }
    finally { setSaving(false); }
  }}>
    <h2>Add prospect</h2>
    <div className={styles.addContactFields}>
      <label>Business<input aria-label="Business" required maxLength={300} {...field("businessName")} /></label>
      <label>Contact<input aria-label="Contact" maxLength={300} {...field("contactName")} /></label>
      <label>Phone<input aria-label="Phone" type="tel" required maxLength={30} {...field("phone")} /></label>
      <label>Phone type<select aria-label="Phone type" {...field("phoneType")}><option value="other">Other / unknown</option><option value="cell">Cell</option><option value="shop">Shop</option></select></label>
      <label>Additional shop phone<input aria-label="Shop phone" type="tel" maxLength={30} {...field("shop")} /></label>
      <label>Website<input aria-label="Website" type="url" required={requireWebsite} placeholder="https://their-business.com" maxLength={1000} {...field("website")} /></label>
      <label>Calling permission<select aria-label="Calling permission" required {...field("permission")}><option value="">Choose permission</option><option value="yes">Permission to call confirmed</option><option value="no">Permission not confirmed</option></select></label>
      <label>Prospect timezone<input aria-label="Prospect timezone" required placeholder="America/Los_Angeles" maxLength={100} {...field("timezone")} /></label>
    </div>
    <p className={styles.caption}>A website starts demo preparation when permission and timezone allow it. Calling stays unavailable until the demo is ready.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}><button type="submit" className={`${styles.button} ${styles.blue}`} disabled={busy || saving}>{saving ? "Saving…" : "Save prospect"}</button><button type="button" className={styles.button} disabled={saving} onClick={onCancel}>Cancel</button></div>
  </form>;
}
