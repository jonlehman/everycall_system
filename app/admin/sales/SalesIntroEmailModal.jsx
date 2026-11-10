"use client";
import { useEffect, useRef, useState } from "react";
import { fetchSalesJson } from "./salesApi";
import styles from "./SalesIntroEmailModal.module.css";

export default function SalesIntroEmailModal({ prospectId, contactId, salesCallId, currentIdentity, onClose }) {
  const dialog = useRef(null);
  const openingFocus = useRef(null);
  const operation = useRef(false);
  const key = useRef(globalThis.crypto.randomUUID());
  const submitted = useRef(null);
  const [draft, setDraft] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const identity = `${prospectId}:${contactId}:${salesCallId || ""}`;
  const stale = currentIdentity !== identity;
  const disabledExplanation = sending ? "Sending is in progress. Please wait for the result." : uncertain ? "Delivery needs verification. Editing and sending are disabled for this draft; you may close this dialog." : stale ? "The selected contact or call changed. This draft can no longer be sent." : "";
  useEffect(() => {
    openingFocus.current = document.activeElement;
    dialog.current?.showModal();
    return () => { openingFocus.current?.focus?.(); };
  }, []);
  useEffect(() => {
    let active = true;
    fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospectId)}/intro-email/draft`, {
      method: "POST", body: JSON.stringify({ contactId, ...(salesCallId ? { salesCallId } : {}) }),
    }).then(result => {
      if (!active) return;
      if (!result.draft || result.draft.contactId !== contactId) throw new Error("The email draft does not match the selected contact.");
      setDraft(result.draft); setSubject(result.draft.subject || ""); setBody(result.draft.text || "");
    }).catch(err => { if (active) setError(err.message || "Could not prepare the email."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [prospectId, contactId, salesCallId]);
  useEffect(() => { if (stale && !sending && !uncertain) onClose(); }, [stale, sending, uncertain, onClose]);
  const close = () => { if (!operation.current) onClose(); };
  const send = async event => {
    event.preventDefault();
    if (operation.current || stale || uncertain || !draft) return;
    if (!uncertain && (!subject.trim() || !body.trim() || (draft.requiresEmailPermissionConfirmation && !confirmed))) {
      setError("Enter a subject and message, and confirm email permission if required."); return;
    }
    const payload = submitted.current || { draftToken: draft.draftToken, subject, text: body, confirmedEmailPermission: confirmed };
    submitted.current = payload;
    operation.current = true; setSending(true); setError("");
    try {
      const result = await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospectId)}/intro-email`, { method: "POST", idempotencyKey: key.current, body: JSON.stringify(payload) });
      if (result.delivery?.status !== "sent" || result.delivery?.contactId !== contactId) throw new Error("Delivery receipt could not be verified.");
      onClose(true);
    } catch (err) {
      const unknown = !err.status || err.status >= 500 || ["intro_email_delivery_pending", "intro_email_delivery_uncertain"].includes(err.payload?.error);
      setUncertain(unknown);
      if (!unknown) submitted.current = null;
      setError(unknown ? `Delivery status is uncertain. Ask an administrator to check the provider status before trying another email. ${err.message || ""}` : (err.message || "The email could not be sent."));
    } finally { operation.current = false; setSending(false); }
  };
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="intro-email-title" onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={send} className={styles.form}>
      <h2 id="intro-email-title">Send introduction email</h2>
      {loading ? <p role="status">Preparing email…</p> : draft && <>
        <p><strong>To:</strong> {draft.recipient}</p>
        <p><strong>Reply-To:</strong> {draft.replyTo}</p>
        <label>Subject<input value={subject} onChange={event => setSubject(event.target.value)} disabled={sending || uncertain} aria-describedby={sending || uncertain ? "intro-disabled-reason" : undefined} required /></label>
        <label>Message<textarea value={body} onChange={event => setBody(event.target.value)} disabled={sending || uncertain} aria-describedby={sending || uncertain ? "intro-disabled-reason" : undefined} required rows={12} /></label>
        {draft.requiresEmailPermissionConfirmation && <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={sending || uncertain} aria-describedby={sending || uncertain ? "intro-disabled-reason" : undefined} /> I confirm this contact has given permission to receive this email.</label>}
      </>}
      {disabledExplanation && <p id="intro-disabled-reason" role="status">{disabledExplanation}</p>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" onClick={close} disabled={sending} aria-describedby={sending ? "intro-disabled-reason" : undefined}>Close</button>
        {draft && <button type="submit" disabled={sending || stale || uncertain} aria-describedby={disabledExplanation ? "intro-disabled-reason" : undefined}>{sending ? "Sending…" : "Send"}</button>}
      </div>
    </form>
  </dialog>;
}
