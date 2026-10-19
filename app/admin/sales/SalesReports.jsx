'use client';

import { useEffect, useState } from 'react';
import { fetchSalesJson, displayStatus } from './salesApi';
import { Card, Field, TextInput, ActionButton, ErrorNotice } from './SalesUi';

const METRICS = [['sessions', 'Call sessions'], ['connected', 'Connected'], ['demosStarted', 'Demos started'], ['outcomesRecorded', 'Outcomes saved']];
const selectClass = 'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';

export default function SalesReports() {
  const [filters, setFilters] = useState(() => ({ from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), operator: '' }));
  const [applied, setApplied] = useState(filters);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchSalesJson(`/api/v1/admin/sales/reports?${new URLSearchParams(applied)}`)
      .then((data) => { if (active) setReport(data); })
      .catch((cause) => { if (active) { setError(cause.message); setReport(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied]);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Card>
        <h2 className="m-0 text-lg font-semibold">Rep reporting</h2>
        <p className="mt-1 text-sm text-slate-500">Activity for call sessions created in the selected UTC dates, inclusive. Defaults to the last 30 days.</p>
        <form onSubmit={(event) => { event.preventDefault(); setApplied({ ...filters }); }} className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr_auto]">
          <Field label="From (UTC)"><TextInput type="date" required value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
          <Field label="Through (UTC)"><TextInput type="date" required min={filters.from} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
          <Field label="Sales rep"><select className={selectClass} value={filters.operator} onChange={(e) => setFilters({ ...filters, operator: e.target.value })}>
            <option value="">All reps</option>
            {(report?.reps || []).map((rep) => <option key={rep.id} value={rep.id}>{rep.name} ({displayStatus(rep.role)})</option>)}
            <option value="unassigned">Unassigned / deleted user</option>
          </select></Field>
          <ActionButton type="submit" disabled={loading}>{loading ? 'Loading…' : 'Update report'}</ActionButton>
        </form>
      </Card>
      <ErrorNotice title="Report unavailable" message={error} />
      {loading ? <p role="status" className="text-sm text-slate-500">Loading recorded sales activity…</p> : report ? <>
        <p className="m-0 text-sm text-slate-600">Showing {report.filters.from} through {report.filters.to} (UTC){report.filters.operator ? ` · ${report.reps.find((rep) => String(rep.id) === report.filters.operator)?.name || 'Unassigned / deleted user'}` : ' · All reps'}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{METRICS.map(([key, label]) => <Card key={key}><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-3xl font-semibold">{report.totals[key]}</div></Card>)}</div>
        <Card>
          <h3 className="m-0 text-base font-semibold">Activity by rep</h3>
          {!report.summary.length ? <p className="mt-3 text-sm text-slate-500">No call sessions were recorded for these dates and rep.</p> : <div className="mt-3 min-w-0 max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-200"><th className="p-3">Rep</th>{METRICS.map(([key, label]) => <th className="p-3 text-right" key={key}>{label}</th>)}</tr></thead><tbody>{report.summary.map((rep) => <tr key={rep.operatorId ?? 'unassigned'} className="border-b border-slate-100"><th scope="row" className="p-3 font-medium">{rep.operatorName}</th>{METRICS.map(([key]) => <td className="p-3 text-right" key={key}>{rep[key]}</td>)}</tr>)}</tbody></table></div>}
          <p className="mt-3 text-xs leading-relaxed text-slate-500">Call sessions count created records, including failed attempts before a dial. Connected and demos started require their recorded timestamps. Outcomes saved require an outcome-recorded timestamp. Outcomes are recorded by reps or updated when signup completes; they do not verify revenue.</p>
        </Card>
        <Card><h3 className="m-0 text-base font-semibold">Recorded outcomes</h3><div className="mt-3 flex flex-wrap gap-2">{report.outcomes.length ? report.outcomes.map((row) => <span className="rounded-full bg-slate-100 px-3 py-2 text-sm" key={row.outcome}>{displayStatus(row.outcome)}: <strong>{row.count}</strong></span>) : <p className="text-sm text-slate-500">No outcomes to show.</p>}</div></Card>
        <Card>
          <h3 className="m-0 text-base font-semibold">Recent sessions</h3>
          <p className="mt-1 text-xs text-slate-500">Showing the latest {report.recent.length} of {report.totals.sessions} matching sessions (maximum 100). Totals include every matching session.</p>
          {report.recent.length ? <div className="mt-3 min-w-0 max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-200">{['Created (UTC)', 'Rep', 'Prospect', 'Call state', 'Outcome'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{report.recent.map((call) => <tr key={call.id} className="border-b border-slate-100"><td className="whitespace-nowrap p-3">{new Date(call.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td><td className="p-3">{call.operatorName}</td><td className="p-3">{call.businessName}</td><td className="p-3">{displayStatus(call.state)}</td><td className="p-3">{call.outcome ? displayStatus(call.outcome) : 'Not recorded'}</td></tr>)}</tbody></table></div> : null}
        </Card>
      </> : null}
    </div>
  );
}
