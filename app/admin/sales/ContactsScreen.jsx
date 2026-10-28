"use client";
import { useEffect, useState } from "react";
import { fetchSalesJson, normalizeProspect } from "./salesApi";
import { formatPhone } from "./dialerState.mjs";
import styles from "./DialerScreen.module.css";

export function contactStatus(prospect) {
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
export default function ContactsScreen({ onSelect, busy }) {
  const [query, setQuery] = useState(""), [rows, setRows] = useState([]),
    [status, setStatus] = useState("All"), [metro, setMetro] = useState(""),
    [cursor, setCursor] = useState(0), [previous, setPrevious] = useState([]),
    [next, setNext] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      if (query.trim().length === 1) { setRows([]); setNext(null); setLoading(false); return; }
      try {
        const params = new URLSearchParams({ limit: "50", afterQueuePosition: String(cursor) });
        if (query.trim().length >= 2) params.set("search", query.trim());
        const result = await fetchSalesJson(`/api/v1/admin/sales/prospects?${params}`);
        if (current) { setRows((result.prospects || []).map(normalizeProspect)); setNext(result.nextQueuePosition || null); }
      } catch (err) { if (current) { setRows([]); setNext(null); setError(err.message || "Could not load contacts."); } }
      finally { if (current) setLoading(false); }
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [query, cursor]);
  const filtered = rows.filter((row) => (status === "All" || contactStatus(row) === status) && (!metro || (row.metro || row.city) === metro));
  return <main className={styles.contactsPage}>
    <div className={styles.contactsHeading}><div><h1>Contacts</h1><p>Find a prospect, review their history, and pick up where you left off.</p></div></div>
    <div className={styles.contactSearch}>
      <input type="search" aria-label="Search contacts" placeholder="Search by business, contact, phone, or website" value={query} onChange={(event) => { setQuery(event.target.value); setCursor(0); setPrevious([]); }} />
      <select aria-label="Metro" value={metro} onChange={(event) => setMetro(event.target.value)}><option value="">All metros on this page</option>{[...new Set(rows.map((row) => row.metro || row.city).filter(Boolean))].sort().map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    <div className={styles.contactFilters} aria-label="Filter contacts on this page">
      {["All", "In queue", "Call back", "Demo done", "Link sent", "Paid", "Not interested", "Do not call", "Removed", "Not prepped"].map((label) => <button type="button" className={styles.button} key={label} aria-pressed={status === label} onClick={() => setStatus(label)}>{label} <span>{label === "All" ? rows.length : rows.filter((row) => contactStatus(row) === label).length}</span></button>)}
    </div>
    <p className={styles.caption}>Counts and filters apply to this page. Results follow list order. Search matches business, contact, website, and the primary phone.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.contactsTable} aria-busy={loading}>
      <table><thead><tr>{["Business", "Contact", "Phone", "Metro", "Status", "Attempts", "Last call", "Next"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{!loading && filtered.map((row) => <tr key={row.id} onClick={() => !busy && onSelect(row)}>
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
      {loading ? <p className={styles.contactsEmpty} role="status">Loading contacts…</p> : !filtered.length && <div className={styles.contactsEmpty}><h2>{query.trim().length === 1 ? "Enter at least two characters" : "No contacts found"}</h2><p>Try another search or filter. Your administrator can add or prepare a prospect.</p></div>}
    </div>
    <div className={styles.contactsPagination}><span>{filtered.length} shown · page {previous.length + 1} · list order</span><div className={styles.actions}><button type="button" className={styles.button} disabled={loading || !previous.length} onClick={() => { setCursor(previous.at(-1)); setPrevious(previous.slice(0, -1)); }}>Previous</button><button type="button" className={styles.button} disabled={loading || !next} onClick={() => { setPrevious([...previous, cursor]); setCursor(next); }}>Next →</button></div></div>
  </main>;
}
