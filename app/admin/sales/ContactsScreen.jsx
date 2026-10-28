"use client";
import { useEffect, useState } from "react";
import { fetchSalesJson, normalizeProspect } from "./salesApi";
import { formatPhone } from "./dialerState.mjs";
import styles from "./DialerScreen.module.css";
import AddContactForm from "./AddContactForm";

const FILTERS = [["all", "All"], ["in_queue", "In queue"], ["callback", "Call back"], ["demo_done", "Demo done"], ["link_sent", "Link sent"], ["paid", "Paid"], ["not_interested", "Not interested"], ["do_not_call", "Do not call"], ["removed", "Removed"], ["not_prepped", "Not prepped"]];

export function contactStatus(prospect) {
  if (prospect.contactStatus) return FILTERS.find(([key]) => key === prospect.contactStatus)?.[1] || "In queue";
  if (prospect.status === "paid" || prospect.outcome === "paid") return "Paid";
  if (prospect.status === "removed") return "Removed";
  if (prospect.outcome === "not_interested") return "Not interested";
  if (prospect.status === "do_not_call" || prospect.doNotCall || prospect.suppressed) return "Do not call";
  if (prospect.demoStatus !== "ready") return "Not prepped";
  if (prospect.callbackAt) return "Call back";
  if (prospect.outcome === "signup_link_sent") return "Link sent";
  if (prospect.outcome === "demo_completed") return "Demo done";
  return "In queue";
}
function dateLabel(value) {
  return value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}
export default function ContactsScreen({ onSelect, onAdd, busy, phoneTestMode = false }) {
  const [query, setQuery] = useState(""), [rows, setRows] = useState([]),
    [status, setStatus] = useState("all"), [metro, setMetro] = useState(""),
    [cursor, setCursor] = useState(""), [previous, setPrevious] = useState([]),
    [counts, setCounts] = useState({}), [metros, setMetros] = useState([]), [total, setTotal] = useState(0), [adding, setAdding] = useState(false), [revision, setRevision] = useState(0),
    [next, setNext] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      if (query.trim().length === 1) { if (current) { setRows([]); setNext(null); setTotal(0); setCounts({}); setLoading(false); } return; }
      try {
        const params = new URLSearchParams({ contactsView: "true", limit: "25", contactStatus: status });
        if (cursor) params.set("cursor", cursor);
        if (metro) params.set("metro", metro);
        if (query.trim().length >= 2) params.set("search", query.trim());
        const result = await fetchSalesJson(`/api/v1/admin/sales/prospects?${params}`);
        if (current) { setRows((result.prospects || []).map(normalizeProspect)); setNext(result.nextCursor || null); setTotal(Number(result.total || 0)); setCounts(result.counts || {}); setMetros(result.metros || []); }
      } catch (err) { if (current) { setRows([]); setNext(null); setTotal(0); setCounts({}); setError(err.message || "Could not load contacts."); } }
      finally { if (current) setLoading(false); }
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [query, cursor, status, metro, revision]);
  const resetPage = () => { setCursor(""); setPrevious([]); };
  return <main className={styles.contactsPage}>
    <div className={styles.contactsHeading}><div><h1>Contacts</h1><p>Find a prospect, review their history, and pick up where you left off.</p></div><button type="button" className={`${styles.button} ${styles.blue}`} disabled={busy || phoneTestMode} onClick={() => setAdding(true)}>Add prospect</button></div>
    {adding && <AddContactForm busy={busy} onCancel={() => setAdding(false)} onSave={async (details) => { await onAdd(details); resetPage(); setRevision((value) => value + 1); }} />}
    <div className={styles.contactSearch}>
      <input type="search" aria-label="Search contacts" placeholder="Search by business, contact, phone, or website" value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} />
      <select aria-label="Metro" value={metro} onChange={(event) => { setMetro(event.target.value); resetPage(); }}><option value="">All metros</option>{metros.map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    <div className={styles.contactFilters} aria-label="Filter contacts">
      {FILTERS.map(([key, label]) => <button type="button" className={styles.button} key={key} aria-pressed={status === key} onClick={() => { setStatus(key); resetPage(); }}>{label} <span>{counts[key] ?? 0}</span></button>)}
    </div>
    <p className={styles.caption}>Newest activity first. Search matches business, contact, website, and every phone number.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.contactsTable} aria-busy={loading}>
      <table><thead><tr>{["Business", "Contact", "Phone", "Metro", "Status", "Attempts", "Last call", "Next"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{!loading && rows.map((row) => <tr key={row.id} onClick={() => !busy && onSelect(row)}>
          <td><button type="button" className={styles.contactName} disabled={busy} onClick={(event) => { event.stopPropagation(); onSelect(row); }}>{row.businessName}</button><small>{row.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</small></td>
          <td>{row.contactName || "—"}<small>{row.contactRole}</small></td>
          <td>{(row.numbers.length ? [...row.numbers].sort((a, b) => Number(b.type === "cell") - Number(a.type === "cell")) : [{ phoneE164: row.phone, label: "Phone" }]).map((number) => <div key={number.phoneE164}>{formatPhone(number.phoneE164)} <small className={styles.phoneType}>{number.label || number.type}</small></div>)}</td>
          <td>{row.metro || row.city || "—"}</td>
          <td><span className={`${styles.contactBadge} ${["Call back", "Demo done", "Link sent"].includes(contactStatus(row)) ? styles.contactBadgeBlue : ""}`}>{contactStatus(row)}</span>{row.inboundReturn && <small className={styles.contactReturn}>Returned your call</small>}</td>
          <td>{row.attemptCount}</td>
          <td>{dateLabel(row.lastOutcomeAt)}<small>{row.outcome.replaceAll("_", " ")}</small></td>
          <td>{row.callbackAt ? dateLabel(row.callbackAt) : row.inboundReturn ? "Top of your list" : "—"}</td>
        </tr>)}</tbody>
      </table>
      {loading ? <p className={styles.contactsEmpty} role="status">Loading contacts…</p> : !rows.length && <div className={styles.contactsEmpty}><h2>{query.trim().length === 1 ? "Enter at least two characters" : "No contacts found"}</h2><p>Try another search or filter, or add a prospect.</p><button type="button" className={styles.button} disabled={busy || phoneTestMode} onClick={() => setAdding(true)}>Add prospect</button></div>}
    </div>
    <div className={styles.contactsPagination}><span>{rows.length ? previous.length * 25 + 1 : 0}–{rows.length ? previous.length * 25 + rows.length : 0} of {total}</span><div className={styles.actions}><button type="button" className={styles.button} disabled={loading || !previous.length} onClick={() => { setCursor(previous.at(-1)); setPrevious(previous.slice(0, -1)); }}>Previous</button><button type="button" className={styles.button} disabled={loading || !next} onClick={() => { setPrevious([...previous, cursor]); setCursor(next); }}>Next →</button></div></div>
  </main>;
}
