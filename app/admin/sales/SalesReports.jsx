'use client';

import { Fragment, useEffect, useState } from 'react';
import { fetchSalesJson, displayStatus } from './salesApi';
import { Card, Field, TextInput, ActionButton, ErrorNotice } from './SalesUi';
import { SALES_REPORT_FIELDS, SALES_REPORT_EXPORT_LIMIT } from '../../../lib/salesReportFields';
import SalesDayTimeline from './SalesDayTimeline';

const METRICS = [['sessions', 'Call sessions'], ['connected', 'Connected'], ['demosStarted', 'Demos started'], ['outcomesRecorded', 'Outcomes saved']];
const selectClass = 'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';
const COLORS = ['#2563eb', '#059669', '#9333ea'];
const SERIES = [['sessions', 'Sessions'], ['connected', 'Connected'], ['demosStarted', 'Demos']];
const number = value => Number(value || 0).toLocaleString();
const percent = (part, total) => total ? `${Math.round(100 * part / total)}%` : '—';
const seconds = value => value === null || value === undefined ? '—' : `${Math.round(value)}s`;
const utc = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';
function fieldValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('At')) return utc(value);
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
    rows.push(byDate.get(key) || { date: key, sessions: 0, connected: 0, demosStarted: 0 });
    if (interval === 'month') date.setUTCMonth(date.getUTCMonth() + 1); else date.setUTCDate(date.getUTCDate() + 1);
  }
  const max = Math.max(1, ...rows.map(row => row.sessions));
  const x = index => rows.length === 1 ? 320 : 35 + index * 580 / (rows.length - 1);
  const y = count => 160 - count * 125 / max;
  return <>
    <Legend />
    {activity.length ? <svg viewBox="0 0 650 195" role="img" aria-label={`${interval === 'month' ? 'Monthly' : 'Daily'} call activity in UTC. Exact values in chart data below.`} className="w-full">
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="35" x2="615" y1={y(max * fraction)} y2={y(max * fraction)} stroke="#e2e8f0" /><text x="30" y={y(max * fraction) + 4} textAnchor="end" fontSize="10" fill="#64748b">{Math.round(max * fraction)}</text></g>)}
      {SERIES.map(([key, label], color) => <g key={key}>
        <polyline fill="none" stroke={COLORS[color]} strokeWidth="2.5" points={rows.map((row, index) => `${x(index)},${y(row[key])}`).join(' ')} />
        {rows.length <= 31 ? rows.map((row, index) => <circle key={row.date} cx={x(index)} cy={y(row[key])} r="3" fill={COLORS[color]}><title>{row.date}: {label} {row[key]}</title></circle>) : null}
      </g>)}
      <text x="35" y="184" fontSize="11" fill="#64748b">{rows[0]?.date}</text><text x="615" y="184" textAnchor="end" fontSize="11" fill="#64748b">{rows.at(-1)?.date}</text>
    </svg> : <p className="text-sm text-slate-500">No activity to chart.</p>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium text-blue-700">View activity chart data</summary><div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left"><caption className="sr-only">UTC {interval} activity</caption><thead><tr><th scope="col">{interval === 'month' ? 'Month' : 'Date'} (UTC)</th>{SERIES.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.date}><th scope="row" className="py-1 font-normal">{row.date}</th>{SERIES.map(([key]) => <td key={key}>{row[key]}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}
function CallDetails({ call }) {
  const [transcript, setTranscript] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    if (!call.hasTranscript) return;
    let active = true;
    fetchSalesJson(`/api/v1/admin/sales/reports?${new URLSearchParams({ callId: call.id })}`)
      .then(data => { if (active) setTranscript(data.transcript); })
      .catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [call.id, call.hasTranscript]);
  return <div className="grid min-w-0 gap-5 p-4">
    {SALES_REPORT_FIELDS.map(([group, fields]) => <section key={group} aria-label={group}><h4 className="mb-3 text-sm font-semibold text-slate-800">{group}</h4><dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map(([key, label]) => <div key={key} className={`min-w-0 ${key.endsWith('Notes') ? 'sm:col-span-2 xl:col-span-3' : ''}`}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900 [overflow-wrap:anywhere]">{fieldValue(key, call[key])}</dd></div>)}
    </dl></section>)}
    <section aria-label="Call transcript"><h4 className="mb-2 text-sm font-semibold">Transcript</h4><ErrorNotice title="Transcript unavailable" message={error} />
      {!call.hasTranscript ? <p className="text-sm text-slate-500">No transcript stored.</p> : !transcript && !error ? <p role="status">Loading transcript…</p> : transcript?.length ? <ol className="grid max-h-96 gap-3 overflow-y-auto">{transcript.map((entry, index) => <li key={index} className="min-w-0 text-sm"><div className="text-xs text-slate-500">{entry.role ? displayStatus(entry.role) : 'Speaker not recorded'}{entry.at ? ` · ${utc(entry.at)}` : ''}</div><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.text}</p></li>)}</ol> : transcript ? <p className="text-sm text-slate-500">No readable transcript entries stored.</p> : null}
    </section>
  </div>;
}

