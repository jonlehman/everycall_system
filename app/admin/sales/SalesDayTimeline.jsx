'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchSalesJson } from './salesApi';
import { Card, Field, ErrorNotice } from './SalesUi';
import { salesReportTimeline, salesTimelineTime } from '../../../lib/salesReportTimeline';

const selectClass = 'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';
const pacific = value => salesTimelineTime(value);
const duration = seconds => `${Math.floor(seconds / 60)}m ${Number((seconds % 60).toFixed(3))}s`;
const clock = value => salesTimelineTime(value, false);
function callDescription(call) {
  return `${call.businessName || call.id} · ${call.id} · ${call.startSource}: ${pacific(call.at)} · ${call.valid ? `End: ${pacific(call.end)} · Provider interval: ${duration((call.end - call.at) / 1000)}` : call.endedAt ? 'Incomplete or invalid timing; duration unknown' : 'End not recorded; duration unknown'}`;
}

export default function SalesDayTimeline({ filters, snapshot }) {
  const filterKey = new URLSearchParams({ ...filters, ...(snapshot ? { snapshot } : {}) }).toString();
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
    // UTC arithmetic here enumerates calendar labels, never timeline instants.
    for (let at = Date.parse(`${bounds.from}T00:00:00Z`), end = Date.parse(`${bounds.to}T00:00:00Z`); at <= end; at += 86400000) rows.push(new Date(at).toISOString().slice(0, 10));
    return rows.reverse();
  }, [bounds?.from, bounds?.to]);
  const chart = useMemo(() => data?.day ? salesReportTimeline(data.calls, data, data.prior) : null, [data]);
  const span = chart ? Math.max(1, chart.windowEnd - chart.windowStart) : 120000;
  const width = zoom === 'detail' ? Math.max(900, span / 60000 * 8) : 1000;
  const x = at => 60 + (at - chart.windowStart) / span * (width - 120);
  return <Card>
    <h3 className="text-base font-semibold">Calls through the day</h3>
    <p className="mt-1 text-sm text-slate-600">See the same Telnyx dataset by day, grouped by exact EveryCall rep identity; unmatched records remain unassigned. All times are Pacific (PST/PDT).</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field label="Timeline day (Pacific)"><select className={selectClass} value={selected || data?.day || bounds?.day || ''} disabled={!days.length} onChange={event => setSelection({ filterKey, day: event.target.value })}>
        {!days.length ? <option value="">{error ? 'Unavailable' : data ? 'No matching history' : 'Loading days…'}</option> : days.map(day => <option key={day} value={day}>{day}</option>)}
      </select></Field>
      <Field label="Timeline scale"><select className={selectClass} value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">Fit activity window</option><option value="detail">5-minute detail (scroll horizontally)</option></select></Field>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-slate-500">Blue bars use Telnyx start → finish, including dialing; they are not connected talk time. Purple diamonds have no valid provider end. Related legs can produce multiple records for one Sales session. Thin amber marks intervals of at least 5 minutes between returned records only when coverage permits; filters can hide other calls. These intervals do not establish inactivity or breaks.</p>
    {data?.coverage ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700" role="status">
      <strong>{['available', 'partial'].includes(data.coverage.status) ? 'Source: Telnyx' : 'Telnyx records unavailable'}</strong>
      {data.coverage.retrievedAt ? <> · Retrieved {pacific(data.coverage.retrievedAt)}</> : null}
      <p className="mt-1">All returned pages retrieved · {data.calls.length} matching provider records on this day · {data.coverage.unmatchedRecords} unmatched and {data.coverage.ambiguousRecords} ambiguous identities in the source window · {data.coverage.excludedOperatorAiRecords} known operator/AI records excluded.</p>
      <p className="mt-1">{data.coverage.limits}</p>
      {data.coverage.gapsAvailable === false ? <p className="mt-1 font-medium">Gap estimates withheld: provider retention, finalization and unclassified identities do not establish complete calling coverage.</p> : null}
    </div> : null}
    <ErrorNotice title="Timeline unavailable" message={error} />
    {!data && !error ? <p role="status" className="mt-3 text-sm text-slate-500">Loading day timeline…</p> : data && !data.calls.length && data.coverage?.status !== 'unavailable' ? <p role="status" className="mt-4 text-sm text-slate-500">{data.day ? `No matching Telnyx records returned for ${data.day} (Pacific).` : 'No matching call history. Choose different report filters.'}</p> : chart && data.calls.length ? <>
      <p role="status" className="mt-3 text-xs text-slate-600">{data.calls.length.toLocaleString()} provider records on {data.day} (Pacific) · Independent of the call table page · {zoom === 'detail' ? 'Scroll the chart to inspect 5-minute gaps.' : 'Choose 5-minute detail to inspect tightly spaced calls.'}</p>
      <div className="mt-3 max-w-full overflow-x-auto rounded-lg border border-slate-200" tabIndex={0} role="region" aria-label="Scrollable daily session timeline">
        <svg width={zoom === 'detail' ? width : undefined} viewBox={`0 0 ${width} ${50 + chart.lanes.length * 100}`} role="img" aria-label={`Session timeline for ${data.day}, Pacific time, ${chart.lanes.length} rep lanes. Exact call and gap times in the data below.`} className={zoom === 'fit' ? 'w-full min-w-[650px]' : 'max-w-none'}>
          {Array.from({ length: 6 }, (_, i) => chart.windowStart + span * i / 5).map(at => <g key={at}><line x1={x(at)} x2={x(at)} y1="28" y2={40 + chart.lanes.length * 100} stroke="#e2e8f0" /><text x={x(at)} y="18" textAnchor="middle" fontSize="11" fill="#475569">{clock(at)}</text></g>)}
          {chart.lanes.map((lane, index) => {
            const y = 60 + index * 100;
            return <g key={lane.key}>
              <text x="35" y={y} fontSize="13" fontWeight="600" fill="#334155">{lane.name}</text>
              {lane.gaps.map(gap => <g key={gap.start}><rect x={x(gap.start)} y={y + 17} width={Math.max(1, x(gap.end) - x(gap.start))} height="26" rx="2" fill={gap.long ? '#fffbeb' : '#f1f5f9'}><title>{`${lane.name}: gap ${duration(gap.seconds)}, ${pacific(gap.start)} → ${pacific(gap.end)}`}</title></rect>{gap.long ? <line x1={x(gap.start)} x2={x(gap.end)} y1={y + 43} y2={y + 43} stroke="#d97706" strokeWidth="2" /> : null}{gap.long && x(gap.end) - x(gap.start) > 44 ? <text x={(x(gap.end) + x(gap.start)) / 2} y={y + 59} textAnchor="middle" fontSize="11" fill="#92400e">{duration(gap.seconds)}</text> : null}</g>)}
              {lane.calls.map(call => call.valid && call.end > call.at ? <rect key={call.id} x={x(call.clippedStart)} y={y + 22} width={Math.max(1, x(call.clippedEnd) - x(call.clippedStart))} height="16" rx="2" fill="#2563eb"><title>{callDescription(call)}</title></rect> : <path key={call.id} d={`M ${x(call.clippedStart)} ${y + 23} l 6 7 l -6 7 l -6 -7 Z`} fill={call.valid ? '#2563eb' : '#9333ea'}><title>{callDescription(call)}</title></path>)}
            </g>;
          })}
        </svg>
      </div>
      {chart.lanes.some(lane => lane.uncertain) ? <p className="mt-2 text-xs text-slate-500">Gap estimates are unavailable because calling coverage or provider timing is incomplete.</p> : null}
      <div className="mt-3 grid gap-2 text-sm">{chart.lanes.map(lane => <p key={lane.key}><strong>{lane.name}:</strong> {lane.gaps.filter(gap => gap.long).length ? lane.gaps.filter(gap => gap.long).map(gap => `${duration(gap.seconds)} at ${clock(gap.start)}`).join(' · ') : data.coverage?.gapsAvailable === false ? 'Gap estimates unavailable.' : 'No intervals of 5 minutes or more between these returned records.'}</p>)}</div>
      <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-blue-700">View exact provider records and intervals</summary>
        <div className="mt-2 max-h-96 overflow-auto"><table className="w-full min-w-[1100px] break-all text-left"><caption className="sr-only">Daily sessions and gaps in Pacific time, with complete recorded timestamps. Bars are clipped at midnight.</caption><thead><tr>{['Rep / session', 'Kind', 'Start (Pacific)', 'End (Pacific)', 'Elapsed'].map(label => <th className="p-2" scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
          {chart.lanes.flatMap(lane => [
            ...lane.calls.map(call => <tr key={call.id}><th scope="row" className="p-2 font-normal">{lane.name}<br />{call.businessName}<br />{call.salesCallId}<br />Telnyx record: {call.id}<br />Leg: {call.providerLegId}<br />Session: {call.providerSessionId}</th><td className="p-2">{call.startSource} · {call.matchMethod === 'exact_prospect_leg' ? 'Exact prospect leg' : call.matchMethod === 'exact_prospect_session' ? 'Exact Sales prospect session' : 'Unassigned / unclassified identity'}{call.relatedLeg ? ' · Multiple records in provider session' : ''}{!call.valid ? ' · duration unknown' : ''}</td><td className="whitespace-nowrap p-2">{pacific(call.at)}</td><td className="whitespace-nowrap p-2">{pacific(call.endedAt)}</td><td className="p-2">{call.valid ? duration((call.end - call.at) / 1000) : 'Unknown'}</td></tr>),
            ...lane.gaps.map(gap => <tr key={`${lane.key}-${gap.start}`}><th scope="row" className="p-2 font-normal">{lane.name}</th><td className="p-2">{gap.long ? 'Gap ≥ 5 minutes' : 'Gap < 5 minutes'}</td><td className="whitespace-nowrap p-2">{pacific(gap.start)}</td><td className="whitespace-nowrap p-2">{pacific(gap.end)}</td><td className="p-2">{duration(gap.seconds)}</td></tr>),
          ])}
        </tbody></table></div>
      </details>
    </> : null}
    {data?.unmatched?.length ? <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Unmatched Telnyx records — not attributed to a rep ({data.unmatched.length})</summary><ul className="mt-2 max-h-60 overflow-auto break-all">{data.unmatched.map(row => <li key={row.providerId}>{row.providerId} · {row.direction} · {pacific(row.startedAt)} → {pacific(row.endedAt)} · Session {row.providerSessionId}</li>)}</ul></details> : null}
    {data?.missing?.length ? <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Local sessions without a matching provider record ({data.missing.length})</summary><ul className="mt-2 max-h-60 overflow-auto">{data.missing.map(row => <li key={row.salesCallId}>{row.operatorName} · {row.salesCallId} · {row.reason}</li>)}</ul></details> : null}
  </Card>;
}
