'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { fetchSalesJson, displayStatus } from './salesApi';
import { Card, Field, TextInput, ActionButton, ErrorNotice } from './SalesUi';
import { SALES_REPORT_FIELDS, SALES_REPORT_EXPORT_LIMIT } from '../../../lib/salesReportFields';
import { salesTimelineTime } from '../../../lib/salesReportTimeline';
import SalesDayTimeline from './SalesDayTimeline';

const METRICS = [['records', 'Telnyx records'], ['uniqueSessions', 'Unique Telnyx sessions'], ['connected', 'Records: connected'], ['completed', 'Records: completed']];
const selectClass = 'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';
const COLORS = ['#2563eb', '#059669', '#9333ea'];
const SERIES = [['records', 'Records'], ['connected', 'Connected flag'], ['completed', 'Completed flag']];
const number = value => Number(value || 0).toLocaleString();
const percent = (part, total) => total ? `${Math.round(100 * part / total)}%` : '—';
const seconds = value => value === null || value === undefined ? '—' : `${Math.round(value)}s`;
const pacific = value => value ? salesTimelineTime(value) : '—';
const dateLabel = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
function fieldValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('At')) return pacific(value);
  if (Array.isArray(value)) return value.length ? value.map(displayStatus).join(' · ') : '—';
  if (key.endsWith('Seconds')) return seconds(value);
  return String(value);
}

