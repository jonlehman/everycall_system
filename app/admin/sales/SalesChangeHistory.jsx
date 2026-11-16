'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchSalesJson } from './salesApi';

const endpoint='/api/v1/admin/sales/change-history';
const emptyFilters={from:'',to:'',actor:'',actorKind:'',company:'',contact:'',entity:'',field:'',action:''};
const pacific=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(value));
const label=value=>value.replace(/^metadata_json\./,'').replace(/^scripts_json\./,'Script: ').replaceAll('_',' ');
const fieldClass='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
function displayValue(value,present) {
  if(!present)return 'Not present';
  if(value===null)return 'null';
  if(value==='')return 'Empty text';
  return typeof value==='string'?value:JSON.stringify(value,null,2);
}
function preview(value,present,truncated) {
  if(!present)return 'Not present';
  if(truncated)return `${value}… (preview)`;
  try{return displayValue(JSON.parse(value),true);}catch{return value;}
}
export default function SalesChangeHistory() {
  const [draft,setDraft]=useState(emptyFilters),[filters,setFilters]=useState(emptyFilters);
  const [cursor,setCursor]=useState(''),[pages,setPages]=useState([]),[data,setData]=useState(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[expanded,setExpanded]=useState(null),[detail,setDetail]=useState(null),[detailError,setDetailError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const detailRequest=useRef(0);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');setData(null);setExpanded(null);setDetail(null);detailRequest.current++;
    const params=new URLSearchParams(Object.entries({...filters,cursor}).filter(([,value])=>value));
    fetchSalesJson(`${endpoint}?${params}`).then(result=>{if(active)setData(result);})
      .catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;detailRequest.current++;};
  },[filters,cursor,refresh]);
  async function expand(event) {
    const request=++detailRequest.current;
    if(expanded===event.event_id){setExpanded(null);setDetail(null);return;}
    setExpanded(event.event_id);setDetail(null);setDetailError('');
    try{const response=await fetchSalesJson(`${endpoint}?eventId=${encodeURIComponent(event.event_id)}`);if(request===detailRequest.current)setDetail(response.event);}
    catch(cause){if(request===detailRequest.current){setDetailError(cause.message);if(cause.status===401||cause.status===403){setData(null);setError(cause.message);}}}
  }
  const update=(key,value)=>setDraft(current=>({...current,[key]:value}));
  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="sales-history-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="sales-history-title" className="m-0 text-xl font-semibold text-slate-950">Change history</h2>
        <p className="mt-1 text-sm text-slate-600">Internal Sales edits and business state changes. Visible only to administrators.</p></div>
      <button type="button" disabled={loading} onClick={()=>{setCursor('');setPages([]);setRefresh(value=>value+1);}} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Refresh</button>
    </div>
    {data?.startedAt?<p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-950">Tracking began {pacific(data.startedAt)}. Earlier edits were not reconstructed. System / unattributed includes automation and writers without verified editor context.</p>:null}
    <form className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event=>{event.preventDefault();setPages([]);setCursor('');setFilters({...draft});}}>
      <label className="text-sm font-medium">From · Pacific<input type="date" className={fieldClass} value={draft.from} onChange={event=>update('from',event.target.value)}/></label>
      <label className="text-sm font-medium">Through · Pacific<input type="date" className={fieldClass} value={draft.to} onChange={event=>update('to',event.target.value)}/></label>
      <label className="text-sm font-medium">Company name or ID<input type="search" maxLength={200} className={fieldClass} value={draft.company} onChange={event=>update('company',event.target.value)} placeholder="Find a company"/></label>
      <label className="text-sm font-medium">Contact ID<input type="search" maxLength={200} className={fieldClass} value={draft.contact} onChange={event=>update('contact',event.target.value)} placeholder="Exact contact ID"/></label>
      <label className="text-sm font-medium">Changed by<select className={fieldClass} value={draft.actorKind==='system'?'system':draft.actor} onChange={event=>{update('actorKind',event.target.value==='system'?'system':'');update('actor',event.target.value==='system'?'':event.target.value);}}><option value="">All editors</option><option value="system">System / unattributed</option>{data?.actors.map(actor=><option key={actor.actor_id} value={actor.actor_id}>{actor.actor_name} · {actor.actor_id}</option>)}</select></label>
      <label className="text-sm font-medium">Record type<select className={fieldClass} value={draft.entity} onChange={event=>update('entity',event.target.value)}><option value="">All record types</option>{data?.entities.map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label className="text-sm font-medium">Field<select aria-label="Field" className={fieldClass} value={draft.field} onChange={event=>update('field',event.target.value)}><option value="">All fields</option>{data?.fields.map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label className="text-sm font-medium">Change<select aria-label="Change" className={fieldClass} value={draft.action} onChange={event=>update('action',event.target.value)}><option value="">All changes</option>{data?.actions.map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
      <div className="flex items-end gap-2"><button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white" type="submit" disabled={loading}>Apply filters</button><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="button" onClick={()=>{setDraft(emptyFilters);setFilters({...emptyFilters});setCursor('');setPages([]);}}>Clear</button></div>
    </form>
    {error?<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>:null}
    {loading?<p role="status" className="mt-5 text-sm text-slate-600">Loading change history…</p>:null}
    {!loading&&data&&!data.events.length?<p className="mt-5 text-sm text-slate-600">No changes match these filters since tracking began.</p>:null}
    <div className="mt-5 space-y-3">{data?.events.map(event=><article key={event.event_id} className="min-w-0 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><p className="m-0 break-words font-semibold text-slate-950">{event.company_name||event.prospect_id||label(event.entity_type)} <span className="text-sm font-normal text-slate-500">· {label(event.entity_type)}</span></p><p className="mt-1 break-words text-sm text-slate-600">{event.actor_name} · {event.actor_role}{event.actor_id?` · User ${event.actor_id}`:''}</p></div><time dateTime={event.occurred_at} title={event.cursor_time} className="text-sm text-slate-600">{pacific(event.occurred_at)}</time></div>
      <p className="mt-2 break-words text-sm font-semibold text-slate-800">{label(event.field_path)} <span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs font-medium">{event.action}</span></p>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">{[['Before',event.old_preview,event.old_present,event.old_truncated],['After',event.new_preview,event.new_present,event.new_truncated]].map(([title,value,present,truncated])=><div key={title} className="min-w-0 rounded bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-500">{title}</p><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-slate-800">{preview(value,present,truncated)}</pre></div>)}</div>
      <button type="button" aria-expanded={expanded===event.event_id} onClick={()=>expand(event)} className="mt-3 text-sm font-semibold text-blue-700">{expanded===event.event_id?'Hide full change':'View full change and IDs'}</button>
      {expanded===event.event_id?<div className="mt-3 border-t border-slate-200 pt-3">{detailError?<p role="alert" className="text-sm text-red-700">{detailError}</p>:!detail?<p role="status" className="text-sm">Loading full values…</p>:<><div className="grid grid-cols-1 gap-1 break-all text-xs text-slate-600"><div>Event: {detail.event_id} · UTC: {event.cursor_time}</div><div>Record: {detail.entity_id}</div>{detail.prospect_id?<div>Company ID: {detail.prospect_id}</div>:null}{detail.contact_id?<div>Contact ID: {detail.contact_id}</div>:null}{detail.number_id?<div>Number ID: {detail.number_id}</div>:null}{detail.sales_call_id?<div>Call ID: {detail.sales_call_id}</div>:null}<div>Transaction: {detail.transaction_id} · Request: {detail.request_id||'Unattributed'}</div></div><div className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">{[['Complete before value',detail.old_value,detail.old_present],['Complete after value',detail.new_value,detail.new_present]].map(([title,value,present])=><div key={title} className="min-w-0 rounded border border-slate-200 p-3"><p className="text-xs font-semibold text-slate-500">{title}</p><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{displayValue(value,present)}</pre></div>)}</div></>}</div>:null}
    </article>)}</div>
    {data?<div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><p>Page {pages.length+1} · Up to 50 field changes per page</p><div className="flex gap-2"><button type="button" disabled={!pages.length||loading} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40" onClick={()=>{setCursor(pages.at(-1));setPages(current=>current.slice(0,-1));}}>Previous</button><button type="button" disabled={!data.nextCursor||loading} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40" onClick={()=>{setPages(current=>[...current,cursor]);setCursor(data.nextCursor);}}>Next</button></div></div>:null}
  </section>;
}
