'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchSalesJson } from './salesApi';
import { Card, Field, ErrorNotice } from './SalesUi';
import { salesReportTimeline } from '../../../lib/salesReportTimeline';

const selectClass = 'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';
const utc = value => value == null ? 'Not recorded' : new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC');
const duration = seconds => `${Math.floor(seconds / 60)}m ${Number((seconds % 60).toFixed(3))}s`;
const clock = value => new Date(value).toISOString().slice(11, 19);
function callDescription(call) {
  return `${call.businessName || call.id} · ${call.id} · ${call.startSource}: ${utc(call.at)} · ${call.valid ? `End: ${utc(call.end)} · Elapsed session: ${duration((call.end - call.at) / 1000)}` : call.endedAt ? 'Incomplete or invalid timing; duration unknown' : 'End not recorded; duration unknown'}`;
}

export default function SalesDayTimeline({ filters }) {
  const filterKey = new URLSearchParams(filters).toString();
  const [selection, setSelection] = useState(null), [result, setResult] = useState(null), [failure, setFailure] = useState(null);
  const [zoom, setZoom] = useState('fit');
  const selected = selection?.filterKey === filterKey ? selection.day : '';
  const requestKey = `${filterKey}&view=timeline${selected ? `&day=${selected}` : ''}`;
  useEffect(() => {
    let active = true;
    fetchSalesJson(`/api/v1/admin/sales/reports?${requestKey}`)
      .then(data => { if (active) { setResult({ key: requestKey, data }); setFailure(null); } })
      .catch(error => { if (active) setFailure({ key: requestKey, message: error.message }); });
    return () => { active = false; };
  }, [requestKey, filters]);
  const data = result?.key === requestKey ? result.data : null;
  const error = failure?.key === requestKey ? failure.message : '';
  // Retain the available options while a newly selected day is loading.
  const bounds = result?.data && result.key.startsWith(`${filterKey}&`) ? result.data : null;
  const days = useMemo(() => {
    if (!bounds?.from || !bounds?.to) return [];
    const rows = [];
    for (let at = Date.parse(`${bounds.from}T00:00:00Z`), end = Date.parse(`${bounds.to}T00:00:00Z`); at <= end; at += 86400000) rows.push(new Date(at).toISOString().slice(0, 10));
    return rows.reverse();
  }, [bounds?.from, bounds?.to]);
  const chart = useMemo(() => data?.day ? salesReportTimeline(data.calls, data.day, data.prior) : null, [data]);
  const span = chart ? Math.max(1, chart.windowEnd - chart.windowStart) : 120000;
  const width = zoom === 'detail' ? Math.max(900, span / 60000 * 8) : 1000;
  const x = at => 35 + (at - chart.windowStart) / span * (width - 70);
  return <Card>
    <h3 className="text-base font-semibold">Calls through the day</h3>
    <p className="mt-1 text-sm text-slate-600">See recorded session timing and gaps for each rep. All times are UTC.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field label="Timeline day (UTC)"><select className={selectClass} value={selected || data?.day || bounds?.day || ''} disabled={!days.length} onChange={event => setSelection({ filterKey, day: event.target.value })}>
        {!days.length ? <option value="">{error ? 'Unavailable' : data ? 'No matching history' : 'Loading days…'}</option> : days.map(day => <option key={day} value={day}>{day}</option>)}
      </select></Field>
      <Field label="Timeline scale"><select className={selectClass} value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">Fit activity window</option><option value="detail">5-minute detail (scroll horizontally)</option></select></Field>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-slate-500">Blue bars are recorded session start → end, including dialing; they are not connected talk time. Purple diamonds mark attempts with unknown duration (at creation if no start is recorded). Amber marks gaps of at least 5 minutes; gray marks shorter gaps. These are gaps between matching calls: filters can hide other calls, and a gap is not proof of a break. Missing or invalid timing prevents later gap estimates for that rep. Unassigned sessions have no rep gap estimates.</p>
    <ErrorNotice title="Timeline unavailable" message={error} />
    {!data && !error ? <p role="status" className="mt-3 text-sm text-slate-500">Loading day timeline…</p> : data && !data.calls.length ? <p role="status" className="mt-4 text-sm text-slate-500">{data.day ? `No matching sessions on ${data.day} (UTC).` : 'No matching call history. Choose different report filters.'}</p> : chart ? <>
      <p role="status" className="mt-3 text-xs text-slate-600">{data.calls.length.toLocaleString()} sessions on {data.day} · Independent of the call table page · {zoom === 'detail' ? 'Scroll the chart to inspect 5-minute gaps.' : 'Choose 5-minute detail to inspect tightly spaced calls.'}</p>
      <div className="mt-3 max-w-full overflow-x-auto rounded-lg border border-slate-200" tabIndex={0} role="region" aria-label="Scrollable daily session timeline">
        <svg width={zoom === 'detail' ? width : undefined} viewBox={`0 0 ${width} ${50 + chart.lanes.length * 100}`} role="img" aria-label={`Session timeline for ${data.day}, UTC, ${chart.lanes.length} rep lanes. Exact call and gap times in the data below.`} className={zoom === 'fit' ? 'w-full min-w-[650px]' : 'max-w-none'}>
          {Array.from({ length: 6 }, (_, i) => chart.windowStart + span * i / 5).map(at => <g key={at}><line x1={x(at)} x2={x(at)} y1="28" y2={40 + chart.lanes.length * 100} stroke="#e2e8f0" /><text x={x(at)} y="18" textAnchor="middle" fontSize="11" fill="#475569">{clock(at)}</text></g>)}
          {chart.lanes.map((lane, index) => {
            const y = 60 + index * 100;
            return <g key={lane.key}>
              <text x="35" y={y} fontSize="13" fontWeight="600" fill="#334155">{lane.name}</text>
              {lane.gaps.map(gap => <g key={gap.start}><rect x={x(gap.start)} y={y + 17} width={Math.max(1, x(gap.end) - x(gap.start))} height="26" rx="2" fill={gap.long ? '#fbbf24' : '#e2e8f0'}><title>{`${lane.name}: gap ${duration(gap.seconds)}, ${utc(gap.start)} → ${utc(gap.end)}`}</title></rect>{gap.long && x(gap.end) - x(gap.start) > 44 ? <text x={(x(gap.end) + x(gap.start)) / 2} y={y + 59} textAnchor="middle" fontSize="11" fill="#92400e">{duration(gap.seconds)}</text> : null}</g>)}
              {lane.calls.map(call => call.valid && call.end > call.at ? <rect key={call.id} x={x(call.clippedStart)} y={y + 22} width={Math.max(1, x(call.clippedEnd) - x(call.clippedStart))} height="16" rx="2" fill="#2563eb"><title>{callDescription(call)}</title></rect> : <path key={call.id} d={`M ${x(call.clippedStart)} ${y + 23} l 6 7 l -6 7 l -6 -7 Z`} fill={call.valid ? '#2563eb' : '#9333ea'}><title>{callDescription(call)}</title></path>)}
            </g>;
          })}
        </svg>
      </div>
      {chart.lanes.some(lane => lane.uncertain) ? <p className="mt-2 text-xs text-slate-500">Some gap estimates are unavailable because this filtered history contains incomplete or invalid session timestamps.</p> : null}
      <div className="mt-3 grid gap-2 text-sm">{chart.lanes.map(lane => <p key={lane.key}><strong>{lane.name}:</strong> {lane.gaps.filter(gap => gap.long).length ? lane.gaps.filter(gap => gap.long).map(gap => `${duration(gap.seconds)} at ${clock(gap.start)} UTC`).join(' · ') : 'No confirmed gaps of 5 minutes or more.'}</p>)}</div>
      <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-blue-700">View exact session and gap times</summary>
        <div className="mt-2 max-h-96 overflow-auto"><table className="w-full text-left"><caption className="sr-only">Daily sessions and gaps in UTC, with complete recorded timestamps. Bars are clipped at midnight.</caption><thead><tr>{['Rep / session', 'Kind', 'Start (UTC)', 'End (UTC)', 'Elapsed'].map(label => <th className="p-2" scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
          {chart.lanes.flatMap(lane => [
            ...lane.calls.map(call => <tr key={call.id}><th scope="row" className="p-2 font-normal">{lane.name}<br />{call.businessName}<br />{call.id}</th><td className="p-2">{call.startSource}{!call.valid ? ' · duration unknown' : ''}</td><td className="whitespace-nowrap p-2">{utc(call.at)}</td><td className="whitespace-nowrap p-2">{utc(call.endedAt)}</td><td className="p-2">{call.valid ? duration((call.end - call.at) / 1000) : 'Unknown'}</td></tr>),
            ...lane.gaps.map(gap => <tr key={`${lane.key}-${gap.start}`}><th scope="row" className="p-2 font-normal">{lane.name}</th><td className="p-2">{gap.long ? 'Gap ≥ 5 minutes' : 'Gap < 5 minutes'}</td><td className="whitespace-nowrap p-2">{utc(gap.start)}</td><td className="whitespace-nowrap p-2">{utc(gap.end)}</td><td className="p-2">{duration(gap.seconds)}</td></tr>),
          ])}
        </tbody></table></div>
      </details>
    </> : null}
  </Card>;
}