function Legend() {
  return <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">{SERIES.map(([, label], index) => <span key={label} className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[index] }} />{label}</span>)}</div>;
}
function BarChart({ rows, series = [['count', 'Calls']], labelKey, title }) {
  const max = Math.max(1, ...rows.flatMap(row => series.map(([key]) => Number(row[key]))));
  return <div role="img" aria-label={`${title}. ${rows.map(row => `${row[labelKey]}: ${series.map(([key, label]) => `${label} ${row[key]}`).join(', ')}`).join('; ')}`} className="grid gap-3">
    {!rows.length ? <p className="text-sm text-slate-500">No activity to chart.</p> : rows.map((row, index) => <div key={index} className="grid gap-1">
      <div className="break-words text-xs font-medium text-slate-700">{row[labelKey]}</div>
      {series.map(([key, label], color) => <div key={key} className="flex items-center gap-2" aria-label={`${row[labelKey]}, ${label}: ${row[key]}`}>
        <div className="h-2.5 min-w-0 flex-1 rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${100 * row[key] / max}%`, background: COLORS[color] }} /></div>
        <span className="w-10 text-right text-xs tabular-nums">{number(row[key])}</span>
      </div>)}
    </div>)}
  </div>;
}
function ActivityChart({ activity, interval, from, to }) {
  const byDate = new Map(activity.map(row => [row.date, row]));
  const rows = [];
  const start = interval === 'month' ? activity[0]?.date : from;
  const end = interval === 'month' ? activity.at(-1)?.date : to;
  if (start && end) for (let date = new Date(`${start}T00:00:00Z`); date.toISOString().slice(0, 10) <= end;) {
    const key = date.toISOString().slice(0, 10);
    rows.push(byDate.get(key) || { date: key, records: 0, connected: 0, completed: 0 });
    if (interval === 'month') date.setUTCMonth(date.getUTCMonth() + 1); else date.setUTCDate(date.getUTCDate() + 1);
  }
  const max = Math.max(1, ...rows.map(row => row.records));
  const x = index => rows.length === 1 ? 320 : 35 + index * 580 / (rows.length - 1);
  const y = count => 160 - count * 125 / max;
  return <>
    <Legend />
    {activity.length ? <svg viewBox="0 0 650 195" role="img" aria-label={`${interval === 'month' ? 'Monthly' : 'Daily'} call activity in Pacific time. Exact values in chart data below.`} className="w-full">
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="35" x2="615" y1={y(max * fraction)} y2={y(max * fraction)} stroke="#e2e8f0" /><text x="30" y={y(max * fraction) + 4} textAnchor="end" fontSize="10" fill="#64748b">{Math.round(max * fraction)}</text></g>)}
      {SERIES.map(([key, label], color) => <g key={key}>
        <polyline fill="none" stroke={COLORS[color]} strokeWidth="2.5" points={rows.map((row, index) => `${x(index)},${y(row[key])}`).join(' ')} />
        {rows.length <= 31 ? rows.map((row, index) => <circle key={row.date} cx={x(index)} cy={y(row[key])} r="3" fill={COLORS[color]}><title>{row.date}: {label} {row[key]}</title></circle>) : null}
      </g>)}
      <text x="35" y="184" fontSize="11" fill="#64748b">{rows[0]?.date}</text><text x="615" y="184" textAnchor="end" fontSize="11" fill="#64748b">{rows.at(-1)?.date}</text>
    </svg> : <p className="text-sm text-slate-500">No activity to chart.</p>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium text-blue-700">View activity chart data</summary><div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left"><caption className="sr-only">Pacific {interval} activity</caption><thead><tr><th scope="col">{interval === 'month' ? 'Month' : 'Date'} (Pacific)</th>{SERIES.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.date}><th scope="row" className="py-1 font-normal">{row.date}</th>{SERIES.map(([key]) => <td key={key}>{row[key]}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}
function CallDetails({ call }) {
  return <div className="grid min-w-0 gap-5 p-4">{SALES_REPORT_FIELDS.map(([group, fields]) => <section key={group} aria-label={group}><h4 className="mb-3 text-sm font-semibold text-slate-800">{group}</h4><dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
    {fields.map(([key, label]) => <div key={key} className="min-w-0"><dt className="text-xs text-slate-500">{label.replace('(UTC)', '(Pacific)')}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900 [overflow-wrap:anywhere]">{fieldValue(key, call[key])}</dd></div>)}
  </dl></section>)}</div>;
}

export default function SalesReports() {
  const [filters, setFilters] = useState(() => ({ from: new Date(Date.parse(dateLabel(Date.now())) - 29 * 86400000).toISOString().slice(0, 10), to: dateLabel(Date.now()), operator: '', range: 'dates', direction: 'all', status: '', search: '', contract: 'telnyx-v1' }));
  const [applied, setApplied] = useState(filters), [cursor, setCursor] = useState(''), [history, setHistory] = useState([]);
  const [report, setReport] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null), [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const [reps, setReps] = useState([]);
  const pinnedSnapshot = useRef(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setExpanded(null);
    fetchSalesJson(`/api/v1/admin/sales/reports?${new URLSearchParams({ ...applied, cursor, ...(pinnedSnapshot.current ? { snapshot: pinnedSnapshot.current } : {}) })}`)
      .then(data => { if (active) { setReport(data); setReps(data.reps); pinnedSnapshot.current = data.snapshot; } })
      .catch(cause => { if (active) { setError(cause.message); setReport(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied, cursor]);
  const update = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
  async function downloadCsv() {
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`/api/v1/admin/sales/reports?${new URLSearchParams({ ...applied, snapshot: report.snapshot, format: 'csv' })}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { const data = await response.json(); throw new Error(data.message || 'Export unavailable. Please try again.'); }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = 'telnyx-sales-records.csv'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setExportError(cause.message); }
    finally { setExporting(false); }
  }
  const durationRows = report ? [['underMinute', 'Under 1 min'], ['oneToThree', '1–3 min'], ['threeToTen', '3–10 min'], ['tenPlus', '10+ min'], ['unknown', 'Unknown']].map(([key, label]) => ({ label, count: report.durations[key] })) : [];
  return <div className="grid min-w-0 grid-cols-1 gap-4">
    <Card>
      <h2 className="m-0 text-lg font-semibold">Telnyx Sales call report</h2>
      <p className="mt-1 text-sm text-slate-500">All call facts, totals, charts and exports come from Telnyx call-control detail records for the Sales application. Dates and displayed times are Pacific (PST/PDT). EveryCall supplies rep and business labels only through exact saved provider identities.</p>
      <form onSubmit={event => { event.preventDefault(); pinnedSnapshot.current = null; setCursor(''); setHistory([]); setApplied({ ...filters, search: filters.search.trim() }); setExportError(''); }} className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="From (Pacific)"><TextInput type="date" required value={filters.from} onChange={event => update('from', event.target.value)} /></Field>
        <Field label="Through (Pacific)"><TextInput type="date" required min={filters.from} value={filters.to} onChange={event => update('to', event.target.value)} /></Field>
        <Field label="Sales rep · EveryCall label"><select className={selectClass} value={filters.operator} onChange={event => update('operator', event.target.value)}><option value="">All reps and unassigned</option>{reps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}<option value="unassigned">Unassigned / unclassified</option></select></Field>
        <Field label="Telnyx direction"><select className={selectClass} value={filters.direction} onChange={event => update('direction', event.target.value)}><option value="all">All directions</option><option value="outbound">Outbound</option><option value="inbound">Inbound</option><option value="unknown">Unknown</option></select></Field>
        <Field label="Telnyx flag status"><select className={selectClass} value={filters.status} onChange={event => update('status', event.target.value)}><option value="">All statuses</option>{['completed', 'connected_not_completed', 'attempted_not_connected', 'not_attempted', 'unknown'].map(value => <option key={value} value={value}>{displayStatus(value)}</option>)}</select></Field>
        <Field label="Search provider records"><TextInput type="search" maxLength={120} placeholder="Business label, provider number or ID" value={filters.search} onChange={event => update('search', event.target.value)} /></Field>
        <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4"><ActionButton type="submit" disabled={loading || exporting}>{loading ? 'Loading…' : 'Update report'}</ActionButton><ActionButton tone="secondary" onClick={downloadCsv} disabled={loading || exporting || !report}>{exporting ? 'Exporting…' : 'Export filtered records (CSV)'}</ActionButton></div>
      </form>
      <p className="mt-3 text-xs text-slate-500">Select any historical window of up to 31 days; provider retention is not guaranteed. Default: last 30 Pacific dates. Retrieval is bounded to 40 pages / 2,000 raw provider records, including operator/AI legs before exclusion; narrow dates if exceeded. CSV contains the full filtered cohort, up to {number(SALES_REPORT_EXPORT_LIMIT)} records, with UTC source timestamps. App outcomes, notes, demos, payments, test/live classification and transcripts are not Telnyx facts and are not part of this report.</p>
    </Card>
    <ErrorNotice title="Report unavailable" message={error} /><ErrorNotice title="Export unavailable" message={exportError} />
    {report && !error && report.filters.from === applied.from && report.filters.to === applied.to && report.filters.operator === applied.operator && report.filters.direction === applied.direction && report.filters.status === applied.status && report.filters.search === applied.search ? <SalesDayTimeline filters={applied} snapshot={report.snapshot} /> : null}
    {loading ? <p role="status" className="text-sm text-slate-500">Loading Telnyx records…</p> : report ? <>
      <Card><div role="status" className="text-sm text-slate-700"><strong>Source: Telnyx · {report.filters.from} through {report.filters.to} (Pacific)</strong><p className="mt-2">Retrieved {pacific(report.coverage.retrievedAt)} · {number(report.coverage.pagesRead)} pages · {number(report.coverage.providerRecords)} raw provider records · {number(report.coverage.excludedOperatorAiRecords)} known operator/AI records excluded · {number(report.coverage.excludedConnectionRecords)} records outside the Sales application excluded.</p><p className="mt-2">Before rep/status/search filtering: {number(report.coverage.matchedRecords)} records matched by exact prospect identities, {number(report.coverage.unmatchedRecords)} unmatched, {number(report.coverage.ambiguousRecords)} ambiguous, {number(report.coverage.relatedRecords)} in sessions with multiple records. Unmatched or ambiguous identities remain unassigned; their role is unclassified.</p><p className="mt-2">{report.coverage.limits} Complete retrieval means all pages returned for this query, not complete historical calling coverage. Missing records do not establish inactivity or breaks.</p><details className="mt-2 text-xs"><summary className="cursor-pointer">Source identifiers</summary><p className="break-all">Sales connection: {report.coverage.connectionId}<br />Dataset: {report.snapshot}</p></details></div></Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{METRICS.map(([key, label]) => <Card key={key}><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-3xl font-semibold tabular-nums">{number(report.totals[key])}</div>{['connected', 'completed'].includes(key) ? <p className="mt-1 text-xs text-slate-500">Provider flag true · {number(report.totals[`${key}Unknown`])} unknown</p> : null}</Card>)}</div>
      <p className="text-xs text-slate-500">{number(report.totals.attempted)} records have attempted=true; {number(report.totals.attemptedUnknown)} unknown. Records count individual CDRs. Unique sessions count distinct Telnyx session IDs, which can contain multiple legs/records. No count establishes distinct people, sales results or work time.</p>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card><h3 className="mb-3 text-base font-semibold">Daily provider record activity</h3><ActivityChart activity={report.activity} interval="day" from={report.filters.from} to={report.filters.to} /></Card>
        <Card><h3 className="mb-3 text-base font-semibold">Provider records by rep label</h3><Legend /><div className="max-h-72 overflow-y-auto"><BarChart rows={report.summary} series={SERIES} labelKey="operatorName" title="Provider records and true connected/completed flags by rep label" /></div></Card>
        <Card><h3 className="mb-3 text-base font-semibold">Telnyx flag status distribution</h3><BarChart rows={report.statuses.map(row => ({ ...row, label: `${displayStatus(row.status)} · ${percent(row.count, report.totals.records)}` }))} labelKey="label" title="Status derived from provider flags" /><p className="mt-3 text-xs text-slate-500">Completed takes precedence, then connected, then attempted with connected=false. Missing flags remain unknown. These statuses are not EveryCall dispositions.</p></Card>
        <Card><h3 className="mb-3 text-base font-semibold">Telnyx call_sec distribution</h3><BarChart rows={durationRows} labelKey="label" title="Provider reported call seconds" /><div className="mt-4 grid grid-cols-3 gap-2 text-xs">{[['elapsedSeconds', 'Start → finish'], ['callSeconds', 'Telnyx call_sec'], ['billedSeconds', 'Telnyx billed_sec']].map(([key, label]) => <div key={key}><div className="text-slate-500">{label}</div><strong className="text-lg">{seconds(report.durations[`${key}Average`])}</strong><div>average · {number(report.durations[`${key}Count`])} known</div><div>{seconds(report.durations[`${key}Total`])} sum</div></div>)}</div><p className="mt-2 text-xs text-slate-500">Elapsed includes dialing. call_sec and billed_sec are separate provider fields; billing rounding can differ. Sums can overlap across legs and are not unique talk/work time. Missing values are excluded, never replaced with zero.</p></Card>
      </div>
      <Card><h3 className="text-base font-semibold">Provider totals by rep label</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Full filtered provider cohort</caption><thead><tr className="border-b border-slate-200"><th scope="col" className="p-3">EveryCall rep label</th>{METRICS.map(([key, label]) => <th scope="col" className="p-3 text-right" key={key}>{label}</th>)}</tr></thead><tbody>{report.summary.map(rep => <tr key={rep.operatorId ?? 'unassigned'} className="border-b border-slate-100"><th scope="row" className="p-3 font-medium">{rep.operatorName}</th>{METRICS.map(([key]) => <td className="p-3 text-right" key={key}>{number(rep[key])}</td>)}</tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">All totals and charts use every matching provider record starting within the Pacific date window. The timeline additionally shows returned records overlapping a day boundary. Rep and business labels reflect current EveryCall names on exactly matched saved prospect identities; unassigned records are not attributed to a rep.</p></Card>
      <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold">Telnyx call records</h3><p className="mt-1 text-xs text-slate-500">{report.recent.length ? `${number(report.offset + 1)}–${number(report.offset + report.recent.length)} of ${number(report.totals.records)}` : '0 matching provider records'} · Source: Telnyx · Newest first · Pacific time</p></div><div className="flex gap-2"><ActionButton tone="secondary" disabled={!history.length} onClick={() => { setCursor(history.at(-1)); setHistory(previous => previous.slice(0, -1)); }}>Previous page</ActionButton><ActionButton tone="secondary" disabled={!report.nextCursor} onClick={() => { setHistory(previous => [...previous, cursor]); setCursor(report.nextCursor); }}>Next page</ActionButton></div></div>
        {!report.recent.length ? <p className="mt-4 text-sm text-slate-500">No matching Telnyx records were returned. Provider retention and finalization limits still apply.</p> : <div className="mt-3 min-w-0 max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Telnyx call records. Expand for provider facts and identity provenance.</caption><thead><tr className="border-b border-slate-200">{['Started (Pacific)', 'EveryCall rep / business', 'Telnyx caller → destination', 'Provider status', 'call_sec', 'Details'].map(label => <th scope="col" key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{report.recent.map((call, index) => <Fragment key={call.id}><tr className="border-b border-slate-100"><td className="whitespace-nowrap p-3">{pacific(call.startedAt)}</td><td className="p-3"><div>{call.operatorName}</div><div>{call.businessName || '—'}</div><div className="text-xs text-slate-500">{displayStatus(call.classification)}</div></td><td className="whitespace-nowrap p-3">{call.callerNumber || '—'} → {call.destinationNumber || '—'}<div className="text-xs text-slate-500">{call.direction ? displayStatus(call.direction) : 'Unknown direction'}</div></td><td className="p-3">{displayStatus(call.status)}{call.relatedLeg ? <div className="text-xs text-slate-500">Multiple records in session</div> : null}</td><td className="p-3">{seconds(call.callSeconds)}</td><td className="p-3"><button type="button" className="rounded px-2 py-2 font-semibold text-blue-700 focus-visible:outline focus-visible:outline-2" aria-expanded={expanded === call.id} aria-controls={`call-detail-${index}`} aria-label={`${expanded === call.id ? 'Hide' : 'Show'} details for Telnyx record ${call.id}`} onClick={() => setExpanded(expanded === call.id ? null : call.id)}>{expanded === call.id ? 'Hide' : 'Details'}</button></td></tr>{expanded === call.id ? <tr><td colSpan="6" id={`call-detail-${index}`} className="bg-slate-50"><CallDetails call={call} /></td></tr> : null}</Fragment>)}</tbody></table></div>}
        <p className="mt-3 text-xs text-slate-500">“—” means unknown or not returned. Provider fields are allowlisted; credentials, raw payloads, app notes and app outcomes are excluded. Paging and export refuse a changed dataset; use Update report to refresh.</p>
      </Card>
    </> : null}
  </div>;
}