export default function SalesReports() {
  const [filters, setFilters] = useState(() => ({ from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), operator: '', range: 'dates', mode: 'live', direction: 'all', outcome: '', state: '', search: '' }));
  const [applied, setApplied] = useState(filters), [cursor, setCursor] = useState(''), [history, setHistory] = useState([]);
  const [choices, setChoices] = useState({ outcome: [], state: [] });
  const [report, setReport] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null), [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setExpanded(null);
    fetchSalesJson(`/api/v1/admin/sales/reports?${new URLSearchParams({ ...applied, cursor })}`)
      .then(data => { if (active) {
        setReport(data);
        setChoices(previous => ({ outcome: [...new Set([...previous.outcome, ...data.outcomes.map(row => row.outcome)])],
          state: [...new Set([...previous.state, ...data.states.map(row => row.state)])] }));
      } })
      .catch(cause => { if (active) { setError(cause.message); setReport(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied, cursor]);
  const update = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
  async function downloadCsv() {
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`/api/v1/admin/sales/reports?${new URLSearchParams({ ...applied, format: 'csv' })}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { const data = await response.json(); throw new Error(data.message || 'Export unavailable. Please try again.'); }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = 'sales-calls.csv'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setExportError(cause.message); }
    finally { setExporting(false); }
  }
  const options = (key, values) => [...new Set([...choices[key], ...(values || []), ...(filters[key] ? [filters[key]] : [])])];
  const durationRows = report ? [['underMinute', 'Under 1 min'], ['oneToThree', '1–3 min'], ['threeToTen', '3–10 min'], ['tenPlus', '10+ min']].map(([key, label]) => ({ label, count: report.durations[key] })) : [];
  return <div className="grid min-w-0 grid-cols-1 gap-4">
    <Card>
      <h2 className="m-0 text-lg font-semibold">Sales call report</h2>
      <p className="mt-1 text-sm text-slate-500">Explore every sales call, rep activity, and recorded results. The daily timeline uses Pacific time; other charts, table, and CSV use UTC. The default is live calls from the last 30 days.</p>
      <form onSubmit={event => { event.preventDefault(); setCursor(''); setHistory([]); setApplied({ ...filters }); setExportError(''); }} className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Date range"><select className={selectClass} value={filters.range} onChange={event => update('range', event.target.value)}><option value="dates">Selected dates (up to 366 days)</option><option value="all">All time</option></select></Field>
        <Field label="From (UTC)"><TextInput type="date" required disabled={filters.range === 'all'} value={filters.from} onChange={event => update('from', event.target.value)} /></Field>
        <Field label="Through (UTC)"><TextInput type="date" required disabled={filters.range === 'all'} min={filters.from} value={filters.to} onChange={event => update('to', event.target.value)} /></Field>
        <Field label="Sales rep"><select className={selectClass} value={filters.operator} onChange={event => update('operator', event.target.value)}><option value="">All reps</option>{(report?.reps || []).map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}<option value="unassigned">Unassigned / deleted user</option></select></Field>
        <Field label="Call mode"><select className={selectClass} value={filters.mode} onChange={event => update('mode', event.target.value)}><option value="live">Live calls only</option><option value="test">Phone test calls only</option><option value="all">Live and phone test calls</option></select></Field>
        <Field label="Direction"><select className={selectClass} value={filters.direction} onChange={event => update('direction', event.target.value)}><option value="all">All directions</option><option value="outbound">Outbound calls</option><option value="inbound">Inbound return calls</option></select></Field>
        <Field label="Outcome"><select className={selectClass} value={filters.outcome} onChange={event => update('outcome', event.target.value)}><option value="">All outcomes</option>{options('outcome', report?.outcomes.map(row => row.outcome)).map(value => <option key={value} value={value}>{displayStatus(value)}</option>)}</select></Field>
        <Field label="Call state"><select className={selectClass} value={filters.state} onChange={event => update('state', event.target.value)}><option value="">All states</option>{options('state', report?.states.map(row => row.state)).map(value => <option key={value} value={value}>{displayStatus(value)}</option>)}</select></Field>
        <Field label="Search calls"><TextInput type="search" maxLength={120} placeholder="Business, contact, number, or call ID" value={filters.search} onChange={event => update('search', event.target.value)} /></Field>
        <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4"><ActionButton type="submit" disabled={loading || exporting}>{loading ? 'Loading…' : 'Update report'}</ActionButton><ActionButton tone="secondary" onClick={downloadCsv} disabled={loading || exporting || !report}>{exporting ? 'Exporting…' : 'Export filtered calls (CSV)'}</ActionButton></div>
      </form>
      <p className="mt-3 text-xs text-slate-500">CSV includes all matching call fields and notes, up to {number(SALES_REPORT_EXPORT_LIMIT)} calls per export. Narrow the filters for larger reports. Full transcripts appear in call details.</p>
    </Card>
    <ErrorNotice title="Report unavailable" message={error} /><ErrorNotice title="Export unavailable" message={exportError} />
    <SalesDayTimeline filters={applied} />
    {loading ? <p role="status" className="text-sm text-slate-500">Loading recorded sales activity…</p> : report ? <>
      <p role="status" className="m-0 text-sm text-slate-600">{report.filters.range === 'all' ? 'All time' : `${report.filters.from} through ${report.filters.to} (UTC)`} · {report.filters.mode === 'live' ? 'Live calls only' : report.filters.mode === 'test' ? 'Phone test calls only' : 'Includes phone test calls'} · {report.filters.operator ? report.reps.find(rep => String(rep.id) === report.filters.operator)?.name || 'Unassigned / deleted user' : 'All reps'} · {report.filters.direction === 'all' ? 'All directions' : displayStatus(report.filters.direction)}{report.filters.outcome ? ` · ${displayStatus(report.filters.outcome)}` : ''}{report.filters.state ? ` · ${displayStatus(report.filters.state)}` : ''}{report.filters.search ? ` · Search: ${report.filters.search}` : ''}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{METRICS.map(([key, label]) => <Card key={key}><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-3xl font-semibold tabular-nums">{number(report.totals[key])}</div>{key === 'connected' || key === 'demosStarted' ? <p className="mt-1 text-xs text-slate-500">{percent(report.totals[key], report.totals.sessions)} of sessions</p> : null}</Card>)}</div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Card><h3 className="mb-3 text-base font-semibold">{report.activityInterval === 'month' ? 'Monthly' : 'Daily'} call activity</h3><ActivityChart activity={report.activity} interval={report.activityInterval} from={report.filters.from} to={report.filters.to} /></Card>
        <Card><h3 className="mb-3 text-base font-semibold">Calls by rep</h3><Legend /><div className="max-h-72 overflow-y-auto"><BarChart rows={report.summary} series={SERIES} labelKey="operatorName" title="Call sessions, connected calls, and demos by rep" /></div></Card>
        <Card><h3 className="mb-3 text-base font-semibold">Outcome distribution</h3><BarChart rows={report.outcomes.map(row => ({ ...row, label: `${displayStatus(row.outcome)} · ${percent(row.count, report.totals.sessions)}` }))} labelKey="label" title="Recorded outcome distribution" /></Card>
        <Card><h3 className="mb-3 text-base font-semibold">Connected call duration</h3><BarChart rows={durationRows} labelKey="label" title="Completed connected call duration distribution" /><div className="mt-4 grid grid-cols-3 gap-2 text-xs">{[['averageSessionSeconds', 'Session avg.'], ['averageConnectedSeconds', 'Connected avg.'], ['averageDemoSeconds', 'Demo avg.']].map(([key, label]) => <div key={key}><div className="text-slate-500">{label}</div><strong className="text-lg">{seconds(report.durations[key])}</strong></div>)}</div><p className="mt-2 text-xs text-slate-500">Based on {number(report.durations.sessionCount)} finished sessions, {number(report.durations.connectedCount)} connected calls, and {number(report.durations.demoCount)} demos with both timestamps. Missing or unfinished durations are excluded.</p></Card>
      </div>
      <Card><h3 className="text-base font-semibold">Activity by rep</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Rep totals for the full filtered report</caption><thead><tr className="border-b border-slate-200"><th scope="col" className="p-3">Rep</th>{METRICS.map(([key, label]) => <th scope="col" className="p-3 text-right" key={key}>{label}</th>)}<th scope="col" className="p-3">Connect rate</th></tr></thead><tbody>{report.summary.map(rep => <tr key={rep.operatorId ?? 'unassigned'} className="border-b border-slate-100"><th scope="row" className="p-3 font-medium">{rep.operatorName}</th>{METRICS.map(([key]) => <td className="p-3 text-right" key={key}>{number(rep[key])}</td>)}<td className="p-3">{percent(rep.connected, rep.sessions)}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs leading-relaxed text-slate-500">Charts and totals include every matching session. Sessions include failed attempts before a dial. Connected and demos require their recorded timestamps; outcomes saved require an outcome timestamp. Results and paid timestamps do not verify revenue. Duration is elapsed time between recorded start/end timestamps, not billed talk time.</p></Card>
      <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold">All call sessions</h3><p className="mt-1 text-xs text-slate-500">{report.recent.length ? `${number(history.length * report.pageSize + 1)}–${number(history.length * report.pageSize + report.recent.length)} of ${number(report.totals.sessions)}` : '0 matching calls'} · Source: EveryCall session records · Newest first · All times UTC</p></div><div className="flex gap-2"><ActionButton tone="secondary" disabled={!history.length} onClick={() => { setCursor(history.at(-1)); setHistory(previous => previous.slice(0, -1)); }}>Previous page</ActionButton><ActionButton tone="secondary" disabled={!report.nextCursor} onClick={() => { setHistory(previous => [...previous, cursor]); setCursor(report.nextCursor); }}>Next page</ActionButton></div></div>
        {!report.recent.length ? <p className="mt-4 text-sm text-slate-500">No call sessions match these filters. Try a wider date range or All time.</p> : <div className="mt-3 min-w-0 max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Sales call sessions. Expand a row for all call fields and transcript.</caption><thead><tr className="border-b border-slate-200">{['Created (UTC)', 'Rep', 'Business / contact', 'Prospect number', 'State / mode', 'Outcome', 'Connected duration', 'Details'].map(label => <th scope="col" key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{report.recent.map((call, index) => <Fragment key={call.id}><tr className="border-b border-slate-100"><td className="whitespace-nowrap p-3">{utc(call.createdAt)}</td><td className="p-3">{call.operatorName}</td><td className="p-3"><div>{call.businessName || '—'}</div><div className="text-xs text-slate-500">{call.contactName || 'Contact not recorded'}</div></td><td className="whitespace-nowrap p-3">{call.prospectNumber || '—'}<div className="text-xs text-slate-500">{displayStatus(call.direction)}</div></td><td className="p-3">{displayStatus(call.state)}<div className="text-xs text-slate-500">{call.phoneTestMode ? 'Phone test' : 'Live'}</div></td><td className="p-3">{call.outcome ? displayStatus(call.outcome) : 'Not recorded'}</td><td className="p-3">{seconds(call.connectedSeconds)}</td><td className="p-3"><button type="button" className="rounded px-2 py-2 font-semibold text-blue-700 focus-visible:outline focus-visible:outline-2" aria-expanded={expanded === call.id} aria-controls={`call-detail-${index}`} aria-label={`${expanded === call.id ? 'Hide' : 'Show'} details for ${call.businessName || call.id}, ${utc(call.createdAt)}`} onClick={() => setExpanded(expanded === call.id ? null : call.id)}>{expanded === call.id ? 'Hide' : 'Details'}</button></td></tr>{expanded === call.id ? <tr><td colSpan="8" id={`call-detail-${index}`} className="bg-slate-50"><CallDetails call={call} /></td></tr> : null}</Fragment>)}</tbody></table></div>}
        <p className="mt-3 text-xs text-slate-500">Contact details are the saved dial-time snapshot; older calls may have none. Business and rep names reflect current records. “—” means not recorded. Recording availability is shown; playback links are not included.</p>
      </Card>
    </> : null}
  </div>;
}
