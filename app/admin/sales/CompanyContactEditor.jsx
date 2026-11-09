"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSalesJson, displayStatus } from "./salesApi";
import CompanyContactForm, { companyEditorDraft, companyEditorNextDraft, companyEditorPayload, newDraftId } from "./CompanyContactForm";
import { HintButton, disabledReasons } from "./DisabledHint";
import styles from "./CompanyContactEditor.module.css";

export function companyEditorReturnPath(returnTo, prospectId) {
  const id = encodeURIComponent(prospectId);
  if (returnTo === "admin") return `/admin/sales?tab=prospects&prospectId=${id}`;
  return `/sales?${returnTo === "contacts" ? "tab=contacts&" : ""}prospectId=${id}`;
}

export default function CompanyContactEditor({ prospectId, returnTo = "queue" }) {
  const [prospect, setProspect] = useState(null), [draft, setDraft] = useState(null),
    [savedDraft, setSavedDraft] = useState(""), [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false), [error, setError] = useState(""),
    [conflict, setConflict] = useState(false), [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const attempt = useRef(null);
  const dirty = Boolean(draft && JSON.stringify(draft) !== savedDraft);
  const returnPath = companyEditorReturnPath(returnTo, prospectId);
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospectId)}`)
      .then((result) => {
        if (!current) return;
        if (!result.prospect) throw new Error("This company is unavailable.");
        const next = companyEditorDraft(result.prospect);
        setProspect(result.prospect); setDraft(next); setSavedDraft(JSON.stringify(next));
        setConflict(false); setNotice(""); attempt.current = null;
      })
      .catch((failure) => {
        if (!current) return;
        setProspect(null); setDraft(null);
        setError(failure.status === 401 ? "Sign in to open this company." : failure.status === 403 ? "You do not have access to edit this company." : failure.status === 404 ? "This company could not be found." : failure.message || "Could not load this company.");
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [prospectId, revision]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  const leave = () => {
    if (saving) return;
    if (dirty && !window.confirm("Leave this page and discard your unsaved changes?")) return;
    // Explicit leave already confirms draft loss; remove beforeunload by clearing the draft first.
    setSavedDraft(JSON.stringify(draft));
    window.setTimeout(() => window.location.assign(returnPath), 0);
  };
  const reload = () => {
    if (dirty && !window.confirm("Reload the latest company details and discard your unsaved changes?")) return;
    setRevision((value) => value + 1);
  };
  const canEdit = prospect?.editCapabilities?.canEdit === true;
  const saveReason = disabledReasons(saving && "Wait for this company to finish saving.", !canEdit && (prospect?.editCapabilities?.reason || "Company editing is unavailable."), conflict && "Reload the latest company details before saving again.", !dirty && "There are no unsaved changes.");
  const save = async (event) => {
    event.preventDefault();
    if (saveReason) return;
    setSaving(true); setError(""); setNotice("");
    const body = JSON.stringify(companyEditorPayload(draft, prospect.rowVersion));
    if (attempt.current?.body !== body) attempt.current = { body, key: newDraftId() };
    try {
      const result = await fetchSalesJson(`/api/v1/admin/sales/prospects/${encodeURIComponent(prospectId)}`, { method: "PATCH", body, idempotencyKey: attempt.current.key });
      if (!result.prospect) throw new Error("The save response was incomplete. Reload to confirm the saved details.");
      const next = companyEditorDraft(result.prospect);
      setProspect(result.prospect); setDraft(next); setSavedDraft(JSON.stringify(next));
      attempt.current = null; setNotice("Company details saved.");
    } catch (failure) {
      if (failure.status === 409) {
        setConflict(true);
        setError("This company changed while you were editing, or an active call or delivery is preventing this save. Your draft is still here. Review your changes, then reload the latest details before saving again.");
      } else setError(failure.status === 403 ? "You no longer have access to save this company. Your draft is still here." : failure.message || "Could not save the company. Your draft is still here.");
    } finally { setSaving(false); }
  };
  return <div className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>Company profile</span><h1>{prospect?.businessName || "Edit company"}</h1><p className={styles.muted}>Update business details, contacts, and phone numbers.</p></div><HintButton type="button" className={styles.button} disabled={saving} disabledReason="Wait for this company to finish saving." onClick={leave}>← Back to {returnTo === "admin" ? "prospects" : returnTo === "contacts" ? "contacts" : "dialer"}</HintButton></header>
    {loading && <p role="status">Loading company…</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{conflict && <HintButton type="button" className={styles.button} disabled={saving} disabledReason="Wait for this company to finish saving." onClick={reload}>Reload latest details</HintButton>}</div>}
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {!loading && !draft && <div className={styles.actions}><HintButton type="button" className={styles.button} onClick={reload}>Try again</HintButton><a className={styles.button} href="/sales/login">Sign in</a></div>}
    {!loading && draft && <form onSubmit={save}>
      <CompanyContactForm draft={draft} prospect={prospect} saving={saving} onChange={(next) => { setDraft((previous) => companyEditorNextDraft(previous, next)); setNotice(""); }} />
      <section className={styles.section} aria-labelledby="company-record-heading"><div className={styles.sectionHeading}><div><h2 id="company-record-heading">Company activity</h2><p className={styles.muted}>Assignment, payment, outcomes, and contact restrictions are managed in their usual workflows.</p></div></div><dl className={styles.statusGrid}>
        <div><dt>Assigned representative</dt><dd>{prospect.assignedRepName || prospect.assignedRepEmail || "Unassigned"}</dd></div>
        <div><dt>Status</dt><dd>{displayStatus(prospect.status)}</dd></div><div><dt>Latest outcome</dt><dd>{prospect.lastOutcome ? displayStatus(prospect.lastOutcome) : prospect.outcome ? displayStatus(prospect.outcome) : "None"}</dd></div>
        <div><dt>Phone test mode</dt><dd>{prospect.phoneTestMode ? "On — using test destinations" : "Off"}</dd></div>
        <div><dt>Do not call</dt><dd>{prospect.doNotCall ? "Yes" : "No"}</dd></div><div><dt>Suppression</dt><dd>{prospect.suppressed ? prospect.suppressionReason || "Suppressed" : "None"}</dd></div>
      </dl></section>
      <footer className={`${styles.footer} ${styles.actions}`}><span className={styles.muted}>{saving ? "Saving company…" : dirty ? "You have unsaved changes." : "All changes saved."}</span><div className={styles.actions}><HintButton type="button" className={styles.button} disabled={saving} disabledReason="Wait for this company to finish saving." onClick={leave}>Cancel</HintButton><HintButton type="submit" className={`${styles.button} ${styles.primary}`} disabled={Boolean(saveReason)} disabledReason={saveReason}>{saving ? "Saving…" : "Save changes"}</HintButton></div></footer>
    </form>}
  </div>;
}
